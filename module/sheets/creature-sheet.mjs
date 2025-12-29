/**
 * 野兽/怪物 专用角色卡
 */
import { localizeConfig } from "../utils/utils.mjs";
const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLCreatureSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "actor", "creature"],
        position: { width: 600, height: 600 }, // 不需要太大
        window: { resizable: true },
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        },
        actions: {
            // --- 图片编辑动作 ---
            editImage: XJZLCreatureSheet.prototype._onEditImage,
            // 技能管理
            addAbility: XJZLCreatureSheet.prototype._onAddAbility,
            deleteAbility: XJZLCreatureSheet.prototype._onDeleteAbility,
            // 快捷发送
            postAbility: XJZLCreatureSheet.prototype._onPostAbility
        }
    };

    static PARTS = {
        main: { template: "systems/xjzl-system/templates/actor/creature/sheet.hbs", scrollable: [".xjzl-creature-sheet", ".ability-list"] }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const actor = this.document;

        context.system = actor.system;
        context.creatureTypes = localizeConfig(CONFIG.XJZL.creatureTypes); // 用于下拉菜单
        context.choices = {
            sizes: { small: "小型", medium: "中型", large: "大型", huge: "巨型" }
        };

        // 准备体力百分比
        const tili = actor.system.resources.tili;
        context.tiliPercent = tili.max ? Math.min(100, (tili.value / tili.max) * 100) : 0;

        return context;
    }

    /* -------------------------------------------- */
    /*  交互 Actions                                */
    /* -------------------------------------------- */

    /* -------------------------------------------- */
    /*  通用图片编辑器处理                            */
    /* -------------------------------------------- */
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

    async _onAddAbility(event, target) {
        const abilities = this.document.system.abilities || [];
        await this.document.update({
            "system.abilities": [...abilities, { name: "新特性", description: "" }]
        });
    }

    async _onDeleteAbility(event, target) {
        const index = Number(target.dataset.index);
        const abilities = foundry.utils.deepClone(this.document.system.abilities);
        abilities.splice(index, 1);
        await this.document.update({ "system.abilities": abilities });
    }

    /**
     * 将特性发送到聊天栏
     */
    async _onPostAbility(event, target) {
        const index = Number(target.dataset.index);
        const ability = this.document.system.abilities[index];
        if (!ability) return;

        const content = `
        <div class="xjzl-chat-card">
            <header class="card-header" style="border-bottom: 2px solid #444; margin-bottom: 10px;">
                <h3 style="margin:0;">${ability.name}</h3>
            </header>
            <div class="card-description" style="font-size: 0.9em; color: #444;">
                ${ability.description || "无描述"}
            </div>
        </div>`;

        ChatMessage.create({
            author: game.user.id, // V13
            speaker: ChatMessage.getSpeaker({ actor: this.document }),
            content: content
        });
    }
}