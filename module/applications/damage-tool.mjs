/**
 * 通用伤害与治疗工具。
 * 目标始终来自当前画布框选的 Token；窗口保持打开时会实时同步框选结果，并按 Actor UUID 去重结算。
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const renderTemplate = foundry.applications.handlebars.renderTemplate;

const HEALING_TYPES = {
  hp: { label: "XJZL.Resources.HP", icon: "fas fa-heart", color: "#58c9a3" },
  mp: { label: "XJZL.Resources.MP", icon: "fas fa-droplet", color: "#66aee8" },
  huti: { label: "XJZL.Resources.Huti", icon: "fas fa-shield-heart", color: "#63cbd1" },
  tili: { label: "XJZL.Creature.Tili", icon: "fas fa-paw", color: "#82c96f" }
};

const CRIT_MODES = {
  normal: { isCrit: false, applyCritDamage: true },
  critical: { isCrit: true, applyCritDamage: true },
  effectOnly: { isCrit: true, applyCritDamage: false }
};

export class GenericDamageTool extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    tag: "form",
    id: "xjzl-damage-tool",
    classes: ["damage-tool", "theme-dark"],
    position: {
      width: 560,
      height: 690
    },
    window: {
      title: "XJZL.UI.DamageTool.Title",
      icon: "fas fa-hand-fist",
      resizable: true
    },
    actions: {
      apply: GenericDamageTool.prototype._onApply,
      setMode: GenericDamageTool.prototype._onSetMode,
      selectDamageType: GenericDamageTool.prototype._onSelectDamageType,
      selectHealingType: GenericDamageTool.prototype._onSelectHealingType,
      setCritMode: GenericDamageTool.prototype._onSetCritMode,
      stepAmount: GenericDamageTool.prototype._onStepAmount,
      removeTarget: GenericDamageTool.prototype._onRemoveTarget,
      clearTargets: GenericDamageTool.prototype._onClearTargets,
      createMacro: GenericDamageTool.prototype._onCreateMacro
    }
  };

  static PARTS = {
    form: {
      template: "systems/xjzl-system/templates/apps/damage-tool.hbs"
    }
  };

  /**
   * 执行伤害工具生成的宏预设；目标固定为生成宏代码时框选的 Actor UUID。
   * @param {object} preset 由工具生成的版本化纯数据配置。
   * @returns {Promise<void>} 批量结算完成后返回。
   */
  static async executePreset(preset) {
    if (!game.user.isGM && !game.settings.get("xjzl-system", "allowPlayerDamageTool")) {
      return ui.notifications.warn(game.i18n.localize("XJZL.UI.DamageTool.MacroAccessDenied"));
    }

    const mode = preset?.mode;
    const amount = Number(preset?.amount);
    const damageTypeValid = mode === "damage" && preset.damageType in CONFIG.XJZL.damageTypes;
    const healingTypeValid = mode === "healing" && preset.healingType in HEALING_TYPES;
    const targetsValid = Array.isArray(preset?.targets)
      && preset.targets.length > 0
      && preset.targets.every(target => typeof target?.uuid === "string" && target.uuid.length > 0);
    if (preset?.version !== 2 || !Number.isInteger(amount) || amount <= 0 || !targetsValid || (!damageTypeValid && !healingTypeValid)) {
      return ui.notifications.warn(game.i18n.localize("XJZL.UI.DamageTool.MacroInvalid"));
    }

    const app = new GenericDamageTool();
    app._state.mode = mode;
    app._state.amountByMode[mode] = String(amount);
    app._state.reasonByMode[mode] = typeof preset.reason === "string" ? preset.reason : null;
    app._state.damageType = damageTypeValid ? preset.damageType : app._state.damageType;
    app._state.healingType = healingTypeValid ? preset.healingType : app._state.healingType;
    app._state.sourceUuid = typeof preset.sourceUuid === "string" ? preset.sourceUuid : "none";
    app._state.critMode = preset.critMode in CRIT_MODES ? preset.critMode : "normal";
    for (const key of ["ignoreDefense", "ignoreBlock", "ignoreStance", "isSkill"]) {
      if (typeof preset[key] === "boolean") app._state[key] = preset[key];
    }
    app._fixedTargets = [];
    for (const targetData of preset.targets) {
      let document = null;
      try {
        document = await fromUuid(targetData.uuid);
      } catch (error) {
        console.error(`XJZL | 无法解析宏固定目标 ${targetData.uuid}:`, error);
      }
      const actor = document?.actor || document;
      app._fixedTargets.push({
        actor: actor?.applyDamage && actor?.applyHealing ? actor : null,
        name: targetData.name || document?.name || actor?.name || targetData.uuid,
        img: document?.texture?.src || actor?.img || "icons/svg/mystery-man.svg"
      });
    }

    try {
      await app._onApply();
    } finally {
      app._teardown();
    }
  }

  constructor(options = {}) {
    super(options);
    this._state = {
      mode: "damage",
      amountByMode: { damage: "10", healing: "10" },
      reasonByMode: { damage: null, healing: null },
      damageType: "waigong",
      healingType: "hp",
      sourceUuid: "none",
      critMode: "normal",
      ignoreDefense: false,
      ignoreBlock: false,
      ignoreStance: false,
      isSkill: true,
      lastResult: null
    };
    this._isApplying = false;
    this._fixedTargets = null;
    this._renderListenerController = null;
    this._refreshControlledTargets = foundry.utils.debounce(() => {
      if (this.rendered && !this._isApplying) this.render({ force: true });
    }, 60);
    this._hookIds = [
      ["controlToken", Hooks.on("controlToken", () => this._refreshControlledTargets())],
      ["canvasReady", Hooks.on("canvasReady", () => this._refreshControlledTargets())],
      ["deleteToken", Hooks.on("deleteToken", () => this._refreshControlledTargets())]
    ];
  }

  /**
   * 关闭窗口并注销仅服务于本工具的画布 Hook，避免重复打开后累积监听器。
   * @param {object} options ApplicationV2 关闭选项。
   * @returns {Promise<GenericDamageTool>} Foundry 的关闭结果。
   */
  async close(options = {}) {
    this._teardown();
    return super.close(options);
  }

  /** 注销实例级监听器；无界面宏执行也用它释放构造时注册的画布 Hook。 */
  _teardown() {
    this._renderListenerController?.abort();
    this._renderListenerController = null;
    for (const [hook, id] of this._hookIds) Hooks.off(hook, id);
    this._hookIds = [];
  }

  /**
   * 准备窗口数据；表单状态由实例保存，因此框选变化触发重绘时不会清空用户输入。
   * @returns {Promise<object>} Handlebars 渲染上下文。
   */
  async _prepareContext(options) {
    this._ensureDefaultReasons();

    const controlled = this._getControlledTargets();
    const sourceActors = this._getSourceActors();
    if (this._state.sourceUuid !== "none" && !sourceActors.some(entry => entry.uuid === this._state.sourceUuid)) {
      this._state.sourceUuid = "none";
    }

    const mode = this._state.mode;
    const amount = this._state.amountByMode[mode];
    const damageTypes = Object.entries(CONFIG.XJZL.damageTypes).map(([key, labelKey]) => ({
      key,
      label: game.i18n.localize(labelKey),
      active: key === this._state.damageType
    }));
    const healingTypes = Object.entries(HEALING_TYPES).map(([key, config]) => ({
      key,
      label: game.i18n.localize(config.label),
      icon: config.icon,
      active: key === this._state.healingType
    }));
    const isPhysicalDamage = ["waigong", "neigong"].includes(this._state.damageType);
    const typeLabel = mode === "damage"
      ? damageTypes.find(type => type.active)?.label
      : healingTypes.find(type => type.active)?.label;

    return {
      mode,
      modeDamage: mode === "damage",
      modeHealing: mode === "healing",
      amount,
      reason: this._state.reasonByMode[mode],
      sourceUuid: this._state.sourceUuid,
      sourceActors,
      damageTypes,
      healingTypes,
      critNormal: this._state.critMode === "normal",
      critCritical: this._state.critMode === "critical",
      critEffectOnly: this._state.critMode === "effectOnly",
      ignoreDefense: this._state.ignoreDefense,
      ignoreBlock: this._state.ignoreBlock,
      ignoreStance: this._state.ignoreStance,
      isSkill: this._state.isSkill,
      isPhysicalDamage,
      targets: controlled.targets.map(target => ({
        tokenId: target.token.id,
        actorUuid: target.actor.uuid,
        name: target.name,
        img: target.img
      })),
      targetCount: controlled.targets.length,
      duplicateTargetCount: controlled.duplicateCount,
      hasTargets: controlled.targets.length > 0,
      isApplying: this._isApplying,
      canApply: controlled.targets.length > 0 && !this._isApplying,
      typeLabel,
      actionSummary: game.i18n.format(mode === "damage"
        ? "XJZL.UI.DamageTool.ApplyDamageSummary"
        : "XJZL.UI.DamageTool.ApplyHealingSummary", {
        count: controlled.targets.length,
        amount,
        type: typeLabel
      }),
      lastResult: this._state.lastResult
    };
  }

  /**
   * 渲染后重新绑定表单状态同步与快捷键；旧监听器会统一中止，避免重绘后重复触发。
   * @param {object} context 当前模板上下文。
   * @param {object} options 当前渲染选项。
   */
  _onRender(context, options) {
    super._onRender(context, options);

    this._renderListenerController?.abort();
    this._renderListenerController = new AbortController();
    const { signal } = this._renderListenerController;
    this.element.addEventListener("input", event => this._captureField(event.target), { signal });
    this.element.addEventListener("change", event => this._captureField(event.target), { signal });
    this.element.addEventListener("keydown", event => {
      if (event.ctrlKey && event.key === "Enter") this._onApply(event);
    }, { signal });
  }

  /**
   * 读取当前画布框选目标，并按 Actor UUID 去重。
   * @returns {{targets: Array<object>, duplicateCount: number}} 结算目标快照。
   */
  _getControlledTargets() {
    const tokens = canvas?.tokens?.controlled || [];
    const uniqueActors = new Map();

    for (const token of tokens) {
      if (!token?.actor?.uuid || uniqueActors.has(token.actor.uuid)) continue;
      uniqueActors.set(token.actor.uuid, {
        token,
        actor: token.actor,
        name: token.name || token.actor.name,
        img: token.document?.texture?.src || token.actor.img
      });
    }

    const targets = Array.from(uniqueActors.values());
    return {
      targets,
      duplicateCount: Math.max(0, tokens.length - targets.length)
    };
  }

  /**
   * 获取当前战斗中的可选来源 Actor；UUID 可兼容未关联 Token 的合成 Actor。
   * @returns {Array<{uuid: string, name: string}>} 去重后的来源列表。
   */
  _getSourceActors() {
    const entries = new Map();
    for (const combatant of game.combat?.combatants || []) {
      if (!combatant.actor?.uuid || entries.has(combatant.actor.uuid)) continue;
      entries.set(combatant.actor.uuid, {
        uuid: combatant.actor.uuid,
        name: combatant.name || combatant.actor.name
      });
    }
    return Array.from(entries.values());
  }

  /** 初始化伤害与治疗各自的默认描述。 */
  _ensureDefaultReasons() {
    if (this._state.reasonByMode.damage === null) {
      this._state.reasonByMode.damage = game.i18n.localize("XJZL.UI.DamageTool.DefaultReason");
    }
    if (this._state.reasonByMode.healing === null) {
      this._state.reasonByMode.healing = game.i18n.localize("XJZL.UI.DamageTool.DefaultHealingReason");
    }
  }

  /**
   * 把原生表单字段同步到实例状态。
   * @param {HTMLInputElement|HTMLSelectElement} field 发生变化的字段。
   */
  _captureField(field) {
    if (!field?.name) return;
    const mode = this._state.mode;

    if (field.name === "amount") {
      this._state.amountByMode[mode] = field.value;
      this._syncActionAmount(field.value);
    } else if (field.name === "reason") {
      this._state.reasonByMode[mode] = field.value;
    } else if (field.name === "sourceUuid") {
      this._state.sourceUuid = field.value;
    } else if (["ignoreDefense", "ignoreBlock", "ignoreStance", "isSkill"].includes(field.name)) {
      this._state[field.name] = field.checked;
    }
  }

  /** @param {Event} event 模式按钮事件。 @param {HTMLElement} target 触发按钮。 */
  _onSetMode(event, target) {
    const mode = target.dataset.mode;
    if (!["damage", "healing"].includes(mode) || mode === this._state.mode) return;
    this._state.mode = mode;
    this._state.lastResult = null;
    this.render({ force: true });
  }

  /** @param {Event} event 伤害类型按钮事件。 @param {HTMLElement} target 触发按钮。 */
  _onSelectDamageType(event, target) {
    if (!(target.dataset.type in CONFIG.XJZL.damageTypes)) return;
    this._state.damageType = target.dataset.type;
    this.render({ force: true });
  }

  /** @param {Event} event 治疗类型按钮事件。 @param {HTMLElement} target 触发按钮。 */
  _onSelectHealingType(event, target) {
    if (!(target.dataset.type in HEALING_TYPES)) return;
    this._state.healingType = target.dataset.type;
    this.render({ force: true });
  }

  /** @param {Event} event 暴击模式按钮事件。 @param {HTMLElement} target 触发按钮。 */
  _onSetCritMode(event, target) {
    if (!(target.dataset.critMode in CRIT_MODES)) return;
    this._state.critMode = target.dataset.critMode;
    this.render({ force: true });
  }

  /** @param {Event} event 数值步进按钮事件。 @param {HTMLElement} target 触发按钮。 */
  _onStepAmount(event, target) {
    const mode = this._state.mode;
    const current = Number.parseInt(this._state.amountByMode[mode], 10) || 0;
    const step = Number.parseInt(target.dataset.step, 10) || 0;
    const amount = Math.max(1, current + step);
    this._state.amountByMode[mode] = String(amount);
    const input = this.element.querySelector('input[name="amount"]');
    if (input) input.value = String(amount);
    this._syncActionAmount(amount);
  }

  /** @param {Event} event 移除目标按钮事件。 @param {HTMLElement} target 触发按钮。 */
  _onRemoveTarget(event, target) {
    for (const token of [...(canvas?.tokens?.controlled || [])]) {
      if (token.actor?.uuid === target.dataset.actorUuid) token.release();
    }
  }

  /** 清空当前画布框选的全部 Token。 */
  _onClearTargets() {
    for (const token of [...(canvas?.tokens?.controlled || [])]) token.release();
  }

  /**
   * 把当前配置与当前目标固化为脚本宏代码，并复制到系统剪贴板。
   * @returns {Promise<string|undefined>} 已复制的宏代码；失败时返回 undefined。
   */
  async _onCreateMacro() {
    const preset = this._buildMacroPreset();
    if (!preset) return;
    const command = `const preset = ${JSON.stringify(preset, null, 2)};
if (!game.xjzl?.damageTool?.executePreset) {
  return ui.notifications.error(game.i18n.localize("XJZL.UI.DamageTool.MacroApiUnavailable"));
}
await game.xjzl.damageTool.executePreset(preset);`;

    try {
      await game.clipboard.copyPlainText(command);
      ui.notifications.info(game.i18n.format("XJZL.UI.DamageTool.MacroCopied", { count: preset.targets.length }));
      return command;
    } catch (error) {
      console.error("XJZL | 复制伤害工具宏代码失败:", error);
      ui.notifications.error(game.i18n.localize("XJZL.UI.DamageTool.MacroCopyFailed"));
    }
  }

  /** @returns {object|null} 可安全写入剪贴板宏代码的当前配置与固定目标快照。 */
  _buildMacroPreset() {
    const mode = this._state.mode;
    const amount = Number(this._state.amountByMode[mode]);
    if (!Number.isInteger(amount) || amount <= 0) {
      ui.notifications.warn(game.i18n.localize("XJZL.UI.DamageTool.InvalidAmount"));
      return null;
    }
    const snapshot = this._getControlledTargets();
    if (snapshot.targets.length === 0) {
      ui.notifications.warn(game.i18n.localize("XJZL.UI.DamageTool.NoTargets"));
      return null;
    }
    return {
      version: 2,
      mode,
      amount,
      targets: snapshot.targets.map(target => ({ uuid: target.actor.uuid, name: target.name })),
      reason: this._state.reasonByMode[mode]?.trim() || game.i18n.localize(
        mode === "damage" ? "XJZL.UI.DamageTool.DefaultReason" : "XJZL.UI.DamageTool.DefaultHealingReason"
      ),
      damageType: this._state.damageType,
      healingType: this._state.healingType,
      sourceUuid: this._state.sourceUuid,
      critMode: this._state.critMode,
      ignoreDefense: this._state.ignoreDefense,
      ignoreBlock: this._state.ignoreBlock,
      ignoreStance: this._state.ignoreStance,
      isSkill: this._state.isSkill
    };
  }

  /** @param {string|number} amount 更新结算按钮中的实时数值。 */
  _syncActionAmount(amount) {
    const summaryNode = this.element.querySelector("[data-action-summary]");
    if (!summaryNode) return;
    const mode = this._state.mode;
    const typeLabel = mode === "damage"
      ? game.i18n.localize(CONFIG.XJZL.damageTypes[this._state.damageType])
      : game.i18n.localize(HEALING_TYPES[this._state.healingType].label);
    summaryNode.textContent = game.i18n.format(mode === "damage"
      ? "XJZL.UI.DamageTool.ApplyDamageSummary"
      : "XJZL.UI.DamageTool.ApplyHealingSummary", {
      count: this._getControlledTargets().targets.length,
      amount: amount || 0,
      type: typeLabel
    });
  }

  /** @param {boolean} applying 切换批量执行锁与按钮状态。 */
  _setApplyingState(applying) {
    this._isApplying = applying;
    const button = this.element?.querySelector('[data-action="apply"]');
    if (!button) return;
    button.disabled = applying || this._getControlledTargets().targets.length === 0;
    button.classList.toggle("is-applying", applying);
  }

  /**
   * 执行当前伤害或治疗配置；目标和配置会在点击瞬间冻结，避免处理中途串目标。
   * @param {Event} event 点击或快捷键事件。
   */
  async _onApply(event) {
    event?.preventDefault();
    if (this._isApplying) return;

    const mode = this._state.mode;
    const amount = Number(this._state.amountByMode[mode]);
    if (!Number.isInteger(amount) || amount <= 0) {
      return ui.notifications.warn(game.i18n.localize("XJZL.UI.DamageTool.InvalidAmount"));
    }

    const snapshot = this._fixedTargets
      ? { targets: this._fixedTargets, duplicateCount: 0 }
      : this._getControlledTargets();
    if (snapshot.targets.length === 0) {
      return ui.notifications.warn(game.i18n.localize("XJZL.UI.DamageTool.NoTargets"));
    }

    // 点击瞬间冻结所有配置，避免批量结算期间切换模式或类型造成前后目标参数不一致。
    const sourceUuid = this._state.sourceUuid;
    const damageType = this._state.damageType;
    const healingType = this._state.healingType;
    const reason = this._state.reasonByMode[mode]?.trim() || game.i18n.localize(
      mode === "damage" ? "XJZL.UI.DamageTool.DefaultReason" : "XJZL.UI.DamageTool.DefaultHealingReason"
    );
    const config = {
      ...CRIT_MODES[this._state.critMode],
      ignoreDefense: this._state.ignoreDefense,
      ignoreBlock: this._state.ignoreBlock,
      ignoreStance: this._state.ignoreStance,
      isSkill: this._state.isSkill
    };

    this._state.lastResult = null;
    this._setApplyingState(true);
    const results = [];

    try {
      let sourceActor = null;
      if (sourceUuid !== "none") {
        const sourceDocument = await fromUuid(sourceUuid);
        sourceActor = sourceDocument?.actor || sourceDocument;
        if (!sourceActor) {
          ui.notifications.warn(game.i18n.localize("XJZL.UI.DamageTool.InvalidSource"));
          return;
        }
      }

      for (const target of snapshot.targets) {
        try {
          const result = mode === "damage"
            ? await this._applyDamageToTarget(target, amount, damageType, reason, config, sourceActor)
            : await this._applyHealingToTarget(target, amount, healingType, reason, sourceActor);
          results.push({ success: true, target: target.name, result });
        } catch (error) {
          console.error(`XJZL | 对 ${target.name} 执行${mode === "damage" ? "伤害" : "治疗"}失败:`, error);
          results.push({ success: false, target: target.name, error });
        }
      }
    } finally {
      this._setApplyingState(false);
    }

    const successCount = results.filter(entry => entry.success).length;
    const failures = results.filter(entry => !entry.success).map(entry => entry.target);
    this._state.lastResult = {
      successCount,
      failureCount: failures.length,
      failureNames: failures.join("、"),
      complete: failures.length === 0,
      modeDamage: mode === "damage"
    };

    if (failures.length === 0) {
      ui.notifications.info(game.i18n.format("XJZL.UI.DamageTool.BatchSuccess", { count: successCount }));
    } else if (successCount > 0) {
      ui.notifications.warn(game.i18n.format("XJZL.UI.DamageTool.BatchPartial", {
        success: successCount,
        failure: failures.length,
        names: failures.join("、")
      }));
    } else {
      ui.notifications.error(game.i18n.format("XJZL.UI.DamageTool.BatchFailed", { names: failures.join("、") }));
    }

    if (this.rendered) this.render({ force: true });
  }

  /**
   * 对单个目标执行伤害并生成可独立撤销的聊天卡片。
   * @param {object} target 目标 Token/Actor 快照。
   * @param {number} amount 原始伤害值，必须为正整数。
   * @param {string} type CONFIG.XJZL.damageTypes 中的类型。
   * @param {string} reason 伤害描述。
   * @param {object} config 暴击和减伤穿透配置。
   * @param {Actor|null} attackerActor 来源 Actor；null 表示环境。
   * @returns {Promise<object>} XJZLActor.applyDamage 的结算结果。
   */
  async _applyDamageToTarget(target, amount, type, reason, config, attackerActor) {
    const result = await target.actor.applyDamage({
      amount,
      type,
      attacker: attackerActor,
      isHit: true,
      isCrit: config.isCrit,
      applyCritDamage: config.applyCritDamage,
      isBroken: false,
      ignoreDefense: config.ignoreDefense,
      ignoreBlock: config.ignoreBlock,
      ignoreStance: config.ignoreStance,
      isSkill: config.isSkill,
      source: "extra"
    });
    if (!result) throw new Error("伤害结算未返回结果");

    const typeLabel = game.i18n.localize(CONFIG.XJZL.damageTypes[type] || type);
    const content = await renderTemplate("systems/xjzl-system/templates/chat/damage-card.hbs", {
      name: target.name,
      img: target.img,
      finalDamage: result.finalDamage || 0,
      hutiLost: result.hutiLost || 0,
      hpLost: result.hpLost || 0,
      mpLost: result.mpLost || 0,
      tiliLost: result.tiliLost || 0,
      isDead: result.isDead,
      isDying: result.isDying,
      rageGained: result.rageGained,
      isCrit: config.isCrit,
      isUndone: false
    });

    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: target.actor }),
      flavor: this._buildFlavor(reason, typeLabel, attackerActor, "damage"),
      content,
      flags: {
        "xjzl-system": {
          type: "damage-card",
          isUndone: false,
          undoData: {
            attackerUuid: attackerActor?.uuid || null,
            targetUuid: target.actor.uuid,
            hpLost: result.hpLost || 0,
            hutiLost: result.hutiLost || 0,
            mpLost: result.mpLost || 0,
            tiliLost: result.tiliLost || 0,
            gainedDead: !!result.isDead,
            gainedDying: !!result.isDying,
            gainedRage: result.rageGained || 0
          }
        }
      }
    });

    return result;
  }

  /**
   * 对单个目标执行资源治疗并生成可独立撤销的聊天卡片。
   * @param {object} target 目标 Token/Actor 快照。
   * @param {number} amount 请求治疗值，必须为正整数。
   * @param {"hp"|"mp"|"huti"|"tili"} type 治疗资源类型。
   * @param {string} reason 治疗描述。
   * @param {Actor|null} healerActor 来源 Actor；null 表示环境或系统。
   * @returns {Promise<object>} XJZLActor.applyHealing 的结算结果。
   */
  async _applyHealingToTarget(target, amount, type, reason, healerActor) {
    if (target.actor.type === "container") throw new Error("容器无法接受治疗");
    const before = this._getResourceValue(target.actor, type);
    if (!Number.isFinite(before)) throw new Error(`目标不支持 ${type} 资源治疗`);

    const result = await target.actor.applyHealing({
      amount,
      type,
      showScrolling: true,
      healer: healerActor,
      source: "extra"
    });
    if (!result) throw new Error("治疗结算未返回结果");

    const actualHeal = Number(result.actualHeal) || 0;
    // 远端 GM 委托返回时，本地 Actor 同步事件可能尚未抵达；优先使用核心结算返回的新值。
    const returnedNewVal = Number(result.newVal);
    const newVal = Number.isFinite(returnedNewVal) ? returnedNewVal : this._getResourceValue(target.actor, type);
    const maxVal = this._getResourceMax(target.actor, type);
    const typeConfig = HEALING_TYPES[type];
    const typeLabel = game.i18n.localize(typeConfig.label);
    const content = await renderTemplate("systems/xjzl-system/templates/chat/heal-card.hbs", {
      name: target.name,
      img: target.img,
      color: typeConfig.color,
      amount: actualHeal,
      typeLabel,
      newVal,
      maxVal,
      overflow: Math.max(0, amount - actualHeal),
      isBlocked: !!result.isBlocked,
      noEffect: actualHeal === 0,
      canUndo: actualHeal > 0,
      isUndone: false
    });

    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: target.actor }),
      flavor: this._buildFlavor(reason, typeLabel, healerActor, "healing"),
      content,
      flags: {
        "xjzl-system": {
          type: "healing-card",
          isUndone: false,
          undoData: actualHeal > 0 ? {
            healerUuid: healerActor?.uuid || null,
            targetUuid: target.actor.uuid,
            type,
            amount: actualHeal
          } : null
        }
      }
    });

    return result;
  }

  /** @param {Actor} actor 目标 Actor。 @param {string} type 资源类型。 @returns {number} 当前资源值。 */
  _getResourceValue(actor, type) {
    if (type === "hp") return Number(actor.system.resources.hp?.value);
    if (type === "mp") return Number(actor.system.resources.mp?.value);
    if (type === "tili") return Number(actor.system.resources.tili?.value);
    if (type === "huti") {
      const huti = actor.system.resources.huti;
      return Number(typeof huti === "object" ? huti?.value : huti);
    }
    return Number.NaN;
  }

  /** @param {Actor} actor 目标 Actor。 @param {string} type 资源类型。 @returns {number|null} 资源上限。 */
  _getResourceMax(actor, type) {
    if (type === "hp") return Number(actor.system.resources.hp?.max) || null;
    if (type === "mp") return Number(actor.system.resources.mp?.max) || null;
    if (type === "tili") return Number(actor.system.resources.tili?.max) || null;
    if (type === "huti" && typeof actor.system.resources.huti === "object") {
      return Number(actor.system.resources.huti?.max) || null;
    }
    return null;
  }

  /**
   * 构建聊天消息说明；所有来自表单或文档名称的值均转义后再插入 HTML。
   * @param {string} reason 用户输入的说明。
   * @param {string} typeLabel 本地化后的类型名称。
   * @param {Actor|null} sourceActor 来源 Actor。
   * @param {"damage"|"healing"} mode 当前模式。
   * @returns {string} 安全的 flavor HTML。
   */
  _buildFlavor(reason, typeLabel, sourceActor, mode) {
    const escape = value => foundry.utils.escapeHTML(String(value ?? ""));
    const source = sourceActor
      ? game.i18n.format(mode === "damage" ? "XJZL.UI.DamageTool.FromDamage" : "XJZL.UI.DamageTool.FromHealing", {
        name: escape(sourceActor.name)
      })
      : "";
    return `${source}<strong>${escape(reason)}</strong> <small>(${escape(typeLabel)})</small>`;
  }
}
