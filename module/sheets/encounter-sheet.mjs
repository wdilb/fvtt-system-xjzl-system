import { evaluateEncounterFormula } from "../utils/encounter-formula.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const choiceMap = (group) => Object.fromEntries(
  Object.entries(group).map(([key, label]) => [key, game.i18n.localize(label)])
);

/**
 * 战局配置 Sheet；仅编辑源 Item，不接触任何 Combat 运行副本。
 */
export class XJZLEncounterSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["xjzl-encounter", "xjzl-encounter-sheet"],
    position: { width: 980, height: 760 },
    window: { resizable: true, minimizable: false },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      addFieldEffect: XJZLEncounterSheet.prototype._onAddFieldEffect,
      deleteFieldEffect: XJZLEncounterSheet.prototype._onDeleteFieldEffect,
      copyFieldEffect: XJZLEncounterSheet.prototype._onCopyFieldEffect,
      moveFieldEffect: XJZLEncounterSheet.prototype._onMoveFieldEffect,
      addGroup: XJZLEncounterSheet.prototype._onAddGroup,
      deleteGroup: XJZLEncounterSheet.prototype._onDeleteGroup,
      copyGroup: XJZLEncounterSheet.prototype._onCopyGroup,
      moveGroup: XJZLEncounterSheet.prototype._onMoveGroup,
      addNpc: XJZLEncounterSheet.prototype._onAddNpc,
      deleteNpc: XJZLEncounterSheet.prototype._onDeleteNpc,
      copyNpc: XJZLEncounterSheet.prototype._onCopyNpc,
      moveNpc: XJZLEncounterSheet.prototype._onMoveNpc,
      chooseActor: XJZLEncounterSheet.prototype._onChooseActor,
      clearActor: XJZLEncounterSheet.prototype._onClearActor,
      addAction: XJZLEncounterSheet.prototype._onAddAction,
      deleteAction: XJZLEncounterSheet.prototype._onDeleteAction,
      copyAction: XJZLEncounterSheet.prototype._onCopyAction,
      moveAction: XJZLEncounterSheet.prototype._onMoveAction,
      toggleEntry: XJZLEncounterSheet.prototype._onToggleEntry
    }
  };

  static PARTS = {
    header: { template: "systems/xjzl-system/templates/item/encounter/header.hbs" },
    tabs: { template: "systems/xjzl-system/templates/item/encounter/tabs.hbs" },
    overview: { template: "systems/xjzl-system/templates/item/encounter/tab-overview.hbs", scrollable: [""] },
    fields: { template: "systems/xjzl-system/templates/item/encounter/tab-fields.hbs", scrollable: [""] },
    support: { template: "systems/xjzl-system/templates/item/encounter/tab-support.hbs", scrollable: [""] }
  };

  tabGroups = { primary: "overview" };
  collapsedEntries = new Set();
  collapseStateInitialized = false;

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const source = this.document.system.toObject();
    this._initializeCollapseState(source);
    // 第一版曾使用富文本编辑器；转为短摘要时剥离旧标记，避免在 textarea 中暴露 HTML 源码。
    const summaryElement = document.createElement("div");
    summaryElement.innerHTML = source.description || "";
    source.description = summaryElement.textContent?.trim() || "";
    context.system = source;
    context.tabs = this.tabGroups;
    context.choices = {
      fieldTriggers: choiceMap(CONFIG.XJZL.encounter.fieldTriggers),
      fieldTargets: choiceMap(CONFIG.XJZL.encounter.fieldTargets),
      actionTargets: choiceMap(CONFIG.XJZL.encounter.actionTargets),
      automationTypes: choiceMap(CONFIG.XJZL.encounter.automationTypes),
      supportPermissions: choiceMap(CONFIG.XJZL.encounter.supportPermissions),
      damageTypes: choiceMap(Object.fromEntries(Object.entries(CONFIG.XJZL.damageTypes).filter(([key]) => key !== "none")))
    };
    context.system.fieldEffects = source.fieldEffects.map((effect, index) => {
      const collapseKey = `field:${effect.id}`;
      return {
        ...effect,
        index,
        collapseKey,
        collapsed: this.collapsedEntries.has(collapseKey),
        displayOrder: String(index + 1).padStart(2, "0"),
        showTriggerValue: ["specificRoundStart", "intervalRoundStart"].includes(effect.trigger),
        showAmount: effect.automationType !== "description",
        showDamageType: effect.automationType === "damage",
        formulaError: this._validateFormula(effect)
      };
    });
    context.system.support.groups = source.support.groups.map((group, groupIndex) => {
      const collapseKey = `group:${group.id}`;
      return {
        ...group,
        groupIndex,
        collapseKey,
        collapsed: this.collapsedEntries.has(collapseKey),
        displayOrder: String(groupIndex + 1).padStart(2, "0"),
        displayName: group.name || game.i18n.format("XJZL.Encounter.DefaultSupportGroup", { number: groupIndex + 1 }),
        npcs: group.npcs.map((npc, npcIndex) => this._prepareNpc(npc, groupIndex, npcIndex))
      };
    });
    const groups = context.system.support.groups;
    context.summary = {
      enabledFieldCount: context.system.fieldEffects.filter(effect => effect.enabled).length,
      fieldCount: context.system.fieldEffects.length,
      groupCount: groups.length,
      npcCount: groups.reduce((total, group) => total + group.npcs.length, 0),
      actionCount: groups.reduce((total, group) => total + group.npcs.reduce((sum, npc) => sum + npc.actions.length, 0), 0),
      playerGroupCount: groups.filter(group => group.enabled && group.permission === "players").length
    };
    return context;
  }

  /** 解析支援 NPC 的世界 Actor，并补齐模板所需的动作展示状态。 */
  _prepareNpc(npc, groupIndex, npcIndex) {
    const resolved = npc.sourceActorUuid ? fromUuidSync(npc.sourceActorUuid) : null;
    const actor = resolved instanceof Actor && resolved.pack == null && resolved.parent == null ? resolved : null;
    const collapseKey = `npc:${npc.id}`;
    return {
      ...npc,
      groupIndex,
      npcIndex,
      collapseKey,
      collapsed: this.collapsedEntries.has(collapseKey),
      actorName: actor?.name || "",
      actorImg: actor?.img || "",
      actorMissing: Boolean(npc.sourceActorUuid && !actor),
      actions: npc.actions.map((action, actionIndex) => {
        const actionCollapseKey = `action:${action.id}`;
        return {
          ...action,
          actionIndex,
          collapseKey: actionCollapseKey,
          collapsed: this.collapsedEntries.has(actionCollapseKey),
          displayOrder: String(actionIndex + 1).padStart(2, "0"),
          showMaxTargets: action.targetMode === "selected",
          showAmount: action.automationType !== "description",
          showDamageType: action.automationType === "damage",
          formulaError: this._validateFormula(action)
        };
      })
    };
  }

  /** 首次打开 Sheet 时收起已有配置；后续新增或复制的条目保持展开，便于立即编辑。 */
  _initializeCollapseState(source) {
    if (this.collapseStateInitialized) return;
    for (const effect of source.fieldEffects) this.collapsedEntries.add(`field:${effect.id}`);
    for (const group of source.support.groups) {
      this.collapsedEntries.add(`group:${group.id}`);
      for (const npc of group.npcs) {
        this.collapsedEntries.add(`npc:${npc.id}`);
        for (const action of npc.actions) this.collapsedEntries.add(`action:${action.id}`);
      }
    }
    this.collapseStateInitialized = true;
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    this._bindConditionalFields(htmlElement);

    for (const input of htmlElement.querySelectorAll("[data-encounter-formula]")) {
      const automationName = input.name.replace(/amountFormula$/, "automationType");
      const automation = this.element.querySelector(`[name="${automationName}"]`);
      const validate = () => {
        if (automation?.value === "description") {
          input.setCustomValidity("");
          input.classList.remove("is-invalid");
          return;
        }
        try {
          const value = evaluateEncounterFormula(input.value, 1);
          if (["damage", "healing"].includes(automation?.value) && value < 0) throw new Error(game.i18n.localize("XJZL.Encounter.AmountNonNegative"));
          input.setCustomValidity("");
          input.classList.remove("is-invalid");
        } catch (error) {
          input.setCustomValidity(error.message);
          input.classList.add("is-invalid");
        }
      };
      input.addEventListener("input", validate);
      automation?.addEventListener("change", validate);
      validate();
    }
  }

  /** 切换单个配置条目的详情区，并保持状态跨表单重渲染。 */
  _onToggleEntry(event, target) {
    event.preventDefault();
    const key = target.dataset.collapseKey;
    if (!key) return;
    const collapsed = !this.collapsedEntries.has(key);
    if (collapsed) this.collapsedEntries.add(key);
    else this.collapsedEntries.delete(key);

    const entry = target.closest("[data-collapse-entry]");
    entry?.classList.toggle("is-collapsed", collapsed);
    const body = entry?.querySelector(":scope > [data-collapse-body]");
    if (body) body.hidden = collapsed;
    const label = game.i18n.localize(collapsed ? "XJZL.Encounter.ExpandEntry" : "XJZL.Encounter.CollapseEntry");
    target.title = label;
    target.setAttribute("aria-label", label);
    target.setAttribute("aria-expanded", String(!collapsed));
    const icon = target.querySelector("i");
    icon?.classList.toggle("fa-chevron-right", collapsed);
    icon?.classList.toggle("fa-chevron-down", !collapsed);
  }

  /**
   * 让自动化类型、时机与目标模式控制相关字段的可见性。
   * 隐藏时保留原值，方便 GM 往返切换配置而不丢失输入。
   */
  _bindConditionalFields(htmlElement) {
    for (const entry of htmlElement.querySelectorAll("[data-encounter-entry]")) {
      const controls = {
        automation: entry.querySelector("[data-automation-control]"),
        trigger: entry.querySelector("[data-trigger-control]"),
        target: entry.querySelector("[data-target-control]")
      };
      const refresh = () => {
        this._toggleConditionalGroup(entry, "automation", controls.automation?.value);
        this._toggleConditionalGroup(entry, "trigger", controls.trigger?.value);
        this._toggleConditionalGroup(entry, "target", controls.target?.value);
      };
      for (const control of Object.values(controls)) control?.addEventListener("change", refresh);
      refresh();
    }
  }

  /**
   * 切换单类条件节点；节点通过空格分隔的 data-show-* 值声明允许项。
   */
  _toggleConditionalGroup(entry, group, value) {
    for (const element of entry.querySelectorAll(`[data-show-${group}]`)) {
      const allowed = element.dataset[`show${group[0].toUpperCase()}${group.slice(1)}`].split(/\s+/);
      const visible = allowed.includes(value);
      element.hidden = !visible;
      element.setAttribute("aria-hidden", String(!visible));
    }
  }

  _validateFormula(entry) {
    if (entry.automationType === "description") return "";
    try {
      const value = evaluateEncounterFormula(entry.amountFormula, 1);
      if (["damage", "healing"].includes(entry.automationType) && value < 0) return game.i18n.localize("XJZL.Encounter.AmountNonNegative");
      return "";
    }
    catch (error) { return error.message; }
  }

  /** 返回可安全修改后整体写回的系统源数据副本。 */
  _source() {
    return this.document.system.toObject();
  }

  /** 创建带稳定 ID 的默认场域效果。 */
  _newFieldEffect(number) {
    return { id: foundry.utils.randomID(), name: `${game.i18n.localize("XJZL.Encounter.FieldEffect")} ${number}`, description: "", enabled: true, trigger: "roundStart", triggerValue: 1, targetMode: "friendly", automationType: "description", amountFormula: "0", damageType: "waigong" };
  }

  /** 创建带稳定 ID 的默认援助动作。 */
  _newAction(number) {
    return { id: foundry.utils.randomID(), name: `${game.i18n.localize("XJZL.Encounter.SupportAction")} ${number}`, description: "", enabled: true, targetMode: "selected", maxTargets: 1, automationType: "description", amountFormula: "0", damageType: "waigong", minRound: 1, cooldownRounds: 0 };
  }

  /** 创建一名尚未关联世界 Actor 的默认支援 NPC。 */
  _newNpc(number) {
    return { id: foundry.utils.randomID(), sourceActorUuid: "", manualName: `${game.i18n.localize("XJZL.Encounter.SupportNpc")} ${number}`, description: "", enabled: true, encounterLimit: 0, actions: [] };
  }

  /** 创建拥有独立权限与共享额度的支援编组。 */
  _newGroup(number) {
    return {
      id: foundry.utils.randomID(),
      name: game.i18n.format("XJZL.Encounter.DefaultSupportGroup", { number }),
      description: "",
      enabled: true,
      permission: "gm",
      encounterLimit: 0,
      roundLimit: 0,
      oncePerNpcPerRound: true,
      npcs: []
    };
  }

  // 场地效果使用整体数组写回，确保排序、复制与稳定 ID 始终同步。
  async _onAddFieldEffect() {
    const data = this._source();
    data.fieldEffects.push(this._newFieldEffect(data.fieldEffects.length + 1));
    await this.document.update({ "system.fieldEffects": data.fieldEffects });
  }
  async _onDeleteFieldEffect(event, target) {
    if (!await this._confirmDelete()) return;
    const data = this._source();
    data.fieldEffects.splice(Number(target.dataset.index), 1);
    await this.document.update({ "system.fieldEffects": data.fieldEffects });
  }
  async _onCopyFieldEffect(event, target) {
    const data = this._source();
    const copy = foundry.utils.deepClone(data.fieldEffects[Number(target.dataset.index)]);
    copy.id = foundry.utils.randomID();
    copy.name = `${copy.name} ${game.i18n.localize("XJZL.Encounter.CopySuffix")}`;
    data.fieldEffects.splice(Number(target.dataset.index) + 1, 0, copy);
    await this.document.update({ "system.fieldEffects": data.fieldEffects });
  }
  async _onMoveFieldEffect(event, target) { await this._move("fieldEffects", Number(target.dataset.index), Number(target.dataset.direction)); }

  // 支援编组拥有独立权限和额度；复制时必须重建所有后代 ID，避免运行态引用冲突。
  async _onAddGroup() {
    const data = this._source();
    data.support.groups.push(this._newGroup(data.support.groups.length + 1));
    await this.document.update({ "system.support.groups": data.support.groups });
  }

  async _onDeleteGroup(event, target) {
    if (!await this._confirmDelete()) return;
    const data = this._source();
    data.support.groups.splice(Number(target.dataset.groupIndex), 1);
    await this.document.update({ "system.support.groups": data.support.groups });
  }

  async _onCopyGroup(event, target) {
    const data = this._source();
    const index = Number(target.dataset.groupIndex);
    const copy = foundry.utils.deepClone(data.support.groups[index]);
    copy.id = foundry.utils.randomID();
    copy.name = `${copy.name || game.i18n.localize("XJZL.Encounter.SupportGroup")} ${game.i18n.localize("XJZL.Encounter.CopySuffix")}`;
    copy.npcs = copy.npcs.map(npc => ({
      ...npc,
      id: foundry.utils.randomID(),
      actions: npc.actions.map(action => ({ ...action, id: foundry.utils.randomID() }))
    }));
    data.support.groups.splice(index + 1, 0, copy);
    await this.document.update({ "system.support.groups": data.support.groups });
  }

  async _onMoveGroup(event, target) {
    await this._move("support.groups", Number(target.dataset.groupIndex), Number(target.dataset.direction));
  }

  // NPC 仅保存世界 Actor UUID；名称和头像会在战局关联时固化为快照。
  async _onAddNpc(event, target) {
    const data = this._source();
    const group = data.support.groups[Number(target.dataset.groupIndex)];
    group.npcs.push(this._newNpc(group.npcs.length + 1));
    await this.document.update({ "system.support.groups": data.support.groups });
  }

  async _onDeleteNpc(event, target) {
    if (!await this._confirmDelete()) return;
    const data = this._source();
    data.support.groups[Number(target.dataset.groupIndex)].npcs.splice(Number(target.dataset.npcIndex), 1);
    await this.document.update({ "system.support.groups": data.support.groups });
  }

  async _onCopyNpc(event, target) {
    const data = this._source();
    const group = data.support.groups[Number(target.dataset.groupIndex)];
    const index = Number(target.dataset.npcIndex);
    const copy = foundry.utils.deepClone(group.npcs[index]);
    copy.id = foundry.utils.randomID();
    copy.manualName = `${copy.manualName || game.i18n.localize("XJZL.Encounter.SupportNpc")} ${game.i18n.localize("XJZL.Encounter.CopySuffix")}`;
    copy.actions = copy.actions.map(action => ({ ...action, id: foundry.utils.randomID() }));
    group.npcs.splice(index + 1, 0, copy);
    await this.document.update({ "system.support.groups": data.support.groups });
  }

  async _onMoveNpc(event, target) {
    const data = this._source();
    const npcs = data.support.groups[Number(target.dataset.groupIndex)].npcs;
    this._swap(npcs, Number(target.dataset.npcIndex), Number(target.dataset.direction));
    await this.document.update({ "system.support.groups": data.support.groups });
  }

  async _onChooseActor(event, target) {
    const groupIndex = Number(target.dataset.groupIndex);
    const npcIndex = Number(target.dataset.npcIndex);
    const actors = game.actors.contents.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    const options = actors.map(actor => `<option value="${actor.uuid}">${foundry.utils.escapeHTML(actor.name)}</option>`).join("");
    const uuid = await DialogV2.prompt({
      classes: ["xjzl-battle-dialog"],
      position: { width: 420, height: "auto" },
      window: { title: game.i18n.localize("XJZL.Encounter.ChooseActor") },
      content: `<div class="xjzl-battle-actor-picker"><label>${game.i18n.localize("XJZL.Encounter.WorldActor")}<select name="actorUuid">${options}</select><small>${game.i18n.localize("XJZL.Encounter.ActorLinkHint")}</small></label></div>`,
      ok: { label: game.i18n.localize("XJZL.UI.Confirm"), callback: (_event, button) => button.form.elements.actorUuid.value },
      rejectClose: false
    });
    if (!uuid) return;
    const data = this._source();
    data.support.groups[groupIndex].npcs[npcIndex].sourceActorUuid = uuid;
    await this.document.update({ "system.support.groups": data.support.groups });
  }

  async _onClearActor(event, target) {
    const data = this._source();
    data.support.groups[Number(target.dataset.groupIndex)].npcs[Number(target.dataset.npcIndex)].sourceActorUuid = "";
    await this.document.update({ "system.support.groups": data.support.groups });
  }

  // 每个 NPC 可配置多条独立动作，额度仍由 NPC 与所属编组共同约束。
  async _onAddAction(event, target) {
    const data = this._source();
    const npc = data.support.groups[Number(target.dataset.groupIndex)].npcs[Number(target.dataset.npcIndex)];
    npc.actions.push(this._newAction(npc.actions.length + 1));
    await this.document.update({ "system.support.groups": data.support.groups });
  }

  async _onDeleteAction(event, target) {
    if (!await this._confirmDelete()) return;
    const data = this._source();
    data.support.groups[Number(target.dataset.groupIndex)].npcs[Number(target.dataset.npcIndex)].actions.splice(Number(target.dataset.actionIndex), 1);
    await this.document.update({ "system.support.groups": data.support.groups });
  }

  async _onCopyAction(event, target) {
    const data = this._source();
    const actions = data.support.groups[Number(target.dataset.groupIndex)].npcs[Number(target.dataset.npcIndex)].actions;
    const index = Number(target.dataset.actionIndex);
    const copy = foundry.utils.deepClone(actions[index]);
    copy.id = foundry.utils.randomID();
    copy.name = `${copy.name} ${game.i18n.localize("XJZL.Encounter.CopySuffix")}`;
    actions.splice(index + 1, 0, copy);
    await this.document.update({ "system.support.groups": data.support.groups });
  }

  async _onMoveAction(event, target) {
    const data = this._source();
    const actions = data.support.groups[Number(target.dataset.groupIndex)].npcs[Number(target.dataset.npcIndex)].actions;
    this._swap(actions, Number(target.dataset.actionIndex), Number(target.dataset.direction));
    await this.document.update({ "system.support.groups": data.support.groups });
  }

  /** 交换同级条目并整体写回；越界移动保持原顺序。 */
  async _move(path, index, direction) {
    const data = this._source();
    const entries = foundry.utils.getProperty(data, path);
    this._swap(entries, index, direction);
    await this.document.update({ [`system.${path}`]: entries });
  }
  _swap(entries, index, direction) {
    const next = index + direction;
    if (next < 0 || next >= entries.length) return;
    [entries[index], entries[next]] = [entries[next], entries[index]];
  }
  async _confirmDelete() {
    return DialogV2.confirm({
      window: { title: game.i18n.localize("XJZL.Encounter.DeleteTitle") },
      content: `<p>${game.i18n.localize("XJZL.Encounter.DeleteConfirm")}</p>`,
      rejectClose: false
    });
  }
}
