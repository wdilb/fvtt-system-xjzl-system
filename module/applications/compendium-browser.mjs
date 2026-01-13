/**
 * ==============================================================================
 *  ⚔️ XJZL 江湖万卷阁 (Compendium Browser)
 * ==============================================================================
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const renderTemplate = foundry.applications.handlebars.renderTemplate;

export class XJZLCompendiumBrowser extends HandlebarsApplicationMixin(ApplicationV2) {

    constructor(options) {
        super(options);

        // --- 数据缓存 ---
        // 结构: { "weapon": [ItemIndex, ...], "wuxue": [ItemIndex, ...] }
        this.cachedData = {};

        // --- 状态标记 ---
        this.isLoaded = false;

        // --- UI 状态 ---
        this.browserState = {
            activeTab: "weapon", // 当前激活的标签页
            searchQuery: "",     // 搜索关键词
            filters: {}          // 筛选条件 { key: Set(values) }
        };

        // --- 性能优化：防抖搜索 ---
        // 避免用户每输入一个字符就重绘一次，延迟 300ms 执行
        this._debouncedSearch = foundry.utils.debounce(this._performSearch.bind(this), 300);
    }

    /**
     * ✅ V13 标准应用配置
     */
    static DEFAULT_OPTIONS = {
        tag: "div",
        id: "xjzl-compendium-browser",
        classes: ["compendium-browser", "theme-dark"],
        position: {
            width: 950,
            height: 750
        },
        window: {
            title: "📖 江湖万卷阁",
            icon: "fas fa-book-open",
            resizable: true
        },
        actions: {
            refresh: XJZLCompendiumBrowser.prototype.refreshData,
            changeTab: XJZLCompendiumBrowser.prototype._onChangeTab,
            openSheet: XJZLCompendiumBrowser.prototype._onOpenSheet,
            resetFilters: XJZLCompendiumBrowser.prototype._onResetFilters,
            randomize: XJZLCompendiumBrowser.prototype._onRandomizeClick
        }
    };

    static PARTS = {
        main: {
            template: "systems/xjzl-system/templates/apps/compendium-browser.hbs",
            scrollable: [".xjzl-cb-sidebar", ".xjzl-cb-content"] // 允许侧边栏和内容区独立滚动
        }
    };

    // 📋 定义所有可用的 Tabs (对应 Item Type)
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

    /**
     * ⚡ 核心索引字段配置
     * 定义我们需要从数据库中预加载哪些字段。
     * ⚠️ 注意：尽量不要索引大文本(如 description HTML)，会消耗大量内存。
     */
    static INDEX_FIELDS = [
        "img",
        // "system.description", // 暂时关闭描述索引，除非确实需要搜索全文

        // --- 通用/装备类 ---
        "system.quantity",
        "system.price",
        "system.quality", // 品质 (0-4)
        "system.type",    // 类型
        "system.subtype", // 子类型
        "system.tier",    // 品阶 (1-3)

        // --- 武学/内功类 ---
        "system.sect",     // 门派
        "system.element",  // 五行
        "system.category", // 分类
        "system.moves",    // 招式列表 (用于深度筛选)

        // --- 技艺书 ---
        "system.artType"
    ];

    /**
     * ⚙️ 筛选器配置定义
     * 用于生成左侧的筛选 UI
     */
    get filterConfig() {
        const C = CONFIG.XJZL;

        // 辅助对象：本地化选项
        const elementOptions = { taiji: "太极", yin: "阴", yang: "阳", gang: "刚", rou: "柔", none: "无" };
        const neigongElementOptions = { taiji: "太极", yin: "阴柔", yang: "阳刚" };

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
            misc: [
                { key: "quality", label: "品质", type: "checkbox", options: C.qualities }
            ],
            qizhen: [
                { key: "quality", label: "品质", type: "checkbox", options: C.qualities }
            ],
            wuxue: [
                { key: "sect", label: "所属门派", type: "checkbox", options: C.sects },
                { key: "category", label: "武学类别", type: "checkbox", options: C.wuxueCategories },
                { key: "tier", label: "武学品阶", type: "checkbox", options: C.tiers },
                { key: "element", label: "武学属性", type: "checkbox", options: elementOptions },
                { key: "damageType", label: "伤害类型", type: "checkbox", options: C.damageTypes },
                { key: "weaponType", label: "兵器要求", type: "checkbox", options: C.weaponTypes }
            ],
            neigong: [
                { key: "sect", label: "所属门派", type: "checkbox", options: C.sects },
                { key: "tier", label: "内功品阶", type: "checkbox", options: C.tiers },
                { key: "element", label: "内功属性", type: "checkbox", options: neigongElementOptions }
            ],
            art_book: [
                { key: "artType", label: "技艺类型", type: "checkbox", options: C.arts }
            ]
        };
    }

    /* -------------------------------------------- */
    /*  数据加载与缓存 (Data Loading)               */
    /* -------------------------------------------- */

    /**
     * 📥 数据加载主函数
     * 遍历所有合集包，构建内存索引
     * 使用 Promise.all 并发加载所有合集包索引，大幅提升启动速度。
     */
    async loadData() {
        ui.notifications.info("正在编纂江湖图谱...");
        const startTime = performance.now(); // 性能计时开始

        // 1. 初始化容器
        const tempCache = {};
        XJZLCompendiumBrowser.TABS.forEach(t => tempCache[t.id] = []);

        // 2. 筛选需要加载的包 (先过滤，不执行)
        const targetPacks = game.packs.filter(p =>
            p.metadata.type === "Item" &&
            p.metadata.system === "xjzl-system"
        );

        console.log(`XJZL Browser | 开始并行索引 ${targetPacks.length} 个合集包...`);

        // 3. 定义单个包的加载逻辑
        // 这个函数是异步的，但不会阻塞主线程
        const loadPackIndex = async (pack) => {
            try {
                // 并行关键点：这里的 await 不会阻塞其他 pack 的执行
                const index = await pack.getIndex({ fields: XJZLCompendiumBrowser.INDEX_FIELDS });

                // 将数据填入临时缓存
                for (const entry of index) {
                    // 只记录我们关心的 Item 类型 (在 TABS 中定义的)
                    if (tempCache[entry.type]) {
                        // 预处理数据
                        // 如果 uuid 不存在 (某些旧版本核心)，手动补全
                        entry.uuid = entry.uuid || `Compendium.${pack.collection}.${entry._id}`;
                        entry.packLabel = pack.metadata.label;

                        // JS 的数组 push 操作是同步的，不会在 Promise.all 中发生竞争条件
                        tempCache[entry.type].push(entry);
                    }
                }
            } catch (err) {
                console.error(`XJZL Browser | 加载合集包 [${pack.metadata.label}] 失败:`, err);
                // 这里 catch 住错误，防止一个包损坏导致整个浏览器打不开
            }
        };

        // 4. 并发执行所有任务
        // map 返回一组 Promise，Promise.all 等待它们全部完成
        await Promise.all(targetPacks.map(pack => loadPackIndex(pack)));

        // 5. 完成并赋值
        this.cachedData = tempCache;
        this.isLoaded = true;

        const endTime = performance.now();
        console.log(`XJZL Browser | 索引完成，共加载 ${this._getTotalCount()} 个物品。耗时: ${(endTime - startTime).toFixed(2)}ms`);

        ui.notifications.info("图谱编纂完成。");

        if (this.rendered) this.render();
    }

    /**
     * 🔄 强制刷新数据
     */
    async refreshData() {
        this.isLoaded = false;
        this.render(); // 显示 Loading 状态
        await this.loadData();
    }

    /* -------------------------------------------- */
    /*  事件处理 (Event Handlers)                   */
    /* -------------------------------------------- */

    _onChangeTab(event, target) {
        const newTab = target.dataset.tab;
        if (newTab && newTab !== this.browserState.activeTab) {
            this.browserState.activeTab = newTab;
            // 切换 Tab 时，体验上最好保留搜索词，但重置筛选器
            this.browserState.filters = {};
            this.render();
        }
    }

    _onSearch(event) {
        event.preventDefault();
        // 触发防抖函数
        this._debouncedSearch(event.target.value.trim());
    }

    // 实际执行搜索逻辑（被防抖调用）
    _performSearch(query) {
        if (query !== this.browserState.searchQuery) {
            this.browserState.searchQuery = query;
            this.render();
        }
    }

    async _onOpenSheet(event, target) {
        event.stopPropagation(); // 防止触发卡片的拖拽事件
        const uuid = target.dataset.uuid;
        if (!uuid) return;

        try {
            const item = await fromUuid(uuid);
            if (item) item.sheet.render(true);
            else ui.notifications.warn("无法找到该物品，可能已被删除。");
        } catch (err) {
            console.error("XJZL Browser | Open Sheet Error:", err);
        }
    }

    _onFilterChange(event) {
        const target = event.target;
        const filterKey = target.dataset.filter;
        const value = target.value;
        const isChecked = target.checked;

        // 懒初始化 Set
        if (!this.browserState.filters[filterKey]) {
            this.browserState.filters[filterKey] = new Set();
        }

        const filterSet = this.browserState.filters[filterKey];
        if (isChecked) filterSet.add(value);
        else {
            filterSet.delete(value);
            if (filterSet.size === 0) delete this.browserState.filters[filterKey];
        }

        this.render();
    }

    _onResetFilters() {
        this.browserState.searchQuery = "";
        this.browserState.filters = {};
        this.render();
    }

    /**
     * 覆盖 AppV2 的渲染后钩子，用于绑定搜索框
     */
    _onRender(context, options) {
        super._onRender(context, options);

        // 1. 绑定搜索框
        const searchInput = this.element.querySelector("input[name='search']");
        if (searchInput) {
            searchInput.addEventListener("input", this._onSearch.bind(this));
        }

        // 2. 绑定筛选复选框
        // 也可以优化为事件委托，但这里数量不多，暂时维持原样或统一优化均可
        const checkboxes = this.element.querySelectorAll(".xjzl-filter-checkbox");
        checkboxes.forEach(cb => {
            cb.addEventListener("change", this._onFilterChange.bind(this));
        });

        // 3. 使用事件委托绑定拖拽
        // 不再遍历所有卡片，而是直接监听整个窗口的 dragstart
        // 这样无论显示多少个物品，性能开销都是恒定的
        this.element.addEventListener("dragstart", this._onDragStart.bind(this));
    }

    /**
     * 处理拖拽
     * 把 dataset 里的 JSON 数据写入浏览器传输层
     */
    _onDragStart(event) {
        // 使用 .closest() 查找最近的带有拖拽数据的父元素
        // 这样即使用户拖动的是卡片里的图片或文字，也能正确找到卡片容器
        const card = event.target.closest("[data-drag-data]");

        if (!card) return; // 如果拖动的不是卡片，忽略

        const dragData = card.dataset.dragData;
        if (dragData) {
            event.dataTransfer.setData("text/plain", dragData);
            event.dataTransfer.effectAllowed = "copy";
        }
    }

    /* -------------------------------------------- */
    /*  数据准备 (Context Preparation)              */
    /* -------------------------------------------- */

    async _prepareContext(options) {
        const activeTab = this.browserState.activeTab;
        const rawItems = this.cachedData[activeTab] || [];

        // 1. 执行内存过滤
        const filteredItems = this._filterItems(rawItems);

        // 2. 分页/裁剪 (前端性能优化)
        // 即使有 5000 个物品，也只渲染前 100 个，防止 DOM 爆炸
        const totalCount = filteredItems.length;
        const displayLimit = 100;
        const displayItems = filteredItems.slice(0, displayLimit);

        // 3. 构建筛选器 UI 数据
        const currentFilters = this.browserState.filters;
        const filterConfigs = this.filterConfig[activeTab] || [];

        const filtersUI = filterConfigs.map(config => {
            const activeSet = currentFilters[config.key];
            const options = Object.entries(config.options).map(([val, labelKey]) => ({
                val: val,
                label: game.i18n.localize(labelKey),
                checked: activeSet ? activeSet.has(val.toString()) : false
            }));
            return { ...config, options };
        });

        return {
            isLoaded: this.isLoaded,
            tabs: XJZLCompendiumBrowser.TABS,
            activeTab: activeTab,
            items: displayItems,
            totalCount: totalCount,
            displayCount: displayItems.length,
            isClipped: totalCount > displayLimit,
            searchQuery: this.browserState.searchQuery,
            filterList: filtersUI,
            // 传递简单的映射表给 HBS，减少模板逻辑
            qualities: CONFIG.XJZL.qualities ? Object.fromEntries(
                Object.entries(CONFIG.XJZL.qualities).map(([k, v]) => [k, game.i18n.localize(v)])
            ) : {}
        };
    }

    /* -------------------------------------------- */
    /*  核心功能：随机化引擎 (Randomizer)           */
    /* -------------------------------------------- */

    /**
     * 🎲 核心 API：从指定范围随机抽取物品
     * 
     * @param {Object} options
     * @param {string} [options.tab] 指定大类
     * @param {Object} [options.filters] 指定筛选条件
     * @param {number} [options.amount=1] 抽取数量
     * @param {boolean} [options.weighted=true] 是否启用权重
     * @param {Object} [options.customWeights] 自定义权重表 {等级: 权重}
     */
    async randomize(options = {}) {
        const tab = options.tab || this.browserState.activeTab;
        const rawItems = this.cachedData[tab] || [];
        const filters = options.filters || this.browserState.filters;

        // 1. 获取过滤后的候选池
        const pool = this._filterItems(rawItems, filters, "");

        if (pool.length === 0) {
            ui.notifications.warn(`在分类 [${tab}] 中找不到符合当前筛选条件的物品。`);
            return [];
        }

        const amount = options.amount || 1;
        const useWeight = options.weighted ?? true;

        // 2. 准备权重配置
        const tierWeights = options.customWeights || { 1: 100, 2: 20, 3: 5 }; // 人/地/天
        const qualityWeights = options.customWeights || { 0: 100, 1: 60, 2: 30, 3: 10, 4: 2 }; // 凡~玉

        const results = [];

        // 3. 执行抽取
        for (let i = 0; i < amount; i++) {
            let selected;

            if (useWeight) {
                // === 加权随机算法 ===
                let totalWeight = 0;

                // [性能注意] 这里的 map 在 pool 很大时有消耗
                // 但为了动态权重判定 (Tier vs Quality) 是必要的
                const poolWithWeights = pool.map(item => {
                    let w = 10;
                    const sys = item.system;

                    // 智能判断使用哪套权重
                    if (item.type === "wuxue" || item.type === "neigong") {
                        const t = sys.tier ?? 1;
                        w = tierWeights[t] || 10;
                    } else {
                        const q = sys.quality ?? 0;
                        w = qualityWeights[q] || 10;
                    }

                    totalWeight += w;
                    return { item, weight: w };
                });

                // 游标法选择
                let random = Math.random() * totalWeight;
                for (const entry of poolWithWeights) {
                    random -= entry.weight;
                    if (random <= 0) {
                        selected = entry.item;
                        break;
                    }
                }
                // 兜底
                if (!selected) selected = poolWithWeights[poolWithWeights.length - 1].item;

            } else {
                // === 纯随机 ===
                const idx = Math.floor(Math.random() * pool.length);
                selected = pool[idx];
            }

            // 深拷贝防止污染索引缓存
            results.push(foundry.utils.deepClone(selected));
        }

        console.log(`XJZL Randomizer | 抽取结果:`, results);
        return results;
    }

    /**
     * 🎲 UI 响应：打开随机抽取设置窗口
     */
    async _onRandomizeClick(event) {
        event.preventDefault();
        const { DialogV2 } = foundry.applications.api;

        const activeTab = this.browserState.activeTab;
        const rawItems = this.cachedData[activeTab] || [];

        // 实时计算当前筛选下的数量 (Single Source of Truth)
        const currentPool = this._filterItems(rawItems);
        const count = currentPool.length;

        if (count === 0) {
            return ui.notifications.warn("当前列表为空，无法进行随机抽取。");
        }

        // 1. 动态生成权重配置 HTML
        let weightHtml = "";
        let isTierSystem = false; // true=人地天, false=凡铜银金玉

        if (["wuxue", "neigong"].includes(activeTab)) {
            isTierSystem = true;
            const defaults = { 1: 100, 2: 20, 3: 5 };
            // 使用 Grid 布局整齐排列输入框
            weightHtml = `
                <div class="weight-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 5px;">
                    ${this._buildWeightInput("人级", "w_1", defaults[1], "#666")}
                    ${this._buildWeightInput("地级", "w_2", defaults[2], "#8d6e63")}
                    ${this._buildWeightInput("天级", "w_3", defaults[3], "#d4af37")}
                </div>`;
        } else {
            isTierSystem = false;
            const defaults = { 0: 100, 1: 60, 2: 30, 3: 10, 4: 2 };
            weightHtml = `
                <div class="weight-grid" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; margin-top: 5px;">
                    ${this._buildWeightInput("凡", "w_0", defaults[0], "#666")}
                    ${this._buildWeightInput("铜", "w_1", defaults[1], "#8d6e63")}
                    ${this._buildWeightInput("银", "w_2", defaults[2], "#95a5a6")}
                    ${this._buildWeightInput("金", "w_3", defaults[3], "#d4af37")}
                    ${this._buildWeightInput("玉", "w_4", defaults[4], "#2ecc71")}
                </div>`;
        }

        const content = `
            <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                <div style="flex: 1;">
                    <label style="font-weight:bold; font-size:0.9em;">抽取数量</label>
                    <div style="display:flex; align-items:center; gap:5px;">
                        <i class="fas fa-cubes" style="color:#555;"></i>
                        <input type="number" name="amount" value="1" min="1" max="50">
                    </div>
                </div>
                <div style="flex: 1.5;">
                    <label style="font-weight:bold; font-size:0.9em;">发送者身份</label>
                    <div style="display:flex; align-items:center; gap:5px;">
                        <i class="fas fa-user-secret" style="color:#555;"></i>
                        <input type="text" name="alias" value="江湖奇遇" placeholder="默认: 江湖奇遇">
                    </div>
                </div>
            </div>
            
            <div style="margin-bottom: 15px;">
                 <label style="font-weight:bold; font-size:0.9em;">卡片标题</label>
                 <input type="text" name="title" value="随机结果" placeholder="默认: 随机结果">
            </div>

            <div style="border: 1px solid #ccc; padding: 10px; border-radius: 4px; background: rgba(0,0,0,0.02);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <label style="font-weight:bold;"><i class="fas fa-balance-scale"></i> 权重配置</label>
                </div>
                ${weightHtml}
            </div>

            <p class="notes" style="margin-top:15px; font-size:0.85em; color:#666; text-align:center;">
                将在当前显示的 <strong>${count}</strong> 个物品中进行随机。
            </p>
        `;

        // 2. 显示 V2 对话框
        const result = await DialogV2.wait({
            window: { title: "🎲 随机战利品生成", icon: "fas fa-dice-d20", resizable: false },
            content: content,
            buttons: [{
                action: "ok",
                label: "抽取",
                icon: "fas fa-check",
                class: "default",
                callback: (event, button, dialog) => {
                    const form = button.form;

                    // 获取基础参数
                    const amount = parseInt(form.elements.amount.value) || 1;
                    const alias = form.elements.alias.value.trim() || "江湖奇遇";
                    const title = form.elements.title.value.trim() || "随机结果";

                    // 获取权重
                    const customWeights = {};
                    if (isTierSystem) {
                        customWeights[1] = parseInt(form.elements.w_1.value) || 0;
                        customWeights[2] = parseInt(form.elements.w_2.value) || 0;
                        customWeights[3] = parseInt(form.elements.w_3.value) || 0;
                    } else {
                        for (let i = 0; i <= 4; i++) {
                            customWeights[i] = parseInt(form.elements[`w_${i}`].value) || 0;
                        }
                    }

                    return { amount, alias, title, customWeights };
                }
            }],
            close: () => null
        });

        if (result) {
            const items = await this.randomize({
                amount: result.amount,
                weighted: true,
                customWeights: result.customWeights
            });

            if (items.length > 0) {
                // 传递 alias 和 title 给生成函数
                this._generateLootChatCard(items, {
                    alias: result.alias,
                    title: result.title
                });
            }
        }
    }

    // 辅助：生成权重输入框 HTML
    _buildWeightInput(label, name, val, color) {
        return `
            <div style="text-align: center;">
                <label style="font-size:0.8em; color:${color}; font-weight:bold;">${label}</label>
                <input type="number" name="${name}" value="${val}" min="0" style="text-align:center; padding:2px;">
            </div>`;
    }

    /**
     * 🃏 生成美化版战利品卡片
     * @param {Array} items 物品列表
     * @param {Object} options 配置项
     * @param {string} [options.alias="江湖天道"] 发送者名称
     */
    async _generateLootChatCard(items, options = {}) {
        // 获取自定义别名，默认为“江湖奇遇”
        const alias = options.alias || "江湖奇遇";

        const renderData = {
            title: options.title || "随机结果", // 也可以自定义标题
            items: items.map(i => {
                const sys = i.system;
                let colorClass = "";
                let label = "";

                if (i.type === "wuxue" || i.type === "neigong") {
                    const t = sys.tier ?? 1;
                    colorClass = `tier-${t}`;
                    label = { 1: "人", 2: "地", 3: "天" }[t] || "未知";
                } else {
                    const q = sys.quality ?? 0;
                    colorClass = `quality-${q}`;
                    label = { 0: "凡", 1: "铜", 2: "银", 3: "金", 4: "玉" }[q] || "凡";
                }

                return {
                    uuid: i.uuid,
                    name: i.name,
                    img: i.img,
                    type: i.type,
                    colorClass: colorClass,
                    label: label
                };
            })
        };

        const content = await renderTemplate("systems/xjzl-system/templates/chat/loot-card.hbs", renderData);

        ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ alias: alias }), // 使用参数
            content: content,
            flags: { "xjzl-system": { type: "loot-card" } }
        });
    }

    /* -------------------------------------------- */
    /*  内存过滤逻辑 (Filtering Logic)              */
    /* -------------------------------------------- */

    /**
     * ⚡ 高性能内存过滤器
     * 优化点：将 Object.entries 移出循环，复杂度从 O(N*M) 降为 O(N)
     */
    _filterItems(items, filters = null, query = null) {
        // 1. 准备过滤条件
        const activeFilters = filters || this.browserState.filters;
        const activeQuery = (query !== null ? query : this.browserState.searchQuery).toLowerCase();

        // [性能优化] 预处理筛选器，避免在循环中重复调用 Object.entries
        // 只保留有内容的 Set
        const activeFilterEntries = Object.entries(activeFilters).filter(([k, v]) => v && v.size > 0);
        const hasFilters = activeFilterEntries.length > 0;
        const hasQuery = !!activeQuery;

        // 如果没有筛选条件，直接返回 (最快路径)
        if (!hasQuery && !hasFilters) return items;

        return items.filter(item => {
            const system = item.system;

            // 1. 文本搜索 (名称)
            if (hasQuery) {
                if (!item.name.toLowerCase().includes(activeQuery)) return false;
            }

            // 2. 属性匹配
            if (hasFilters) {
                for (const [key, activeSet] of activeFilterEntries) {

                    // 特殊逻辑：武学招式判定
                    // 检查该武学的 moves 数组中是否有任意一个招式符合筛选条件
                    if (item.type === "wuxue" && ["element", "damageType", "weaponType"].includes(key)) {
                        const moves = system.moves || [];
                        // some() 一旦找到即停止，性能尚可
                        const hasMatch = moves.some(move => {
                            const val = move[key];
                            return val && activeSet.has(val.toString());
                        });
                        if (!hasMatch) return false;
                        continue;
                    }

                    // 常规逻辑：直接比对 system 属性
                    // 注意数据类型转换 (toString) 以匹配 Set 中的 key
                    let itemValue = system[key];
                    if (itemValue === undefined || itemValue === null) return false;

                    if (!activeSet.has(itemValue.toString())) return false;
                }
            }

            return true;
        });
    }

    /**
     * 辅助方法：统计总数
     */
    _getTotalCount() {
        return Object.values(this.cachedData).reduce((acc, arr) => acc + arr.length, 0);
    }
}