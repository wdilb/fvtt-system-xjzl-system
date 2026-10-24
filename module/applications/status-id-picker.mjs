// module/applications/status-id-picker.mjs
import { STATUS_CATEGORIES } from "./effect-selection-dialog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * 系统状态 ID 选择器
 * 供野兽卡"检定型特性"等配置场景从 CONFIG.statusEffects 中勾选状态 ID。
 * 只负责挑选并回传 ID 列表，不做任何施加动作（施加语义在 EffectSelectionDialog）。
 * 用法：const ids = await StatusIdPicker.pick({ selected: ["prone"] });
 * 确认返回 string[]，关闭/ESC 返回 null。
 */
export class StatusIdPicker extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "xjzl-status-id-picker",
        classes: ["xjzl-window", "xjzl-status-id-picker", "theme-dark"],
        window: {
            title: "XJZL.Creature.Check.PickerTitle",
            icon: "fas fa-hand-sparkles",
            resizable: true
        },
        // V14 的 window 配置不含 width/height，尺寸必须写在 position 下才参与定位；
        // 本系统窗口框架的 header 是 40px 绝对定位覆盖层（见 _layout.css），
        // 内容区在 CSS 中用 padding-top 避让（同检定编辑器的做法）
        position: {
            width: 520,
            height: 640
        },
        actions: {
            confirm: StatusIdPicker.prototype._onConfirm
        }
    };

    static PARTS = {
        main: { template: "systems/xjzl-system/templates/apps/status-id-picker.hbs" }
    };

    // 同 id 窗口同时只能存在一个：记录当前实例，重复打开时作废旧实例的 Promise
    static #current = null;

    #resolve = null;
    #settled = false;
    // 当前勾选集合仅在构造时读取（本窗口打开期间不随外部数据变化重渲染）
    #selectedIds = new Set();
    #activeCategory = "all";
    #filterQuery = "";

    constructor(options = {}) {
        super(options);
        this.#resolve = options.resolve ?? null;
        this.#selectedIds = new Set(options.selected || []);
    }

    /**
     * 打开选择器并等待结果。
     * @param {{selected?: String[]}} [options] selected: 预勾选的状态 ID
     * @returns {Promise<String[]|null>} 确认时返回勾选的 ID 数组；关闭/取消/打开失败返回 null
     */
    static pick({ selected = [] } = {}) {
        const previous = StatusIdPicker.#current;
        if (previous) {
            StatusIdPicker.#current = null;
            // 旧实例未关闭时先关闭；close() 对任意生命周期状态幂等（经信号量串行），
            // 其内部第一步就把未完成的 Promise 结算为 null，关闭失败也不悬挂调用方
            previous.close().catch(error => console.error("XJZL | 状态选择器旧窗口关闭失败:", error));
        }
        return new Promise(resolve => {
            const app = new StatusIdPicker({ selected, resolve });
            StatusIdPicker.#current = app;
            app.render(true).then(
                () => { },
                error => {
                    if (StatusIdPicker.#current === app) StatusIdPicker.#current = null;
                    console.error("XJZL | 状态选择器打开失败:", error);
                    app.#settle(null);
                    app.close().catch(closeError => console.error("XJZL | 状态选择器关闭失败:", closeError));
                }
            );
        });
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);

        // recent/common/scene 是"施加"场景的概念（最近使用/个人收藏/场上特效），配置挑选时无意义
        const skipCategories = new Set(["recent", "common", "scene"]);
        const categories = STATUS_CATEGORIES
            .filter(c => !skipCategories.has(c.id))
            .map(c => ({ id: c.id, label: game.i18n.localize(c.label), ids: c.ids }));

        const statuses = Object.values(CONFIG.statusEffects).map(e => {
            const name = game.i18n.localize(e.name);
            const desc = e.description ? game.i18n.localize(e.description) : "";
            const cats = [];
            for (const c of categories) {
                if (c.id === "all" || c.ids.includes(e.id)) cats.push(c.id);
            }
            return {
                id: e.id,
                name,
                img: e.img,
                isChecked: this.#selectedIds.has(e.id),
                categoryString: cats.join(" "),
                searchText: `${name} ${e.id}`.toLowerCase(),
                tooltip: `<div style="text-align:left; max-width:280px;"><b>${name}</b>${desc ? `<hr style="margin:4px 0;"><span style="font-size:0.9em;">${desc}</span>` : ""}</div>`
            };
        });

        const counts = {};
        for (const s of statuses) {
            for (const c of s.categoryString.split(" ")) counts[c] = (counts[c] || 0) + 1;
        }

        context.categories = categories.map(c => ({
            id: c.id,
            label: c.label,
            count: counts[c.id] || 0,
            active: c.id === this.#activeCategory
        }));
        context.statuses = statuses;
        context.filter = this.#filterQuery;
        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;
        const searchInput = html.querySelector('input[name="filter"]');
        const categoryButtons = html.querySelectorAll(".category-tab");

        // 与 EffectSelectionDialog 相同的 DOM 过滤策略：搜索/切分类不重渲染窗口，勾选状态天然保留
        const applyFilters = () => {
            const query = (searchInput?.value || "").toLowerCase().trim();
            const active = this.#activeCategory;
            html.dataset.activeCategory = active;
            categoryButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.category === active));

            let visibleCount = 0;
            html.querySelectorAll(".picker-row").forEach(row => {
                const isCategoryMatch = active === "all" || (row.dataset.categories || "").split(" ").includes(active);
                const isMatch = isCategoryMatch && (row.dataset.search || "").includes(query);
                row.hidden = !isMatch;
                if (isMatch) visibleCount++;
            });
            const empty = html.querySelector(".picker-empty");
            if (empty) empty.hidden = visibleCount > 0;
        };

        categoryButtons.forEach(btn => {
            btn.addEventListener("click", event => {
                event.preventDefault();
                this.#activeCategory = btn.dataset.category;
                applyFilters();
            });
        });
        searchInput?.addEventListener("input", () => {
            this.#filterQuery = searchInput.value;
            applyFilters();
        });

        applyFilters();
    }

    /**
     * 确认按钮：收集全部勾选的状态 ID 并结算 Promise。
     * 勾选框按文档顺序收集，返回顺序与 CONFIG.statusEffects 一致。
     */
    _onConfirm(event, target) {
        event.preventDefault();
        const ids = [...this.element.querySelectorAll(".picker-row input[type='checkbox']:checked")]
            .map(el => el.dataset.id)
            .filter(Boolean);
        this.#settle(ids);
        this.close().catch(error => console.error("XJZL | 状态选择器关闭失败:", error));
    }

    async close(options = {}) {
        // 未确认的关闭（ESC/右上角×）结算为 null；#settle 内部有防重入保护
        this.#settle(null);
        if (StatusIdPicker.#current === this) StatusIdPicker.#current = null;
        return super.close(options);
    }

    /** 结算 pick() 的 Promise；确认与关闭共用，保证只结算一次。关窗由调用方负责。 */
    #settle(value) {
        if (this.#settled) return;
        this.#settled = true;
        const resolve = this.#resolve;
        this.#resolve = null;
        resolve?.(value);
    }
}
