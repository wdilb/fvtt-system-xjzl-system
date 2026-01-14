/**
 * ==============================================================================
 *  XJZL 江湖万卷阁 (Compendium Browser) - V13 Optimized
 * ==============================================================================
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const renderTemplate = foundry.applications.handlebars.renderTemplate;

export class XJZLCompendiumBrowser extends HandlebarsApplicationMixin(ApplicationV2) {

    constructor(options) {
        super(options);

        /** @type {Object<string, Array>} 缓存所有索引数据，按 Tab 分类 */
        this.cachedData = {};

        /** @type {boolean} 数据是否加载完毕 */
        this.isLoaded = false;

        /** @type {Object} UI 交互状态 */
        this.browserState = {
            activeTab: "weapon",
            searchQuery: "",
            filters: {} // 结构: { key: Set<value> }
        };

        // 防抖搜索：200ms 延迟，避免输入过快导致频繁计算
        this._debouncedSearch = foundry.utils.debounce(this._performSearch.bind(this), 200);
    }

    static DEFAULT_OPTIONS = {
        tag: "div",
        id: "xjzl-compendium-browser",
        classes: ["compendium-browser", "theme-dark"],
        position: { width: 950, height: 750 },
        window: {
            title: "江湖万卷阁",
            icon: "fas fa-book-open",
            resizable: true
        },
        // 利用 AppV2 的 actions 映射处理点击事件，比手动绑定更高效
        actions: {
            refresh: XJZLCompendiumBrowser.prototype.refreshData,
            changeTab: XJZLCompendiumBrowser.prototype._onChangeTab,
            openSheet: XJZLCompendiumBrowser.prototype._onOpenSheet,
            resetFilters: XJZLCompendiumBrowser.prototype._onResetFilters,
            randomize: XJZLCompendiumBrowser.prototype._onRandomizeClick
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
        { id: "weapon", label: "武器", icon: "fas fa-sword" },
        { id: "armor", label: "防具", icon: "fas fa-tshirt" },
        { id: "consumable", label: "消耗品", icon: "fas fa-flask" },
        { id: "misc", label: "杂物", icon: "fas fa-box-open" },
        { id: "qizhen", label: "奇珍", icon: "fas fa-gem" },
        { id: "wuxue", label: "武学", icon: "fas fa-fist-raised" },
        { id: "neigong", label: "内功", icon: "fas fa-yin-yang" },
        { id: "art_book", label: "技艺", icon: "fas fa-book" },
    ];

    static INDEX_FIELDS = [
        "img", "system.quantity", "system.price", "system.quality",
        "system.type", "system.subtype", "system.tier",
        "system.sect", "system.element", "system.category",
        "system.moves", "system.artType", "system.damageType", "system.weaponType"
    ];

    /**
     * 获取筛选器配置
     */
    get filterConfig() {
        const C = CONFIG.XJZL;
        const elemOpts = { taiji: "太极", yin: "阴", yang: "阳", gang: "刚", rou: "柔", none: "无" };
        const neigongOpts = { taiji: "太极", yin: "阴柔", yang: "阳刚" };

        return {
            weapon: [
                { key: "type", label: "武器类型", type: "checkbox", options: C.weaponTypes },
                { key: "quality", label: "品质", type: "checkbox", options: C.qualities },
            ],
            armor: [
                { key: "type", label: "防具部位", type: "checkbox", options: C.armorTypes },
                { key: "quality", label: "品质", type: "checkbox", options: C.qualities }
            ],
            consumable: [
                { key: "type", label: "分类", type: "checkbox", options: C.consumableTypes },
                { key: "quality", label: "品质", type: "checkbox", options: C.qualities }
            ],
            misc: [{ key: "quality", label: "品质", type: "checkbox", options: C.qualities }],
            qizhen: [{ key: "quality", label: "品质", type: "checkbox", options: C.qualities }],
            wuxue: [
                { key: "sect", label: "所属门派", type: "checkbox", options: C.sects },
                { key: "category", label: "武学类别", type: "checkbox", options: C.wuxueCategories },
                { key: "tier", label: "武学品阶", type: "checkbox", options: C.tiers },
                { key: "element", label: "武学属性", type: "checkbox", options: elemOpts },
                { key: "damageType", label: "伤害类型", type: "checkbox", options: C.damageTypes },
                { key: "weaponType", label: "兵器要求", type: "checkbox", options: C.weaponTypes }
            ],
            neigong: [
                { key: "sect", label: "所属门派", type: "checkbox", options: C.sects },
                { key: "tier", label: "内功品阶", type: "checkbox", options: C.tiers },
                { key: "element", label: "内功属性", type: "checkbox", options: neigongOpts }
            ],
            art_book: [{ key: "artType", label: "技艺类型", type: "checkbox", options: C.arts }]
        };
    }

    /* -------------------------------------------- */
    /*  数据加载                                     */
    /* -------------------------------------------- */

    async loadData() {
        ui.notifications.info("正在编纂江湖图谱...");

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
                        // 预计算小写名称，搜索性能提升
                        entry._searchName = (entry.name || "").toLowerCase();
                        entry.packLabel = pack.metadata.label;

                        tempCache[entry.type].push(entry);
                    }
                }
            } catch (err) { console.error(`XJZL Browser | Pack Load Error: ${pack.collection}`, err); }
        };

        await Promise.all(targetPacks.map(pack => loadPackIndex(pack)));

        // 简单按名称排序，提升浏览体验
        for (const key in tempCache) {
            tempCache[key].sort((a, b) => a.name.localeCompare(b.name, "zh"));
        }

        this.cachedData = tempCache;
        this.isLoaded = true;
        ui.notifications.info("图谱编纂完成。");

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

        // 使用自定义标记防止重复绑定
        // AppV2 可能会替换整个 element，因此每次渲染都需要重新检查并绑定非 actions 事件
        if (this.element.hasAttribute("data-listeners-ready")) return;

        const html = this.element;

        // 1. 搜索框 (Input 事件无法通过 actions 处理)
        html.addEventListener("input", (event) => {
            if (event.target.name === "search") this._onSearch(event);
        });

        // 2. 筛选器 (Change 事件)
        html.addEventListener("change", (event) => {
            if (event.target.classList.contains("xjzl-filter-checkbox")) this._onFilterChange(event);
        });

        // 3. 拖拽代理 (Drag Delegation)
        html.addEventListener("dragstart", (event) => {
            const card = event.target.closest(".xjzl-cb-card");
            if (!card?.dataset.dragData) return;

            event.dataTransfer.setData("text/plain", card.dataset.dragData);
            event.dataTransfer.effectAllowed = "copy";
        });

        this.element.setAttribute("data-listeners-ready", "true");
    }

    _onChangeTab(event, target) {
        const newTab = target.dataset.tab;
        if (newTab && newTab !== this.browserState.activeTab) {
            this.browserState.activeTab = newTab;
            this.browserState.filters = {}; // 切换标签时重置筛选
            this.browserState.searchQuery = ""; // 切换标签时重置搜索
            this.render(); // 全量刷新
        }
    }

    _onSearch(event) {
        event.preventDefault();
        // 传入原始值，防抖函数会处理
        this._debouncedSearch(event.target.value.trim());
    }

    _performSearch(query) {
        if (query !== this.browserState.searchQuery) {
            this.browserState.searchQuery = query;
            // 局部刷新：只更新内容区，保持侧边栏状态和光标
            this.render({ parts: ["content"] });
        }
    }

    async _onOpenSheet(event, target) {
        event.stopPropagation();
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

        if (!this.browserState.filters[filterKey]) {
            this.browserState.filters[filterKey] = new Set();
        }

        const filterSet = this.browserState.filters[filterKey];
        if (isChecked) filterSet.add(value);
        else {
            filterSet.delete(value);
            if (filterSet.size === 0) delete this.browserState.filters[filterKey];
        }

        this.render({ parts: ["content"] });
    }

    _onResetFilters() {
        this.browserState.searchQuery = "";
        this.browserState.filters = {};

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

    /* -------------------------------------------- */
    /*  数据准备 (Context)                          */
    /* -------------------------------------------- */

    async _prepareContext(options) {
        const activeTab = this.browserState.activeTab;
        const rawItems = this.cachedData[activeTab] || [];

        // 1. 过滤
        const filteredItems = this._filterItems(rawItems);

        // 2. 虚拟滚动/分页裁剪 (Render 限制前 100 个以保证打开速度)
        const displayLimit = 100;
        const displayItems = filteredItems.slice(0, displayLimit);

        // 3. 构建筛选器 UI 数据
        const currentFilters = this.browserState.filters;
        const filterConfigs = this.filterConfig[activeTab] || [];

        // 优化：使用 reduce 或 map 构建 UI 数据
        const filterList = filterConfigs.map(config => ({
            ...config,
            options: Object.entries(config.options).map(([val, labelKey]) => ({
                val: val,
                label: game.i18n.localize(labelKey),
                checked: currentFilters[config.key]?.has(val.toString()) ?? false
            }))
        }));

        return {
            isLoaded: this.isLoaded,
            tabs: XJZLCompendiumBrowser.TABS,
            activeTab: activeTab,
            items: displayItems,
            totalCount: filteredItems.length,
            displayCount: displayItems.length,
            isClipped: filteredItems.length > displayLimit,
            searchQuery: this.browserState.searchQuery,
            filterList: filterList
        };
    }

    /* -------------------------------------------- */
    /*  核心功能：内存过滤引擎                       */
    /* -------------------------------------------- */

    /**
     * 高性能内存过滤器
     * 复杂度优化至 O(N * M)，利用预计算的 _searchName 加速
     */
    _filterItems(items, filters = null, query = null) {
        const activeFilters = filters || this.browserState.filters;
        const activeQuery = (query !== null ? query : this.browserState.searchQuery).toLowerCase();

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
        const filters = options.filters || this.browserState.filters;
        const amount = options.amount || 1;
        const useWeight = options.weighted ?? true;
        const rawItems = this.cachedData[tab] || [];

        // 1. 获取候选池
        const pool = this._filterItems(rawItems, filters, ""); // 忽略搜索词进行随机
        if (pool.length === 0) {
            ui.notifications.warn(`分类 [${tab}] 下无符合筛选的物品。`);
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

        if (currentPool.length === 0) return ui.notifications.warn("列表为空，无法抽取。");

        const isTier = ["wuxue", "neigong"].includes(activeTab);

        // 动态生成权重 HTML
        const buildInput = (l, n, v, c) => `
            <div style="text-align:center;">
                <label style="font-size:0.8em;color:${c};font-weight:bold;">${l}</label>
                <input type="number" name="${n}" value="${v}" min="0" style="text-align:center;padding:2px;width:100%;">
            </div>`;

        let weightHtml;
        if (isTier) {
            weightHtml = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;">
                ${buildInput("人级", "w_1", 100, "#666")}
                ${buildInput("地级", "w_2", 20, "#8d6e63")}
                ${buildInput("天级", "w_3", 5, "#d4af37")}
            </div>`;
        } else {
            weightHtml = `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;">
                ${buildInput("凡", "w_0", 100, "#666")}
                ${buildInput("铜", "w_1", 60, "#8d6e63")}
                ${buildInput("银", "w_2", 30, "#95a5a6")}
                ${buildInput("金", "w_3", 10, "#d4af37")}
                ${buildInput("玉", "w_4", 2, "#2ecc71")}
            </div>`;
        }

        const content = `
            <div class="form-group" style="display:flex;gap:10px;margin-bottom:10px;">
                <label style="flex:1;">数量 <input type="number" name="amount" value="1" min="1" max="50"></label>
                <label style="flex:2;">发送者 <input type="text" name="alias" value="江湖奇遇"></label>
            </div>
            <div style="margin-bottom:10px;"><label>标题 <input type="text" name="title" value="随机结果"></label></div>
            <fieldset style="border:1px solid #ccc;padding:10px;border-radius:4px;">
                <legend><i class="fas fa-balance-scale"></i> 权重配置</legend>
                ${weightHtml}
            </fieldset>
            <p style="text-align:center;font-size:0.85em;color:#666;margin-top:10px;">将在 <strong>${currentPool.length}</strong> 个物品中抽取</p>
        `;

        const result = await DialogV2.wait({
            window: { title: "随机战利品", icon: "fas fa-dice-d20", resizable: false },
            content: content,
            buttons: [{
                action: "ok", label: "抽取", icon: "fas fa-check",
                callback: (event, button) => {
                    const form = button.form;
                    const w = {};
                    if (isTier) [1, 2, 3].forEach(i => w[i] = parseInt(form.elements[`w_${i}`].value) || 0);
                    else[0, 1, 2, 3, 4].forEach(i => w[i] = parseInt(form.elements[`w_${i}`].value) || 0);

                    return {
                        amount: parseInt(form.elements.amount.value) || 1,
                        alias: form.elements.alias.value || "江湖奇遇",
                        title: form.elements.title.value || "随机结果",
                        weights: w
                    };
                }
            }],
            close: () => null
        });

        if (result) {
            const items = await this.randomize({ amount: result.amount, weighted: true, customWeights: result.weights });
            if (items.length) this._generateLootChatCard(items, result);
        }
    }

    async _generateLootChatCard(items, { alias, title }) {
        const renderData = {
            title: title,
            items: items.map(i => {
                const sys = i.system;
                const isWuxue = i.type === "wuxue" || i.type === "neigong";
                const val = isWuxue ? (sys.tier ?? 1) : (sys.quality ?? 0);
                const labels = isWuxue ? { 1: "人", 2: "地", 3: "天" } : { 0: "凡", 1: "铜", 2: "银", 3: "金", 4: "玉" };

                return {
                    uuid: i.uuid, name: i.name, img: i.img, type: i.type,
                    colorClass: isWuxue ? `tier-${val}` : `quality-${val}`,
                    label: labels[val] || "?"
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