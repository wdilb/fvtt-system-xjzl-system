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
        this.state = {
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
        classes: ["xjzl-window", "compendium-browser", "theme-dark"],
        position: {
            width: 900,
            height: 700
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
            openSheet: XJZLCompendiumBrowser.prototype._onOpenSheet
        }
    };

    static PARTS = {
        // 我们稍后在第二阶段再写模板，现在先留空或者写个占位
        main: { template: "systems/xjzl-system/templates/apps/compendium-browser.hbs" }
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
        "system.element",  // 五行属性
        "system.category", // 武学分类 (武学/轻功/阵法)

        // --- 技艺书 (ArtBook) ---
        "system.artType"   // 技艺类型
    ];

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
    /*  交互动作 (Actions)                          */
    /* -------------------------------------------- */

    _onChangeTab(event, target) {
        const newTab = target.dataset.tab;
        if (newTab && newTab !== this.state.activeTab) {
            this.state.activeTab = newTab;
            this.render(); // 重绘界面
        }
    }

    async _onOpenSheet(event, target) {
        const uuid = target.dataset.uuid;
        const doc = await fromUuid(uuid);
        if (doc) doc.sheet.render(true);
    }

    /* -------------------------------------------- */
    /*  数据准备 (Context)                          */
    /* -------------------------------------------- */

    async _prepareContext(options) {
        const activeTab = this.state.activeTab;

        // 获取当前 Tab 的所有物品
        let items = this.cachedData[activeTab] || [];

        // --- 简单的预处理 ---
        // (下一阶段我们会在这里加入复杂的 filterItems 逻辑)

        // 性能保护：如果还没筛选，且数量超过 200，只显示前 200 个
        // 防止一次性渲染几千个 DOM 卡死
        const totalCount = items.length;
        const displayLimit = 200;
        const isClipped = items.length > displayLimit;

        if (isClipped) {
            items = items.slice(0, displayLimit);
        }

        return {
            isLoaded: this.isLoaded,
            tabs: XJZLCompendiumBrowser.TABS,
            activeTab: activeTab,
            items: items,
            totalCount: totalCount,
            displayCount: items.length,
            isClipped: isClipped,
            // 传递品质枚举给前端做颜色区分 (可选)
            qualities: { 0: "common", 1: "uncommon", 2: "rare", 3: "epic", 4: "legendary" }
        };
    }
}