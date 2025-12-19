const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLBackgroundSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "item", "background", "xjzl-system"],
        position: { width: 500, height: 600 },
        window: { resizable: true },
        form: { submitOnChange: true, closeOnSubmit: false },
        actions: {
            editImage: XJZLBackgroundSheet._onEditImage,
            createEffect: XJZLBackgroundSheet._onCreateEffect,
            editEffect: XJZLBackgroundSheet._onEditEffect,
            deleteEffect: XJZLBackgroundSheet._onDeleteEffect,
            toggleEffect: XJZLBackgroundSheet._onToggleEffect
        }
    };

    static PARTS = {
        header: { template: "systems/xjzl-system/templates/item/background/header.hbs" },
        tabs: { template: "systems/xjzl-system/templates/item/background/tabs.hbs" },
        details: { template: "systems/xjzl-system/templates/item/background/tab-details.hbs", scrollable: [""] },
        effects: { template: "systems/xjzl-system/templates/item/background/tab-effects.hbs", scrollable: [""] }
    };

    // 设置初始 Tab
    tabGroups = { primary: "details" };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.system = this.document.system;
        context.tabs = this.tabGroups;

        // 准备特效列表供模板渲染
        context.effects = this.document.effects.map(e => ({
            id: e.id,
            name: e.name,
            img: e.img,
            disabled: e.disabled,
            transfer: e.transfer //被动
        }));

        return context;
    }

    /* -------------------------------------------- */
    /*  Active Effects 逻辑                         */
    /* -------------------------------------------- */

    static async _onCreateEffect(event, target) {
        return ActiveEffect.create({
            name: "背景加成",
            icon: "icons/magic/symbols/clover.webp",
            origin: this.document.uuid,
            transfer: true // 背景加成默认必须为被动
        }, { parent: this.document });
    }

    static async _onEditEffect(event, target) {
        const effectId = target.dataset.id;
        const effect = this.document.effects.get(effectId);
        if (effect) effect.sheet.render(true);
    }

    static async _onDeleteEffect(event, target) {
        const effectId = target.dataset.id;
        const effect = this.document.effects.get(effectId);
        if (effect) await effect.delete();
    }

    static async _onToggleEffect(event, target) {
        const effectId = target.dataset.id;
        const effect = this.document.effects.get(effectId);
        if (effect) await effect.update({ disabled: !effect.disabled });
    }

    /* -------------------------------------------- */
    /*  图片编辑                                     */
    /* -------------------------------------------- */
    static async _onEditImage(event, target) {
        const attr = target.dataset.edit || "img";
        const fp = new foundry.applications.apps.FilePicker({
            type: "image",
            current: foundry.utils.getProperty(this.document, attr),
            callback: path => this.document.update({ [attr]: path })
        });
        return fp.browse();
    }

    /**
     * 处理物品拖拽到背景 Sheet 上，以后可能会用到，等物品都录入完再说
     * @override
     */
    // async _onDrop(event) {
    //     const data = TextEditor.getDragEventData(event);
    //     if (data.type !== "Item") return super._onDrop(event);

    //     const item = await Item.fromDropData(data);
    //     if (!item) return;

    //     // 将 UUID 存入 items 数组
    //     const items = [...this.document.system.items];
    //     items.push({ uuid: item.uuid, quantity: 1 });

    //     await this.document.update({ "system.items": items });
    //     ui.notifications.info(`已将 ${item.name} 关联至此背景`);
    // }
}