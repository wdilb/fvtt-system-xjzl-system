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

            // --- 其他 ---
            deleteEffect: XJZLCharacterSheet.prototype._onDeleteEffect,
            rollMove: XJZLCharacterSheet.prototype._onRollMove
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
        inventory: { template: "systems/xjzl-system/templates/actor/character/tab-inventory.hbs", scrollable: [".scroll-area"] },
        effects: { template: "systems/xjzl-system/templates/actor/character/tab-effects.hbs", scrollable: [""] }
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

        return context;
    }

    /* -------------------------------------------- */
    /*  事件监听与自动保存                           */
    /* -------------------------------------------- */

    _onRender(context, options) {
        super._onRender(context, options);

        if (!this.element.dataset.delegated) {
            this.element.addEventListener("change", (event) => {
                const target = event.target;
                if (target.matches("input, select, textarea")) {
                    this.submit();
                }
            });
            this.element.dataset.delegated = "true";
        }
    }

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
     * 通用数值输入弹窗
     * @param {Object} options
     * @returns {Promise<number|null>} 返回输入的数字，取消返回 null
     */
    async _promptForValue({ title, icon = "fas fa-edit", label = "数量", value = 0, hint = "" } = {}) {
        const content = `
        <div style="text-align:center; padding: 10px;">
            ${hint ? `<p style="margin-bottom:10px; font-size:1.1em;">${hint}</p>` : ""}
            <div style="display:flex; flex-direction:column; gap:5px;">
                <label style="font-weight:bold;">${label}</label>
                <input name="amount" type="number" value="${value}" autofocus 
                       style="text-align:center; font-size:1.5em; width:100%; color:black; background:rgba(255,255,255,0.9); border:1px solid #333;"/>
            </div>
        </div>`;

        const result = await foundry.applications.api.DialogV2.prompt({
            window: { title, icon },
            content: content,
            ok: {
                label: "确定",
                icon: "fas fa-check",
                // 直接通过 Form Data 获取，不再依赖 ID
                callback: (event, button) => new FormData(button.form).get("amount")
            },
            rejectClose: false
        });

        if (!result) return null;
        return parseInt(result);
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

    // --- 修炼系统 (使用 _promptForValue 简化) ---

    async _onInvestXP(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;
        const needed = item.system.progressData.absoluteMax - item.system.xpInvested;

        if (needed <= 0) return ui.notifications.warn("已圆满。");

        const amount = await this._promptForValue({
            title: `修炼: ${item.name}`,
            icon: "fas fa-arrow-up",
            value: 100,
            hint: `距离圆满还需: <b>${needed}</b>`
        });

        if (amount) await item.investNeigong(amount);
    }

    async _onRefundXP(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;

        const amount = await this._promptForValue({
            title: `回退: ${item.name}`,
            icon: "fas fa-undo",
            value: item.system.xpInvested,
            hint: `<span style="color:#ff4444;">⚠️ 返还修为并降低境界</span><br>当前投入: <b>${item.system.xpInvested}</b>`,
            label: "回退数量"
        });

        if (amount) await item.refundNeigong(amount);
    }

    async _onInvestMoveXP(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        const moveId = target.dataset.moveId;
        if (!item) return;
        const move = item.system.moves.find(m => m.id === moveId);
        if (!move) return;

        const needed = move.progress.max - move.progress.current;

        const amount = await this._promptForValue({
            title: `修炼招式: ${move.name}`,
            icon: "fas fa-arrow-up",
            value: needed,
            hint: `本级还需: <b>${needed}</b>`
        });

        if (amount) await item.investMove(moveId, amount);
    }

    async _onRefundMoveXP(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        const moveId = target.dataset.moveId;
        if (!item) return;
        const move = item.system.moves.find(m => m.id === moveId);
        if (!move) return;

        const amount = await this._promptForValue({
            title: `回退: ${move.name}`,
            icon: "fas fa-undo",
            value: move.xpInvested,
            hint: `可退还: <b>${move.xpInvested}</b>`,
            label: "回退数量"
        });

        if (amount) await item.refundMove(moveId, amount);
    }

    // --- 其他 ---

    async _onToggleSubTab(event, target) {
        this._cultivationSubTab = target.dataset.target;
        this.render();
    }

    async _onRollMove(event, target) {
        // 后续将在 Item 中实现 rollMove
        ui.notifications.info("招式施放功能即将实装！");
    }

    async _onDeleteEffect(event, target) {
        const effect = this.document.effects.get(target.dataset.id);
        if (effect) {
            await effect.delete();
            ui.notifications.info(`已移除状态: ${effect.name}`);
        }
    }
}