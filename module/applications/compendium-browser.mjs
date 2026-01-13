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
    }

    /**
     * V13 标准配置
     */
    static DEFAULT_OPTIONS = {
        tag: "div",
        id: "xjzl-compendium-browser",
        classes: ["xjzl-window", "compendium-browser", "theme-dark"],
        position: {
            width: 800,
            height: 700
        },
        window: {
            title: "📖 江湖万卷楼 (合集浏览器)",
            icon: "fas fa-book-open",
            resizable: true
        },
        actions: {
            // 预留给后续 UI 交互
            refresh: XJZLCompendiumBrowser.prototype.refreshData
        }
    };

    static PARTS = {
        // 我们稍后在第二阶段再写模板，现在先留空或者写个占位
        main: { template: "systems/xjzl-system/templates/apps/compendium-browser.hbs" }
    };

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
        console.log("XJZL Browser | 开始加载合集包索引...");

        // 1. 初始化容器
        this.cachedData = {
            weapon: [],
            armor: [],
            consumable: [],
            misc: [],
            qizhen: [],
            neigong: [],
            wuxue: [],
            art_book: [],
            background: [],
            personality: []
        };

        // 2. 遍历游戏中的所有包
        for (const pack of game.packs) {
            // 过滤1：必须是 Item 类型
            if (pack.metadata.type !== "Item") continue;

            // 过滤2：我们只看本系统的包
            if (pack.metadata.system !== "xjzl-system") continue;

            console.log(`XJZL Browser | 正在索引: ${pack.metadata.label} (${pack.collection})`);

            // 3. 核心步骤：获取索引
            // getIndex 会去数据库只捞取我们定义的 fields，速度极快
            const index = await pack.getIndex({ fields: XJZLCompendiumBrowser.INDEX_FIELDS });

            // 4. 将索引数据分类装填
            for (const entry of index) {
                // entry 包含: _id, name, img, type, uuid, system: {...}

                // 确保是我们系统定义的数据类型
                if (this.cachedData.hasOwnProperty(entry.type)) {
                    // 为了方便后续筛选，我们将 uuid 和 pack 来源直接注入到对象里
                    // entry 已经有了 uuid，但为了保险起见再注入一次
                    entry.uuid = entry.uuid || `Compendium.${pack.collection}.${entry._id}`;

                    // 存入内存
                    this.cachedData[entry.type].push(entry);
                }
            }
        }

        this.isLoaded = true;
        console.log("XJZL Browser | 索引构建完成:", this.cachedData);

        // 如果窗口开着，刷新它
        this.render(true);
    }

    /**
     * 重新加载数据（用户点击刷新按钮时）
     */
    async refreshData() {
        this.isLoaded = false;
        await this.loadData();
    }

    /**
     * 辅助：统计总数
     */
    _getTotalCount() {
        return Object.values(this.cachedData).reduce((acc, arr) => acc + arr.length, 0);
    }

    /**
     * 准备渲染数据
     */
    async _prepareContext(options) {
        return {
            isLoaded: this.isLoaded,
            // 暂时只传数量，用于 Phase 1 测试
            counts: Object.fromEntries(
                Object.entries(this.cachedData).map(([k, v]) => [k, v.length])
            )
        };
    }
}