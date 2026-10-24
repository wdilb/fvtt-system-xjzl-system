// module/applications/creature-check-editor.mjs
import { StatusIdPicker } from "./status-id-picker.mjs";
import { localizeConfig } from "../utils/utils.mjs";
import {
    getCheckAttrChoices,
    getCheckOutcomeTypes,
    getSelfRecoveryTypes,
    updateCreatureAbility
} from "../data/actor/creature.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * 野兽特性的状态/检定配置编辑器。
 * 特性卡上只保留攻击入口与状态入口；直接状态、叠层/持续时间、检定及说明
 * 全部在本窗口完成，并通过同一份草稿实时保存。
 * 改动实时自动保存（与野兽卡的 submitOnChange 体验一致，无保存按钮）：
 * 任何输入变化经防抖后通过 updateCreatureAbility 整元素写回（abilities 数组元素
 * 在 update 中按整体替换合并，因此状态字段和 check 一起提交，保留同级攻击配置）。
 * 关闭窗口前留存的防抖任务仍会执行，最后一次改动不丢失。
 * 编辑器按"特性下标 + 打开时的数组长度"寻址：卡片上增删特性会整体替换 abilities
 * 数组并改变长度，原下标可能指向另一条特性，此时自动保存会把草稿写进错误对象。
 * 因此监听本 Actor 的 updateActor，长度一变即取消防抖任务并关闭窗口（见 #onActorUpdate）。
 */
export class CreatureCheckEditor extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "xjzl-creature-check-editor",
        classes: ["xjzl-window", "xjzl-check-editor-window", "theme-dark"],
        window: {
            title: "XJZL.Creature.StateEditorTitle",
            icon: "fas fa-scroll",
            resizable: true
        },
        // 本系统窗口框架的 header 是 40px 绝对定位覆盖层（见 _layout.css），内容须自行避让；
        // 尺寸必须写在 position 下，window.width 不参与定位；高度随内容自适应（同 manage-xp 的做法）
        position: {
            width: 760,
            height: "auto"
        },
        actions: {
            pickCheckEffects: CreatureCheckEditor.prototype._onPickCheckEffects,
            removeCheckEffect: CreatureCheckEditor.prototype._onRemoveCheckEffect,
            pickAbilityDirectEffects: CreatureCheckEditor.prototype._onPickAbilityDirectEffects,
            removeAbilityDirectEffect: CreatureCheckEditor.prototype._onRemoveAbilityDirectEffect
        }
    };

    static PARTS = {
        main: {
            template: "systems/xjzl-system/templates/apps/creature-check-editor.hbs",
            scrollable: [".xjzl-check-editor"]
        }
    };

    // 固定窗口 id：同时只能编辑一个状态/检定配置，重复打开时替换旧实例
    static #current = null;

    /** @type {Actor} 所属野兽 */
    #actor;
    /** @type {Number} 特性在 system.abilities 中的下标 */
    #abilityIndex;
    /** @type {Object} 编辑草稿（纯数据树，保存前不落库） */
    #draft;
    /** @type {Object} 状态页草稿（直接状态与说明字段） */
    #abilityDraft;
    // 防抖自动保存句柄（首次渲染时创建）
    #autosave = null;
    // 打开时的特性数组长度：增删特性必然改变长度，作为下标失效信号
    #abilitiesLength = 0;
    // updateActor 监听句柄（close 时注销，防止泄漏）
    #updateHookId = null;

    constructor({ actor, abilityIndex, ability, check }) {
        super({});
        this.#actor = actor;
        this.#abilityIndex = abilityIndex;
        this.#abilitiesLength = actor.system.abilities?.length ?? 0;
        const source = ability?.check ? ability : actor.system.abilities?.[abilityIndex] || {};
        const checkSource = check || source.check || {};
        this.#draft = foundry.utils.deepClone(checkSource?.toObject ? checkSource.toObject() : checkSource);
        this.#abilityDraft = foundry.utils.deepClone({
            directEffects: source.directEffects || [],
            directEffectStackable: source.directEffectStackable === true,
            directEffectCount: source.directEffectCount ?? 1,
            directEffectMaxStacks: source.directEffectMaxStacks ?? 0,
            directEffectDuration: source.directEffectDuration || { value: 0, units: "rounds", expiry: "turnStart" },
            description: source.description || "",
            automationNote: source.automationNote || ""
        });
        this.#updateHookId = Hooks.on("updateActor", doc => this.#onActorUpdate(doc));
    }

    /**
     * 特性列表增删使编辑器失效：abilities 数组长度变化后，原下标可能指向另一条特性，
     * 继续自动保存会把草稿写入错误对象。取消防抖任务（丢弃最后一次未保存改动）并关闭窗口。
     * 编辑器自身的保存按下标局部提交，不改变数组长度，不会误触发。
     * @param {Actor} doc 发生更新的 Actor
     */
    #onActorUpdate(doc) {
        if (doc !== this.#actor) return;
        const length = this.#actor.system.abilities?.length ?? 0;
        if (length === this.#abilitiesLength) return;
        this.#autosave?.cancel();
        ui.notifications.info(game.i18n.localize("XJZL.Creature.Check.EditorAbilityGone"));
        this.close().catch(error => console.error("XJZL | 检定配置编辑器失效关闭失败:", error));
    }

    /**
     * 打开（或替换为）检定配置编辑器。
     * @param {Actor} actor 野兽 Actor
     * @param {Number} abilityIndex 特性下标
     * @param {Object} ability 当前的特性数据（兼容只传 check 节点的旧调用）
     * @returns {Promise<CreatureCheckEditor|undefined>} 渲染中的实例；旧窗口关闭失败时为 undefined
     */
    static async open(actor, abilityIndex, ability) {
        const previous = CreatureCheckEditor.#current;
        if (previous) {
            CreatureCheckEditor.#current = null;
            // close() 经信号量串行且幂等（已关闭实例无元素直接返回），无需按 state 分支；
            // await 保证新窗口渲染前旧窗口已移除，避免同 ID 双窗
            try {
                await previous.close();
            } catch (error) {
                console.error("XJZL | 检定配置编辑器旧窗口关闭失败:", error);
                return undefined;
            }
        }
        const source = ability?.check ? ability : actor.system.abilities?.[abilityIndex];
        const legacyCheck = ability?.check ? undefined : ability;
        const app = new CreatureCheckEditor({ actor, abilityIndex, ability: source, check: legacyCheck });
        CreatureCheckEditor.#current = app;
        app.render(true).then(
            () => { },
            error => {
                if (CreatureCheckEditor.#current === app) CreatureCheckEditor.#current = null;
                console.error("XJZL | 检定配置编辑器打开失败:", error);
                app.close().catch(closeError => console.error("XJZL | 检定配置编辑器关闭失败:", closeError));
            }
        );
        return app;
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const statusNames = {};
        for (const [id, def] of Object.entries(CONFIG.statusEffects)) {
            statusNames[id] = game.i18n.localize(def.name);
        }
        const isSave = this.#draft.mode === "save";
        const ability = this.#actor.system.abilities[this.#abilityIndex];
        context.abilityName = ability?.name || "";
        // “伤害后发起检定”只对攻击型特性有意义；纯豁免/对抗特性没有伤害结算点。
        context.hasAttack = ability?.isAttack === true;
        context.invalidDirectEffectsWithCheck = context.hasAttack !== true
            && this.#abilityDraft.directEffects.length > 0
            && this.#draft.enabled === true;
        context.ability = this.#abilityDraft;
        context.check = this.#draft;
        context.statusNames = statusNames;
        // 后果两列（左=不利后果侧，右=目标抵御成功/野兽未得手侧）；
        // 在 JS 侧按模式预组装，模板免写分支重复的 partial 调用
        context.leftCol = {
            bannerKey: isSave ? "XJZL.Creature.Check.OutcomeFail" : "XJZL.Creature.Check.OutcomeWin",
            prefix: isSave ? "save.fail" : "contest.win",
            outcome: isSave ? this.#draft.save.fail : this.#draft.contest.win,
            isContest: !isSave
        };
        context.rightCol = {
            bannerKey: isSave ? "XJZL.Creature.Check.OutcomeSuccess" : "XJZL.Creature.Check.OutcomeLose",
            prefix: isSave ? "save.success" : "contest.lose",
            outcome: isSave ? this.#draft.save.success : this.#draft.contest.lose,
            isContest: !isSave
        };
        context.choices = {
            checkAttrs: getCheckAttrChoices(),
            outcomeTypes: getCheckOutcomeTypes(),
            // 自身恢复只作用于野兽：野兽仅持久化体力/怒气（见 data/actor/creature.mjs）
            resourceTypes: getSelfRecoveryTypes(),
            elements: localizeConfig(CONFIG.XJZL.elements)
        };
        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        // 防抖自动保存（每次 _onRender 都会重建 DOM 监听，debounce 句柄只建一次）
        if (!this.#autosave) this.#autosave = foundry.utils.debounce(() => this.#saveNow(), 400);
        // 根表单的 submit 默认行为由框架拦截（ApplicationV2 在根 form 上挂 _onSubmitForm，
        // 首行即 preventDefault），本窗口无需再自行阻止原生提交导航。
        // 所有输入变化后同步草稿并自动保存；模式切换额外重渲染以显示对应参数面板
        this.element.querySelectorAll("input, select, textarea").forEach(el => {
            el.addEventListener("change", () => {
                this.#syncFormToDraft();
                const currentAbility = this.#actor.system.abilities[this.#abilityIndex];
                if (el.name === "enabled"
                    && el.checked
                    && currentAbility?.isAttack !== true
                    && this.#abilityDraft.directEffects.length > 0) {
                    this.#draft.enabled = false;
                    ui.notifications.warn(game.i18n.localize("XJZL.Creature.Check.InvalidDirectEffectsWithCheck"));
                    this.render();
                    return;
                }
                if (el.name === "mode"
                    || el.name === "ability.directEffectStackable"
                    || String(el.name).toLowerCase().endsWith("effectstackable")) {
                    this.render();
                }
                this.#autosave();
            });
        });
    }

    /**
     * 立即把当前草稿写回 Actor（状态挑选/移除等 DOM 外改动直接调用，其余走防抖）。
     * 状态页的所有字段（包括 check.enabled）一起保存，避免卡片上出现第二套开关。
     * 下标已不存在时静默跳过：正常时序下特性增删会先经 #onActorUpdate 关闭编辑器，
     * 此检查只兜底"保存在途时数组恰好被改写"的窄窗口竞态。
     */
    async #saveNow() {
        if (!this.#actor.system.abilities[this.#abilityIndex]) return;
        try {
            const check = foundry.utils.deepClone(this.#draft);
            if (this.#actor.system.abilities[this.#abilityIndex]?.isAttack !== true) {
                check.afterDamage = false;
            }
            const abilityPatch = foundry.utils.deepClone(this.#abilityDraft);
            await updateCreatureAbility(this.#actor, this.#abilityIndex, { ...abilityPatch, check });
        } catch (error) {
            console.error("XJZL | 检定配置自动保存失败:", error);
            ui.notifications.error(game.i18n.localize("XJZL.Creature.Check.AutosaveFailed"));
        }
    }

    /**
     * 把表单当前值同步进草稿：按草稿的数据树遍历（string/number/boolean），
     * 以字段 name 反查表单元素取值；effects 与 directEffects 等数组不进表单，由状态选择器维护，
     * 因此重渲染（切换模式/挑选状态）不会丢失表单外的已选内容。
     */
    #syncFormToDraft() {
        const form = this.element;
        if (!form) return;
        const syncNode = (node, base) => {
            for (const key of Object.keys(node)) {
                const path = base ? `${base}.${key}` : key;
                const value = node[key];
                if (Array.isArray(value) || value === null || value === undefined) continue;
                if (typeof value === "object") {
                    syncNode(value, path);
                    continue;
                }
                const el = form.querySelector(`[name="${path}"]`);
                if (!el) continue;
                if (typeof value === "boolean") node[key] = el.checked;
                else if (typeof value === "number") node[key] = Number(el.value) || 0;
                else if (el.type === "radio") {
                    const checked = form.querySelector(`[name="${path}"]:checked`);
                    if (checked) node[key] = checked.value;
                } else {
                    node[key] = el.value;
                }
            }
        };
        syncNode(this.#draft, "");
        syncNode(this.#abilityDraft, "ability");
    }

    /**
     * 打开状态选择器为后果块挑选状态：先同步表单到草稿，再把勾选结果写入草稿对应数组，
     * 重渲染显示 chips 并立即自动保存。data-path 为草稿内的相对路径
     * （如 save.fail.effects / contest.win.selfEffects）。
     */
    async _onPickCheckEffects(event, target) {
        this.#syncFormToDraft();
        const path = target.dataset.path;
        const current = foundry.utils.getProperty(this.#draft, path) || [];
        const picked = await StatusIdPicker.pick({ selected: current });
        if (picked === null) return; // 关闭/取消
        foundry.utils.setProperty(this.#draft, path, picked);
        this.render();
        await this.#saveNow();
    }

    /** 从草稿的后果状态数组中移除一个 ID（先同步表单，防丢失未保存修改）并立即自动保存。 */
    async _onRemoveCheckEffect(event, target) {
        this.#syncFormToDraft();
        const path = target.dataset.path;
        const current = foundry.utils.getProperty(this.#draft, path) || [];
        foundry.utils.setProperty(this.#draft, path, current.filter(e => e !== target.dataset.id));
        this.render();
        await this.#saveNow();
    }

    /**
     * 为特性挑选不经过命中/豁免的直接状态；叠层与持续时间仍由本窗口的字段控制。
     * @param {Event} event 点击事件
     * @returns {Promise<void>}
     */
    async _onPickAbilityDirectEffects(event) {
        this.#syncFormToDraft();
        const ability = this.#actor.system.abilities[this.#abilityIndex];
        if (ability?.isAttack !== true && this.#draft.enabled === true) {
            return ui.notifications.warn(game.i18n.localize("XJZL.Creature.Check.InvalidDirectEffectsWithCheck"));
        }
        const picked = await StatusIdPicker.pick({ selected: this.#abilityDraft.directEffects || [] });
        if (picked === null) return;
        this.#abilityDraft.directEffects = picked;
        this.render();
        await this.#saveNow();
    }

    /** 移除一个直接状态，并立即保存剩余状态配置。 */
    async _onRemoveAbilityDirectEffect(event, target) {
        this.#syncFormToDraft();
        this.#abilityDraft.directEffects = (this.#abilityDraft.directEffects || [])
            .filter(effectId => effectId !== target.dataset.id);
        this.render();
        await this.#saveNow();
    }

    async close(options = {}) {
        if (this.#updateHookId) {
            Hooks.off("updateActor", this.#updateHookId);
            this.#updateHookId = null;
        }
        if (CreatureCheckEditor.#current === this) CreatureCheckEditor.#current = null;
        return super.close(options);
    }
}
