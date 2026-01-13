/**
 * ==============================================================================
 *  XJZL 合集包浏览器 (Compendium Browser)
 * ==============================================================================
 *  功能：
 *  1. 快速加载系统相关的 Item 合集包索引。
 *  2. 提供基于 ApplicationV2 的筛选界面。
 *  3. 提供 API 供宏调用进行随机战利品生成。
 * ==============================================================================
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLCompendiumBrowser extends HandlebarsApplicationMixin(ApplicationV2) {

    constructor(options) {
        super(options);

        // 本地数据缓存 (清洗后的索引)
        // 结构: { "weapon": [ItemIndex, ...], "neigong": [ItemIndex, ...] }
        this.cachedData = {};

        // 标记是否已加载
        this.isLoaded = false;

        // 内部 UI 状态
        this.browserState = {
            activeTab: "weapon", // 默认显示武器
            searchQuery: "",     // 搜索关键词
            filters: {}          // 预留给下一阶段
        };
    }

    /**
     * V13 标准配置
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
            // 预留给后续 UI 交互
            refresh: XJZLCompendiumBrowser.prototype.refreshData,
            changeTab: XJZLCompendiumBrowser.prototype._onChangeTab,
            openSheet: XJZLCompendiumBrowser.prototype._onOpenSheet,
            resetFilters: XJZLCompendiumBrowser.prototype._onResetFilters,
            randomize: XJZLCompendiumBrowser.prototype._onRandomizeClick
        }
    };

    static PARTS = {
        // 我们稍后在第二阶段再写模板，现在先留空或者写个占位
        main: {
            template: "systems/xjzl-system/templates/apps/compendium-browser.hbs",
            scrollable: [".xjzl-cb-sidebar"]
        }
    };

    // 定义所有可用的 Tabs (对应 Item Type)
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
     * ==========================================================
     *  核心逻辑：索引配置
     *  这里定义了我们不想加载完整 Document 就能读取到的字段
     * ==========================================================
     */
    static INDEX_FIELDS = [
        "img",
        "system.description", // 简略描述（虽然是HTML，但有时候搜索需要）

        // --- 通用/装备类 (Weapon, Armor, Misc, Consumable, Qizhen) ---
        "system.quantity",
        "system.price",
        "system.quality", // 品质 (0-4)
        "system.type",    // 类型 (sword/head/medicine...)
        "system.subtype", // 武器子类型
        "system.tier",    // 内功/武学品阶 (1-3)

        // --- 武学/内功类 (Wuxue, Neigong) ---
        "system.sect",     // 门派
        "system.element",  // 五行属性(仅用于内功，武学的不在system下面)
        "system.category", // 武学分类 (武学/轻功/阵法)
        "system.moves",  // 用于武学招式判定

        // --- 技艺书 (ArtBook) ---
        "system.artType"   // 技艺类型
    ];

    /**
     * 筛选器配置定义
     * key: Tab ID
     * filters: 数组，包含具体的筛选字段配置
     */
    get filterConfig() {
        const C = CONFIG.XJZL;

        const elementOptions = {
            taiji: "太极",
            yin: "阴",
            yang: "阳",
            gang: "刚",
            rou: "柔",
            none: "无"
        };

        const neigongElementOptions = {
            taiji: "太极",
            yin: "阴柔",
            yang: "阳刚"
        };

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
                { key: "damageType", label: "伤害类型", type: "checkbox", options: C.damageTypes }
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

    /**
     * 数据加载函数
     * 遍历所有合集包，提取符合 XJZL 系统要求的物品
     * 并按 Item Type 分类存储到 this.cachedData
     */
    async loadData() {
        ui.notifications.info("正在编纂江湖图谱...");
        console.log("XJZL Browser | 开始索引...");

        // 初始化空容器
        const tempCache = {};
        // 根据 TABS 初始化数组，防止 undefined
        XJZLCompendiumBrowser.TABS.forEach(t => tempCache[t.id] = []);

        for (const pack of game.packs) {
            if (pack.metadata.type !== "Item") continue;
            // 暂时放宽限制，或者确认为 "xjzl-system"
            if (pack.metadata.system !== "xjzl-system") continue;

            const index = await pack.getIndex({ fields: XJZLCompendiumBrowser.INDEX_FIELDS });

            for (const entry of index) {
                if (tempCache[entry.type]) {
                    // 注入 UUID 以便拖拽和打开
                    entry.uuid = entry.uuid || `Compendium.${pack.collection}.${entry._id}`;
                    // 注入 Pack Label 方便显示来源
                    entry.packLabel = pack.metadata.label;
                    tempCache[entry.type].push(entry);
                }
            }
        }

        this.cachedData = tempCache;
        this.isLoaded = true;
        console.log("XJZL Browser | 索引完成。", this.cachedData);

        ui.notifications.info("图谱编纂完成。");

        // 只有当窗口已打开时，才重绘以显示新数据
        if (this.rendered) this.render();
    }

    async refreshData() {
        this.isLoaded = false;
        this.render(); // 先重绘显示 Loading 状态
        await this.loadData();
    }

    /* -------------------------------------------- */
    /*  事件处理 (Event Handlers)                   */
    /* -------------------------------------------- */

    // 监听 Tab 切换：切换时重置筛选
    _onChangeTab(event, target) {
        const newTab = target.dataset.tab;
        if (newTab && newTab !== this.browserState.activeTab) {
            this.browserState.activeTab = newTab;
            this.browserState.searchQuery = ""; // 切换 Tab 清空搜索
            this.browserState.filters = {};     // 切换 Tab 清空筛选
            this.render();
        }
    }

    // 监听搜索框输入 (带防抖建议，这里简化直接处理)
    _onSearch(event) {
        event.preventDefault();
        const input = event.target.value.trim();
        if (input !== this.browserState.searchQuery) {
            this.browserState.searchQuery = input;
            this.render();
        }
    }

    /**
     * 点击物品卡片打开详情页
     * 性能最佳：按需加载完整文档
     */
    async _onOpenSheet(event, target) {
        // 阻止冒泡，防止拖拽时意外触发
        event.stopPropagation();

        const uuid = target.dataset.uuid;
        if (!uuid) return;

        try {
            // fromUuid 是异步的，会从数据库或缓存拉取完整 Item
            const item = await fromUuid(uuid);
            if (item) {
                item.sheet.render(true);
            } else {
                ui.notifications.warn("无法找到该物品，可能已被删除。");
            }
        } catch (err) {
            console.error("XJZL Browser | Open Sheet Error:", err);
        }
    }

    // 监听复选框变化
    _onFilterChange(event) {
        const target = event.target;
        const filterKey = target.dataset.filter; // e.g., "type"
        const value = target.value;              // e.g., "sword"
        const isChecked = target.checked;

        // 初始化该字段的 Set
        if (!this.browserState.filters[filterKey]) {
            this.browserState.filters[filterKey] = new Set();
        }

        if (isChecked) {
            this.browserState.filters[filterKey].add(value);
        } else {
            this.browserState.filters[filterKey].delete(value);
            // 如果空了，清理掉 key
            if (this.browserState.filters[filterKey].size === 0) {
                delete this.browserState.filters[filterKey];
            }
        }

        this.render();
    }

    _onResetFilters() {
        this.browserState.searchQuery = "";
        this.browserState.filters = {};
        this.render();
    }

    // 为了绑定 input 事件，我们需要覆盖 render 后的 hook
    // AppV2 中使用 _onRender
    _onRender(context, options) {
        super._onRender(context, options);

        // 绑定搜索框
        const searchInput = this.element.querySelector("input[name='search']");
        if (searchInput) {
            searchInput.addEventListener("input", this._onSearch.bind(this));
        }

        // 绑定筛选复选框
        const checkboxes = this.element.querySelectorAll(".xjzl-filter-checkbox");
        checkboxes.forEach(cb => {
            cb.addEventListener("change", this._onFilterChange.bind(this));
        });
    }

    /* -------------------------------------------- */
    /*  数据准备 (Context)                          */
    /* -------------------------------------------- */

    async _prepareContext(options) {
        const activeTab = this.browserState.activeTab;
        const rawItems = this.cachedData[activeTab] || [];

        // 1. 执行过滤
        const filteredItems = this._filterItems(rawItems);

        // 2. 分页/裁剪
        const totalCount = filteredItems.length;
        const displayLimit = 100;
        const displayItems = filteredItems.slice(0, displayLimit);

        // 3. 准备筛选器 UI 数据
        const currentFilters = this.browserState.filters;
        const filterConfigs = this.filterConfig[activeTab] || [];

        // 在这里进行本地化翻译
        const filtersUI = filterConfigs.map(config => {
            const activeSet = currentFilters[config.key];

            // 将 options 对象转换为数组，并翻译 label
            const options = Object.entries(config.options).map(([val, labelKey]) => {
                return {
                    val: val,
                    // 如果 labelKey 是本地化字符串，翻译它；否则直接显示 (兼容硬编码)
                    label: game.i18n.localize(labelKey),
                    checked: activeSet ? activeSet.has(val.toString()) : false
                };
            });

            // 如果想让选项按中文首字母排序，可以在这里 .sort()
            // options.sort((a, b) => a.label.localeCompare(b.label, "zh"));

            return { ...config, options };
        });

        // 4. 传递品质枚举给前端 (用于颜色类名)
        const qualityMap = {};
        if (CONFIG.XJZL.qualities) {
            for (const [k, v] of Object.entries(CONFIG.XJZL.qualities)) {
                qualityMap[k] = game.i18n.localize(v);
            }
        }

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
            qualities: qualityMap
        };
    }

    /**
     * ==========================================================
     *  随机化引擎 (Randomizer Engine)
     * ==========================================================
     */

    /**
     * 核心 API：从指定范围随机抽取物品
     * @param {Object} options 配置项
     * @param {string} [options.tab] 指定的大类 (默认当前 Tab)
     * @param {Object} [options.filters] 指定筛选条件 (默认使用当前 UI 的筛选状态)
     * @param {number} [options.amount=1] 抽取数量
     * @param {boolean} [options.weighted=true] 是否启用权重 (高品质概率低)
     * @param {boolean} [options.create=false] 是否直接创建 Item 实体 (true返回Document, false返回索引数据)
     * @returns {Promise<Array>} 返回抽中的物品数据数组
     */
    async randomize(options = {}) {
        // 1. 确定数据源 (Tab)
        const tab = options.tab || this.browserState.activeTab;
        const rawItems = this.cachedData[tab] || [];

        // 2. 确定筛选条件
        // 如果 API 调用没传 filters，就用当前浏览器 UI 上的筛选状态
        // 这一点非常方便 GM：先在界面选好范围，然后点随机
        const filters = options.filters || this.browserState.filters;

        // 临时构造一个 context 来复用 _filterItems 逻辑
        // 我们需要把 filters 传进去，但 _filterItems 目前是读 this.browserState 的
        // 为了复用，我们稍微改造一下 _filterItems 或者在这里手动模拟
        // 最简单的办法：临时修改 state 然后改回来，或者让 _filterItems 接受参数
        // 建议方案：重构 _filterItems 接受参数 (见下文修改)
        const pool = this._filterItems(rawItems, filters, ""); // 搜索词传空，通常随机不需要匹配搜索词，除非你也想

        if (pool.length === 0) {
            ui.notifications.warn(`在分类 [${tab}] 中找不到符合当前筛选条件的物品。`);
            return [];
        }

        // 3. 执行抽取
        const results = [];
        const amount = options.amount || 1;
        const useWeight = options.weighted ?? true; // 默认开启权重

        // 权重配置表 (可根据需求调整)
        const qualityWeights = {
            0: 100, // 凡品 (最常见)
            1: 50,  // 良品
            2: 20,  // 上品
            3: 5,   // 极品
            4: 1    // 绝世 (极罕见)
        };

        for (let i = 0; i < amount; i++) {
            let selected;

            if (useWeight) {
                // --- 加权随机算法 ---
                // A. 计算总权重
                let totalWeight = 0;
                const poolWithWeights = pool.map(item => {
                    // 获取品质，默认0
                    const q = item.system.quality ?? 0;
                    const w = qualityWeights[q] || 10;
                    totalWeight += w;
                    return { item, weight: w };
                });

                // B. 随机数游标
                let random = Math.random() * totalWeight;

                // C. 寻找落点
                for (const entry of poolWithWeights) {
                    random -= entry.weight;
                    if (random <= 0) {
                        selected = entry.item;
                        break;
                    }
                }
                // 兜底 (理论上不会触发)
                if (!selected) selected = poolWithWeights[poolWithWeights.length - 1].item;

            } else {
                // --- 纯随机 ---
                const idx = Math.floor(Math.random() * pool.length);
                selected = pool[idx];
            }

            // 深拷贝一份数据，避免引用问题
            results.push(foundry.utils.deepClone(selected));
        }

        console.log(`XJZL Randomizer | 从 ${pool.length} 个物品中抽取了 ${results.length} 个`, results);

        // 4. 后处理 (如果需要创建实体)
        if (options.create) {
            // 这一步通常由调用者处理 (比如 createEmbeddedDocuments)，这里只负责返回数据
            // 但为了方便，如果传了 create，我们返回 Promise.all(fromUuid)
            const docs = await Promise.all(results.map(r => fromUuid(r.uuid)));
            return docs;
        }

        return results;
    }

    /**
     * UI 响应：点击侧边栏底部的“随机抽取”按钮
     */
    async _onRandomizeClick(event) {
        event.preventDefault();

        // 简单的 Dialog 询问
        // 使用 V13/V12 推荐的 Dialog 构造，或者简单的 Dialog 类
        const content = `
            <form>
                <div class="form-group">
                    <label>抽取数量</label>
                    <input type="number" name="amount" value="1" min="1" max="50" autofocus>
                </div>
                <div class="form-group">
                    <label>基于品质加权</label>
                    <div class="form-fields">
                         <input type="checkbox" name="weighted" checked>
                         <span class="notes"> (凡品概率高，绝世概率低)</span>
                    </div>
                </div>
                <hr>
                <p class="notes">将从当前显示的 <strong>${this._lastDisplayCount || "若干"}</strong> 个物品中抽取。</p>
            </form>
        `;

        new Dialog({
            title: "随机战利品生成",
            content: content,
            buttons: {
                draw: {
                    icon: '<i class="fas fa-dice-d20"></i>',
                    label: "开始抽取",
                    callback: async (html) => {
                        const amount = parseInt(html.find('[name="amount"]').val());
                        const weighted = html.find('[name="weighted"]').is(":checked");

                        // 调用 API
                        const results = await this.randomize({
                            amount,
                            weighted
                        });

                        if (results.length > 0) {
                            this._generateLootChatCard(results);
                        }
                    }
                }
            },
            default: "draw"
        }).render(true);
    }

    /**
     * 生成聊天卡片，展示随机结果，并允许拖拽
     */
    async _generateLootChatCard(items) {
        // 构建简单的 HTML 列表
        let listHtml = `<ul class="xjzl-loot-list" style="list-style:none; padding:0; margin:0;">`;

        for (const item of items) {
            // 获取品质颜色 (硬编码颜色或读取配置)
            const q = item.system.quality ?? 0;
            const colors = ["#9e9e9e", "#4caf50", "#2196f3", "#9c27b0", "#ff9800"];
            const color = colors[q] || "#9e9e9e";

            listHtml += `
            <li class="flexrow" style="align-items:center; margin-bottom:4px; background:rgba(0,0,0,0.1); padding:4px; border-radius:4px;">
                <img src="${item.img}" width="24" height="24" style="border:1px solid ${color}; margin-right:8px;"/>
                <a class="content-link" data-uuid="${item.uuid}" style="color:${color}; font-weight:bold;">${item.name}</a>
            </li>`;
        }
        listHtml += `</ul>`;

        const content = `
            <div class="xjzl-chat-card">
                <h3 style="border-bottom:1px solid #555; padding-bottom:5px;">🎲 随机结果</h3>
                ${listHtml}
                <p style="font-size:0.8em; color:#777; margin-top:5px; text-align:center;">拖拽物品名即可拾取</p>
            </div>
        `;

        ChatMessage.create({
            content: content,
            speaker: ChatMessage.getSpeaker({ alias: "江湖天道" })
        });
    }

    /**
     * ==========================================================
     *  随机化引擎 (Randomizer Engine)
     * ==========================================================
     */

    /**
     * 核心 API：从指定范围随机抽取物品
     * @param {Object} options 配置项
     * @param {string} [options.tab] 指定的大类 (默认当前 Tab)
     * @param {Object} [options.filters] 指定筛选条件 (默认使用当前 UI 的筛选状态)
     * @param {number} [options.amount=1] 抽取数量
     * @param {boolean} [options.weighted=true] 是否启用权重 (高品质概率低)
     * @param {boolean} [options.create=false] 是否直接创建 Item 实体 (true返回Document, false返回索引数据)
     * @returns {Promise<Array>} 返回抽中的物品数据数组
     */
    async randomize(options = {}) {
        // 1. 确定数据源 (Tab)
        const tab = options.tab || this.browserState.activeTab;
        const rawItems = this.cachedData[tab] || [];

        // 2. 确定筛选条件
        // 如果 API 调用没传 filters，就用当前浏览器 UI 上的筛选状态
        // 这一点非常方便 GM：先在界面选好范围，然后点随机
        const filters = options.filters || this.browserState.filters;

        // 临时构造一个 context 来复用 _filterItems 逻辑
        // 我们需要把 filters 传进去，但 _filterItems 目前是读 this.browserState 的
        // 为了复用，我们稍微改造一下 _filterItems 或者在这里手动模拟
        // 最简单的办法：临时修改 state 然后改回来，或者让 _filterItems 接受参数
        // 建议方案：重构 _filterItems 接受参数 (见下文修改)
        const pool = this._filterItems(rawItems, filters, ""); // 搜索词传空，通常随机不需要匹配搜索词，除非你也想

        if (pool.length === 0) {
            ui.notifications.warn(`在分类 [${tab}] 中找不到符合当前筛选条件的物品。`);
            return [];
        }

        // 3. 执行抽取
        const results = [];
        const amount = options.amount || 1;
        const useWeight = options.weighted ?? true; // 默认开启权重

        // 权重配置表 (可根据需求调整)
        const qualityWeights = {
            0: 100, // 凡品 (最常见)
            1: 50,  // 良品
            2: 20,  // 上品
            3: 5,   // 极品
            4: 1    // 绝世 (极罕见)
        };

        for (let i = 0; i < amount; i++) {
            let selected;

            if (useWeight) {
                // --- 加权随机算法 ---
                // A. 计算总权重
                let totalWeight = 0;
                const poolWithWeights = pool.map(item => {
                    // 获取品质，默认0
                    const q = item.system.quality ?? 0;
                    const w = qualityWeights[q] || 10;
                    totalWeight += w;
                    return { item, weight: w };
                });

                // B. 随机数游标
                let random = Math.random() * totalWeight;

                // C. 寻找落点
                for (const entry of poolWithWeights) {
                    random -= entry.weight;
                    if (random <= 0) {
                        selected = entry.item;
                        break;
                    }
                }
                // 兜底 (理论上不会触发)
                if (!selected) selected = poolWithWeights[poolWithWeights.length - 1].item;

            } else {
                // --- 纯随机 ---
                const idx = Math.floor(Math.random() * pool.length);
                selected = pool[idx];
            }

            // 深拷贝一份数据，避免引用问题
            results.push(foundry.utils.deepClone(selected));
        }

        console.log(`XJZL Randomizer | 从 ${pool.length} 个物品中抽取了 ${results.length} 个`, results);

        // 4. 后处理 (如果需要创建实体)
        if (options.create) {
            // 这一步通常由调用者处理 (比如 createEmbeddedDocuments)，这里只负责返回数据
            // 但为了方便，如果传了 create，我们返回 Promise.all(fromUuid)
            const docs = await Promise.all(results.map(r => fromUuid(r.uuid)));
            return docs;
        }

        return results;
    }

    /**
     * UI 响应：点击侧边栏底部的“随机抽取”按钮
     */
    async _onRandomizeClick(event) {
        event.preventDefault();

        // 简单的 Dialog 询问
        // 使用 V13/V12 推荐的 Dialog 构造，或者简单的 Dialog 类
        const content = `
            <form>
                <div class="form-group">
                    <label>抽取数量</label>
                    <input type="number" name="amount" value="1" min="1" max="50" autofocus>
                </div>
                <div class="form-group">
                    <label>基于品质加权</label>
                    <div class="form-fields">
                         <input type="checkbox" name="weighted" checked>
                         <span class="notes"> (凡品概率高，绝世概率低)</span>
                    </div>
                </div>
                <hr>
                <p class="notes">将从当前显示的 <strong>${this._lastDisplayCount || "若干"}</strong> 个物品中抽取。</p>
            </form>
        `;

        new Dialog({
            title: "随机战利品生成",
            content: content,
            buttons: {
                draw: {
                    icon: '<i class="fas fa-dice-d20"></i>',
                    label: "开始抽取",
                    callback: async (html) => {
                        const amount = parseInt(html.find('[name="amount"]').val());
                        const weighted = html.find('[name="weighted"]').is(":checked");

                        // 调用 API
                        const results = await this.randomize({
                            amount,
                            weighted
                        });

                        if (results.length > 0) {
                            this._generateLootChatCard(results);
                        }
                    }
                }
            },
            default: "draw"
        }).render(true);
    }

    /**
     * 生成聊天卡片，展示随机结果，并允许拖拽
     */
    async _generateLootChatCard(items) {
        // 构建简单的 HTML 列表
        let listHtml = `<ul class="xjzl-loot-list" style="list-style:none; padding:0; margin:0;">`;

        for (const item of items) {
            // 获取品质颜色 (硬编码颜色或读取配置)
            const q = item.system.quality ?? 0;
            const colors = ["#9e9e9e", "#4caf50", "#2196f3", "#9c27b0", "#ff9800"];
            const color = colors[q] || "#9e9e9e";

            listHtml += `
            <li class="flexrow" style="align-items:center; margin-bottom:4px; background:rgba(0,0,0,0.1); padding:4px; border-radius:4px;">
                <img src="${item.img}" width="24" height="24" style="border:1px solid ${color}; margin-right:8px;"/>
                <a class="content-link" data-uuid="${item.uuid}" style="color:${color}; font-weight:bold;">${item.name}</a>
            </li>`;
        }
        listHtml += `</ul>`;

        const content = `
            <div class="xjzl-chat-card">
                <h3 style="border-bottom:1px solid #555; padding-bottom:5px;">🎲 随机结果</h3>
                ${listHtml}
                <p style="font-size:0.8em; color:#777; margin-top:5px; text-align:center;">拖拽物品名即可拾取</p>
            </div>
        `;

        ChatMessage.create({
            content: content,
            speaker: ChatMessage.getSpeaker({ alias: "江湖天道" })
        });
    }

    /**
     * 如果没传 filters/query，则使用 this.browserState (向后兼容 UI 调用)
     */
    _filterItems(items, filters = null, query = null) {
        // 1. 参数归一化
        const activeFilters = filters || this.browserState.filters;
        const activeQuery = (query !== null ? query : this.browserState.searchQuery).toLowerCase();

        return items.filter(item => {
            const system = item.system;

            // --- 搜索逻辑 ---
            if (activeQuery) {
                if (!item.name.toLowerCase().includes(activeQuery)) {
                    return false;
                }
            }

            // --- 筛选逻辑 ---
            for (const [key, activeSet] of Object.entries(activeFilters)) {
                if (!activeSet || activeSet.size === 0) continue;

                // 特殊处理：武学招式判定 (保持原逻辑)
                if (item.type === "wuxue" && (key === "element" || key === "damageType")) {
                    const moves = system.moves || [];
                    const hasMatch = moves.some(move => {
                        const val = move[key];
                        return val && activeSet.has(val.toString());
                    });
                    if (!hasMatch) return false;
                    continue;
                }

                // 常规属性判定
                let itemValue = system[key];
                if (itemValue === undefined || itemValue === null) return false;
                if (!activeSet.has(itemValue.toString())) return false;
            }

            return true;
        });
    }
}