/**
 * 角色卡片逻辑
 */
import { XJZL } from "../config.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLCharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "actor", "character", "xjzl-system"],
        position: { width: 900, height: 800 },
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
            deleteEffect: XJZLCharacterSheet.prototype._onDeleteEffect, //删除状态
            rollMove: XJZLCharacterSheet.prototype._onRollMove,   //使用招式

            //手工修正
            addGroup: XJZLCharacterSheet.prototype._onAction,
            deleteGroup: XJZLCharacterSheet.prototype._onAction,
            addChange: XJZLCharacterSheet.prototype._onAction,
            deleteChange: XJZLCharacterSheet.prototype._onAction,

            //普通攻击
            rollBasicAttack: XJZLCharacterSheet.prototype._onRollBasicAttack,
            //趁虚而入
            rollOpportunityAttack: XJZLCharacterSheet.prototype._onRollOpportunityAttack
        }
    };

    static PARTS = {
        header: { template: "systems/xjzl-system/templates/actor/character/header.hbs" },
        tabs: { template: "systems/xjzl-system/templates/actor/character/tabs.hbs" },
        stats: { template: "systems/xjzl-system/templates/actor/character/tab-stats.hbs", scrollable: [""] },
        cultivation: { template: "systems/xjzl-system/templates/actor/character/tab-cultivation.hbs", scrollable: [""] },
        jingmai: { template: "systems/xjzl-system/templates/actor/character/tab-jingmai.hbs", scrollable: [""] },
        skills: { template: "systems/xjzl-system/templates/actor/character/tab-skills.hbs", scrollable: [""] },
        combat: { template: "systems/xjzl-system/templates/actor/character/tab-combat.hbs", scrollable: [""] },
        inventory: { template: "systems/xjzl-system/templates/actor/character/tab-inventory.hbs", scrollable: [""] },
        effects: { template: "systems/xjzl-system/templates/actor/character/tab-effects.hbs", scrollable: [""] },
        config: { template: "systems/xjzl-system/templates/actor/character/tab-config.hbs", scrollable: [""] }
    };

    tabGroups = { primary: "stats" };

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

        // 技能组与 UI 状态
        // 简单的逻辑：如果当前 tab 不是 neigong/wuxue/arts，重置为 neigong
        if (!["neigong", "wuxue", "arts"].includes(this._cultivationSubTab)) {
            this._cultivationSubTab = "neigong";
        }
        context.cultivationSubTab = this._cultivationSubTab;

        context.skillGroups = [
            { label: "XJZL.Stats.Liliang", skills: ["jiaoli", "zhengtuo", "paozhi", "qinbao"] },
            { label: "XJZL.Stats.Shenfa", skills: ["qianxing", "qiaoshou", "qinggong", "mashu"] },
            { label: "XJZL.Stats.Tipo", skills: ["renxing", "biqi", "rennai", "ningxue"] },
            { label: "XJZL.Stats.Neixi", skills: ["liaoshang", "chongxue", "lianxi", "duqi"] },
            { label: "XJZL.Stats.Qigan", skills: ["dianxue", "zhuizong", "tancha", "dongcha"] },
            { label: "XJZL.Stats.Shencai", skills: ["jiaoyi", "qiman", "shuofu", "dingli"] },
            { label: "XJZL.Stats.Wuxing", skills: ["wuxue", "jianding", "bagua", "shili"] }
        ];

        // 物品分类
        context.inventory = [
            { label: "TYPES.Item.weapon", type: "weapon", items: actor.itemTypes.weapon },
            { label: "TYPES.Item.armor", type: "armor", items: actor.itemTypes.armor },
            { label: "TYPES.Item.qizhen", type: "qizhen", items: actor.itemTypes.qizhen },
            { label: "TYPES.Item.consumable", type: "consumable", items: actor.itemTypes.consumable },
            { label: "TYPES.Item.manual", type: "manual", items: actor.itemTypes.manual },
            { label: "TYPES.Item.misc", type: "misc", items: actor.itemTypes.misc }
        ];

        // 特效列表
        const allEffects = actor.effects.map(e => {
            const source = fromUuidSync(e.origin);
            return {
                id: e.id,
                name: e.name,
                img: e.img,
                disabled: e.disabled,
                isTemporary: !e.transfer,
                sourceName: source ? source.name : "未知来源",
                description: e.description
            };
        });
        context.temporaryEffects = allEffects.filter(e => e.isTemporary);
        context.passiveEffects = allEffects.filter(e => !e.isTemporary);

        // =====================================================
        //  准备技艺列表 (Arts)
        // =====================================================
        context.artsList = [];
        // 遍历配置中的技艺列表，确保顺序一致
        for (const [key, labelKey] of Object.entries(XJZL.arts)) {
            const artData = actor.system.arts[key];
            if (artData) {
                context.artsList.push({
                    key: key,
                    label: labelKey, // "XJZL.Arts.Duanzao"
                    total: artData.total || 0,
                    // 如果需要显示检定加值，可以在这里加: rollMod: (artData.checkMod || 0) + (artData.bookCheck || 0)
                });
            }
        }

        // =====================================================
        //  准备技艺书 (Arts Books)
        // =====================================================
        context.artBooks = actor.itemTypes.art_book || [];

        // 我们不需要像武学那样预计算伤害，因为技艺书很简单
        // 章节进度已经在 ArtBookDataModel.prepareDerivedData 中算好了

        return context;
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

        // 5. 资源上限 (Resources)
        const groupRes = game.i18n.localize("XJZL.Resources.Label");
        add(groupRes, "resources.hp.bonus", `${game.i18n.localize("XJZL.Resources.HP")} (Bonus)`);
        add(groupRes, "resources.mp.bonus", `${game.i18n.localize("XJZL.Resources.MP")} (Bonus)`);

        return groups;
    }

    /* -------------------------------------------- */
    /*  通用动作处理 (Action Handler)                */
    /* -------------------------------------------- */

    async _onAction(event, target) {
        const action = target.dataset.action;
        // console.log("XJZL | Action Triggered:", action); // 调试用

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
    }

    /* -------------------------------------------- */
    /*  Drag & Drop (堆叠逻辑)                      */
    /* -------------------------------------------- */

    async _onDropItem(event, data) {
        if (!this.actor.isOwner) return false;
        const item = await Item.implementation.fromDropData(data);
        if (!item) return false;

        const stackableTypes = ["consumable", "misc", "manual"];
        if (stackableTypes.includes(item.type)) {
            const existingItem = this.actor.items.find(i => i.type === item.type && i.name === item.name);
            if (existingItem) {
                const addQty = item.system.quantity || 1;
                const newQty = existingItem.system.quantity + addQty;
                await existingItem.update({ "system.quantity": newQty });
                return false;
            }
        }
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
                    <input type="number" name="totalAmount" value="100" autofocus class="xjzl-input" style="${inputStyle}"/>
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
        const totalCost = item.system.chapters.reduce((sum, c) => sum + (c.cost || 0), 0);

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
}