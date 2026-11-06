const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function toFilterSets(filters = {}) {
  return Object.fromEntries(Object.entries(filters).map(([key, values]) => [key, new Set(values || [])]));
}

/**
 * 生成器专用资源选择器：固定资源类型，复用万卷阁的索引、筛选器和卡片摘要，
 * 但不接管万卷阁窗口状态，也不暴露分类切换、随机抽取或宏导出动作。
 * @param {{browser: object, tab: string, mode: "range"|"resource", initialRange?: object, onSelect?: Function}} options
 */
export class XJZLCharacterResourcePickerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.browser = options.browser;
    this.tab = options.tab;
    this.mode = options.mode || "resource";
    this.onSelect = options.onSelect;
    this.query = options.initialRange?.query || "";
    this.filters = toFilterSets(options.initialRange?.filters);
    this.busy = false;
    this.visibleCount = 60;
    this._searchTimer = null;
  }

  static DEFAULT_OPTIONS = {
    id: "xjzl-character-resource-picker",
    tag: "div",
    classes: ["theme-dark", "character-resource-picker-app"],
    position: { width: 900, height: 650 },
    window: {
      title: "XJZL.CharacterGenerator.ResourcePickerTitle",
      icon: "fas fa-filter",
      resizable: true
    },
    actions: {
      applyRange: XJZLCharacterResourcePickerApp.prototype._onApplyRange,
      selectResource: XJZLCharacterResourcePickerApp.prototype._onSelectResource,
      resetFilters: XJZLCharacterResourcePickerApp.prototype._onResetFilters,
      loadMore: XJZLCharacterResourcePickerApp.prototype._onLoadMore
    }
  };

  static PARTS = {
    main: {
      template: "systems/xjzl-system/templates/apps/character-resource-picker.hbs",
      scrollable: [".resource-picker-results", ".resource-picker-filters"]
    }
  };

  /** @returns {Promise<XJZLCharacterResourcePickerApp>} 已打开的选择器。 */
  static async open(options = {}) {
    if (!options.browser?.isLoaded) await options.browser?.loadData?.();
    const app = new this(options);
    await app.render(true);
    return app;
  }

  async _prepareContext() {
    const rawItems = this.browser.cachedData?.[this.tab] || [];
    const filterState = { searchQuery: this.query, filters: this.filters };
    const filteredItems = this.browser._filterItems(rawItems, this.filters, this.query);
    const displayItems = filteredItems.slice(0, this.visibleCount).map(item => this.browser._buildCardData(item));
    const filterList = this.browser._buildFilterGroups(this.tab, filterState, rawItems);
    const tabLabel = game.i18n.localize(`TYPES.Item.${this.tab}`) || this.tab;
    return {
      mode: this.mode,
      tabLabel,
      hint: this.mode === "range"
        ? game.i18n.localize("XJZL.CharacterGenerator.ResourcePickerRangeHint")
        : game.i18n.localize("XJZL.CharacterGenerator.ResourcePickerResourceHint"),
      searchQuery: this.query,
      filterList,
      items: displayItems,
      resultCount: filteredItems.length,
      hasMore: filteredItems.length > displayItems.length,
      displayedCount: displayItems.length,
      busy: this.busy
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (this.element.hasAttribute("data-picker-bound")) return;
    this.element.addEventListener("input", event => {
      if (event.target.matches("[data-picker-search]")) {
        this.query = event.target.value;
        this.visibleCount = 60;
        const caret = event.target.selectionStart;
        // 过滤是内存计算，但仍延迟重绘以避免每个按键都重建卡片网格，并恢复光标位置。
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(async () => {
          await this.render();
          const input = this.element.querySelector("[data-picker-search]");
          input?.focus();
          if (input && caret != null) input.setSelectionRange(caret, caret);
        }, 160);
      }
    });
    this.element.addEventListener("change", event => {
      const input = event.target.closest("[data-picker-filter]");
      if (!input) return;
      const key = input.dataset.pickerFilter;
      const values = this.filters[key] ||= new Set();
      if (input.checked) values.add(input.value);
      else values.delete(input.value);
      this.visibleCount = 60;
      this.render();
    });
    this.element.setAttribute("data-picker-bound", "true");
  }

  async _onResetFilters(event) {
    event?.preventDefault();
    this.query = "";
    this.filters = {};
    this.visibleCount = 60;
    await this.render();
  }

  async _onLoadMore(event) {
    event?.preventDefault();
    if (this.busy) return;
    this.visibleCount += 60;
    await this.render();
  }

  async close(options) {
    clearTimeout(this._searchTimer);
    this._searchTimer = null;
    return super.close(options);
  }

  async _onApplyRange(event) {
    event?.preventDefault();
    if (this.busy || this.mode !== "range") return;
    this.busy = true;
    await this.onSelect?.({
      mode: "range",
      tab: this.tab,
      range: {
        filters: Object.fromEntries(Object.entries(this.filters).map(([key, values]) => [key, [...values]])),
        query: this.query
      }
    });
    await this.close();
  }

  async _onSelectResource(event, target) {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.busy || this.mode !== "resource") return;
    const item = await fromUuid(target.dataset.uuid);
    if (!item) {
      ui.notifications.warn(game.i18n.localize("XJZL.CharacterGenerator.SelectFailed"));
      return;
    }
    this.busy = true;
    await this.onSelect?.({
      mode: "resource",
      tab: this.tab,
      uuid: item.uuid,
      item: { ...(item.toObject?.() || item), uuid: item.uuid }
    });
    await this.close();
  }
}
