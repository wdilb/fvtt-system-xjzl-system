/**
 * ==============================================================================
 *  XJZL 江湖万卷阁 (Compendium Browser) - V13 Optimized
 * ==============================================================================
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const renderTemplate = foundry.applications.handlebars.renderTemplate;

/** 初屏渲染条数、增量加载步长与 DOM 追加软上限（超出提示用筛选缩小范围）。 */
const INITIAL_PAGE = 60;
const PAGE_STEP = 60;
const MAX_RENDER = 500;

export class XJZLCompendiumBrowser extends HandlebarsApplicationMixin(ApplicationV2) {

    constructor(options) {
        super(options);

        /** @type {Object<string, Array>} 缓存所有索引数据，按 Tab 分类 */
        this.cachedData = {};

        /** @type {boolean} 数据是否加载完毕 */
        this.isLoaded = false;

        /** @type {Object} UI 交互状态（筛选/搜索/分页按 Tab 独立，排序/视图全局持久化） */
        this.browserState = {
            activeTab: "weapon",
            tabs: {},
            sortBy: "name",
            viewMode: "compact"
        };
        // 为每个 Tab 预建独立状态桶：切换分类时各自记住搜索/筛选与已加载页数
        XJZLCompendiumBrowser.TABS.forEach(t => {
            this.browserState.tabs[t.id] = { searchQuery: "", filters: {}, visibleCount: INITIAL_PAGE };
        });
        // 读取客户端持久化的排序/视图偏好（设置未注册时保持默认）
        for (const [key, setting] of [["sortBy", "compendiumBrowserSort"], ["viewMode", "compendiumBrowserView"]]) {
            try { this.browserState[key] = game.settings.get("xjzl-system", setting); }
            catch { /* 设置未就绪时使用默认值 */ }
        }
        // 防御：旧版本残留的非法值（如已移除的 tier-desc/price-desc/none）回退默认，避免 UI 与状态错位
        if (!["name", "quality-desc", "quality-asc"].includes(this.browserState.sortBy)) {
            this.browserState.sortBy = "name";
        }
        if (!["compact", "grid"].includes(this.browserState.viewMode)) {
            this.browserState.viewMode = "compact";
        }

        // 防抖搜索：200ms 延迟，避免输入过快导致频繁计算
        this._debouncedSearch = foundry.utils.debounce(this._performSearch.bind(this), 200);
    }

    /* -------------------------------------------- */
    /*  状态访问                                    */
    /* -------------------------------------------- */

    /**
     * 当前 Tab 的独立状态桶（懒创建兜底，兼容外部直接写入）。
     */
    get _currentTabState() {
        const { activeTab } = this.browserState;
        // tabs 桶在构造函数已预建；此处兜底防外部意外覆盖空对象
        this.browserState.tabs[activeTab] ??= { searchQuery: "", filters: {}, visibleCount: INITIAL_PAGE };
        return this.browserState.tabs[activeTab];
    }

    /** 当前 Tab 的筛选集合（{ key: Set<value> }），供过滤引擎与随机抽取读取。 */
    get _filters() { return this._currentTabState.filters; }

    /** 当前 Tab 的搜索词。 */
    get _searchQuery() { return this._currentTabState.searchQuery; }

    /**
     * 供外部（如建卡向导）按 Tab 注入初始筛选并切换到该 Tab。
     * @param {string} tab Tab id（export 时用 item type）
     * @param {Object<string, Set>} filters 初始筛选集合
     */
    applyTabState(tab, filters) {
        this.browserState.activeTab = tab;
        const state = this.browserState.tabs[tab] ??= { searchQuery: "", filters: {}, visibleCount: INITIAL_PAGE };
        state.filters = filters || {};
        state.searchQuery = "";
        state.visibleCount = INITIAL_PAGE;
    }

    static DEFAULT_OPTIONS = {
        tag: "div",
        id: "xjzl-compendium-browser",
        classes: ["compendium-browser", "theme-dark"],
        position: { width: 950, height: 750 },
        window: {
            title: "XJZL.CompendiumBrowser.Draw.CinematicBrand",
            icon: "fas fa-book-open",
            resizable: true
        },
        // 利用 AppV2 的 actions 映射处理点击事件，比手动绑定更高效
        actions: {
            refresh: XJZLCompendiumBrowser.prototype.refreshData,
            changeTab: XJZLCompendiumBrowser.prototype._onChangeTab,
            openSheet: XJZLCompendiumBrowser.prototype._onOpenSheet,
            resetFilters: XJZLCompendiumBrowser.prototype._onResetFilters,
            randomize: XJZLCompendiumBrowser.prototype._onRandomizeClick,
            toggleView: XJZLCompendiumBrowser.prototype._onToggleView,
            loadMore: XJZLCompendiumBrowser.prototype._loadMore
        }
    };

    static PARTS = {
        navigation: { template: "systems/xjzl-system/templates/apps/compendiumbrowser/navigation.hbs" },
        sidebar: {
            template: "systems/xjzl-system/templates/apps/compendiumbrowser/sidebar.hbs",
            scrollable: [".xjzl-sidebar-content"]
        },
        content: {
            template: "systems/xjzl-system/templates/apps/compendiumbrowser/content.hbs",
            scrollable: [".xjzl-content-content"]
        }
    };

    static TABS = [
        { id: "weapon", label: "TYPES.Item.weapon", icon: "fas fa-sword" },
        { id: "armor", label: "TYPES.Item.armor", icon: "fas fa-tshirt" },
        { id: "consumable", label: "TYPES.Item.consumable", icon: "fas fa-flask" },
        { id: "misc", label: "TYPES.Item.misc", icon: "fas fa-box-open" },
        { id: "qizhen", label: "TYPES.Item.qizhen", icon: "fas fa-gem" },
        { id: "wuxue", label: "TYPES.Item.wuxue", icon: "fas fa-fist-raised" },
        { id: "neigong", label: "TYPES.Item.neigong", icon: "fas fa-yin-yang" },
        { id: "art_book", label: "TYPES.Item.art_book", icon: "fas fa-book" },
        { id: "trait", label: "TYPES.Item.trait", icon: "fas fa-seedling" },
    ];

    static INDEX_FIELDS = [
        "img", "system.quantity", "system.price", "system.quality",
        "system.type", "system.subtype", "system.tier",
        "system.sect", "system.subSect", "system.element", "system.category",
        "system.moves", "system.artType", "system.damageType", "system.weaponType",
        "system.isOfficial"
    ];

    /**
     * 获取筛选器配置
     */
    get filterConfig() {
        const C = CONFIG.XJZL;
        const elemOpts = {
            taiji: "XJZL.CompendiumBrowser.Filter.ElementTaiji",
            yin: "XJZL.CompendiumBrowser.Filter.ElementYin",
            yang: "XJZL.CompendiumBrowser.Filter.ElementYang",
            gang: "XJZL.CompendiumBrowser.Filter.ElementGang",
            rou: "XJZL.CompendiumBrowser.Filter.ElementRou",
            none: "XJZL.CompendiumBrowser.Filter.ElementNone"
        };
        const neigongOpts = {
            taiji: "XJZL.CompendiumBrowser.Filter.ElementTaiji",
            yin: "XJZL.CompendiumBrowser.Filter.NeigongYin",
            yang: "XJZL.CompendiumBrowser.Filter.NeigongYang"
        };
        const officialOpts = {
            "true": "XJZL.CompendiumBrowser.Filter.OfficialYes",
            "false": "XJZL.CompendiumBrowser.Filter.OfficialNo"
        };
        const config = {
            weapon: [
                { key: "type", label: "XJZL.CompendiumBrowser.Filter.WeaponType", type: "checkbox", options: C.weaponTypes },
                { key: "quality", label: "XJZL.Qualities.Label", type: "checkbox", options: C.qualities },
            ],
            armor: [
                { key: "type", label: "XJZL.CompendiumBrowser.Filter.ArmorType", type: "checkbox", options: C.armorTypes },
                { key: "quality", label: "XJZL.Qualities.Label", type: "checkbox", options: C.qualities }
            ],
            consumable: [
                { key: "type", label: "XJZL.CompendiumBrowser.Filter.Category", type: "checkbox", options: C.consumableTypes },
                { key: "quality", label: "XJZL.Qualities.Label", type: "checkbox", options: C.qualities }
            ],
            misc: [{ key: "quality", label: "XJZL.Qualities.Label", type: "checkbox", options: C.qualities }],
            qizhen: [{ key: "quality", label: "XJZL.Qualities.Label", type: "checkbox", options: C.qualities }],
            wuxue: [
                { key: "sect", label: "XJZL.CompendiumBrowser.Filter.Sect", type: "checkbox", options: C.sects },
                { key: "subSect", label: "XJZL.CompendiumBrowser.Filter.SubSect", type: "checkbox", options: C.subSects },
                { key: "category", label: "XJZL.CompendiumBrowser.Filter.WuxueCategory", type: "checkbox", options: C.wuxueCategories },
                { key: "tier", label: "XJZL.CompendiumBrowser.Filter.WuxueTier", type: "checkbox", options: C.tiers },
                { key: "element", label: "XJZL.CompendiumBrowser.Filter.WuxueElement", type: "checkbox", options: elemOpts },
                { key: "damageType", label: "XJZL.CompendiumBrowser.Filter.DamageType", type: "checkbox", options: C.damageTypes },
                { key: "weaponType", label: "XJZL.CompendiumBrowser.Filter.WeaponRequirement", type: "checkbox", options: C.weaponTypes }
            ],
            neigong: [
                { key: "sect", label: "XJZL.CompendiumBrowser.Filter.Sect", type: "checkbox", options: C.sects },
                { key: "subSect", label: "XJZL.CompendiumBrowser.Filter.SubSect", type: "checkbox", options: C.subSects },
                { key: "tier", label: "XJZL.CompendiumBrowser.Filter.NeigongTier", type: "checkbox", options: C.tiers },
                { key: "element", label: "XJZL.CompendiumBrowser.Filter.NeigongElement", type: "checkbox", options: neigongOpts }
            ],
            art_book: [{ key: "artType", label: "XJZL.CompendiumBrowser.Filter.ArtType", type: "checkbox", options: C.arts }],
            trait: [
                { key: "type", label: "XJZL.CompendiumBrowser.Filter.TraitType", type: "checkbox", options: C.traitTypes }
            ]
        };

        for (const tab in config) {
            config[tab].unshift({
                key: "isOfficial",
                label: "XJZL.CompendiumBrowser.Filter.Official",
                type: "checkbox",
                options: officialOpts
            });
        }

        return config;
    }

    /* -------------------------------------------- */
    /*  数据加载                                     */
    /* -------------------------------------------- */

    async loadData() {
        ui.notifications.info(game.i18n.localize("XJZL.CompendiumBrowser.State.Loading"));

        // 重置缓存
        const tempCache = {};
        XJZLCompendiumBrowser.TABS.forEach(t => tempCache[t.id] = []);

        const targetPacks = game.packs.filter(p => p.metadata.type === "Item" && p.metadata.system === "xjzl-system");

        const loadPackIndex = async (pack) => {
            try {
                const index = await pack.getIndex({ fields: XJZLCompendiumBrowser.INDEX_FIELDS });
                for (const entry of index) {
                    // 预先将UUID和搜索名称缓存，避免搜索循环中重复计算
                    if (tempCache[entry.type]) {
                        entry.uuid = entry.uuid || `Compendium.${pack.collection}.${entry._id}`;
                        // 预计算组合搜索串：名称 + 来源包名 + 关键字段，武学/内功额外涵盖招式名与属性，
                        // 让"搜索名称"可以同时命中门派、属性、伤害类型等词，且只在加载时算一次。
                        const searchParts = [entry.name, pack.metadata.label];
                        const sys = entry.system ?? {};
                        for (const key of ["type", "subtype", "sect", "subSect", "element", "category", "artType", "damageType", "weaponType"]) {
                            if (sys[key]) searchParts.push(sys[key]);
                        }
                        if (Array.isArray(sys.moves)) {
                            for (const move of sys.moves) {
                                if (move?.name) searchParts.push(move.name);
                                for (const key of ["element", "damageType", "weaponType"]) {
                                    if (move[key]) searchParts.push(move[key]);
                                }
                            }
                        }
                        entry._searchName = searchParts.filter(Boolean).join(" ").toLowerCase();
                        entry.packLabel = pack.metadata.label;
                        if (entry.system) {
                            // 如果底层数据没有 isOfficial，默认视为 true (官方资源)
                            entry.system.isOfficial = entry.system.isOfficial ?? true;
                        }
                        tempCache[entry.type].push(entry);
                    }
                }
            } catch (err) { console.error(`XJZL Browser | Pack Load Error: ${pack.collection}`, err); }
        };

        await Promise.all(targetPacks.map(pack => loadPackIndex(pack)));

        // 按名称排序，提升浏览体验
        for (const key in tempCache) {
            tempCache[key].sort((a, b) => a.name.localeCompare(b.name, "zh"));
        }

        this.cachedData = tempCache;
        this.isLoaded = true;
        ui.notifications.info(game.i18n.localize("XJZL.CompendiumBrowser.State.LoadComplete"));

        if (this.rendered) this.render();
    }

    async refreshData() {
        this.isLoaded = false;
        this.render(); // 显示 loading 状态
        await this.loadData();
    }

    /* -------------------------------------------- */
    /*  事件处理                                    */
    /* -------------------------------------------- */

    _onRender(context, options) {
        super._onRender(context, options);

        const html = this.element;

        // A. 一次性委托监听（守卫内）：input/change/dragstart/keydown 均为根级委托，
        //    partial 重渲（content 部分）后依然有效，无需重复绑定。
        if (!html.hasAttribute("data-listeners-ready")) {

            // 1. 搜索框 (Input 事件无法通过 actions 处理)
            html.addEventListener("input", (event) => {
                if (event.target.name === "search") this._onSearch(event);
            });

            // 2. 筛选器与排序下拉 (Change 事件)
            html.addEventListener("change", (event) => {
                if (event.target.classList.contains("xjzl-filter-checkbox")) this._onFilterChange(event);
                else if (event.target.name === "sortBy") this._onSortChange(event);
            });

            // 3. 拖拽代理 (Drag Delegation)
            html.addEventListener("dragstart", (event) => {
                const card = event.target.closest(".xjzl-cb-card");
                if (!card?.dataset.dragData) return;

                event.dataTransfer.setData("text/plain", card.dataset.dragData);
                event.dataTransfer.effectAllowed = "copy";
            });

            // 4. 卡片键盘导航（方向键移动焦点，Enter/Space 打开）
            html.addEventListener("keydown", (event) => {
                if (event.target.classList?.contains("xjzl-cb-card")) this._onCardKeydown(event);
            });

            html.setAttribute("data-listeners-ready", "true");
        }

        // B. 每次 content 部分渲染后重新挂载哨兵观察器：
        //    content 重渲会重建哨兵节点，旧观察器指向的节点已脱离 DOM，必须先断开再观察新哨兵。
        if (options?.parts === undefined || options.parts.includes("content")) {
            this._setupSentinelObserver();
        }
    }

    /**
     * 将 IntersectionObserver 挂到当前哨兵节点（若存在）。
     * 哨兵进入可视区时触发 _loadMore 增量追加。
     */
    _setupSentinelObserver() {
        this._sentinelObserver?.disconnect();
        this._sentinelObserver = null;
        const sentinel = this.element.querySelector(".xjzl-cb-sentinel");
        if (!sentinel || typeof IntersectionObserver === "undefined") return;
        const root = this.element.querySelector(".xjzl-content-content");
        this._sentinelObserver = new IntersectionObserver(
            entries => {
                if (entries.some(entry => entry.isIntersecting)) this._loadMore();
            },
            { root, rootMargin: "160px" }
        );
        this._sentinelObserver.observe(sentinel);
    }

    /**
     * 卡片键盘导航：方向键在网格内移动焦点，Enter/Space 打开物品。
     * 不处理 Esc——Esc 留给 Foundry 窗口默认关闭行为，避免拦截破坏关窗。
     */
    _onCardKeydown(event) {
        const card = event.target;
        const key = event.key;

        if (key === "Enter" || key === " ") {
            event.preventDefault();
            this._onOpenSheet(null, card);
            return;
        }
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) return;
        event.preventDefault();

        const grid = card.closest(".xjzl-cb-grid");
        if (!grid) return;
        const cards = Array.from(grid.querySelectorAll(".xjzl-cb-card"));
        const index = cards.indexOf(card);
        if (index === -1) return;

        if (key === "ArrowLeft" || key === "ArrowRight") {
            const next = key === "ArrowLeft" ? index - 1 : index + 1;
            cards[next]?.focus();
            return;
        }

        // 上下：在同一行带之外、横向中心距离最近的卡片视为上/下一行邻居
        const rect = card.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const dir = key === "ArrowDown" ? 1 : -1;
        let best = null;
        let bestDist = Infinity;
        for (const other of cards) {
            if (other === card) continue;
            const r = other.getBoundingClientRect();
            const isAcross = dir === 1 ? r.top >= rect.bottom - 8 : r.bottom <= rect.top + 8;
            if (!isAcross) continue;
            const dist = Math.abs((r.left + r.width / 2) - centerX);
            if (dist < bestDist) { bestDist = dist; best = other; }
        }
        best?.focus();
    }

    _onChangeTab(event, target) {
        const newTab = target.dataset.tab;
        if (newTab && newTab !== this.browserState.activeTab) {
            this.browserState.activeTab = newTab;
            // 各 Tab 的筛选/搜索独立保留；仅分页位置回到初屏，保持"进入分类从头浏览"的直觉
            this._currentTabState.visibleCount = INITIAL_PAGE;
            this.render(); // 全量刷新
        }
    }

    _onSearch(event) {
        event.preventDefault();
        // 传入原始值，防抖函数会处理
        this._debouncedSearch(event.target.value.trim());
    }

    _performSearch(query) {
        if (query !== this._searchQuery) {
            const state = this._currentTabState;
            state.searchQuery = query;
            state.visibleCount = INITIAL_PAGE; // 搜索变化回到初屏
            // 局部刷新：只更新内容区，保持侧边栏状态和光标
            this.render({ parts: ["content"] });
        }
    }

    async _onOpenSheet(event, target) {
        event?.stopPropagation(); // 键盘触达时无 event
        const item = await fromUuid(target.dataset.uuid);
        if (item) item.sheet.render(true);
    }

    _onFilterChange(event) {
        const target = event.target;
        const labelElement = target.closest(".checkbox-label");

        // 视觉反馈：手动操作 DOM class，避免侧边栏重绘导致交互中断
        if (labelElement) {
            labelElement.classList.toggle("checked", target.checked);
        }

        const filterKey = target.dataset.filter;
        const value = target.value;
        const isChecked = target.checked;
        const state = this._currentTabState;

        if (!state.filters[filterKey]) {
            state.filters[filterKey] = new Set();
        }

        const filterSet = state.filters[filterKey];
        if (isChecked) filterSet.add(value);
        else {
            filterSet.delete(value);
            if (filterSet.size === 0) delete state.filters[filterKey];
        }

        state.visibleCount = INITIAL_PAGE;
        this.render({ parts: ["content"] });
    }

    _onResetFilters() {
        const state = this._currentTabState;
        state.searchQuery = "";
        state.filters = {};
        state.visibleCount = INITIAL_PAGE;

        // DOM 操作重置视觉状态
        const input = this.element.querySelector("input[name='search']");
        if (input) input.value = "";

        const activeLabels = this.element.querySelectorAll(".checkbox-label.checked");
        activeLabels.forEach(label => {
            label.classList.remove("checked");
            const checkbox = label.querySelector("input");
            if (checkbox) checkbox.checked = false;
        });

        this.render({ parts: ["content"] });
    }

    /**
     * 排序下拉变化：更新全局排序偏好并持久化（仅本地客户端），重置分页后重渲内容。
     */
    _onSortChange(event) {
        const sortBy = event.target.value;
        if (sortBy === this.browserState.sortBy) return;
        this.browserState.sortBy = sortBy;
        this._currentTabState.visibleCount = INITIAL_PAGE;
        game.settings.set("xjzl-system", "compendiumBrowserSort", sortBy).catch(err => {
            console.warn("XJZL | 排序偏好持久化失败", err);
        });
        this.render({ parts: ["content"] });
    }

    /**
     * 视图切换（compact 简洁列表 / grid 图鉴网格）：更新偏好并持久化，重置分页后重渲内容。
     */
    _onToggleView(event, target) {
        const viewMode = target.dataset.view;
        if (viewMode === this.browserState.viewMode) return;
        this.browserState.viewMode = viewMode;
        this._currentTabState.visibleCount = INITIAL_PAGE;
        game.settings.set("xjzl-system", "compendiumBrowserView", viewMode).catch(err => {
            console.warn("XJZL | 视图偏好持久化失败", err);
        });
        this.render({ parts: ["content"] });
    }

    /**
     * 追加下一页卡片。
     * 只渲染"新增切片"并插入哨兵之前，避免整块 content 重渲（那样会丢失滚动位置）；
     * 统计条的"已显示前 N 件"随之就地更新。
     */
    async _loadMore() {
        if (this._loadingMore) return;
        const tab = this.browserState.activeTab;
        const state = this._currentTabState;
        const rawItems = this.cachedData[tab] || [];
        const sorted = this._sortItems(this._filterItems(rawItems));
        const current = state.visibleCount;
        if (current >= sorted.length || current >= MAX_RENDER) return;

        this._loadingMore = true;
        try {
            const next = Math.min(current + PAGE_STEP, sorted.length, MAX_RENDER);
            state.visibleCount = next;

            const slice = sorted.slice(current, next).map(item => this._buildCardData(item));
            const html = await renderTemplate(
                "systems/xjzl-system/templates/apps/compendiumbrowser/card-list.hbs",
                { items: slice, viewMode: this.browserState.viewMode }
            );

            // 追加渲染期间 Tab/筛选/搜索/排序变化会整块重渲并重置 visibleCount；
            // 此时旧切片的插入目标已消失，丢弃追加并回滚页数，避免污染新网格。
            if (this.browserState.activeTab !== tab || state.visibleCount !== next) {
                state.visibleCount = current;
                return;
            }

            const grid = this.element.querySelector(".xjzl-cb-grid");
            const sentinel = this.element.querySelector(".xjzl-cb-sentinel");
            if (!grid || !sentinel) return;
            sentinel.insertAdjacentHTML("beforebegin", html);

            this._updatePagerUI(sorted.length, next);
        } finally {
            this._loadingMore = false;
        }
    }

    /**
     * 就地更新统计条"已显示前 N 件"；全部加载或触达软上限时用完成/上限提示替换哨兵。
     */
    _updatePagerUI(total, shown) {
        const statsShown = this.element.querySelector(".xjzl-cb-stats-shown");
        if (statsShown) statsShown.textContent = game.i18n.format("XJZL.CompendiumBrowser.Stats.Shown", { shown });

        const sentinel = this.element.querySelector(".xjzl-cb-sentinel");
        if (!sentinel) return;
        if (shown < total && shown < MAX_RENDER) return; // 仍有更多，哨兵保留

        const note = document.createElement("div");
        note.className = "xjzl-cb-ended";
        note.textContent = shown >= MAX_RENDER
            ? game.i18n.format("XJZL.CompendiumBrowser.Stats.LimitReached", { limit: MAX_RENDER })
            : game.i18n.format("XJZL.CompendiumBrowser.Stats.Ended", { count: total });
        sentinel.replaceWith(note);
        statsShown?.remove();
        this._sentinelObserver?.disconnect();
        this._sentinelObserver = null;
    }

    /** 窗口关闭时清理哨兵观察器，避免残留观测已脱离的节点。 */
    async close(options) {
        this._sentinelObserver?.disconnect();
        this._sentinelObserver = null;
        return super.close(options);
    }

    /* -------------------------------------------- */
    /*  数据准备 (Context)                          */
    /* -------------------------------------------- */

    async _prepareContext(options) {
        const activeTab = this.browserState.activeTab;
        const rawItems = this.cachedData[activeTab] || [];
        const state = this._currentTabState;

        // 1. 过滤（当前筛选 + 当前搜索）
        const filteredItems = this._filterItems(rawItems);

        // 2. 排序
        const sortedItems = this._sortItems(filteredItems);

        // 3. 分页切片（初屏 + 已加载页）
        const visibleCount = Math.min(state.visibleCount, sortedItems.length);
        const displayItems = sortedItems.slice(0, visibleCount);

        // 4. 构建卡片展示数据（徽标/品阶/tooltip）并预渲染为 HTML 片段。
        //    不用 Handlebars partial（本项目未引入该机制），而是由 card-list.hbs 独立渲染，
        //    初屏与 _loadMore 增量追加共用同一模板，保证两处卡片结构一致。
        const items = displayItems.map(item => this._buildCardData(item));
        const cardListHtml = await renderTemplate(
            "systems/xjzl-system/templates/apps/compendiumbrowser/card-list.hbs",
            { items, viewMode: this.browserState.viewMode }
        );

        // 5. 构建筛选器 UI 数据（含各选项命中计数）
        const filterList = this._buildFilterGroups(activeTab, state, rawItems);
        const totalCount = filteredItems.length;

        const localize = key => game.i18n.localize(`XJZL.CompendiumBrowser.${key}`);

        return {
            isLoaded: this.isLoaded,
            tabs: XJZLCompendiumBrowser.TABS.map(tab => ({ ...tab, label: game.i18n.localize(tab.label) })),
            activeTab: activeTab,
            cardListHtml: cardListHtml,
            totalCount: totalCount,
            hasMore: visibleCount < sortedItems.length && visibleCount < MAX_RENDER,
            reachedMax: visibleCount >= MAX_RENDER && visibleCount < sortedItems.length,
            statsFound: game.i18n.format("XJZL.CompendiumBrowser.Stats.Found", { count: totalCount }),
            statsShown: game.i18n.format("XJZL.CompendiumBrowser.Stats.Shown", { shown: displayItems.length }),
            endedText: game.i18n.format("XJZL.CompendiumBrowser.Stats.Ended", { count: totalCount }),
            limitText: game.i18n.format("XJZL.CompendiumBrowser.Stats.LimitReached", { limit: MAX_RENDER }),
            sortLabel: localize("Sort.Label"),
            sortName: localize("Sort.Name"),
            sortQualityDesc: localize("Sort.QualityDesc"),
            sortQualityAsc: localize("Sort.QualityAsc"),
            viewLabel: localize("View.Label"),
            viewCompact: localize("View.Compact"),
            viewGrid: localize("View.Grid"),
            loadMoreText: localize("Stats.LoadMore"),
            loadingText: localize("State.Loading"),
            sortBy: this.browserState.sortBy,
            viewMode: this.browserState.viewMode,
            searchQuery: state.searchQuery,
            filterList: filterList
        };
    }

    /**
     * 构建某 Tab 的筛选组 UI 数据，并为每个选项计算命中计数。
     * 计数 = 在当前搜索 + 其他筛选组生效的前提下，本组取该值时命中的条数；
     * 自身组内已选选项不计入互斥（让用户在组内点选时仍能看到其余取值的余量）。
     * 性能：每组只跑一次过滤得基准集，再单次遍历统计各取值计数 O(组数×N)，
     * 而非每个选项都跑一次完整过滤 O(组数×选项数×N)。
     */
    _buildFilterGroups(tab, state, rawItems) {
        const configs = this.filterConfig[tab] || [];
        const { searchQuery, filters } = state;
        const activeEntries = Object.entries(filters).filter(([_, set]) => set?.size > 0);
        // 武学的 element/damageType/weaponType 落在 moves 数组内，须与 _filterItems 特殊分支保持一致
        const movesKeys = new Set(["element", "damageType", "weaponType"]);

        return configs.map(config => {
            // 计数基准：当前搜索 + 其他筛选组（排除本组已选）
            const baseFilters = {};
            for (const [key, set] of activeEntries) {
                if (key !== config.key) baseFilters[key] = set;
            }
            const baseItems = this._filterItems(rawItems, baseFilters, searchQuery);

            // 单次遍历统计本组各取值命中数
            const counts = new Map();
            const isMovesKey = movesKeys.has(config.key);
            for (const item of baseItems) {
                if (isMovesKey && item.type === "wuxue") {
                    const moves = item.system?.moves;
                    if (!Array.isArray(moves)) continue;
                    // 一招符合即算命中；同物品内多招同值只计一次
                    const seen = new Set();
                    for (const m of moves) {
                        const v = m?.[config.key];
                        if (v != null) seen.add(v.toString());
                    }
                    for (const v of seen) counts.set(v, (counts.get(v) || 0) + 1);
                } else {
                    const v = item.system?.[config.key];
                    if (v == null) continue;
                    const vs = v.toString();
                    counts.set(vs, (counts.get(vs) || 0) + 1);
                }
            }

            return {
                ...config,
                label: game.i18n.localize(config.label),
                isOpen: config.key !== "subSect", // 只要不是 subSect，就默认展开
                options: Object.entries(config.options).map(([val, labelKey]) => {
                    const checked = filters[config.key]?.has(val.toString()) ?? false;
                    const count = counts.get(val.toString()) || 0;
                    return {
                        val: val,
                        label: game.i18n.localize(labelKey),
                        checked: checked,
                        count: count,
                        isZero: count === 0
                    };
                })
            };
        });
    }

    /* -------------------------------------------- */
    /*  排序与卡片数据                              */
    /* -------------------------------------------- */

    /** 统一稀有度值：武学/内功按品阶 tier(1-3)，其余按品质 quality(0-4)，统一为"品质"排序概念。 */
    _rarityValue(item) {
        const sys = item.system ?? {};
        if (item.type === "wuxue" || item.type === "neigong") {
            const tier = Number(sys.tier);
            return Number.isFinite(tier) ? tier : 1;
        }
        const quality = Number(sys.quality);
        return Number.isFinite(quality) ? quality : 0;
    }

    /**
     * 按排序偏好排序。默认名称升序即 loadData 的既有顺序，直接返回原引用；
     * - quality-desc / quality-asc：稀有度降序 / 升序（武学/内功按品阶 tier，其余按品质 quality）
     * 需要排序的档位复制数组排序（JS 稳定排序，同档内保持名称序），不污染缓存。
     */
    _sortItems(items) {
        const sortBy = this.browserState.sortBy;
        if (sortBy === "quality-desc" || sortBy === "quality-asc") {
            const dir = sortBy === "quality-desc" ? -1 : 1;
            return [...items].sort((a, b) => dir * (this._rarityValue(a) - this._rarityValue(b)));
        }
        return items; // name：loadData 已按名称序，直接返回原引用
    }

    /** 取 CONFIG 映射中的本地化标签；无映射时回退原值（不崩、不显示空）。 */
    _localizeKey(map, key) {
        if (!key) return "";
        const label = map?.[key] ? game.i18n.localize(map[key]) : key;
        return label || "";
    }

    /**
     * 从索引条目构建卡片展示数据（次要信息行 + grid 徽标 + tooltip 摘要）。
     * 品阶/品质只用左边框颜色表达，不重复文字；价格对玩家无决策价值，不展示。
     * 徽标与次要信息复用 CONFIG.XJZL 本地化映射，与筛选器同源，避免文案漂移；
     * 武学/内功的属性集中在 moves 数组内，取第一招作为摘要来源。
     */
    _buildCardData(item) {
        const C = CONFIG.XJZL;
        const sys = item.system ?? {};
        const badges = [];
        const sub = [];
        const tooltip = [];

        const sectLabel = this._localizeKey(C.sects, sys.sect);
        const firstMove = Array.isArray(sys.moves) ? sys.moves[0] : null;
        const element = sys.element ?? firstMove?.element;
        const elementLabel = element && element !== "none" ? this._localizeKey(C.elements, element) : "";

        // 各类型的主信息：武学=门派·类别（属性）；装备=子类型；技艺/特效=分类
        if (item.type === "wuxue" || item.type === "neigong") {
            sub.push(sectLabel);
            if (item.type === "wuxue") sub.push(this._localizeKey(C.wuxueCategories, sys.category));
            else sub.push(elementLabel);

            if (sectLabel) badges.push({ label: sectLabel, cls: "b-sect" });
            if (item.type === "wuxue") {
                const cat = this._localizeKey(C.wuxueCategories, sys.category);
                if (cat) badges.push({ label: cat, cls: "b-cat" });
                const dmg = firstMove?.damageType;
                if (dmg && dmg !== "none") badges.push({ label: this._localizeKey(C.damageTypes, dmg), cls: "b-dmg" });
                const wpn = sys.weaponType ?? firstMove?.weaponType;
                if (wpn && wpn !== "none") badges.push({ label: this._localizeKey(C.weaponTypes, wpn), cls: "b-weap" });
            } else if (elementLabel) {
                badges.push({ label: elementLabel, cls: "b-element" });
            }
        } else if (item.type === "weapon") {
            // 武器给子类型优先（种子数据为中文直填，如"弯刀"），无则回退武器类型
            const typeLabel = sys.subtype || this._localizeKey(C.weaponTypes, sys.type);
            if (typeLabel) { sub.push(typeLabel); badges.push({ label: typeLabel, cls: "b-weap" }); }
        } else if (item.type === "armor") {
            const typeLabel = this._localizeKey(C.armorTypes, sys.type);
            if (typeLabel) { sub.push(typeLabel); badges.push({ label: typeLabel, cls: "b-armor" }); }
        } else if (item.type === "consumable") {
            const typeLabel = this._localizeKey(C.consumableTypes, sys.type);
            if (typeLabel) { sub.push(typeLabel); badges.push({ label: typeLabel, cls: "b-consum" }); }
        } else if (item.type === "art_book") {
            const typeLabel = this._localizeKey(C.arts, sys.artType);
            if (typeLabel) { sub.push(typeLabel); badges.push({ label: typeLabel, cls: "b-art" }); }
        } else if (item.type === "trait") {
            const typeLabel = this._localizeKey(C.traitTypes, sys.type);
            if (typeLabel) { sub.push(typeLabel); badges.push({ label: typeLabel, cls: "b-trait" }); }
        }
        // misc / qizhen 无类型信息，保持单行 + 来源包名

        // tooltip：只放颜色之外的信息（名称/门派/类别/属性/来源），不含品级与价格
        tooltip.push(item.name, ...sub);
        if (elementLabel && !sub.includes(elementLabel)) tooltip.push(elementLabel);
        if (item.packLabel) tooltip.push(item.packLabel);

        return {
            ...item,
            badges,
            sub: sub.filter(Boolean).join(" · "),
            tooltip: tooltip.filter(Boolean).join(" · ")
        };
    }

    /* -------------------------------------------- */
    /*  核心功能：内存过滤引擎                       */
    /* -------------------------------------------- */

    /**
     * 高性能内存过滤器
     * 复杂度优化至 O(N * M)，利用预计算的 _searchName（组合搜索串）加速
     */
    _filterItems(items, filters = null, query = null) {
        const activeFilters = filters || this._filters;
        const activeQuery = (query !== null ? query : this._searchQuery).toLowerCase();

        // 预处理筛选器：将 Object 转换为数组，移除空 Set，避免循环内频繁 Object.entries
        const activeFilterEntries = Object.entries(activeFilters).filter(([_, v]) => v && v.size > 0);
        const hasFilters = activeFilterEntries.length > 0;
        const hasQuery = !!activeQuery;

        // 快速路径
        if (!hasQuery && !hasFilters) return items;

        return items.filter(item => {
            // 1. 文本搜索 (使用预计算字段)
            if (hasQuery && !item._searchName.includes(activeQuery)) return false;

            // 2. 属性匹配
            if (hasFilters) {
                const system = item.system;
                for (const [key, activeSet] of activeFilterEntries) {

                    // 特殊处理：武学招式数组 (moves)
                    // 如果筛选的是武学属性，且数据在 moves 数组中
                    if (item.type === "wuxue" && ["element", "damageType", "weaponType"].includes(key)) {
                        const moves = system.moves;
                        if (!Array.isArray(moves) || moves.length === 0) return false;

                        // 只要有一招符合即可
                        const hasMatch = moves.some(m => m[key] && activeSet.has(m[key].toString()));
                        if (!hasMatch) return false;
                        continue;
                    }

                    // 常规处理
                    const val = system[key];
                    if (val === undefined || val === null || !activeSet.has(val.toString())) return false;
                }
            }
            return true;
        });
    }

    /* -------------------------------------------- */
    /*  功能：随机化引擎 (Randomizer)               */
    /* -------------------------------------------- */

    /**
     * 从指定范围随机抽取物品
     */
    async randomize(options = {}) {
        const tab = options.tab || this.browserState.activeTab;
        // 未显式传入 filters 时，回退到指定 Tab 自己的已选筛集（维持 UI 对话框行为）
        const filters = options.filters || this.browserState.tabs[tab]?.filters || {};
        const amount = options.amount || 1;
        const useWeight = options.weighted ?? true;
        const rawItems = this.cachedData[tab] || [];

        // 1. 获取候选池
        const pool = this._filterItems(rawItems, filters, ""); // 忽略搜索词进行随机
        if (pool.length === 0) {
            ui.notifications.warn(game.i18n.format("XJZL.CompendiumBrowser.State.NoFilteredItems", { tab }));
            return [];
        }

        // 2. 权重配置
        const tierWeights = options.customWeights || { 1: 100, 2: 20, 3: 5 };
        const qualityWeights = options.customWeights || { 0: 100, 1: 60, 2: 30, 3: 10, 4: 2 };

        /**
         * 辅助函数：获取单个物品权重
         * @param {Object} item 
         */
        const getWeight = (item) => {
            if (!useWeight) return 1;
            const sys = item.system;
            if (item.type === "wuxue" || item.type === "neigong") {
                return tierWeights[sys.tier ?? 1] || 10;
            }
            return qualityWeights[sys.quality ?? 0] || 10;
        };

        const results = [];

        // 3. 抽取逻辑
        if (useWeight) {
            // 避免 map 创建大量临时对象。采用即时计算法。
            // 如果抽取数量很大，可以先计算总权重，再二分查找（CDF），但此处 loop amount 较小，直接遍历即可。

            // 3.1 计算总权重
            let totalWeight = 0;
            for (const item of pool) {
                totalWeight += getWeight(item);
            }

            // 3.2 循环抽取
            for (let i = 0; i < amount; i++) {
                let random = Math.random() * totalWeight;
                let selected = null;

                // 游标法选择
                for (const item of pool) {
                    random -= getWeight(item);
                    if (random <= 0) {
                        selected = item;
                        break;
                    }
                }
                // 浮点数兜底
                if (!selected) selected = pool[pool.length - 1];
                results.push(foundry.utils.deepClone(selected));
            }
        } else {
            // 纯随机
            for (let i = 0; i < amount; i++) {
                const idx = Math.floor(Math.random() * pool.length);
                results.push(foundry.utils.deepClone(pool[idx]));
            }
        }

        console.log(`XJZL Randomizer | Results:`, results);
        return results;
    }

    async _onRandomizeClick(event) {
        event.preventDefault();
        const { DialogV2 } = foundry.applications.api;
        const activeTab = this.browserState.activeTab;
        const currentPool = this._filterItems(this.cachedData[activeTab] || [], undefined, "");

        if (currentPool.length === 0) return ui.notifications.warn(game.i18n.localize("XJZL.CompendiumBrowser.State.EmptyPool"));

        const isTier = ["wuxue", "neigong"].includes(activeTab);

        const localize = key => game.i18n.localize(`XJZL.CompendiumBrowser.Random.${key}`);

        // 权重行数据驱动模板渲染；input name 保持 w_* 命名，callback 的取值逻辑不变
        const weightList = isTier
            ? [
                { name: "w_1", label: localize("Tier1"), value: 100, color: "#666" },
                { name: "w_2", label: localize("Tier2"), value: 20, color: "#8d6e63" },
                { name: "w_3", label: localize("Tier3"), value: 5, color: "#d4af37" }
            ]
            : [
                { name: "w_0", label: localize("Quality0"), value: 100, color: "#666" },
                { name: "w_1", label: localize("Quality1"), value: 60, color: "#8d6e63" },
                { name: "w_2", label: localize("Quality2"), value: 30, color: "#95a5a6" },
                { name: "w_3", label: localize("Quality3"), value: 10, color: "#d4af37" },
                { name: "w_4", label: localize("Quality4"), value: 2, color: "#2ecc71" }
            ];

        const content = await renderTemplate(
            "systems/xjzl-system/templates/apps/compendiumbrowser/random-dialog.hbs",
            {
                amount: 1,
                alias: game.i18n.localize("XJZL.CompendiumBrowser.Random.DefaultAlias"),
                title: game.i18n.localize("XJZL.CompendiumBrowser.Random.Title"),
                amountLabel: localize("Amount"),
                senderLabel: localize("Sender"),
                titleLabel: localize("TitleField"),
                weightLegend: localize("WeightTitle"),
                poolLabel: game.i18n.format("XJZL.CompendiumBrowser.Random.Pool", { count: currentPool.length }),
                isTier: isTier,
                weights: weightList
            }
        );

        const result = await DialogV2.wait({
            window: { title: localize("Title"), icon: "fas fa-dice-d20", resizable: false },
            content: content,
            buttons: [{
                action: "ok", label: localize("Draw"), icon: "fas fa-check",
                callback: (event, button) => {
                    const form = button.form;
                    const w = {};
                    if (isTier) [1, 2, 3].forEach(i => w[i] = parseInt(form.elements[`w_${i}`].value) || 0);
                    else[0, 1, 2, 3, 4].forEach(i => w[i] = parseInt(form.elements[`w_${i}`].value) || 0);

                    return {
                        amount: parseInt(form.elements.amount.value) || 1,
                        alias: form.elements.alias.value || game.i18n.localize("XJZL.CompendiumBrowser.Random.DefaultAlias"),
                        title: form.elements.title.value || game.i18n.localize("XJZL.CompendiumBrowser.Random.Title"),
                        weights: w
                    };
                }
            }],
            close: () => null
        });

        if (result) {
            const items = await this.randomize({ amount: result.amount, weighted: true, customWeights: result.weights });
            if (items.length) {
                if (game.settings.get("xjzl-system", "enableCompendiumDrawAnimation")) {
                    await this._playDrawAnimation(items, result);
                }
                await this._generateLootChatCard(items, result);
            }
        }
    }

    /**
     * 将不同物品体系的品质统一为抽取演出所需的表现数据。
     * 此处只负责显示，不参与随机权重计算。
     */
    _getRarityPresentation(item) {
        const sys = item.system ?? {};

        if (item.type === "wuxue" || item.type === "neigong") {
            const rawTier = Number(sys.tier ?? 1);
            const tier = Number.isFinite(rawTier) ? Math.min(3, Math.max(1, rawTier)) : 1;
            const tiers = {
                1: {
                    colorClass: "tier-1", drawClass: "tier-1", label: game.i18n.localize("XJZL.Tiers.1").substring(0, 1),
                    nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Tier1", power: 1
                },
                2: {
                    colorClass: "tier-2", drawClass: "tier-2", label: game.i18n.localize("XJZL.Tiers.2").substring(0, 1),
                    nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Tier2", power: 4
                },
                3: {
                    colorClass: "tier-3", drawClass: "tier-3", label: game.i18n.localize("XJZL.Tiers.3").substring(0, 1),
                    nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Tier3", power: 6
                }
            };
            return tiers[tier];
        }

        if (item.type === "trait") {
            const typeKey = CONFIG.XJZL.traitTypes?.[sys.type];
            return {
                colorClass: "rank-jin",
                drawClass: "trait",
                label: typeKey ? game.i18n.localize(typeKey).substring(0, 2) : game.i18n.localize("XJZL.Trait").substring(0, 2),
                nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Trait",
                power: 4
            };
        }

        const rawQuality = Number(sys.quality ?? 0);
        const quality = Number.isFinite(rawQuality) ? Math.min(4, Math.max(0, rawQuality)) : 0;
        const qualities = {
            0: {
                colorClass: "quality-0", drawClass: "quality-0", label: game.i18n.localize("XJZL.Qualities.0").substring(0, 1),
                nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Quality0", power: 0
            },
            1: {
                colorClass: "quality-1", drawClass: "quality-1", label: game.i18n.localize("XJZL.Qualities.1").substring(0, 1),
                nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Quality1", power: 1
            },
            2: {
                colorClass: "quality-2", drawClass: "quality-2", label: game.i18n.localize("XJZL.Qualities.2").substring(0, 1),
                nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Quality2", power: 2
            },
            3: {
                colorClass: "quality-3", drawClass: "quality-3", label: game.i18n.localize("XJZL.Qualities.3").substring(0, 1),
                nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Quality3", power: 4
            },
            4: {
                colorClass: "quality-4", drawClass: "quality-4", label: game.i18n.localize("XJZL.Qualities.4").substring(0, 1),
                nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Quality4", power: 5
            }
        };
        return qualities[quality];
    }

    /**
     * 创建抽取演出的本地分层音轨。
     * 使用 interface 音频通道，尊重 Foundry 的界面音量设置；音轨只在当前客户端播放。
     */
    _createDrawAudio({ reducedMotion = false } = {}) {
        const Sound = foundry.audio?.Sound;
        const context = game.audio?.interface;
        if (!Sound || !context || reducedMotion) {
            return {
                preload: async () => {},
                play: async () => {},
                stop: () => {}
            };
        }

        const definitions = {
            bed: {
                src: "systems/xjzl-system/assets/sounds/compendium-draw/draw-cinematic-score.wav",
                volume: 0.26,
                delay: 0
            },
            meteor: {
                src: "systems/xjzl-system/assets/sounds/compendium-draw/draw-meteor-flight.wav",
                volume: 0.42,
                delay: 0
            },
            rarity: {
                src: "systems/xjzl-system/assets/sounds/compendium-draw/draw-rarity-bloom.wav",
                volume: 0.62,
                delay: 0
            },
            reveal: {
                src: "systems/xjzl-system/assets/sounds/compendium-draw/draw-reveal-stinger.wav",
                volume: 0.52,
                delay: 0.32
            }
        };
        const sounds = new Map();
        const played = new Set();
        let stopped = false;
        let preloadPromise;

        const preload = () => {
            preloadPromise ??= Promise.all(Object.entries(definitions).map(async ([key, definition]) => {
                const sound = new Sound(definition.src, { context, forceBuffer: true });
                sounds.set(key, sound);
                try {
                    await sound.load();
                } catch (error) {
                    console.warn(`XJZL | 抽取音效加载失败：${definition.src}`, error);
                }
            }));
            return preloadPromise;
        };

        const play = async key => {
            if (stopped || played.has(key) || !definitions[key]) return;
            played.add(key);
            await preload();
            const sound = sounds.get(key);
            if (stopped || !sound?.loaded || sound.failed) return;
            try {
                await sound.play({
                    volume: definitions[key].volume,
                    delay: definitions[key].delay
                });
            } catch (error) {
                console.warn(`XJZL | 抽取音效播放失败：${definitions[key].src}`, error);
            }
        };

        const stop = ({ fade = 160 } = {}) => {
            if (stopped) return;
            stopped = true;
            for (const sound of sounds.values()) {
                if (!sound.playing) continue;
                sound.stop({ fade }).catch(error => {
                    console.warn(`XJZL | 抽取音效停止失败：${sound.src}`, error);
                });
            }
        };

        return { preload, play, stop };
    }

    /**
     * 创建抽取演出的实时流星。
     * Canvas 负责星核、尾迹历史与碎片物理；素材只作为云气和碎片纹理参与合成。
     */
    _createDrawMeteorAnimation(stage, {
        debrisIntensity = 1,
        companionCount = 0,
        reducedMotion = false
    } = {}) {
        const canvas = stage.querySelector(".xjzl-cinematic-meteor-canvas");
        const context = canvas?.getContext("2d", { alpha: true, desynchronized: true });
        if (!canvas || !context || reducedMotion) {
            return {
                setPhase: () => {},
                stop: () => {}
            };
        }

        const wispTexture = new Image();
        wispTexture.decoding = "async";
        wispTexture.src = "systems/xjzl-system/assets/ui/compendium-draw/draw-meteor-wisp-v2.png";

        const shardTexture = new Image();
        shardTexture.decoding = "async";
        shardTexture.src = "systems/xjzl-system/assets/ui/compendium-draw/draw-meteor-shards-v2.png";

        // 生成图中的独立碎片区域；逐片裁切后各自拥有速度、旋转和寿命。
        const shardCrops = [
            [1028, 36, 118, 146],
            [1138, 68, 242, 196],
            [680, 196, 112, 94],
            [875, 174, 112, 94],
            [922, 274, 132, 106],
            [388, 454, 174, 188],
            [432, 565, 266, 228],
            [950, 672, 190, 182],
            [1168, 498, 144, 136],
            [792, 646, 126, 132]
        ];

        let width = 1;
        let height = 1;
        let pixelRatio = 1;
        let animationFrame = 0;
        let stopped = false;
        let phase = "invitation";
        let meteorStarted = 0;
        let igniteStarted = 0;
        let burstStarted = 0;
        let lastFrame = 0;
        let lastParticleSpawn = 0;
        let lastDebrisSpawn = 0;
        let rarityColor = { r: 196, g: 255, b: 244 };
        const history = [];
        const particles = [];
        const debris = [];
        const companionMeteors = Array.from(
            { length: Math.max(0, Math.min(6, companionCount)) },
            (_, index) => ({
                delay: 180 + (index * 170),
                duration: 2550 + ((index * 137) % 760),
                startY: 0.18 + (((index * 23) % 56) / 100),
                rise: 0.12 + (((index * 11) % 17) / 100),
                depth: 0.46 + ((index % 3) * 0.16),
                curve: ((index % 2 ? -1 : 1) * (0.025 + ((index % 3) * 0.012)))
            })
        );

        const clamp = value => Math.max(0, Math.min(1, value));
        const mix = (from, to, amount) => from + ((to - from) * clamp(amount));
        const rgba = (color, alpha) => `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
        const easeOutCubic = value => 1 - Math.pow(1 - clamp(value), 3);

        const readRarityColor = () => {
            const raw = getComputedStyle(stage).getPropertyValue("--draw-color-rgb").trim();
            const values = raw.split(",").map(value => Number.parseFloat(value.trim()));
            if (values.length === 3 && values.every(Number.isFinite)) {
                rarityColor = { r: values[0], g: values[1], b: values[2] };
            }
        };

        const resize = () => {
            const bounds = canvas.getBoundingClientRect();
            const nextWidth = Math.max(1, Math.round(bounds.width));
            const nextHeight = Math.max(1, Math.round(bounds.height));
            const nextPixelRatio = Math.min(globalThis.devicePixelRatio || 1, 1.6);
            if (
                width === nextWidth
                && height === nextHeight
                && pixelRatio === nextPixelRatio
                && canvas.width === Math.round(nextWidth * nextPixelRatio)
                && canvas.height === Math.round(nextHeight * nextPixelRatio)
            ) return;

            width = nextWidth;
            height = nextHeight;
            pixelRatio = nextPixelRatio;
            canvas.width = Math.round(nextWidth * nextPixelRatio);
            canvas.height = Math.round(nextHeight * nextPixelRatio);
            context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        };

        const resizeObserver = globalThis.ResizeObserver ? new ResizeObserver(resize) : null;
        resizeObserver?.observe(canvas);
        resize();
        readRarityColor();

        const pointOnPath = progress => {
            const t = clamp(progress);
            const inverse = 1 - t;
            const start = { x: width * -0.08, y: height * 0.73 };
            const controlA = { x: width * 0.22, y: height * 0.69 };
            const controlB = { x: width * 0.58, y: height * 0.38 };
            const end = { x: width * 1.05, y: height * 0.2 };
            return {
                x: (inverse ** 3 * start.x)
                    + (3 * inverse * inverse * t * controlA.x)
                    + (3 * inverse * t * t * controlB.x)
                    + (t ** 3 * end.x),
                y: (inverse ** 3 * start.y)
                    + (3 * inverse * inverse * t * controlA.y)
                    + (3 * inverse * t * t * controlB.y)
                    + (t ** 3 * end.y)
            };
        };

        const tangentOnPath = progress => {
            const before = pointOnPath(progress - 0.006);
            const after = pointOnPath(progress + 0.006);
            const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
            return {
                x: (after.x - before.x) / length,
                y: (after.y - before.y) / length,
                angle: Math.atan2(after.y - before.y, after.x - before.x)
            };
        };

        const spawnParticle = (head, tangent, now, intensity) => {
            const normal = { x: -tangent.y, y: tangent.x };
            const spread = (Math.random() - 0.5) * (16 + (intensity * 20));
            const speed = 0.045 + (Math.random() * 0.12);
            particles.push({
                x: head.x + (normal.x * spread),
                y: head.y + (normal.y * spread),
                vx: (-tangent.x * speed) + (normal.x * (Math.random() - 0.5) * 0.05),
                vy: (-tangent.y * speed) + (normal.y * (Math.random() - 0.5) * 0.05),
                born: now,
                life: 520 + (Math.random() * 950),
                size: 0.7 + (Math.random() * 2.8)
            });
            if (particles.length > 320) particles.splice(0, particles.length - 320);
        };

        const spawnDebris = (head, tangent, now, intensity) => {
            const normal = { x: -tangent.y, y: tangent.x };
            const spread = (Math.random() - 0.5) * (24 + (intensity * 30));
            const crop = shardCrops[Math.floor(Math.random() * shardCrops.length)];
            debris.push({
                crop,
                x: head.x - (tangent.x * (8 + Math.random() * 28)) + (normal.x * spread),
                y: head.y - (tangent.y * (8 + Math.random() * 28)) + (normal.y * spread),
                vx: (-tangent.x * (0.055 + Math.random() * 0.095))
                    + (normal.x * (Math.random() - 0.5) * 0.12),
                vy: (-tangent.y * (0.055 + Math.random() * 0.095))
                    + (normal.y * (Math.random() - 0.5) * 0.12),
                born: now,
                life: 820 + (Math.random() * 1100),
                size: (10 + Math.random() * 28) * (0.72 + intensity * 0.28),
                rotation: Math.random() * Math.PI * 2,
                spin: (Math.random() - 0.5) * 0.005
            });
            if (debris.length > 56) debris.splice(0, debris.length - 56);
        };

        const updateEntities = (now, delta) => {
            for (const particle of particles) {
                particle.x += particle.vx * delta;
                particle.y += particle.vy * delta;
            }
            for (const fragment of debris) {
                fragment.x += fragment.vx * delta;
                fragment.y += fragment.vy * delta;
                fragment.rotation += fragment.spin * delta;
            }
            while (particles.length && now - particles[0].born > particles[0].life) particles.shift();
            while (debris.length && now - debris[0].born > debris[0].life) debris.shift();
        };

        const drawCompanionMeteors = (now, igniteMix) => {
            if (!companionMeteors.length) return;
            const jade = { r: 174, g: 238, b: 236 };

            context.save();
            context.globalCompositeOperation = "lighter";
            context.lineCap = "round";
            for (const [index, meteor] of companionMeteors.entries()) {
                const localProgress = (now - meteorStarted - meteor.delay) / meteor.duration;
                if (localProgress <= 0 || localProgress >= 1) continue;

                const progress = localProgress * localProgress * (3 - (2 * localProgress));
                const x = mix(width * -0.12, width * 1.1, progress);
                const baseY = mix(
                    height * meteor.startY,
                    height * (meteor.startY - meteor.rise),
                    progress
                );
                const y = baseY + (Math.sin(Math.PI * progress) * height * meteor.curve);
                const nextProgress = clamp(progress + 0.01);
                const nextX = mix(width * -0.12, width * 1.1, nextProgress);
                const nextBaseY = mix(
                    height * meteor.startY,
                    height * (meteor.startY - meteor.rise),
                    nextProgress
                );
                const nextY = nextBaseY + (Math.sin(Math.PI * nextProgress) * height * meteor.curve);
                const angle = Math.atan2(nextY - y, nextX - x);
                const tangent = { x: Math.cos(angle), y: Math.sin(angle) };
                const tailLength = Math.min(width * (0.105 + meteor.depth * 0.045), 210);
                const activeColor = {
                    r: mix(jade.r, rarityColor.r, igniteMix * 0.38),
                    g: mix(jade.g, rarityColor.g, igniteMix * 0.38),
                    b: mix(jade.b, rarityColor.b, igniteMix * 0.38)
                };
                const alpha = Math.sin(Math.PI * localProgress) * (0.34 + meteor.depth * 0.28);
                const tailX = x - (tangent.x * tailLength);
                const tailY = y - (tangent.y * tailLength);
                const gradient = context.createLinearGradient(tailX, tailY, x, y);
                gradient.addColorStop(0, rgba(activeColor, 0));
                gradient.addColorStop(0.48, rgba(activeColor, alpha * 0.18));
                gradient.addColorStop(0.86, rgba(activeColor, alpha * 0.72));
                gradient.addColorStop(1, `rgba(255,255,255,${alpha * 0.94})`);

                context.strokeStyle = gradient;
                context.lineWidth = 5.5 * meteor.depth;
                context.beginPath();
                context.moveTo(tailX, tailY);
                context.lineTo(x, y);
                context.stroke();

                context.strokeStyle = `rgba(248,255,255,${alpha * 0.76})`;
                context.lineWidth = Math.max(0.7, 1.25 * meteor.depth);
                context.beginPath();
                context.moveTo(tailX + (tangent.x * tailLength * 0.38), tailY + (tangent.y * tailLength * 0.38));
                context.lineTo(x, y);
                context.stroke();

                const coreRadius = 5 + (meteor.depth * 8);
                const core = context.createRadialGradient(x, y, 0, x, y, coreRadius);
                core.addColorStop(0, `rgba(255,255,255,${alpha * 0.98})`);
                core.addColorStop(0.24, rgba(activeColor, alpha));
                core.addColorStop(1, rgba(activeColor, 0));
                context.fillStyle = core;
                context.beginPath();
                context.arc(x, y, coreRadius, 0, Math.PI * 2);
                context.fill();

                // 少量沿途闪点让小流星看起来在持续运动，而不是静态短线。
                for (let moteIndex = 1; moteIndex <= 3; moteIndex++) {
                    const distance = tailLength * (0.22 + moteIndex * 0.19);
                    const jitter = Math.sin((now * 0.009) + index + moteIndex) * 3.5;
                    const normal = { x: -tangent.y, y: tangent.x };
                    context.fillStyle = rgba(activeColor, alpha * (0.34 / moteIndex));
                    context.beginPath();
                    context.arc(
                        x - (tangent.x * distance) + (normal.x * jitter),
                        y - (tangent.y * distance) + (normal.y * jitter),
                        Math.max(0.6, 1.8 - moteIndex * 0.3),
                        0,
                        Math.PI * 2
                    );
                    context.fill();
                }
            }
            context.restore();
        };

        const drawLightCone = (head, tangent, progress, igniteMix, ignitionSwell) => {
            const jade = { r: 176, g: 241, b: 238 };
            const activeColor = {
                r: mix(jade.r, rarityColor.r, igniteMix),
                g: mix(jade.g, rarityColor.g, igniteMix),
                b: mix(jade.b, rarityColor.b, igniteMix)
            };
            const arrival = easeOutCubic(progress / 0.2);
            const length = Math.min(width * 0.68, 1040) * arrival * (1 + ignitionSwell * 0.14);
            const outerWidth = Math.min(Math.max(height * 0.17, 96), 196) * (1 + ignitionSwell * 0.82);

            context.save();
            context.globalCompositeOperation = "source-over";
            context.translate(head.x, head.y);
            context.rotate(tangent.angle);

            const outer = context.createLinearGradient(-length, 0, 0, 0);
            outer.addColorStop(0, rgba(activeColor, 0));
            outer.addColorStop(0.24, rgba(activeColor, 0.06));
            outer.addColorStop(0.66, rgba(activeColor, 0.24));
            outer.addColorStop(0.9, rgba(activeColor, 0.54));
            outer.addColorStop(1, "rgba(255,255,255,0.92)");
            context.filter = "blur(9px)";
            context.fillStyle = outer;
            context.beginPath();
            context.moveTo(3, -2);
            context.quadraticCurveTo(-length * 0.5, -outerWidth * 0.42, -length, -outerWidth * 0.52);
            context.lineTo(-length, outerWidth * 0.52);
            context.quadraticCurveTo(-length * 0.5, outerWidth * 0.42, 3, 2);
            context.closePath();
            context.fill();

            const inner = context.createLinearGradient(-length * 0.82, 0, 0, 0);
            inner.addColorStop(0, rgba(activeColor, 0));
            inner.addColorStop(0.45, rgba(activeColor, 0.26));
            inner.addColorStop(0.88, "rgba(242,255,255,0.82)");
            inner.addColorStop(1, "#fff");
            context.filter = "blur(2px)";
            context.fillStyle = inner;
            context.beginPath();
            context.moveTo(2, -1.2);
            context.lineTo(-length * 0.82, -outerWidth * 0.12);
            context.lineTo(-length * 0.82, outerWidth * 0.12);
            context.lineTo(2, 1.2);
            context.closePath();
            context.fill();
            context.restore();
        };

        const drawWispLayers = (head, tangent, progress, now, ignitionSwell) => {
            if (!wispTexture.complete || !wispTexture.naturalWidth) return;
            const arrival = easeOutCubic(progress / 0.24);
            const baseLength = Math.min(width * 0.68, 1040)
                * arrival
                * (1 + ignitionSwell * 0.12);
            const baseHeight = Math.min(Math.max(height * 0.15, 90), 190)
                * (0.72 + progress * 0.28)
                * (1 + ignitionSwell * 0.68);
            const flutter = Math.sin(now * 0.0042) * 0.018;

            context.save();
            // 云气纹理保留自身深蓝半透明层次；若使用加亮混合，亮背景会把它完全吃掉。
            context.globalCompositeOperation = "source-over";
            context.translate(head.x, head.y);
            context.rotate(tangent.angle + flutter);
            context.globalAlpha = 0.82;
            context.filter = "blur(0.6px)";
            context.drawImage(wispTexture, -baseLength, -baseHeight * 0.58, baseLength, baseHeight * 1.16);

            context.rotate(-flutter * 1.8);
            context.translate(-baseHeight * 0.04, Math.sin(now * 0.006) * baseHeight * 0.08);
            context.globalAlpha = 0.74;
            context.drawImage(
                wispTexture,
                -baseLength * 0.88,
                -baseHeight * 0.32,
                baseLength * 0.9,
                baseHeight * 0.64
            );

            if (ignitionSwell > 0.02) {
                context.rotate(Math.sin(now * 0.008) * 0.024);
                context.translate(-baseHeight * 0.08, -baseHeight * 0.09);
                context.globalAlpha = ignitionSwell * 0.46;
                context.filter = "blur(2.4px)";
                context.drawImage(
                    wispTexture,
                    -baseLength * 0.96,
                    -baseHeight * 0.46,
                    baseLength,
                    baseHeight * 0.92
                );
            }
            context.restore();
        };

        const drawHistory = igniteMix => {
            if (history.length < 2) return;
            const jade = { r: 178, g: 244, b: 239 };
            context.save();
            context.lineCap = "round";
            context.globalCompositeOperation = "lighter";

            for (let index = history.length - 2; index >= 0; index--) {
                const current = history[index];
                const next = history[index + 1];
                const age = index / Math.max(1, history.length - 1);
                const strength = 1 - age;
                const colorWave = clamp((igniteMix * 1.55) - (age * 0.86));
                const activeColor = {
                    r: mix(jade.r, rarityColor.r, colorWave),
                    g: mix(jade.g, rarityColor.g, colorWave),
                    b: mix(jade.b, rarityColor.b, colorWave)
                };

                context.strokeStyle = rgba(activeColor, 0.055 * strength);
                context.lineWidth = 36 * strength;
                context.beginPath();
                context.moveTo(next.x, next.y);
                context.lineTo(current.x, current.y);
                context.stroke();

                context.strokeStyle = rgba(activeColor, 0.28 * strength);
                context.lineWidth = Math.max(1, 8 * strength);
                context.beginPath();
                context.moveTo(next.x, next.y);
                context.lineTo(current.x, current.y);
                context.stroke();

                context.strokeStyle = `rgba(248, 255, 255, ${0.72 * strength})`;
                context.lineWidth = Math.max(0.6, 1.7 * strength);
                context.beginPath();
                context.moveTo(next.x, next.y);
                context.lineTo(current.x, current.y);
                context.stroke();
            }
            context.restore();
        };

        const drawParticles = (now, igniteMix) => {
            const jade = { r: 176, g: 244, b: 237 };
            const activeColor = {
                r: mix(jade.r, rarityColor.r, igniteMix),
                g: mix(jade.g, rarityColor.g, igniteMix),
                b: mix(jade.b, rarityColor.b, igniteMix)
            };
            context.save();
            context.globalCompositeOperation = "lighter";
            context.lineCap = "round";
            for (const particle of particles) {
                const age = clamp((now - particle.born) / particle.life);
                const alpha = Math.sin(Math.PI * age) * 0.76;
                context.strokeStyle = rgba(activeColor, alpha);
                context.lineWidth = particle.size;
                context.beginPath();
                context.moveTo(particle.x, particle.y);
                context.lineTo(particle.x - particle.vx * 82, particle.y - particle.vy * 82);
                context.stroke();
            }
            context.restore();
        };

        const drawDebris = now => {
            if (!shardTexture.complete || !shardTexture.naturalWidth) return;
            context.save();
            context.globalCompositeOperation = "lighter";
            for (const fragment of debris) {
                const age = clamp((now - fragment.born) / fragment.life);
                const alpha = Math.sin(Math.PI * age);
                const [sourceX, sourceY, sourceWidth, sourceHeight] = fragment.crop;
                const aspect = sourceWidth / sourceHeight;
                context.save();
                context.translate(fragment.x, fragment.y);
                context.rotate(fragment.rotation);
                context.globalAlpha = alpha * 0.78;
                context.drawImage(
                    shardTexture,
                    sourceX,
                    sourceY,
                    sourceWidth,
                    sourceHeight,
                    -fragment.size * aspect * 0.5,
                    -fragment.size * 0.5,
                    fragment.size * aspect,
                    fragment.size
                );
                context.restore();
            }
            context.restore();
        };

        const drawCore = (head, tangent, igniteMix, ignitionSwell, burstMix, now) => {
            const jade = { r: 183, g: 248, b: 241 };
            const activeColor = {
                r: mix(jade.r, rarityColor.r, igniteMix),
                g: mix(jade.g, rarityColor.g, igniteMix),
                b: mix(jade.b, rarityColor.b, igniteMix)
            };
            const pulse = 1 + (Math.sin(now * 0.011) * 0.09);
            const radius = (23 + (ignitionSwell * 18) + (burstMix * 46)) * pulse;

            context.save();
            context.globalCompositeOperation = "lighter";
            const halo = context.createRadialGradient(head.x, head.y, 0, head.x, head.y, radius);
            halo.addColorStop(0, "rgba(255,255,255,1)");
            halo.addColorStop(0.08, rgba(activeColor, 0.98));
            halo.addColorStop(0.34, rgba(activeColor, 0.36));
            halo.addColorStop(1, rgba(activeColor, 0));
            context.fillStyle = halo;
            context.beginPath();
            context.arc(head.x, head.y, radius, 0, Math.PI * 2);
            context.fill();

            context.translate(head.x, head.y);
            context.rotate(tangent.angle);
            const forwardFlare = 40 + (ignitionSwell * 28) + (burstMix * Math.min(width * 0.25, 330));
            const rearFlare = 68 + (ignitionSwell * 52) + (burstMix * 112);
            const crossFlare = 13 + (ignitionSwell * 18) + (burstMix * 58);
            const flare = context.createLinearGradient(-rearFlare, 0, forwardFlare, 0);
            flare.addColorStop(0, rgba(activeColor, 0));
            flare.addColorStop(0.42, rgba(activeColor, 0.65));
            flare.addColorStop(0.58, "#fff");
            flare.addColorStop(1, rgba(activeColor, 0));
            context.strokeStyle = flare;
            context.lineWidth = 2.2 + burstMix * 4;
            context.beginPath();
            context.moveTo(-rearFlare, 0);
            context.lineTo(forwardFlare, 0);
            context.stroke();

            context.strokeStyle = rgba(activeColor, 0.62 + burstMix * 0.26);
            context.lineWidth = 1.2;
            context.beginPath();
            context.moveTo(0, -crossFlare);
            context.lineTo(0, crossFlare);
            context.stroke();

            context.fillStyle = "#fff";
            context.beginPath();
            context.arc(0, 0, 2.8 + (burstMix * 3.4), 0, Math.PI * 2);
            context.fill();
            context.restore();
        };

        const draw = now => {
            animationFrame = 0;
            if (stopped || !stage.isConnected || !meteorStarted) return;

            const delta = lastFrame ? Math.min(34, now - lastFrame) : 16;
            lastFrame = now;
            context.clearRect(0, 0, width, height);

            const flightDuration = 3600;
            const progress = clamp((now - meteorStarted) / flightDuration);
            const head = pointOnPath(progress);
            const tangent = tangentOnPath(progress);
            const igniteAge = igniteStarted ? Math.max(0, now - igniteStarted) : 0;
            const igniteMix = igniteStarted ? easeOutCubic(igniteAge / 780) : 0;
            const ignitionPulse = igniteStarted
                ? Math.sin(Math.PI * clamp(igniteAge / 980))
                : 0;
            // 变色瞬间先膨胀到约 1.8 倍，再稳定在比原尾焰大约 25% 的状态。
            const ignitionSwell = (igniteMix * 0.25) + (ignitionPulse * 0.58);
            const burstMix = burstStarted ? easeOutCubic((now - burstStarted) / 620) : 0;

            history.unshift({ x: head.x, y: head.y });
            if (history.length > 58) history.length = 58;

            if (progress > 0.04 && progress < 0.98) {
                if (now - lastParticleSpawn > 24) {
                    const count = Math.max(1, Math.round((debrisIntensity * 2) + (ignitionSwell * 2)));
                    for (let index = 0; index < count; index++) {
                        spawnParticle(head, tangent, now, igniteMix);
                    }
                    lastParticleSpawn = now;
                }
                if (now - lastDebrisSpawn > 112 / debrisIntensity) {
                    spawnDebris(head, tangent, now, 0.65 + igniteMix);
                    lastDebrisSpawn = now;
                }
            }

            updateEntities(now, delta);
            drawCompanionMeteors(now, igniteMix);
            drawLightCone(head, tangent, progress, igniteMix, ignitionSwell);
            drawWispLayers(head, tangent, progress, now, ignitionSwell);
            drawHistory(igniteMix);
            drawParticles(now, igniteMix);
            drawDebris(now);
            drawCore(head, tangent, igniteMix, ignitionSwell, burstMix, now);

            const burstAge = burstStarted ? now - burstStarted : -1;
            if (progress < 1 || burstAge < 1050) {
                animationFrame = requestAnimationFrame(draw);
            }
        };

        const requestDraw = () => {
            if (!animationFrame && !stopped) animationFrame = requestAnimationFrame(draw);
        };
        wispTexture.addEventListener("load", requestDraw, { once: true });
        shardTexture.addEventListener("load", requestDraw, { once: true });

        const setPhase = nextPhase => {
            phase = nextPhase;
            const now = performance.now();
            if (nextPhase === "meteor" && !meteorStarted) {
                meteorStarted = now;
                lastFrame = now;
                readRarityColor();
            }
            if (nextPhase === "ignite" && !igniteStarted) igniteStarted = now;
            if (nextPhase === "burst" && !burstStarted) burstStarted = now;

            if (["meteor", "ignite", "burst"].includes(phase)) {
                requestDraw();
            } else if (meteorStarted) {
                if (animationFrame) cancelAnimationFrame(animationFrame);
                animationFrame = 0;
                context.clearRect(0, 0, width, height);
            }
        };

        const stop = () => {
            if (stopped) return;
            stopped = true;
            if (animationFrame) cancelAnimationFrame(animationFrame);
            animationFrame = 0;
            resizeObserver?.disconnect();
            history.length = 0;
            particles.length = 0;
            debris.length = 0;
            context.clearRect(0, 0, width, height);
        };

        return { setPhase, stop };
    }

    /**
     * 播放全屏抽取演出，结束后才将结果发送至聊天栏。
     */
    async _playDrawAnimation(items, { title }) {
        const TextEditor = foundry.applications.ux.TextEditor.implementation;
        const drawItems = items.map((item, index) => {
            const rarity = this._getRarityPresentation(item);
            return {
                uuid: item.uuid,
                name: item.name,
                img: item.img,
                typeLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
                rarityLabel: game.i18n.localize(rarity.nameKey),
                drawClass: rarity.drawClass,
                marks: Array.from({ length: Math.max(1, Math.min(5, rarity.power + 1)) }),
                displayNumber: String(index + 1).padStart(2, "0"),
                // 大批量抽取时将错峰时间封顶，避免 50 抽等待过久。
                order: Math.min(index, 12),
                power: rarity.power
            };
        });
        // 十连以内保留逐件显形；大批量抽取直接进入总览，避免重复创建整套大图节点。
        const useShowcase = drawItems.length <= 10;
        const highest = drawItems.reduce((best, item) => item.power > best.power ? item : best, drawItems[0]);
        const particleCount = Math.min(30, 16 + (highest.power * 2));
        const particles = Array.from({ length: particleCount }, (_, index) => ({
            x: (index * 37) % 101,
            y: (index * 61) % 97,
            delay: ((index * 17) % 23) / 10,
            duration: 2.8 + ((index * 13) % 18) / 10,
            size: 2 + ((index * 7) % 5)
        }));
        const content = await renderTemplate(
            "systems/xjzl-system/templates/apps/compendiumbrowser/draw-reveal.hbs",
            {
                title,
                items: drawItems,
                isSingle: drawItems.length === 1,
                isLarge: drawItems.length > 10,
                isMassive: drawItems.length > 30,
                useShowcase,
                countText: game.i18n.format("XJZL.CompendiumBrowser.Draw.Count", { count: drawItems.length }),
                totalDisplay: String(drawItems.length).padStart(2, "0"),
                highestRarity: highest.drawClass,
                particles
            }
        );
        const detailByUuid = new Map(drawItems.map(item => [item.uuid, item]));

        // 防止连续触发时遗留多个演出层。
        this._drawOverlayCleanup?.();
        this._drawOverlay?.remove();
        const shell = document.createElement("div");
        shell.innerHTML = content.trim();
        const stage = shell.firstElementChild;
        if (!stage) return;

        const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        const drawAudio = this._createDrawAudio({ reducedMotion });
        await drawAudio.preload();

        this._drawOverlay = stage;
        document.body.append(stage);

        return new Promise(resolve => {
            let mode = "cinematic";
            let showcaseIndex = -1;
            let detailOpen = false;
            let sequenceTimer;
            let teardownTimer;
            let finished = false;
            const phaseTimers = [];
            const showcaseItems = Array.from(stage.querySelectorAll("[data-showcase-index]"));
            const actionControls = Array.from(stage.querySelectorAll("[data-draw-action]"));
            const resultCards = Array.from(stage.querySelectorAll("[data-draw-uuid]"));
            const meteorAnimation = this._createDrawMeteorAnimation(stage, {
                debrisIntensity: Math.min(1.5, 0.72 + (drawItems.length * 0.08)),
                companionCount: Math.min(6, Math.max(0, drawItems.length - 1)),
                reducedMotion
            });

            const setPhase = phase => {
                stage.dataset.phase = phase;
                meteorAnimation.setPhase(phase);
                if (phase === "meteor") void drawAudio.play("meteor");
                if (phase === "ignite") void drawAudio.play("rarity");
                if (phase === "burst") void drawAudio.play("reveal");
            };

            const closeDetail = () => {
                if (!detailOpen) return;
                detailOpen = false;
                stage.classList.remove("has-detail");
                const detail = stage.querySelector(".xjzl-draw-detail");
                detail?.setAttribute("aria-hidden", "true");
            };

            const showDetail = async uuid => {
                const item = detailByUuid.get(uuid);
                const detail = stage.querySelector(".xjzl-draw-detail");
                if (!item || !detail) return;

                detail.dataset.uuid = uuid;
                detail.dataset.rarity = item.drawClass;
                const image = detail.querySelector(".xjzl-draw-detail-image");
                if (image) {
                    image.src = item.img;
                    image.alt = item.name;
                }
                const rarity = detail.querySelector(".xjzl-draw-detail-rarity");
                const name = detail.querySelector(".xjzl-draw-detail-name");
                const type = detail.querySelector(".xjzl-draw-detail-type");
                const marks = detail.querySelector(".xjzl-draw-detail-marks");
                const description = detail.querySelector(".xjzl-draw-detail-description");

                if (rarity) rarity.textContent = item.rarityLabel;
                if (name) name.textContent = item.name;
                if (type) type.textContent = item.typeLabel;
                if (marks) {
                    marks.replaceChildren(...item.marks.map(() => {
                        const mark = document.createElement("i");
                        mark.className = "fas fa-diamond";
                        return mark;
                    }));
                }
                if (description) description.innerHTML = item.description
                    ?? `<p class="xjzl-draw-detail-loading"><i class="fas fa-spinner fa-spin"></i> ${game.i18n.localize("XJZL.CompendiumBrowser.Draw.LoadingDescription")}</p>`;

                detailOpen = true;
                detail.setAttribute("aria-hidden", "false");
                stage.classList.add("has-detail");
                detail.querySelector("[data-draw-action='detail-close']")?.focus({ preventScroll: true });

                if (item.description !== undefined) return;
                try {
                    const itemDocument = await fromUuid(uuid);
                    item.description = itemDocument
                        ? await TextEditor.enrichHTML(itemDocument.system?.description ?? "", {
                            secrets: itemDocument.isOwner,
                            async: true,
                            relativeTo: itemDocument
                        })
                        : "";
                } catch (error) {
                    console.error(`XJZL Browser | Failed to load draw detail: ${uuid}`, error);
                    item.description = "";
                }

                // 用户可能已切换或关闭详情，只更新当前仍在展示的条目。
                if (detail.dataset.uuid === uuid && description) {
                    description.innerHTML = item.description
                        || `<p>${game.i18n.localize("XJZL.CompendiumBrowser.Draw.NoDescription")}</p>`;
                }
            };

            const showSummary = () => {
                if (mode === "summary") return;
                mode = "summary";
                clearTimeout(sequenceTimer);
                phaseTimers.forEach(clearTimeout);
                meteorAnimation.stop();
                drawAudio.stop({ fade: reducedMotion ? 0 : 180 });
                stage.dataset.rarity = highest.drawClass;
                stage.classList.remove("is-showcase");
                stage.classList.add("is-revealed", "is-summary");
                setPhase("result");
                stage.querySelector("[data-draw-action='accept']")?.focus({ preventScroll: true });

                // 淡出完成后卸载高开销电影/显形层，结果页只保留静态氛围与卡片。
                teardownTimer = setTimeout(() => {
                    if (mode !== "summary") return;
                    stage.querySelector(".xjzl-draw-cinematic")?.remove();
                    stage.querySelector(".xjzl-draw-showcase")?.remove();
                }, reducedMotion ? 0 : 600);
            };

            const activateShowcaseItem = index => {
                const item = drawItems[index];
                if (!item) return showSummary();

                showcaseIndex = index;
                stage.dataset.rarity = item.drawClass;
                showcaseItems.forEach(node => {
                    node.classList.toggle("is-current", Number(node.dataset.showcaseIndex) === index);
                });

                const current = stage.querySelector("[data-showcase-current]");
                if (current) current.textContent = item.displayNumber;
                const nextLabel = stage.querySelector("[data-showcase-next-label]");
                if (nextLabel) {
                    nextLabel.textContent = game.i18n.localize(
                        index === drawItems.length - 1
                            ? "XJZL.CompendiumBrowser.Draw.ShowSummary"
                            : "XJZL.CompendiumBrowser.Draw.NextItem"
                    );
                }
                stage.querySelector("[data-draw-action='showcase-next']")?.focus({ preventScroll: true });
            };

            const beginShowcase = () => {
                if (mode !== "cinematic") return;
                mode = "showcase";
                clearTimeout(sequenceTimer);
                phaseTimers.forEach(clearTimeout);
                meteorAnimation.stop();
                drawAudio.stop();
                stage.classList.add("is-showcase");
                setPhase("showcase");
                activateShowcaseItem(0);
            };

            const nextShowcaseItem = () => {
                if (mode !== "showcase") return;
                if (showcaseIndex >= drawItems.length - 1) showSummary();
                else activateShowcaseItem(showcaseIndex + 1);
            };

            const finish = (immediate = false) => {
                if (finished) return;
                finished = true;
                clearTimeout(sequenceTimer);
                clearTimeout(teardownTimer);
                phaseTimers.forEach(clearTimeout);
                meteorAnimation.stop();
                drawAudio.stop({ fade: immediate ? 0 : 120 });
                document.removeEventListener("keydown", onKeyDown);
                actionControls.forEach(control => control.removeEventListener("click", onActionClick));
                resultCards.forEach(card => card.removeEventListener("click", onCardClick));
                stage.classList.add("is-closing");
                setTimeout(() => stage.remove(), immediate || reducedMotion ? 0 : 240);
                if (this._drawOverlay === stage) this._drawOverlay = null;
                if (this._drawOverlayCleanup === cleanupOverlay) this._drawOverlayCleanup = null;
                resolve();
            };
            const cleanupOverlay = () => finish(true);
            this._drawOverlayCleanup = cleanupOverlay;

            const onKeyDown = event => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                if (detailOpen) closeDetail();
                else if (mode === "summary") finish();
                else showSummary();
            };

            const onActionClick = event => {
                event.preventDefault();
                event.stopPropagation();
                const action = event.currentTarget.dataset.drawAction;
                if (action === "skip") return showSummary();
                if (action === "showcase-next") return nextShowcaseItem();
                if (action === "accept") return finish();
                if (action === "detail-close") return closeDetail();
            };

            const onCardClick = event => {
                event.preventDefault();
                event.stopPropagation();
                if (mode === "summary") showDetail(event.currentTarget.dataset.drawUuid);
            };

            actionControls.forEach(control => control.addEventListener("click", onActionClick));
            resultCards.forEach(card => card.addEventListener("click", onCardClick));
            document.addEventListener("keydown", onKeyDown);
            requestAnimationFrame(() => {
                stage.classList.add("is-active");
                stage.focus({ preventScroll: true });
                void drawAudio.play("bed");
            });

            if (reducedMotion) {
                sequenceTimer = setTimeout(showSummary, 50);
            } else {
                phaseTimers.push(setTimeout(() => setPhase("grasp"), 900));
                phaseTimers.push(setTimeout(() => setPhase("sword"), 1750));
                phaseTimers.push(setTimeout(() => setPhase("rift"), 2700));
                phaseTimers.push(setTimeout(() => setPhase("archive"), 3900));
                // 星核沿路径飞行 3.6 秒；稀有度颜色从星核向尾迹传播，而不是整张素材变色。
                phaseTimers.push(setTimeout(() => setPhase("meteor"), 4550));
                phaseTimers.push(setTimeout(() => setPhase("ignite"), 6900));
                phaseTimers.push(setTimeout(() => setPhase("burst"), 7900));
                sequenceTimer = setTimeout(useShowcase ? beginShowcase : showSummary, 9300);
            }
        });
    }

    async _generateLootChatCard(items, { alias, title }) {
        const renderData = {
            title: title,
            items: items.map(i => {
                const rarity = this._getRarityPresentation(i);

                return {
                    uuid: i.uuid, name: i.name, img: i.img, type: i.type,
                    colorClass: rarity.colorClass,
                    label: rarity.label
                };
            })
        };

        const content = await renderTemplate("systems/xjzl-system/templates/chat/loot-card.hbs", renderData);
        ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ alias: alias }),
            content: content,
            flags: { "xjzl-system": { type: "loot-card" } }
        });
    }
}
