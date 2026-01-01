const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLAuditLog extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        tag: "div",
        id: "xjzl-audit-log",
        classes: ["xjzl-window", "xjzl-audit-window"], // 关键 CSS 类
        window: {
            title: "生平经历与审计",
            icon: "fas fa-history",
            resizable: true,
            width: 500,
            height: 600
        },
        position: {
            width: 500,
            height: 600
        }
    };

    static PARTS = {
        main: {
            template: "systems/xjzl-system/templates/actor/character/audit-log.hbs",
            scrollable: [".audit-list-area"] // V13 自动处理滚动条复位
        }
    };

    constructor(options = {}) {
        super(options);
        // 传入 actor 文档
        this.actor = options.actor;
    }

    /**
     * 准备数据给 HBS
     */
    async _prepareContext(options) {
        const history = this.actor.system.history || [];

        // 预处理数据，方便模板和搜索
        const formattedHistory = history.map(entry => {
            const dateObj = new Date(entry.realTime);

            // 搜索用的关键词 (全小写)
            const searchTerm = (entry.title + " " + entry.reason).toLowerCase();

            // 日期筛选用的 YYYY-MM-DD
            const yyyy = dateObj.getFullYear();
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
            const dd = String(dateObj.getDate()).padStart(2, '0');
            const dateStr = `${yyyy}-${mm}-${dd}`;

            return {
                ...entry,
                realTimeStr: dateObj.toLocaleString(),
                gameDateDisplay: entry.gameDate || dateObj.toLocaleString(),
                deltaClass: entry.delta.startsWith("-") ? "minus" : "plus",
                cssClass: entry.importance > 0 ? "important" : "",
                searchTerm: searchTerm,
                dateStr: dateStr
            };
        });

        return { history: formattedHistory };
    }

    /**
     * 绑定事件：核心是搜索逻辑
     */
    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;

        const searchInput = html.querySelector(".audit-filter-input");
        const dateInput = html.querySelector(".audit-date-input");
        const entries = html.querySelectorAll(".audit-entry");

        // 过滤函数
        const filterList = () => {
            const query = searchInput.value.toLowerCase().trim();
            const dateQuery = dateInput.value; // YYYY-MM-DD

            entries.forEach(entry => {
                const term = entry.dataset.search;
                const date = entry.dataset.date;

                const matchText = !query || term.includes(query);
                const matchDate = !dateQuery || date === dateQuery;

                // 直接控制 DOM 显示/隐藏
                entry.style.display = (matchText && matchDate) ? "block" : "none";
            });
        };

        // 绑定 Input 事件 (实时响应)
        if (searchInput) searchInput.addEventListener("input", filterList);
        if (dateInput) {
            dateInput.addEventListener("input", filterList);
            dateInput.addEventListener("change", filterList);
        }
    }
}