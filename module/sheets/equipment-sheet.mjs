import { XJZL } from "../config.mjs";
import { localizeConfig } from "../utils/utils.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLEquipmentSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        // 添加 equipment 类，方便 CSS 定位
        classes: ["xjzl-window", "item", "equipment", "xjzl-system"],
        position: { width: 550, height: 650 },
        window: { resizable: true },
        actions: {
            createEffect: XJZLEquipmentSheet.prototype._onCreateEffect,
            editEffect: XJZLEquipmentSheet.prototype._onEditEffect,
            deleteEffect: XJZLEquipmentSheet.prototype._onDeleteEffect,
            toggleEffect: XJZLEquipmentSheet.prototype._onToggleEffect
        }
    };

    static PARTS = {
        header: { template: "systems/xjzl-system/templates/item/equipment/header.hbs" },
        tabs: { template: "systems/xjzl-system/templates/item/equipment/tabs.hbs" },
        details: { template: "systems/xjzl-system/templates/item/equipment/tab-details.hbs", scrollable: [".scroll-area"] },
        effects: { template: "systems/xjzl-system/templates/item/equipment/tab-effects.hbs", scrollable: [".scroll-area"] }
    };

    tabGroups = { primary: "details" };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.system = this.document.system;
        context.tabs = this.tabGroups;

        // 方便模板判断类型
        context.isWeapon = this.document.type === "weapon";
        context.isArmor = this.document.type === "armor";
        context.isQizhen = this.document.type === "qizhen";

        // 准备下拉菜单
        context.choices = {
            // 武器类型
            weaponTypes: localizeConfig(XJZL.weaponTypes),
            // 防具部位
            armorTypes: localizeConfig(XJZL.armorTypes),
            // 奇珍的穴位比较特殊，通常不需要下拉选择，而是拖拽进去时自动填，或者我们给一个简单的文本框即可
            //品阶
            qualities: localizeConfig(XJZL.qualities)
        };
        // 准备特效列表
        context.effects = this.document.effects.map(e => ({
            id: e.id, name: e.name, img: e.img, disabled: e.disabled,
            transfer: e.transfer // 显示是否是被动
        }));
        return context;
    }

    /* -------------------------------------------- */
    /*  自动保存 (事件委托)                         */
    /* -------------------------------------------- */
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

    /* -------------------------------------------- */
    /*  Active Effects Logic (接管 AE 管理)         */
    /* -------------------------------------------- */

    async _onCreateEffect(event, target) {
        return ActiveEffect.create({
            name: "装备属性",
            icon: "icons/svg/aura.svg",
            origin: this.document.uuid,
            transfer: true // 【关键】装备的属性默认是被动生效的
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