/**
 * 野兽/怪物 专用角色卡
 */
import { localizeConfig } from "../utils/utils.mjs";
import { prepareEffects, onEffectAction, promptEffectDuration, onDeleteEffect } from "./behaviors/effect-interactions.mjs";
const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLCreatureSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "actor", "creature", "theme-dark"],
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
            postAbility: XJZLCreatureSheet.prototype._onPostAbility,
            // 攻击型特性
            rollAbilityAttack: XJZLCreatureSheet.prototype._onRollAbilityAttack,
            // 特效交互（与人物卡一致）
            deleteEffect: XJZLCreatureSheet.prototype._onDeleteEffect,
            // 设为常用
            togglePinnedAbility: XJZLCreatureSheet.prototype._onTogglePinnedAbility
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
            sizes: { small: "小型", medium: "中型", large: "大型", huge: "巨型" },
            damageTypes: localizeConfig(CONFIG.XJZL.damageTypes) // 攻击型特性伤害类型下拉
        };

        // 准备体力百分比
        const tili = actor.system.resources.tili;
        context.tiliPercent = tili.max ? Math.min(100, (tili.value / tili.max) * 100) : 0;

        // 准备非被动 AE（与人物卡共享同一逻辑）
        prepareEffects(this, context);

        //解析常用招式
        const pinnedList = actor.getFlag("xjzl-system", "pinnedMoves") || [];
        if (context.system.abilities) {
            context.system.abilities.forEach((ab, index) => {
                ab.isPinned = pinnedList.includes(`Ability.${index}`);
            });
        }

        return context;
    }

    /* -------------------------------------------- */
    /*  交互 Actions                                */
    /* -------------------------------------------- */

    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;

        // 特效交互：左键加层，右键减层（委托共享逻辑）
        const effectsContainer = html.querySelector(".active-effects-row");
        if (effectsContainer) {
            effectsContainer.addEventListener("click", (event) => this._onEffectAction(event, 1));
            effectsContainer.addEventListener("contextmenu", (event) => this._onEffectAction(event, -1));
        }
    }

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

    /**
     * 发起攻击型特性：复用人物普攻管线（弹配置窗 + d20 命中检定 + applyDamage），
     * 野兽攻击永不暴击（由 rollBasicAttack 的 isCreatureAttack 标记处理）。
     */
    async _onRollAbilityAttack(event, target) {
        const index = Number(target.dataset.index);
        const ability = this.document.system.abilities[index];
        if (!ability) return;

        await this.document.rollBasicAttack({
            isCreatureAttack: true,
            baseDamage: ability.damage || 0,
            damageType: ability.damageType || "waigong",
            // 弹窗显示全量伤害类型，并默认选中特性上的类型（流血/毒素等不会被外功内功覆盖）
            defaultDamageType: ability.damageType || "waigong",
            damageTypes: CONFIG.XJZL.damageTypes,
            label: ability.name || "野兽攻击"
        });
    }

    /**
     * 切换野兽特性的常用收藏状态
     */
    async _onTogglePinnedAbility(event, target) {
        event.preventDefault();
        const index = target.dataset.index;
        const flagKey = `Ability.${index}`; // 使用特殊前缀隔离

        let pinnedList = this.document.getFlag("xjzl-system", "pinnedMoves") || [];

        if (pinnedList.includes(flagKey)) {
            // 如果已有，则移除
            pinnedList = pinnedList.filter(id => id !== flagKey);
        } else {
            // 如果没有，则加入
            pinnedList = [...pinnedList, flagKey];
        }

        await this.document.setFlag("xjzl-system", "pinnedMoves", pinnedList);
    }

    /* -------------------------------------------- */
    /*  特效交互（委托共享模块，行为与人物卡一致）      */
    /* -------------------------------------------- */
    async _onEffectAction(event, change) {
        return onEffectAction(this, event, change);
    }

    async _promptEffectDuration(effect) {
        return promptEffectDuration(this, effect);
    }

    async _onDeleteEffect(event, target) {
        return onDeleteEffect(this, event, target);
    }
}
