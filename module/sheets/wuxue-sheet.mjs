/**
 * 武学物品表单
 */
import { XJZL } from "../config.mjs";
import { localizeConfig } from "../utils/utils.mjs"; // 引入工具函数

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
        
        // 嵌套数组操作 (属性加成)
        addScaling: XJZLWuxueSheet.prototype._onAddScaling,
        deleteScaling: XJZLWuxueSheet.prototype._onDeleteScaling,

        // 嵌套数组操作 (特效引用)
        addEffectRef: XJZLWuxueSheet.prototype._onAddEffectRef,
        deleteEffectRef: XJZLWuxueSheet.prototype._onDeleteEffectRef,

        // 特效Tab操作
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

    // 1. 准备下拉菜单选项(使用工具函数)
    context.choices = {
        tiers: localizeConfig(XJZL.tiers),
        categories: localizeConfig(XJZL.wuxueCategories),
        moveTypes: localizeConfig(XJZL.moveTypes),
        elements: localizeConfig(XJZL.elements),
        attributes: localizeConfig(XJZL.attributes),
        weaponTypes: localizeConfig(XJZL.weaponTypes),
        triggers: localizeConfig(XJZL.effectTriggers),
        targets: localizeConfig(XJZL.effectTargets)
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

    // 3. 计算当前最大层级 (用于渲染消耗表的列数)
    // 逻辑：天级=4，其他人级/地级=3 (简单判定)
    context.maxMoveLevels = (context.system.tier === 3) ? [0, 1, 2, 3] : [0, 1, 2];
    context.levelLabels = (context.system.tier === 3) 
        ? ["领悟", "掌握", "精通", "合一"] 
        : ["领悟", "掌握", "精通"];

    return context;
  }

  /* -------------------------------------------- */
  /*  自动保存 (Auto-Save)                        */
  /* -------------------------------------------- */
  _onRender(context, options) {
    super._onRender(context, options);
    // 【优化】只给 form 根元素绑定一次监听器
    // 利用事件冒泡机制，捕获所有子元素的 change 事件
    if (!this.element.dataset.delegated) {
        this.element.addEventListener("change", (event) => {
            const target = event.target;
            // 只处理输入控件
            if (target.matches("input, select, textarea")) {
                // event.preventDefault(); // change 事件通常不需要 preventDefault
                this.submit();
            }
        });
        // 标记已绑定，防止重复
        this.element.dataset.delegated = "true";
    }
  }

  /* -------------------------------------------- */
  /*  嵌套数组操作                  */
  /* -------------------------------------------- */

  // 通用辅助：获取招式和索引
  _getMove(target) {
      const index = Number(target.closest("[data-move-index]").dataset.moveIndex);
      const source = this.document.system.toObject();
      const moves = source.moves || [];
      return { index, moves, move: moves[index] };
  }

  // --- 属性加成 (Scalings) ---
  async _onAddScaling(event, target) {
      const { index, moves, move } = this._getMove(target);
      // 向该招式的 scalings 数组追加
      move.calculation.scalings.push({ prop: "liliang", ratio: 0.5 });
      await this.document.update({ "system.moves": moves });
  }

  async _onDeleteScaling(event, target) {
      const { index, moves, move } = this._getMove(target);
      const scalingIndex = Number(target.dataset.idx);
      // 删除指定索引
      move.calculation.scalings.splice(scalingIndex, 1);
      await this.document.update({ "system.moves": moves });
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

    // --- 特效引用 (Effect Refs) ---
  async _onAddEffectRef(event, target) {
      const { index, moves, move } = this._getMove(target);
      // 向该招式的 applyEffects 数组追加对象
      move.applyEffects.push({ key: "", trigger: "hit", target: "target" });
      await this.document.update({ "system.moves": moves });
  }

  async _onDeleteEffectRef(event, target) {
      const { index, moves, move } = this._getMove(target);
      const effectIndex = Number(target.dataset.idx);
      move.applyEffects.splice(effectIndex, 1);
      await this.document.update({ "system.moves": moves });
  }
}