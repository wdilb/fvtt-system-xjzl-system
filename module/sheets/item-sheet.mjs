/**
 * 先简单写一个让系统运行起来
 */
/* module/sheets/item-sheet.mjs */
const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["xjzl-window", "item", "neigong", "xjzl-system"],
    position: { width: 550, height: 700 }, // 稍微调宽一点
    window: { resizable: true },
    actions: {
      //增加圆满特效
      addMasteryChange: XJZLItemSheet.prototype._onAddMasteryChange,
      //删除圆满特效
      deleteMasteryChange: XJZLItemSheet.prototype._onDeleteMasteryChange
    }
  };

  static PARTS = {
    // 只有一个 main 部分，但我们要指定它是可滚动的
    main: { 
      template: "systems/xjzl-system/templates/item/neigong/sheet.hbs", 
      scrollable: [".scroll-area"] // 告诉 Foundry 哪个类名是滚动容器
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.document.system;
    
    // === 1. 准备本地化下拉菜单数据 ===
    // 我们需要把 key:value 传给 selectOptions
    context.elementChoices = {
        "yin": game.i18n.localize("XJZL.Neigong.ElementYin"), // "阴"
        "yang": game.i18n.localize("XJZL.Neigong.ElementYang"), // "阳"
        "taiji": game.i18n.localize("XJZL.Neigong.ElementTaiji") // "太极"
    };

    context.tierChoices = {
        1: game.i18n.localize("XJZL.Tiers.1"), // 人级
        2: game.i18n.localize("XJZL.Tiers.2"), // 地级
        3: game.i18n.localize("XJZL.Tiers.3")  // 天级
    };

    // === 2. 准备阶段数据 ===
    if (this.document.type === "neigong") {
        context.stages = [
            { id: 1, label: "XJZL.Neigong.Stage1", key: "stage1" },
            { id: 2, label: "XJZL.Neigong.Stage2", key: "stage2" },
            { id: 3, label: "XJZL.Neigong.Stage3", key: "stage3" }
        ];
    }
    
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // 绑定所有输入框的 change 事件以自动保存
    this.element.querySelectorAll("input, select, textarea").forEach(input => {
        input.addEventListener("change", (event) => {
            event.preventDefault();
            this.submit(); // 触发 AppV2 的提交逻辑
        });
    });
  }

  async _onAddMasteryChange(event, target) {
      // 获取当前数组
      const changes = this.document.system.masteryChanges || [];
      // 写入新数组 (追加一个空对象)
      await this.document.update({
          "system.masteryChanges": [...changes, { key: "", value: 0, label: "" }]
      });
  }

  async _onDeleteMasteryChange(event, target) {
      const index = Number(target.dataset.index);
      const changes = this.document.system.masteryChanges || [];
      
      // 移除指定索引的项
      const newChanges = changes.filter((_, i) => i !== index);
      await this.document.update({
          "system.masteryChanges": newChanges
      });
  }
}