/**
 * 先简单写一个让系统运行起来
 */
const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * 玩家角色卡片 (V13 ApplicationV2 + Handlebars)
 */
export class XJZLActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  
  /**
   * 定义界面组成部分 (Parts)
   * 必须定义，HandlebarsMixin 会根据这里配置的路径去加载模板
   */
  static PARTS = {
    form: {
      template: "systems/xjzl-system/templates/actor/character-sheet.hbs",
      scrollable: [".sheet-body"] // 指定哪个区域可以滚动
    }
  };

  /**
   * V2 核心配置
   */
  static DEFAULT_OPTIONS = {
    tag: "form", // 告诉系统外层包裹 <form> 标签
    classes: ["xjzl", "sheet", "actor"],
    position: { width: 800, height: 800 },
    form: {
      submitOnChange: true,  // 修改数据即自动保存
      closeOnSubmit: false
    },
    window: {
      resizable: true,
      minimizable: true,
      controls: [] // 窗口标题栏按钮
    },
    // 定义按钮动作映射 (data-action="xxx")
    actions: {
      editItem: this._onEditItem,
      deleteItem: this._onDeleteItem,
      createItem: this._onCreateItem
    }
  };

  /**
   * 准备渲染数据 (Context)
   * 替代了旧版的 getData
   * @returns {Promise<object>} 传递给 Handlebars 的数据对象
   */
  async _prepareContext(options) {
    // 获取父类准备的基础数据
    const context = await super._prepareContext(options);
    
    // V2 中，this.document 指向当前 Actor 实例
    const actor = this.document;
    
    // 将数据挂载到 context 上
    context.actor = actor;
    context.system = actor.system;
    context.flags = actor.flags;
    
    // 添加一些辅助标记
    context.isGM = game.user.isGM;

    // 调试日志 (确认数据结构)
    console.log("Sheet Context:", context);

    return context;
  }

  /* -------------------------------------------- */
  /*  事件处理 (Event Handlers)                   */
  /* -------------------------------------------- */

  /**
   * 处理创建物品
   * 触发: <a data-action="createItem" data-type="...">
   */
  static async _onCreateItem(event, target) {
    const type = target.dataset.type || "item";
    const name = `新${type}`; // 例如: 新neigong
    const itemData = {
      name: name,
      type: type,
      img: "icons/svg/item-bag.svg" // 默认图标
    };
    await this.document.createEmbeddedDocuments("Item", [itemData]);
  }

  /**
   * 处理编辑物品
   * 触发: <a data-action="editItem" data-item-id="...">
   */
  static async _onEditItem(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if (item) item.sheet.render(true);
  }

  /**
   * 处理删除物品
   * 触发: <a data-action="deleteItem" data-item-id="...">
   */
  static async _onDeleteItem(event, target) {
    const itemId = target.dataset.itemId;
    const item = this.document.items.get(itemId);
    if (item) {
        // 使用 V2 风格的确认弹窗
        const confirm = await foundry.applications.api.DialogV2.confirm({
            content: `确定要删除 <strong>${item.name}</strong> 吗？`,
            modal: true,
            rejectClose: false
        });
        if (confirm) item.delete();
    }
  }
}