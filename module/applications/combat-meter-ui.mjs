const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { CombatStatsManager } from "../managers/combat-stats-manager.mjs";

export class CombatMeterUI extends HandlebarsApplicationMixin(ApplicationV2) {
    static instance = null;
    static debouncedRefresh = null;

    constructor(options = {}) {
        super(options);
        this.currentMetric = "damageDealt";

        this.viewState = {
            level: 1,
            actorUuid: null,
            skillId: null
        };
    }

    static DEFAULT_OPTIONS = {
        id: "xjzl-combat-meter",
        classes: ["xjzl-combat-meter"],
        tag: "div",
        window: {
            title: "战斗统计 (Details)",
            icon: "fas fa-chart-bar",
            minimizable: true,
            resizable: true,
        },
        position: {
            width: 320,
            height: 480,
            top: 50,
            left: window.innerWidth - 350
        },
        actions: {
            clearData: function () { this._onClearData(); }
        }
    };

    static PARTS = {
        main: {
            template: "systems/xjzl-system/templates/apps/combat-meter.hbs"
        }
    };

    static init() {
        this.instance = new CombatMeterUI();
        this.debouncedRefresh = foundry.utils.debounce(() => {
            if (this.instance && this.instance.rendered) {
                this.instance.render({ force: true });
            }
        }, 100);

        Hooks.on("xjzl.combatStatsUpdated", () => {
            this.debouncedRefresh();
        });
    }

    async _prepareContext(options) {
        let rows = [];
        let totalValue = 0;
        let viewTitle = "";
        let skillDetails = null;

        // 【新增】构建顶部的战斗场次下拉框数据
        const sessions = [];
        if (CombatStatsManager._activeStats) {
            sessions.push({
                id: "current",
                name: `[进行中] ${CombatStatsManager._activeStats.name}`,
                selected: CombatStatsManager._viewingId === "current"
            });
        }
        CombatStatsManager._history.forEach(h => {
            sessions.push({
                id: h.id,
                name: `[历史] ${h.name}`,
                selected: CombatStatsManager._viewingId === h.id
            });
        });

        if (this.viewState.level === 1) {
            rows = CombatStatsManager.getMeterData(this.currentMetric) || [];
            totalValue = rows.reduce((acc, r) => acc + r.value, 0);
            viewTitle = "全局排行";
        }
        else if (this.viewState.level === 2) {
            const skillData = CombatStatsManager.getActorSkillsData(this.viewState.actorUuid, this.currentMetric);
            if (skillData) {
                rows = skillData.rows;
                totalValue = rows.reduce((acc, r) => acc + r.value, 0);
                viewTitle = `${skillData.actorName} 的明细`;
            } else {
                this.viewState.level = 1;
                return this._prepareContext(options);
            }
        }
        else if (this.viewState.level === 3) {
            const details = CombatStatsManager.getSkillDetailsData(
                this.viewState.actorUuid,
                this.viewState.skillId,
                this.currentMetric
            );
            if (details) {
                skillDetails = details;
                rows = details.targets;
                totalValue = rows.reduce((acc, r) => acc + (r.displayVal || r.value), 0);
                viewTitle = `技能详情: ${details.skillName}`;
            } else {
                this.viewState.level = 2;
                return this._prepareContext(options);
            }
        }

        return {
            sessions: sessions, // 传入场次数据
            rows: rows,
            totalValue: totalValue,
            isLevel1: this.viewState.level === 1,
            isLevel3: this.viewState.level === 3,
            skillDetails: skillDetails,
            viewTitle: viewTitle,
            isHealing: this.currentMetric === "healingDealt",
            isDamage: this.currentMetric === "damageDealt" || this.currentMetric === "damageTaken",
            metricLabel: this._getMetricLabel(this.currentMetric),
            isGM: game.user.isGM
        };
    }

    _getMetricLabel(metric) {
        const map = {
            damageDealt: "造成伤害", healingDealt: "造成治疗", damageTaken: "承受伤害",
            brokenStanceDealt: "破架次数", mpSpent: "内力消耗", rageSpent: "怒气消耗", castsDealt: "施展次数"
        };
        return map[metric] || metric;
    }

    _attachPartListeners(partId, htmlElement, options) {
        super._attachPartListeners(partId, htmlElement, options);

        // 右键任意位置返回上一层
        htmlElement.addEventListener("contextmenu", (event) => {
            // 如果是在下拉框等原生控件上右键，不拦截
            if (event.target.tagName === "SELECT") return;

            if (this.viewState.level > 1) {
                event.preventDefault(); // 阻止浏览器默认弹出的右键菜单
                this.viewState.level--;
                this.render({ force: true });
            }
        });

        // 监听场次切换
        const sessionSelect = htmlElement.querySelector(".session-select");
        if (sessionSelect) {
            sessionSelect.addEventListener("change", (event) => {
                CombatStatsManager._viewingId = event.target.value;
                this.viewState.level = 1; // 切换场次强制退回根目录
                this.render({ force: true });
            });
        }

        const selectElement = htmlElement.querySelector(".metric-select");
        if (selectElement) {
            selectElement.value = this.currentMetric;
            selectElement.addEventListener("change", (event) => {
                this.currentMetric = event.target.value;
                this.viewState.level = 1;
                this.render({ force: true });
            });
        }

        // 左键返回按钮 (保留作为视觉提示)
        const backBtn = htmlElement.querySelector(".back-btn");
        if (backBtn) {
            backBtn.addEventListener("click", () => {
                if (this.viewState.level > 1) {
                    this.viewState.level--;
                    this.render({ force: true });
                }
            });
        }

        // 列表左键点击进入下一层
        const listEl = htmlElement.querySelector(".meter-list");
        if (listEl) {
            listEl.addEventListener("click", (event) => {
                const row = event.target.closest(".meter-row");
                if (!row) return;

                if (this.viewState.level === 1) {
                    const actorUuid = row.dataset.id;
                    if (actorUuid) {
                        this.viewState.level = 2;
                        this.viewState.actorUuid = actorUuid;
                        this.render({ force: true });
                    }
                }
                else if (this.viewState.level === 2) {
                    if (["mpSpent", "rageSpent", "castsDealt"].includes(this.currentMetric)) return;

                    const skillId = row.dataset.id;
                    let actualSkillId = skillId;

                    if (this.currentMetric === "damageTaken") {
                        const parts = skillId.split("_");
                        this.viewState.actorUuid = parts[0];
                        actualSkillId = parts.slice(1).join("_");
                    }

                    if (actualSkillId) {
                        this.viewState.level = 3;
                        this.viewState.skillId = actualSkillId;
                        this.render({ force: true });
                    }
                }
            });
        }
    }

    async _onClearData() {
        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: "清空数据" },
            content: "<p>确定要清空包含历史记录在内的所有战斗统计数据吗？</p>",
            rejectClose: false
        });
        if (confirm) CombatStatsManager.clearData();
    }
}