import { evaluateEncounterFormula } from "../utils/encounter-formula.mjs";

const SYSTEM_ID = "xjzl-system";
const FLAG_KEY = "encounter";

const html = (value) => foundry.utils.escapeHTML(String(value ?? ""));
const plainText = (value) => {
  const div = document.createElement("div");
  div.innerHTML = String(value ?? "");
  return div.textContent?.trim() || "";
};

/**
 * 管理战局快照、战斗触发和支援额度；Combat flag 是唯一运行态数据源。
 */
export class EncounterManager {
  // 同一战斗的回合流转、HUD 编辑与支援调用共用一条队列，防止完整 flag 写回互相覆盖。
  static updateQueues = new Map();
  // 同一失效目标组合只提示一次，避免每次触发都向主 GM 重复报警。
  static warnedMissingTargets = new Set();

  /** 读取 Combat flag 中的战局运行副本；未选择时返回 null。 */
  static getState(combat) {
    const state = combat?.getFlag(SYSTEM_ID, FLAG_KEY) || null;
    if (state?.status !== "linked" || Array.isArray(state.support?.groups)) return state;
    const migrated = foundry.utils.deepClone(state);
    const legacySupport = state.support ?? {};
    migrated.support = {
      groups: [{
        id: "legacy-support",
        name: game.i18n.format("XJZL.Encounter.DefaultSupportGroup", { number: 1 }),
        description: "",
        enabled: true,
        permission: legacySupport.permission ?? "gm",
        encounterLimit: legacySupport.encounterLimit ?? 0,
        roundLimit: legacySupport.roundLimit ?? 0,
        oncePerNpcPerRound: legacySupport.oncePerNpcPerRound ?? true,
        encounterRemaining: legacySupport.encounterRemaining ?? null,
        roundRemaining: legacySupport.roundRemaining ?? null,
        npcUsedThisRound: legacySupport.npcUsedThisRound ?? [],
        npcs: legacySupport.npcs ?? []
      }]
    };
    return migrated;
  }

  static isLinked(combat) {
    return this.getState(combat)?.status === "linked";
  }

  /**
   * 清理指定战斗对应的客户端临时队列与一次性警告缓存。
   * Combat flag 会随 Combat 一起删除，不需要在这里另行写回。
   */
  static cleanupCombat(combat) {
    if (!combat) return;
    this.updateQueues.delete(combat.id);
    for (const key of this.warnedMissingTargets) {
      if (key.startsWith(`${combat.id}:`)) this.warnedMissingTargets.delete(key);
    }
  }

  /**
   * 串行处理同一 Combat 的更新，避免快速切换回合造成异步阶段交错。
   */
  static queueCombatUpdate(combat, updateData, callback) {
    const previous = this.updateQueues.get(combat.id) || Promise.resolve();
    const current = previous.catch(() => undefined).then(() => callback(combat, updateData));
    const tracked = current.finally(() => {
      if (this.updateQueues.get(combat.id) === tracked) this.updateQueues.delete(combat.id);
    });
    this.updateQueues.set(combat.id, tracked);
    return tracked;
  }

  /**
   * 显示关联选择并将源 Item 深拷贝为当前 Combat 的独立快照。
   * @returns {Promise<boolean>} 已明确关联或跳过时为 true，关闭弹窗为 false
   */
  static async chooseEncounter(combat) {
    if (!game.user.isGM || !combat) return false;
    const encounters = game.items.filter(item => item.type === "encounter").sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    if (!encounters.length) return false;
    const formId = `battle-plan-picker-${foundry.utils.randomID()}`;
    const options = encounters.map(item => `<option value="${item.uuid}">${html(item.name)}</option>`).join("");
    const content = `
      <div id="${formId}" class="xjzl-encounter-picker">
        <label>${game.i18n.localize("XJZL.Encounter.BattlePlan")}<select name="encounterUuid">${options}<option value="skip">${game.i18n.localize("XJZL.Encounter.NoEncounter")}</option></select></label>
        <section class="battle-plan-preview" aria-live="polite"><span></span><h3></h3><p></p><div></div></section>
        <small>${game.i18n.localize("XJZL.Encounter.LinkHint")}</small>
      </div>`;
    const choice = await foundry.applications.api.DialogV2.wait({
      classes: ["xjzl-battle-dialog"],
      position: { width: 520, height: "auto" },
      window: { title: game.i18n.localize("XJZL.Encounter.LinkEncounter") },
      content,
      render: () => {
        const container = document.getElementById(formId);
        const select = container?.querySelector('[name="encounterUuid"]');
        const preview = container?.querySelector(".battle-plan-preview");
        const refresh = () => {
          if (!preview || !select) return;
          const item = encounters.find(entry => entry.uuid === select.value);
          preview.classList.toggle("is-skip", !item);
          preview.querySelector("span").textContent = item ? game.i18n.localize("XJZL.Encounter.BattlePlanPreview") : game.i18n.localize("XJZL.Encounter.NoEncounter");
          preview.querySelector("h3").textContent = item?.name || game.i18n.localize("XJZL.Encounter.NoEncounter");
          preview.querySelector("p").textContent = item ? (plainText(item.system.description).slice(0, 180) || game.i18n.localize("XJZL.Encounter.NoDescription")) : game.i18n.localize("XJZL.Encounter.NoEncounterHint");
          const groups = item?.system.support.groups ?? [];
          const npcCount = groups.reduce((total, group) => total + group.npcs.length, 0);
          preview.querySelector("div").textContent = item
            ? game.i18n.format("XJZL.Encounter.BattlePlanStats", { fields: item.system.fieldEffects.length, groups: groups.length, npcs: npcCount })
            : "";
        };
        select?.addEventListener("change", refresh);
        refresh();
      },
      buttons: [
        { action: "confirm", label: game.i18n.localize("XJZL.UI.Confirm"), icon: "fas fa-link", default: true, callback: (_event, button) => button.form.elements.encounterUuid.value },
        { action: "cancel", label: game.i18n.localize("XJZL.UI.Cancel"), icon: "fas fa-times", callback: () => null }
      ],
      closeAction: "cancel"
    });
    if (!choice) return false;
    if (choice === "skip") {
      await combat.setFlag(SYSTEM_ID, FLAG_KEY, { status: "skipped", skippedAt: Date.now() });
      ui.notifications.info(game.i18n.localize("XJZL.Encounter.Skipped"));
      return true;
    }
    const item = await fromUuid(choice);
    if (!(item instanceof Item) || item.type !== "encounter") {
      ui.notifications.error(game.i18n.localize("XJZL.Encounter.SourceMissing"));
      return false;
    }
    const snapshot = await this._buildSnapshot(combat, item);
    if (!snapshot) return false;
    await combat.setFlag(SYSTEM_ID, FLAG_KEY, snapshot);
    ui.notifications.info(game.i18n.format("XJZL.Encounter.Linked", { name: item.name }));
    return true;
  }

  /**
   * 深拷贝战局配置、解析 NPC 身份，并收集自定义场域目标。
   * 返回值可直接写入 Combat flag；用户取消目标选择时返回 null。
   */
  static async _buildSnapshot(combat, item) {
    const data = foundry.utils.deepClone(item.system.toObject());
    const customEffects = data.fieldEffects.filter(effect => effect.targetMode === "custom");
    if (customEffects.length) {
      const combatants = combat.combatants.contents.filter(combatant => combatant.token);
      if (!combatants.length) {
        ui.notifications.error(game.i18n.localize("XJZL.Encounter.CustomNeedsCombatants"));
        return null;
      }
      const effectHeaders = customEffects.map(effect => `<th title="${html(effect.name)}">${html(effect.name)}</th>`).join("");
      const rows = combatants.map(combatant => {
        const disposition = combatant.token?.disposition;
        const friendly = disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
        const hostile = disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE;
        const dispositionClass = friendly ? "is-friendly" : hostile ? "is-hostile" : "is-neutral";
        const dispositionLabel = game.i18n.localize(friendly ? "XJZL.Encounter.FriendlySide" : hostile ? "XJZL.Encounter.HostileSide" : "XJZL.Encounter.NeutralSide");
        const dispositionIcon = friendly ? "fa-shield" : hostile ? "fa-skull-crossbones" : "fa-circle-dot";
        const cells = customEffects.map(effect => `<td><input type="checkbox" name="target.${effect.id}" value="${combatant.id}" aria-label="${html(`${effect.name}：${combatant.name}`)}"></td>`).join("");
        return `<tr class="${dispositionClass}"><th><span><i class="fas ${dispositionIcon}"></i>${html(dispositionLabel)}</span><b>${html(combatant.name)}</b></th>${cells}</tr>`;
      }).join("");
      const targetContent = `<div class="xjzl-encounter-target-picker"><p>${game.i18n.localize("XJZL.Encounter.CustomTargetsHint")}</p><div class="target-matrix-scroll"><table><thead><tr><th>${game.i18n.localize("XJZL.Encounter.Combatant")}</th>${effectHeaders}</tr></thead><tbody>${rows}</tbody></table></div><div class="target-legend"><span class="is-friendly"><i class="fas fa-shield"></i>${game.i18n.localize("XJZL.Encounter.FriendlySide")}</span><span class="is-hostile"><i class="fas fa-skull-crossbones"></i>${game.i18n.localize("XJZL.Encounter.HostileSide")}</span><span class="is-neutral"><i class="fas fa-circle-dot"></i>${game.i18n.localize("XJZL.Encounter.NeutralSide")}</span></div></div>`;
      const selected = await foundry.applications.api.DialogV2.wait({
        classes: ["xjzl-battle-dialog", "xjzl-target-dialog"],
        position: { width: Math.min(860, window.innerWidth - 80), height: "auto" },
        window: { title: game.i18n.localize("XJZL.Encounter.CustomTargets") },
        content: targetContent,
        buttons: [
          { action: "confirm", label: game.i18n.localize("XJZL.UI.Confirm"), default: true, callback: (_event, button) => new FormData(button.form) },
          { action: "cancel", label: game.i18n.localize("XJZL.UI.Cancel"), callback: () => null }
        ],
        closeAction: "cancel"
      });
      if (!selected) return null;
      for (const effect of customEffects) {
        effect.customTargetIds = selected.getAll(`target.${effect.id}`);
        if (!effect.customTargetIds.length) {
          ui.notifications.error(game.i18n.format("XJZL.Encounter.CustomTargetRequired", { name: effect.name }));
          return null;
        }
      }
    }
    const support = data.support;
    support.groups = support.groups.map((group, groupIndex) => ({
      ...group,
      snapshotName: group.name || game.i18n.format("XJZL.Encounter.DefaultSupportGroup", { number: groupIndex + 1 }),
      encounterRemaining: this._initialRemaining(group.encounterLimit),
      roundRemaining: this._initialRemaining(group.roundLimit),
      npcUsedThisRound: [],
      npcs: group.npcs.map(npc => {
        const actor = npc.sourceActorUuid ? fromUuidSync(npc.sourceActorUuid) : null;
        const linked = actor instanceof Actor && actor.pack == null && actor.parent == null;
        return {
          ...npc,
          snapshotName: linked ? actor.name : (npc.manualName || game.i18n.localize("XJZL.Encounter.UnnamedSupport")),
          snapshotImg: linked ? actor.img : "",
          encounterRemaining: this._initialRemaining(npc.encounterLimit)
        };
      })
    }));
    return {
      status: "linked",
      sourceItemUuid: item.uuid,
      name: item.name,
      description: data.description,
      linkedAt: Date.now(),
      fieldEffects: data.fieldEffects,
      support,
      executions: [],
      pendingItems: []
    };
  }

  static _initialRemaining(limit) {
    const value = Math.max(0, Math.trunc(Number(limit) || 0));
    return value === 0 ? null : value;
  }

  /** 新轮开始时恢复共享轮次额度，并清空 NPC 的本轮使用记录。 */
  static async resetRoundSupport(combat) {
    const state = foundry.utils.deepClone(this.getState(combat));
    if (state?.status !== "linked") return;
    for (const group of state.support.groups) {
      group.roundRemaining = this._initialRemaining(group.roundLimit);
      group.npcUsedThisRound = [];
    }
    await combat.setFlag(SYSTEM_ID, FLAG_KEY, state);
  }

  /**
   * 依照列表顺序执行匹配的场地效果；单条失败只通知主 GM 并继续。
   */
  static async runFieldTrigger(combat, trigger, { combatant = null, round = combat.round, turn = combat.turn, manual = false, effectId = null } = {}) {
    const state = this.getState(combat);
    if (state?.status !== "linked") return;
    const effects = state.fieldEffects.filter(effect => (manual || effect.enabled) && (!effectId || effect.id === effectId));
    for (const effect of effects) {
      if (!manual && !this._matchesTrigger(effect, trigger, round)) continue;
      if (manual && effectId !== effect.id) continue;
      const targets = this.resolveFieldTargets(combat, effect, combatant, trigger);
      // 自动触发时，无匹配目标表示当前角色不受此规则影响，不应作为执行失败打扰 GM。
      if (!targets.length && !manual) continue;
      const key = `${combat.id}:${round}:${turn ?? -1}:${effect.id}:${trigger}`;
      if (!manual && !await this._claimExecution(combat, key)) continue;
      try {
        if (!targets.length) throw new Error(game.i18n.localize("XJZL.Encounter.ErrorNoTargets"));
        await this._executeEntry(combat, effect, targets, {
          kind: "field", trigger, manual, round,
          title: effect.name,
          sourceName: this.getState(combat).name
        });
      } catch (error) {
        console.error(`XJZL | 战局场地效果执行失败 [${effect.name}]:`, error);
        ui.notifications.warn(game.i18n.format("XJZL.Encounter.EffectFailed", { name: effect.name, reason: error.message }));
      }
    }
  }

  /**
   * 三类轮初触发共享同一实际时机，因此按 Item 原列表顺序混合执行。
   */
  static async runRoundStartTriggers(combat, { round = combat.round, turn = combat.turn } = {}) {
    const state = this.getState(combat);
    if (state?.status !== "linked") return;
    const triggers = new Set(["roundStart", "specificRoundStart", "intervalRoundStart"]);
    for (const effect of state.fieldEffects) {
      if (!effect.enabled || !triggers.has(effect.trigger) || !this._matchesTrigger(effect, effect.trigger, round)) continue;
      await this.runFieldTrigger(combat, effect.trigger, { round, turn, effectId: effect.id });
    }
  }

  static _matchesTrigger(effect, trigger, round) {
    if (effect.trigger !== trigger) return false;
    const value = Math.max(1, Math.trunc(Number(effect.triggerValue) || 1));
    if (trigger === "specificRoundStart") return round === value;
    if (trigger === "intervalRoundStart") return round > 0 && round % value === 0;
    return true;
  }

  /**
   * 将场域目标配置解析为去重后的 Actor/Combatant 对；回合触发只保留当前角色。
   */
  static resolveFieldTargets(combat, effect, currentCombatant = null, trigger = effect.trigger) {
    let combatants;
    if (effect.targetMode === "custom") {
      combatants = (effect.customTargetIds || []).map(id => combat.combatants.get(id)).filter(combatant => combatant?.token);
      const missing = (effect.customTargetIds || []).length - combatants.length;
      const warningKey = `${combat.id}:${effect.id}:${(effect.customTargetIds || []).join(",")}`;
      if (missing > 0 && game.users.activeGM?.isSelf && !this.warnedMissingTargets.has(warningKey)) {
        this.warnedMissingTargets.add(warningKey);
        ui.notifications.warn(game.i18n.format("XJZL.Encounter.TargetsMissing", { count: missing }));
      }
    } else {
      const disposition = effect.targetMode === "friendly" ? CONST.TOKEN_DISPOSITIONS.FRIENDLY : CONST.TOKEN_DISPOSITIONS.HOSTILE;
      combatants = combat.combatants.filter(c => c.token?.disposition === disposition);
    }
    if (["combatantTurnStart", "combatantTurnEnd"].includes(trigger)) {
      combatants = currentCombatant && combatants.some(c => c.id === currentCombatant.id) ? [currentCombatant] : [];
    }
    return this._actorsFromCombatants(combatants);
  }

  static _actorsFromCombatants(combatants) {
    const seen = new Set();
    const result = [];
    for (const combatant of combatants) {
      const actor = combatant?.actor;
      if (!actor) continue;
      const key = actor.uuid;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ actor, combatant, name: combatant.name || actor.name });
    }
    return result;
  }

  static async _claimExecution(combat, key) {
    const state = foundry.utils.deepClone(this.getState(combat));
    if (state?.status !== "linked" || state.executions.includes(key)) return false;
    state.executions.push(key);
    await combat.setFlag(SYSTEM_ID, FLAG_KEY, state);
    return true;
  }

  /**
   * 结算一条场域或支援配置，并在成功后发送聊天卡片。
   * 说明类不改角色数据，也不生成待处理事项，只发送原始规则描述。
   */
  static async _executeEntry(combat, entry, targets, meta) {
    const executionRound = meta.round ?? combat.round;
    let amount = null;
    if (entry.automationType !== "description") amount = evaluateEncounterFormula(entry.amountFormula, executionRound);
    if (["damage", "healing"].includes(entry.automationType) && amount < 0) throw new Error(game.i18n.localize("XJZL.Encounter.AmountNonNegative"));
    if (entry.automationType === "damage" && (!entry.damageType || entry.damageType === "none")) throw new Error(game.i18n.localize("XJZL.Encounter.DamageTypeRequired"));
    if (amount !== null) amount = Math.trunc(amount);
    const results = [];
    for (const target of targets) {
      const actor = target.actor;
      if (!actor) throw new Error(game.i18n.format("XJZL.Encounter.TargetInvalid", { name: target.name }));
      if (entry.automationType === "damage") {
        const result = await actor.applyDamage({ amount, type: entry.damageType, isHit: true, isCrit: false, source: "extra" });
        results.push(`${target.name}：-${result?.finalDamage ?? 0}`);
      } else if (entry.automationType === "healing") {
        const result = await actor.applyHealing({ amount, type: "hp", source: "extra" });
        results.push(`${target.name}：+${result?.actualHeal ?? 0}`);
      } else if (entry.automationType === "rage") {
        const resource = actor.system.resources?.rage;
        if (!resource) throw new Error(game.i18n.format("XJZL.Encounter.NoRage", { name: target.name }));
        const oldValue = Number(resource.value) || 0;
        const configuredMax = Number(resource.max);
        const max = Number.isFinite(configuredMax) ? Math.max(0, configuredMax) : 10;
        const newValue = Math.max(0, Math.min(max, oldValue + amount));
        await actor.update({ "system.resources.rage.value": newValue });
        results.push(`${target.name}：${newValue - oldValue >= 0 ? "+" : ""}${newValue - oldValue}`);
      }
    }
    await this._sendChatCard(combat, entry, targets, amount, results, meta);
    return { amount, results };
  }

  /** 使用独立模板发送战局卡片；描述类只呈现规则文本，不附加虚构的结算结果。 */
  static async _sendChatCard(combat, entry, targets, amount, results, meta) {
    const triggerLabel = game.i18n.localize(CONFIG.XJZL.encounter.fieldTriggers[meta.trigger] || "XJZL.Encounter.SupportUse");
    const automationLabel = game.i18n.localize(CONFIG.XJZL.encounter.automationTypes[entry.automationType]);
    const damageTypeLabel = entry.automationType === "damage"
      ? game.i18n.localize(CONFIG.XJZL.damageTypes[entry.damageType])
      : "";
    const content = await renderTemplate("systems/xjzl-system/templates/chat/encounter-card.hbs", {
      sourceName: meta.sourceName,
      title: meta.title,
      triggerLabel,
      automationLabel,
      damageTypeLabel,
      description: entry.description || game.i18n.localize("XJZL.Encounter.NoDescription"),
      targets: targets.map(target => ({ name: target.name })),
      noTargets: targets.length === 0,
      amount,
      hasAmount: amount !== null,
      results: results.map(result => ({ text: result })),
      hasResults: results.length > 0,
      isDamage: entry.automationType === "damage",
      isDescription: entry.automationType === "description",
      manual: meta.manual
    });
    await ChatMessage.create({
      content,
      flags: { [SYSTEM_ID]: { type: "encounter", combatId: combat.id, entryId: entry.id, manual: meta.manual } }
    });
  }

  /** 由主 GM 复核支援请求，并与回合流转共用 Combat 串行队列。 */
  static async executeSupportAsGM(request) {
    if (!game.users.activeGM?.isSelf) return null;
    const combat = game.combats.get(request.combatId);
    if (!combat) return { ok: false, error: game.i18n.localize("XJZL.Encounter.NotLinked") };
    return this.queueCombatUpdate(combat, request, () => this._executeSupportLocked(request));
  }

  /** 在串行区内再次读取最新快照，完成权限、额度、目标和结算复核。 */
  static async _executeSupportLocked(request) {
    const combat = game.combats.get(request.combatId);
    const state = foundry.utils.deepClone(this.getState(combat));
    if (!combat || state?.status !== "linked") return { ok: false, error: game.i18n.localize("XJZL.Encounter.NotLinked") };
    // 结算期间可能发生轮次推进；本次请求的校验、公式与冷却必须始终使用进入串行区时的轮次。
    const executionRound = Number(combat.round) || 0;
    const requester = game.users.get(request.userId);
    const group = state.support.groups.find(entry => entry.id === request.groupId);
    if (!requester?.active || (!requester.isGM && group?.permission !== "players")) return { ok: false, error: game.i18n.localize("XJZL.Encounter.NoPermission") };
    const npc = group?.npcs.find(entry => entry.id === request.npcId);
    const action = npc?.actions.find(entry => entry.id === request.actionId);
    const error = executionRound < 1
      ? game.i18n.localize("XJZL.Encounter.CombatNotStarted")
      : this._supportAvailabilityError(group, npc, action, executionRound);
    if (error) return { ok: false, error };
    let targets;
    try { targets = this.resolveSupportTargets(combat, action, request.targetCombatantIds || []); }
    catch (targetError) { return { ok: false, error: targetError.message }; }
    try {
      await this._executeEntry(combat, action, targets, { kind: "support", trigger: "supportUse", manual: false, round: executionRound, title: `${npc.snapshotName} · ${action.name}`, sourceName: state.name });
    } catch (executionError) {
      console.error(`XJZL | 战局支援执行失败 [${action.name}]:`, executionError);
      return { ok: false, error: executionError.message };
    }
    const fresh = foundry.utils.deepClone(this.getState(combat));
    if (fresh?.status !== "linked") return { ok: false, error: game.i18n.localize("XJZL.Encounter.NotLinked") };
    const freshGroup = fresh.support.groups.find(entry => entry.id === request.groupId);
    const freshNpc = freshGroup?.npcs.find(entry => entry.id === request.npcId);
    if (!freshGroup || !freshNpc) return { ok: false, error: game.i18n.localize("XJZL.Encounter.SupportMissing") };
    if (freshGroup.encounterRemaining !== null) freshGroup.encounterRemaining--;
    if (freshGroup.roundRemaining !== null) freshGroup.roundRemaining--;
    if (freshNpc.encounterRemaining !== null) freshNpc.encounterRemaining--;
    if (freshGroup.oncePerNpcPerRound && !freshGroup.npcUsedThisRound.includes(freshNpc.id)) freshGroup.npcUsedThisRound.push(freshNpc.id);
    // 记录动作最后一次成功使用的轮次，供冷却判定使用；结算失败则不会走到这里，不产生冷却。
    const freshAction = freshNpc.actions.find(entry => entry.id === request.actionId);
    if (freshAction) freshAction.lastUsedRound = executionRound;
    await combat.setFlag(SYSTEM_ID, FLAG_KEY, fresh);
    return { ok: true };
  }

  /** 按指定轮次检查支援配置、冷却与额度；返回空字符串表示可以调用。 */
  static _supportAvailabilityError(group, npc, action, round) {
    if (!group) return game.i18n.localize("XJZL.Encounter.SupportMissing");
    if (!npc || !action) return game.i18n.localize("XJZL.Encounter.SupportMissing");
    if (!group.enabled || !npc.enabled || !action.enabled) return game.i18n.localize("XJZL.Encounter.SupportDisabled");
    // 时间门槛优先于次数额度：未到解锁回合、或仍处于冷却期内，都先报时间原因。
    const minRound = Math.max(0, Math.trunc(Number(action.minRound) || 0));
    if (minRound > 0 && round < minRound) return game.i18n.format("XJZL.Encounter.NotUnlockedYet", { round: minRound });
    const cooldownRounds = Math.max(0, Math.trunc(Number(action.cooldownRounds) || 0));
    const lastUsedRound = Number(action.lastUsedRound);
    if (cooldownRounds > 0 && action.lastUsedRound != null && Number.isFinite(lastUsedRound)) {
      // “冷却 X 回合”表示完整跳过后续 X 个回合，因此要到使用轮次 + X + 1 才恢复。
      const cooldownUntil = lastUsedRound + cooldownRounds + 1;
      if (round < cooldownUntil) return game.i18n.format("XJZL.Encounter.CooldownUntil", { round: cooldownUntil });
    }
    if (group.encounterRemaining !== null && group.encounterRemaining <= 0) return game.i18n.localize("XJZL.Encounter.EncounterLimitReached");
    if (group.roundRemaining !== null && group.roundRemaining <= 0) return game.i18n.localize("XJZL.Encounter.RoundLimitReached");
    if (npc.encounterRemaining !== null && npc.encounterRemaining <= 0) return game.i18n.localize("XJZL.Encounter.NpcLimitReached");
    if (group.oncePerNpcPerRound && group.npcUsedThisRound.includes(npc.id)) return game.i18n.localize("XJZL.Encounter.NpcUsedThisRound");
    return "";
  }

  /**
   * 返回支援动作当前不可用的原因；空字符串表示可以调用。
   * HUD 与主 GM 的最终执行校验共用此入口，避免两处状态判断不一致。
   */
  static supportAvailabilityError(combat, group, npc, action) {
    if ((combat?.round ?? 0) < 1) return game.i18n.localize("XJZL.Encounter.CombatNotStarted");
    return this._supportAvailabilityError(group, npc, action, combat.round);
  }

  /**
   * 按动作目标模式解析最终 Actor；标记目标还会执行数量上限校验。
   */
  static resolveSupportTargets(combat, action, selectedIds) {
    if (action.targetMode === "none") {
      if (action.automationType !== "description") throw new Error(game.i18n.localize("XJZL.Encounter.ErrorNoTargets"));
      return [];
    }
    let combatants;
    if (action.targetMode === "selected") {
      combatants = selectedIds.map(id => combat.combatants.get(id)).filter(Boolean);
      if (!combatants.length) throw new Error(game.i18n.localize("XJZL.Encounter.ErrorNoTargets"));
      if (action.maxTargets > 0 && combatants.length > action.maxTargets) throw new Error(game.i18n.format("XJZL.Encounter.TooManyTargets", { max: action.maxTargets }));
    } else {
      const disposition = action.targetMode === "friendlyAll" ? CONST.TOKEN_DISPOSITIONS.FRIENDLY : CONST.TOKEN_DISPOSITIONS.HOSTILE;
      combatants = combat.combatants.filter(c => c.token?.disposition === disposition);
    }
    const targets = this._actorsFromCombatants(combatants);
    if (!targets.length && action.automationType !== "description") throw new Error(game.i18n.localize("XJZL.Encounter.ErrorNoTargets"));
    return targets;
  }

  static selectedCombatantIds(combat) {
    const tokenIds = new Set(Array.from(game.user.targets || [], token => token.document.id));
    return combat.combatants.filter(c => tokenIds.has(c.tokenId)).map(c => c.id);
  }

  /** 仅允许 GM 修改 Combat 中的战局副本；写入也进入统一队列，避免覆盖结算中的额度变化。 */
  static async updateState(combat, mutate) {
    if (!game.user.isGM || !combat) return;
    return this.queueCombatUpdate(combat, null, async () => {
      const state = foundry.utils.deepClone(this.getState(combat));
      if (state?.status !== "linked") return;
      await mutate(state);
      await combat.setFlag(SYSTEM_ID, FLAG_KEY, state);
    });
  }

  static async markPendingResolved(combat, pendingId) {
    await this.updateState(combat, state => {
      const pending = state.pendingItems.find(item => item.id === pendingId);
      if (pending) pending.resolved = true;
    });
  }

  /** 根据当前轮次与回合位置生成人类可读的下一次触发提示。 */
  static nextTriggerLabel(combat, effect) {
    const round = Math.max(1, combat.round || 1);
    if (effect.trigger === "combatStart") return combat.round > 0 ? game.i18n.localize("XJZL.Encounter.Triggered") : game.i18n.localize("XJZL.Encounter.AtCombatStart");
    if (effect.trigger === "specificRoundStart") return game.i18n.format("XJZL.Encounter.OnlyRoundStart", { round: effect.triggerValue });
    if (effect.trigger === "intervalRoundStart") {
      const interval = Math.max(1, Number(effect.triggerValue) || 1);
      const next = Math.ceil((round + (combat.round > 0 ? 1 : 0)) / interval) * interval;
      return game.i18n.format("XJZL.Encounter.NextRoundStart", { round: next });
    }
    if (effect.trigger === "roundStart") return game.i18n.format("XJZL.Encounter.NextRoundStart", { round: combat.round > 0 ? round + 1 : 1 });
    if (effect.trigger === "roundEnd") return game.i18n.format("XJZL.Encounter.NextRoundEnd", { round });
    let current = combat.combatant?.name || game.i18n.localize("XJZL.Encounter.NextCombatant");
    if (effect.trigger === "combatantTurnStart" && combat.round > 0 && combat.turns.length) {
      const nextIndex = ((combat.turn ?? -1) + 1) % combat.turns.length;
      current = combat.turns[nextIndex]?.name || current;
    }
    const key = effect.trigger === "combatantTurnEnd" ? "XJZL.Encounter.NextTurnEnd" : "XJZL.Encounter.NextTurnStart";
    return game.i18n.format(key, { name: current });
  }
}
