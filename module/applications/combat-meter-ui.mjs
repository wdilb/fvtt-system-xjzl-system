const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { CombatStatsManager } from "../managers/combat-stats-manager.mjs";

/**
 * 战斗统计悬浮面板 (Combat Meter UI)
 * 职责: 响应用户交互、从 Manager 拉取数据并动态渲染
 */
export class CombatMeterUI extends HandlebarsApplicationMixin(ApplicationV2) {
    static instance = null;
    static debouncedRefresh = null;

    constructor(options = {}) {
        super(options);
        // 当前展示的排序指标
        this.currentMetric = "damageDealt";
    }

    static DEFAULT_OPTIONS = {
        id: "xjzl-combat-meter",
        classes: ["xjzl-app", "combat-meter"],
        tag: "div",
        window: {
            title: "战斗统计 (Details)",
            icon: "fas fa-chart-bar",
            minimizable: true,
            resizable: true,
        },
        position: {
            width: 300,
            height: 400,
            top: 50,
            left: window.innerWidth - 350
        },
        actions: {
            // GM 专属清空按钮
            clearData: function () { this._onClearData(); }
        }
    };

    static PARTS = {
        main: {
            template: "systems/xjzl-system/templates/apps/combat-meter.hbs"
        }
    };

    /**
     * 单例初始化及全局事件绑定
     */
    static init() {
        this.instance = new CombatMeterUI();

        // UI 渲染防抖 (100ms)
        // 保证在密集攻击(如 AOE或多端同步)时，界面平滑过渡，不浪费性能
        this.debouncedRefresh = foundry.utils.debounce(() => {
            if (this.instance && this.instance.rendered) {
                this.instance.render({ force: true });
            }
        }, 100);

        // 监听来自数据中枢的更新信号
        Hooks.on("xjzl.combatStatsUpdated", () => {
            this.debouncedRefresh();
        });
    }

    /* -------------------------------------------- */
    /*  生命周期与渲染钩子                            */
    /* -------------------------------------------- */

    /**
     * 准备 Handlebars 模板所需的数据
     */
    async _prepareContext(options) {
        const rows = CombatStatsManager.getMeterData(this.currentMetric) || [];
        const totalValue = rows.reduce((acc, r) => acc + r.value, 0);

        return {
            rows: rows,
            totalValue: totalValue,
            // 提供布尔值供模板的 <select> 标签识别当前项
            isDamageDealt: this.currentMetric === "damageDealt",
            isHealingDealt: this.currentMetric === "healingDealt",
            isDamageTaken: this.currentMetric === "damageTaken",
            isGM: game.user.isGM
        };
    }

    /**
     * FVTT V13 绑定原生 DOM 事件
     */
    _attachPartListeners(partId, htmlElement, options) {
        super._attachPartListeners(partId, htmlElement, options);

        // 绑定下拉框的 change 事件
        // 这是为了规避 V13 ApplicationV2 中 click 事件导致的 select 标签无法正常展开问题
        const selectElement = htmlElement.querySelector(".metric-select");
        if (selectElement) {
            selectElement.addEventListener("change", (event) => {
                const metric = event.target.value;
                if (!metric) return;

                this.currentMetric = metric;
                this.render({ force: true });
            });
        }
    }

    /* -------------------------------------------- */
    /*  内部交互逻辑                                  */
    /* -------------------------------------------- */

    async _onClearData() {
        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: "清空数据" },
            content: "<p>确定要清空当前的战斗统计数据吗？</p>",
            rejectClose: false
        });

        if (confirm) {
            CombatStatsManager.clearData();
        }
    }
}