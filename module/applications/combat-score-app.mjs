const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { CombatStatsManager } from "../managers/combat-stats-manager.mjs";

/**
 * 战绩评分系统 UI
 * 职责: 渲染基于 CombatStatsManager 数据的可视化评分面板与 SVG 四维雷达
 */
export class CombatScoreUI extends HandlebarsApplicationMixin(ApplicationV2) {
    static instance = null;

    constructor(options = {}) {
        super(options);
        // UI 视图状态管理: level 1 (全局榜单), level 2 (个人详情)
        this.viewState = {
            level: 1,
            actorUuid: null
        };
    }

    static DEFAULT_OPTIONS = {
        id: "xjzl-combat-score",
        classes: ["xjzl-score-system"],
        tag: "div",
        window: {
            title: "战绩评分系统 (MVP)",
            icon: "fas fa-medal",
            minimizable: true,
            resizable: true,
        },
        position: { width: 600, height: 650 },
        actions: {
            // 进入个人详情视图
            viewDetail: function (event, target) {
                const uuid = target.dataset.uuid;
                if (uuid) {
                    this.viewState.level = 2;
                    this.viewState.actorUuid = uuid;
                    this.render({ force: true });
                }
            },
            // 返回全局视图
            goBack: function () {
                this.viewState.level = 1;
                this.viewState.actorUuid = null;
                this.render({ force: true });
            },
            // 发送数据到聊天卡片
            reportScore: function () {
                this._onReportScoreToChat();
            }
        }
    };

    static PARTS = {
        main: { template: "systems/xjzl-system/templates/apps/combat-score.hbs" }
    };

    /** 实例单例模式开关 */
    static toggle() {
        if (!this.instance) this.instance = new CombatScoreUI();
        if (this.instance.rendered) this.instance.close();
        else this.instance.render(true);
    }

    /**
     * 准备传递给 Handlebars 的上下文数据
     */
    async _prepareContext(options) {
        const actorsData = CombatStatsManager.getScoringData();
        const isLevel1 = this.viewState.level === 1;

        let detailData = null;
        if (!isLevel1) {
            detailData = actorsData.find(a => a.uuid === this.viewState.actorUuid);
            if (!detailData) this.viewState.level = 1; // 数据丢失时容错回退到全局层
        }

        return {
            isLevel1,
            actors: actorsData,
            // 明确剥离出前三名，用于渲染领奖台 (若无数据则为 null)
            rank1: actorsData[0] || null,
            rank2: actorsData[1] || null,
            rank3: actorsData[2] || null,
            detail: detailData
        };
    }

    /**
     * 构建并发送表现评分聊天卡片
     */
    async _onReportScoreToChat() {
        const actorsData = CombatStatsManager.getScoringData();
        if (!actorsData.length) return ui.notifications.warn("风平浪静，没有数据可发送！");

        let content = "";

        if (this.viewState.level === 1) {
            // Level 1: 发送全局表现评分 (截取前10名防止刷屏)
            const listHtml = actorsData.slice(0, 10).map(a => `
                <div class="chat-row">
                    <span class="rank">#${a.rank}</span>
                    <span class="name">${a.name}</span>
                    <span class="pts">${a.score}</span>
                    <span class="grade grade-${a.grade}">${a.grade}</span>
                </div>
            `).join("");

            content = `
                <div class="xjzl-score-chat-card">
                    <header>🏆 战斗表现评分</header>
                    <div class="chat-list">${listHtml}</div>
                </div>
            `;
        } else {
            // Level 2: 发送单人详情
            const detail = actorsData.find(a => a.uuid === this.viewState.actorUuid);
            if (!detail) return;

            content = `
                <div class="xjzl-score-chat-card">
                    <header>📊 战术分析: ${detail.name} <span class="grade grade-${detail.grade}">${detail.grade}</span></header>
                    <div class="chat-detail-pts">综合评分: <strong class="val">${detail.score}</strong> PTS</div>
                    <div class="chat-detail-grid">
                        <div class="stat"><i class="fas fa-fire" style="color:#ff3c00"></i> 输出: ${detail.raw.damage}</div>
                        <div class="stat"><i class="fas fa-heart" style="color:#2ecc71"></i> 治疗: ${detail.raw.healing}</div>
                        <div class="stat"><i class="fas fa-shield-alt" style="color:#3498db"></i> 承伤: ${detail.raw.taken}</div>
                        <div class="stat"><i class="fas fa-hammer" style="color:#f1c40f"></i> 破架: ${detail.raw.broken}</div>
                    </div>
                </div>
            `;
        }

        ChatMessage.create({
            speaker: ChatMessage.getSpeaker(),
            content: content
        });
    }
}