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
        { id: "trait", label: "特效", icon: "fas fa-seedling" },
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
        const elemOpts = { taiji: "太极", yin: "阴", yang: "阳", gang: "刚", rou: "柔", none: "无" };
        const neigongOpts = { taiji: "太极", yin: "阴柔", yang: "阳刚" };
        const officialOpts = { "true": "是", "false": "否" };
        const config = {
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
                { key: "subSect", label: "江湖势力分支", type: "checkbox", options: C.subSects },
                { key: "category", label: "武学类别", type: "checkbox", options: C.wuxueCategories },
                { key: "tier", label: "武学品阶", type: "checkbox", options: C.tiers },
                { key: "element", label: "武学属性", type: "checkbox", options: elemOpts },
                { key: "damageType", label: "伤害类型", type: "checkbox", options: C.damageTypes },
                { key: "weaponType", label: "兵器要求", type: "checkbox", options: C.weaponTypes }
            ],
            neigong: [
                { key: "sect", label: "所属门派", type: "checkbox", options: C.sects },
                { key: "subSect", label: "江湖势力分支", type: "checkbox", options: C.subSects },
                { key: "tier", label: "内功品阶", type: "checkbox", options: C.tiers },
                { key: "element", label: "内功属性", type: "checkbox", options: neigongOpts }
            ],
            art_book: [{ key: "artType", label: "技艺类型", type: "checkbox", options: C.arts }],
            trait: [
                { key: "type", label: "特效分类", type: "checkbox", options: C.traitTypes }
            ]
        };

        for (const tab in config) {
            config[tab].unshift({
                key: "isOfficial",
                label: "官方资源",
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

        // 使用 reduce 或 map 构建 UI 数据
        const filterList = filterConfigs.map(config => ({
            ...config,
            isOpen: config.key !== "subSect", // 只要不是 subSect，就默认展开
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
                    colorClass: "tier-1", drawClass: "tier-1", label: "人",
                    nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Tier1", power: 1
                },
                2: {
                    colorClass: "tier-2", drawClass: "tier-2", label: "地",
                    nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Tier2", power: 4
                },
                3: {
                    colorClass: "tier-3", drawClass: "tier-3", label: "天",
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
                label: typeKey ? game.i18n.localize(typeKey).substring(0, 2) : "特质",
                nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Trait",
                power: 4
            };
        }

        const rawQuality = Number(sys.quality ?? 0);
        const quality = Number.isFinite(rawQuality) ? Math.min(4, Math.max(0, rawQuality)) : 0;
        const qualities = {
            0: {
                colorClass: "quality-0", drawClass: "quality-0", label: "凡",
                nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Quality0", power: 0
            },
            1: {
                colorClass: "quality-1", drawClass: "quality-1", label: "铜",
                nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Quality1", power: 1
            },
            2: {
                colorClass: "quality-2", drawClass: "quality-2", label: "银",
                nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Quality2", power: 2
            },
            3: {
                colorClass: "quality-3", drawClass: "quality-3", label: "金",
                nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Quality3", power: 4
            },
            4: {
                colorClass: "quality-4", drawClass: "quality-4", label: "玉",
                nameKey: "XJZL.CompendiumBrowser.Draw.Rarity.Quality4", power: 5
            }
        };
        return qualities[quality];
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
        const meteors = drawItems.map((item, index) => ({
            rarity: item.drawClass,
            x: 12 + ((index * 29) % 77),
            y: 17 + ((index * 41) % 52),
            delay: (((index * 37) % Math.max(1, drawItems.length)) / Math.max(1, drawItems.length)) * 0.65,
            duration: 1.45 + (((index * 11) % 7) / 18),
            length: 230 + (item.power * 26) + ((index * 23) % 92),
            angle: -36 + ((index * 7) % 14)
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
                particles,
                meteors
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

        this._drawOverlay = stage;
        document.body.append(stage);

        return new Promise(resolve => {
            let mode = "cinematic";
            let showcaseIndex = -1;
            let detailOpen = false;
            let sequenceTimer;
            let teardownTimer;
            let finished = false;
            const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
            const phaseTimers = [];
            const showcaseItems = Array.from(stage.querySelectorAll("[data-showcase-index]"));
            const actionControls = Array.from(stage.querySelectorAll("[data-draw-action]"));
            const resultCards = Array.from(stage.querySelectorAll("[data-draw-uuid]"));

            const setPhase = phase => {
                stage.dataset.phase = phase;
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
            });

            if (reducedMotion) {
                sequenceTimer = setTimeout(showSummary, 50);
            } else {
                phaseTimers.push(setTimeout(() => setPhase("grasp"), 900));
                phaseTimers.push(setTimeout(() => setPhase("sword"), 1750));
                phaseTimers.push(setTimeout(() => setPhase("rift"), 2700));
                phaseTimers.push(setTimeout(() => setPhase("archive"), 3900));
                phaseTimers.push(setTimeout(() => setPhase("burst"), 5500));
                sequenceTimer = setTimeout(useShowcase ? beginShowcase : showSummary, 6300);
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
