
import { XJZL } from "../config.mjs";
import { localizeConfig } from "../utils/utils.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLArtBookSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "item", "art-book", "xjzl-system"],
        position: { width: 650, height: 700 },
        window: { resizable: true },
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        },
        actions: {
            addChapter: XJZLArtBookSheet.prototype._onAddChapter,
            deleteChapter: XJZLArtBookSheet.prototype._onDeleteChapter
        }
    };

    static PARTS = {
        header: { template: "systems/xjzl-system/templates/item/art-book/header.hbs" },
        // 不需要 Tabs，因为内容比较少，直接单页展示即可，或者简单的详情页
        details: { template: "systems/xjzl-system/templates/item/art-book/details.hbs", scrollable: [""] }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.system = this.document.system;

        // 准备下拉菜单
        context.choices = {
            arts: localizeConfig(XJZL.arts)
        };

        // 可以在这里计算一些预览数据，例如总计需要多少修为
        context.totalCost = context.system.chapters.reduce((sum, c) => sum + (c.cost || 0), 0);
        context.totalLevelReward = context.system.chapters.reduce((sum, c) => sum + (c.reward?.level || 0), 0);

        return context;
    }

    /* -------------------------------------------- */
    /*  Action Handlers                             */
    /* -------------------------------------------- */

    async _onAddChapter(event, target) {
        const source = this.document.system.toObject();
        const chapters = source.chapters || [];

        const newChapter = {
            id: foundry.utils.randomID(),
            name: `第 ${chapters.length + 1} 篇`,
            img: "icons/svg/book.svg",
            description: "",
            cost: 100,
            reward: { level: 1, check: 0 }
        };

        await this.document.update({
            "system.chapters": [...chapters, newChapter]
        });
    }

    async _onDeleteChapter(event, target) {
        const idx = Number(target.dataset.idx);
        const source = this.document.system.toObject();
        const chapters = source.chapters || [];

        // 确认删除
        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: "删除篇章" },
            content: "<p>确定要删除这个篇章吗？</p>",
            rejectClose: false
        });

        if (confirm) {
            chapters.splice(idx, 1);
            await this.document.update({ "system.chapters": chapters });
        }
    }
}