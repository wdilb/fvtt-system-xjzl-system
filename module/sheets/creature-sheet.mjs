/**
 * 野兽/怪物 专用角色卡
 */
import { localizeConfig } from "../utils/utils.mjs";
import { prepareEffects, onEffectAction, promptEffectDuration, onDeleteEffect } from "./behaviors/effect-interactions.mjs";
import { ActiveEffectManager } from "../managers/active-effect-manager.mjs";
import { CreatureCheckEditor } from "../applications/creature-check-editor.mjs";
const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLCreatureSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
    // 只保存当前窗口的展开面板，不写入 Actor 数据；这样表单自动重渲染后仍停留在用户正在编辑的分区。
    _openAbilityPanels = new Map();

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
            // 使用特性（攻击/命中/检定一体化流程）
            useAbility: XJZLCreatureSheet.prototype._onUseAbility,
            // 状态与检定全部在独立编辑器中配置
            editAbilityState: XJZLCreatureSheet.prototype._onEditAbilityState,
            // 能力卡的轻量折叠面板（攻击 / 状态）
            toggleAbilityPanel: XJZLCreatureSheet.prototype._onToggleAbilityPanel,
            // 特效交互（与人物卡一致）
            deleteEffect: XJZLCreatureSheet.prototype._onDeleteEffect,
            // 设为常用
            togglePinnedAbility: XJZLCreatureSheet.prototype._onTogglePinnedAbility
        }
    };

    static PARTS = {
        main: { template: "systems/xjzl-system/templates/actor/creature/sheet.hbs", scrollable: [".xjzl-creature-sheet", ".ability-list"] }
    };

    /** 准备野兽卡上下文；baseCombat 只含存档值，system 提供最终战斗数值。 */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const actor = this.document;

        context.system = actor.system;
        // 编辑只读取存档中的 value，防止任何 AE 对运行时字段的修改被表单写回。
        context.baseCombat = actor.system.toObject().combat;
        context.creatureTypes = localizeConfig(CONFIG.XJZL.creatureTypes); // 用于下拉菜单
        context.choices = {
            sizes: { tiny: "袖珍", small: "小型", medium: "中型", large: "大型", huge: "巨型" },
            damageTypes: localizeConfig(CONFIG.XJZL.damageTypes) // 攻击型特性伤害类型下拉
        };
        // 准备体力百分比
        const tili = actor.system.resources.tili;
        context.tiliPercent = tili.max ? Math.min(100, (tili.value / tili.max) * 100) : 0;

        // 准备非被动 AE（与人物卡共享同一逻辑）
        prepareEffects(this, context);

        // 解析常用招式与卡片摘要；状态与检定详情统一在独立编辑器配置。
        const pinnedList = actor.getFlag("xjzl-system", "pinnedMoves") || [];
        if (context.system.abilities) {
            context.system.abilities.forEach((ab, index) => {
                ab.isPinned = pinnedList.includes(`Ability.${index}`);
                // 可发起：配置了攻击段或检定段
                ab.canUse = ab.isAttack || ab.check?.enabled === true || (ab.directEffects?.length > 0);
                // 状态页包含直接状态与检定；说明文本仍归在状态页，避免卡片初始高度过长。
                ab.stateConfigured = (ab.directEffects?.length > 0)
                    || ab.check?.enabled === true
                    || Boolean(ab.description || ab.automationNote);
                if (ab.isAttack) {
                    const damageType = context.choices.damageTypes[ab.damageType] || ab.damageType || "";
                    ab.attackSummary = `${ab.damage ?? 0} · ${damageType}`;
                }
            });
        }

        return context;
    }

    /**
     * @override
     * abilities 数组元素在 Foundry update 中按"整体替换"处理，而表单只包含部分字段
     * （卡上没有检定配置的输入），若不补全，每次表单提交都会把不在表单里的兄弟数据
     * （如 check 配置）重置为默认值。以现有数据为底、表单值覆盖，保证提交永远完整。
     */
    _processFormData(event, form, formData) {
        const submitData = super._processFormData(event, form, formData);
        // 表单展开后 abilities 可能是数组或数字键对象（两种形态都出现过），统一按条目补全
        const abilities = submitData.system?.abilities;
        if (abilities && typeof abilities === "object") {
            const current = this.document.system.abilities;
            const isArray = Array.isArray(abilities);
            const entries = isArray ? abilities.map((v, i) => [i, v]) : Object.entries(abilities);
            const merged = {};
            for (const [idxStr, patch] of entries) {
                const existing = current[Number(idxStr)];
                if (!existing || patch === null || typeof patch !== "object") {
                    merged[idxStr] = patch;
                    continue;
                }
                const full = existing.toObject?.() ?? foundry.utils.deepClone(existing);
                merged[idxStr] = foundry.utils.mergeObject(full, patch);
            }
            submitData.system.abilities = isArray ? Object.values(merged) : merged;
        }
        return submitData;
    }

    /* -------------------------------------------- */
    /*  交互 Actions                                */
    /* -------------------------------------------- */

    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;

        this._restoreAbilityPanels(html);

        // 特效交互：左键加层，右键减层（委托共享逻辑）
        const effectsContainer = html.querySelector(".active-effects-row");
        if (effectsContainer) {
            effectsContainer.addEventListener("click", (event) => this._onEffectAction(event, 1));
            effectsContainer.addEventListener("contextmenu", (event) => this._onEffectAction(event, -1));
        }
    }

    /**
     * 恢复能力卡的展开分区，并同步 aria 状态；面板状态只属于当前 Sheet 实例。
     * @param {HTMLElement} html 当前 Sheet 根节点
     * @returns {void}
     */
    _restoreAbilityPanels(html) {
        html.querySelectorAll(".ability-card").forEach((card) => {
            const index = Number(card.dataset.abilityIndex);
            const panel = this._openAbilityPanels.get(index) || null;
            this._setAbilityPanelState(card, panel);
        });
    }

    /**
     * 切换能力卡的攻击/状态配置页，不改变能力数据；具体字段仍由表单提交保存。
     * @param {Event} event 点击事件
     * @param {HTMLElement} target 带 data-index/data-panel 的入口按钮
     * @returns {void}
     */
    _onToggleAbilityPanel(event, target) {
        event.preventDefault();
        const card = target.closest(".ability-card");
        const index = Number(target.dataset.index);
        const panel = target.dataset.panel;
        if (!card || !Number.isInteger(index) || !["attack", "state"].includes(panel)) return;

        if (this._openAbilityPanels.get(index) === panel) this._openAbilityPanels.delete(index);
        else this._openAbilityPanels.set(index, panel);
        this._setAbilityPanelState(card, this._openAbilityPanels.get(index) || null);
    }

    /**
     * 将某张能力卡切换到指定分区，并更新按钮箭头与辅助技术属性。
     * @param {HTMLElement} card 能力卡根节点
     * @param {string|null} openPanel 要展开的分区，null 表示全部收起
     * @returns {void}
     */
    _setAbilityPanelState(card, openPanel) {
        card.querySelectorAll("[data-ability-panel]").forEach((panel) => {
            const isOpen = panel.dataset.abilityPanel === openPanel;
            panel.classList.toggle("is-open", isOpen);
            panel.setAttribute("aria-hidden", String(!isOpen));
        });
        card.querySelectorAll("[data-action='toggleAbilityPanel']").forEach((button) => {
            const isOpen = button.dataset.panel === openPanel;
            button.classList.toggle("is-open", isOpen);
            button.setAttribute("aria-expanded", String(isOpen));
        });
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
        const nextPanels = new Map();
        for (const [oldIndex, panel] of this._openAbilityPanels) {
            if (oldIndex === index) continue;
            nextPanels.set(oldIndex > index ? oldIndex - 1 : oldIndex, panel);
        }
        this._openAbilityPanels = nextPanels;
        await this.document.update({ "system.abilities": abilities });
    }

    /**
     * 将特性发送到聊天栏
     */
    async _onPostAbility(event, target) {
        const index = Number(target.dataset.index);
        const ability = this.document.system.abilities[index];
        if (!ability) return;

        let content = `
        <div class="xjzl-chat-card">
            <header class="card-header" style="border-bottom: 2px solid #444; margin-bottom: 10px;">
                <h3 style="margin:0;">${ability.name}</h3>
            </header>
            <div class="card-description" style="font-size: 0.9em; color: #444;">
                ${ability.description || "无描述"}
            </div>
        </div>`;

        if (ability.automationNote && !/<strong>自动化：<\/strong>/.test(ability.description || "")) {
            content += `<div style="font-size:0.8em;color:#666;margin-top:6px;"><strong>自动化：</strong>${foundry.utils.escapeHTML(ability.automationNote)}</div>`;
        }

        ChatMessage.create({
            author: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this.document }),
            content: content
        });
    }

    /**
     * 使用特性：薄壳入口，一体化流程（攻击/命中/检定融合）的单一事实源在
     * XJZLActor.useCreatureAbility，Token HUD 等其他发起入口调用同一方法。
     */
    async _onUseAbility(event, target) {
        const index = Number(target.dataset.index);
        await this.document.useCreatureAbility(index);
    }

    /** 打开野兽特性的状态/检定编辑器，所有非攻击配置在该窗口内保存。 */
    _onEditAbilityState(event, target) {
        const index = Number(target.dataset.index);
        const ability = this.document.system.abilities[index];
        if (!ability) return;
        return CreatureCheckEditor.open(this.document, index, ability);
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

    /**
     * @override
     * 通过特效门面处理生物卡拖放，保留被动效果拦截、架招判定和叠层语义。
     * @param {DragEvent} event 拖放事件
     * @param {ActiveEffect} effect 来源特效
     * @returns {Promise<ActiveEffect|undefined>} 施加结果；被拦截时返回 undefined
     */
    async _onDropActiveEffect(event, effect) {
        return ActiveEffectManager.applyDraggedEffect(this.actor, effect);
    }
}
