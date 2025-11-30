/**
 * 先简单写一个让系统运行起来
 */
/**
 * 侠界之旅 - 物品卡 V2
 * 采用 ActorSheet 验证成功的架构
 */
const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    // 关键：添加 neigong 类 (暂且假设所有物品都是内功，未来可以用JS动态判断添加class)
    classes: ["xjzl-window", "item", "neigong", "xjzl-system"],
    position: { width: 600, height: 700 },
    window: { resizable: true },
    actions: {}
  };

  static PARTS = {
    // 暂时所有物品都用这个模板，未来在此根据 type 判断
    main: { template: "systems/xjzl-system/templates/item/neigong/sheet.hbs", scrollable: [".scroll-area"] }
  };

  tabGroups = { primary: "config" };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.document.system;
    
    // 准备内功阶段数据
    if (this.document.type === "neigong") {
        context.stages = [
            { id: 1, label: "XJZL.Neigong.Stage1", key: "stage1" },
            { id: 2, label: "XJZL.Neigong.Stage2", key: "stage2" },
            { id: 3, label: "XJZL.Neigong.Stage3", key: "stage3" }
        ];
    }
    return context;
  }
}