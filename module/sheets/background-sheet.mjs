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
}