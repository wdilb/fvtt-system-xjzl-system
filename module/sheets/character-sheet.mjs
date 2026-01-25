/**
 * 角色卡片逻辑
 */
import { XJZL } from "../config.mjs";
// 引入工具函数
import { localizeConfig, rollDisabilityTable, promptDisabilityQuery, getModifierChoices } from "../utils/utils.mjs";
// 引入卡片管理器 (用于复用死检的逻辑)
import { ChatCardManager } from "../managers/chat-manager.mjs";
import { XJZLAuditLog } from "../applications/audit-log.mjs";
import { XJZLModifierPicker } from "../applications/modifier-picker.mjs";
import { XJZLManageXPDialog } from "../applications/manage-xp.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLCharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "actor", "character", "theme-dark"],
        position: { width: 1100, height: 750 },
        window: { resizable: true },
        // 告诉 V13：“请帮我监听 Input 变化，并且在重绘时保持滚动位置”
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        },
        // 拖拽配置，用于wuxue自定义排序
        dragDrop: [{
            // 排序的拖拽
            dragSelector: ".wuxue-group[draggable='true']",
            dropSelector: ".wuxue-list"
        }, {
            // 针对招式卡片和物品卡片的拖拽监听
            dragSelector: ".move-card, .item-grid-card",
            dropSelector: null
        }],
        actions: {
            // --- 核心切换 ---
            toggleNeigong: XJZLCharacterSheet.prototype._onToggleNeigong,
            toggleSubTab: XJZLCharacterSheet.prototype._onToggleSubTab,

            // --- 物品基础操作 ---
            editItem: XJZLCharacterSheet.prototype._onEditItem,
            deleteItem: XJZLCharacterSheet.prototype._onDeleteItem,
            createItem: XJZLCharacterSheet.prototype._onCreateItem,

            // --- 物品功能交互 (逻辑在 Item 中) ---
            toggleEquip: XJZLCharacterSheet.prototype._onToggleEquip,
            useConsumable: XJZLCharacterSheet.prototype._onUseConsumable,
            readManual: XJZLCharacterSheet.prototype._onReadManual,
            // 添加搜索监听
            searchInventory: XJZLCharacterSheet.prototype._onSearchInventory,

            // --- 修炼系统 (统一使用辅助方法) ---
            investXP: XJZLCharacterSheet.prototype._onInvestXP,
            refundXP: XJZLCharacterSheet.prototype._onRefundXP,
            investMoveXP: XJZLCharacterSheet.prototype._onInvestMoveXP,
            refundMoveXP: XJZLCharacterSheet.prototype._onRefundMoveXP,
            investArtXP: XJZLCharacterSheet.prototype._onInvestArtXP,
            refundArtXP: XJZLCharacterSheet.prototype._onRefundArtXP,
            investJingmaiXP: XJZLCharacterSheet.prototype._onInvestJingmaiXP,
            refundJingmaiXP: XJZLCharacterSheet.prototype._onRefundJingmaiXP,

            togglePin: XJZLCharacterSheet.prototype._onTogglePin, //标记常用武学
            manageXP: XJZLCharacterSheet.prototype._onManageXP,  //管理修为
            viewHistory: XJZLCharacterSheet.prototype._onViewHistory, //查看修为日志
            // 修炼物品专用删除（带返还逻辑）
            deleteCultivationItem: XJZLCharacterSheet.prototype._onDeleteCultivationItem,

            // --- 其他 ---
            //删除状态
            deleteEffect: XJZLCharacterSheet.prototype._onDeleteEffect,

            //切换经脉显示
            toggleJingmaiAttemptMode: XJZLCharacterSheet.prototype._onToggleJingmaiAttemptMode,

            //使用招式
            rollMove: XJZLCharacterSheet.prototype._onRollMove,

            // 通用属性/技能/技艺检定
            rollAttribute: XJZLCharacterSheet.prototype._onRollAttribute,

            // 发送物品详情卡片到聊天
            postItem: XJZLCharacterSheet.prototype._onPostItem,
            postMove: XJZLCharacterSheet.prototype._onPostMove,
            // 交易系统
            buyItem: XJZLCharacterSheet.prototype._onTradeItem,
            sellItem: XJZLCharacterSheet.prototype._onTradeItem,

            //手工修正
            addGroup: XJZLCharacterSheet.prototype._onAction,
            deleteGroup: XJZLCharacterSheet.prototype._onAction,
            addChange: XJZLCharacterSheet.prototype._onAction,
            deleteChange: XJZLCharacterSheet.prototype._onAction,
            openModifierPicker: XJZLCharacterSheet.prototype._onOpenModifierPicker,
            //处理关系
            addRelation: XJZLCharacterSheet.prototype._onAction,
            deleteRelation: XJZLCharacterSheet.prototype._onAction,

            // 濒死/死亡交互
            rollDisability: XJZLCharacterSheet.prototype._onRollDisability,
            rollDeathSave: XJZLCharacterSheet.prototype._onRollDeathSave,
            queryDisability: XJZLCharacterSheet.prototype._onQueryDisability,
            //休息
            "shortRest": XJZLCharacterSheet.prototype._onShortRest,
            "longRest": XJZLCharacterSheet.prototype._onLongRest,

            //普通攻击
            rollBasicAttack: XJZLCharacterSheet.prototype._onRollBasicAttack,
            //趁虚而入
            rollOpportunityAttack: XJZLCharacterSheet.prototype._onRollOpportunityAttack,
            // 解除架招
            stopStance: XJZLCharacterSheet.prototype._onStopStance,
            // 更换图片
            editImage: XJZLCharacterSheet.prototype._onEditImage,
            // 是否进入排序模式
            toggleSort: XJZLCharacterSheet.prototype._onToggleSort
        }
    };

    /* 
     * 2. 定义部件 (PARTS)
     * V2 会把这些模板渲染出来并塞进 window-content
     * 我们需要给每个模板最外层加 CSS 类，以便 Grid 布局识别
     */
    static PARTS = {
        // 左侧栏
        header: {
            template: "systems/xjzl-system/templates/actor/character/header.hbs",
            classes: ["xjzl-sidebar"] // 自动加类名
        },
        // 右侧导航
        tabs: {
            template: "systems/xjzl-system/templates/actor/character/tabs.hbs",
            classes: ["xjzl-nav"]
        },
        // --- 中间 Tab 内容 (Tab Body) ---
        // V2 会自动处理 Tab 的显示/隐藏，我们只需要标记它们是 Body 的一部分
        combat: {
            template: "systems/xjzl-system/templates/actor/character/tab-combat.hbs",
            scrollable: [""],
            classes: ["xjzl-body"]
        },
        cultivation: {
            template: "systems/xjzl-system/templates/actor/character/tab-cultivation.hbs",
            scrollable: [""],
            classes: ["xjzl-body"]
        },
        skills: {
            template: "systems/xjzl-system/templates/actor/character/tab-skills.hbs",
            scrollable: [""],
            classes: ["xjzl-body"]
        },
        jingmai: {
            template: "systems/xjzl-system/templates/actor/character/tab-jingmai.hbs",
            scrollable: [""],
            classes: ["xjzl-body"]
        },
        inventory: {
            template: "systems/xjzl-system/templates/actor/character/tab-inventory.hbs",
            scrollable: [".inventory-list-container"],
            classes: ["xjzl-body"]
        },
        bio: {
            template: "systems/xjzl-system/templates/actor/character/tab-bio.hbs",
            scrollable: [""],
            classes: ["xjzl-body"]
        },
        config: {
            template: "systems/xjzl-system/templates/actor/character/tab-config.hbs",
            scrollable: [""],
            classes: ["xjzl-body"]
        }
    };

    tabGroups = { primary: "combat" };

    /* -------------------------------------------- */
    /*  数据准备 (Data Preparation)                  */
    /* -------------------------------------------- */

    async _prepareContext(options) {
        // =====================================================
        // ✦ 0. 内部辅助函数定义 (Local Helpers)
        // -----------------------------------------------------
        // 定义在最前面，供后续所有模块复用，确保风格统一

        /**
         * 文本清洗器：将富文本转为适合 Tooltip 显示的纯文本
         * 保留换行，去除标签，转义引号
         */
        const cleanRichText = (text) => {
            if (!text) return "";
            return text
                .replace(/<br\s*\/?>/gi, '\n') // 换行转 \n
                .replace(/<\/(p|div|h[1-6]|li|ul|ol)>/gi, '\n')
                .replace(/<[^>]+>/g, '')       // 删掉剩余所有标签
                .replace(/&nbsp;/g, ' ')       // 修复空格
                .replace(/"/g, '&quot;')       // 修复双引号
                .replace(/'/g, '&apos;')       // 修复单引号
                .trim();
        };

        /**
         * 构建自动化说明的 HTML 片段 (蓝色框)
         */
        const buildAutomationHTML = (note) => {
            if (!note) return "";
            // 使用 cleanRichText 处理内容，防止双引号破坏 HTML 结构
            // 样式：Flex布局，左对齐，强制 normal 换行覆盖外层的 pre-wrap
            return `<div style='background:rgba(52, 152, 219, 0.2); border-left:3px solid #3498db; padding:4px 6px; margin:6px 0; font-size:11px; color:#aed6f1; display:flex; align-items:center; white-space:normal; line-height:1.2;'>
                        <i class='fas fa-robot' style='margin-right:4px;'></i><span>${note.replace(/"/g, '&quot;')}</span>
                    </div>`;
        };

        /**
         * 构建普通描述的 HTML 片段 (灰色文字)
         */
        const buildDescriptionHTML = (description, maxLength = 0) => {
            if (!description) return "";
            let text = cleanRichText(description);
            if (maxLength > 0 && text.length > maxLength) {
                text = text.substring(0, maxLength) + "...";
            }
            // 样式：pre-wrap 保留 cleanRichText 生成的换行符
            return `<div style='font-size:11px; color:#ccc; line-height:1.4; white-space: pre-wrap;'>${text}</div>`;
        };

        // =====================================================
        // ✦ 1. 核心上下文初始化 (Core Initialization)
        // -----------------------------------------------------
        const context = await super._prepareContext(options);
        const actor = this.document;
        const system = actor.system;

        context.system = system;
        context.tabs = this.tabGroups;

        // =====================================================
        // ✦ 2. 表单下拉选项配置 (Form Choices & Config)
        // -----------------------------------------------------
        context.choices = {
            genders: localizeConfig(XJZL.genders),
            sects: localizeConfig(XJZL.sects),
            attitudes: localizeConfig(XJZL.attitudes),
            hobbies: localizeConfig(XJZL.hobbies)
        };

        // =====================================================
        // ✦ 3. 角色状态与基础信息 (Status & Bio)
        // -----------------------------------------------------
        context.percents = {
            hp: system.resources.hp.max ? Math.min(100, (system.resources.hp.value / system.resources.hp.max) * 100) : 0,
            huti: system.resources.hp.max ? Math.min(100, (system.resources.huti / system.resources.hp.max) * 100) : 0,
            mp: system.resources.mp.max ? Math.min(100, (system.resources.mp.value / system.resources.mp.max) * 100) : 0,
            rage: (system.resources.rage.value / 10) * 100
        };

        context.backgroundItem = actor.itemTypes.background?.[0] || null;
        context.personalityItem = actor.itemTypes.personality?.[0] || null;

        const currentHobbies = system.social.shihao || [];
        context.hobbySlots = [0, 1, 2].map(i => ({
            index: i,
            value: currentHobbies[i] || ""
        }));

        // =====================================================
        // ✦ 4. 属性技能面板 (Attributes & Skills Tab)
        // -----------------------------------------------------
        if (!["neigong", "wuxue", "arts"].includes(this._cultivationSubTab)) {
            this._cultivationSubTab = "neigong";
        }
        context.cultivationSubTab = this._cultivationSubTab;

        const allSkillGroups = [
            { key: "wuxing", label: "XJZL.Stats.Wuxing", skills: ["wuxue", "jianding", "bagua", "shili"] },
            { key: "liliang", label: "XJZL.Stats.Liliang", skills: ["jiaoli", "zhengtuo", "paozhi", "qinbao"] },
            { key: "shenfa", label: "XJZL.Stats.Shenfa", skills: ["qianxing", "qiaoshou", "qinggong", "mashu"] },
            { key: "tipo", label: "XJZL.Stats.Tipo", skills: ["renxing", "biqi", "rennai", "ningxue"] },
            { key: "neixi", label: "XJZL.Stats.Neixi", skills: ["liaoshang", "chongxue", "lianxi", "duqi"] },
            { key: "qigan", label: "XJZL.Stats.Qigan", skills: ["dianxue", "zhuizong", "tancha", "dongcha"] },
            { key: "shencai", label: "XJZL.Stats.Shencai", skills: ["jiaoyi", "qiman", "shuofu", "dingli"] }
        ];

        context.wuxingGroup = allSkillGroups.find(g => g.key === 'wuxing');
        context.standardSkillGroups = allSkillGroups.filter(g => g.key !== 'wuxing');

        // =====================================================
        // [编辑器] 获取属性调整选项
        // -----------------------------------------------------
        const modifierChoices = getModifierChoices();
        const flatModifiers = {};
        for (const group of Object.values(modifierChoices)) {
            Object.assign(flatModifiers, group);
        }

        if (context.system.customModifiers) {
            context.system.customModifiers.forEach(group => {
                if (group.changes) {
                    group.changes.forEach(change => {
                        change.displayLabel = flatModifiers[change.key] || change.key || "请选择属性...";
                    });
                }
            });
        }

        // =====================================================
        // ✦ 5. 战斗核心数据 (Combat & Martial Arts)
        // -----------------------------------------------------

        // --- 内功列表处理 ---
        let neigongs = actor.itemTypes.neigong || [];
        neigongs.sort((a, b) => {
            if (a.system.active !== b.system.active) return a.system.active ? -1 : 1;
            return b.system.tier - a.system.tier;
        });

        context.neigongs = neigongs;
        context.neigongs.forEach(item => {
            item.isRunning = item.system.active;

            // === 分阶段进度计算 ===
            const sys = item.system;
            const tier = sys.tier;
            const config = sys.config;

            const r1 = config.stage1?.xpCostRatio ?? 1;
            const r2 = config.stage2?.xpCostRatio ?? 1;
            const r3 = config.stage3?.xpCostRatio ?? 1;

            let baseCosts = [0, 0, 0];
            if (tier === 1) baseCosts = [0, 1000, 2000];
            else if (tier === 2) baseCosts = [1000, 3000, 6000];
            else if (tier === 3) baseCosts = [2000, 10000, 18000];

            const c1 = Math.floor(baseCosts[0] * r1);
            const c2 = Math.floor(baseCosts[1] * r2);
            const c3 = Math.floor(baseCosts[2] * r3);

            let remaining = sys.xpInvested;
            const v1 = Math.min(remaining, c1); remaining = Math.max(0, remaining - c1);
            const v2 = Math.min(remaining, c2); remaining = Math.max(0, remaining - c2);
            const v3 = Math.min(remaining, c3);

            const getCol = (v, max) => {
                if (max === 0) return "#2ecc71";
                return v >= max ? "#2ecc71" : (v > 0 ? "#f1c40f" : "#999");
            };

            // --- 构建 Tooltip HTML ---
            let html = `<div style='text-align:left; min-width:180px; max-width:250px; font-family:var(--font-serif);'>`;

            html += `<div style='border-bottom:1px solid rgba(255,255,255,0.2); margin-bottom:6px; padding-bottom:4px; font-weight:bold; color:#fff; display:flex; justify-content:space-between;'>
                        <span>${item.name}</span>
                        <span style='font-family:Consolas; color:var(--c-highlight);'>${sys.xpInvested} / ${sys.progressData.absoluteMax}</span>
                     </div>`;

            if (sys.requirement) {
                html += `<div style='color:#ff6b6b; font-size:11px; margin-bottom:8px; display:flex; align-items:flex-start; line-height:1.4;'>
                    <i class='fas fa-exclamation-circle' style='margin-top:2px; margin-right:4px; flex-shrink:0;'></i>
                    <span>${cleanRichText(sys.requirement)}</span>
                </div>`;
            }

            // 进度显示
            html += `<div style='display:flex; justify-content:space-between; margin-bottom:3px; font-size:12px;'>
                        <span style='color:#ccc'>领悟:</span> <span style='font-family:Consolas; color:${getCol(v1, c1)}'>${v1} / ${c1}</span>
                     </div>`;
            html += `<div style='display:flex; justify-content:space-between; margin-bottom:3px; font-size:12px;'>
                        <span style='color:#ccc'>小成:</span> <span style='font-family:Consolas; color:${getCol(v2, c2)}'>${v2} / ${c2}</span>
                     </div>`;
            html += `<div style='display:flex; justify-content:space-between; font-size:12px;'>
                        <span style='color:#ccc'>圆满:</span> <span style='font-family:Consolas; color:${getCol(v3, c3)}'>${v3} / ${c3}</span>
                     </div>`;

            // 境界特效
            const currentStage = Math.max(1, sys.stage || 0);
            const stageConfig = config[`stage${currentStage}`];
            const stageLabels = { 1: "领悟", 2: "小成", 3: "圆满" };

            if (stageConfig && stageConfig.description) {
                html += `<div style='margin-top:8px; background:rgba(255,255,255,0.05); padding:6px; border-radius:4px; border-left:2px solid var(--c-highlight);'>
                    <div style='font-weight:bold; color:var(--c-highlight); font-size:11px; margin-bottom:2px;'>
                        ${stageLabels[currentStage] || "境界"}特效
                    </div>
                    <div style='color:#ddd; font-size:11px; line-height:1.4;'>
                        ${cleanRichText(stageConfig.description)}
                    </div>
                 </div>`;
            }

            // 自动化说明 (使用辅助函数)
            if (sys.automationNote) {
                html += buildAutomationHTML(sys.automationNote);
            }

            // 描述 (使用辅助函数)
            if (sys.description) {
                html += `<div style='margin-top:6px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.1);'>
                            ${buildDescriptionHTML(sys.description, 50)}
                         </div>`;
            }

            html += `</div>`;
            item.xpTooltip = html;
        });

        // =====================================================
        // [当前运行内功] 状态处理 (使用 cleanRichText)
        // =====================================================
        context.activeNeigong = null;
        if (system.martial.active_neigong) {
            const ng = actor.items.get(system.martial.active_neigong);
            if (ng) {
                const currentStage = Math.max(1, ng.system.stage || 0);
                const stageConfig = ng.system.config[`stage${currentStage}`];
                const stageLabels = { 1: "领悟", 2: "小成", 3: "圆满" };

                const effectText = cleanRichText(stageConfig?.description || "");
                const loreText = cleanRichText(ng.system.description || "");

                context.activeNeigong = {
                    name: ng.name,
                    id: ng.id,
                    stageLabel: stageLabels[currentStage] || "境界",
                    effect: effectText,
                    description: loreText,
                    hasEffect: !!effectText,
                    automationNote: ng.system.automationNote
                };
            }
        }

        // =====================================================
        // [架招] 状态处理 (使用 cleanRichText)
        // =====================================================
        context.activeStance = null;
        const martial = system.martial;
        if (martial.stanceActive && martial.stanceItemId && martial.stance) {
            const stanceItem = actor.items.get(martial.stanceItemId);
            const move = stanceItem?.system.moves.find(m => m.id === martial.stance);
            if (move) {
                context.activeStance = {
                    name: move.name,
                    description: cleanRichText(move.description),
                    automationNote: move.automationNote
                };
            }
        }

        // =====================================================
        // [外功/武学] 预计算招式伤害
        // =====================================================
        const pinnedList = actor.getFlag("xjzl-system", "pinnedMoves") || [];
        const pinnedSet = new Set(pinnedList);

        let wuxueItems = actor.itemTypes.wuxue || [];
        wuxueItems.sort((a, b) => (a.sort || 0) - (b.sort || 0));
        context.wuxues = wuxueItems;

        for (const wuxue of context.wuxues) {
            const moves = wuxue.system.moves || [];

            moves.forEach(move => {
                // 1. 基础计算
                const result = wuxue.calculateMoveDamage(move.id);
                move.derived = result || { damage: 0, breakdown: "无数据", cost: { mp: 0, rage: 0, hp: 0 }, isWeaponMatch: true };

                const refKey = `${wuxue.id}.${move.id}`;
                move.isPinned = pinnedSet.has(refKey);

                // 2. 进度分级计算
                const tier = move.computedTier;
                const ratio = move.xpCostRatio ?? 1;

                let rawThresholds = [];
                let labels = [];
                if (move.progression.mode === "custom" && move.progression.customThresholds.length > 0) {
                    // 使用自定义门槛
                    rawThresholds = move.progression.customThresholds;
                    // 自定义模式没有固定的“领悟/小成”叫法，生成通用标签
                    labels = rawThresholds.map((_, i) => `阶段 ${i + 1}`);
                }
                else if (wuxue.system.category === "qinggong" || wuxue.system.category === "zhenfa") {
                    if (tier === 1) rawThresholds = [1000];
                    else if (tier === 2) rawThresholds = [3000];
                    else rawThresholds = [6000];
                    labels = ["习得"];
                } else {
                    if (tier === 1) { rawThresholds = [0, 500, 1000]; labels = ["领悟", "掌握", "精通"]; }
                    else if (tier === 2) { rawThresholds = [500, 1500, 3000]; labels = ["领悟", "掌握", "精通"]; }
                    else { rawThresholds = [1000, 3000, 6000, 10000]; labels = ["领悟", "掌握", "精通", "合一"]; }
                }

                const thresholds = rawThresholds.map(t => Math.floor(t * ratio));
                const xp = move.xpInvested;
                const absoluteMax = thresholds.length > 0 ? thresholds[thresholds.length - 1] : 0;

                if (!move.progress) move.progress = {};
                move.progress.currentMax = absoluteMax;

                // 3. 构建招式 Tooltip
                // 注意：这里应用了 white-space: pre-wrap 和 max-width
                let tooltipHTML = `<div style='text-align:left; min-width:180px; max-width:300px; white-space: pre-wrap; font-family:var(--font-serif);'>`;

                const typeLabel = game.i18n.localize(`XJZL.Wuxue.Type.${move.type}`);
                tooltipHTML += `<div style='border-bottom:1px solid rgba(255,255,255,0.2); margin-bottom:6px; padding-bottom:4px; font-weight:bold; color:#fff; display:flex; justify-content:space-between;'>
                                    <span>${move.name}</span>
                                    <span style='font-size:11px; color:#aaa; border:1px solid #555; padding:0 4px; border-radius:4px;'>${typeLabel}</span>
                                 </div>`;

                if (move.requirements) {
                    tooltipHTML += `<div style='color:#ff6b6b; font-size:11px; margin-bottom:8px; display:flex; align-items:flex-start; line-height:1.4;'>
                        <i class='fas fa-exclamation-circle' style='margin-top:2px; margin-right:4px; flex-shrink:0;'></i>
                        <span>${cleanRichText(move.requirements)}</span>
                    </div>`;
                }

                if (move.progression.mappedStage && move.progression.mappedStage !== 0 && move.progression.mappedStage !== 5) {
                    const stageNames = ["", "领悟", "掌握", "精通", "合一"];
                    tooltipHTML += `<div style='margin-bottom:8px; padding:6px; background:rgba(255,215,0,0.1); border:1px solid #ffd700; border-radius:4px; text-align:center;'>
                                        <div style='color:#ffd700; font-weight:bold;'>境界锁定</div>
                                        <div style='font-size:12px; color:#fff;'>视为：${stageNames[move.progression.mappedStage] || "未知"}</div>
                                    </div>`;
                } else {
                    for (let i = 0; i < thresholds.length; i++) {
                        const currentT = thresholds[i];
                        const prevT = i > 0 ? thresholds[i - 1] : 0;
                        const segmentMax = currentT - prevT;
                        let segmentVal = (segmentMax === 0) ? ((xp >= currentT) ? 0 : 0) : Math.max(0, Math.min(segmentMax, xp - prevT));

                        let color = "#999";
                        if (segmentMax === 0) color = "#2ecc71";
                        else if (segmentVal >= segmentMax) color = "#2ecc71";
                        else if (segmentVal > 0) color = "#f1c40f";

                        tooltipHTML += `<div style='display:flex; justify-content:space-between; margin-bottom:3px; font-size:12px;'>
                                            <span style='color:#ccc'>${labels[i]}:</span>
                                            <span style='font-family:Consolas; color:${color}'>${segmentVal} / ${segmentMax}</span>
                                        </div>`;
                    }
                }

                tooltipHTML += `<div style='font-size:11px; color:#aaa; margin-top:6px; padding-top:4px; border-top:1px dashed #555;'>总投入: ${move.xpInvested}</div>`;

                // 自动化说明 (使用辅助函数)
                if (move.automationNote) {
                    tooltipHTML += buildAutomationHTML(move.automationNote);
                }

                // 描述 (使用辅助函数)
                if (move.description) {
                    tooltipHTML += `<hr style='border:0; border-top:1px dashed rgba(255,255,255,0.1); margin:4px 0;'>`;
                    tooltipHTML += buildDescriptionHTML(move.description);
                }

                tooltipHTML += `</div>`;
                move.tooltip = tooltipHTML;

                if (move.derived.damage) {
                    const bdHtml = move.derived.breakdown.replace(/\n/g, "<br>");
                    move.derived.breakdownTooltip = `<div style='text-align:left; font-family:Consolas; font-size:11px;'>${bdHtml}</div>`;
                }
            });

            // --- 5. 构建武学书本 Tooltip ---
            let bookTooltip = `<div style='text-align:left; max-width:250px; font-family:var(--font-serif);'>`;
            bookTooltip += `<div style='font-weight:bold; margin-bottom:5px; color:#fff; border-bottom:1px solid rgba(255,255,255,0.2);'>${wuxue.name}</div>`;

            if (wuxue.system.description) {
                // 使用 buildDescriptionHTML，它包含了 white-space: pre-wrap
                bookTooltip += buildDescriptionHTML(wuxue.system.description);
            }

            if (wuxue.system.requirements) {
                // 需求描述也建议清洗一下
                bookTooltip += `<hr style='border-color:#555;'><div style='font-size:10px; color:#e74c3c;'>${cleanRichText(wuxue.system.requirements)}</div>`;
            }
            bookTooltip += `</div>`;
            wuxue.tooltip = bookTooltip;
        }

        // =====================================================
        // [Helper] 动态构建战斗属性 Breakdown Tooltip
        // =====================================================
        const buildBreakdown = (label, total, mod, extra = "") => {
            const safeMod = mod || 0;
            const base = total - safeMod;
            return `
            <div style="text-align:left; min-width:150px; font-family:var(--font-serif);">
                <div style="border-bottom:1px solid rgba(255,255,255,0.2); margin-bottom:6px; padding-bottom:2px; font-weight:bold; font-size:14px; color:#fff;">
                    ${label} <span style="float:right; color:var(--c-highlight); font-family:Consolas;">${total}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:12px; color:#ccc; line-height:1.6;">
                    <span>基础能力:</span> <span style="font-family:Consolas;">${base}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:12px; color:#ccc; line-height:1.6;">
                    <span>装备/状态:</span> 
                    <span style="font-family:Consolas; color:${safeMod > 0 ? '#2ecc71' : (safeMod < 0 ? '#e74c3c' : '#ccc')}">
                        ${safeMod >= 0 ? '+' : ''}${safeMod}
                    </span>
                </div>
                ${extra ? `<div style="margin-top:6px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.1); font-size:11px; color:#aaa;">${extra}</div>` : ''}
            </div>`;
        };

        // 构建 combatStats
        context.combatStats = {
            attributesLeft: [], attributesRight: [], wuxing: null,
            hitWaigong: { val: system.combat.hitWaigongTotal, tooltip: buildBreakdown("外功命中", system.combat.hitWaigongTotal, system.combat.hit_waigong) },
            critWaigong: { val: system.combat.critWaigongTotal, tooltip: buildBreakdown("外功暴击", system.combat.critWaigongTotal, system.combat.crit_waigong, "<div style='color:#e74c3c; font-size:10px;'>*越低越容易暴击</div>") },
            hitNeigong: { val: system.combat.hitNeigongTotal, tooltip: buildBreakdown("内功命中", system.combat.hitNeigongTotal, system.combat.hit_neigong) },
            critNeigong: { val: system.combat.critNeigongTotal, tooltip: buildBreakdown("内功暴击", system.combat.critNeigongTotal, system.combat.crit_neigong, "<div style='color:#e74c3c; font-size:10px;'>*越低越容易暴击</div>") },
            defWaigong: { val: system.combat.defWaigongTotal, tooltip: buildBreakdown("外功防御", system.combat.defWaigongTotal, system.combat.def_waigong) },
            defNeigong: { val: system.combat.defNeigongTotal, tooltip: buildBreakdown("内功防御", system.combat.defNeigongTotal, system.combat.def_neigong) },
            block: { val: system.combat.blockTotal, tooltip: buildBreakdown("格挡值", system.combat.blockTotal, (system.combat.block || 0), system.combat.stanceBlockValue ? `<div style='color:#f1c40f'>架招加成: +${system.combat.stanceBlockValue}</div>` : "") },
            speed: { val: system.combat.speedTotal, tooltip: buildBreakdown("移动速度", system.combat.speedTotal, system.combat.speed) },
            initiative: { val: system.combat.initiativeTotal, tooltip: buildBreakdown("先攻值", system.combat.initiativeTotal, system.combat.initiative) },
            dodge: { val: system.combat.dodgeTotal, tooltip: buildBreakdown("闪避值", system.combat.dodgeTotal, system.combat.dodge) },
            kanpo: { val: system.combat.kanpoTotal, tooltip: buildBreakdown("看破", system.combat.kanpoTotal, system.combat.kanpo) },
            xuzhao: { val: system.combat.xuzhaoTotal, tooltip: buildBreakdown("虚招", system.combat.xuzhaoTotal, system.combat.xuzhao) },
            weaponRanks: [], resistances: {}, damages: {}
        };

        // --- 填充属性与悟性 (Attributes) ---
        const statsSchema = system.schema.fields.stats.fields;
        const attrKeys = ["liliang", "shenfa", "tipo", "wuxing", "neixi", "qigan", "shencai"];

        attrKeys.forEach((key, index) => {
            const stat = system.stats[key];
            const labelKey = statsSchema[key]?.label || `XJZL.Stats.${key}`;
            const label = game.i18n.localize(labelKey).charAt(0);
            const base = stat.value ?? 0;
            const mod = stat.mod ?? 0;
            let tooltip = "";

            if (key === "wuxing") {
                const cultBonus = system.cultivation?.wuxingBonus || 0;
                tooltip = `
                <div style="text-align:left; min-width:140px;">
                    <strong style="border-bottom:1px solid #555; display:block; margin-bottom:4px;">${game.i18n.localize(labelKey)}: ${stat.total}</strong>
                    <table style="width:100%; font-size:11px; color:#ddd;">
                        <tr><td>先天根骨:</td><td style="text-align:right">${base}</td></tr>
                        <tr><td>境界/武学:</td><td style="text-align:right; color:#ffd700;">+${cultBonus}</td></tr>
                        <tr><td>奇遇修正:</td><td style="text-align:right">${mod >= 0 ? '+' : ''}${mod}</td></tr>
                    </table>
                    <div style="font-size:10px; color:#999; margin-top:4px;">*悟性不可自由分配</div>
                </div>`;
            } else {
                const assigned = stat.assigned ? `<tr><td>分配:</td><td style="text-align:right">+${stat.assigned}</td></tr>` : "";
                const neigongBonus = stat.neigongBonus ? `<tr><td>内功:</td><td style="text-align:right">+${stat.neigongBonus}</td></tr>` : "";
                const identity = stat.identityBonus ? `<tr><td>身份:</td><td style="text-align:right">+${stat.identityBonus}</td></tr>` : "";
                tooltip = `
                <div style="text-align:left; min-width:120px;">
                    <strong style="border-bottom:1px solid #555; display:block; margin-bottom:4px;">${game.i18n.localize(labelKey)}: ${stat.total}</strong>
                    <table style="width:100%; font-size:11px; color:#ddd;">
                        <tr><td>基础:</td><td style="text-align:right">${base}</td></tr>
                        ${assigned}${neigongBonus}${identity}
                        <tr><td>修正:</td><td style="text-align:right">${mod >= 0 ? '+' : ''}${mod}</td></tr>
                    </table>
                </div>`;
            }
            const data = { key: key, label: label, total: stat.total, assigned: stat.assigned, tooltip: tooltip };
            if (key === "wuxing") context.combatStats.wuxing = data;
            else if (index < 3) context.combatStats.attributesLeft.push(data);
            else context.combatStats.attributesRight.push(data);
        });

        // --- 填充武器等级, 抗性, 伤害 (保持逻辑不变) ---
        const weaponChars = { sword: "剑", blade: "刀", staff: "棍", dagger: "匕", hidden: "暗", unarmed: "拳", instrument: "乐", special: "奇" };
        const orderedWeaponKeys = Object.keys(CONFIG.XJZL.weaponTypes || {});
        for (const key of orderedWeaponKeys) {
            if (key === 'none') continue;
            const rankData = system.combat.weaponRanks[key];
            if (!rankData) continue;

            context.combatStats.weaponRanks.push({
                label: game.i18n.localize(`XJZL.Combat.Rank.${key.charAt(0).toUpperCase() + key.slice(1)}`),
                val: rankData.total,
                char: weaponChars[key] || "武"
            });
        }
        for (const [key, stat] of Object.entries(system.combat.resistances)) {
            const capKey = key.charAt(0).toUpperCase() + key.slice(1);
            const labelKey = `XJZL.Combat.Res.${capKey}`;

            context.combatStats.resistances[key] = {
                label: game.i18n.localize(labelKey),
                total: stat.total
            };
        }
        for (const [key, stat] of Object.entries(system.combat.damages)) {
            if (key === 'weaponTypes') continue;

            const capKey = key.charAt(0).toUpperCase() + key.slice(1);
            const labelKey = `XJZL.Combat.Dmg.${capKey}`;

            context.combatStats.damages[key] = {
                label: game.i18n.localize(labelKey),
                total: stat.total
            };
        }
        if (system.combat.damages.weaponTypes) {
            for (const [subKey, subStat] of Object.entries(system.combat.damages.weaponTypes)) {
                if (subStat.total !== 0) {
                    const capKey = subKey.charAt(0).toUpperCase() + subKey.slice(1);
                    const baseLabel = game.i18n.localize(`XJZL.Combat.Rank.${capKey}`);
                    context.combatStats.damages[subKey] = {
                        label: baseLabel + '伤害',
                        total: subStat.total
                    };
                }
            }
        }

        // --- 常用招式 (Pinned Moves) ---
        const pinnedRefs = actor.getFlag("xjzl-system", "pinnedMoves") || [];
        context.pinnedMoves = [];
        for (const ref of pinnedRefs) {
            try {
                const parts = ref.split(".");
                const moveId = parts.pop();
                const itemId = parts.pop();
                const item = actor.items.get(itemId);
                if (item) {
                    const move = item.system.moves.find(m => m.id === moveId);
                    if (move) {
                        context.pinnedMoves.push({
                            name: move.name, type: move.type, isUltimate: move.isUltimate, computedLevel: move.computedLevel,
                            range: move.range, derived: move.derived, tooltip: move.tooltip, currentCost: move.currentCost,
                            parentName: item.name, itemId: item.id, moveId: moveId, isPinned: true, actionCost: move.actionCost
                        });
                    }
                }
            } catch (e) { console.error("解析常用招式失败:", ref, e); }
        }

        // =====================================================
        // ✦ 6. 技艺与身份系统 (Arts & Identities)
        // -----------------------------------------------------
        const allArts = [];
        const activeIdentities = system.activeIdentities || {};
        for (const [key, labelKey] of Object.entries(XJZL.arts)) {
            const artData = system.arts[key];
            if (!artData) continue;
            const artObj = { key: key, label: labelKey, total: artData.total || 0, identity: null };

            const identityData = activeIdentities[key];
            if (identityData && identityData.highest) {
                const capKey = key.charAt(0).toUpperCase() + key.slice(1);
                const badgeTitle = game.i18n.localize(`XJZL.Identity.${capKey}.${identityData.highest.titleKey}`);
                const tooltipRows = identityData.all.map(id => `
                <div style="margin-bottom: 8px;">
                    <div style="color:var(--c-highlight); font-weight:bold; font-size:1.1em;">
                        <i class="fas fa-caret-right" style="font-size:0.8em;"></i> ${game.i18n.localize(`XJZL.Identity.${capKey}.${id.titleKey}`)} <span style="opacity:0.6; font-size:0.8em;">(Lv.${id.level})</span>
                    </div>
                    <div style="padding-left: 10px; line-height: 1.4; color: #ddd; font-size: 0.9em;">${game.i18n.localize(`XJZL.Identity.${capKey}.${id.descKey}`)}</div>
                </div>`).join("<hr style='border-color:#444; margin: 4px 0;'>");

                artObj.identity = {
                    title: badgeTitle,
                    tooltip: `<div style="text-align:left; max-width:400px; padding:2px;">${tooltipRows}</div>`,
                    level: identityData.highest.level
                };
            }
            allArts.push(artObj);
        }
        context.learnedArts = allArts.filter(a => a.total > 0);
        context.unlearnedArts = allArts.filter(a => a.total === 0);

        // =====================================================
        // ✦ 7. 经脉可视化数据 (Jingmai Visualization)
        // -----------------------------------------------------
        const MERIDIAN_COORDS = {
            "hand_taiyin": { x: 36, y: 28 }, "hand_jueyin": { x: 24, y: 40 }, "hand_shaoyin": { x: 32, y: 52 },
            "foot_taiyin": { x: 42, y: 66 }, "foot_jueyin": { x: 28, y: 78 }, "foot_shaoyin": { x: 38, y: 92 },
            "foot_taiyang": { x: 50, y: 19 },
            "hand_taiyang": { x: 66, y: 32 }, "hand_yangming": { x: 74, y: 46 }, "hand_shaoyang": { x: 60, y: 56 },
            "foot_yangming": { x: 54, y: 72 }, "foot_shaoyang": { x: 64, y: 86 },
        };
        const equippedQizhenMap = {};
        (actor.itemTypes.qizhen || []).forEach(item => {
            if (item.system.equipped && item.system.acupoint) equippedQizhenMap[item.system.acupoint] = item;
        });
        const standardMeta = {
            "hand_shaoyin": { t: 1, type: "yin" }, "foot_shaoyin": { t: 1, type: "yin" },
            "hand_shaoyang": { t: 1, type: "yang" }, "foot_shaoyang": { t: 1, type: "yang" },
            "hand_jueyin": { t: 2, type: "yin" }, "foot_jueyin": { t: 2, type: "yin" },
            "hand_yangming": { t: 2, type: "yang" }, "foot_yangming": { t: 2, type: "yang" },
            "hand_taiyin": { t: 3, type: "yin" }, "foot_taiyin": { t: 3, type: "yin" },
            "hand_taiyang": { t: 3, type: "yang" }, "foot_taiyang": { t: 3, type: "yang" }
        };

        context.jingmaiStandardList = Object.entries(standardMeta).map(([key, meta]) => {
            const isOpen = system.jingmai.standard[key];
            const coord = MERIDIAN_COORDS[key] || { x: 50, y: 50 };
            const equippedItem = equippedQizhenMap[key];
            const fullName = game.i18n.localize(`XJZL.Jingmai.${key.charAt(0).toUpperCase() + key.slice(1)}`);
            const shortLabel = fullName.match(/\(([^)]+)\)/)?.[1] || fullName;

            let tooltip = `
            <div style='text-align:left; min-width:200px;'>
                <div style='font-weight:bold; color:var(--c-highlight); font-size:14px;'>${fullName}</div>
                <div style='font-size:10px; color:#ccc; margin-bottom:6px;'>${game.i18n.localize(`XJZL.Jingmai.T${meta.t}`)} · ${meta.type === 'yin' ? '阴脉' : '阳脉'}</div>
                <div style='padding:4px; background:rgba(255,255,255,0.1); border-radius:4px;'>${game.i18n.localize(`XJZL.Jingmai.Effects.${key.charAt(0).toUpperCase() + key.slice(1)}`)}</div>
            </div>`;

            if (equippedItem) {
                tooltip += `<hr style='border-color:#555; margin:8px 0;'>
                <div style='color:#a2e8dd; font-weight:bold; margin-bottom:4px;'><i class='fas fa-gem'></i> ${equippedItem.name}</div>
                <div style='font-size:11px; color:#aaa; line-height:1.4;'>${equippedItem.system.description || "暂无描述"}</div>`;
            }

            return { key, label: shortLabel, isActive: isOpen, tooltip, x: coord.x, y: coord.y, equippedItem, type: meta.type, tierLabel: `XJZL.Jingmai.T${meta.t}` };
        });

        const extraOrder = ["du", "ren", "chong", "dai", "yangwei", "yinwei", "yangqiao", "yinqiao"];
        context.jingmaiExtraList = extraOrder.map(key => {
            const capKey = key.charAt(0).toUpperCase() + key.slice(1);
            return {
                key: key, label: `XJZL.Jingmai.${capKey}`, isActive: system.jingmai.extra[key],
                tooltip: `<div style='text-align:left; max-width:250px;'><div style='margin-bottom:4px;'><b>条件:</b> ${game.i18n.localize(`XJZL.Jingmai.Conditions.${capKey}`)}</div><div style='color:#ccc;'><b>效果:</b> ${game.i18n.localize(`XJZL.Jingmai.Effects.${capKey}`)}</div></div>`
            };
        });

        // 将当前的视图模式状态传给 HBS
        context.jingmaiAttemptMode = this._jingmaiAttemptMode || false;

        // =====================================================
        // ✦ 8. 物品清单(Inventory)
        // -----------------------------------------------------
        context.inventory = [
            { label: "TYPES.Item.weapon", type: "weapon", items: actor.itemTypes.weapon },
            { label: "TYPES.Item.armor", type: "armor", items: actor.itemTypes.armor },
            { label: "TYPES.Item.qizhen", type: "qizhen", items: actor.itemTypes.qizhen },
            { label: "TYPES.Item.consumable", type: "consumable", items: actor.itemTypes.consumable },
            { label: "TYPES.Item.manual", type: "manual", items: actor.itemTypes.manual },
            { label: "TYPES.Item.misc", type: "misc", items: actor.itemTypes.misc }
        ];

        // =====================================================
        // ✦ 9. 装备架数据 (Equipment Rack)
        // -----------------------------------------------------
        const equipped = { weapon: null, head: null, top: null, bottom: null, shoes: null, necklace: null, earring: null, hidden: null, rings: [], accessories: [] };
        if (actor.items) {
            for (const item of actor.items) {
                if (!item.system.equipped) continue;
                const type = item.type;
                const armorType = item.system.type;
                if (type === "weapon") { if (!equipped.weapon) equipped.weapon = item; }
                else if (type === "armor") {
                    switch (armorType) {
                        case "head": equipped.head = item; break;
                        case "top": equipped.top = item; break;
                        case "bottom": equipped.bottom = item; break;
                        case "shoes": equipped.shoes = item; break;
                        case "necklace": equipped.necklace = item; break;
                        case "earring": equipped.earring = item; break;
                        case "hidden": equipped.hidden = item; break;
                        case "ring": if (equipped.rings.length < 2) equipped.rings.push(item); break;
                        case "accessory": if (equipped.accessories.length < 6) equipped.accessories.push(item); break;
                    }
                }
            }
        }
        while (equipped.rings.length < 2) equipped.rings.push(null);
        while (equipped.accessories.length < 6) equipped.accessories.push(null);
        context.equipped = equipped;

        // =====================================================
        // 动态背景 (根据性别)
        // =====================================================
        const gender = actor.system.info.gender;
        context.dollBg = (gender === "female") ? "systems/xjzl-system/assets/icons/character/zhanli-f.svg" : "systems/xjzl-system/assets/icons/character/zhanli.svg";

        // =====================================================
        // ✦ 10. 技艺书籍 (Art Books)
        // -----------------------------------------------------
        const rawArtBooks = actor.itemTypes.art_book || [];
        context.artBooks = rawArtBooks.map(book => {
            const maxXP = book.system.chapters.reduce((sum, c) => sum + Math.floor((c.cost || 0) * (c.xpCostRatio ?? 1)), 0);
            let completedCount = 0;
            if (book.system.chapters) {
                for (const ch of book.system.chapters) if (ch.progress && ch.progress.isCompleted) completedCount++;
            }
            const totalChap = book.system.chapters.length;
            const isCompleted = (totalChap > 0 && completedCount >= totalChap);
            const progressColor = isCompleted ? "#2ecc71" : "var(--c-highlight)";
            const progressText = isCompleted ? "已通读" : `完成: ${completedCount} / ${totalChap} 章`;

            // 构建 Tooltip
            let tooltip = `<div style='text-align:left; max-width:250px; font-family:var(--font-serif);'>`;
            tooltip += `<div style='font-weight:bold; margin-bottom:5px; color:#fff; border-bottom:1px solid rgba(255,255,255,0.2);'>${book.name}</div>`;
            if (book.system.description) tooltip += buildDescriptionHTML(book.system.description, 150);
            else tooltip += `<div style='font-size:12px; color:#999; font-style:italic;'>暂无描述</div>`;
            tooltip += `<div style='margin-top:8px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.1); font-size:11px; color:${progressColor};'>进度: ${progressText}</div></div>`;

            book.derived = {
                maxXP: maxXP, tooltip: tooltip,
                percent: maxXP > 0 ? Math.min(100, (book.system.xpInvested / maxXP) * 100) : 0,
                isCompleted: isCompleted
            };
            return book;
        });

        /* -------------------------------------------- */
        /*  11. 统一构建通用物品 Tooltip          */
        /* -------------------------------------------- */
        // 使用局部定义的 cleanRichText 和 buildAutomationHTML
        const buildGeneralTooltip = (item) => {
            let html = `<div style='text-align:left; max-width:250px; font-family:var(--font-serif);'>`;
            html += `<div style='font-weight:bold; margin-bottom:5px; color:#fff; border-bottom:1px solid rgba(255,255,255,0.2);'>${item.name}</div>`;

            if (item.system.automationNote) html += buildAutomationHTML(item.system.automationNote);

            if (item.system.description) {
                html += buildDescriptionHTML(item.system.description, 200);
            } else {
                html += `<div style='font-size:12px; color:#999; font-style:italic;'>暂无描述</div>`;
            }

            if (item.type === "weapon" || item.type === "armor") {
                const qualityLabel = game.i18n.localize(`XJZL.Qualities.${item.system.quality}`);
                html += `<div style='margin-top:6px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.1); font-size:10px; color:#e67e22;'>${qualityLabel}</div>`;
            }

            html += `</div>`;
            return html;
        };

        const inventoryTypes = ["weapon", "armor", "qizhen", "consumable", "manual", "misc"];
        inventoryTypes.forEach(type => {
            const items = actor.itemTypes[type] || [];
            items.forEach(item => { item.derivedTooltip = buildGeneralTooltip(item); });
        });

        // [特效计算]
        this._prepareEffects(context);
        context.isSorting = this._isSorting || false;

        return context;
    }

    /**
     * 准备特效数据，处理分类逻辑
     */
    _prepareEffects(context) {
        const temporaryEffects = [];
        const passiveEffects = [];

        // 1. 使用 appliedEffects (包含装备衍生的特效)
        const effects = this.actor.appliedEffects;

        for (const e of effects) {
            // 过滤掉被禁用的 (可选，如果你想显示禁用的可以去掉这行)
            if (e.disabled) continue;

            // 2. 准备显示数据
            // sourceName 是 V13 ActiveEffect 的原生 Getter，会自动解析 origin
            let source = e.sourceName;
            // 如果原生 Getter 获取失败 (比如 origin 链接断了)，做个兜底
            if (source === "Unknown" || !source) {
                // 尝试手动获取 Item 名字
                if (e.parent instanceof Item) source = e.parent.name;
                else source = "未知来源";
            }

            // 如果我们在 XJZLActiveEffect 里定义了 displayLabel (带层数)，就用它
            // 否则用 e.name
            const displayName = e.displayLabel || e.name;

            const effectData = {
                id: e.id,
                name: displayName,
                img: e.img,
                description: e.description,
                sourceName: source,
                // 为了给 HBS 里的删除按钮用，如果特效属于 Item (被动)，通常不允许在 Actor 卡直接删除
                isItemEffect: (e.parent instanceof Item) && e.transfer
            };

            // 3. 核心分类逻辑 (Wuxia 风格)

            // 判定条件 A: 是系统认定的临时特效 (有持续时间, 或 StatusEffect)
            const isTemp = e.isTemporary;

            // 判定条件 B: 非被动传输 (即由脚本/消耗品产生，Transfer = false)
            // 这种特效即使持续时间无限，也应该算作 Buff，而不是装备属性
            const isActiveBuff = e.transfer === false;

            if (isTemp || isActiveBuff) {
                temporaryEffects.push(effectData);
            } else {
                // 剩下的归为被动 (装备/内功自带，且 Transfer = true)
                passiveEffects.push(effectData);
            }
        }

        context.temporaryEffects = temporaryEffects;
        context.passiveEffects = passiveEffects;
    }

    /* -------------------------------------------- */
    /*  事件监听与自动保存                           */
    /* -------------------------------------------- */

    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element; // AppV2 中 this.element 就是根节点
        // =====================================================
        // Header 滚动条记忆修复 (Capture + Passive)
        // 解决了 V13 原生 scrollable 无法监听 header滚动条的问题
        // =====================================================

        // 1. RAF 确保在 CSS 布局计算完成后执行
        window.requestAnimationFrame(() => {
            const sidebar = this.element.querySelector(".sidebar-scroll-wrapper");
            if (sidebar && this._sidebarScrollPos > 0) {
                // 只有偏差较大时才修正，避免微小抖动
                if (Math.abs(sidebar.scrollTop - this._sidebarScrollPos) > 5) {
                    sidebar.scrollTop = this._sidebarScrollPos;
                }
            }
        });

        // 2. [绑定监听] 检查当前 DOM 引用是否已绑定
        if (this._boundScrollElement !== this.element) {
            this.element.addEventListener("scroll", (event) => {
                // 过滤目标：只记录 sidebar 的滚动
                if (event.target.classList?.contains("sidebar-scroll-wrapper")) {
                    this._sidebarScrollPos = event.target.scrollTop;
                }
            }, { capture: true, passive: true }); // passive: true 确保零性能损耗

            this._boundScrollElement = this.element;
        }
        // --- 折叠状态记忆 (Accordion Memory) ---
        // 初始化存储容器 (如果不存在)
        if (!this._collapsedDetails || !(this._collapsedDetails instanceof Map)) {
            this._collapsedDetails = new Map();
        }

        const details = html.querySelectorAll("details[data-uid]");
        details.forEach(el => {
            const uid = el.dataset.uid;
            const userState = this._collapsedDetails.get(uid);

            // A. 恢复状态
            // 如果这个ID在“已关闭”名单里，这就移除 open 属性
            if (userState !== undefined) {
                // 1. 如果用户操作过，以用户最后的状态为准 (无论 HTML 默认是什么)
                if (userState) {
                    el.setAttribute("open", "");
                } else {
                    el.removeAttribute("open");
                }
            }
            // 如果 userState 是 undefined (用户没动过)
            // -> 什么都不做！直接保留 HTML 模板里的默认状态。

            // B. 绑定监听
            // 使用 toggle 事件监听用户开关操作
            el.addEventListener("toggle", (event) => {
                // 只要状态变了，就记录下来
                // 注意：这里我们记录的是“当前是开还是关”，这就完美兼容了两种默认情况
                this._collapsedDetails.set(uid, el.open);
            });
        });
        // 1. 绑定即时搜索 (Live Search)
        const searchInput = html.querySelector(".inventory-search-input");

        if (searchInput) {
            // 使用 "input" 事件，能在打字的同时触发
            searchInput.addEventListener("input", (event) => {
                this._onSearchInventory(event, event.target);
            });

            // 可选：恢复之前的搜索词（防止重绘后清空，虽然如果是纯客户端过滤一般不需要）
            // searchInput.value = this._lastSearchTerm || "";
        }

        // 2. 绑定属性分配输入框
        // 这里的 input 没有 name 属性，所以不会触发 form 的 submitOnChange
        // 我们手动监听 change 事件来处理业务逻辑
        const assignInputs = html.querySelectorAll(".seal-assign-input");
        assignInputs.forEach(input => {
            input.addEventListener("change", (event) => this._onStatAssign(event));
        });

        // 3· 修练界面搜索
        const cultSearch = this.element.querySelector(".cultivation-search-input");
        if (cultSearch) {
            cultSearch.addEventListener("input", (event) => {
                this._onSearchCultivation(event, event.target);
            });
        }

        // =====================================================
        // 手动绑定拖拽事件 (Drag & Drop fix)
        // =====================================================
        // 1. 选取所有需要拖拽的元素类名
        //    注意：不要包含 .wuxue-group，因为你在 HTML 里写了 ondragstart 内联代码处理排序，我们避开它以免冲突
        const dragSelectors = [
            ".move-card",         // 招式
            ".item-grid-card",    // 物品/消耗品
            ".neigong-card",      // 内功 (可选，如果你想让他也能拖到物品栏备份)
            ".art-book-card"      // 技艺书 (可选)
        ];

        // 2. 遍历并绑定
        dragSelectors.forEach(selector => {
            const elements = html.querySelectorAll(selector);
            elements.forEach(el => {
                // 强制确保有 draggable 属性 (双重保险)
                el.setAttribute("draggable", "true");

                // 移除旧的监听器 (防止重绘多次绑定，虽说 AppV2 重绘是替换节点，但好习惯)
                el.removeEventListener("dragstart", this._onDragStart);

                // 绑定我们自己的处理函数
                // bind(this) 确保在 _onDragStart 里能用 this.actor
                el.addEventListener("dragstart", this._onDragStart.bind(this));
            });
        });

        // =====================================================
        // 计算并显示丹田占用情况
        // =====================================================
        // 直接从 system.cultivation 读取我们在 DataModel 算好的百分比
        const percent = this.actor.system.cultivation.storagePercent || 0;

        html.querySelectorAll(".xp-pool").forEach(poolEl => {
            // 防止重复绑定
            if (poolEl.dataset.ttBound) return;
            poolEl.dataset.ttBound = "true";

            // 只在鼠标进入时设置一次变量，而不是 move 时疯狂设置
            poolEl.addEventListener("mouseenter", () => {
                const tt = document.getElementById("tooltip");
                if (!tt) return;
                // CSS 变量传递百分比
                tt.style.setProperty("--progress", String(percent));
            });
        });
    }

    /**
     * 处理自由属性点分配 (完全接管逻辑)
     */
    async _onStatAssign(event) {
        event.preventDefault();
        event.stopPropagation(); // 阻止冒泡，虽然没有name也不会提交，但好习惯

        const input = event.target;
        const field = input.dataset.prop; // 从 data-prop 获取字段路径

        // 1. 强制转为数字 (解决 must be an integer 报错的根源)
        let value = Number(input.value);
        if (isNaN(value)) value = 0;

        // 2. 调用 Actor 的验证逻辑
        // 注意：这里我们不需要判断 name.includes，因为这个函数只绑定在分配框上
        if (typeof this.actor.canUpdateStat === "function") {
            const validation = this.actor.canUpdateStat(field, value);
            if (!validation.valid) {
                ui.notifications.warn(validation.message || "无法分配属性点。");
                input.value = validation.oldValue ?? 0; // 回滚界面显示
                return;
            }
        }

        // 3. 手动提交更新
        // 这会绕过 Form 的全量验证，直接点对点更新数据
        await this.document.update({ [field]: value });
    }

    /* -------------------------------------------- */
    /*  通用动作处理 (Action Handler)                */
    /* -------------------------------------------- */


    // 图片编辑
    async _onEditImage(event, target) {
        const attr = target.dataset.edit || "img";
        const current = foundry.utils.getProperty(this.document, attr);
        const fp = new foundry.applications.apps.FilePicker({
            type: "image",
            current: current,
            callback: path => this.document.update({ [attr]: path })
        });
        return fp.browse();
    }

    async _onAction(event, target) {
        const action = target.dataset.action;
        console.log("XJZL | Action Triggered:", action); // 调试用

        // === 修正组操作 (Group Operations) ===

        if (action === "addGroup") {
            const groups = this.document.system.customModifiers || [];
            // 创建一个新组，默认带一条数据
            await this.document.update({
                "system.customModifiers": [...groups, {
                    name: "新修正组",
                    enabled: true,
                    changes: [{ key: "stats.liliang.mod", value: 0 }]
                }]
            });
            return;
        }

        if (action === "deleteGroup") {
            const index = Number(target.dataset.index);
            // 数组没有 toObject，使用 deepClone 获取副本
            const groups = foundry.utils.deepClone(this.document.system.customModifiers);
            groups.splice(index, 1);
            await this.document.update({ "system.customModifiers": groups });
            return;
        }

        // === 条目操作 (Change Operations) ===

        if (action === "addChange") {
            const groupIndex = Number(target.dataset.groupIndex);
            const groups = foundry.utils.deepClone(this.document.system.customModifiers);

            // 向指定组的 changes 数组追加
            if (groups[groupIndex]) {
                groups[groupIndex].changes.push({ key: "stats.liliang.mod", value: 0 });
                await this.document.update({ "system.customModifiers": groups });
            }
            return;
        }

        if (action === "deleteChange") {
            const groupIndex = Number(target.dataset.groupIndex);
            const changeIndex = Number(target.dataset.changeIndex);
            const groups = foundry.utils.deepClone(this.document.system.customModifiers);

            // 从指定组移除指定条目
            if (groups[groupIndex] && groups[groupIndex].changes) {
                groups[groupIndex].changes.splice(changeIndex, 1);
                await this.document.update({ "system.customModifiers": groups });
            }
            return;
        }

        // === 人际关系操作 ===
        if (action === "addRelation") {
            // 获取当前数组副本
            const relations = this.document.system.social.relations || [];

            // 创建新条目
            const newRel = {
                id: foundry.utils.randomID(),
                name: "新相识",
                type: "普通",
                value: 0
            };

            // 更新 Actor
            await this.document.update({ "system.social.relations": [...relations, newRel] });
            return;
        }

        if (action === "deleteRelation") {
            const index = Number(target.dataset.index);
            // 复制数组进行剪接
            const relations = foundry.utils.deepClone(this.document.system.social.relations);
            relations.splice(index, 1);

            await this.document.update({ "system.social.relations": relations });
            return;
        }
    }

    /* -------------------------------------------- */
    /*  Drag & Drop 核心逻辑 (修复版)               */
    /* -------------------------------------------- */

    /**
     * @override
     * 拖拽事件的总入口
     * 职责：
     * 1. 解析拖拽数据。
     * 2. 区分是“外来物品”(新建/堆叠) 还是 “内部物品”(排序/移动)。
     * 3. 对于外来物品，绝对禁止在此处使用 await 数据库操作，必须直接交给父类。
     */
    async _onDrop(event) {
        event.preventDefault();

        // 1. 数据解析 (Standard Foundry Parsing)
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (err) {
            return super._onDrop(event, data);
        }

        // 如果不是物品，直接甩锅给父类处理 (比如可能是 Actor 或 Folder)
        if (data.type !== "Item") return super._onDrop(event, data);

        // =====================================================
        // 同步判定来源 (Synchronous Check)
        // =====================================================
        // 直接对比字符串。如果 UUID 以当前 Actor 的 UUID 开头，说明是自己身上的东西。
        const actorUuid = this.actor.uuid;
        // 判定：data.uuid 存在，且格式为 "ActorID.Item.ItemID"
        const isInternal = data.uuid && data.uuid.startsWith(actorUuid + ".Item.");

        // =====================================================
        // 情况 A：外来物品 (External Item)
        // =====================================================
        // 逻辑：如果是外面的东西，直接调用父类 super._onDrop。
        // 父类会自动处理异步数据加载，并回调下方的 _onDropItem 方法。
        if (!isInternal) {
            return super._onDrop(event, data);
        }

        // =====================================================
        // 情况 B：内部物品 (Internal Item)
        // =====================================================

        // 1. 检查排序开关
        // 如果没有开启排序模式，直接返回 false 禁止操作。
        // 这实现了“防止把物品拖到物品栏导致自我复制”的功能。
        if (!this._isSorting) {
            return false;
        }

        // 2. 获取源物品对象 (同步获取)
        // 因为是内部物品，它一定在 this.actor.items 缓存里，不需要 await。
        const itemId = data.uuid.split(".").pop(); // 从 UUID 字符串尾部提取 ID
        const sourceItem = this.actor.items.get(itemId);

        // 防御性检查：如果找不到物品，或者还没加载好，终止
        if (!sourceItem) return false;

        // -----------------------------------------------------
        // 自定义排序逻辑 (Sorting Logic)
        // -----------------------------------------------------

        // A. 锁定目标位置 (拖到了哪一行？)
        // 注意：HTML 里的 .wuxue-group 需要有 data-item-id 属性
        const targetRow = event.target.closest(".wuxue-group");
        if (!targetRow) return false; // 没拖对位置(比如拖到了空白处)

        // B. 目标检查
        const targetId = targetRow.dataset.itemId;
        // 如果没有目标ID，或者目标就是自己，不做任何事
        if (!targetId || targetId === sourceItem.id) return false;

        // C. 获取同类兄弟列表 (用于计算新的排序值)
        // 过滤掉自己，并按当前的 sort 值从小到大排序
        const siblings = this.actor.itemTypes[sourceItem.type]
            .filter(i => i.id !== sourceItem.id)
            .sort((a, b) => (a.sort || 0) - (b.sort || 0));

        // D. 找到目标在兄弟列表中的索引
        const targetIndex = siblings.findIndex(i => i.id === targetId);
        if (targetIndex === -1) return; // 目标不在列表里（比如跨类型拖拽了，把内功拖到了武学里）

        // E. 计算是在目标上方还是下方
        const box = targetRow.getBoundingClientRect();
        const midPoint = box.top + box.height / 2;
        const isBefore = event.clientY < midPoint;

        let sortBefore, sortAfter;

        if (isBefore) {
            // 放在目标上面：取目标的前一个和目标之间
            const prevItem = siblings[targetIndex - 1];
            // 如果没有前一个，就设为极小值
            sortBefore = prevItem ? prevItem.sort : (siblings[0].sort - 100000);
            sortAfter = siblings[targetIndex].sort;
        } else {
            // 放在目标下面：取目标和目标的后一个之间
            const nextItem = siblings[targetIndex + 1];
            sortBefore = siblings[targetIndex].sort;
            // 如果没有后一个，就设为极大值
            sortAfter = nextItem ? nextItem.sort : (siblings[siblings.length - 1].sort + 100000);
        }

        // F. 执行更新 (取平均值)
        const newSort = (sortBefore + sortAfter) / 2;

        return this.actor.updateEmbeddedDocuments("Item", [{
            _id: sourceItem.id,
            sort: newSort
        }]);
    }

    /**
     * @override
     * 物品处理逻辑
     * 职责：
     * 1. 仅当 _onDrop 判定为“外来物品”并调用 super 时，此方法才会被触发。
     * 2. 处理“互斥替换”(背景/性格)。
     * 3. 处理“堆叠数量”(消耗品等)。
     * 4. 执行最终的创建逻辑。
     */
    async _onDropItem(event, data) {
        // 1. 基础检查
        if (!this.actor.isOwner) return false;

        // 2. 加载完整数据
        // 这一步是异步的，但因为是在 _onDropItem 里，这里的等待是安全的，不会阻塞外层事件。
        const itemData = await Item.implementation.fromDropData(data);
        if (!itemData) return false;

        // =====================================================
        // 逻辑 A. 互斥替换逻辑 (背景 & 性格)
        // =====================================================
        const singletonTypes = ["background", "personality"];
        if (singletonTypes.includes(itemData.type)) {
            // 获取已存在的同类物品
            const existingItems = this.actor.itemTypes[itemData.type];

            if (existingItems && existingItems.length > 0) {
                // 如果拖进来的是自己 (同一个 UUID)，什么都不做
                if (existingItems.some(i => i.uuid === itemData.uuid)) return false;

                // 核心：删除旧的
                const idsToDelete = existingItems.map(i => i.id);
                await this.actor.deleteEmbeddedDocuments("Item", idsToDelete);

                // 可选：提示用户
                // ui.notifications.info(`已替换新的${game.i18n.localize("TYPES.Item." + itemData.type)}`);
            }
            // 逻辑继续向下，交给 super._onDropItem 去创建新的
            return super._onDropItem(event, data);
        }

        // =====================================================
        // 逻辑 B. 堆叠逻辑 (消耗品/材料)
        // =====================================================
        const stackableTypes = ["consumable", "misc", "manual"];
        if (stackableTypes.includes(itemData.type)) {
            // 查找是否已存在同名同类物品
            const existingItem = this.actor.items.find(i => i.type === itemData.type && i.name === itemData.name);

            if (existingItem) {
                // 计算新数量 (默认加1，如果拖拽数据里有quantity则加quantity)
                const addQty = itemData.system.quantity || 1;
                const newQty = (existingItem.system.quantity || 0) + addQty;

                // 更新现有物品
                await existingItem.update({ "system.quantity": newQty });

                // 【关键】返回 false 阻断默认创建，否则会多出一个新物品
                return false;
            }
        }

        // =====================================================
        // 逻辑 C. 默认逻辑 (创建新物品)
        // =====================================================
        // 如果上面都没拦截，就执行 Foundry 默认的创建流程
        return super._onDropItem(event, data);
    }

    /**
     * 处理拖拽开始，打包数据
     */
    _onDragStart(event) {
        // 1. 停止冒泡
        // 防止触发外层 .wuxue-group 的排序拖拽逻辑
        if (this._isSorting && event.target.classList.contains("wuxue-group")) return;
        event.stopPropagation();

        const el = event.currentTarget;
        const itemId = el.dataset.itemId;

        // 如果没有 ID，不管
        if (!itemId) return;

        const item = this.actor.items.get(itemId);
        if (!item) return;

        // 2. 构建标准 Foundry 拖拽数据
        const dragData = {
            type: "Item",       // 必须是 "Item"
            uuid: item.uuid,    // 核心功能（复制/宏）全靠这个 UUID
            data: item.toObject() // 兼容性数据，以防某些模块需要完整数据
        };

        // 3. 特殊处理：如果是招式 (Move)
        // 我们在数据里夹带私货 moveId，这样主程序的 Hook 就能识别它是招式而不是书
        if (el.dataset.moveId) {
            dragData.moveId = el.dataset.moveId;
            dragData.name = el.dataset.name || item.name; // 用于宏的名字
        }

        // 4. 将数据写入浏览器事件
        event.dataTransfer.setData("text/plain", JSON.stringify(dragData));

        const iconImg = el.querySelector("img"); // 尝试在卡片里找图片元素
        if (iconImg) {
            // 设置拖拽图像：图像元素, X偏移, Y偏移
            // 25, 25 意味着鼠标指针位于图标中心
            event.dataTransfer.setDragImage(iconImg, 25, 25);
        }
    }

    /* -------------------------------------------- */
    /*  辅助方法 (Helpers)                          */
    /* -------------------------------------------- */

    /**
     * 核心交互：通用修炼/散功弹窗构建器
     * @param {Object} params - 配置参数
     */
    async _promptInvest({
        title,
        mode = "invest",
        currentInvested,
        maxXP,
        poolGeneral = 0,
        poolSpecific = 0,
        breakdown = { general: 0, specific: 0 }
    }) {
        const isInvest = mode === "invest";
        const targetLabel = isInvest ? "距离圆满还需" : "可取回总额";
        const targetValue = isInvest ? (maxXP - currentInvested) : currentInvested;
        const confirmIcon = isInvest ? "fas fa-arrow-up" : "fas fa-undo";
        const confirmLabel = isInvest ? "投入" : "取回";

        const inputStyle = "width:100%; font-size:1.5em; color:white; background:rgba(0,0,0,0.5); border:1px solid var(--xjzl-gold); text-align:center; border-radius:4px;";
        const labelStyle = "font-weight:bold; color:#ccc; margin-bottom:5px; display:block;";
        const infoStyle = "font-size:0.9em; color:#aaa; display:flex; justify-content:space-around; background:rgba(255,255,255,0.05); padding:8px; border-radius:4px; border:1px solid #444;";

        const content = `
        <div class="xjzl-invest-dialog" style="padding: 5px;">
            <div style="text-align:center; margin-bottom:15px; border-bottom: 1px solid #444; padding-bottom: 10px;">
                <p style="font-size:1.2em; margin-bottom:8px; color:#fff;">${targetLabel}: <b style="color:#ff4444; font-size:1.4em;">${targetValue}</b></p>
                
                <div style="${infoStyle}">
                    ${isInvest ? `
                        <span>通用池: <b style="color:white;">${poolGeneral}</b></span>
                        <span>专属池: <b style="color:var(--xjzl-gold);">${poolSpecific}</b></span>
                    ` : `
                        <span>含通用: <b style="color:white;">${breakdown.general}</b></span>
                        <span>含专属: <b style="color:var(--xjzl-gold);">${breakdown.specific}</b></span>
                    `}
                </div>
            </div>

            <form>
                <div class="form-group" style="margin-bottom:15px; justify-content:center; gap:20px; color:#ddd;">
                    <label style="font-weight:bold; color:#fff;">分配模式:</label>
                    <div class="radio-group" style="display:flex; gap:15px;">
                        <label style="cursor:pointer; display:flex; align-items:center; gap:5px;">
                            <input type="radio" name="mode" value="auto" checked> 自动
                        </label>
                        <label style="cursor:pointer; display:flex; align-items:center; gap:5px;">
                            <input type="radio" name="mode" value="manual"> 手动
                        </label>
                    </div>
                </div>

                <div class="auto-mode-container">
                    <label style="${labelStyle}">
                        ${isInvest ? "投入总数 (优先扣除专属)" : "取回总数 (优先取回通用)"}
                    </label>
                    <input type="number" name="totalAmount" value="${targetValue}" autofocus class="xjzl-input" style="${inputStyle}"/>
                </div>

                <div class="manual-mode-container" style="display:none;">
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                        <div>
                            <label style="${labelStyle}">通用部分</label>
                            <input type="number" name="manualGeneral" value="0" class="xjzl-input" style="${inputStyle} font-size:1.2em;"/>
                        </div>
                        <div>
                            <label style="${labelStyle} color:var(--xjzl-gold);">专属部分</label>
                            <input type="number" name="manualSpecific" value="0" class="xjzl-input" style="${inputStyle} font-size:1.2em; border-color:var(--xjzl-gold);"/>
                        </div>
                    </div>
                </div>
            </form>
        </div>
      `;

        return foundry.applications.api.DialogV2.prompt({
            window: { title: title, icon: confirmIcon },
            content: content,

            // 参数只有一个 event，DOM 元素是 event.target
            render: (event) => {
                const html = event.target.element; // 获取弹窗的根 DOM 元素

                const autoDiv = html.querySelector(".auto-mode-container");
                const manualDiv = html.querySelector(".manual-mode-container");
                const radios = html.querySelectorAll('input[name="mode"]');

                // 定义切换逻辑
                const toggleMode = () => {
                    // 注意：这里需要再次在 html 里查找选中的元素
                    const selectedInput = html.querySelector('input[name="mode"]:checked');
                    if (!selectedInput) return;

                    const selected = selectedInput.value;

                    if (selected === "auto") {
                        autoDiv.style.display = "block";
                        manualDiv.style.display = "none";
                        autoDiv.querySelector("input")?.focus();
                    } else {
                        autoDiv.style.display = "none";
                        manualDiv.style.display = "block"; // 或 grid
                        manualDiv.querySelector("input")?.focus();
                    }
                };

                // 绑定监听
                radios.forEach(radio => {
                    radio.addEventListener("change", toggleMode);
                });

                // 初始化
                toggleMode();
            },

            ok: {
                label: confirmLabel,
                icon: confirmIcon,
                callback: (event, button) => {
                    const form = button.closest(".window-content")?.querySelector("form") || button.form;
                    if (!form) return null;

                    const formData = new FormData(form);
                    const inputMode = formData.get("mode");

                    if (inputMode === "auto") {
                        const val = parseInt(formData.get("totalAmount"));
                        return isNaN(val) ? null : val;
                    } else {
                        const g = parseInt(formData.get("manualGeneral")) || 0;
                        const s = parseInt(formData.get("manualSpecific")) || 0;
                        if (g === 0 && s === 0) return null;
                        return { general: g, specific: s };
                    }
                }
            },
            rejectClose: false
        });
    }

    /* -------------------------------------------- */
    /*  交互 Actions                                */
    /* -------------------------------------------- */

    // --- 物品管理 ---

    async _onEditItem(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (item) item.sheet.render(true);
    }

    async _onDeleteItem(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;
        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: "删除物品" },
            content: `<p>确定要删除 <b>${item.name}</b> 吗？</p>`,
            rejectClose: false
        });
        if (confirm) await item.delete();
    }

    async _onCreateItem(event, target) {
        const type = target.dataset.type;
        await Item.create({ name: `新${type}`, type: type }, { parent: this.document });
    }

    // --- 物品功能 (委托给 Item) ---

    async _onToggleNeigong(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (item) item.toggleNeigong();
    }

    async _onToggleEquip(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;

        // 卸下直接执行
        if (item.system.equipped) return item.toggleEquip();

        // 装备奇珍需要选穴位
        if (item.type === "qizhen") {
            const availableSlots = this.actor.getAvailableAcupoints(); // 逻辑在 Actor
            if (availableSlots.length === 0) return ui.notifications.warn("没有可用的已打通穴位。");

            const content = `
            <div class="form-group">
                <label>选择放入穴位:</label>
                <div class="form-fields">
                    <select name="acupoint" style="width: 100%; min-width: 250px; height: 30px; font-size: 1.1em;">
                        ${availableSlots.map(slot => `<option value="${slot.key}">${slot.label}</option>`).join("")}
                    </select>
                </div>
            </div>`;

            const acupoint = await foundry.applications.api.DialogV2.prompt({
                window: { title: `装备: ${item.name}`, icon: "fas fa-gem" },
                content: content,
                ok: { label: "放入", callback: (event, button) => new FormData(button.form).get("acupoint") }
            });

            if (acupoint) item.toggleEquip(acupoint);
        } else {
            // 普通装备
            item.toggleEquip();
        }
    }

    async _onUseConsumable(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (item) item.use();
    }

    async _onReadManual(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (item) item.use();
    }

    /**
     * 点击触发检定 (属性、技能、技艺)
     */
    async _onRollAttribute(event, target) {
        event.preventDefault();
        const key = target.dataset.key;
        if (!key) return;

        // 调用 Actor 的核心检定方法
        await this.document.rollAttributeTest(key);
    }
    // --- 修炼系统 (使用 _promptInvest 简化) ---

    /**
   * 内功修炼
   */
    async _onInvestXP(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;

        // 准备参数
        const maxXP = item.system.progressData.absoluteMax;

        const result = await this._promptInvest({
            title: `修炼: ${item.name}`,
            mode: "invest",
            currentInvested: item.system.xpInvested,
            maxXP: maxXP,
            poolGeneral: this.document.system.cultivation.general,
            poolSpecific: this.document.system.cultivation.neigong || 0
        });

        if (result !== null) await item.investNeigong(result);
    }

    /**
     * 内功散功
     */
    async _onRefundXP(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;

        const result = await this._promptInvest({
            title: `散功: ${item.name}`,
            mode: "refund",
            currentInvested: item.system.xpInvested,
            // 散功不需要 maxXP，但需要 breakdown
            breakdown: item.system.sourceBreakdown || { general: 0, specific: 0 }
        });

        if (result !== null) await item.refundNeigong(result);
    }

    /**
     * 招式修炼
     */
    async _onInvestMoveXP(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        const moveId = target.dataset.moveId;
        if (!item) return;
        const move = item.system.moves.find(m => m.id === moveId);
        if (!move) return;

        // 注意：move.progress.absoluteMax 是我们在 DataModel 里算好的
        const result = await this._promptInvest({
            title: `修炼招式: ${move.name}`,
            mode: "invest",
            currentInvested: move.xpInvested,
            maxXP: move.progress.absoluteMax,
            poolGeneral: this.document.system.cultivation.general,
            poolSpecific: this.document.system.cultivation.wuxue || 0
        });

        if (result !== null) await item.investMove(move.id, result);
    }

    /**
     * 招式散功
     */
    async _onRefundMoveXP(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        const moveId = target.dataset.moveId;
        if (!item) return;
        const move = item.system.moves.find(m => m.id === moveId);
        if (!move) return;

        const result = await this._promptInvest({
            title: `散功: ${move.name}`,
            mode: "refund",
            currentInvested: move.xpInvested,
            breakdown: move.sourceBreakdown || { general: 0, specific: 0 }
        });

        if (result !== null) await item.refundMove(move.id, result);
    }

    /**
     * 技艺书修炼
     */
    async _onInvestArtXP(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;

        // 计算总消耗 (Max XP)
        // 必须应用折扣系数，并向下取整，逻辑需与 DataModel 和 investArt 方法保持完全一致
        const totalCost = item.system.chapters.reduce((sum, c) => {
            const cost = c.cost || 0;
            const ratio = c.xpCostRatio ?? 1; // 获取系数，默认1
            return sum + Math.floor(cost * ratio);
        }, 0);

        const result = await this._promptInvest({
            title: `研读: ${item.name}`,
            mode: "invest",
            currentInvested: item.system.xpInvested,
            maxXP: totalCost,
            poolGeneral: this.document.system.cultivation.general,
            poolSpecific: this.document.system.cultivation.arts || 0 // 传入技艺专属池
        });

        if (result !== null) {
            // 调用 Item 中的标准方法
            await item.investArt(result);
        }
    }

    /**
     * 技艺书回退
     */
    async _onRefundArtXP(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;

        const result = await this._promptInvest({
            title: `放弃研读: ${item.name}`,
            mode: "refund",
            currentInvested: item.system.xpInvested,
            // 传入 breakdown 供弹窗校验上限
            breakdown: item.system.sourceBreakdown || { general: 0, specific: 0 }
        });

        if (result !== null) {
            // 调用 Item 中的标准方法
            await item.refundArt(result);
        }
    }

    /**
     * 经脉突破尝试
     */
    async _onInvestJingmaiXP(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const key = target?.dataset?.jingmaiKey;
        if (!key) return;

        await this.document.investJingmai(key);
    }

    /**
     * 经脉回退（只用于意外点错的情况）
     */
    async _onRefundJingmaiXP(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const key = target?.dataset?.jingmaiKey;
        if (!key) return;

        await this.document.refundJingmai(key);
    }


    // --- 其他 ---

    async _onToggleSubTab(event, target) {
        this._cultivationSubTab = target.dataset.target;
        this.render();
    }

    async _onRollMove(event, target) {
        event.preventDefault();

        const itemId = target.dataset.itemId;
        const moveId = target.dataset.moveId;

        // 1. 获取物品
        const item = this.document.items.get(itemId);
        if (!item) return;

        // 2. 调用 Item 的核心 Roll 方法
        // Item 会负责：资源检查 -> 脚本执行 -> 伤害计算 -> 发送聊天卡片
        await item.roll(moveId);
    }

    async _onDeleteEffect(event, target) {
        const effect = this.document.effects.get(target.dataset.id);
        if (effect) {
            await effect.delete();
            ui.notifications.info(`已移除状态: ${effect.name}`);
        }
    }

    /**
     * 触发普通攻击
     */
    async _onRollBasicAttack(event, target) {
        event.preventDefault();
        // 直接调用 Actor 中写好的方法
        await this.document.rollBasicAttack();
    }

    /**
     * 触发趁虚而入
     */
    async _onRollOpportunityAttack(event, target) {
        event.preventDefault();
        await this.document.rollBasicAttack({ mode: "opportunity" });
    }

    /**
     * 解除当前架招
     */
    async _onStopStance(event, target) {
        event.preventDefault();
        // 调用 Actor 的方法
        await this.document.stopStance();
    }

    /* -------------------------------------------- */
    /*  濒死与死亡交互 (Death & Dying)               */
    /* -------------------------------------------- */

    /**
     * 主动投掷残疾表
     */
    async _onRollDisability(event, target) {
        event.preventDefault();
        // 调用 utils 中的函数
        await rollDisabilityTable(this.actor);
    }

    /**
     * 主动投掷生死一念
     */
    async _onRollDeathSave(event, target) {
        event.preventDefault();
        // 复用 ChatCardManager 中的静态逻辑，保证判定规则(>10活)一致
        await ChatCardManager._rollDeathSave(this.actor);
    }

    /**
     * 查询残疾表 (打开弹窗)
     */
    async _onQueryDisability(event, target) {
        event.preventDefault();
        await promptDisabilityQuery();
    }

    /* -------------------------------------------- */
    /*  聊天卡片交互 (Chat Integration)             */
    /* -------------------------------------------- */

    /**
     * 发送物品详情卡片
     * 需要 HTML: data-action="postItem" data-item-id="..."
     */
    async _onPostItem(event, target) {
        event.preventDefault();
        const itemId = target.dataset.itemId;
        const item = this.document.items.get(itemId);

        if (item) {
            await item.postToChat();
        }
    }

    /**
     * 发送招式详情卡片
     * 需要 HTML: data-action="postMove" data-item-id="..." data-move-id="..."
     */
    async _onPostMove(event, target) {
        event.preventDefault();
        // 需要同时获取 父物品ID 和 招式ID
        const itemId = target.dataset.itemId;
        const moveId = target.dataset.moveId;

        const item = this.document.items.get(itemId);
        if (item) {
            // 调用我们在 Item 类里刚写好的方法
            await item.postMoveToChat(moveId);
        }
    }

    /**
     * 简单的纯前端搜索过滤
     */
    _onSearchInventory(event, target) {
        event.preventDefault();
        const query = target.value.toLowerCase();

        // 保存搜索词（可选，如果希望切换 Tab 回来还在的话）
        // this._lastSearchTerm = query;

        const html = this.element;
        // 找到所有物品卡片
        const items = html.querySelectorAll(".item-grid-card");

        items.forEach(item => {
            // 找到名字元素
            const nameEl = item.querySelector(".item-name");
            if (!nameEl) return;

            const name = nameEl.innerText.toLowerCase();
            // 包含搜索词则显示，否则隐藏
            if (name.includes(query)) {
                item.style.display = "flex"; // 恢复为 Flex 布局
            } else {
                item.style.display = "none";
            }
        });
    }

    /**
     * 切换常用招式 (Pin)
     * HTML: <a data-action="togglePin" data-item-id="..." data-move-id="...">
     */
    async _onTogglePin(event, target) {
        const itemId = target.dataset.itemId;
        const moveId = target.dataset.moveId;

        // 视觉反馈 (可选，为了极速响应，可以先改 DOM class，再等后端更新)
        // target.classList.toggle("active"); 

        await this.document.togglePinnedMove(itemId, moveId);
    }

    /**
     * 手动管理修为 (XP Manager Dialog) - [最终样式修复版]
     * HTML: <a data-action="manageXP">
     */
    async _onManageXP(event, target) {
        new XJZLManageXPDialog({ actor: this.actor }).render(true);
    }

    /**
      * 查看审计日志 - [调用独立 App 类]
      */
    _onViewHistory(event, target) {
        // 防止重复打开
        const existingApp = Object.values(ui.windows).find(w => w instanceof XJZLAuditLog && w.actor.id === this.document.id);
        if (existingApp) {
            existingApp.bringToTop();
            return;
        }

        // 实例化并渲染
        new XJZLAuditLog({ actor: this.document }).render(true);
    }
    /**
     * 修练列表即时搜索 (内功、武学、技艺书籍)
     */
    _onSearchCultivation(event, target) {
        const query = target.value.toLowerCase().trim();
        const html = this.element;

        // -----------------------------------------------------
        // 1. 搜索内功 (Neigong)
        // -----------------------------------------------------
        const neigongs = html.querySelectorAll(".neigong-card"); // 修正了类名，之前是 .neigong-item
        neigongs.forEach(item => {
            // 通过查找内部的 .ng-name 来获取名字，比 dataset 更可靠
            const nameEl = item.querySelector(".ng-name");
            const name = nameEl ? nameEl.innerText.toLowerCase() : "";

            // 如果搜索词为空，显示所有；否则根据名字匹配
            item.style.display = name.includes(query) ? "flex" : "none";
        });

        // -----------------------------------------------------
        // 2. 搜索武学 (Wuxue)
        // -----------------------------------------------------
        const wuxueGroups = html.querySelectorAll(".wuxue-group");
        wuxueGroups.forEach(group => {
            const wuxueName = group.dataset.name?.toLowerCase() || "";
            const moves = group.querySelectorAll(".move-card"); // 内部招式

            let hasVisibleMove = false;

            // 先搜招式
            moves.forEach(move => {
                const moveName = move.dataset.name?.toLowerCase() || "";

                // 匹配逻辑：搜到招式名 OR 搜到武学名
                const isMatch = moveName.includes(query) || wuxueName.includes(query);

                move.style.display = isMatch ? "flex" : "none";
                if (isMatch) hasVisibleMove = true;
            });

            // 决定武学组容器是否显示
            if (wuxueName.includes(query) || hasVisibleMove) {
                group.style.display = "block";
                // 体验优化：如果正在搜索且有内容，确保 details 展开
                if (query.length > 0) {
                    const details = group.querySelector("details");
                    if (details) details.open = true;
                }
            } else {
                group.style.display = "none";
            }
        });

        // -----------------------------------------------------
        // 3. 搜索技艺书籍 (Art Books) - [新增部分]
        // -----------------------------------------------------
        const artBooks = html.querySelectorAll(".art-book-card");
        artBooks.forEach(book => {
            // 获取书籍名称
            const titleEl = book.querySelector(".book-title");
            const bookName = titleEl ? titleEl.innerText.toLowerCase() : "";

            // 匹配逻辑
            if (bookName.includes(query)) {
                book.style.display = "flex"; // 根据你的CSS，可能是 flex 或 grid
            } else {
                book.style.display = "none";
            }
        });
    }


    /**
     * 切换排序模式
     */
    _onToggleSort(event, target) {
        event.preventDefault();
        this._isSorting = !this._isSorting;
        this.render(); // 重绘界面以应用 draggable 属性
    }

    /**
     * 删除修炼物品 (内功/武学/技艺书) 并自动返还投入的修为
     */
    async _onDeleteCultivationItem(event, target) {
        event.preventDefault();
        const itemId = target.dataset.itemId;
        const item = this.document.items.get(itemId);
        if (!item) return;

        // 1. 计算待返还的修为统计 (总额与分池)
        let totalInvested = 0;
        let refundBreakdown = { general: 0, specific: 0 };
        let poolKey = "general"; // 默认只返还通用，特定类型会覆盖

        // 根据物品类型提取数据
        if (item.type === "neigong") {
            // --- 内功 ---
            totalInvested = item.system.xpInvested || 0;
            // 获取记录在 item 上的投入来源 (如果有的话)，否则全算通用或按比例估算
            const bd = item.system.sourceBreakdown || { general: totalInvested, specific: 0 };
            refundBreakdown = { general: bd.general, specific: bd.specific };
            poolKey = "neigong"; // 对应 system.cultivation.neigong

        } else if (item.type === "wuxue") {
            // --- 武学 (特殊：需要累加所有招式) ---
            poolKey = "wuxue"; // 对应 system.cultivation.wuxue
            const moves = item.system.moves || [];

            for (const move of moves) {
                const moveInvested = move.xpInvested || 0;
                if (moveInvested > 0) {
                    totalInvested += moveInvested;
                    // 累加每个招式的来源
                    const bd = move.sourceBreakdown || { general: moveInvested, specific: 0 };
                    refundBreakdown.general += (bd.general || 0);
                    refundBreakdown.specific += (bd.specific || 0);
                }
            }

        } else if (item.type === "art_book") {
            // --- 技艺书 ---
            totalInvested = item.system.xpInvested || 0;
            const bd = item.system.sourceBreakdown || { general: totalInvested, specific: 0 };
            refundBreakdown = { general: bd.general, specific: bd.specific };
            poolKey = "arts"; // 对应 system.cultivation.arts
        }

        // 2. 构建确认弹窗内容
        let content = `<div style="margin-bottom:10px;">确定要废弃并删除 <b>${item.name}</b> 吗？</div>`;

        if (totalInvested > 0) {
            content += `
            <div style="background:rgba(255,255,255,0.1); padding:10px; border-radius:4px; border:1px solid #555;">
                <div style="font-weight:bold; color:#ff4444; margin-bottom:5px;"><i class="fas fa-exclamation-triangle"></i> 散功警示</div>
                <div style="font-size:0.9em; color:#ccc; margin-bottom:8px;">
                    删除该条目将导致所有进度丢失，但已投入的修为将返还至丹田。
                </div>
                <ul style="list-style:none; padding:0; margin:0; font-family:Consolas;">
                    <li><i class="fas fa-undo"></i> 返还通用修为: <span style="color:#fff;">${refundBreakdown.general}</span></li>
                    <li><i class="fas fa-undo"></i> 返还专属修为: <span style="color:var(--xjzl-gold);">${refundBreakdown.specific}</span></li>
                </ul>
            </div>`;
        } else {
            content += `<div style="font-size:0.9em; color:#aaa;">该条目尚未投入修为，删除后不可恢复。</div>`;
        }

        // 3. 弹窗确认
        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: `废弃: ${item.name}`, icon: "fas fa-trash" },
            content: content,
            rejectClose: false,
            ok: { label: "废弃并返还", icon: "fas fa-trash" }
        });

        if (!confirm) return;

        // 4. 执行逻辑：更新 Actor 修为池 -> 删除物品
        if (totalInvested > 0) {
            // 获取当前 Actor 的修为数据
            const cult = foundry.utils.deepClone(this.document.system.cultivation);

            // 加回通用池
            cult.general = (cult.general || 0) + refundBreakdown.general;

            // 加回专属池 (如果有)
            if (poolKey && refundBreakdown.specific > 0) {
                cult[poolKey] = (cult[poolKey] || 0) + refundBreakdown.specific;
            }


            // 更新 Actor
            await this.document.update({ "system.cultivation": cult });

            ui.notifications.info(`已删除 ${item.name}，返还修为: ${totalInvested}`);
        } else {
            ui.notifications.info(`已删除 ${item.name}`);
        }

        // 最后删除物品
        await item.delete();
    }

    /**
     * 打开属性选择器
     */
    async _onOpenModifierPicker(event, target) {
        event.preventDefault();

        // 1. 获取索引
        const groupIndex = Number(target.dataset.groupIndex);
        const changeIndex = Number(target.dataset.changeIndex);

        // 2. 从 DOM 抓取当前可能未保存的数值 (防数据回滚逻辑)
        const row = target.closest(".change-row");
        // 注意：这里要对应你在 HBS 里写的 name
        const valInput = row.querySelector(`input[name="system.customModifiers.${groupIndex}.changes.${changeIndex}.value"]`);

        // 优先取输入框的实时值，取不到则回退到文档已有值
        // 注意：这里需要做一个深拷贝或者直接读取文档，防止引用问题
        const currentDocValue = this.document.system.customModifiers[groupIndex].changes[changeIndex].value;
        const currentValue = valInput ? Number(valInput.value) : (currentDocValue || 0);

        // 3. 打开选择器
        new XJZLModifierPicker({
            choices: getModifierChoices(), // 确保你的工具函数引入了
            selected: this.document.system.customModifiers[groupIndex].changes[changeIndex].key,
            callback: async (newKey) => {

                // 1. 深拷贝整个 customModifiers 数组
                // 这样我们就在操作一个普通的 JS 对象，没有任何 DataModel 的束缚
                const newModifiers = foundry.utils.deepClone(this.document.system.customModifiers);

                // 2. 修改目标项
                // 确保路径存在 (防卫性编程)
                if (newModifiers[groupIndex] && newModifiers[groupIndex].changes[changeIndex]) {
                    newModifiers[groupIndex].changes[changeIndex].key = newKey;
                    newModifiers[groupIndex].changes[changeIndex].value = currentValue;
                }

                // 3. 将整个数组写回
                // 这会覆盖旧数组，Foundry 会完美处理整个数组的验证，不会报 undefined
                await this.document.update({
                    "system.customModifiers": newModifiers
                });
            }
        }).render(true);
    }

    /**
 * 处理小憩按钮点击
 * @param {Event} event 
 */
    async _onShortRest(event) {
        event.preventDefault();
        // 直接调用 Actor 的逻辑
        await this.actor.shortRest();
    }

    /**
     * 处理休整按钮点击
     *包含确认弹窗逻辑
     * @param {Event} event 
     */
    async _onLongRest(event) {
        event.preventDefault();

        // 使用 foundry.applications.api.DialogV2
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: {
                title: "确认休整",
                icon: "fas fa-bed"
            },
            content: `
                <p>休整将花费 <strong>四个时辰（8小时）</strong>。</p>
                <p>这将回复满气血与内力，重置小憩次数。</p>
                <p>确定要进行吗？</p>
            `,
            rejectClose: false, // 允许关闭
            modal: true         // 模态窗口，强制玩家聚焦
        });

        // 只有确认为 true 时才执行
        if (confirmed) {
            await this.actor.longRest();
        }
    }

    /**
     * 处理物品的购买与出售
     * @param {Event} event 
     * @param {HTMLElement} target 
     */
    async _onTradeItem(event, target) {
        event.preventDefault();
        const action = target.dataset.action; // "buyItem" 或 "sellItem"
        const isBuy = action === "buyItem";

        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;

        // 1. 获取基础数据
        const price = item.system.price || 0;
        const quantity = item.system.quantity || 1;
        const currentSilver = Number(this.document.system.resources.silver) || 0;

        // 2. 默认配置
        const defaultModifier = isBuy ? 1.0 : 0.5;
        const titleText = isBuy ? `支付: ${item.name}` : `出售: ${item.name}`;
        const confirmIcon = isBuy ? "fas fa-shopping-cart" : "fas fa-hand-holding-dollar";
        const confirmBtnLabel = isBuy ? "支付" : "出售并移除";

        // 3. 构建 HTML 内容
        const content = `
            <div class="trade-dialog-content" style="font-family: var(--font-primary); padding: 5px;">
                <div style="display:flex; justify-content:space-between; margin-bottom: 8px; border-bottom: 1px solid #444; padding-bottom: 4px;">
                    <label style="font-weight:bold;">单价</label>
                    <span style="font-family:Consolas;">${price}</span>
                </div>
                
                <div style="display:flex; justify-content:space-between; margin-bottom: 8px; border-bottom: 1px solid #444; padding-bottom: 4px;">
                    <label style="font-weight:bold;">数量</label>
                    <span style="font-family:Consolas;">x ${quantity}</span>
                </div>

                <div class="form-group" style="margin-bottom: 15px;">
                    <label style="display:block; margin-bottom:5px;">价格倍率 / 折扣</label>
                    <div class="form-fields">
                        <input type="number" name="modifier" value="${defaultModifier}" step="0.1" 
                               style="width:100%; text-align:right; background:rgba(0,0,0,0.3); border:1px solid #555; padding:4px; color:#fff;" autofocus/>
                    </div>
                    <p class="notes" style="font-size:0.8em; color:#aaa; margin-top:4px; text-align:right;">
                        ${isBuy ? "1.0 = 原价购买" : "0.5 = 半价出售"}
                    </p>
                </div>

                <div style="text-align: right; font-size: 1.3em; margin-top: 10px; padding-top:10px; border-top: 2px dashed #444;">
                    <label style="margin-right: 10px; font-size:0.8em; color:#ccc;">总金额:</label>
                    <span id="trade-total" style="color: ${isBuy ? '#e67e22' : '#2ecc71'}; font-weight:bold; font-family:Consolas;">
                        ${Math.floor(price * quantity * defaultModifier)}
                    </span>
                </div>
            </div>
        `;

        // 4. 使用DialogV2
        const result = await foundry.applications.api.DialogV2.wait({
            window: {
                title: titleText,
                icon: confirmIcon,
                resizable: false
            },
            content: content,
            buttons: [{
                action: "confirm",
                label: confirmBtnLabel,
                icon: confirmIcon,
                default: true,
                callback: (event, button) => {
                    // button 是 DOM 元素，向上寻找容器
                    const container = button.closest(".window-content");
                    const input = container.querySelector("input[name='modifier']");
                    return parseFloat(input.value) || 0;
                }
            }, {
                action: "cancel",
                label: "取消",
                icon: "fas fa-times"
            }],
            // 渲染回调：处理动态总价计算
            render: (event) => {
                const html = event.target.element;

                const input = html.querySelector("input[name='modifier']");
                const totalSpan = html.querySelector("#trade-total");

                if (!input || !totalSpan) return;

                // 定义计算函数
                const calc = () => {
                    const mod = parseFloat(input.value) || 0;
                    const total = Math.floor(price * quantity * mod);
                    totalSpan.textContent = total;
                };

                // 绑定输入事件
                input.addEventListener("input", calc);

                // 自动聚焦并选中
                input.focus();
                input.select();
            }
        });

        // 5. 如果用户取消
        if (result === null || result === undefined) return;

        // 6. 执行交易逻辑
        const modifier = result;
        const totalCost = Math.floor(price * quantity * modifier);

        // 防止负数 Bug
        if (totalCost < 0) {
            return ui.notifications.error("交易金额不能为负数！");
        }

        if (isBuy) {
            // --- 购买逻辑 ---
            if (currentSilver < totalCost) {
                return ui.notifications.warn(`银两不足！需要 ${totalCost}，你只有 ${currentSilver}。`);
            }
            // 扣钱
            await this.document.update({ "system.resources.silver": currentSilver - totalCost });
            ui.notifications.info(`已购买 ${item.name} (x${quantity})，花费 ${totalCost} 银两。`);
        } else {
            // --- 出售逻辑 ---
            // 1. 加钱
            await this.document.update({ "system.resources.silver": currentSilver + totalCost });
            // 2. 删物品
            await item.delete();

            ui.notifications.info(`已出售 ${item.name} (x${quantity})，获得 ${totalCost} 银两。`);
        }
    }

    /** 
     * 经脉栏显示切换
     */
    async _onToggleJingmaiAttemptMode(event) {
        event.preventDefault();

        // 1. 先切换内存中的状态变量
        this._jingmaiAttemptMode = !this._jingmaiAttemptMode;

        // 2. 找到经脉 Tab 的 DOM 元素
        const tab = this.element.querySelector('section.tab[data-tab="jingmai"]');
        if (!tab) return;

        // 3. 根据【状态】强制设置 CSS 类
        // 设置css而不是重绘性能更好
        tab.classList.toggle("attempt-mode", this._jingmaiAttemptMode);

        // 4. 切换按钮图标
        const btnIcon = event.currentTarget.querySelector("i");
        if (btnIcon) {
            if (this._jingmaiAttemptMode) {
                // 进入突破模式 -> 显示返回图标
                btnIcon.classList.remove("fa-right-left");
                btnIcon.classList.add("fa-rotate-left");
            } else {
                // 回到正常模式 -> 显示切换图标
                btnIcon.classList.remove("fa-rotate-left");
                btnIcon.classList.add("fa-right-left");
            }
        }
    }
}