/**
 * 角色卡片逻辑
 */
import { XJZL } from "../config.mjs";
// 引入工具函数
import { localizeConfig, rollDisabilityTable, promptDisabilityQuery } from "../utils/utils.mjs";
// 引入卡片管理器 (用于复用死检的逻辑)
import { ChatCardManager } from "../managers/chat-manager.mjs";

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

            // --- 修炼系统 (统一使用辅助方法) ---
            investXP: XJZLCharacterSheet.prototype._onInvestXP,
            refundXP: XJZLCharacterSheet.prototype._onRefundXP,
            investMoveXP: XJZLCharacterSheet.prototype._onInvestMoveXP,
            refundMoveXP: XJZLCharacterSheet.prototype._onRefundMoveXP,
            investArtXP: XJZLCharacterSheet.prototype._onInvestArtXP,
            refundArtXP: XJZLCharacterSheet.prototype._onRefundArtXP,

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
            editImage: XJZLCharacterSheet.prototype._onEditImage
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
        stats: {
            template: "systems/xjzl-system/templates/actor/character/tab-stats.hbs",
            scrollable: [""], // 内部滚动容器
            classes: ["xjzl-body"]
        },
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
        const context = await super._prepareContext(options);
        const actor = this.document;

        context.system = actor.system;
        context.tabs = this.tabGroups;

        // 资源百分比
        context.percents = {
            hp: actor.system.resources.hp.max ? Math.min(100, (actor.system.resources.hp.value / actor.system.resources.hp.max) * 100) : 0,
            mp: actor.system.resources.mp.max ? Math.min(100, (actor.system.resources.mp.value / actor.system.resources.mp.max) * 100) : 0
        };

        // 内功
        context.neigongs = actor.itemTypes.neigong || [];
        context.neigongs.forEach(item => item.isRunning = item.system.active);

        context.groupedModifierOptions = this._getGroupedModifierOptions();

        // =====================================================
        //  准备武学 (调用 Item 方法计算)
        // =====================================================
        context.wuxues = actor.itemTypes.wuxue || [];

        for (const wuxue of context.wuxues) {
            const moves = wuxue.system.moves || [];
            moves.forEach(move => {
                // 委托 Item 计算数值 (瘦 Sheet)
                const result = wuxue.calculateMoveDamage(move.id);

                if (result) {
                    result.breakdown += `\n\n------------------\n注: 预估基于100气血/100内力/0怒气\n无内功和招式抗性的标准木桩`;
                    move.derived = result;
                } else {
                    move.derived = { damage: 0, feint: 0, breakdown: "计算错误", cost: { mp: 0, rage: 0, hp: 0 } };
                }
            });
        }

        // =====================================================
        // 技能组与 UI 状态 (Skill Groups)
        // =====================================================
        if (!["neigong", "wuxue", "arts"].includes(this._cultivationSubTab)) {
            this._cultivationSubTab = "neigong";
        }
        context.cultivationSubTab = this._cultivationSubTab;

        // 定义所有分组
        const allSkillGroups = [
            { key: "wuxing", label: "XJZL.Stats.Wuxing", skills: ["wuxue", "jianding", "bagua", "shili"] }, // 悟性放在定义里方便提取
            { key: "liliang", label: "XJZL.Stats.Liliang", skills: ["jiaoli", "zhengtuo", "paozhi", "qinbao"] },
            { key: "shenfa", label: "XJZL.Stats.Shenfa", skills: ["qianxing", "qiaoshou", "qinggong", "mashu"] },
            { key: "tipo", label: "XJZL.Stats.Tipo", skills: ["renxing", "biqi", "rennai", "ningxue"] },
            { key: "neixi", label: "XJZL.Stats.Neixi", skills: ["liaoshang", "chongxue", "lianxi", "duqi"] },
            { key: "qigan", label: "XJZL.Stats.Qigan", skills: ["dianxue", "zhuizong", "tancha", "dongcha"] },
            { key: "shencai", label: "XJZL.Stats.Shencai", skills: ["jiaoyi", "qiman", "shuofu", "dingli"] }
        ];

        // 拆分悟性和普通属性
        context.wuxingGroup = allSkillGroups.find(g => g.key === 'wuxing');
        context.standardSkillGroups = allSkillGroups.filter(g => g.key !== 'wuxing');

        // =====================================================
        // 查找当前架招名称 (Find Active Stance Name)
        // =====================================================
        context.activeStance = null; // 默认无架招

        const martial = actor.system.martial;
        if (martial.stanceActive && martial.stanceItemId && martial.stance) {
            const stanceItem = actor.items.get(martial.stanceItemId);
            if (stanceItem) {
                const move = stanceItem.system.moves.find(m => m.id === martial.stance);
                if (move) {
                    // 构建完整的数据对象
                    context.activeStance = {
                        name: move.name,
                        description: move.description,
                        automationNote: move.automationNote
                    };
                }
            }
        }

        // 物品分类
        context.inventory = [
            { label: "TYPES.Item.weapon", type: "weapon", items: actor.itemTypes.weapon },
            { label: "TYPES.Item.armor", type: "armor", items: actor.itemTypes.armor },
            { label: "TYPES.Item.qizhen", type: "qizhen", items: actor.itemTypes.qizhen },
            { label: "TYPES.Item.consumable", type: "consumable", items: actor.itemTypes.consumable },
            { label: "TYPES.Item.manual", type: "manual", items: actor.itemTypes.manual },
            { label: "TYPES.Item.misc", type: "misc", items: actor.itemTypes.misc }
        ];

        // 调用特效准备函数
        this._prepareEffects(context);

        // =====================================================
        //  准备技艺列表 (Arts)
        // =====================================================
        // 使用临时数组收集所有技艺，后续进行拆分
        const allArts = [];

        // 获取我们在 DataModel 中算好的身份数据 (Raw Config)
        const activeIdentities = actor.system.activeIdentities || {};

        // 遍历配置中的技艺列表，确保顺序一致
        for (const [key, labelKey] of Object.entries(XJZL.arts)) {
            const artData = actor.system.arts[key];
            if (artData) {
                // 基础数据
                const artObj = {
                    key: key,
                    label: labelKey, // "XJZL.Arts.Duanzao"
                    total: artData.total || 0,
                    identity: null // 默认无身份
                };

                // 身份处理逻辑
                // 检查该技艺是否有激活的身份
                // identityData 现在是 { highest: {...}, all: [...] }
                const identityData = activeIdentities[key];

                if (identityData && identityData.highest) {
                    const capKey = key.charAt(0).toUpperCase() + key.slice(1);

                    // 1. 徽章显示的标题 (取最高级)
                    const badgeTitleKey = `XJZL.Identity.${capKey}.${identityData.highest.titleKey}`;
                    const badgeTitle = game.i18n.localize(badgeTitleKey);

                    // 2. 构建 Tooltip (遍历所有已获得的身份)
                    // 使用 map + join 生成长 HTML
                    let tooltipRows = identityData.all.map(id => {
                        const tKey = `XJZL.Identity.${capKey}.${id.titleKey}`;
                        const dKey = `XJZL.Identity.${capKey}.${id.descKey}`;

                        const title = game.i18n.localize(tKey);
                        const desc = game.i18n.localize(dKey);

                        // 每一项的样式：标题(金色) + 描述(白色)
                        // 将颜色变量修正为 --c-highlight 以匹配当前主题
                        return `
                        <div style="margin-bottom: 8px;">
                            <div style="color:var(--c-highlight); font-weight:bold; font-size:1.1em;">
                                <i class="fas fa-caret-right" style="font-size:0.8em;"></i> ${title} <span style="opacity:0.6; font-size:0.8em;">(Lv.${id.level})</span>
                            </div>
                            <div style="padding-left: 10px; line-height: 1.4; color: #ddd; font-size: 0.9em;">
                                ${desc}
                            </div>
                        </div>`;
                    }).join("<hr style='border-color:#444; margin: 4px 0;'>"); // 用分割线连接

                    // 包裹在外层容器中
                    const tooltipHtml = `<div style="text-align:left; max-width:400px; padding:2px;">${tooltipRows}</div>`;

                    artObj.identity = {
                        title: badgeTitle,   // 徽章只显示最高头衔
                        tooltip: tooltipHtml, // 悬停显示所有历史头衔
                        level: identityData.highest.level
                    };
                }

                // 推入临时数组
                allArts.push(artObj);
            }
        }

        // 拆分数组：供模板分别渲染
        // learnedArts: 已入门 (Level > 0)
        context.learnedArts = allArts.filter(a => a.total > 0);
        // unlearnedArts: 未入门 (Level == 0)
        context.unlearnedArts = allArts.filter(a => a.total === 0);

        // =====================================================
        //  准备技艺书 (Arts Books)
        // =====================================================
        context.artBooks = actor.itemTypes.art_book || [];

        // 我们不需要像武学那样预计算伤害，因为技艺书很简单
        // 章节进度已经在 ArtBookDataModel.prepareDerivedData 中算好了

        // =====================================================
        //  查找背景 & 性格
        // =====================================================
        // 从 itemTypes 中获取第一个匹配项 (因为我们在 _preCreate 限制了单例，所以这里取第0个是安全的)
        context.backgroundItem = actor.itemTypes.background?.[0] || null;
        context.personalityItem = actor.itemTypes.personality?.[0] || null;

        // =====================================================
        // 经脉显示数据准备 (Jingmai Presentation)
        // =====================================================

        // 1. 定义坐标 (左右分列，按层级 T3->T2->T1 从上到下排列)
        const MERIDIAN_COORDS = {
            // === 左侧屏幕 (阴脉 Yin) ===
            // 手太阴肺 (左肩/胸) - T3
            "hand_taiyin": { x: 32, y: 35 },
            // 手厥阴心包 (左肘/臂内) - T2
            "hand_jueyin": { x: 22, y: 48 },
            // 手少阴心 (左手腕/掌) - T1
            "hand_shaoyin": { x: 30, y: 65 },

            // 足太阴脾 (左膝上) - T3
            "foot_taiyin": { x: 28, y: 75 },
            // 足厥阴肝 (左大腿内侧) - T2
            "foot_jueyin": { x: 42, y: 80 },
            // 足少阴肾 (左足底/丹田下) - T1
            "foot_shaoyin": { x: 48, y: 88 },

            // === 右侧屏幕 (阳脉 Yang) ===
            // 足太阳膀胱 (头顶/眉心) - T3 (特例，属阳，居中偏上)
            "foot_taiyang": { x: 50, y: 20 },

            // 手阳明大肠 (右肩) - T2
            "hand_yangming": { x: 68, y: 35 },
            // 手少阳三焦 (右臂外侧) - T1
            "hand_shaoyang": { x: 78, y: 48 },
            // 手太阳小肠 (右手腕) - T3
            "hand_taiyang": { x: 70, y: 65 },

            // 足阳明胃 (右胸/腹) - T2
            "foot_yangming": { x: 62, y: 55 },
            // 足少阳胆 (右膝/侧腹) - T1
            "foot_shaoyang": { x: 72, y: 75 },
        };

        // 2. 获取已装备的奇珍 (按穴位索引)
        const equippedQizhenMap = {};
        const qizhenItems = actor.itemTypes.qizhen || [];
        for (const item of qizhenItems) {
            if (item.system.equipped && item.system.acupoint) {
                equippedQizhenMap[item.system.acupoint] = item;
            }
        }

        // 3. 构建 Standard List (增强版)
        const standardMeta = {
            "hand_shaoyin": { t: 1, type: "yin" }, "foot_shaoyin": { t: 1, type: "yin" },
            "hand_shaoyang": { t: 1, type: "yang" }, "foot_shaoyang": { t: 1, type: "yang" },
            "hand_jueyin": { t: 2, type: "yin" }, "foot_jueyin": { t: 2, type: "yin" },
            "hand_yangming": { t: 2, type: "yang" }, "foot_yangming": { t: 2, type: "yang" },
            "hand_taiyin": { t: 3, type: "yin" }, "foot_taiyin": { t: 3, type: "yin" },
            "hand_taiyang": { t: 3, type: "yang" }, "foot_taiyang": { t: 3, type: "yang" }
        };

        context.jingmaiStandardList = Object.entries(standardMeta).map(([key, meta]) => {
            const isOpen = actor.system.jingmai.standard[key];
            const coord = MERIDIAN_COORDS[key] || { x: 50, y: 50 };
            const equippedItem = equippedQizhenMap[key];

            // 1. 获取完整名称
            const fullName = game.i18n.localize(`XJZL.Jingmai.${key.charAt(0).toUpperCase() + key.slice(1)}`);

            // 2. 提取短名称 (括号内的内容)
            // 正则匹配 (...)，如果匹配不到则使用原名
            const match = fullName.match(/\(([^)]+)\)/);
            const shortLabel = match ? match[1] : fullName; // 如果没有括号就显示全名

            // Tooltip (显示完整信息)
            const tierLabel = game.i18n.localize(`XJZL.Jingmai.T${meta.t}`);
            const effectLabel = game.i18n.localize(`XJZL.Jingmai.Effects.${key.charAt(0).toUpperCase() + key.slice(1)}`);

            let tooltip = `
                <div style='text-align:left; min-width:200px;'>
                    <div style='font-weight:bold; color:var(--c-highlight); font-size:14px;'>${fullName}</div>
                    <div style='font-size:10px; color:#ccc; margin-bottom:6px;'>${tierLabel} · ${meta.type === 'yin' ? '阴脉' : '阳脉'}</div>
                    <div style='padding:4px; background:rgba(255,255,255,0.1); border-radius:4px;'>${effectLabel}</div>
                </div>
            `;

            if (equippedItem) {
                // 奇珍描述
                const desc = equippedItem.system.description || "暂无描述";
                tooltip += `
                <hr style='border-color:#555; margin:8px 0;'>
                <div style='color:#a2e8dd; font-weight:bold; margin-bottom:4px;'><i class='fas fa-gem'></i> ${equippedItem.name}</div>
                <div style='font-size:11px; color:#aaa; line-height:1.4;'>${desc}</div>
                `;
            }

            return {
                key: key,
                label: shortLabel, // 传递短名
                tierLabel: `XJZL.Jingmai.T${meta.t}`,
                isActive: isOpen,
                tooltip: tooltip,
                x: coord.x,
                y: coord.y,
                equippedItem: equippedItem,
                type: meta.type // 传递类型: 'yin' 或 'yang'
            };
        });

        // --- 4. 奇经八脉 (Extra) ---
        const extraOrder = ["du", "ren", "chong", "dai", "yangwei", "yinwei", "yangqiao", "yinqiao"];

        context.jingmaiExtraList = extraOrder.map(key => {
            const isActive = actor.system.jingmai.extra[key];
            const capKey = key.charAt(0).toUpperCase() + key.slice(1);

            const conditionLabel = game.i18n.localize(`XJZL.Jingmai.Conditions.${capKey}`);
            const effectLabel = game.i18n.localize(`XJZL.Jingmai.Effects.${capKey}`);

            // 构建 HTML 格式的 Tooltip
            const tooltip = `
                <div style='text-align:left; max-width:250px;'>
                    <div style='margin-bottom:4px;'><b>条件:</b> ${conditionLabel}</div>
                    <div style='color:#ccc;'><b>效果:</b> ${effectLabel}</div>
                </div>
            `;

            return {
                key: key,
                label: `XJZL.Jingmai.${capKey}`,
                isActive: isActive,
                tooltip: tooltip
            };
        });

        // 获取当前内功名称
        let activeNeigongName = "";
        let activeNeigongDesc = "";
        if (actor.system.martial.active_neigong) {
            const ng = actor.items.get(actor.system.martial.active_neigong);
            if (ng) {
                activeNeigongName = ng.name;
                // 提取纯文本描述，或者显示默认说明
                activeNeigongDesc = ng.system.description || "";
            }
        }
        context.activeNeigongName = activeNeigongName;
        context.activeNeigongDesc = activeNeigongDesc;

        context.choices = {
            genders: localizeConfig(XJZL.genders),
            sects: localizeConfig(XJZL.sects)
        };

        // 气血百分比计算 (用于 width: %)
        context.percents = {
            hp: actor.system.resources.hp.max ? Math.min(100, (actor.system.resources.hp.value / actor.system.resources.hp.max) * 100) : 0,
            mp: actor.system.resources.mp.max ? Math.min(100, (actor.system.resources.mp.value / actor.system.resources.mp.max) * 100) : 0,
            rage: (actor.system.resources.rage.value / 10) * 100
        };

        // 处事态度下拉选项
        context.choices.attitudes = localizeConfig(XJZL.attitudes);

        // 传递嗜好选项
        context.choices.hobbies = localizeConfig(XJZL.hobbies);

        // 准备 3 个嗜好槽位 (用于循环渲染下拉框)
        // 无论当前存了几个，都补齐到 3 个，方便界面显示
        const currentHobbies = this.document.system.info.shihao || [];
        context.hobbySlots = [0, 1, 2].map(i => ({
            index: i,
            value: currentHobbies[i] || ""
        }));

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

    // _onRender(context, options) {
    //     super._onRender(context, options);

    //     if (!this.element.dataset.delegated) {
    //         this.element.addEventListener("change", (event) => {
    //             const target = event.target;
    //             if (target.matches("input, select, textarea")) {
    //                 this.submit();
    //             }
    //         });
    //         this.element.dataset.delegated = "true";
    //     }
    // }

    /**
     * 处理输入框变化 (增加属性验证)
     */
    async _onChangeInput(event) {
        event.preventDefault();
        const input = event.target;
        const name = input.name;
        const value = input.type === "number" ? Number(input.value) : input.value;

        // 1. 验证：自由属性点分配
        // 优化：将验证逻辑委托给 Actor，Sheet 只负责处理 UI (回滚值/提示)
        if (name.includes(".assigned")) {
            if (!this._validateStatAssignment(name, value, input)) {
                return; // 验证失败，阻止提交
            }
        }

        // 2. 提交保存
        await this.submit();
    }

    /**
     * 调用 Actor 的方法来判断是否合法
     */
    _validateStatAssignment(fieldName, newValue, inputElement) {
        // 安全检查：防止 Actor 还没写这个方法时报错
        if (typeof this.actor.canUpdateStat !== "function") {
            console.warn("XJZLActor 尚未实现 canUpdateStat 方法，跳过验证。");
            return true;
        }

        // 调用 Actor 业务逻辑
        const validation = this.actor.canUpdateStat(fieldName, newValue);

        if (!validation.valid) {
            ui.notifications.warn(validation.message || "无法分配属性点。");
            // 重置 UI 为旧值
            inputElement.value = validation.oldValue;
            return false;
        }

        return true;
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
        //上面的CONFIG的attributes是没有悟性的，所以手动加上
        if (!groups["stats.wuxing.mod"]) {
            add(groupStats, "stats.wuxing.mod", `${game.i18n.localize("XJZL.Stats.Wuxing")} (Mod)`);
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
}