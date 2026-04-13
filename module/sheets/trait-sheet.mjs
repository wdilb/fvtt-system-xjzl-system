import { XJZL } from "../config.mjs";
import { localizeConfig } from "../utils/utils.mjs";
import { TRIGGER_CHOICES } from "../data/common.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLTraitSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "item", "trait", "theme-dark"],
        position: { width: 800, height: 600 },
        window: { resizable: true },
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        },
        actions: {
            createEffect: XJZLTraitSheet.prototype._onCreateEffect,
            editEffect: XJZLTraitSheet.prototype._onEditEffect,
            deleteEffect: XJZLTraitSheet.prototype._onDeleteEffect,
            toggleEffect: XJZLTraitSheet.prototype._onToggleEffect,
            addScript: XJZLTraitSheet.prototype._onAddScript,
            deleteScript: XJZLTraitSheet.prototype._onDeleteScript,
            editImage: XJZLTraitSheet.prototype._onEditImage
        }
    };

    static PARTS = {
        header: { template: "systems/xjzl-system/templates/item/trait/header.hbs", scrollable: [".xjzl-sidebar__content"] },
        tabs: { template: "systems/xjzl-system/templates/item/trait/tabs.hbs" },
        details: { template: "systems/xjzl-system/templates/item/trait/tab-details.hbs", scrollable: [""] },
        effects: { template: "systems/xjzl-system/templates/item/trait/tab-effects.hbs", scrollable: [""] }
    };

    tabGroups = { primary: "details" };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.system = this.document.system;
        context.tabs = this.tabGroups;

        // 准备触发器下拉菜单 (本地化)
        context.scriptTriggerChoices = {};
        for (const [key, labelKey] of Object.entries(TRIGGER_CHOICES)) {
            context.scriptTriggerChoices[key] = game.i18n.localize(labelKey);
        }

        // 准备特效类型的下拉菜单
        context.choices = {
            traitTypes: localizeConfig(XJZL.traitTypes)
        };

        // 准备特效列表
        context.effects = this.document.effects.map(e => ({
            id: e.id, name: e.name, img: e.img, disabled: e.disabled,
            transfer: e.transfer // 显示是否是被动
        }));

        // 富文本增强
        context.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
            this.document.system.description,
            { secrets: this.document.isOwner, async: true, relativeTo: this.document }
        );

        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        // 注入专属类型类名
        this.element.classList.add(`type-${this.document.type}`);
        // 特质没有 品质 属性，我们默认给它挂上代表高级的 (金品) 样式，让它更显眼
        this.element.classList.add("rank-jin");
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

    // --- 脚本管理 ---
    async _onAddScript(event, target) {
        const scripts = this.document.system.scripts || [];
        const newScript = { label: "新特质效果", trigger: "passive", script: "", active: true };
        await this.document.update({ "system.scripts": [...scripts, newScript] });
    }

    async _onDeleteScript(event, target) {
        const index = Number(target.dataset.index);
        const scripts = this.document.system.scripts || [];
        await this.document.update({ "system.scripts": scripts.filter((_, i) => i !== index) });
    }

    // --- AE 管理 ---
    async _onCreateEffect(event, target) {
        return ActiveEffect.create({
            name: "特质加成",
            icon: "icons/svg/aura.svg",
            origin: this.document.uuid,
            transfer: true // 特质属性默认被动生效
        }, { parent: this.document });
    }

    async _onEditEffect(event, target) { this.document.effects.get(target.dataset.id)?.sheet.render(true); }
    async _onDeleteEffect(event, target) { this.document.effects.get(target.dataset.id)?.delete(); }
    async _onToggleEffect(event, target) {
        const effect = this.document.effects.get(target.dataset.id);
        if (effect) effect.update({ disabled: !effect.disabled });
    }
}