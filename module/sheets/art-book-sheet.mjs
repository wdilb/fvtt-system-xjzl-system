
import { XJZL } from "../config.mjs";
import { localizeConfig } from "../utils/utils.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLArtBookSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "item", "art-book"],
        position: { width: 800, height: 700 },
        window: { resizable: true },
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        },
        actions: {
            addChapter: XJZLArtBookSheet.prototype._onAddChapter,
            deleteChapter: XJZLArtBookSheet.prototype._onDeleteChapter,
            editImage: XJZLArtBookSheet.prototype._onEditImage // 更换图片
        }
    };

    static PARTS = {
        header: {
            template: "systems/xjzl-system/templates/item/art-book/header.hbs",
            scrollable: [".xjzl-sidebar__content"]
        },
        tabs: { template: "systems/xjzl-system/templates/item/art-book/tabs.hbs" }, // 即使只有一个也要加
        details: { template: "systems/xjzl-system/templates/item/art-book/details.hbs", scrollable: [""] }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.system = this.document.system;

        // 构造虚拟的 tabs 对象，因为 details.hbs 可能会用到 tabs.primary 判断
        // 虽然这里只有一个页面，但保持结构一致性是个好习惯
        context.tabs = { primary: "details" };

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

    // 图片编辑
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