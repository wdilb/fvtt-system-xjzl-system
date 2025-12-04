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