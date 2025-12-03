/**
 * 先简单写一个让系统运行起来
 */
/* module/sheets/actor-sheet.mjs */
const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

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
            toggleEquip: XJZLCharacterSheet.prototype._onToggleEquip
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
        inventory: { template: "systems/xjzl-system/templates/actor/character/tab-inventory.hbs", scrollable: [".scroll-area"] }
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
                let scriptBonus = 0;

                // --- G. 执行招式脚本 (Script Preview) ---
                if (move.script && move.script.trim()) {
                    if (actor.system.resources && actor.system.stats) {
                        const out = { damage: totalDmg };
                        try {
                            const fn = new Function("actor", "S", "out", "t", "targets", "item", "rollData", move.script);
                            fn(actor, actor.system, out, dummyTarget, dummyTargetsArray, wuxue, {});
                            totalDmg = Math.floor(out.damage);
                            scriptBonus = totalDmg - preScriptDmg;
                        } catch (err) { /* Ignore in preview */ }
                    }
                }

                // --- H. 挂载显示 (详细拆解) ---
                let breakdownText = `招式本身伤害: ${moveBaseDmg}\n`;
                breakdownText += `+ 武器伤害: ${weaponDmg}\n`;
                breakdownText += `+ 武器等级增伤: ${weaponDmgBonus}\n`;
                breakdownText += `+ 属性增伤: ${Math.floor(attrBonus)}\n`;
                breakdownText += `+ 其他增伤: ${flatBonus}`;

                if (scriptBonus !== 0) {
                    const sign = scriptBonus > 0 ? "+" : "";
                    breakdownText += `\n${sign} 特效增伤: ${scriptBonus}`;
                }

                // 如果有武器但没装备，给个醒目提示
                if (!isWeaponMatch && move.weaponType && move.weaponType !== 'none' && move.weaponType !== 'unarmed') {
                    breakdownText += `\n(⚠️ 未装备匹配武器)`;
                }

                // 木桩说明
                breakdownText += `\n\n------------------\n注: 预估基于100气血/100内力/0怒气\n无内功和招式抗性的标准木桩`;

                move.derived = {
                    damage: totalDmg,
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
            { label: "TYPES.Item.consumable", type: "consumable", items: actor.itemTypes.consumable || [] } // 预留
        ];

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

      const isEquipping = !item.system.equipped; // 目标状态

      // === 特殊逻辑：奇珍 (Qizhen) ===
      if (item.type === "qizhen" && isEquipping) {
          const acupoint = item.system.acupoint;
          
          // 1. 检查穴位是否配置
          if (!acupoint) {
              return ui.notifications.warn("该奇珍未指定穴位，无法装备。请在物品详情中设置。");
          }

          // 2. 检查穴位是否打通 (Jingmai)
          // 假设 jingmai 结构是 system.jingmai.standard.hand_shaoyin = true
          // 我们需要遍历 standard 和 extra 来找
          const jingmai = this.document.system.jingmai;
          let isOpen = false;
          
          if (jingmai.standard && jingmai.standard.hasOwnProperty(acupoint)) {
              isOpen = jingmai.standard[acupoint];
          } else if (jingmai.extra && jingmai.extra.hasOwnProperty(acupoint)) {
              isOpen = jingmai.extra[acupoint];
          }

          if (!isOpen) {
              return ui.notifications.warn(`穴位 [${acupoint}] 尚未打通，无法装备此奇珍！`);
          }

          // 3. 检查该穴位是否已被占用 (可选，严格模式)
          const existing = this.document.itemTypes.qizhen.find(
              i => i.system.equipped && i.system.acupoint === acupoint && i.id !== itemId
          );
          if (existing) {
              return ui.notifications.warn(`穴位 [${acupoint}] 已装备了 [${existing.name}]，请先卸下。`);
          }
      }

      // 执行更新
      await item.update({ "system.equipped": isEquipping });
      
      // 提示
      if (isEquipping) ui.notifications.info(`已装备 ${item.name}`);
  }
}