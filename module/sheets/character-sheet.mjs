/**
 * 角色卡片逻辑
 */
import { XJZL } from "../config.mjs";
// 引入工具函数
import { localizeConfig, rollDisabilityTable, promptDisabilityQuery } from "../utils/utils.mjs";
// 引入卡片管理器 (用于复用死检的逻辑)
import { ChatCardManager } from "../managers/chat-manager.mjs";
import { XJZLAuditLog } from "../applications/audit-log.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLCharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "actor", "character"],
        position: { width: 1100, height: 750 },
        window: { resizable: true },
        // 告诉 V13：“请帮我监听 Input 变化，并且在重绘时保持滚动位置”
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        },
        // 拖拽配置，用于wuxue自定义排序
        dragDrop: [{
            dragSelector: ".wuxue-group[draggable='true']",
            dropSelector: ".wuxue-list"
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
            togglePin: XJZLCharacterSheet.prototype._onTogglePin, //标记常用武学
            manageXP: XJZLCharacterSheet.prototype._onManageXP,  //管理修为
            viewHistory: XJZLCharacterSheet.prototype._onViewHistory, //查看修为日志

            // --- 其他 ---
            //删除状态
            deleteEffect: XJZLCharacterSheet.prototype._onDeleteEffect,

            //使用招式
            rollMove: XJZLCharacterSheet.prototype._onRollMove,

            // 通用属性/技能/技艺检定
            rollAttribute: XJZLCharacterSheet.prototype._onRollAttribute,

            // 发送物品详情卡片到聊天
            postItem: XJZLCharacterSheet.prototype._onPostItem,
            postMove: XJZLCharacterSheet.prototype._onPostMove,

            //手工修正
            addGroup: XJZLCharacterSheet.prototype._onAction,
            deleteGroup: XJZLCharacterSheet.prototype._onAction,
            addChange: XJZLCharacterSheet.prototype._onAction,
            deleteChange: XJZLCharacterSheet.prototype._onAction,
            //处理关系
            addRelation: XJZLCharacterSheet.prototype._onAction,
            deleteRelation: XJZLCharacterSheet.prototype._onAction,

            // 濒死/死亡交互
            rollDisability: XJZLCharacterSheet.prototype._onRollDisability,
            rollDeathSave: XJZLCharacterSheet.prototype._onRollDeathSave,
            queryDisability: XJZLCharacterSheet.prototype._onQueryDisability,

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
            scrollable: [""],
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
        // ✦ 1. 核心上下文初始化 (Core Initialization)
        // -----------------------------------------------------
        // 获取基础上下文，准备 actor 和 system 的简写引用
        const context = await super._prepareContext(options);
        const actor = this.document;
        const system = actor.system;

        context.system = system;     // 方便 Handlebars 中直接使用 system.xxx
        context.tabs = this.tabGroups; // 标签页配置

        // =====================================================
        // ✦ 2. 表单下拉选项配置 (Form Choices & Config)
        // -----------------------------------------------------
        // 这里集中处理所有 <select> 标签需要的枚举数据
        // localizeConfig 会将 key 转换为翻译后的文本
        context.choices = {
            // [基础信息页] 性别选择
            genders: localizeConfig(XJZL.genders),

            // [基础信息页] 门派选择
            sects: localizeConfig(XJZL.sects),

            // [基础信息页] 处世态度
            attitudes: localizeConfig(XJZL.attitudes),

            // [基础信息页] 嗜好列表
            hobbies: localizeConfig(XJZL.hobbies)
        };

        // =====================================================
        // ✦ 3. 角色状态与基础信息 (Status & Bio)
        // -----------------------------------------------------
        // [UI显示] 计算资源百分比，主要用于前端 CSS 的 width: xx% 进度条
        context.percents = {
            hp: system.resources.hp.max ? Math.min(100, (system.resources.hp.value / system.resources.hp.max) * 100) : 0,
            // 护体百分比：基于气血上限计算，最大不超过 100%
            huti: system.resources.hp.max ? Math.min(100, (system.resources.huti / system.resources.hp.max) * 100) : 0,
            mp: system.resources.mp.max ? Math.min(100, (system.resources.mp.value / system.resources.mp.max) * 100) : 0,
            rage: (system.resources.rage.value / 10) * 100 // 怒气上限固定为 10
        };

        // [单例物品] 获取背景和性格物品，用于在首页显示详情
        context.backgroundItem = actor.itemTypes.background?.[0] || null;
        context.personalityItem = actor.itemTypes.personality?.[0] || null;

        // [嗜好槽位] 构造固定长度为3的数组，确保界面上始终显示3个下拉框
        // 逻辑：读取现有嗜好 -> 填充空位 -> 映射为对象
        const currentHobbies = system.info.shihao || [];
        context.hobbySlots = [0, 1, 2].map(i => ({
            index: i,
            value: currentHobbies[i] || "" // 如果该槽位没数据，则为空，显示“请选择”
        }));

        // =====================================================
        // ✦ 4. 属性技能面板 (Attributes & Skills Tab)
        // -----------------------------------------------------
        // [子标签页] 确保 cultivationSubTab 在合法范围内 (默认切回内功)
        if (!["neigong", "wuxue", "arts"].includes(this._cultivationSubTab)) {
            this._cultivationSubTab = "neigong";
        }
        context.cultivationSubTab = this._cultivationSubTab;

        // [技能分组] 定义属性与对应技能的映射关系
        // 用于在模板中通过 {{#each}} 循环渲染七大属性块
        const allSkillGroups = [
            { key: "wuxing", label: "XJZL.Stats.Wuxing", skills: ["wuxue", "jianding", "bagua", "shili"] }, // 悟性
            { key: "liliang", label: "XJZL.Stats.Liliang", skills: ["jiaoli", "zhengtuo", "paozhi", "qinbao"] }, // 力量
            { key: "shenfa", label: "XJZL.Stats.Shenfa", skills: ["qianxing", "qiaoshou", "qinggong", "mashu"] }, // 身法
            { key: "tipo", label: "XJZL.Stats.Tipo", skills: ["renxing", "biqi", "rennai", "ningxue"] }, // 体魄
            { key: "neixi", label: "XJZL.Stats.Neixi", skills: ["liaoshang", "chongxue", "lianxi", "duqi"] }, // 内息
            { key: "qigan", label: "XJZL.Stats.Qigan", skills: ["dianxue", "zhuizong", "tancha", "dongcha"] }, // 气感
            { key: "shencai", label: "XJZL.Stats.Shencai", skills: ["jiaoyi", "qiman", "shuofu", "dingli"] }  // 神采
        ];

        // 将“悟性”单独提取（可能 UI 布局特殊），其余作为标准组
        context.wuxingGroup = allSkillGroups.find(g => g.key === 'wuxing');
        context.standardSkillGroups = allSkillGroups.filter(g => g.key !== 'wuxing');

        // [编辑器] 获取属性调整选项 (用于 Active Effects 编辑弹窗)
        context.groupedModifierOptions = this._getGroupedModifierOptions();

        // =====================================================
        // ✦ 5. 战斗核心数据 (Combat & Martial Arts) - [修复与增强版]
        // -----------------------------------------------------
        // 获取内功列表
        let neigongs = actor.itemTypes.neigong || [];

        // [新增] 排序逻辑：运行中的排在最前 > 品阶高 > 品阶低
        neigongs.sort((a, b) => {
            // 优先检查运行状态 (active = true 排前)
            if (a.system.active !== b.system.active) {
                return a.system.active ? -1 : 1;
            }
            // 其次按品阶 (Tier 3 > 2 > 1)
            return b.system.tier - a.system.tier;
        });

        // 挂载并处理内功数据
        context.neigongs = neigongs;
        context.neigongs.forEach(item => {
            item.isRunning = item.system.active;

            // === [核心修复] 分阶段进度计算 ===
            const system = item.system;
            const tier = system.tier;
            const config = system.config;

            // 1. 获取各阶段折扣系数 (默认为 1)
            const r1 = config.stage1?.xpCostRatio ?? 1;
            const r2 = config.stage2?.xpCostRatio ?? 1;
            const r3 = config.stage3?.xpCostRatio ?? 1;

            // 2. 定义【增量】门槛 (即每一级单独修满需要多少)
            // 规则：
            // 人级(1): 领悟0 / 小成1000 / 圆满2000 (总3000)
            // 地级(2): 领悟1000 / 小成3000 / 圆满6000 (总10000)
            // 天级(3): 领悟2000 / 小成10000 / 圆满18000 (总30000)
            let baseCosts = [0, 0, 0];
            if (tier === 1) baseCosts = [0, 1000, 2000];
            else if (tier === 2) baseCosts = [1000, 3000, 6000];
            else if (tier === 3) baseCosts = [2000, 10000, 18000];

            // 3. 应用折扣，计算实际需求 (Cap)
            const c1 = Math.floor(baseCosts[0] * r1); // 领悟需求
            const c2 = Math.floor(baseCosts[1] * r2); // 小成需求
            const c3 = Math.floor(baseCosts[2] * r3); // 圆满需求

            // 4. 分配已投入的修为 (像倒水一样填满杯子)
            let remaining = system.xpInvested;

            // 杯子1 (领悟)
            const v1 = Math.min(remaining, c1);
            remaining = Math.max(0, remaining - c1);

            // 杯子2 (小成)
            const v2 = Math.min(remaining, c2);
            remaining = Math.max(0, remaining - c2);

            // 杯子3 (圆满)
            const v3 = Math.min(remaining, c3);

            // 5. 构建 Tooltip HTML
            // 辅助函数: 进度颜色 (满=绿, 有=黄, 空=灰)
            const getCol = (v, max) => {
                if (max === 0) return "#2ecc71"; // 0/0 算完成
                return v >= max ? "#2ecc71" : (v > 0 ? "#f1c40f" : "#999");
            };

            let html = `<div style='text-align:left; min-width:160px; font-family:var(--font-serif);'>`;

            // 标题栏：总进度
            html += `<div style='border-bottom:1px solid rgba(255,255,255,0.2); margin-bottom:6px; padding-bottom:4px; font-weight:bold; color:#fff; display:flex; justify-content:space-between;'>
                        <span>${item.name}</span>
                        <span style='font-family:Consolas; color:var(--c-highlight);'>${system.xpInvested} / ${system.progressData.absoluteMax}</span>
                     </div>`;

            // 阶段1：领悟
            html += `<div style='display:flex; justify-content:space-between; margin-bottom:3px; font-size:12px;'>
                        <span style='color:#ccc'>领悟:</span>
                        <span style='font-family:Consolas; color:${getCol(v1, c1)}'>${v1} / ${c1}</span>
                     </div>`;

            // 阶段2：小成
            html += `<div style='display:flex; justify-content:space-between; margin-bottom:3px; font-size:12px;'>
                        <span style='color:#ccc'>小成:</span>
                        <span style='font-family:Consolas; color:${getCol(v2, c2)}'>${v2} / ${c2}</span>
                     </div>`;

            // 阶段3：圆满
            html += `<div style='display:flex; justify-content:space-between; font-size:12px;'>
                        <span style='color:#ccc'>圆满:</span>
                        <span style='font-family:Consolas; color:${getCol(v3, c3)}'>${v3} / ${c3}</span>
                     </div>`;

            // 插入自动化说明
            if (system.automationNote) {
                html += `<div style='background:rgba(52, 152, 219, 0.2); border-left:3px solid #3498db; padding:4px; margin:6px 0; font-size:11px; color:#aed6f1;'>
                                    <i class='fas fa-robot'></i> ${system.automationNote}
                                </div>`;
            }

            if (system.description) {
                html += `<div style='margin-top:6px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.1); font-size:10px; color:#888;'>${system.description}</div>`;
            }

            html += `</div>`;

            item.xpTooltip = html;
        });

        // [当前运行内功] 用于顶部状态栏显示名称与简述
        context.activeNeigongName = "";
        context.activeNeigongDesc = "";
        if (system.martial.active_neigong) {
            const ng = actor.items.get(system.martial.active_neigong);
            if (ng) {
                context.activeNeigongName = ng.name;
                context.activeNeigongDesc = ng.system.description || "";
            }
        }

        // [架招] 获取当前激活的架招 (Stance) 及其自动化描述
        context.activeStance = null;
        const martial = system.martial;
        if (martial.stanceActive && martial.stanceItemId && martial.stance) {
            const stanceItem = actor.items.get(martial.stanceItemId);
            const move = stanceItem?.system.moves.find(m => m.id === martial.stance);
            if (move) {
                context.activeStance = {
                    name: move.name,
                    description: move.description,
                    automationNote: move.automationNote
                };
            }
        }

        // [外功/武学] 预计算招式伤害 (Pre-calculation)
        // 1. 先获取常用列表 Set (用于快速查找)
        const pinnedList = actor.getFlag("xjzl-system", "pinnedMoves") || [];
        // pinnedList 格式 ["ItemID.MoveID", ...]
        const pinnedSet = new Set(pinnedList);

        // 2. 预处理武学与招式
        // 先获取，然后按 sort 字段排序 (a.sort - b.sort)
        let wuxueItems = actor.itemTypes.wuxue || [];
        wuxueItems.sort((a, b) => (a.sort || 0) - (b.sort || 0));
        context.wuxues = wuxueItems;
        for (const wuxue of context.wuxues) {
            const moves = wuxue.system.moves || [];

            // 遍历每个招式
            moves.forEach(move => {
                // --- 1. 基础计算 ---
                const result = wuxue.calculateMoveDamage(move.id);
                // 确保 derived 对象存在，即使计算失败
                move.derived = result || {
                    damage: 0,
                    breakdown: "无数据",
                    cost: { mp: 0, rage: 0, hp: 0 },
                    isWeaponMatch: true
                };

                // 注入 isPinned 状态
                const refKey = `${wuxue.id}.${move.id}`;
                move.isPinned = pinnedSet.has(refKey);

                // --- 2. 进度分级计算 ---
                // --- 2. 进度分级计算 (核心重写) ---
                const tier = move.computedTier; // 1, 2, 3
                const ratio = move.xpCostRatio ?? 1;

                // 复刻 DataModel 的门槛逻辑
                let rawThresholds = [];
                let labels = [];

                // 判断分类 (轻功/阵法只有一级，普通武学有多级)
                if (wuxue.system.category === "qinggong" || wuxue.system.category === "zhenfa") {
                    if (tier === 1) rawThresholds = [1000];
                    else if (tier === 2) rawThresholds = [3000];
                    else rawThresholds = [6000];
                    labels = ["习得"];
                } else {
                    // 常规武学
                    if (tier === 1) {
                        rawThresholds = [0, 500, 1000];
                        labels = ["领悟", "掌握", "精通"];
                    } else if (tier === 2) {
                        rawThresholds = [500, 1500, 3000];
                        labels = ["领悟", "掌握", "精通"];
                    } else { // Tier 3
                        rawThresholds = [1000, 3000, 6000, 10000];
                        labels = ["领悟", "掌握", "精通", "合一"];
                    }
                }

                // 应用折扣并取整
                const thresholds = rawThresholds.map(t => Math.floor(t * ratio));
                const xp = move.xpInvested;

                // 取数组最后一个值作为“毕业”所需的总 XP
                const absoluteMax = thresholds.length > 0 ? thresholds[thresholds.length - 1] : 0;

                // 确保 progress 对象存在 (DataModel 通常有，但防卫性编程更好)
                if (!move.progress) move.progress = {};

                // 挂载数值供 HBS 使用: {{move.progress.currentMax}}
                move.progress.currentMax = absoluteMax;

                // --- 3. 构建招式主 Tooltip ---
                let tooltipHTML = `<div style='text-align:left; min-width:180px; font-family:var(--font-serif);'>`;

                // 标题
                const typeLabel = game.i18n.localize(`XJZL.Wuxue.Type.${move.type}`);
                tooltipHTML += `<div style='border-bottom:1px solid rgba(255,255,255,0.2); margin-bottom:6px; padding-bottom:4px; font-weight:bold; color:#fff; display:flex; justify-content:space-between;'>
                                    <span>${move.name}</span>
                                    <span style='font-size:11px; color:#aaa; border:1px solid #555; padding:0 4px; border-radius:4px;'>${typeLabel}</span>
                                 </div>`;

                // === 特殊逻辑：视为境界 (Mapped Stage) ===
                if (move.progression.mappedStage && move.progression.mappedStage !== 0 && move.progression.mappedStage !== 5) {
                    // 如果有强制映射 (例如：虽然XP是0，但视为精通)
                    // mappedStage: 1=领悟, 2=掌握, 3=精通, 4=合一
                    const stageNames = ["", "领悟", "掌握", "精通", "合一"];
                    const mappedName = stageNames[move.progression.mappedStage] || "未知";

                    tooltipHTML += `<div style='margin-bottom:8px; padding:6px; background:rgba(255,215,0,0.1); border:1px solid #ffd700; border-radius:4px; text-align:center;'>
                                        <div style='color:#ffd700; font-weight:bold;'>境界锁定</div>
                                        <div style='font-size:12px; color:#fff;'>视为：${mappedName}</div>
                                    </div>`;
                } else {
                    // === 正常逻辑：显示分段进度 ===
                    // 遍历每一级，计算该级的 进度/上限
                    // 逻辑：该级的进度 = min( 该级上限, max(0, 总XP - 上一级门槛) )
                    // 该级上限 (Delta) = 本级门槛 - 上一级门槛

                    for (let i = 0; i < thresholds.length; i++) {
                        const label = labels[i];
                        const currentT = thresholds[i]; // 当前级累积门槛
                        const prevT = i > 0 ? thresholds[i - 1] : 0; // 上一级累积门槛

                        const segmentMax = currentT - prevT; // 本段需要多少XP

                        // 计算本段填了多少
                        // 如果 segmentMax 是 0 (例如人级领悟是0)，则只要入门就算满
                        let segmentVal = 0;
                        if (segmentMax === 0) {
                            segmentVal = (xp >= currentT) ? 0 : 0; // 0/0 显示
                        } else {
                            segmentVal = Math.max(0, Math.min(segmentMax, xp - prevT));
                        }

                        // 颜色逻辑
                        let color = "#999"; // 未达成
                        if (segmentMax === 0) color = "#2ecc71"; // 自动达成
                        else if (segmentVal >= segmentMax) color = "#2ecc71"; // 已满
                        else if (segmentVal > 0) color = "#f1c40f"; // 进行中

                        tooltipHTML += `<div style='display:flex; justify-content:space-between; margin-bottom:3px; font-size:12px;'>
                                            <span style='color:#ccc'>${label}:</span>
                                            <span style='font-family:Consolas; color:${color}'>${segmentVal} / ${segmentMax}</span>
                                        </div>`;
                    }
                }

                tooltipHTML += `<div style='font-size:11px; color:#aaa; margin-top:6px; padding-top:4px; border-top:1px dashed #555;'>总投入: ${move.xpInvested}</div>`;

                // 自动化说明
                if (move.automationNote) {
                    tooltipHTML += `<div style='background:rgba(52, 152, 219, 0.2); border-left:3px solid #3498db; padding:4px; margin:6px 0; font-size:11px; color:#aed6f1;'>
                                        <i class='fas fa-robot'></i> ${move.automationNote}
                                    </div>`;
                }

                // 描述
                if (move.description) {
                    tooltipHTML += `<hr style='border:0; border-top:1px dashed rgba(255,255,255,0.1); margin:4px 0;'>`;

                    // 1. 去除 HTML 标签 (将富文本转为纯文本)
                    let descText = move.description.replace(/<[^>]*>?/gm, '');

                    // 2. 转义双引号，防止截断 data-tooltip 属性
                    descText = descText.replace(/"/g, '&quot;');

                    // 3. 截取长度 (可选，防止太长刷屏，设为 200 字)
                    if (descText.length > 200) descText = descText.substring(0, 200) + "...";

                    tooltipHTML += `<div style='font-size:11px; color:#ccc; line-height:1.4;'>${descText}</div>`;
                }

                tooltipHTML += `</div>`;
                move.tooltip = tooltipHTML;

                // Breakdown Tooltip
                if (move.derived.damage) {
                    const bdHtml = move.derived.breakdown.replace(/\n/g, "<br>");
                    move.derived.breakdownTooltip = `<div style='text-align:left; font-family:Consolas; font-size:11px;'>${bdHtml}</div>`;
                }
            });

            // --- 5. 构建武学本体 Tooltip (书本描述) ---
            let bookTooltip = `<div style='text-align:left; max-width:250px;'>`;
            bookTooltip += `<div style='font-weight:bold; margin-bottom:5px; color:#fff;'>${wuxue.name}</div>`;
            if (wuxue.system.description) {
                bookTooltip += `<div style='font-size:11px; color:#ccc;'>${wuxue.system.description}</div>`;
            }
            // 也可以加上悟性要求等
            if (wuxue.system.requirements) {
                bookTooltip += `<hr style='border-color:#555;'><div style='font-size:10px; color:#e74c3c;'>${wuxue.system.requirements}</div>`;
            }
            bookTooltip += `</div>`;
            wuxue.tooltip = bookTooltip;
        }

        // [Helper] 动态构建 Tooltip (Base + Mod + Total) - [新增]
        // 解决只显示 Total 的问题，通过反向计算显示来源
        const buildBreakdown = (label, total, mod, extra = "") => {
            const safeMod = mod || 0;
            const base = total - safeMod;

            // 样式优化：黑色半透背景，高对比度文字
            return `
            <div style="text-align:left; min-width:150px; font-family:var(--font-serif);">
                <div style="border-bottom:1px solid rgba(255,255,255,0.2); margin-bottom:6px; padding-bottom:2px; font-weight:bold; font-size:14px; color:#fff;">
                    ${label} <span style="float:right; color:var(--c-highlight); font-family:Consolas;">${total}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:12px; color:#ccc; line-height:1.6;">
                    <span>基础能力:</span> 
                    <span style="font-family:Consolas;">${base}</span>
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

        // 构建 combatStats 对象供模板使用 - [完全重构]
        context.combatStats = {
            // 1. 属性 (Attributes) - 重组为左右两翼
            attributesLeft: [],  // 力、身、体
            attributesRight: [], // 内、气、神
            wuxing: null,        // 悟性 (居中)

            // 2. 仪表盘核心 (Cockpit) - 绑定 buildBreakdown 生成的 Tooltip
            hitWaigong: { val: system.combat.hitWaigongTotal, tooltip: buildBreakdown("外功命中", system.combat.hitWaigongTotal, system.combat.hit_waigong) },
            critWaigong: { val: system.combat.critWaigongTotal, tooltip: buildBreakdown("外功暴击", system.combat.critWaigongTotal, system.combat.crit_waigong, "<div style='color:#e74c3c; font-size:10px;'>*越低越容易暴击</div>") },

            hitNeigong: { val: system.combat.hitNeigongTotal, tooltip: buildBreakdown("内功命中", system.combat.hitNeigongTotal, system.combat.hit_neigong) },
            critNeigong: { val: system.combat.critNeigongTotal, tooltip: buildBreakdown("内功暴击", system.combat.critNeigongTotal, system.combat.crit_neigong, "<div style='color:#e74c3c; font-size:10px;'>*越低越容易暴击</div>") },

            defWaigong: { val: system.combat.defWaigongTotal, tooltip: buildBreakdown("外功防御", system.combat.defWaigongTotal, system.combat.def_waigong) },
            defNeigong: { val: system.combat.defNeigongTotal, tooltip: buildBreakdown("内功防御", system.combat.defNeigongTotal, system.combat.def_neigong) },

            // 特殊处理格挡 (含架招额外加成)
            block: {
                val: system.combat.blockTotal,
                tooltip: buildBreakdown("格挡值", system.combat.blockTotal, (system.combat.block || 0), system.combat.stanceBlockValue ? `<div style='color:#f1c40f'>架招加成: +${system.combat.stanceBlockValue}</div>` : "")
            },

            speed: { val: system.combat.speedTotal, tooltip: buildBreakdown("移动速度", system.combat.speedTotal, system.combat.speed) },
            initiative: { val: system.combat.initiativeTotal, tooltip: buildBreakdown("先攻值", system.combat.initiativeTotal, system.combat.initiative) },
            dodge: { val: system.combat.dodgeTotal, tooltip: buildBreakdown("闪避值", system.combat.dodgeTotal, system.combat.dodge) },

            kanpo: { val: system.combat.kanpoTotal, tooltip: buildBreakdown("看破", system.combat.kanpoTotal, system.combat.kanpo) },
            xuzhao: { val: system.combat.xuzhaoTotal, tooltip: buildBreakdown("虚招", system.combat.xuzhaoTotal, system.combat.xuzhao) },

            // 3. 武器等级 (Weapon Ranks) - [新增]
            weaponRanks: [],

            // 4. 详情 (Details) - [修复]
            resistances: {}, // 稍后填充
            damages: {}      // 稍后填充
        };

        // 正确获取 Schema 中的 Label，避免 undefined 错误
        const statsSchema = system.schema.fields.stats.fields;
        const resSchema = system.schema.fields.combat.fields.resistances.fields;
        const dmgSchema = system.schema.fields.combat.fields.damages.fields;

        // --- 填充属性与悟性 (Attributes) ---
        // 定义显示顺序：左翼(力身体) -> 悟性 -> 右翼(内气神)
        const attrKeys = ["liliang", "shenfa", "tipo", "wuxing", "neixi", "qigan", "shencai"];

        attrKeys.forEach((key, index) => {
            const stat = system.stats[key];
            const labelKey = statsSchema[key]?.label || `XJZL.Stats.${key}`;
            const label = game.i18n.localize(labelKey).charAt(0);

            // 基础变量
            const base = stat.value ?? 0;
            const mod = stat.mod ?? 0;
            let tooltip = "";

            // 针对悟性的特殊 Tooltip 构建
            if (key === "wuxing") {
                // 读取境界/武学带来的加成 (在 prepareDerivedData 中计算并存入 cultivation.wuxingBonus)
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
                // 其他属性的标准 Tooltip
                const assigned = stat.assigned ? `<tr><td>分配:</td><td style="text-align:right">+${stat.assigned}</td></tr>` : "";
                const neigongBonus = stat.neigongBonus ? `<tr><td>内功:</td><td style="text-align:right">+${stat.neigongBonus}</td></tr>` : "";
                const identity = stat.identityBonus ? `<tr><td>身份:</td><td style="text-align:right">+${stat.identityBonus}</td></tr>` : "";

                tooltip = `
                <div style="text-align:left; min-width:120px;">
                    <strong style="border-bottom:1px solid #555; display:block; margin-bottom:4px;">${game.i18n.localize(labelKey)}: ${stat.total}</strong>
                    <table style="width:100%; font-size:11px; color:#ddd;">
                        <tr><td>基础:</td><td style="text-align:right">${base}</td></tr>
                        ${assigned}
                        ${neigongBonus}
                        ${identity}
                        <tr><td>修正:</td><td style="text-align:right">${mod >= 0 ? '+' : ''}${mod}</td></tr>
                    </table>
                </div>`;
            }

            const data = {
                key: key,
                label: label,
                total: stat.total,
                assigned: stat.assigned,
                tooltip: tooltip
            };

            if (key === "wuxing") {
                context.combatStats.wuxing = data;
            } else if (index < 3) {
                context.combatStats.attributesLeft.push(data);
            } else {
                context.combatStats.attributesRight.push(data);
            }
        });

        // --- 填充武器等级 (Weapon Ranks) ---
        // 使用汉字代替图标
        const weaponChars = {
            sword: "剑", blade: "刀", staff: "棍",
            dagger: "匕", hidden: "暗", unarmed: "拳",
            instrument: "乐", special: "奇"
        };

        for (const [key, rankData] of Object.entries(system.combat.weaponRanks)) {
            context.combatStats.weaponRanks.push({
                label: game.i18n.localize(`XJZL.Combat.Rank.${key.charAt(0).toUpperCase() + key.slice(1)}`),
                val: rankData.total,
                // 直接存单个汉字
                char: weaponChars[key] || "武"
            });
        }

        // --- 填充抗性 (Resistances) ---
        for (const [key, stat] of Object.entries(system.combat.resistances)) {
            const labelKey = resSchema[key]?.label || key;
            context.combatStats.resistances[key] = {
                label: game.i18n.localize(labelKey),
                total: stat.total
            };
        }

        // --- 填充伤害 (Damages) ---
        for (const [key, stat] of Object.entries(system.combat.damages)) {
            const labelKey = dmgSchema[key]?.label || key;
            context.combatStats.damages[key] = {
                label: game.i18n.localize(labelKey),
                total: stat.total
            };
        }

        // 常用招式 (Pinned Moves)
        // 读取 Actor Flag: ["ItemUUID.MoveID", ...]
        const pinnedRefs = actor.getFlag("xjzl-system", "pinnedMoves") || [];
        context.pinnedMoves = [];

        for (const ref of pinnedRefs) {
            try {
                // 格式可能是 "ItemUUID.MoveID" 或 "ItemID.MoveID"
                // 简单起见假设是 "ItemID.MoveID" 或者 split后取最后一部分
                const parts = ref.split(".");
                const moveId = parts.pop(); // 最后一部分是 moveId
                const itemId = parts.pop(); // 倒数第二部分是 itemId (如果是UUID，这通常也是ID)

                // 尝试获取物品
                const item = actor.items.get(itemId);

                if (item) {
                    // 注意：这里的 move 对象已经被前面的 wuxue 循环处理过了
                    // 带有 derived, tooltip, currentCost, isUltimate 等临时属性
                    const move = item.system.moves.find(m => m.id === moveId);

                    if (move) {
                        // 构造扁平化数据对象供模板直接使用
                        context.pinnedMoves.push({
                            // --- 基础数据 ---
                            name: move.name,
                            type: move.type, // 用于染色
                            isUltimate: move.isUltimate, // 用于绝招特效
                            computedLevel: move.computedLevel, // 等级

                            // --- 衍生数据 (来自 wuxue 循环的预计算) ---
                            derived: move.derived,
                            tooltip: move.tooltip,
                            currentCost: move.currentCost,

                            // --- 上下文数据 ---
                            parentName: item.name,
                            itemId: item.id,
                            moveId: moveId,

                            // --- 标记为已Pin (用于显示实心星星) ---
                            isPinned: true
                        });
                    }
                }
            } catch (e) {
                console.error("解析常用招式失败:", ref, e);
            }
        }

        // =====================================================
        // ✦ 6. 技艺与身份系统 (Arts & Identities)
        // -----------------------------------------------------
        const allArts = [];
        const activeIdentities = system.activeIdentities || {};

        // 遍历所有定义的技艺，合并数据
        for (const [key, labelKey] of Object.entries(XJZL.arts)) {
            const artData = system.arts[key];
            if (!artData) continue;

            const artObj = {
                key: key,
                label: labelKey,
                total: artData.total || 0,
                identity: null // 默认无身份
            };

            // [身份处理] 如果该技艺有激活的身份，生成徽章(Badge)和悬浮提示(Tooltip)
            const identityData = activeIdentities[key];
            if (identityData && identityData.highest) {
                const capKey = key.charAt(0).toUpperCase() + key.slice(1);
                const badgeTitle = game.i18n.localize(`XJZL.Identity.${capKey}.${identityData.highest.titleKey}`);

                // 生成复杂的 HTML Tooltip，展示所有已获得的身份历史
                const tooltipRows = identityData.all.map(id => {
                    const title = game.i18n.localize(`XJZL.Identity.${capKey}.${id.titleKey}`);
                    const desc = game.i18n.localize(`XJZL.Identity.${capKey}.${id.descKey}`);
                    return `
                <div style="margin-bottom: 8px;">
                    <div style="color:var(--c-highlight); font-weight:bold; font-size:1.1em;">
                        <i class="fas fa-caret-right" style="font-size:0.8em;"></i> ${title} <span style="opacity:0.6; font-size:0.8em;">(Lv.${id.level})</span>
                    </div>
                    <div style="padding-left: 10px; line-height: 1.4; color: #ddd; font-size: 0.9em;">${desc}</div>
                </div>`;
                }).join("<hr style='border-color:#444; margin: 4px 0;'>");

                artObj.identity = {
                    title: badgeTitle, // 界面上只显示最高头衔
                    tooltip: `<div style="text-align:left; max-width:400px; padding:2px;">${tooltipRows}</div>`,
                    level: identityData.highest.level
                };
            }
            allArts.push(artObj);
        }

        // [拆分列表] 界面上分为 "已入门(Learned)" 和 "未入门(Unlearned)" 两个区域
        context.learnedArts = allArts.filter(a => a.total > 0);
        context.unlearnedArts = allArts.filter(a => a.total === 0);

        // =====================================================
        // ✦ 7. 经脉可视化数据 (Jingmai Visualization)
        // -----------------------------------------------------
        // A. [坐标定义] 背景图上穴位的绝对定位 (百分比)
        const MERIDIAN_COORDS = {
            // --- 阴脉 (左侧身体 - 走势：肩 -> 臂 -> 肋 -> 腹 -> 膝 -> 足) ---
            "hand_taiyin": { x: 36, y: 28 }, // [3阶] 少商：左肩高位，稍微靠内
            "hand_jueyin": { x: 24, y: 40 }, // [2阶] 中冲：左臂外侧，拉开一点宽度
            "hand_shaoyin": { x: 32, y: 52 }, // [1阶] 少冲：内收到左肋/侧腹，填补腹部左上空缺

            "foot_taiyin": { x: 42, y: 66 }, // [3阶] 隐白：左腹股沟/大腿内侧，填补腹部左下空缺
            "foot_jueyin": { x: 28, y: 78 }, // [2阶] 大敦：左膝外侧，再次向外拉开层次
            "foot_shaoyin": { x: 38, y: 92 }, // [1阶] 涌泉：左足底，靠内

            // --- 阳脉 (右侧身体 - 走势：眉 -> 肩 -> 胸 -> 腹 -> 胫 -> 踝) ---
            "foot_taiyang": { x: 50, y: 19 }, // [眉心] 睛明：保持正中高位

            "hand_taiyang": { x: 66, y: 32 }, // [3阶] 少泽：右肩，比左肩稍低，不对称
            "hand_yangming": { x: 74, y: 46 }, // [2阶] 商阳：右臂远端，向外张开
            "hand_shaoyang": { x: 60, y: 56 }, // [1阶] 关冲：内收到右侧腹部，填补腹部右侧空缺

            "foot_yangming": { x: 54, y: 72 }, // [2阶] 厉兑：右腿内侧/丹田右下，紧贴中轴线
            "foot_shaoyang": { x: 64, y: 86 }, // [1阶] 足窍阴：右脚踝，稍微向外
        };

        // B. [装备检查] 获取已装备在特定穴位上的“奇珍”
        const equippedQizhenMap = {};
        (actor.itemTypes.qizhen || []).forEach(item => {
            if (item.system.equipped && item.system.acupoint) {
                equippedQizhenMap[item.system.acupoint] = item;
            }
        });

        // C. [构建列表] 生成正经十二脉的完整渲染数据
        const standardMeta = {
            "hand_shaoyin": { t: 1, type: "yin" }, "foot_shaoyin": { t: 1, type: "yin" },
            "hand_shaoyang": { t: 1, type: "yang" }, "foot_shaoyang": { t: 1, type: "yang" },
            "hand_jueyin": { t: 2, type: "yin" }, "foot_jueyin": { t: 2, type: "yin" },
            "hand_yangming": { t: 2, type: "yang" }, "foot_yangming": { t: 2, type: "yang" },
            "hand_taiyin": { t: 3, type: "yin" }, "foot_taiyin": { t: 3, type: "yin" },
            "hand_taiyang": { t: 3, type: "yang" }, "foot_taiyang": { t: 3, type: "yang" }
        };

        context.jingmaiStandardList = Object.entries(standardMeta).map(([key, meta]) => {
            const isOpen = system.jingmai.standard[key]; // 穴位是否已打通
            const coord = MERIDIAN_COORDS[key] || { x: 50, y: 50 };
            const equippedItem = equippedQizhenMap[key];

            // 名称处理
            const fullName = game.i18n.localize(`XJZL.Jingmai.${key.charAt(0).toUpperCase() + key.slice(1)}`);
            const match = fullName.match(/\(([^)]+)\)/);
            const shortLabel = match ? match[1] : fullName;

            // Tooltip 构建: 包含经脉效果 + 奇珍装备信息
            let tooltip = `
            <div style='text-align:left; min-width:200px;'>
                <div style='font-weight:bold; color:var(--c-highlight); font-size:14px;'>${fullName}</div>
                <div style='font-size:10px; color:#ccc; margin-bottom:6px;'>
                    ${game.i18n.localize(`XJZL.Jingmai.T${meta.t}`)} · ${meta.type === 'yin' ? '阴脉' : '阳脉'}
                </div>
                <div style='padding:4px; background:rgba(255,255,255,0.1); border-radius:4px;'>
                    ${game.i18n.localize(`XJZL.Jingmai.Effects.${key.charAt(0).toUpperCase() + key.slice(1)}`)}
                </div>
            </div>`;

            if (equippedItem) {
                tooltip += `
            <hr style='border-color:#555; margin:8px 0;'>
            <div style='color:#a2e8dd; font-weight:bold; margin-bottom:4px;'><i class='fas fa-gem'></i> ${equippedItem.name}</div>
            <div style='font-size:11px; color:#aaa; line-height:1.4;'>${equippedItem.system.description || "暂无描述"}</div>`;
            }

            return {
                key,
                label: shortLabel,
                isActive: isOpen,
                tooltip,
                x: coord.x,
                y: coord.y,
                equippedItem,
                type: meta.type,
                // ▼▼▼ 补上这一行 ▼▼▼
                tierLabel: `XJZL.Jingmai.T${meta.t}`
            };
        });

        // D. [奇经八脉] 仅列表显示，无坐标
        const extraOrder = ["du", "ren", "chong", "dai", "yangwei", "yinwei", "yangqiao", "yinqiao"];
        context.jingmaiExtraList = extraOrder.map(key => {
            const capKey = key.charAt(0).toUpperCase() + key.slice(1);
            return {
                key: key,
                label: `XJZL.Jingmai.${capKey}`,
                isActive: system.jingmai.extra[key],
                tooltip: `
                <div style='text-align:left; max-width:250px;'>
                    <div style='margin-bottom:4px;'><b>条件:</b> ${game.i18n.localize(`XJZL.Jingmai.Conditions.${capKey}`)}</div>
                    <div style='color:#ccc;'><b>效果:</b> ${game.i18n.localize(`XJZL.Jingmai.Effects.${capKey}`)}</div>
                </div>`
            };
        });

        // =====================================================
        // ✦ 8. 物品清单(Inventory)
        // -----------------------------------------------------
        // 对物品按类型分类，方便模板通过 {{#each inventory}} 渲染多个 tab 或列表
        context.inventory = [
            { label: "TYPES.Item.weapon", type: "weapon", items: actor.itemTypes.weapon },
            { label: "TYPES.Item.armor", type: "armor", items: actor.itemTypes.armor },
            { label: "TYPES.Item.qizhen", type: "qizhen", items: actor.itemTypes.qizhen },
            { label: "TYPES.Item.consumable", type: "consumable", items: actor.itemTypes.consumable },
            { label: "TYPES.Item.manual", type: "manual", items: actor.itemTypes.manual },
            { label: "TYPES.Item.misc", type: "misc", items: actor.itemTypes.misc }
        ];

        // =====================================================
        // ✦ 9. 装备架数据 (Equipment Rack - Visual Slots)
        // -----------------------------------------------------
        // [新增逻辑] 提取已装备的物品，填入对应的视觉槽位中
        // 用于 tab-inventory.hbs 顶部的九宫格展示

        const equipped = {
            weapon: null,
            head: null, top: null, bottom: null, shoes: null,
            necklace: null, earring: null, hidden: null, //  之前忘了暗器，毫无存在感啊这东西
            rings: [], // 数组，支持多戒
            accessories: [] // 数组，支持多饰品
        };

        // 遍历所有物品，寻找已装备项 (equipped === true)
        if (actor.items) {
            for (const item of actor.items) {
                if (!item.system.equipped) continue; // 跳过未装备

                const type = item.type;
                const armorType = item.system.type; // head, top, etc.

                if (type === "weapon") {
                    // 武器 (目前逻辑只取第一个，未来可扩展主副手)
                    if (!equipped.weapon) equipped.weapon = item;
                }
                else if (type === "armor") {
                    switch (armorType) {
                        case "head": equipped.head = item; break;
                        case "top": equipped.top = item; break;
                        case "bottom": equipped.bottom = item; break;
                        case "shoes": equipped.shoes = item; break;
                        case "necklace": equipped.necklace = item; break;
                        case "earring": equipped.earring = item; break;
                        case "hidden": equipped.hidden = item; break;
                        case "ring":
                            // 戒指最多显示2个
                            if (equipped.rings.length < 2) equipped.rings.push(item);
                            break;
                        case "accessory":
                            // 饰品最多显示6个
                            if (equipped.accessories.length < 6) equipped.accessories.push(item);
                            break;
                    }
                }
            }
        }

        // [填充空位] 确保数组长度固定，方便前端模板循环渲染空槽图标
        // Ring 补齐到 2
        for (let i = equipped.rings.length; i < 2; i++) equipped.rings.push(null);
        // Accessory 补齐到 6
        for (let i = equipped.accessories.length; i < 6; i++) equipped.accessories.push(null);

        // 挂载到上下文
        context.equipped = equipped;

        // =====================================================
        // 动态背景 (根据性别)
        // =====================================================
        const gender = actor.system.info.gender;
        // 默认为男版，如果是 female 则切换
        context.dollBg = (gender === "female")
            ? "systems/xjzl-system/assets/icons/character/zhanli-f.svg"
            : "systems/xjzl-system/assets/icons/character/zhanli.svg";

        // =====================================================
        // ✦ 10. 技艺书籍 (Art Books) - [增强版]
        // -----------------------------------------------------
        // 预处理：计算总XP上限 + 构建描述 Tooltip
        const rawArtBooks = actor.itemTypes.art_book || [];
        context.artBooks = rawArtBooks.map(book => {
            // 1. 计算总消耗 (Max XP)
            const maxXP = book.system.chapters.reduce((sum, c) => {
                const cost = c.cost || 0;
                const ratio = c.xpCostRatio ?? 1;
                return sum + Math.floor(cost * ratio);
            }, 0);

            // [新增] 统计已完成章节数
            // 数据模型已经在 prepareDerivedData 里给每个 chapter 算好了 progress.isCompleted
            let completedCount = 0;
            if (book.system.chapters) {
                for (const ch of book.system.chapters) {
                    // 兼容性检查：确保 progress 对象存在
                    if (ch.progress && ch.progress.isCompleted) {
                        completedCount++;
                    }
                }
            }

            // 判断是否全书通读
            const totalChap = book.system.chapters.length;
            const isCompleted = (totalChap > 0 && completedCount >= totalChap);

            // 2. 构建 Tooltip
            let tooltip = `<div style='text-align:left; max-width:250px; font-family:var(--font-serif);'>`;
            tooltip += `<div style='font-weight:bold; margin-bottom:5px; color:#fff; border-bottom:1px solid rgba(255,255,255,0.2);'>${book.name}</div>`;

            if (book.system.description) {
                let desc = book.system.description.replace(/<[^>]*>?/gm, '');
                if (desc.length > 150) desc = desc.substring(0, 150) + "...";
                desc = desc.replace(/"/g, '&quot;');
                tooltip += `<div style='font-size:12px; color:#ccc; line-height:1.5;'>${desc}</div>`;
            } else {
                tooltip += `<div style='font-size:12px; color:#999; font-style:italic;'>暂无描述</div>`;
            }

            // [核心修正] 进度显示逻辑
            // 显示已完成章节数 / 总章节数
            // 颜色：满级绿色，未满黄色
            const progressColor = isCompleted ? "#2ecc71" : "var(--c-highlight)";
            const progressText = isCompleted ? "已通读" : `完成: ${completedCount} / ${totalChap} 章`;

            tooltip += `<div style='margin-top:8px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.1); font-size:11px; color:${progressColor};'>
                            进度: ${progressText}
                        </div>`;

            tooltip += `</div>`;

            // 挂载衍生数据
            book.derived = {
                maxXP: maxXP,
                tooltip: tooltip,
                percent: maxXP > 0 ? Math.min(100, (book.system.xpInvested / maxXP) * 100) : 0,
                isCompleted: isCompleted
            };

            return book;
        });

        // [特效计算] 调用父类或混入的方法准备 Active Effects 列表
        this._prepareEffects(context);

        // 传递排序模式状态
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

    /**
     * 生成分组的属性选择列表 (支持 OptGroup)
     * 返回结构: { "七维属性": { "key": "Label" }, "战斗属性": { ... } }
     */
    _getGroupedModifierOptions() {
        const groups = {};

        // 辅助函数: 添加到指定分组
        const add = (groupName, key, label) => {
            if (!groups[groupName]) groups[groupName] = {};
            groups[groupName][key] = label;
        };

        // 1. 七维属性 (Stats)
        const groupStats = game.i18n.localize("XJZL.Stats.Label");
        for (const [k, labelKey] of Object.entries(CONFIG.XJZL.attributes)) {
            add(groupStats, `stats.${k}.mod`, `${game.i18n.localize(labelKey)} (Mod)`);
        }

        // 2. 战斗属性 (Combat)
        const groupCombat = game.i18n.localize("XJZL.Combat.Label");
        const combatInputs = {
            "speed": "XJZL.Combat.Speed", "dodge": "XJZL.Combat.Dodge",
            "block": "XJZL.Combat.Block", "kanpo": "XJZL.Combat.Kanpo",
            "initiative": "XJZL.Combat.Initiative", "xuzhao": "XJZL.Combat.XuZhao",
            "def_waigong": "XJZL.Combat.DefWaigong", "def_neigong": "XJZL.Combat.DefNeigong",
            "hit_waigong": "XJZL.Combat.HitWaigong", "hit_neigong": "XJZL.Combat.HitNeigong",
            "crit_waigong": "XJZL.Combat.CritWaigong", "crit_neigong": "XJZL.Combat.CritNeigong"
        };
        for (const [k, labelKey] of Object.entries(combatInputs)) {
            add(groupCombat, `combat.${k}`, `${game.i18n.localize(labelKey)} (Base/Mod)`);
        }

        // 武器等级 (Weapon Ranks .mod)
        // 遍历 CONFIG.XJZL.weaponTypes
        const groupWeaponRank = game.i18n.localize("XJZL.Combat.WeaponRanks");
        for (const [k, labelKey] of Object.entries(CONFIG.XJZL.weaponTypes)) {
            // 排除 none
            if (k === 'none') continue;
            add(groupWeaponRank, `combat.weaponRanks.${k}.mod`, `${game.i18n.localize(labelKey)} (Mod)`);
        }

        // 3. 伤害/抗性 (Dmg/Res)
        const groupDmg = "伤害与抗性"; // 也可以 localize
        // 伤害
        add(groupDmg, "combat.damages.global.mod", "全局伤害 (Mod)");
        add(groupDmg, "combat.damages.skill.mod", "招式伤害 (Mod)");
        add(groupDmg, "combat.damages.weapon.mod", "兵器伤害 (Mod)");
        for (const k of ["yang", "yin", "gang", "rou", "taiji"]) {
            add(groupDmg, `combat.damages.${k}.mod`, `${game.i18n.localize("XJZL.Combat.Dmg." + k.charAt(0).toUpperCase() + k.slice(1))} (Mod)`);
        }
        // 抗性
        for (const k of ["poison", "bleed", "fire", "mental", "liushi"]) {
            add(groupDmg, `combat.resistances.${k}.mod`, `${game.i18n.localize("XJZL.Combat.Res." + k.charAt(0).toUpperCase() + k.slice(1))} (Mod)`);
        }

        // 4. 技能 (Skills)
        const groupSkills = game.i18n.localize("XJZL.Skills.Label");
        for (const [k, labelKey] of Object.entries(CONFIG.XJZL.skills)) {
            add(groupSkills, `skills.${k}.mod`, `${game.i18n.localize(labelKey)} (Mod)`);
        }

        // 5. 技艺 (Arts)
        // 允许修改“等级”和“检定加值”
        const groupArts = game.i18n.localize("XJZL.Arts.Label");
        for (const [k, labelKey] of Object.entries(CONFIG.XJZL.arts)) {
            const label = game.i18n.localize(labelKey);
            // 修改等级 (arts.duanzao.mod)
            add(groupArts, `arts.${k}.mod`, `${label} (等级 Mod)`);
            // 修改检定 (arts.duanzao.checkMod)
            add(groupArts, `arts.${k}.checkMod`, `${label} (检定 Mod)`);
        }

        // 6. 资源上限 (Resources)
        const groupRes = game.i18n.localize("XJZL.Resources.Label");
        add(groupRes, "resources.hp.bonus", `${game.i18n.localize("XJZL.Resources.HP")} (Bonus)`);
        add(groupRes, "resources.mp.bonus", `${game.i18n.localize("XJZL.Resources.MP")} (Bonus)`);

        return groups;
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
    /*  Drag & Drop (堆叠逻辑)                      */
    /* -------------------------------------------- */

    /**
     * @override
     * 统一处理物品拖拽逻辑
     * 1. 互斥替换：背景/性格 (先删旧，再建新)
     * 2. 堆叠逻辑：消耗品等 (只改数量，不建新)
     * 3. 默认逻辑：创建新物品
     */
    async _onDropItem(event, data) {
        // 1. 基础检查
        if (!this.actor.isOwner) return false;

        // 解析拖拽数据 (V13/V12 通用写法)
        const itemData = await Item.implementation.fromDropData(data);
        if (!itemData) return false;

        // =====================================================
        // A. 互斥替换逻辑 (背景 & 性格)
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

                // 提示 (可选)
                // ui.notifications.info(`已替换新的${game.i18n.localize("TYPES.Item." + itemData.type)}`);
            }
            // 逻辑继续向下，交给 super._onDropItem 去创建新的
            return super._onDropItem(event, data);
        }

        // =====================================================
        // B. 堆叠逻辑 (消耗品/材料)
        // =====================================================
        const stackableTypes = ["consumable", "misc", "manual"]; // 根据需要调整类型
        if (stackableTypes.includes(itemData.type)) {
            // 查找是否已存在同名同类物品
            const existingItem = this.actor.items.find(i => i.type === itemData.type && i.name === itemData.name);

            if (existingItem) {
                // 计算新数量
                const addQty = itemData.system.quantity || 1;
                const newQty = (existingItem.system.quantity || 0) + addQty;

                // 更新现有物品，并阻断后续创建
                await existingItem.update({ "system.quantity": newQty });
                return false; // 阻断默认创建
            }
        }

        // =====================================================
        // C. 默认逻辑 (创建新物品)
        // =====================================================
        return super._onDropItem(event, data);
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
        const cult = this.document.system.cultivation;

        // 构建弹窗内容 - 使用 .xjzl-dialog-wrapper 和 flex 布局
        const content = `
        <div class="xjzl-dialog-wrapper">
            <p class="hint">
                <i class="fas fa-edit"></i> 
                手动修改修为池余额并生成审计日志。
            </p>
            
            <form>
                <!-- Row 1 -->
                <div class="form-row">
                    <div class="form-group">
                        <label>目标池</label>
                        <select name="poolKey">
                            <option value="general">通用修为 (当前: ${cult.general})</option>
                            <option value="neigong">内功修为 (当前: ${cult.neigong})</option>
                            <option value="wuxue">武学修为 (当前: ${cult.wuxue})</option>
                            <option value="arts">技艺修为 (当前: ${cult.arts})</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>变动数值 (+/-)</label>
                        <input type="number" name="amount" placeholder="例如: 100 或 -50" autofocus required />
                    </div>
                </div>

                <!-- Row 2 -->
                <div class="form-row">
                    <div class="form-group">
                        <label>事件标题</label>
                        <input type="text" name="title" value="手动调整" />
                    </div>
                    <div class="form-group">
                        <label>游戏时间 (可选)</label>
                        <input type="text" name="gameDate" placeholder="例如: 乾元三年冬" />
                    </div>
                </div>

                <!-- Row 3 -->
                <div class="form-group">
                    <label>备注详情</label>
                    <input type="text" name="reason" placeholder="例如: DM奖励，或 闭关十年..." />
                </div>
            </form>
        </div>
        `;

        // 使用 DialogV2
        const result = await foundry.applications.api.DialogV2.prompt({
            window: { title: "修为管理", icon: "fas fa-coins" },
            content: content,
            ok: {
                label: "执行",
                icon: "fas fa-check",
                callback: (event, button) => {
                    const form = button.form;
                    const formData = new FormData(form);
                    return {
                        poolKey: formData.get("poolKey"),
                        amount: parseInt(formData.get("amount")),
                        title: formData.get("title"),
                        gameDate: formData.get("gameDate"),
                        reason: formData.get("reason")
                    };
                }
            },
            rejectClose: false,
            position: { width: 420 }
        });

        if (result && !isNaN(result.amount) && result.amount !== 0) {
            await this.document.manualModifyXP(result.poolKey, result.amount, {
                title: result.title,
                gameDate: result.gameDate,
                reason: result.reason
            });
        }
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
     * @override
     * 处理拖拽放置逻辑
     * 1. 外来物品（新建）：总是交给 super 处理
     * 2. 内部物品（排序）：只有在 _isSorting 为 true 时才执行
     */
    async _onDrop(event) {
        event.preventDefault();

        // -----------------------------------------------------
        // 1. 数据解析 (Data Parsing)
        // -----------------------------------------------------
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (err) {
            return super._onDrop(event, data);
        }

        if (data.type !== "Item") return super._onDrop(event, data);

        // -----------------------------------------------------
        // 2. 身份识别 (Identity Check)
        // -----------------------------------------------------
        // A. 先尝试解析出 ID
        let sourceItem = null;
        let isInternal = false;

        if (data.uuid) {
            // V13 UUID 格式通常是 "Actor.ID.Item.ID" 或 "Item.ID"
            // 取最后一部分作为 ID
            const sourceId = data.uuid.split(".").pop();

            // B. 直接在当前 Actor 的缓存集合里找 (同步操作，不需要 await)
            sourceItem = this.actor.items.get(sourceId);

            // 如果能找到，说明肯定是我自己的物品
            if (sourceItem) isInternal = true;
        }

        // -----------------------------------------------------
        // 3. 核心分流 (Logic Branching)
        // -----------------------------------------------------

        // 【情况 A：外来物品】(本地找不到，或者是空的) -> 交给父类去创建/处理
        if (!isInternal) {
            return super._onDrop(event, data);
        }

        // 【情况 B：内部物品】-> 检查排序开关
        if (!this._isSorting) {
            return super._onDrop(event, data); // 甚至可以直接 return false; 阻断一切
        }

        // -----------------------------------------------------
        // 4. 自定义排序逻辑 (Custom Sorting)
        // -----------------------------------------------------

        // A. 锁定目标位置
        const targetRow = event.target.closest(".wuxue-group");
        if (!targetRow) return super._onDrop(event, data); // 没拖对位置

        // B. 目标检查
        const targetId = targetRow.dataset.itemId;
        if (!targetId || targetId === sourceItem.id) return false; // 拖给自己

        const targetItem = this.actor.items.get(targetId);
        if (!targetItem) return;

        // C. 获取兄弟列表
        const siblings = this.actor.itemTypes[sourceItem.type]
            .filter(i => i.id !== sourceItem.id)
            .sort((a, b) => (a.sort || 0) - (b.sort || 0));

        // D. 计算位置
        const targetIndex = siblings.findIndex(i => i.id === targetId);
        if (targetIndex === -1) return;

        const box = targetRow.getBoundingClientRect();
        const midPoint = box.top + box.height / 2;
        const isBefore = event.clientY < midPoint;

        let sortBefore, sortAfter;

        if (isBefore) {
            const prevItem = siblings[targetIndex - 1];
            sortBefore = prevItem ? prevItem.sort : (siblings[0].sort - 100000);
            sortAfter = siblings[targetIndex].sort;
        } else {
            const nextItem = siblings[targetIndex + 1];
            sortBefore = siblings[targetIndex].sort;
            sortAfter = nextItem ? nextItem.sort : (siblings[siblings.length - 1].sort + 100000);
        }

        // E. 执行更新
        const newSort = (sortBefore + sortAfter) / 2;

        return this.actor.updateEmbeddedDocuments("Item", [{
            _id: sourceItem.id,
            sort: newSort
        }]);
    }

    /**
     * 切换排序模式
     */
    _onToggleSort(event, target) {
        event.preventDefault();
        this._isSorting = !this._isSorting;
        this.render(); // 重绘界面以应用 draggable 属性
    }
}