const { ItemSheetV2, HandlebarsApplicationMixin } = foundry.applications.sheets;

export class XJZLBackgroundSheetV2 extends HandlebarsApplicationMixin(ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "item", "background", "xjzl-system"],
        position: { width: 500, height: 600 },
        window: { resizable: true },
        form: { submitOnChange: true, closeOnSubmit: false }
    };

    static PARTS = {
        header: { template: "systems/xjzl-system/templates/item/background/header.hbs" },
        details: { template: "systems/xjzl-system/templates/item/background/details.hbs", scrollable: [""] }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.system = this.document.system;
        return context;
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