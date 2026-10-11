
import { XJZL } from "../config.mjs";
import { localizeConfig } from "../utils/utils.mjs";
import { allocateBookXPToChapters } from "../utils/art-book-xp.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLArtBookSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "item", "art-book", "theme-dark"],
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

        // 顶部总纲描述 (异步解析)
        context.enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(
            this.document.system.description,
            { secrets: this.document.isOwner, async: true, relativeTo: this.document }
        );

        // 准备下拉菜单
        context.choices = {
            arts: localizeConfig(XJZL.arts)
        };

        // 可以在这里计算一些预览数据，例如总计需要多少修为
        context.totalCost = context.system.chapters.reduce((sum, c) => sum + (c.cost || 0), 0);
        context.totalLevelReward = context.system.chapters.reduce((sum, c) => sum + (c.reward?.level || 0), 0);

        // 篇章描述列表 (使用 Promise.all 并行解析)
        if (context.system.chapters && context.system.chapters.length > 0) {
            await Promise.all(context.system.chapters.map(async (chapter) => {
                // 解析每个章节的描述
                chapter.enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(
                    chapter.description || "",
                    { secrets: this.document.isOwner, async: true, relativeTo: this.document }
                );
            }));
        }

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

        // 空章节旧书的书级遗留池：添加首章时按序折入新篇章（旧系统语义：书级池即研读进度），
        // 否则下方写路径的书级清零会把这笔无法按篇拆分的余额直接抹掉
        if (chapters.length === 0 && (source.xpInvested || 0) > 0) {
            const { chapters: allocated } = allocateBookXPToChapters([newChapter], source.xpInvested, source.sourceBreakdown);
            await this.document.updateArtBookChapters(allocated);
            return;
        }

        // 走全状态写路径：同步落库书级清零，防止重载后被 migrateData 误判重复拆分
        await this.document.updateArtBookChapters([...chapters, newChapter]);
    }

    async _onDeleteChapter(event, target) {
        const idx = Number(target.dataset.idx);
        const source = this.document.system.toObject();
        const chapters = source.chapters || [];
        const chapter = chapters[idx];
        if (!chapter) return;

        // 篇章独立持有修为：删除前先按来源全额返还，避免投入随篇章一起消失。
        // 世界物品没有归属 Actor 也没有修为业务，无需返还
        const invested = chapter.xpInvested || 0;
        const hasActor = Boolean(this.document.actor);

        // 确认删除
        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: "删除篇章" },
            content: (invested > 0 && hasActor)
                ? `<p>该篇章已投入 <b>${invested}</b> 点修为，删除后将返还至修为池。确定要删除吗？</p>`
                : "<p>确定要删除这个篇章吗？</p>",
            rejectClose: false
        });

        if (!confirm) return;

        // 确认期间数据可能被其他客户端修改（弹窗前快照不可信），按确认后的最新存量返还
        if (hasActor) {
            const current = (this.document.system.toObject().chapters || []).find(c => c.id === chapter.id);
            if (current && (current.xpInvested || 0) > 0) {
                const breakdown = current.sourceBreakdown || { general: current.xpInvested, specific: 0 };
                await this.document.refundArt(current.id, { general: breakdown.general || 0, specific: breakdown.specific || 0 });

                // 复检：返还被并发修改打断（如另一端先返还导致存量不足）时篇章仍有余额，
                // 中止删除，剩余修为交由用户走正常返还流程，避免随篇章一起丢失
                const after = (this.document.system.toObject().chapters || []).find(c => c.id === chapter.id);
                if (after && (after.xpInvested || 0) > 0) {
                    ui.notifications.warn(`篇章「${after.name}」仍有 ${after.xpInvested} 点修为未能返还，已取消删除。`);
                    return;
                }
            }
        }

        // 返还会重写 chapters 数组，删除前重新读取，并按 id 定位防止索引漂移；
        // 篇章已被其他客户端删除时无需操作
        const refreshed = this.document.system.toObject().chapters || [];
        const finalIdx = refreshed.findIndex(c => c.id === chapter.id);
        if (finalIdx === -1) return;
        refreshed.splice(finalIdx, 1);
        await this.document.updateArtBookChapters(refreshed);
    }
}