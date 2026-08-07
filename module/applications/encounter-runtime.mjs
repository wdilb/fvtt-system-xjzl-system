import { EncounterManager } from "../managers/encounter-manager.mjs";
import { evaluateEncounterFormula } from "../utils/encounter-formula.mjs";
import { EffectSelectionDialog } from "./effect-selection-dialog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const html = (value) => foundry.utils.escapeHTML(String(value ?? ""));
const plainText = (value) => {
  const node = document.createElement("div");
  node.innerHTML = String(value ?? "");
  return node.textContent?.trim() || "";
};

/**
 * 当前 Combat 的场景悬浮 HUD；GM 可编辑副本，玩家仅查看及使用获准支援。
 */
export class EncounterRuntimeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static instances = new Map();
  // 记录用户主动关闭时对应的关联时间；重新关联后 linkedAt 改变，HUD 会再次自动出现。
  static dismissedLinks = new Map();
  static launcherId = "xjzl-battle-hud-launcher";
  // 默认避开左侧队列 HUD；打开态与关闭态沿用同一位置，减少视线跳动。
  static hudPosition = { left: 492, top: 84 };
  static launcherPosition = { left: 492, top: 84 };

  static DEFAULT_OPTIONS = {
    id: "xjzl-encounter-runtime",
    tag: "div",
    classes: ["xjzl-encounter-runtime"],
    position: { width: 132, height: "auto" },
    window: { title: "XJZL.Encounter.BattleSituation", icon: "fas fa-shield", resizable: false, minimizable: false },
    actions: {
      linkEncounter: EncounterRuntimeApp.prototype._onLinkEncounter,
      toggleViewMode: EncounterRuntimeApp.prototype._onToggleViewMode,
      toggleEffect: EncounterRuntimeApp.prototype._onToggleEffect,
      executeEffect: EncounterRuntimeApp.prototype._onExecuteEffect,
      viewDescription: EncounterRuntimeApp.prototype._onViewDescription,
      editEffect: EncounterRuntimeApp.prototype._onEditEffect,
      editSupport: EncounterRuntimeApp.prototype._onEditSupport,
      toggleNpc: EncounterRuntimeApp.prototype._onToggleNpc,
      editAction: EncounterRuntimeApp.prototype._onEditAction,
      useSupport: EncounterRuntimeApp.prototype._onUseSupport,
      adjustCounter: EncounterRuntimeApp.prototype._onAdjustCounter,
      resolvePending: EncounterRuntimeApp.prototype._onResolvePending,
      openStatus: EncounterRuntimeApp.prototype._onOpenStatus
    }
  };

  static PARTS = {
    main: { template: "systems/xjzl-system/templates/apps/encounter-runtime.hbs", scrollable: [".encounter-runtime-body"] }
  };

  constructor(options = {}) {
    const combatId = options.combatId || game.combat?.id;
    super({ ...options, id: `xjzl-encounter-runtime-${combatId}` });
    this.combatId = combatId;
    this.activeSection = "support";
    this.viewMode = "compact";
  }

  get title() { return game.i18n.localize("XJZL.Encounter.BattleSituation"); }

  /** 将悬浮控件限制在当前视口内；position 只接受有限数值坐标。 */
  static _fitPosition(position, { width, height }) {
    const left = Number.isFinite(position?.left) ? position.left : this.hudPosition.left;
    const top = Number.isFinite(position?.top) ? position.top : this.hudPosition.top;
    return {
      left: Math.max(16, Math.min(left, window.innerWidth - width - 16)),
      top: Math.max(16, Math.min(top, window.innerHeight - height - 16))
    };
  }

  /**
   * 打开指定战斗的单例 HUD。
   * 自动模式会尊重用户对当前关联副本的主动关闭，手动打开则清除该记录。
   */
  static open(combat = game.combat, { automatic = false } = {}) {
    if (!combat) return ui.notifications.warn(game.i18n.localize("XJZL.Encounter.NoActiveCombat"));
    const state = EncounterManager.getState(combat);
    if (automatic && this.dismissedLinks.has(combat.id) && this.dismissedLinks.get(combat.id) === state?.linkedAt) return null;
    if (!automatic) this.dismissedLinks.delete(combat.id);
    let app = this.instances.get(combat.id);
    if (!app) {
      const position = this._fitPosition(this.hudPosition, { width: 600, height: 62 });
      app = new this({
        combatId: combat.id,
        position: {
          // 预留详细模式的展开宽度，避免从极简态切换时窗体越出画布右侧。
          left: position.left,
          top: position.top
        }
      });
      this.instances.set(combat.id, app);
    }
    document.getElementById(this.launcherId)?.remove();
    app.render({ force: true });
    return app;
  }

  /**
   * 在 HUD 关闭后保留一个轻量启动器；只有当前画布存在已关联战局时才显示。
   */
  static syncLauncher(combat = game.combat) {
    const current = document.getElementById(this.launcherId);
    if (!EncounterManager.isLinked(combat) || this.instances.has(combat.id)) {
      current?.remove();
      return;
    }
    // 回合与额度变化会频繁刷新 HUD；同一战斗的启动器无需反复销毁和重建。
    if (current?.dataset.combatId === combat.id) return;
    current?.remove();
    const launcher = document.createElement("button");
    launcher.id = this.launcherId;
    launcher.dataset.combatId = combat.id;
    launcher.type = "button";
    launcher.innerHTML = `<span aria-hidden="true">局</span><i></i>`;
    launcher.title = game.i18n.localize("XJZL.Encounter.OpenBattleHud");
    launcher.setAttribute("aria-label", launcher.title);
    const position = this._fitPosition(this.launcherPosition, { width: 48, height: 48 });
    Object.assign(launcher.style, { left: `${position.left}px`, top: `${position.top}px` });
    this.launcherPosition = position;
    this._makeLauncherDraggable(launcher);
    launcher.addEventListener("click", event => {
      if (launcher.dataset.dragged === "true") {
        event.preventDefault();
        delete launcher.dataset.dragged;
        return;
      }
      this.hudPosition = { ...this.launcherPosition };
      this.open(combat);
    });
    document.body.appendChild(launcher);
  }

  /** 允许关闭态启动器拖动，并在本次客户端会话中记住位置。 */
  static _makeLauncherDraggable(launcher) {
    let pointerId = null;
    let startPointer = null;
    let startPosition = null;
    let moved = false;
    const finish = event => {
      if (event.pointerId !== pointerId) return;
      if (launcher.hasPointerCapture(pointerId)) launcher.releasePointerCapture(pointerId);
      launcher.classList.remove("is-dragging");
      if (moved) {
        launcher.dataset.dragged = "true";
        setTimeout(() => delete launcher.dataset.dragged, 0);
      }
      pointerId = null;
    };
    launcher.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      pointerId = event.pointerId;
      startPointer = { x: event.clientX, y: event.clientY };
      startPosition = { ...this.launcherPosition };
      moved = false;
      launcher.setPointerCapture(pointerId);
      launcher.classList.add("is-dragging");
    });
    launcher.addEventListener("pointermove", event => {
      if (event.pointerId !== pointerId) return;
      const dx = event.clientX - startPointer.x;
      const dy = event.clientY - startPointer.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      const position = this._fitPosition({ left: startPosition.left + dx, top: startPosition.top + dy }, { width: 48, height: 48 });
      Object.assign(launcher.style, { left: `${position.left}px`, top: `${position.top}px` });
      this.launcherPosition = position;
    });
    launcher.addEventListener("pointerup", finish);
    launcher.addEventListener("pointercancel", finish);
  }

  /**
   * 在 Combat 被删除或切换场景时关闭 HUD，并清除该战斗的关闭偏好。
   */
  static closeForCombat(combat) {
    if (!combat) return;
    this.dismissedLinks.delete(combat.id);
    document.getElementById(this.launcherId)?.remove();
    this.instances.get(combat.id)?.close({ encounterCleanup: true });
  }

  get combat() { return game.combats.get(this.combatId); }

  async close(options = {}) {
    const position = this.constructor._fitPosition(this.position, { width: 600, height: 62 });
    this.constructor.hudPosition = position;
    this.constructor.launcherPosition = { ...position };
    if (!options.encounterCleanup) {
      const linkedAt = EncounterManager.getState(this.combat)?.linkedAt;
      if (linkedAt) this.constructor.dismissedLinks.set(this.combatId, linkedAt);
    }
    this.constructor.instances.delete(this.combatId);
    const result = await super.close(options);
    if (!options.encounterCleanup) this.constructor.syncLauncher(this.combat);
    return result;
  }

  /**
   * 从 Combat 副本派生纯展示状态，包括实时目标、公式数值和每个支援动作的可用原因。
   */
  async _prepareContext(options) {
    const combat = this.combat;
    const raw = EncounterManager.getState(combat);
    const state = raw ? foundry.utils.deepClone(raw) : null;
    const isGM = game.user.isGM;
    const accessibleGroups = state?.support?.groups?.filter(group => isGM || group.permission === "players") ?? [];
    const canUseSupport = accessibleGroups.length > 0;
    if (!canUseSupport && this.activeSection === "support") this.activeSection = "fields";
    if (state?.status === "linked") {
      state.fieldEffects = state.fieldEffects.map(effect => {
        const targets = EncounterManager.resolveFieldTargets(combat, effect, null, "preview");
        let currentAmount = "—";
        if (effect.automationType !== "description") {
          try { currentAmount = Math.trunc(evaluateEncounterFormula(effect.amountFormula, combat.round || 1)); }
          catch (error) { currentAmount = game.i18n.format("XJZL.Encounter.FormulaInvalidShort", { reason: error.message }); }
        }
        return {
          ...effect,
          iconClass: this._automationIcon(effect.automationType),
          descriptionText: plainText(effect.description),
          hasAmount: effect.automationType !== "description",
          isDamage: effect.automationType === "damage",
          targetNames: targets.map(target => target.name).join("、") || game.i18n.localize("XJZL.Encounter.NoTargets"),
          triggerLabel: game.i18n.localize(CONFIG.XJZL.encounter.fieldTriggers[effect.trigger]),
          automationLabel: game.i18n.localize(CONFIG.XJZL.encounter.automationTypes[effect.automationType]),
          damageTypeLabel: effect.automationType === "damage" ? game.i18n.localize(CONFIG.XJZL.damageTypes[effect.damageType]) : "",
          currentAmount,
          nextTrigger: EncounterManager.nextTriggerLabel(combat, effect)
        };
      });
      state.support.groups = accessibleGroups.map((group, groupIndex) => {
        const npcs = group.npcs.map(npc => {
          const usedThisRound = group.npcUsedThisRound.includes(npc.id);
          const actions = npc.actions.map(action => {
            const unavailableReason = EncounterManager.supportAvailabilityError(combat, group, npc, action);
            return {
              ...action,
              iconClass: this._automationIcon(action.automationType),
              descriptionText: plainText(action.description),
              usable: !unavailableReason,
              unavailableReason,
              availabilityLabel: unavailableReason || game.i18n.localize("XJZL.Encounter.SupportReady"),
              automationLabel: game.i18n.localize(CONFIG.XJZL.encounter.automationTypes[action.automationType]),
              damageTypeLabel: action.automationType === "damage" ? game.i18n.localize(CONFIG.XJZL.damageTypes[action.damageType]) : "",
              targetLabel: game.i18n.localize(CONFIG.XJZL.encounter.actionTargets[action.targetMode])
            };
          });
          const available = actions.some(action => action.usable);
          return {
            ...npc,
            groupId: group.id,
            descriptionText: plainText(npc.description),
            encounterRemainingLabel: this._remainingLabel(npc.encounterRemaining),
            usedThisRound,
            available,
            availabilityLabel: available
              ? game.i18n.localize("XJZL.Encounter.SupportReady")
              : (actions.find(action => action.unavailableReason)?.unavailableReason || game.i18n.localize("XJZL.Encounter.NoActions")),
            actions
          };
        });
        return {
          ...group,
          descriptionText: plainText(group.description),
          displayName: group.name || group.snapshotName || game.i18n.format("XJZL.Encounter.DefaultSupportGroup", { number: groupIndex + 1 }),
          encounterRemainingLabel: this._remainingLabel(group.encounterRemaining),
          roundRemainingLabel: this._remainingLabel(group.roundRemaining),
          availableCount: npcs.filter(npc => npc.available).length,
          npcs
        };
      });
      state.pendingItems = state.pendingItems.filter(item => !item.resolved).map(item => ({
        ...item,
        triggerLabel: game.i18n.localize(CONFIG.XJZL.encounter.fieldTriggers[item.trigger] || "XJZL.Encounter.SupportUse")
      }));
    }
    return {
      combat,
      state,
      linked: state?.status === "linked",
      skipped: state?.status === "skipped",
      isGM,
      canLinkEncounter: isGM && game.items.some(item => item.type === "encounter"),
      canUseSupport,
      activeSection: this.activeSection,
      compact: this.viewMode === "compact",
      detailed: this.viewMode === "detailed"
    };
  }

  _attachPartListeners(partId, element, options) {
    super._attachPartListeners(partId, element, options);
    for (const tab of element.querySelectorAll("[data-runtime-section]")) {
      tab.addEventListener("click", () => {
        this.activeSection = tab.dataset.runtimeSection;
        if (this.viewMode === "compact") this.viewMode = "detailed";
        this.render({ force: true, position: { width: 600, height: "auto" } });
      });
    }
  }

  _remainingLabel(value) {
    return value === null ? game.i18n.localize("XJZL.Encounter.Unlimited") : value;
  }

  /** 为极简 HUD 提供稳定的结算类型图标，避免依赖名称猜测动作含义。 */
  _automationIcon(type) {
    return ({ damage: "fa-burst", healing: "fa-heart-pulse", rage: "fa-fire", description: "fa-scroll" })[type] || "fa-bolt";
  }

  _findEffect(id) {
    return EncounterManager.getState(this.combat)?.fieldEffects.find(effect => effect.id === id);
  }

  _findGroup(id) {
    return EncounterManager.getState(this.combat)?.support.groups.find(group => group.id === id);
  }

  _findNpc(groupId, npcId) {
    return this._findGroup(groupId)?.npcs.find(npc => npc.id === npcId);
  }

  // 顶栏与场地效果操作只修改 Combat 快照，不回写源 Item。
  async _onLinkEncounter() {
    if (!await EncounterManager.chooseEncounter(this.combat)) return;
    this.activeSection = EncounterManager.isLinked(this.combat) ? "support" : "fields";
    this.render({ force: true });
  }

  async _onToggleViewMode() {
    this.viewMode = this.viewMode === "compact" ? "detailed" : "compact";
    const width = this.viewMode === "compact" ? 132 : 600;
    this.render({ force: true, position: { width, height: "auto" } });
  }

  async _onToggleEffect(event, target) {
    await EncounterManager.updateState(this.combat, state => {
      const effect = state.fieldEffects.find(entry => entry.id === target.dataset.effectId);
      if (effect) effect.enabled = !effect.enabled;
    });
    this.render({ force: true });
  }
  async _onExecuteEffect(event, target) {
    const effect = this._findEffect(target.dataset.effectId);
    if (!effect) return;
    await EncounterManager.runFieldTrigger(this.combat, effect.trigger, { manual: true, effectId: effect.id, combatant: this.combat.combatant });
    this.render({ force: true });
  }
  async _onViewDescription(event, target) {
    const effect = this._findEffect(target.dataset.effectId);
    if (!effect) return;
    await DialogV2.prompt({
      classes: ["xjzl-battle-dialog"],
      position: { width: 420, height: "auto" },
      window: { title: effect.name },
      content: `<div class="xjzl-encounter-rule-dialog">${effect.description || game.i18n.localize("XJZL.Encounter.NoDescription")}</div>`,
      ok: { label: game.i18n.localize("XJZL.UI.Close") }
    });
  }

  /** 打开运行态场地效果编辑器，并在保存前复核公式与自定义目标。 */
  async _onEditEffect(event, target) {
    const effect = foundry.utils.deepClone(this._findEffect(target.dataset.effectId));
    if (!effect) return;
    const combatants = this.combat.combatants.contents.filter(combatant => combatant.token);
    const currentIds = new Set(EncounterManager.resolveFieldTargets(this.combat, effect, null, "preview").map(entry => entry.combatant.id));
    const damageTypes = Object.fromEntries(Object.entries(CONFIG.XJZL.damageTypes).filter(([key]) => key !== "none"));
    const formId = `encounter-effect-${foundry.utils.randomID()}`;
    const targetChoices = combatants.map(combatant => {
      const disposition = combatant.token?.disposition;
      const friendly = disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
      const hostile = disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE;
      const dispositionClass = friendly ? "is-friendly" : hostile ? "is-hostile" : "is-neutral";
      const dispositionLabel = game.i18n.localize(friendly ? "XJZL.Encounter.FriendlySide" : hostile ? "XJZL.Encounter.HostileSide" : "XJZL.Encounter.NeutralSide");
      const dispositionIcon = friendly ? "fa-shield" : hostile ? "fa-skull-crossbones" : "fa-circle-dot";
      return `<label class="runtime-target-choice ${dispositionClass}"><input type="checkbox" name="customTargets" value="${combatant.id}" data-disposition="${disposition}" ${currentIds.has(combatant.id) ? "checked" : ""}><span><small><i class="fas ${dispositionIcon}"></i>${html(dispositionLabel)}</small><b>${html(combatant.name)}</b></span></label>`;
    }).join("");
    const content = `
      <div id="${formId}" class="xjzl-encounter-edit battle-effect-editor">
        <header class="runtime-editor-identity"><span class="editor-emblem"><i class="fas fa-mountain"></i></span><label><small>${game.i18n.localize("XJZL.Encounter.FieldEffect")}</small><input name="name" value="${html(effect.name)}" aria-label="${game.i18n.localize("XJZL.Encounter.Name")}"></label></header>
        <section class="runtime-editor-section">
          <header><i class="fas fa-hourglass-half"></i><div><b>${game.i18n.localize("XJZL.Encounter.TimingStage")}</b><small>${game.i18n.localize("XJZL.Encounter.TriggerHint")}</small></div></header>
          <div class="editor-field-grid timing-grid">
            <label><span>${game.i18n.localize("XJZL.Encounter.Trigger")}</span><select name="trigger">${this._choiceOptions(CONFIG.XJZL.encounter.fieldTriggers, effect.trigger)}</select></label>
            <label data-trigger-value><span>${game.i18n.localize("XJZL.Encounter.TriggerValue")}</span><input type="number" min="1" name="triggerValue" value="${effect.triggerValue}"><small>${game.i18n.localize("XJZL.Encounter.TriggerValueRuntimeHint")}</small></label>
            <label><span>${game.i18n.localize("XJZL.Encounter.TargetMode")}</span><select name="targetMode">${this._choiceOptions(CONFIG.XJZL.encounter.fieldTargets, effect.targetMode)}</select><small>${game.i18n.localize("XJZL.Encounter.FieldTargetHint")}</small></label>
          </div>
        </section>
        <section class="runtime-editor-section settlement-editor-section">
          <header><i class="fas fa-bolt"></i><div><b>${game.i18n.localize("XJZL.Encounter.SettlementStage")}</b><small>${game.i18n.localize("XJZL.Encounter.AutomationTypeHint")}</small></div></header>
          <div class="editor-field-grid settlement-grid">
            <label><span>${game.i18n.localize("XJZL.Encounter.AutomationType")}</span><select name="automationType">${this._choiceOptions(CONFIG.XJZL.encounter.automationTypes, effect.automationType)}</select></label>
            <label data-amount-formula><span>${game.i18n.localize("XJZL.Encounter.AmountFormula")}</span><input name="amountFormula" value="${html(effect.amountFormula)}"><small>${game.i18n.localize("XJZL.Encounter.FormulaHint")}</small></label>
            <label data-damage-type><span>${game.i18n.localize("XJZL.Encounter.DamageType")}</span><select name="damageType">${this._choiceOptions(damageTypes, effect.damageType)}</select><small>${game.i18n.localize("XJZL.Encounter.DamageTypeHint")}</small></label>
          </div>
        </section>
        <section class="runtime-editor-section rule-editor-section"><header><i class="fas fa-scroll"></i><div><b>${game.i18n.localize("XJZL.Encounter.Description")}</b><small>${game.i18n.localize("XJZL.Encounter.FieldDescriptionHint")}</small></div></header><textarea name="description">${html(effect.description)}</textarea></section>
        <section class="runtime-editor-section target-editor-section" data-custom-targets><header><i class="fas fa-crosshairs"></i><div><b>${game.i18n.localize("XJZL.Encounter.FinalTargets")}</b><small>${game.i18n.localize("XJZL.Encounter.RuntimeTargetHint")}</small></div></header><fieldset class="runtime-target-roster">${targetChoices}</fieldset></section>
      </div>`;
    const result = await DialogV2.wait({
      classes: ["xjzl-battle-dialog"],
      position: { width: 680, height: "auto" },
      window: { title: game.i18n.localize("XJZL.Encounter.EditFieldEffect") }, content,
      render: () => {
        const root = document.getElementById(formId);
        this._bindRuntimeEditorConditions(root);
        const form = root?.closest("form");
        const mode = form?.elements.targetMode;
        const checks = Array.from(root?.querySelectorAll('[name="customTargets"]') || []);
        mode?.addEventListener("change", () => {
          if (mode.value === "custom") return;
          const wanted = mode.value === "friendly" ? CONST.TOKEN_DISPOSITIONS.FRIENDLY : CONST.TOKEN_DISPOSITIONS.HOSTILE;
          checks.forEach(check => { check.checked = Number(check.dataset.disposition) === wanted; });
        });
        checks.forEach(check => check.addEventListener("change", () => { mode.value = "custom"; }));
      },
      buttons: [
        { action: "save", label: game.i18n.localize("XJZL.UI.Save"), default: true, callback: (_event, button) => {
          const form = button.form;
          try {
            if (form.elements.automationType.value !== "description") evaluateEncounterFormula(form.elements.amountFormula.value, this.combat.round || 1);
          } catch (error) { return { validationError: error.message }; }
          return { name: form.elements.name.value, description: form.elements.description.value, trigger: form.elements.trigger.value, triggerValue: Math.max(1, Number(form.elements.triggerValue.value) || 1), targetMode: form.elements.targetMode.value, customTargetIds: new FormData(form).getAll("customTargets"), automationType: form.elements.automationType.value, amountFormula: form.elements.amountFormula.value, damageType: form.elements.damageType.value };
        } },
        { action: "cancel", label: game.i18n.localize("XJZL.UI.Cancel"), callback: () => null }
      ], closeAction: "cancel"
    });
    if (!result) return;
    if (result.validationError) return ui.notifications.error(result.validationError);
    if (result.targetMode === "custom" && !result.customTargetIds.length) return ui.notifications.error(game.i18n.localize("XJZL.Encounter.CustomTargetRequiredRuntime"));
    await EncounterManager.updateState(this.combat, state => Object.assign(state.fieldEffects.find(entry => entry.id === effect.id), result));
    this.render({ force: true });
  }

  /** 将本地化配置表转换为安全的 option 标记。 */
  _choiceOptions(map, selected) {
    return Object.entries(map)
      .map(([key, label]) => `<option value="${key}" ${key === selected ? "selected" : ""}>${html(game.i18n.localize(label))}</option>`)
      .join("");
  }

  /**
   * 运行态编辑弹窗沿用 Item Sheet 的条件字段规则，避免展示与当前配置无关的输入项。
   */
  _bindRuntimeEditorConditions(root) {
    if (!root) return;
    const form = root.closest("form");
    if (!form) return;
    const refresh = () => {
      const automation = form.elements.automationType?.value;
      const trigger = form.elements.trigger?.value;
      const targetMode = form.elements.targetMode?.value;
      for (const element of root.querySelectorAll("[data-trigger-value]")) {
        element.hidden = !["specificRoundStart", "intervalRoundStart"].includes(trigger);
      }
      for (const element of root.querySelectorAll("[data-amount-formula]")) {
        element.hidden = automation === "description";
      }
      for (const element of root.querySelectorAll("[data-damage-type]")) {
        element.hidden = automation !== "damage";
      }
      for (const element of root.querySelectorAll("[data-max-targets]")) {
        element.hidden = targetMode !== "selected";
      }
      for (const element of root.querySelectorAll("[data-custom-targets]")) {
        element.hidden = targetMode !== "custom";
      }
    };
    form.elements.automationType?.addEventListener("change", refresh);
    form.elements.trigger?.addEventListener("change", refresh);
    form.elements.targetMode?.addEventListener("change", refresh);
    refresh();
  }

  /** 编辑当前战斗的支援权限和剩余额度，不改变后续战斗使用的源配置。 */
  async _onEditSupport(event, target) {
    const group = this._findGroup(target.dataset.groupId);
    if (!group) return;
    const content = `
      <div class="xjzl-encounter-edit support-group-editor">
        <label>${game.i18n.localize("XJZL.Encounter.GroupName")}<input name="name" value="${html(group.name || group.snapshotName)}"><small>${game.i18n.localize("XJZL.Encounter.GroupNameHint")}</small></label>
        <label>${game.i18n.localize("XJZL.Encounter.Permission")}<select name="permission"><option value="gm" ${group.permission === "gm" ? "selected" : ""}>${game.i18n.localize("XJZL.Encounter.PermissionGm")}</option><option value="players" ${group.permission === "players" ? "selected" : ""}>${game.i18n.localize("XJZL.Encounter.PermissionPlayers")}</option></select><small>${game.i18n.localize("XJZL.Encounter.GroupPermissionHint")}</small></label>
        <div class="form-grid">
          <label>${game.i18n.localize("XJZL.Encounter.EncounterLimit")}<input type="number" min="0" name="encounterLimit" value="${group.encounterLimit}"><small>${game.i18n.localize("XJZL.Encounter.GroupEncounterLimitHint")}</small></label>
          <label>${game.i18n.localize("XJZL.Encounter.EncounterRemaining")}<input type="number" min="0" name="encounterRemaining" value="${group.encounterRemaining ?? ""}" placeholder="${game.i18n.localize("XJZL.Encounter.Unlimited")}"><small>${game.i18n.localize("XJZL.Encounter.RemainingRuntimeHint")}</small></label>
          <label>${game.i18n.localize("XJZL.Encounter.RoundLimit")}<input type="number" min="0" name="roundLimit" value="${group.roundLimit}"><small>${game.i18n.localize("XJZL.Encounter.GroupRoundLimitHint")}</small></label>
          <label>${game.i18n.localize("XJZL.Encounter.RoundRemaining")}<input type="number" min="0" name="roundRemaining" value="${group.roundRemaining ?? ""}" placeholder="${game.i18n.localize("XJZL.Encounter.Unlimited")}"><small>${game.i18n.localize("XJZL.Encounter.RemainingRuntimeHint")}</small></label>
        </div>
        <label><span><input type="checkbox" name="oncePerNpcPerRound" ${group.oncePerNpcPerRound ? "checked" : ""}> ${game.i18n.localize("XJZL.Encounter.OncePerNpcPerRound")}</span><small>${game.i18n.localize("XJZL.Encounter.OncePerNpcHint")}</small></label>
      </div>`;
    const result = await DialogV2.wait({
      classes: ["xjzl-battle-dialog"],
      position: { width: 500, height: "auto" },
      window: { title: game.i18n.localize("XJZL.Encounter.EditSupport") },
      content,
      buttons: [
        {
          action: "save",
          label: game.i18n.localize("XJZL.UI.Save"),
          default: true,
          callback: (_event, button) => ({
            name: button.form.elements.name.value,
            permission: button.form.elements.permission.value,
            encounterLimit: Math.max(0, Math.trunc(Number(button.form.elements.encounterLimit.value) || 0)),
            encounterRemaining: this._parseRemaining(button.form.elements.encounterRemaining.value),
            roundLimit: Math.max(0, Math.trunc(Number(button.form.elements.roundLimit.value) || 0)),
            roundRemaining: this._parseRemaining(button.form.elements.roundRemaining.value),
            oncePerNpcPerRound: button.form.elements.oncePerNpcPerRound.checked
          })
        },
        { action: "cancel", label: game.i18n.localize("XJZL.UI.Cancel"), callback: () => null }
      ],
      closeAction: "cancel"
    });
    if (!result) return;
    await EncounterManager.updateState(this.combat, state => Object.assign(state.support.groups.find(entry => entry.id === group.id), result));
    this.render({ force: true, position: { height: "auto" } });
  }

  _parseRemaining(value) {
    return value === "" ? null : Math.max(0, Math.trunc(Number(value) || 0));
  }

  // 支援编组、NPC 与动作编辑均通过 EncounterManager 串行写回当前战斗副本。
  async _onToggleNpc(event, target) {
    await EncounterManager.updateState(this.combat, state => {
      const group = state.support.groups.find(entry => entry.id === target.dataset.groupId);
      const npc = group?.npcs.find(entry => entry.id === target.dataset.npcId);
      if (npc) npc.enabled = !npc.enabled;
    });
    this.render({ force: true });
  }

  /** 编辑运行态支援动作，并在保存前验证数值公式。 */
  async _onEditAction(event, target) {
    const group = this._findGroup(target.dataset.groupId);
    const npc = this._findNpc(group?.id, target.dataset.npcId);
    const action = foundry.utils.deepClone(npc?.actions.find(entry => entry.id === target.dataset.actionId));
    if (!action) return;
    const damageTypes = Object.fromEntries(Object.entries(CONFIG.XJZL.damageTypes).filter(([key]) => key !== "none"));
    const formId = `encounter-action-${foundry.utils.randomID()}`;
    const content = `
      <div id="${formId}" class="xjzl-encounter-edit support-action-editor">
        <label>${game.i18n.localize("XJZL.Encounter.Name")}<input name="name" value="${html(action.name)}"></label>
        <label>${game.i18n.localize("XJZL.Encounter.Description")}<textarea name="description">${html(action.description)}</textarea><small>${game.i18n.localize("XJZL.Encounter.ActionDescriptionHint")}</small></label>
        <label><span><input type="checkbox" name="enabled" ${action.enabled ? "checked" : ""}> ${game.i18n.localize("XJZL.Encounter.Enabled")}</span></label>
        <div class="form-grid">
          <label>${game.i18n.localize("XJZL.Encounter.TargetMode")}<select name="targetMode">${this._choiceOptions(CONFIG.XJZL.encounter.actionTargets, action.targetMode)}</select><small>${game.i18n.localize("XJZL.Encounter.ActionTargetHint")}</small></label>
          <label data-max-targets>${game.i18n.localize("XJZL.Encounter.MaxTargets")}<input type="number" min="0" name="maxTargets" value="${action.maxTargets}"><small>${game.i18n.localize("XJZL.Encounter.MaxTargetsHint")}</small></label>
          <label>${game.i18n.localize("XJZL.Encounter.AutomationType")}<select name="automationType">${this._choiceOptions(CONFIG.XJZL.encounter.automationTypes, action.automationType)}</select><small>${game.i18n.localize("XJZL.Encounter.AutomationTypeHint")}</small></label>
          <label data-amount-formula>${game.i18n.localize("XJZL.Encounter.AmountFormula")}<input name="amountFormula" value="${html(action.amountFormula)}"><small>${game.i18n.localize("XJZL.Encounter.FormulaHint")}</small></label>
          <label data-damage-type>${game.i18n.localize("XJZL.Encounter.DamageType")}<select name="damageType">${this._choiceOptions(damageTypes, action.damageType)}</select><small>${game.i18n.localize("XJZL.Encounter.DamageTypeHint")}</small></label>
        </div>
      </div>`;
    const result = await DialogV2.wait({
      classes: ["xjzl-battle-dialog"],
      position: { width: 520, height: "auto" },
      window: { title: game.i18n.localize("XJZL.Encounter.EditSupportAction") },
      content,
      render: () => this._bindRuntimeEditorConditions(document.getElementById(formId)),
      buttons: [
        {
          action: "save",
          label: game.i18n.localize("XJZL.UI.Save"),
          default: true,
          callback: (_event, button) => {
            const form = button.form;
            try {
              if (form.elements.automationType.value !== "description") evaluateEncounterFormula(form.elements.amountFormula.value, this.combat.round || 1);
            } catch (error) {
              return { validationError: error.message };
            }
            return {
              name: form.elements.name.value,
              description: form.elements.description.value,
              enabled: form.elements.enabled.checked,
              targetMode: form.elements.targetMode.value,
              maxTargets: Math.max(0, Math.trunc(Number(form.elements.maxTargets.value) || 0)),
              automationType: form.elements.automationType.value,
              amountFormula: form.elements.amountFormula.value,
              damageType: form.elements.damageType.value
            };
          }
        },
        { action: "cancel", label: game.i18n.localize("XJZL.UI.Cancel"), callback: () => null }
      ],
      closeAction: "cancel"
    });
    if (!result) return;
    if (result.validationError) return ui.notifications.error(result.validationError);
    await EncounterManager.updateState(this.combat, state => {
      const stateGroup = state.support.groups.find(entry => entry.id === group.id);
      Object.assign(stateGroup.npcs.find(entry => entry.id === npc.id).actions.find(entry => entry.id === action.id), result);
    });
    this.render({ force: true });
  }

  /** 解析当前标记目标并请求主 GM 完成最终权限、额度与结算复核。 */
  async _onUseSupport(event, target) {
    const state = EncounterManager.getState(this.combat);
    const group = state?.support?.groups.find(entry => entry.id === target.dataset.groupId);
    const npc = group?.npcs.find(entry => entry.id === target.dataset.npcId);
    const action = npc?.actions.find(entry => entry.id === target.dataset.actionId);
    if (!action) return;
    const selectedIds = EncounterManager.selectedCombatantIds(this.combat);
    let targets;
    try { targets = EncounterManager.resolveSupportTargets(this.combat, action, selectedIds); }
    catch (error) { return ui.notifications.warn(error.message); }
    const effectParts = [game.i18n.localize(CONFIG.XJZL.encounter.automationTypes[action.automationType])];
    if (action.automationType === "damage") effectParts.push(game.i18n.localize(CONFIG.XJZL.damageTypes[action.damageType]));
    if (action.automationType !== "description") effectParts.push(action.amountFormula);
    const content = `
      <div class="xjzl-encounter-confirm">
        <h3>${html(npc.snapshotName)} · ${html(action.name)}</h3>
        <p><b>${game.i18n.localize("XJZL.Encounter.Targets")}：</b>${html(targets.map(entry => entry.name).join("、") || game.i18n.localize("XJZL.Encounter.NoTargets"))}</p>
        <p><b>${game.i18n.localize("XJZL.Encounter.Effect")}：</b>${html(effectParts.join(" · "))}</p>
        <p><b>${game.i18n.localize("XJZL.Encounter.Remaining")}：</b>${this._remainingLabel(group.encounterRemaining)} / ${this._remainingLabel(group.roundRemaining)} / ${this._remainingLabel(npc.encounterRemaining)}</p>
      </div>`;
    const confirmed = target.dataset.quickUse === "true" || await DialogV2.confirm({
      classes: ["xjzl-battle-dialog"],
      position: { width: 430, height: "auto" },
      window: { title: game.i18n.localize("XJZL.Encounter.ConfirmSupport") },
      content,
      ok: { label: game.i18n.localize("XJZL.Encounter.UseSupport") },
      reject: { label: game.i18n.localize("XJZL.UI.Cancel") },
      rejectClose: false
    });
    if (!confirmed) return;
    const request = { combatId: this.combat.id, groupId: group.id, npcId: npc.id, actionId: action.id, targetCombatantIds: selectedIds, userId: game.user.id };
    let result;
    try {
      result = game.users.activeGM?.isSelf
        ? await EncounterManager.executeSupportAsGM(request)
        : await game.xjzl.socket?.executeAsGM("useEncounterSupport", request);
    } catch (error) {
      console.error(`XJZL | 请求战局支援失败 [${action.name}]:`, error);
      result = { ok: false, error: game.i18n.localize("XJZL.Encounter.SupportFailed") };
    }
    if (result?.ok) ui.notifications.info(game.i18n.localize("XJZL.Encounter.SupportSucceeded"));
    else ui.notifications.warn(result?.error || game.i18n.localize("XJZL.Encounter.SupportFailed"));
    this.render({ force: true });
  }

  async _onAdjustCounter(event, target) {
    const delta = Number(target.dataset.delta);
    await EncounterManager.updateState(this.combat, state => {
      const group = state.support.groups.find(entry => entry.id === target.dataset.groupId);
      let holder = group;
      let key = target.dataset.scope === "round" ? "roundRemaining" : "encounterRemaining";
      if (target.dataset.scope === "npc") { holder = group?.npcs.find(npc => npc.id === target.dataset.npcId); key = "encounterRemaining"; }
      if (holder?.[key] !== null) holder[key] = Math.max(0, holder[key] + delta);
    });
    this.render({ force: true });
  }
  async _onResolvePending(event, target) {
    await EncounterManager.markPendingResolved(this.combat, target.dataset.pendingId);
    this.render({ force: true });
  }
  async _onOpenStatus(event, target) {
    const pending = EncounterManager.getState(this.combat)?.pendingItems.find(item => item.id === target.dataset.pendingId);
    const combatant = pending?.targetCombatantIds?.length === 1 ? this.combat.combatants.get(pending.targetCombatantIds[0]) : null;
    if (combatant?.actor) return EffectSelectionDialog.openForActor(combatant.actor);
    return new EffectSelectionDialog().render(true);
  }
}

/**
 * 同步 Combat flag 到画布 HUD：已打开时刷新，关闭过的当前战局保留轻量启动器。
 */
Hooks.on("xjzl.encounterUpdated", combat => {
  const app = EncounterRuntimeApp.instances.get(combat.id);
  if (app) return app.render({ force: true });
  if (combat.id === game.combat?.id && EncounterManager.isLinked(combat)) {
    const opened = EncounterRuntimeApp.open(combat, { automatic: true });
    if (!opened) EncounterRuntimeApp.syncLauncher(combat);
  } else if (combat.id === game.combat?.id) {
    document.getElementById(EncounterRuntimeApp.launcherId)?.remove();
  }
});

/** 当前画布准备完成后，只保留该场景活动战斗的 HUD。 */
Hooks.on("canvasReady", () => {
  for (const app of EncounterRuntimeApp.instances.values()) {
    if (app.combat?.scene?.id !== canvas.scene?.id) EncounterRuntimeApp.closeForCombat(app.combat);
  }
  if (EncounterManager.isLinked(game.combat)) {
    const opened = EncounterRuntimeApp.open(game.combat, { automatic: true });
    if (!opened) EncounterRuntimeApp.syncLauncher(game.combat);
  } else {
    document.getElementById(EncounterRuntimeApp.launcherId)?.remove();
  }
});

/** 重新载入客户端时恢复当前已关联战斗的悬浮 HUD。 */
Hooks.once("ready", () => {
  if (EncounterManager.isLinked(game.combat)) {
    const opened = EncounterRuntimeApp.open(game.combat, { automatic: true });
    if (!opened) EncounterRuntimeApp.syncLauncher(game.combat);
  }
});
