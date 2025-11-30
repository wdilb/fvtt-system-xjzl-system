/**
 * 先简单写一个让系统运行起来
 */
/* module/sheets/actor-sheet.mjs */
const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["xjzl-window", "actor", "character", "xjzl-system"],
    position: { width: 900, height: 800 },
    window: { resizable: true },
    actions: {
        toggleNeigong: XJZLActorSheet.prototype._onToggleNeigong,
        investXP: XJZLActorSheet.prototype._onInvestXP
    }
  };

  static PARTS = {
    header:      { template: "systems/xjzl-system/templates/actor/character/header.hbs" },
    tabs:        { template: "systems/xjzl-system/templates/actor/character/tabs.hbs" },
    // 内容 Parts
    stats:       { template: "systems/xjzl-system/templates/actor/character/tab-stats.hbs", scrollable: [""] },
    cultivation: { template: "systems/xjzl-system/templates/actor/character/tab-cultivation.hbs", scrollable: [""] },
    jingmai:     { template: "systems/xjzl-system/templates/actor/character/tab-jingmai.hbs", scrollable: [""] },
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
  /*  Actions                                     */
  /* -------------------------------------------- */

  async _onToggleNeigong(event, target) {
      const itemId = target.dataset.itemId;
      const item = this.document.items.get(itemId);
      if (item) await item.update({ "system.active": !item.system.active });
  }

  async _onInvestXP(event, target) {
      const itemId = target.dataset.itemId;
      const item = this.document.items.get(itemId);
      if (!item) return;
      const input = await foundry.applications.api.DialogV2.prompt({
          window: { title: "修炼内功" },
          content: "<p>投入多少通用修为?</p><input type='number' name='xp' value='100' autofocus>",
          ok: { label: "投入", callback: (event, button, form) => form.xp.value }
      });
      if (input) {
          const amount = parseInt(input);
          if (this.document.system.cultivation.general >= amount) {
              await this.document.update({"system.cultivation.general": this.document.system.cultivation.general - amount});
              await item.update({"system.xpInvested": item.system.xpInvested + amount});
          } else {
              ui.notifications.warn("通用修为不足！");
          }
      }
  }
}