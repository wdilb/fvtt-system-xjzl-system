/**
 * 先简单写一个让系统运行起来
 */
/* module/sheets/item-sheet.mjs */
const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLNeigongSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["xjzl-window", "item", "neigong", "xjzl-system"],
    position: { width: 550, height: 700 },
    window: { resizable: true },
    actions: {
        addMasteryChange: XJZLNeigongSheet.prototype._onAddMasteryChange,
        deleteMasteryChange: XJZLNeigongSheet.prototype._onDeleteMasteryChange
    }
  };

  static PARTS = {
    main: { 
      template: "systems/xjzl-system/templates/item/neigong/sheet.hbs", 
      scrollable: [".scroll-area"] 
    }
  };

  /* -------------------------------------------- */
  /*  数据准备                                    */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.document.system;
    
    // 1. 本地化下拉菜单
    context.elementChoices = {
        "yin": game.i18n.localize("XJZL.Neigong.ElementYin"),
        "yang": game.i18n.localize("XJZL.Neigong.ElementYang"),
        "taiji": game.i18n.localize("XJZL.Neigong.ElementTaiji")
    };

    context.tierChoices = {
        1: game.i18n.localize("XJZL.Tiers.1"),
        2: game.i18n.localize("XJZL.Tiers.2"),
        3: game.i18n.localize("XJZL.Tiers.3")
    };

    // 2. 内功阶段配置
    if (this.document.type === "neigong") {
        context.stages = [
            { id: 1, label: "XJZL.Neigong.Stage1", key: "stage1" },
            { id: 2, label: "XJZL.Neigong.Stage2", key: "stage2" },
            { id: 3, label: "XJZL.Neigong.Stage3", key: "stage3" }
        ];
    }
    
    return context;
  }

  /* -------------------------------------------- */
  /*  生命周期与事件监听                          */
  /* -------------------------------------------- */

  /**
   * 自动保存逻辑
   * AppV2 默认不监听 input change，我们需要手动触发 submit
   */
  _onRender(context, options) {
    super._onRender(context, options);
    
    // 查找所有输入框
    this.element.querySelectorAll("input, select, textarea").forEach(input => {
        // 避免重复绑定
        if (input.dataset.hasChangeListener) return;
        
        input.addEventListener("change", (event) => {
            event.preventDefault();
            this.submit(); // 触发保存
        });
        input.dataset.hasChangeListener = "true";
    });
  }

  /* -------------------------------------------- */
  /*  Action Handlers (动作处理)                  */
  /* -------------------------------------------- */

  /**
   * 动作: 添加一行圆满修正
   */
  async _onAddMasteryChange(event, target) {
      // 获取当前数组，如果是 undefined 则初始化为空数组
      const changes = this.document.system.masteryChanges || [];
      
      // 更新数据：追加一个新的空对象
      await this.document.update({
          "system.masteryChanges": [
              ...changes, 
              { key: "", value: 0, label: "" }
          ]
      });
      // AppV2 会自动重新渲染界面
  }

  /**
   * 动作: 删除一行圆满修正
   */
  async _onDeleteMasteryChange(event, target) {
      const index = Number(target.dataset.index);
      const changes = this.document.system.masteryChanges || [];
      
      // 过滤掉指定索引的项
      const newChanges = changes.filter((_, i) => i !== index);
      
      await this.document.update({
          "system.masteryChanges": newChanges
      });
  }
}