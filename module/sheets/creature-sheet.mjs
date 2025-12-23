/**
 * 野兽/怪物 专用角色卡
 */
const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLCreatureSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "actor", "creature", "xjzl-system"],
        position: { width: 600, height: 600 }, // 不需要太大
        window: { resizable: true },
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        },
        actions: {
            // 技能管理
            addAbility: XJZLCreatureSheet.prototype._onAddAbility,
            deleteAbility: XJZLCreatureSheet.prototype._onDeleteAbility,
            // 快捷发送
            postAbility: XJZLCreatureSheet.prototype._onPostAbility
        }
    };

    static PARTS = {
        main: { template: "systems/xjzl-system/templates/actor/creature/sheet.hbs", scrollable: [""] }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const actor = this.document;
        
        context.system = actor.system;
        context.config = CONFIG.XJZL; // 用于下拉菜单

        // 准备体力百分比
        const tili = actor.system.resources.tili;
        context.tiliPercent = tili.max ? Math.min(100, (tili.value / tili.max) * 100) : 0;

        return context;
    }

    /* -------------------------------------------- */
    /*  交互 Actions                                */
    /* -------------------------------------------- */

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