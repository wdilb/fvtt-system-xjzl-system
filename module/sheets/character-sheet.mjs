/**
 * 先简单写一个让系统运行起来
 */
/* module/sheets/actor-sheet.mjs */
import { XJZL } from "../config.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;
const renderTemplate = foundry.applications.handlebars.renderTemplate;

export class XJZLCharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "actor", "character", "xjzl-system"],
        position: { width: 900, height: 800 },
        window: { resizable: true },
        actions: {
            //切换内功
            toggleNeigong: XJZLCharacterSheet.prototype._onToggleNeigong,
            // 切换子标签页 (内功/武学)
            toggleSubTab: XJZLCharacterSheet.prototype._onToggleSubTab,
            //投入修为
            investXP: XJZLCharacterSheet.prototype._onInvestXP,
            //编辑物品
            editItem: XJZLCharacterSheet.prototype._onEditItem,
            //删除物品
            deleteItem: XJZLCharacterSheet.prototype._onDeleteItem,
            //返回投入的修为
            refundXP: XJZLCharacterSheet.prototype._onRefundXP,
            //武学投入修为
            investMoveXP: XJZLCharacterSheet.prototype._onInvestMoveXP,
            //武学回退修为
            refundMoveXP: XJZLCharacterSheet.prototype._onRefundMoveXP,
            rollMove: XJZLCharacterSheet.prototype._onRollMove, // 先占位
            // 物品操作
            createItem: XJZLCharacterSheet.prototype._onCreateItem,
            toggleEquip: XJZLCharacterSheet.prototype._onToggleEquip,
            useConsumable: XJZLCharacterSheet.prototype._onUseConsumable, //使用消耗品
            readManual: XJZLCharacterSheet.prototype._onReadManual,  //阅读秘籍
            deleteEffect: XJZLCharacterSheet.prototype._onDeleteEffect  //删除buff/debuff
        }
    };

    static PARTS = {
        header: { template: "systems/xjzl-system/templates/actor/character/header.hbs" },
        tabs: { template: "systems/xjzl-system/templates/actor/character/tabs.hbs" },
        // 内容 Parts
        stats: { template: "systems/xjzl-system/templates/actor/character/tab-stats.hbs", scrollable: [""] },
        cultivation: { template: "systems/xjzl-system/templates/actor/character/tab-cultivation.hbs", scrollable: [""] },
        jingmai: { template: "systems/xjzl-system/templates/actor/character/tab-jingmai.hbs", scrollable: [""] },
        skills: { template: "systems/xjzl-system/templates/actor/character/tab-skills.hbs", scrollable: [""] },
        combat: { template: "systems/xjzl-system/templates/actor/character/tab-combat.hbs", scrollable: [""] },
        inventory: { template: "systems/xjzl-system/templates/actor/character/tab-inventory.hbs", scrollable: [".scroll-area"] },
        effects: { template: "systems/xjzl-system/templates/actor/character/tab-effects.hbs", scrollable: [""] }
    };

    tabGroups = { primary: "stats" };

    /* -------------------------------------------- */
    /*  生命周期与数据准备                           */
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

        // =====================================================
        //  准备武学 (全要素伤害预估)
        // =====================================================
        context.wuxues = actor.itemTypes.wuxue || [];

        // 模拟目标 (Mock Target) - 性能优化版 (循环外创建)
        const dummyTarget = new Proxy({
            name: "预设木桩",
            system: {
                resources: { hp: { value: 100, max: 100 }, mp: { value: 100, max: 100 }, rage: { value: 0, max: 10 } },
                stats: {}, combat: {}
            }
        }, {
            get: (target, prop) => {
                if (prop in target) return target[prop];
                return new Proxy(() => 0, { get: () => 0, apply: () => 0, toPrimitive: () => 0 });
            }
        });
        const dummyTargetsArray = [dummyTarget];

        // 开始遍历计算
        for (const wuxue of context.wuxues) {
            const moves = wuxue.system.moves || [];

            moves.forEach(move => {
                // --- A. 招式自带基础 (Base + Growth) ---
                const lvl = Math.max(1, move.computedLevel || 1);
                const moveBaseDmg = (move.calculation.base || 0) + (move.calculation.growth || 0) * (lvl - 1);

                // --- B. 武器基础伤害 (Weapon Item) & 装备判定 ---
                let weaponDmg = 0;
                let isWeaponMatch = false; // 【新增】标记：是否满足武器条件

                // 判定逻辑：
                // 1. 如果招式是徒手，默认满足
                if (move.weaponType === 'unarmed') {
                    isWeaponMatch = true;
                }
                // 2. 否则查找已装备且类型匹配的武器
                else if (actor.itemTypes.weapon && move.weaponType && move.weaponType !== 'none') {
                    const weapon = actor.itemTypes.weapon.find(w =>
                        w.system.equipped === true &&
                        w.system.type === move.weaponType
                    );

                    if (weapon) {
                        weaponDmg = weapon.system.damage || 0;
                        isWeaponMatch = true; // 找到了匹配武器
                    }
                }

                // --- C. 内功系数加成 ---
                const neigongBonusRatio = actor.system.getNeigongDamageBonus ? actor.system.getNeigongDamageBonus(move.element) : 0;

                // --- D. 属性加成 (Scalings) ---
                let attrBonus = 0;
                if (move.calculation.scalings) {
                    for (const scale of move.calculation.scalings) {
                        const propVal = foundry.utils.getProperty(actor.system.stats, `${scale.prop}.total`) || 0;
                        // 内功加成直接加在系数上
                        const finalRatio = (scale.ratio || 0) + neigongBonusRatio;
                        attrBonus += propVal * finalRatio;
                    }
                }

                // --- E. 固定增伤 (Flat Bonuses from Actor) ---
                let flatBonus = 0;
                if (actor.system.combat?.damages) {
                    flatBonus += (actor.system.combat.damages.global?.total || 0);
                    flatBonus += (actor.system.combat.damages.skill?.total || 0);
                    if (move.element && move.element !== "none") {
                        flatBonus += (actor.system.combat.damages[move.element]?.total || 0);
                    }
                }

                // 武器等级增伤
                let weaponDmgBonus = 0;
                // 【修改】只有在 isWeaponMatch 为真时，才计算造诣加成
                if (isWeaponMatch && move.weaponType && actor.system.combat?.weaponRanks) {
                    const rankObj = actor.system.combat.weaponRanks[move.weaponType];
                    if (rankObj) {
                        const rank = rankObj.total || 0;
                        let rankDmg = 0;
                        // 断层公式
                        if (rank <= 4) rankDmg = rank * 1;
                        else if (rank <= 8) rankDmg = rank * 2;
                        else rankDmg = rank * 3;
                        weaponDmgBonus += rankDmg;
                    }
                }

                // --- F. 初步汇总 ---
                // 公式：(招式基 + 武器基 + 属性加成 + 其他固定增伤 + 武器等级增伤)
                // 这里假设内功系数只影响属性加成(D步骤已处理)，如果内功也影响武器伤害，需要重新调整公式位置
                // 按照之前的逻辑：Attr = Prop * (Ratio + Bonus)
                // 所以这里直接相加即可
                let preScriptDmg = Math.floor(moveBaseDmg + weaponDmg + attrBonus + flatBonus + weaponDmgBonus);
                let totalDmg = preScriptDmg;
                let scriptDmgBonus = 0;
                let scriptFeintBonus = 0;

                //在执行脚本前添加虚招值的计算
                let feintVal = 0;
                let feintBreakdown = ""; // 新增：构成详解

                if (move.type === 'feint') {
                    // 1. 基础虚招值 (来自 DataModel)
                    const base = move.baseFeint || 0;

                    // 2. 武器等级
                    let weaponRank = 0;
                    if (isWeaponMatch && move.weaponType && actor.system.combat?.weaponRanks) {
                        const rankObj = actor.system.combat.weaponRanks[move.weaponType];
                        if (rankObj) weaponRank = rankObj.total || 0;
                    }

                    // 3. 角色加成
                    const actorBonus = actor.system.combat.xuzhaoTotal || 0;

                    feintVal = base + weaponRank + actorBonus;

                    // 生成提示文本
                    feintBreakdown = `${game.i18n.localize("XJZL.Wuxue.Moves.BaseFeint")} ${base} + ${game.i18n.localize("XJZL.Combat.WeaponRanks")} ${weaponRank} + ${game.i18n.localize("XJZL.Combat.XuZhao")} ${actorBonus}`;
                }

                // --- G. 执行招式脚本 (Script Preview) ---
                if (move.script && move.script.trim()) {
                    if (actor.system.resources && actor.system.stats) {
                        const out = {
                            damage: totalDmg,
                            feint: feintVal
                        };
                        try {
                            const fn = new Function("actor", "S", "out", "t", "targets", "item", "rollData", move.script);
                            fn(actor, actor.system, out, dummyTarget, dummyTargetsArray, wuxue, {});
                            // 1. 更新伤害
                            totalDmg = Math.floor(out.damage);
                            scriptDmgBonus = totalDmg - preScriptDmg;

                            // 2. 更新虚招值
                            const newFeint = Math.floor(out.feint);
                            scriptFeintBonus = newFeint - feintVal;
                            feintVal = newFeint;
                        } catch (err) { /* Ignore in preview */ }
                    }
                }

                // --- H. 挂载显示 (详细拆解) ---
                let breakdownText = `招式本身伤害: ${moveBaseDmg}\n`;
                breakdownText += `+ 武器伤害: ${weaponDmg}\n`;
                breakdownText += `+ 武器等级增伤: ${weaponDmgBonus}\n`;
                breakdownText += `+ 属性增伤: ${Math.floor(attrBonus)}\n`;
                breakdownText += `+ 其他增伤: ${flatBonus}`;

                if (scriptDmgBonus !== 0) {
                    const sign = scriptDmgBonus > 0 ? "+" : "";
                    breakdownText += `\n${sign} 特效增伤: ${scriptDmgBonus}`;
                }

                if (scriptFeintBonus !== 0) {
                    const sign = scriptFeintBonus > 0 ? "+" : "";
                    // 如果原本没有 Breakdown (非虚招变成了有数值)，给个初始头
                    if (!feintBreakdown) feintBreakdown = "基础 0";
                    feintBreakdown += ` ${sign} 特效加值 ${scriptFeintBonus}`;
                }

                // 如果有武器但没装备，给个醒目提示
                if (!isWeaponMatch && move.weaponType && move.weaponType !== 'none' && move.weaponType !== 'unarmed') {
                    breakdownText += `\n(⚠️ 未装备匹配武器)`;
                    feintBreakdown += `\n(⚠️ 未装备匹配武器)`;
                }

                // 木桩说明
                breakdownText += `\n\n------------------\n注: 预估基于100气血/100内力/0怒气\n无内功和招式抗性的标准木桩`;



                move.derived = {
                    damage: totalDmg,
                    feint: feintVal,
                    feintBreakdown: feintBreakdown,
                    breakdown: breakdownText,
                    neigongBonus: neigongBonusRatio > 0 ? `+${(neigongBonusRatio).toFixed(1)}系数` : "",
                    cost: move.currentCost || { mp: 0, rage: 0, hp: 0 }
                };
            });
        }

        // UI 状态控制
        // 如果没有初始化，默认显示 'neigong'
        if (!this._cultivationSubTab) this._cultivationSubTab = "neigong";
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

        // 将物品分类，方便前端渲染
        context.inventory = [
            { label: "TYPES.Item.weapon", type: "weapon", items: actor.itemTypes.weapon },
            { label: "TYPES.Item.armor", type: "armor", items: actor.itemTypes.armor },
            { label: "TYPES.Item.qizhen", type: "qizhen", items: actor.itemTypes.qizhen },
            { label: "TYPES.Item.consumable", type: "consumable", items: actor.itemTypes.consumable },
            { label: "TYPES.Item.manual", type: "manual", items: actor.itemTypes.manual },
            { label: "TYPES.Item.misc", type: "misc", items: actor.itemTypes.misc }
        ];

        // 3. 准备特效列表 (分为两类：临时状态 和 装备被动)
        const allEffects = actor.effects.map(e => {
            const source = fromUuidSync(e.origin); // 尝试获取来源
            return {
                id: e.id,
                name: e.name,
                img: e.img,
                disabled: e.disabled,
                isTemporary: !e.transfer, // transfer=false 的通常是临时状态
                sourceName: source ? source.name : "未知来源",
                description: e.description
            };
        });

        context.temporaryEffects = allEffects.filter(e => e.isTemporary);
        context.passiveEffects = allEffects.filter(e => !e.isTemporary);

        return context;
    }

    /* -------------------------------------------- */
    /*  核心：自动保存与验证逻辑                     */
    /* -------------------------------------------- */

    /**
     * 渲染后挂载事件监听器
     * AppV2 中，我们需要手动监听 input 的 change 事件来实现“即时保存”
     */
    _onRender(context, options) {
        super._onRender(context, options);

        // 性能优化：使用事件委托监听所有输入框
        // 避免给每个 input 单独绑定 listener
        if (!this.element.dataset.delegated) {
            this.element.addEventListener("change", (event) => {
                const target = event.target;
                // 过滤：只响应输入控件的 change
                if (target.matches("input, select, textarea")) {
                    // 排除一些不需要自动保存的特殊输入框（如果有的话）
                    // 目前没有，直接提交
                    this.submit();
                }
            });
            // 标记该元素已绑定，防止重绘时重复绑定
            this.element.dataset.delegated = "true";
        }
    }

    /**
     * 处理输入框变化
     */
    async _onChangeInput(event) {
        event.preventDefault();
        const input = event.target;
        const name = input.name;
        const value = input.type === "number" ? Number(input.value) : input.value;

        // 1. 验证：自由属性点分配逻辑
        // 检查字段名是否包含 .assigned (例如 system.stats.liliang.assigned)
        if (name.includes(".assigned")) {
            if (!this._validateStatAssignment(name, value, input)) {
                return; // 验证失败，终止保存
            }
        }

        // 2. 提交保存
        // AppV2 的 submit 方法会自动收集表单数据并更新 Document
        await this.submit();
    }

    /* -------------------------------------------- */
    /*  Drag & Drop (拖拽处理)                      */
    /* -------------------------------------------- */

    /**
     * 重写原生的物品拖拽处理
     * 目的：实现特定类型的自动堆叠
     */
    async _onDropItem(event, data) {
        if (!this.actor.isOwner) return false;

        // 获取被拖拽的物品数据 (从侧边栏或其他角色)
        const item = await Item.implementation.fromDropData(data);
        if (!item) return false;

        // 1. 定义哪些类型允许堆叠
        // 装备(weapon/armor/qizhen) 和 功法(neigong/wuxue) 不在此列 -> 它们会走默认逻辑，创建新实例
        const stackableTypes = ["consumable", "misc", "manual"];

        if (stackableTypes.includes(item.type)) {
            // 2. 查找背包里是否已有同名、同类型的物品
            const existingItem = this.actor.items.find(i =>
                i.type === item.type &&
                i.name === item.name
            );

            // 3. 如果找到了 -> 堆叠数量
            if (existingItem) {
                // 获取拖进来的数量 (默认为1)
                const addQty = item.system.quantity || 1;
                const newQty = existingItem.system.quantity + addQty;

                await existingItem.update({ "system.quantity": newQty });

                // 返回 false 阻止父类继续执行创建新物品的操作
                return false;
            }
        }

        // 4. 如果类型不可堆叠，或者没找到同名物品 -> 走默认逻辑 (创建新物品)
        return super._onDropItem(event, data);
    }

    /**
     * 验证属性分配是否合法
     * @param {string} fieldName - 修改的字段名
     * @param {number} newValue - 玩家输入的新值
     * @param {HTMLElement} inputElement - 输入框 DOM 对象 (用于重置)
     * @returns {boolean} - true 通过, false 失败
     */
    _validateStatAssignment(fieldName, newValue, inputElement) {
        const actor = this.document;
        const stats = actor.system.stats;

        // 1. 获取当前的剩余点数 (Total Free Points)
        // 注意：这里的 total 是基于 document 中已保存的数据计算的
        const currentFree = stats.freePoints.total;

        // 2. 获取该属性 *旧的* 分配值
        // foundry.utils.getProperty 是获取深层属性的好帮手
        // fieldName 类似 "system.stats.liliang.assigned"，我们需要去掉 "system." 前缀来从 actor.system 中取值吗？
        // DataModel 中的数据是 actor.system.stats... 
        // input 的 name 是 system.stats...
        // 我们用 foundry.utils.getProperty(this.document, fieldName) 直接取
        const oldValue = foundry.utils.getProperty(this.document, fieldName) || 0;

        // 3. 计算差值 (Delta)
        // 如果新值 5，旧值 2，差值是 3 (需要消耗3点)
        // 如果新值 1，旧值 5，差值是 -4 (返还4点)
        const delta = newValue - oldValue;

        // 4. 判断余额是否充足
        if (currentFree - delta < 0) {
            ui.notifications.warn(`自由属性点不足！剩余: ${currentFree}, 需要: ${delta}`);

            // 重置输入框为旧值
            inputElement.value = oldValue;
            return false;
        }

        // 5. 防止负数输入
        if (newValue < 0) {
            ui.notifications.warn("分配值不能为负数。");
            inputElement.value = oldValue;
            return false;
        }

        return true;
    }

    /* -------------------------------------------- */
    /*  Action Handlers                             */
    /* -------------------------------------------- */

    async _onEditItem(event, target) {
        const itemId = target.dataset.itemId;
        const item = this.document.items.get(itemId);
        if (item) item.sheet.render(true);
    }

    // 删除物品逻辑
    async _onDeleteItem(event, target) {
        const itemId = target.dataset.itemId;
        const item = this.document.items.get(itemId);
        if (!item) return;

        // 弹窗确认
        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: "删除物品" },
            content: `<p>确定要删除 <b>${item.name}</b> 吗？</p>`,
            rejectClose: false
        });

        if (confirm) {
            await item.delete();
        }
    }

    async _onToggleNeigong(event, target) {
        const itemId = target.dataset.itemId;
        const item = this.document.items.get(itemId);
        if (!item) return;
        const wasActive = item.system.active;
        if (!wasActive) {
            const updates = [];
            for (const i of this.document.itemTypes.neigong) {
                if (i.id !== itemId && i.system.active) {
                    updates.push({ _id: i.id, "system.active": false });
                }
            }
            if (updates.length) await this.document.updateEmbeddedDocuments("Item", updates);
            await this.document.update({ "system.martial.active_neigong": itemId });
        } else {
            await this.document.update({ "system.martial.active_neigong": "" });
        }
        await item.update({ "system.active": !wasActive });
    }

    /**
     * 投入修为
     */
    async _onInvestXP(event, target) {
        const itemId = target.dataset.itemId;
        const item = this.document.items.get(itemId);
        if (!item) return;

        // 获取上限数据 (DataModel 中已计算)
        const currentInvested = item.system.xpInvested;
        const maxXP = item.system.progressData.absoluteMax;

        // 如果已圆满，直接禁止
        if (currentInvested >= maxXP) {
            return ui.notifications.warn(`${item.name} 已达圆满境界，无需再投入修为。`);
        }

        const input = await foundry.applications.api.DialogV2.prompt({
            window: { title: `修炼: ${item.name}`, icon: "fas fa-arrow-up" },
            content: `
            <div style="text-align:center; padding: 10px;">
                <p>距离圆满还需: <b>${maxXP - currentInvested}</b></p>
                <p style="margin-bottom:10px;">当前通用修为: <b>${this.document.system.cultivation.general}</b></p>
                <div style="display:flex; flex-direction:column; gap:5px;">
                    <label>请输入投入数量:</label>
                    <input type="number" name="xp" value="100" autofocus 
                            style="text-align:center; font-size:1.5em; width:100%; background:rgba(255,255,255,0.8); color:black;"/>
                </div>
            </div>
            `,
            ok: {
                label: "投入", icon: "fas fa-check",
                callback: (event, button) => new FormData(button.form).get("xp")
            },
            rejectClose: false
        });

        if (input) {
            let amount = parseInt(input);
            const currentGeneral = this.document.system.cultivation.general;

            if (isNaN(amount) || amount <= 0) return ui.notifications.warn("请输入有效的正整数。");

            // 1. 溢出计算
            const needed = maxXP - currentInvested;
            if (amount > needed) {
                ui.notifications.info(`投入过多，已自动调整为所需的 ${needed} 点。`);
                amount = needed;
            }

            // 2. 余额检查
            if (currentGeneral < amount) {
                return ui.notifications.warn(`通用修为不足！你只有 ${currentGeneral} 点。`);
            }

            // 3. 执行更新
            await this.document.update({
                "system.cultivation.general": currentGeneral - amount
            });

            await item.update({
                "system.xpInvested": currentInvested + amount
            });

            ui.notifications.info(`${item.name} 修为增加 ${amount}。`);
        }
    }

    /**
     * 回退修为
     */
    async _onRefundXP(event, target) {
        const itemId = target.dataset.itemId;
        const item = this.document.items.get(itemId);
        if (!item) return;

        const currentInvested = item.system.xpInvested;
        if (currentInvested <= 0) return ui.notifications.warn("该内功尚未投入修为，无法回退。");

        const input = await foundry.applications.api.DialogV2.prompt({
            window: { title: `回退: ${item.name}`, icon: "fas fa-undo" },
            content: `
            <div style="text-align:center; padding: 10px;">
                <p style="color:var(--xjzl-accent);">回退将减少内功境界，并返还通用修为。</p>
                <p style="margin-bottom:10px;">当前已投入: <b>${currentInvested}</b></p>
                <div style="display:flex; flex-direction:column; gap:5px;">
                    <label>请输入取出数量:</label>
                    <input type="number" name="xp" value="${currentInvested}" autofocus 
                            style="text-align:center; font-size:1.5em; width:100%; background:rgba(255,255,255,0.8); color:black;"/>
                </div>
            </div>
            `,
            ok: {
                label: "回退", icon: "fas fa-undo",
                callback: (event, button) => new FormData(button.form).get("xp")
            },
            rejectClose: false
        });

        if (input) {
            let amount = parseInt(input);

            if (isNaN(amount) || amount <= 0) return ui.notifications.warn("请输入有效数字。");
            if (amount > currentInvested) amount = currentInvested; // 既然是取出，最多全取

            // 1. 返还通用修为
            await this.document.update({
                "system.cultivation.general": this.document.system.cultivation.general + amount
            });

            // 2. 扣除物品修为
            await item.update({
                "system.xpInvested": currentInvested - amount
            });

            ui.notifications.info(`${item.name} 回退成功，返还 ${amount} 点修为。`);
        }
    }

    /**
     * 切换修为页面的子标签 (内功/武学)
     */
    async _onToggleSubTab(event, target) {
        const tab = target.dataset.target;
        this._cultivationSubTab = tab;
        this.render(); // 重新渲染界面以更新显示
    }

    // 武学投入修为
    async _onInvestMoveXP(event, target) {
        const itemId = target.dataset.itemId;
        const moveId = target.dataset.moveId;
        const item = this.document.items.get(itemId);
        if (!item) return;

        const moveIndex = item.system.moves.findIndex(m => m.id === moveId);
        if (moveIndex === -1) return;
        const move = item.system.moves[moveIndex];

        // 【核心修复】计算还需要多少修为才能升级
        // move.progress.max 是当前级别所需的总投入 (相对值)
        // move.progress.current 是当前级别已投入 (相对值)
        const needed = move.progress.max - move.progress.current;

        const uniqueId = `invest-${foundry.utils.randomID()}`;

        const input = await foundry.applications.api.DialogV2.prompt({
            window: { title: `修炼: ${move.name}`, icon: "fas fa-arrow-up" },
            content: `
                <div style="text-align:center; padding: 10px;">
                    <p>当前进度: <span style="color:var(--xjzl-gold)">${move.progress.current}</span> / ${move.progress.max}</p>
                    <p style="font-size:0.9em; color:#666;">(总投入: ${move.xpInvested})</p>
                    <p style="margin-bottom:10px;">可用修为: <b>${this.document.system.cultivation.general}</b></p>
                    <div style="display:flex; flex-direction:column; gap:5px;">
                        <label>投入数量</label>
                        {{!-- 默认填入升级所需的值 --}}
                        <input id="${uniqueId}" type="number" name="xp" value="${needed}" autofocus 
                            style="text-align:center; font-size:1.5em; width:100%; color:black; background:rgba(255,255,255,0.9); border:1px solid #333;"/>
                    </div>
                </div>
            `,
            ok: {
                label: "投入", icon: "fas fa-check",
                callback: () => document.getElementById(uniqueId).value
            },
            rejectClose: false
        });

        if (input) {
            let amount = parseInt(input);
            const currentGeneral = this.document.system.cultivation.general;

            if (isNaN(amount) || amount <= 0) return ui.notifications.warn("无效数字");

            // 溢出检查：不能超过当前级的上限
            // 如果你想支持一次升多级，这里逻辑要改，但目前为了稳定，我们限制一次只升一级
            if (amount > needed) {
                ui.notifications.info(`投入过多，已调整为升级所需的 ${needed} 点。`);
                amount = needed;
            }

            if (currentGeneral < amount) return ui.notifications.warn("修为不足");

            // 1. 扣除通用修为
            await this.document.update({
                "system.cultivation.general": currentGeneral - amount
            });

            // 2. 更新招式数据
            const itemData = item.system.toObject();
            const idx = itemData.moves.findIndex(m => m.id === moveId);
            if (idx !== -1) {
                itemData.moves[idx].xpInvested += amount;
                await item.update({ "system.moves": itemData.moves });
                ui.notifications.info(`${move.name} 获得 ${amount} 点修为！`);
            }
        }
    }
    //回退武学修为
    async _onRefundMoveXP(event, target) {
        const itemId = target.dataset.itemId;
        const moveId = target.dataset.moveId;
        const item = this.document.items.get(itemId);
        if (!item) return;

        const moveIndex = item.system.moves.findIndex(m => m.id === moveId);
        if (moveIndex === -1) return;
        const move = item.system.moves[moveIndex];

        if (move.xpInvested <= 0) return ui.notifications.warn("尚未投入修为");

        const uniqueId = `refund-${foundry.utils.randomID()}`;

        const input = await foundry.applications.api.DialogV2.prompt({
            window: { title: `回退: ${move.name}`, icon: "fas fa-undo" },
            content: `
                <div style="text-align:center; padding: 10px;">
                    <p style="color:#ff4444; font-size:0.9em; margin-bottom:5px;">⚠️ 将返还修为并降低等级</p>
                    <p>可退还: <b>${move.xpInvested}</b></p>
                    <input id="${uniqueId}" type="number" value="${move.xpInvested}" autofocus 
                        style="text-align:center; font-size:1.5em; width:100%; color:black; background:rgba(255,255,255,0.9); border:1px solid #333;"/>
                </div>
            `,
            ok: {
                label: "散功", icon: "fas fa-undo",
                callback: () => document.getElementById(uniqueId).value
            },
            rejectClose: false
        });

        if (input) {
            let amount = parseInt(input);
            if (isNaN(amount) || amount <= 0) return;
            if (amount > move.xpInvested) amount = move.xpInvested;

            await this.document.update({
                "system.cultivation.general": this.document.system.cultivation.general + amount
            });

            const itemData = item.system.toObject();
            const idx = itemData.moves.findIndex(m => m.id === moveId);
            if (idx !== -1) {
                itemData.moves[idx].xpInvested -= amount;
                await item.update({ "system.moves": itemData.moves });
                ui.notifications.info(`${move.name} 散功成功，返还 ${amount} 点修为。`);
            }
        }
    }

    // 占位
    async _onRollMove(event, target) {
        ui.notifications.info("招式施放功能即将实装！");
    }

    async _onCreateItem(event, target) {
        const type = target.dataset.type;
        await Item.create({ name: `新${type}`, type: type }, { parent: this.document });
    }

    /**
     * 切换装备状态 (装备/卸下)
     */
    async _onToggleEquip(event, target) {
        const itemId = target.dataset.itemId;
        const item = this.document.items.get(itemId);
        if (!item) return;

        // A. 如果当前是“已装备”，则直接卸下
        if (item.system.equipped) {
            await item.update({ "system.equipped": false });
            return;
        }

        // B. 如果当前是“未装备”，则尝试装备 (执行互斥检查)
        const actor = this.document;
        const updates = []; // 待执行的批量更新操作 (用于卸下冲突装备)

        // --- 逻辑 1: 武器 (只能装一把) ---
        if (item.type === "weapon") {
            // 找到所有已装备的武器
            const equippedWeapons = actor.itemTypes.weapon.filter(i => i.system.equipped);
            // 将它们全部加入卸下队列
            equippedWeapons.forEach(w => {
                updates.push({ _id: w.id, "system.equipped": false });
            });
        }

        // --- 逻辑 2: 防具 (同部位互斥，戒指限2) ---
        else if (item.type === "armor") {
            const type = item.system.type;
            const limit = (type === "ring") ? 2 : 1; // 戒指上限2，其他1

            // 找到同部位已装备的
            const equippedArmor = actor.itemTypes.armor.filter(i => i.system.equipped && i.system.type === type);

            // 如果已满
            if (equippedArmor.length >= limit) {
                // 策略：卸下最早的一个 (数组第一个)
                // 如果戒指有2个，这里会卸下第1个，保留第2个，腾出位置给新戒指
                // 如果想做得更细(比如弹窗让用户选卸下哪个)，逻辑会复杂很多，这里采用自动替换
                updates.push({ _id: equippedArmor[0].id, "system.equipped": false });
            }
        }

        // --- 逻辑 3: 奇珍 (穴位选择与判定) ---
        else if (item.type === "qizhen") {
            // 1. 获取所有可用的穴位
            // 条件：(1) 经脉已打通 (2) 没有被其他已装备的奇珍占用
            const availableSlots = this._getAvailableAcupoints(actor);

            if (availableSlots.length === 0) {
                return ui.notifications.warn("没有可用的已打通穴位，或穴位已满。");
            }

            // 2. 弹窗让玩家选择
            const content = `
            <div class="form-group">
                <label>选择镶嵌穴位:</label>
                <div class="form-fields">
                    <!-- 【修复】增加 style="width: 100%; min-width: 250px;" -->
                    <select name="acupoint" style="width: 100%; min-width: 250px; height: 30px; font-size: 1.1em;">
                        ${availableSlots.map(slot => `<option value="${slot.key}">${slot.label}</option>`).join("")}
                    </select>
                </div>
                <p class="notes">只能镶嵌在已打通且为空的经脉穴位中。</p>
            </div>
          `;

            const result = await foundry.applications.api.DialogV2.prompt({
                window: { title: `装备: ${item.name}`, icon: "fas fa-gem" },
                content: content,
                ok: {
                    label: "储存",
                    callback: (event, button) => new FormData(button.form).get("acupoint")
                }
            });

            if (!result) return; // 用户取消

            // 奇珍特殊处理：装备时需要写入选定的 acupoint
            // 这里我们直接执行 update，不走下面的通用流程了
            await item.update({
                "system.equipped": true,
                "system.acupoint": result
            });
            ui.notifications.info(`已将 ${item.name} 储存至 ${game.i18n.localize(XJZL.acupoints[result])}`);
            return;
        }

        // --- 执行通用更新 (武器/防具) ---
        // 1. 先执行卸下旧装备 (如果有)
        if (updates.length > 0) {
            await actor.updateEmbeddedDocuments("Item", updates);
        }

        // 2. 再装备新物品
        await item.update({ "system.equipped": true });

        ui.notifications.info(`已装备 ${item.name}`);
    }

    /**
     * 辅助方法：获取当前角色可用的穴位列表
     */
    _getAvailableAcupoints(actor) {
        // 1. 统计已被占用的穴位
        const occupiedPoints = new Set();
        actor.itemTypes.qizhen.forEach(i => {
            if (i.system.equipped && i.system.acupoint) {
                occupiedPoints.add(i.system.acupoint);
            }
        });

        const available = [];
        const standardJingmai = actor.system.jingmai.standard;

        // 2. 遍历角色的十二正经数据
        for (const [key, isOpen] of Object.entries(standardJingmai)) {

            // 条件 A: 穴位已打通 (isOpen === true)
            // 条件 B: 穴位未被占用 (!has)
            if (isOpen && !occupiedPoints.has(key)) {

                // 从配置中获取中文 Label (如果配置里没有，这就显示 key)
                const labelKey = XJZL.acupoints[key] || key;

                available.push({
                    key: key,
                    label: game.i18n.localize(labelKey)
                });
            }
        }

        return available;
    }

    /**
    * 使用消耗品
    * 逻辑：扣除数量 -> 恢复资源 -> 应用互斥特效 -> 执行脚本
    */
    async _onUseConsumable(event, target) {
        const itemId = target.dataset.itemId;
        const item = this.document.items.get(itemId);
        if (!item || item.system.quantity <= 0) return;

        const actor = this.document;
        const config = item.system;
        const tags = []; // 用于聊天卡片显示的标签
        const resultLines = []; // 结果文本

        // 0. 预判是否会销毁
        const willDestroy = item.system.quantity <= 1;

        // 1. 恢复资源 (HP/MP/Rage)
        const updates = {};
        if (config.recovery) {
            for (const [key, val] of Object.entries(config.recovery)) {
                if (val && val !== 0) {
                    // 安全读取，防止 null
                    const current = actor.system.resources?.[key]?.value || 0;
                    const max = actor.system.resources?.[key]?.max || 999;
                    const newVal = Math.min(max, current + val);

                    if (newVal !== current) {
                        updates[`system.resources.${key}.value`] = newVal;
                        // 本地化 Label 查找 (简单的映射)
                        const labelMap = { hp: "气血", mp: "内力", rage: "怒气" };
                        resultLines.push(`${labelMap[key] || key} +${val}`);
                        tags.push("恢复");
                    }
                }
            }
        }
        if (!foundry.utils.isEmpty(updates)) await actor.update(updates);

        // 2. 应用特效 (互斥逻辑 + Origin 修正)
        const consumableType = config.type || "other";
        // 移除互斥旧特效
        const effectsToDelete = actor.effects
            .filter(e => e.getFlag("xjzl-system", "consumableType") === consumableType)
            .map(e => e.id);
        if (effectsToDelete.length > 0) await actor.deleteEmbeddedDocuments("ActiveEffect", effectsToDelete);

        // 创建新特效
        const effectsToCreate = item.effects.map(e => {
            const data = e.toObject();
            foundry.utils.setProperty(data, "flags.xjzl-system.consumableType", consumableType);
            data.transfer = false;

            // 如果物品将销毁，Origin 指向 Actor，否则指向 Item
            data.origin = willDestroy ? actor.uuid : item.uuid;

            return data;
        });

        if (effectsToCreate.length > 0) {
            await actor.createEmbeddedDocuments("ActiveEffect", effectsToCreate);
            resultLines.push(`应用状态: [${effectsToCreate.map(e => e.name).join(", ")}]`);
            tags.push("状态");
        }

        // 3. 执行脚本 (异步支持)
        let scriptOutput = "";
        if (config.usageScript && config.usageScript.trim()) {
            try {
                // 使用 AsyncFunction 构造器(异步支持)
                const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
                const fn = new AsyncFunction("actor", "item", config.usageScript);

                // 执行并等待
                const result = await fn(actor, item);
                if (typeof result === "string") scriptOutput = result; // 允许脚本返回文本用于显示
                tags.push("特殊效果");
            } catch (err) {
                console.error(err);
                ui.notifications.error(`脚本错误: ${err.message}`);
            }
        }

        // 4. 发送聊天卡片 (代替 ui.notifications)
        const templateData = {
            item: item,
            tags: tags,
            resultText: resultLines.join("，"),
            scriptOutput: scriptOutput
        };
        const content = await renderTemplate("systems/xjzl-system/templates/chat/item-card.hbs", templateData);

        ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            flavor: `${actor.name} 使用了 ${item.name}`,
            content: content
        });

        // 5. 扣除数量
        if (willDestroy) {
            await item.delete();
        } else {
            await item.update({ "system.quantity": item.system.quantity - 1 });
        }
    }

    /**
     * 阅读秘籍
     * 逻辑：检查目标 -> 复制创建 -> 消耗秘籍
     */
    async _onReadManual(event, target) {
        const itemId = target.dataset.itemId;
        const manual = this.document.items.get(itemId);
        if (!manual) return;

        const targetUuid = manual.system.learnItemUuid;
        if (!targetUuid) return ui.notifications.warn("这本秘籍是无字天书。");

        // 1. 获取目标物品
        let targetItem;
        try {
            targetItem = await fromUuid(targetUuid);
        } catch (err) {
            return ui.notifications.error("无法找到记载的武学。");
        }
        if (!targetItem) return ui.notifications.error("目标物品不存在。");

        // 2. 检查是否已学会 (【核心修复 C】使用 sourceId 判定)
        // 逻辑：检查背包里是否有物品的 sourceId 等于目标物品的 uuid
        const alreadyLearned = this.document.items.find(i => i.flags.core?.sourceId === targetUuid);

        if (alreadyLearned) {
            return ui.notifications.warn(`你已经学会了 ${targetItem.name}，无需重复阅读。`);
        }

        // 3. 学习
        const itemData = targetItem.toObject();
        delete itemData._id;
        delete itemData.folder;
        delete itemData.ownership;
        // 记录来源，以便下次查重
        foundry.utils.setProperty(itemData, "flags.core.sourceId", targetUuid);

        await this.document.createEmbeddedDocuments("Item", [itemData]);

        // 4. 发送聊天卡片
        const content = await renderTemplate("systems/xjzl-system/templates/chat/item-card.hbs", {
            item: manual, // 显示秘籍的信息
            tags: ["秘籍", targetItem.type === "neigong" ? "内功" : "武学"],
            resultText: `领悟了 <b>[${targetItem.name}]</b>`
        });

        ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this.document }),
            flavor: `${this.document.name} 阅读了 ${manual.name}`,
            content: content
        });

        // 5. 消耗
        if (manual.system.destroyOnUse) {
            if (manual.system.quantity > 1) {
                await manual.update({ "system.quantity": manual.system.quantity - 1 });
            } else {
                await manual.delete();
            }
        }
    }

    /**
     * 删除角色身上的特效
     */
    async _onDeleteEffect(event, target) {
        const effectId = target.dataset.id;
        const effect = this.document.effects.get(effectId);
        if (effect) {
            await effect.delete();
            ui.notifications.info(`已移除状态: ${effect.name}`);
        }
    }
}