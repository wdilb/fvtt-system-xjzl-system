/**
 * 先简单写一个让系统运行起来
 */
const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["xjzl", "sheet", "item"],
    position: { width: 600, height: 550 }, // 稍微调高一点
    form: {
      submitOnChange: true,
      closeOnSubmit: false
    },
    window: {
      resizable: true,
      controls: []
    },
    actions: {
      editImage: this._onEditImage // 绑定图片编辑动作
    }
  };

  static PARTS = {
    form: {
      template: "systems/xjzl-system/templates/item/item-sheet.hbs",
      scrollable: [".sheet-body"]
    }
  };

  /**
   * 准备数据给模板
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    
    // === 关键修正 ===
    // 必须显式把 document 挂载为 'item'，模板才能用 {{item.name}}
    context.item = this.document;
    context.system = this.document.system;
    
    // 挂载权限信息
    context.isGM = game.user.isGM;
    context.editable = this.isEditable;
    
    console.log("Item Sheet Data:", context); // 调试看这里
    
    return context;
  }

  /**
   * 图片点击编辑逻辑 (V13 需要手动实现)
   */
  static async _onEditImage(event, target) {
    const item = this.document;
    if (!this.isEditable) return;

    const current = item.img;
    const fp = new FilePicker({
      type: "image",
      current: current,
      callback: path => {
        item.update({img: path});
      }
    });
    return fp.browse();
  }
}