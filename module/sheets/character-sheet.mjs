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
        //投入修为
        investXP: XJZLCharacterSheet.prototype._onInvestXP,
        //编辑物品
        editItem: XJZLCharacterSheet.prototype._onEditItem,
        //删除物品
        deleteItem: XJZLCharacterSheet.prototype._onDeleteItem,
        //返回投入的修为
        refundXP: XJZLCharacterSheet.prototype._onRefundXP
    }
  };

  static PARTS = {
    header:      { template: "systems/xjzl-system/templates/actor/character/header.hbs" },
    tabs:        { template: "systems/xjzl-system/templates/actor/character/tabs.hbs" },
    // 内容 Parts
    stats:       { template: "systems/xjzl-system/templates/actor/character/tab-stats.hbs", scrollable: [""] },
    cultivation: { template: "systems/xjzl-system/templates/actor/character/tab-cultivation.hbs", scrollable: [""] },
    jingmai:     { template: "systems/xjzl-system/templates/actor/character/tab-jingmai.hbs", scrollable: [""] },
    skills:      { template: "systems/xjzl-system/templates/actor/character/tab-skills.hbs", scrollable: [""] },
    combat:      { template: "systems/xjzl-system/templates/actor/character/tab-combat.hbs", scrollable: [""] }
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

    context.skillGroups = [
        { label: "XJZL.Stats.Liliang", skills: ["jiaoli", "zhengtuo", "paozhi", "qinbao"] },
        { label: "XJZL.Stats.Shenfa", skills: ["qianxing", "qiaoshou", "qinggong", "mashu"] },
        { label: "XJZL.Stats.Tipo", skills: ["renxing", "biqi", "rennai", "ningxue"] },
        { label: "XJZL.Stats.Neixi", skills: ["liaoshang", "chongxue", "lianxi", "duqi"] },
        { label: "XJZL.Stats.Qigan", skills: ["dianxue", "zhuizong", "tancha", "dongcha"] },
        { label: "XJZL.Stats.Shencai", skills: ["jiaoyi", "qiman", "shuofu", "dingli"] },
        { label: "XJZL.Stats.Wuxing", skills: ["wuxue", "jianding", "bagua", "shili"] }
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

    // 查找所有输入框，绑定 change 事件
    this.element.querySelectorAll("input, select, textarea").forEach(input => {
        // 防止重复绑定 (AppV2可能会多次调用_onRender)
        if (input.dataset.hasChangeListener) return;
        
        input.addEventListener("change", this._onChangeInput.bind(this));
        input.dataset.hasChangeListener = "true";
    });
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

  // 新增：删除物品逻辑
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
        // ... (保持之前的逻辑不变) ...
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
            await this.document.update({"system.martial.active_neigong": itemId});
        } else {
            await this.document.update({"system.martial.active_neigong": ""});
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
}