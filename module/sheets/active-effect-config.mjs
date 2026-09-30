const { ActiveEffectConfig } = foundry.applications.sheets;
import { TRIGGER_CHOICES } from "../data/common.mjs";

/**
 * ActiveEffect 配置窗口：保留核心页签，并提供叠层、架招绑定和脚本配置。
 * PARTS/TABS 在子类中遮蔽父类，因此核心部件与页签必须完整声明。
 */
export class XJZLActiveEffectConfig extends ActiveEffectConfig {

    /** @type {ApplicationConfiguration} */
    static DEFAULT_OPTIONS = {
        // active-effect-config：核心 CSS 以该类为作用域写了本套模板的布局修正
        // （duration 页标签 flex 比例、changes 页间距等），子类换类名会全部失配
        classes: ["xjzl-config", "active-effect-config"],
        position: { width: 580 },
        actions: {
            addScript: XJZLActiveEffectConfig.prototype._onAddScript,
            deleteScript: XJZLActiveEffectConfig.prototype._onDeleteScript
        }
    };

    /** @type {Record<string, HandlebarsTemplatePart>} */
    static PARTS = {
        header: { template: "templates/sheets/active-effect/header.hbs" },
        tabs: { template: "templates/generic/tab-navigation.hbs" },
        details: { template: "templates/sheets/active-effect/details.hbs", scrollable: [""] },
        duration: { template: "templates/sheets/active-effect/duration.hbs" },
        changes: {
            template: "templates/sheets/active-effect/changes.hbs",
            templates: ["templates/sheets/active-effect/change.hbs"],
            scrollable: ["ol[data-changes]"]
        },
        xjzl: { template: "systems/xjzl-system/templates/apps/active-effect-xjzlconfig.hbs", scrollable: [""] },
        footer: { template: "templates/generic/form-footer.hbs" }
    };

    /** @type {Record<string, ApplicationTabsConfiguration>} */
    static TABS = {
        sheet: {
            tabs: [
                { id: "details", icon: "fa-solid fa-book" },
                { id: "duration", icon: "fa-solid fa-clock" },
                { id: "changes", icon: "fa-solid fa-gears" },
                { id: "xjzl", icon: "fa-solid fa-dragon", label: "XJZL.Effect.ConfigTitle" }
            ],
            initial: "details",
            labelPrefix: "EFFECT.TABS"
        }
    };

    /* -------------------------------------------- */

    /** @inheritDoc */
    async _preparePartContext(partId, context) {
        const partContext = await super._preparePartContext(partId, context);
        if (partId === "xjzl") partContext.xjzl = this.#prepareXjzlContext();
        return partContext;
    }

    /**
     * 准备"侠界配置"页上下文：flags 快照 + 脚本数组 + 变更 key 自动补全选项。
     * @returns {object} 供 active-effect-xjzlconfig.hbs 使用的 xjzl 子上下文
     */
    #prepareXjzlContext() {
        const effect = this.document;
        const flags = effect.flags["xjzl-system"] ?? {};

        // 历史数据可能把 scripts 存成数字键对象，统一还原为数组
        let rawScripts = flags.scripts ?? [];
        if (!Array.isArray(rawScripts)) rawScripts = Object.values(rawScripts ?? {});

        const scripts = rawScripts.map(s => ({ ...s, active: s.active !== false }));
        const listId = `xjzl-status-list-${effect.id ?? "new"}`;

        return {
            slug: flags.slug ?? "",
            autoSlug: effect.name?.slugify ? effect.name.slugify() : (effect.name ?? "auto-slug"),
            isStackable: !!flags.stackable,
            maxStacks: Number.isFinite(flags.maxStacks) ? flags.maxStacks : 0,
            isTiedToStance: !!flags.tiedToStance,
            scripts,
            triggerChoices: TRIGGER_CHOICES,
            listId,
            autocompleteKeys: this.#buildAutocompleteKeys()
        };
    }

    /**
     * 汇总变更 key 自动补全候选项：系统状态 flags + 常用数值字段。
     * @returns {{value: string, label: string}[]}
     */
    #buildAutocompleteKeys() {
        const keys = [];
        const statusFlags = CONFIG.XJZL?.statusFlags ?? {};
        for (const [key, label] of Object.entries(statusFlags)) {
            keys.push({ value: `flags.xjzl-system.${key}`, label: game.i18n.localize(label) });
        }
        keys.push(
            { value: "system.resources.hp.value", label: "气血 (HP)" },
            { value: "system.resources.mp.value", label: "内力 (MP)" },
            { value: "system.combat.speed", label: "速度" }
        );
        return keys;
    }

    /* -------------------------------------------- */

    /** @inheritDoc */
    _onRender(context, options) {
        super._onRender(context, options);
        // 变更 key 输入框位于核心 changes 页，渲染时按需挂上 datalist 实现自动补全
        const listId = context.xjzl?.listId;
        if (!listId) return;
        this.element.querySelectorAll('input[name$=".key"]').forEach(input => {
            if (!input.hasAttribute("list")) {
                input.setAttribute("list", listId);
                input.setAttribute("placeholder", "flags...");
            }
        });
    }

    /* -------------------------------------------- */

    /** @inheritDoc */
    _processFormData(event, form, formData) {
        const submitData = super._processFormData(event, form, formData);
        // 表单可能把数字索引字段展开为对象；持久化的 scripts 应为密集数组。
        const flags = submitData.flags?.["xjzl-system"];
        if (flags && flags.scripts !== undefined && !Array.isArray(flags.scripts)) {
            flags.scripts = Object.values(flags.scripts ?? {});
        }
        return submitData;
    }

    /* -------------------------------------------- */

    /**
     * 添加脚本：从当前表单读取未保存状态后追加一条空脚本再整体提交，
     * 保证其他页签（含核心 details/duration/changes）未保存的字段不丢失。
     * @param {PointerEvent} _event
     * @param {HTMLElement} _target
     * @this {XJZLActiveEffectConfig}
     */
    async _onAddScript(_event, _target) {
        const scripts = this.#currentScriptsFromForm();
        scripts.push({ label: "新特效", trigger: "passive", active: true, script: "" });
        return this.submit({ updateData: { flags: { "xjzl-system": { scripts } } } });
    }

    /**
     * 删除脚本：按行内 data-index 从当前表单状态中移除后整体提交。
     * 数组在 mergeObject 中是整体覆盖语义，长度缩短也能正确落库。
     * @param {PointerEvent} _event
     * @param {HTMLElement} target 触发删除的行内按钮（携带 data-index）
     * @this {XJZLActiveEffectConfig}
     */
    async _onDeleteScript(_event, target) {
        const index = Number(target.dataset.index);
        const scripts = this.#currentScriptsFromForm();
        if (!Number.isInteger(index) || index < 0 || index >= scripts.length) return;
        scripts.splice(index, 1);
        return this.submit({ updateData: { flags: { "xjzl-system": { scripts } } } });
    }

    /**
     * 从当前表单读取 scripts 的最新未保存状态。
     * @returns {object[]} 当前表单中的脚本数组（无脚本时为空数组）
     */
    #currentScriptsFromForm() {
        const FormDataClass = foundry.applications.ux?.FormDataExtended || FormDataExtended;
        const submitData = this._processFormData(null, this.form, new FormDataClass(this.form));
        const scripts = submitData.flags?.["xjzl-system"]?.scripts;
        if (Array.isArray(scripts)) return scripts;
        return Object.values(scripts ?? {});
    }
}
