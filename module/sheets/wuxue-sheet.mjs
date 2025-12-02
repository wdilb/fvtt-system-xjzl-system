/**
 * 武学物品表单
 */
import { XJZL } from "../../config.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLWuxueSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["xjzl-window", "item", "wuxue", "xjzl-system"],
    position: { width: 700, height: 800 }, // 武学卡需要宽一点
    window: { resizable: true },
    actions: {
        // 招式操作
        addMove: XJZLWuxueSheet.prototype._onAddMove,
        deleteMove: XJZLWuxueSheet.prototype._onDeleteMove,
        
        // 特效操作 (Active Effects)
        createEffect: XJZLWuxueSheet.prototype._onCreateEffect,
        editEffect: XJZLWuxueSheet.prototype._onEditEffect,
        deleteEffect: XJZLWuxueSheet.prototype._onDeleteEffect,
        toggleEffect: XJZLWuxueSheet.prototype._onToggleEffect
    }
  };

  static PARTS = {
    header:  { template: "systems/xjzl-system/templates/item/wuxue/header.hbs" },
    tabs:    { template: "systems/xjzl-system/templates/item/wuxue/tabs.hbs" },
    
    // 内容 Parts
    details: { template: "systems/xjzl-system/templates/item/wuxue/tab-details.hbs", scrollable: [""] },
    effects: { template: "systems/xjzl-system/templates/item/wuxue/tab-effects.hbs", scrollable: [""] }
  };

  tabGroups = { primary: "details" };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.document.system;
    context.tabs = this.tabGroups;

    // 1. 准备下拉菜单选项
    // Helper: 将 Config 对象转换为本地化后的对象
    // 输入: { key: "Loc.Key" } -> 输出: { key: "中文" }
    const localizeConfig = (config) => {
        const localized = {};
        for (const [key, labelKey] of Object.entries(config)) {
            localized[key] = game.i18n.localize(labelKey);
        }
        return localized;
    };
    context.choices = {
        tiers: localizeConfig(XJZL.tiers),
        categories: localizeConfig(XJZL.wuxueCategories),
        moveTypes: localizeConfig(XJZL.moveTypes),
        elements: localizeConfig(XJZL.elements),
        attributes: localizeConfig(XJZL.attributes)
    };

    // 2. 准备特效列表 (用于 Effects Tab)
    // 区分：被动(Temporary=false) 和 临时/触发(Temporary=true/transfer=false)
    // 这里简单地全部列出
    context.effects = this.document.effects.map(e => {
        return {
            id: e.id,
            name: e.name,
            img: e.img,
            disabled: e.disabled,
            description: e.description,
            isSuppressed: e.isSuppressed // V11+ 特性
        };
    });

    return context;
  }

  /* -------------------------------------------- */
  /*  自动保存 (Auto-Save)                        */
  /* -------------------------------------------- */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll("input, select, textarea").forEach(input => {
        if (input.dataset.hasChangeListener) return;
        input.addEventListener("change", (e) => { e.preventDefault(); this.submit(); });
        input.dataset.hasChangeListener = "true";
    });
  }

  /* -------------------------------------------- */
  /*  Moves Logic (招式管理)                      */
  /* -------------------------------------------- */

  async _onAddMove(event, target) {
      const source = this.document.system.toObject();
      const moves = source.moves || [];
      
      // 创建新招式默认数据
      const newMove = {
          id: foundry.utils.randomID(),
          name: "新招式",
          img: "icons/svg/sword.svg",
          type: "real",
          costs: { mp: [], rage: [], hp: [] },
          applyEffects: [],
          calculation: { scalings: [] }
      };

      await this.document.update({
          "system.moves": [...moves, newMove]
      });
  }

  async _onDeleteMove(event, target) {
      const moveId = target.dataset.id;
      const source = this.document.system.toObject();
      const moves = source.moves || [];
      
      // 按 ID 过滤
      const newMoves = moves.filter(m => m.id !== moveId);
      
      // 确认弹窗
      const confirm = await foundry.applications.api.DialogV2.confirm({
          window: { title: "删除招式" },
          content: "<p>确定要删除这个招式吗？</p>",
          rejectClose: false
      });

      if (confirm) {
          await this.document.update({ "system.moves": newMoves });
      }
  }

  /* -------------------------------------------- */
  /*  Active Effects Logic (特效管理)             */
  /* -------------------------------------------- */

  async _onCreateEffect(event, target) {
      // 创建一个新的 AE 文档嵌入到此 Item
      return ActiveEffect.create({
          name: "新特效",
          icon: "icons/svg/aura.svg",
          origin: this.document.uuid,
          // 默认为不自动应用 (transfer=false)，因为这是给招式触发用的
          transfer: false 
      }, { parent: this.document });
  }

  async _onEditEffect(event, target) {
      const effectId = target.dataset.id;
      const effect = this.document.effects.get(effectId);
      if (effect) effect.sheet.render(true);
  }

  async _onDeleteEffect(event, target) {
      const effectId = target.dataset.id;
      const effect = this.document.effects.get(effectId);
      if (effect) await effect.delete();
  }

  async _onToggleEffect(event, target) {
      const effectId = target.dataset.id;
      const effect = this.document.effects.get(effectId);
      if (effect) await effect.update({ disabled: !effect.disabled });
  }
}