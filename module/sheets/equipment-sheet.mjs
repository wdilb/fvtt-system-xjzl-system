import { XJZL } from "../config.mjs";
import { localizeConfig, getWeaponSubtypeChoices, normalizeWeaponSubtype } from "../utils/utils.mjs";
import { TRIGGER_CHOICES } from "../data/common.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLEquipmentSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "item", "equipment", "theme-dark"],
        position: { width: 800, height: 650 },
        window: { resizable: true },
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        },
        actions: {
            createEffect: XJZLEquipmentSheet.prototype._onCreateEffect,
            editEffect: XJZLEquipmentSheet.prototype._onEditEffect,
            deleteEffect: XJZLEquipmentSheet.prototype._onDeleteEffect,
            toggleEffect: XJZLEquipmentSheet.prototype._onToggleEffect,
            addScript: XJZLEquipmentSheet.prototype._onAddScript,
            deleteScript: XJZLEquipmentSheet.prototype._onDeleteScript,
            // 图片编辑
            editImage: XJZLEquipmentSheet.prototype._onEditImage
        }
    };

    static PARTS = {
        header: { template: "systems/xjzl-system/templates/item/equipment/header.hbs", scrollable: [".xjzl-sidebar__content"] },
        tabs: { template: "systems/xjzl-system/templates/item/equipment/tabs.hbs" },
        details: { template: "systems/xjzl-system/templates/item/equipment/tab-details.hbs", scrollable: [""] },
        effects: { template: "systems/xjzl-system/templates/item/equipment/tab-effects.hbs", scrollable: [""] }
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

        // 准备触发器下拉菜单 (本地化)
        context.scriptTriggerChoices = {};
        for (const [key, labelKey] of Object.entries(TRIGGER_CHOICES)) {
            context.scriptTriggerChoices[key] = game.i18n.localize(labelKey);
        }

        // 准备下拉菜单
        context.choices = {
            // 武器类型
            weaponTypes: localizeConfig(XJZL.weaponTypes),
            // 子武器类型：选项随当前大类联动，只含空项与对应分组枚举值
            weaponSubtypes: getWeaponSubtypeChoices(this.document.system.type),
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

        // 奇珍状态显示逻辑
        if (context.isQizhen) {
            const key = context.system.acupoint;
            if (key && XJZL.acupoints[key]) {
                // 如果有值，去配置里找对应的中文 Key，再翻译
                context.acupointLabel = game.i18n.localize(XJZL.acupoints[key]);
            } else {
                // 如果为空，显示未装备
                context.acupointLabel = game.i18n.localize("XJZL.Equipment.NotInlaid");
            }
        }

        // 富文本增强 (放在 return 之前)
        context.enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(
            this.document.system.description,
            {
                secrets: this.document.isOwner,
                async: true,
                relativeTo: this.document
            }
        );

        return context;
    }

    /* -------------------------------------------- */
    /*  表单提交                                    */
    /* -------------------------------------------- */

    /**
     * 大类与子类型可能在同一次自动保存中变更（改大类触发 submitOnChange 时，
     * 子类型下拉携带的仍是旧分组的选中值）；提交前按新大类归一，
     * 避免出现「blade + 单剑」这类无效组合落库。
     * updateData 须透传给 super（手动 submit({ updateData }) 的附加更新，
     * 在 super 内合并进提交数据），归一作用于合并后的最终值。
     */
    _prepareSubmitData(event, form, formData, updateData) {
        const data = super._prepareSubmitData(event, form, formData, updateData);
        // 防具/奇珍 schema 无 subtype 字段，缺值时自然跳过
        if (data.system?.subtype) {
            data.system.subtype = normalizeWeaponSubtype(data.system.type, data.system.subtype);
        }
        return data;
    }

    /* -------------------------------------------- */
    /*  自动保存 (事件委托)                         */
    /* -------------------------------------------- */
    _onRender(context, options) {
        super._onRender(context, options);
        // 1. 注入基础类型 (type-weapon, type-armor...)
        this.element.classList.add(`type-${this.document.type}`);

        // 2. 注入品阶类名 (Dynamic Rank Classes)
        const allRanks = ["rank-fan", "rank-tong", "rank-yin", "rank-jin", "rank-yu"];
        this.element.classList.remove(...allRanks);

        // 装备使用的是 quality (0-4)
        const qualityMap = {
            0: "fan",  // 凡
            1: "tong", // 铜
            2: "yin",  // 银
            3: "jin",  // 金
            4: "yu"    // 玉
        };

        const val = this.document.system.quality;
        // 默认凡品
        const targetClass = qualityMap[val] || "fan";

        this.element.classList.add(`rank-${targetClass}`);
    }

    async _onEditImage(event, target) {
        const attr = target.dataset.edit || "img";
        const current = foundry.utils.getProperty(this.document, attr);
        const fp = new foundry.applications.apps.FilePicker({
            type: "image",
            current: current,
            callback: path => this.document.update({ [attr]: path })
        });
        return fp.browse();
    }

    /* -------------------------------------------- */
    /*  Script Logic (脚本管理)                      */
    /* -------------------------------------------- */

    async _onAddScript(event, target) {
        const scripts = this.document.system.scripts || [];
        const newScript = {
            label: "新特效",
            trigger: "passive", // 默认被动
            script: "",
            active: true
        };

        await this.document.update({
            "system.scripts": [...scripts, newScript]
        });
    }

    async _onDeleteScript(event, target) {
        const index = Number(target.dataset.index);
        const scripts = this.document.system.scripts || [];
        const newScripts = scripts.filter((_, i) => i !== index);

        await this.document.update({
            "system.scripts": newScripts
        });
    }

    /* -------------------------------------------- */
    /*  Active Effects Logic (接管 AE 管理)         */
    /* -------------------------------------------- */

    async _onCreateEffect(event, target) {
        return ActiveEffect.create({
            name: "装备属性",
            img: "icons/svg/aura.svg", // V14 schema 字段为 img（icon 已移除，会被核心清洗丢弃）
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
