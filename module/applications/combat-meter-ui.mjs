const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { CombatStatsManager } from "../managers/combat-stats-manager.mjs";
import { CombatScoreUI } from "./combat-score-app.mjs";

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
            title: "XJZL.UI.CombatMeter.Title",
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
            clearData: function () { this._onClearData(); },
            reportToChat: function () { this._onReportToChat(); },
            openScoreUI: function () { CombatScoreUI.toggle(); }
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

        // 构建顶部的战斗场次下拉框数据
        const sessions = [];
        if (CombatStatsManager._activeStats) {
            sessions.push({
                id: "current",
                name: `[${game.i18n.localize("XJZL.UI.CombatMeter.CurrentSession")}] ${CombatStatsManager._activeStats.name}`,
                selected: CombatStatsManager._viewingId === "current"
            });
        }
        CombatStatsManager._history.forEach(h => {
            sessions.push({
                id: h.id,
                name: `[${game.i18n.localize("XJZL.UI.CombatMeter.HistorySession")}] ${h.name}`,
                selected: CombatStatsManager._viewingId === h.id
            });
        });

        if (this.viewState.level === 1) {
            rows = CombatStatsManager.getMeterData(this.currentMetric) || [];
            totalValue = rows.reduce((acc, r) => acc + r.value, 0);
            viewTitle = game.i18n.localize("XJZL.UI.CombatMeter.GlobalRanking");
        }
        else if (this.viewState.level === 2) {
            const skillData = CombatStatsManager.getActorSkillsData(this.viewState.actorUuid, this.currentMetric);
            if (skillData) {
                rows = skillData.rows;
                totalValue = rows.reduce((acc, r) => acc + r.value, 0);
                viewTitle = game.i18n.format("XJZL.UI.CombatMeter.ActorDetails", { name: skillData.actorName });
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
                viewTitle = game.i18n.format("XJZL.UI.CombatMeter.SkillDetails", { name: details.skillName });
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
            isLevel2: this.viewState.level === 2,
            isLevel3: this.viewState.level === 3,
            skillDetails: skillDetails,
            viewTitle: viewTitle,
            isHealing: this.currentMetric === "healingDealt",
            isDamage: this.currentMetric === "damageDealt" || this.currentMetric === "damageTaken" || this.currentMetric === "dyingTaken",
            metricLabel: this._getMetricLabel(this.currentMetric),
            isGM: game.user.isGM
        };
    }

    _getMetricLabel(metric) {
        const map = {
            damageDealt: "XJZL.UI.CombatMeter.DamageDealt", healingDealt: "XJZL.UI.CombatMeter.HealingDealt", damageTaken: "XJZL.UI.CombatMeter.DamageTaken",
            brokenStanceDealt: "XJZL.UI.CombatMeter.BrokenStanceDealt", mpSpent: "XJZL.UI.CombatMeter.MpSpent", rageSpent: "XJZL.UI.CombatMeter.RageSpent", castsDealt: "XJZL.UI.CombatMeter.CastsDealt",
            dyingTaken: "XJZL.UI.CombatMeter.DyingTaken"
        };
        return game.i18n.localize(map[metric] || metric);
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

                    if (this.currentMetric === "damageTaken" || this.currentMetric === "dyingTaken") {
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

    // 清除数据
    async _onClearData() {
        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("XJZL.UI.CombatMeter.ClearTitle") },
            content: `<p>${game.i18n.localize("XJZL.UI.CombatMeter.ClearConfirm")}</p>`,
            rejectClose: false
        });
        if (confirm) CombatStatsManager.clearData();
    }

    // 发送到聊天
    async _onReportToChat() {
        let rows = [];
        let title = "";
        let total = 0;
        const metricLabel = this._getMetricLabel(this.currentMetric);

        // 根据当前层级获取数据
        if (this.viewState.level === 1) {
            rows = CombatStatsManager.getMeterData(this.currentMetric) || [];
            title = game.i18n.format("XJZL.UI.CombatMeter.ReportTitle", { metric: metricLabel });
            total = rows.reduce((acc, r) => acc + r.value, 0);
        } else if (this.viewState.level === 2) {
            const skillData = CombatStatsManager.getActorSkillsData(this.viewState.actorUuid, this.currentMetric);
            if (!skillData) return ui.notifications.warn(game.i18n.localize("XJZL.UI.CombatMeter.NoSkillData"));
            rows = skillData.rows;
            title = `${game.i18n.localize("XJZL.UI.CombatMeter.Title")} · ${skillData.actorName} - ${metricLabel}`;
            total = rows.reduce((acc, r) => acc + r.value, 0);
        } else {
            return; // Level 3 暂不提供一键发送
        }

        if (rows.length === 0) return ui.notifications.warn(game.i18n.localize("XJZL.UI.CombatMeter.NoReportData"));

        // 为了防止聊天框被刷屏，截取前 10 条
        const MAX_ROWS = 10;
        const topRows = rows.slice(0, MAX_ROWS);

        // 构建精美的 HTML 聊天卡片 (复用部分进度条的设计感)
        let content = `
    <div class="xjzl-combat-meter-chat-card">
        <header class="chat-card-header">
            <div class="card-title"><i class="fas fa-chart-bar"></i> ${title}</div>
            <div class="card-total">${game.i18n.localize("XJZL.UI.CombatMeter.ReportTotal")}: <span>${total}</span></div>
        </header>
        <ul class="chat-card-list">
    `;

        topRows.forEach(row => {
            // 保证样式内联或依赖系统 CSS
            content += `
            <li class="chat-row">
                <div class="chat-bar" style="width: ${row.barPercent}%; background-color: ${row.color};"></div>
                <div class="chat-content">
                    <span class="rank">${row.rank}.</span>
                    <span class="name">${row.name}</span>
                    <span class="val">${row.displayVal || row.value} <small>(${row.textPercent}%)</small></span>
                </div>
            </li>
        `;
        });

        if (rows.length > MAX_ROWS) {
            content += `<li class="chat-row-more">...及其他 ${rows.length - MAX_ROWS} 项未显示</li>`;
        }

        content += `</ul></div>`;

        // 发送消息
        ChatMessage.create({
            speaker: ChatMessage.getSpeaker(),
            content: content
        });
    }
}
