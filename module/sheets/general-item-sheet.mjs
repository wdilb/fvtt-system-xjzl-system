/* module/sheets/general-item-sheet.mjs */
import { XJZL } from "../config.mjs";
import { localizeConfig } from "../utils/utils.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLGeneralItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "item", "general", "xjzl-system"],
        position: { width: 550, height: 600 },
        window: { resizable: true },
        actions: {
            // 特效操作 (仅消耗品需要)
            createEffect: XJZLGeneralItemSheet.prototype._onCreateEffect,
            editEffect: XJZLGeneralItemSheet.prototype._onEditEffect,
            deleteEffect: XJZLGeneralItemSheet.prototype._onDeleteEffect,
            toggleEffect: XJZLGeneralItemSheet.prototype._onToggleEffect
        }
    };

    static PARTS = {
        header: { template: "systems/xjzl-system/templates/item/general/header.hbs" },
        tabs: { template: "systems/xjzl-system/templates/item/general/tabs.hbs" },
        details: { template: "systems/xjzl-system/templates/item/general/tab-details.hbs", scrollable: [".scroll-area"] },
        effects: { template: "systems/xjzl-system/templates/item/general/tab-effects.hbs", scrollable: [".scroll-area"] }
    };

    tabGroups = { primary: "details" };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.system = this.document.system;
        context.tabs = this.tabGroups;

        context.isConsumable = this.document.type === "consumable";
        context.isManual = this.document.type === "manual";
        context.isMisc = this.document.type === "misc";

        // 1. 通用品质
        context.qualityChoices = localizeConfig(XJZL.qualities);

        // 2. 秘籍专用品阶
        if (context.isManual) {
            context.tierChoices = localizeConfig(XJZL.tiers);
        }

        // 仅消耗品需要类型选择
        if (context.isConsumable) {
            context.consumableTypes = localizeConfig(XJZL.consumableTypes);

            // 准备特效列表
            context.effects = this.document.effects.map(e => ({
                id: e.id, name: e.name, img: e.img, disabled: e.disabled,
                transfer: e.transfer
            }));
        }

        // 秘籍: 解析 UUID 对应的物品名字 (为了显示好看)
        if (context.isManual && context.system.learnItemUuid) {
            const targetItem = await fromUuid(context.system.learnItemUuid);
            context.targetItemName = targetItem ? targetItem.name : "未知物品 (可能已删除)";
        }

        return context;
    }

    /* 自动保存 */
    _onRender(context, options) {
        super._onRender(context, options);
        if (!this.element.dataset.delegated) {
            this.element.addEventListener("change", (e) => {
                if (e.target.matches("input, select, textarea")) {
                    e.preventDefault();
                    this.submit();
                }
            });
            this.element.dataset.delegated = "true";
        }

        // 秘籍拖拽监听
        if (context.isManual) {
            const dropZone = this.element.querySelector(".manual-drop-zone");
            if (dropZone) {
                dropZone.addEventListener("drop", this._onDropManualTarget.bind(this));
                // 必须阻止 dragover 默认行为，否则 drop 不会触发
                dropZone.addEventListener("dragover", (e) => e.preventDefault());
            }
        }
    }

    /**
   * 处理秘籍目标拖拽
   */
  async _onDropManualTarget(event) {
      event.preventDefault();
      // 获取拖拽数据
      const data = TextEditor.getDragEventData(event);
      if (data.type !== "Item") return;

      const item = await Item.implementation.fromDropData(data);
      if (!item) return;

      // 逻辑判断：只允许内功和武学
      if (!["neigong", "wuxue"].includes(item.type)) {
          return ui.notifications.warn("秘籍只能记载【内功】或【武学】。");
      }

      // 逻辑判断：目前只支持单本 (覆盖旧的)
      
      // 自动更新品阶
      // 如果是高阶武学，秘籍自然也是高阶
      // item.system.tier 对应 1, 2, 3
      const newTier = item.system.tier || 1;

      await this.document.update({
          "system.learnItemUuid": item.uuid,
          "system.tier": newTier,
          "img": item.img, // 可选：把秘籍图标变成武学图标，或者保持书本图标
          "name": `${item.name} 秘籍` // 可选：自动改名
      });
  }

    /* 特效逻辑 (消耗品专用) */
    async _onCreateEffect(event, target) {
        return ActiveEffect.create({
            name: "新状态",
            icon: "icons/svg/potion.svg",
            origin: this.document.uuid,
            // 消耗品的特效通常不是 Transfer (被动)，而是使用时触发
            // 但也可以做成 Transfer (只要放在包里就生效？通常不是)
            // 按照逻辑，消耗品应该是 transfer: false (触发式)
            transfer: false
        }, { parent: this.document });
    }
    async _onEditEffect(event, target) {
        this.document.effects.get(target.dataset.id)?.sheet.render(true);
    }
    async _onDeleteEffect(event, target) {
        this.document.effects.get(target.dataset.id)?.delete();
    }
    async _onToggleEffect(event, target) {
        const effect = this.document.effects.get(target.dataset.id);
        if (effect) effect.update({ disabled: !effect.disabled });
    }
}