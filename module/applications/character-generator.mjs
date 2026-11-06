import { XJZLCharacterGenerationManager } from "../managers/character-generation-manager.mjs";
import { normalizeGenerationConfig } from "../utils/character-generation.mjs";
import { XJZLCharacterResourcePickerApp } from "./character-resource-picker.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

const CONFLICT_FIELD_LABELS = {
  "wuxue.mainCount": "主修武学套数",
  "wuxue.mainTierCounts": "主修武学品阶数量",
  "wuxue.mainTierCounts.1": "人武数量",
  "wuxue.mainTierCounts.2": "地武数量",
  "wuxue.mainTierCounts.3": "天武数量",
  "wuxue.mainRandomMin": "主修随机数量下限",
  "wuxue.mainRandomMax": "主修随机数量上限",
  "wuxue.mainStage": "主修武学最高境界",
  "wuxue.primary": "主修武学",
  "wuxue.primary.tier": "主修品阶",
  "wuxue.primary.stage": "主修最高境界",
  "wuxue.additionalTierCounts": "其他武学品阶数量",
  "wuxue.additionalTierCounts.1": "其他人武数量",
  "wuxue.additionalTierCounts.2": "其他地武数量",
  "wuxue.additionalTierCounts.3": "其他天武数量",
  "wuxue.additionalRandomMin": "其他武学随机数量下限",
  "wuxue.additionalRandomMax": "其他武学随机数量上限",
  "wuxue.wuxue": "主修武学",
  "wuxue.fixed": "指定主修武学",
  "actor.prepareData": "角色准备",
  "generation": "生成回溯",
  "neigong.additionalCount": "指定附修内功数量",
  "neigong.additionalRandomMin": "附修内功随机数量下限",
  "neigong.additionalRandomMax": "附修内功随机数量上限",
  "equipment.armorMinCount": "最低穿戴防具数",
  "equipment.armorTypes": "指定防具部位"
};

/**
 * 将规则冲突中的结构化实际值转换为 GM 可读摘要，避免 Handlebars 把对象显示成 [object Object]。
 * @param {unknown} value - 冲突期望值或实际值。
 * @returns {string} 页面显示文本。
 */
function formatConflictValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join("、");
  if (typeof value === "object") {
    if (value.status || value.compatibility !== undefined || value.scaling !== undefined) {
      const parts = [value.status, value.compatibility == null ? null : `相性 ${value.compatibility}`, value.scaling == null ? null : `属性 ${value.scaling}`];
      return parts.filter(Boolean).join("，") || "未评价";
    }
    try { return JSON.stringify(value); }
    catch { return "不可显示"; }
  }
  return String(value);
}

/**
 * GM 随机人物生成器：只把配置、草案和创建结果放在窗口内存中，世界写入交给管理器。
 * @param {{browser?:object}} options - 可注入已有万卷阁实例，正常入口从 game.xjzl 读取。
 */
export class XJZLCharacterGeneratorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.browser = options.browser || game.xjzl?.compendiumBrowser;
    this.manager = options.manager || new XJZLCharacterGenerationManager({ browser: this.browser });
    this.config = normalizeGenerationConfig({
      requestId: "",
      namePrefix: "随机侠客",
      quantity: 1,
      synergyProbability: 100,
      matchStandard: "standard",
      neigong: { runTier: null, runStage: "", runElement: "auto", supplementForJingmai: true, pool: { filters: {}, query: "" }, additionalCount: 0, additionalRandomMin: 0, additionalRandomMax: 0, additionalGroups: [] },
      jingmai: { mode: "none", total: "", yin: 0, yang: 0, autoSupplement: true, xuanguanBroken: false },
      wuxue: { model: "primary", primary: { tier: null, stage: "", uuid: null }, additionalTierCounts: { 1: 0, 2: 0, 3: 0 }, additionalRandomMin: 0, additionalRandomMax: 0, mainCount: 1, mainTier: 1, mainTierCounts: { 1: 0, 2: 0, 3: 0 }, mainRandomMin: 0, mainRandomMax: 0, mainStage: "", allocation: "independent", healingRequired: false, healingCount: 1, sanshouCount: 0, qinggongCount: 0, zhenfaCount: 0, wuxingLimit: "", mainPool: { filters: {}, query: "" } },
      stats: { strategy: "balanced", freePoints: 0 },
      equipment: { weaponQuality: 0, armorQuality: 0, armorMinCount: 0, armorTypes: [], armorTypeCounts: {}, armorFillMode: "minimum", armorRandomExtraMax: 0, armorUuids: [], armorPool: { filters: {}, query: "" }, weaponPool: { filters: {}, query: "" } }
    });
    this.result = null;
    this.createResults = [];
    this.busy = false;
    this.progressText = "";
    this.dirty = true;
    this.requestSerial = 0;
    this._lastRawForm = null;
  }

  static DEFAULT_OPTIONS = {
    id: "xjzl-character-generator",
    tag: "form",
    classes: ["theme-dark", "character-generator-app"],
    position: { width: 1180, height: 820 },
    window: { title: "XJZL.CharacterGenerator.Title", icon: "fas fa-dice-d20", resizable: true },
    form: { submitOnChange: false, closeOnSubmit: false },
    actions: {
      generate: XJZLCharacterGeneratorApp.prototype._onGenerate,
      regenerate: XJZLCharacterGeneratorApp.prototype._onGenerate,
      createAll: XJZLCharacterGeneratorApp.prototype._onCreateAll,
      openBrowser: XJZLCharacterGeneratorApp.prototype._onOpenBrowser,
      clearResource: XJZLCharacterGeneratorApp.prototype._onClearResource
    }
  };

  static PARTS = {
    main: {
      template: "systems/xjzl-system/templates/apps/character-generator.hbs",
      scrollable: [".generator-config", ".generator-preview"]
    }
  };

  /** @returns {Promise<XJZLCharacterGeneratorApp|null>} GM 窗口实例。 */
  static async open(options = {}) {
    if (!game.user?.isGM) {
      ui.notifications.warn(game.i18n.localize("XJZL.CharacterGenerator.OnlyGM"));
      return null;
    }
    if (this._instance?.rendered) {
      this._instance.bringToFront?.();
      return this._instance;
    }
    const app = new this(options);
    this._instance = app;
    await app.render(true);
    return app;
  }

  async _prepareContext() {
    const draft = this.result?.drafts || [];
    const conflicts = draft.flatMap(entry => (entry.conflicts || []).map(conflict => ({
      ...conflict,
      draftName: entry.name,
      fieldLabel: CONFLICT_FIELD_LABELS[conflict.field] || conflict.field,
      expectedText: formatConflictValue(conflict.expected),
      actualText: formatConflictValue(conflict.actual)
    })));
    const fixedPreview = this.config.wuxue.fixedPreview;
    const primarySpecified = Boolean(this.config.wuxue.primary?.uuid || this.config.wuxue.fixed?.wuxue?.length);
    const neigongIndex = this.browser?.cachedData?.neigong || [];
    return {
      config: this.config,
      draft,
      conflicts,
      createResults: this.createResults,
      busy: this.busy,
      progressText: this.progressText,
      dirty: this.dirty,
      canCreate: !this.busy && !this.dirty && Boolean(this.result?.valid),
      primaryTier: this.config.wuxue.primary?.tier,
      primaryStage: this.config.wuxue.primary?.stage,
      primarySpecified,
      additionalGroups: (this.config.neigong.additionalGroups || []).map((group, index) => ({
        ...group,
        number: index + 1,
        resourceName: group.uuids?.map(uuid => neigongIndex.find(entry => entry.uuid === uuid)?.name || uuid).join("、") || ""
      })),
      rangeLabels: {
        neigong: this._rangeLabel(this.config.neigong.pool),
        wuxue: this._rangeLabel(this.config.wuxue.mainPool),
        armor: this._rangeLabel(this.config.equipment.armorPool),
        weapon: this._rangeLabel(this.config.equipment.weaponPool)
      },
      armorOptions: Object.entries(CONFIG.XJZL?.armorTypes || {}).map(([key, label]) => ({
        key,
        label: game.i18n.localize(label),
        checked: (this.config.equipment.armorTypes || []).includes(key),
        count: this.config.equipment.armorTypeCounts?.[key] || 1,
        max: ({ ring: 2, accessory: 6 })[key] || 1,
        multi: ["ring", "accessory"].includes(key)
      })),
      armorRequiredCount: Object.values(this.config.equipment.armorTypeCounts || {}).reduce((sum, count) => sum + count, 0),
      mainTierOptions: [
        { key: "1", label: game.i18n.localize("XJZL.CharacterGenerator.WuxueHuman"), count: this.config.wuxue.additionalTierCounts?.["1"] || 0 },
        { key: "2", label: game.i18n.localize("XJZL.CharacterGenerator.WuxueEarth"), count: this.config.wuxue.additionalTierCounts?.["2"] || 0 },
        { key: "3", label: game.i18n.localize("XJZL.CharacterGenerator.WuxueHeaven"), count: this.config.wuxue.additionalTierCounts?.["3"] || 0 }
      ],
      mainRandomMin: this.config.wuxue.additionalRandomMin,
      mainRandomMax: this.config.wuxue.additionalRandomMax,
      healingUuidsText: (this.config.wuxue.healingUuids || []).join(","),
      meridianOptions: Object.entries(CONFIG.XJZL?.acupoints || {}).map(([key, label]) => ({
        key, label, checked: (this.config.jingmai.fixed || []).includes(key)
      })),
      moveLocks: (fixedPreview?.system?.moves || []).filter(move => Number(move.progression?.mappedStage) !== 5)
        .map(move => ({ id: move.id, name: move.name, stage: this.config.wuxue.fixed?.moves?.[fixedPreview.uuid]?.[move.id] ?? "" }))
    };
  }

  _rangeLabel(range) {
    const count = Object.values(range?.filters || {}).reduce((sum, values) => sum + (values?.length || values?.size || 0), 0);
    return range?.query ? `搜索：${range.query}` : count ? `已设 ${count} 项筛选` : "全部资源";
  }

  _readForm() {
    const form = this.element;
    const value = name => form.elements?.[name]?.value;
    const checked = name => Boolean(form.elements?.[name]?.checked);
    const current = clone(this.config);
    current.namePrefix = value("namePrefix") || current.namePrefix;
    current.quantity = value("quantity");
    current.synergyProbability = value("synergyProbability");
    current.matchStandard = value("matchStandard");
    current.neigong.runTier = value("runTier") || null;
    current.neigong.runStage = value("runStage");
    current.neigong.runElement = value("runElement");
    const additionalCountValue = form.elements?.additionalCount?.value;
    current.neigong.additionalCount = additionalCountValue === "" ? 0 : additionalCountValue;
    current.neigong.additionalRandomMin = value("neigongAdditionalRandomMin");
    current.neigong.additionalRandomMax = value("neigongAdditionalRandomMax");
    const slotCount = Math.max(0, Math.min(10, Number(additionalCountValue) || 0));
    const previousGroups = current.neigong.additionalGroups || [];
    current.neigong.additionalGroups = Array.from({ length: slotCount }, (_, index) => {
      const groupElement = form.querySelector(`[data-neigong-group-index="${index}"]`);
      const previous = previousGroups[index] || {};
      return {
        id: groupElement?.dataset.neigongGroupId || previous.id || `additional-${index + 1}`,
        count: 1,
        tier: groupElement?.querySelector('[data-neigong-field="tier"]')?.value ?? previous.tier ?? null,
        stage: groupElement?.querySelector('[data-neigong-field="stage"]')?.value ?? previous.stage ?? null,
        uuids: previous.uuids || []
      };
    });
    current.neigong.supplementForJingmai = checked("supplementForJingmai");
    current.jingmai.mode = value("jingmaiMode");
    current.jingmai.total = value("jingmaiTotal");
    current.jingmai.yin = value("jingmaiYin");
    current.jingmai.yang = value("jingmaiYang");
    current.jingmai.fixed = [...form.querySelectorAll("[data-jingmai-fixed]:checked")].map(input => input.dataset.jingmaiFixed);
    current.jingmai.autoSupplement = checked("jingmaiAutoSupplement");
    current.jingmai.xuanguanBroken = checked("xuanguanBroken");
    current.wuxue.model = "primary";
    current.wuxue.primary ??= {};
    current.wuxue.primary.tier = value("primaryTier") || null;
    current.wuxue.primary.stage = value("primaryStage");
    const additionalTierCounts = {};
    for (const input of form.querySelectorAll("[data-main-tier-count]")) additionalTierCounts[input.dataset.mainTierCount] = input.value;
    current.wuxue.additionalTierCounts = additionalTierCounts;
    current.wuxue.mainTierCounts = additionalTierCounts;
    current.wuxue.mainCount = 1 + Object.values(additionalTierCounts).reduce((sum, count) => sum + (Number(count) || 0), 0);
    current.wuxue.additionalRandomMin = value("wuxueAdditionalRandomMin");
    current.wuxue.additionalRandomMax = value("wuxueAdditionalRandomMax");
    current.wuxue.mainRandomMin = current.wuxue.additionalRandomMin;
    current.wuxue.mainRandomMax = current.wuxue.additionalRandomMax;
    current.wuxue.mainStage = current.wuxue.primary.stage;
    current.wuxue.allocation = value("allocation");
    current.wuxue.sanshouCount = value("sanshouCount");
    current.wuxue.qinggongCount = value("qinggongCount");
    current.wuxue.zhenfaCount = value("zhenfaCount");
    current.wuxue.healingRequired = checked("healingRequired");
    current.wuxue.healingCount = value("healingCount");
    current.wuxue.healingUuids = String(value("healingUuids") || "")
      .split(",").map(uuid => uuid.trim()).filter(Boolean);
    current.wuxue.wuxingLimit = value("wuxingLimit");
    const fixedPreview = current.wuxue.fixedPreview;
    if (fixedPreview?.uuid) {
      const locks = {};
      for (const input of form.querySelectorAll("[data-move-lock]")) {
        if (input.value !== "") locks[input.dataset.moveLock] = Number(input.value);
      }
      current.wuxue.fixed ??= {};
      current.wuxue.fixed.moves ??= {};
      current.wuxue.fixed.moves[fixedPreview.uuid] = locks;
    }
    current.stats.strategy = value("statsStrategy");
    current.stats.freePoints = value("freePoints");
    current.wuxue.weaponType = value("weaponType");
    current.equipment.weaponQuality = value("weaponQuality");
    current.equipment.armorQuality = value("armorQuality");
    const armorTypes = [...form.querySelectorAll("[data-armor-type]:checked")].map(input => input.dataset.armorType);
    current.equipment.armorTypes = armorTypes;
    current.equipment.armorTypeCounts = Object.fromEntries(armorTypes.map(type => [
      type, form.querySelector(`[data-armor-type-count="${type}"]`)?.value || 1
    ]));
    // 保留原始文本给管理器做字段级校验；不能在 UI 层先截断小数或抬高到部位数量，
    // 否则 1.5、下限大于上限等输入会在到达规则层前失去错误信息。
    current.equipment.armorMinCount = value("armorMinCount");
    current.equipment.armorFillMode = value("armorFillMode");
    current.equipment.armorRandomExtraMax = value("armorRandomExtraMax");
    const armorUuidsValue = form.elements?.armorUuids?.value;
    if (armorUuidsValue !== undefined) {
      current.equipment.armorUuids = String(armorUuidsValue)
        .split(",").map(uuid => uuid.trim()).filter(Boolean);
    }
    this._lastRawForm = clone(current);
    return current;
  }

  /**
   * Read the form for UI state transitions; validation must still receive the raw values from _readForm().
   * @returns {object} normalized generation configuration
   */
  _readNormalizedForm() {
    return normalizeGenerationConfig(this._readForm());
  }

  async _onGenerate(event) {
    event?.preventDefault();
    if (this.busy) return;
    const rawConfig = this._readForm();
    this.config = normalizeGenerationConfig(rawConfig);
    this.config.requestId = `${Date.now()}-${++this.requestSerial}`;
    rawConfig.requestId = this.config.requestId;
    const requestConfig = clone(rawConfig);
    const requestId = this.config.requestId;
    this.busy = true;
    this.dirty = true;
    this.result = null;
    this.createResults = [];
    this.progressText = game.i18n.localize("XJZL.CharacterGenerator.LoadingBrowser");
    // 读取合集时只更新状态文本，不重渲整张配置表；全量 Handlebars 重渲会放大首次批量取文档的延迟。
    await this.render();
    try {
      const snapshot = await this.manager.snapshot(requestConfig, {
        onProgress: phase => {
          const labels = {
            browser: "LoadingBrowser",
            neigong: "LoadingNeigong",
            wuxue: "LoadingWuxue",
            ready: "Generating"
          };
          this.progressText = game.i18n.localize(`XJZL.CharacterGenerator.${labels[phase] || "Loading"}`);
          const progress = this.element?.querySelector("[data-progress-text]");
          if (progress) progress.textContent = this.progressText;
        }
      });
      if (requestId !== this.config.requestId) return;
      this.progressText = game.i18n.localize("XJZL.CharacterGenerator.Generating");
      const progress = this.element?.querySelector("[data-progress-text]");
      if (progress) progress.textContent = this.progressText;
      const result = await this.manager.generate(snapshot);
      if (requestId !== this.config.requestId) return;
      this.result = result;
      this.dirty = false;
    } catch (error) {
      console.error("XJZL | 随机人物生成失败:", error);
      ui.notifications.error(`随机人物生成失败：${error.message || error}`);
    } finally {
      if (requestId === this.config.requestId) {
        this.busy = false;
        this.progressText = "";
        this.render();
      }
    }
  }

  async _onCreateAll(event) {
    event?.preventDefault();
    if (this.busy || this.dirty || !this.result?.valid) return;
    this.busy = true;
    this.render();
    try {
      this.createResults = await this.manager.createAll(this.result.drafts);
      for (const result of this.createResults) {
        if (result.status === "success") result.actor?.sheet?.render(true);
      }
      // Actor.create 已更新 game.actors，但 V14 目录的当前 DOM 不一定会主动重绘；
      // 这里显式刷新目录，确保批量生成完成后 GM 能立即看到新文件夹和 NPC。
      await globalThis.ui?.actors?.render?.(false);
    } catch (error) {
      console.error("XJZL | 随机人物创建失败:", error);
      ui.notifications.error(`创建随机 NPC 失败：${error.message || error}`);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  /**
   * 打开生成器专用的资源选择器；共享万卷阁的索引和纯内存筛选引擎，避免改变浏览器自身状态。
   */
  async _onOpenBrowser(event, target) {
    event?.preventDefault();
    // 生成请求使用冻结快照；生成期间禁止打开资源选择器，避免选择器回调把新配置
    // 写回界面而旧草案随后以 dirty=false 重新获得创建资格。
    if (this.busy) {
      globalThis.ui?.notifications?.warn?.("随机人物正在生成，完成前不能修改生成资源。");
      return;
    }
    // 资源选择器会独立渲染生成器；先读取当前表单，避免打开选择器前丢失刚改的槽位、数量或筛选设置。
    this.config = this._readNormalizedForm();
    const browser = this.browser || game.xjzl?.compendiumBrowser;
    if (!browser) return ui.notifications.warn(game.i18n.localize("XJZL.CompendiumBrowser.State.Loading"));
    const kind = target.dataset.kind;
    const tab = target.dataset.type;
    const rangePath = kind.endsWith("Range")
      ? kind === "neigongRange" ? "neigong.pool"
        : kind === "wuxueRange" ? "wuxue.mainPool"
          : kind === "armorRange" ? "equipment.armorPool" : "equipment.weaponPool"
      : null;
    const currentRange = rangePath ? rangePath.split(".").reduce((value, key) => value?.[key], this.config) : {};
    const onSelect = async selection => {
      // 选择器可能在生成开始前已经打开；回调时再次检查，不能让旧请求与新选择交叉提交。
      if (this.busy) {
        globalThis.ui?.notifications?.warn?.("随机人物正在生成，完成前不能修改生成资源。");
        return;
      }
        if (selection.mode === "range") {
          const [owner, key] = rangePath.split(".");
          this.config[owner][key] = selection.range;
        } else if (kind === "run") this.config.neigong.runUuid = selection.uuid;
        else if (kind === "primary" || kind === "main") {
          this.config.wuxue.primary ??= {};
          this.config.wuxue.primary.uuid = selection.uuid;
          this.config.wuxue.fixed ??= {};
          this.config.wuxue.fixed.wuxue = [selection.uuid];
          this.config.wuxue.fixedPreview = selection.item;
        } else if (kind === "weapon") this.config.equipment.weaponUuid = selection.uuid;
        else if (kind === "armor") this.config.equipment.armorUuids = [...new Set([...(this.config.equipment.armorUuids || []), selection.uuid])];
        else if (kind === "healing") this.config.wuxue.healingUuids = [...new Set([...(this.config.wuxue.healingUuids || []), selection.uuid])];
        else if (["sanshou", "qinggong", "zhenfa"].includes(kind)) {
          this.config.wuxue.fixed ??= {};
          this.config.wuxue.fixed[kind] = [...new Set([...(this.config.wuxue.fixed[kind] || []), selection.uuid])];
        }
        else if (kind.startsWith("additional-")) {
          const index = Number(kind.split("-").at(-1));
          const group = this.config.neigong.additionalGroups?.[index];
          // 一个数量槽位对应一门内功；再次选择时替换旧值，避免“2 个槽位”被单个槽位塞入多门内功。
          if (group) group.uuids = [selection.uuid];
        }
        this.dirty = true;
        this.result = null;
        this.render();
    };
    await XJZLCharacterResourcePickerApp.open({
      browser,
      tab,
      mode: rangePath ? "range" : "resource",
      initialRange: currentRange,
      onSelect
    });
  }

  /**
   * 清除可重复追加的指定资源，让该分类恢复为随机/未指定状态。
   * @param {Event} event - Foundry action 事件。
   * @param {HTMLElement} target - 带 data-kind 的清除按钮。
   * @returns {void}
   */
  _onClearResource(event, target) {
    event?.preventDefault();
    if (this.busy) return;
    const kind = target?.dataset?.kind;
    // 清除动作发生在表单事件之外；先把当前 DOM 输入同步回配置，避免重绘时覆盖
    // GM 尚未触发 change 的数量、自由点等修改。
    this.config = this._readNormalizedForm();
    if (kind === "armor") this.config.equipment.armorUuids = [];
    else if (["sanshou", "qinggong", "zhenfa"].includes(kind)) this.config.wuxue.fixed[kind] = [];
    else return;
    this.result = null;
    this.dirty = true;
    this.render();
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const createButton = this.element.querySelector('[data-action="createAll"]');
    if (createButton) createButton.disabled = this.busy || this.dirty || !this.result?.valid;
    if (this.element.hasAttribute("data-generator-bound")) return;
    const markDirty = event => {
      if (this.busy) return;
      if (event.type === "change" && event.target.matches?.("[data-armor-type], [data-armor-type-count], [name=armorFillMode]")) {
        const selectedCount = [...this.element.querySelectorAll("[data-armor-type]:checked")].reduce((sum, input) => {
          const count = this.element.querySelector(`[data-armor-type-count="${input.dataset.armorType}"]`)?.value;
          return sum + Math.max(1, Number(count) || 1);
        }, 0);
        const minInput = this.element.querySelector('[name="armorMinCount"]');
        if (minInput) {
          minInput.min = String(selectedCount);
        }
        if (event.target.matches("[data-armor-type], [name=armorFillMode]")) {
          this.config = this._readNormalizedForm();
          this.result = null;
          this.dirty = true;
          this.render();
          return;
        }
      }
      if (event.type === "change" && event.target.matches?.("[data-additional-count]")) {
        this.config = this._readNormalizedForm();
        this.result = null;
        this.dirty = true;
        this.render();
        return;
      }
      const slider = event.target.closest?.("[data-match-slider]");
      if (slider) {
        const output = this.element.querySelector("[data-match-value]");
        if (output) output.textContent = `${slider.value}%`;
      }
      this.dirty = true;
      const button = this.element.querySelector('[data-action="createAll"]');
      if (button) button.disabled = true;
    };
    this.element.addEventListener("input", markDirty);
    this.element.addEventListener("change", markDirty);
    this.element.setAttribute("data-generator-bound", "true");
  }
}
