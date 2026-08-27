/**
 * 武学物品表单
 */
import { XJZL } from "../config.mjs";
import { localizeConfig } from "../utils/utils.mjs"; // 引入工具函数
import { TRIGGER_CHOICES } from "../data/common.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLWuxueSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "xjzl-martial-editor", "item", "wuxue"],
        position: { width: 980, height: 720 },
        window: { resizable: true },
        // 告诉 V13：“请帮我监听 Input 变化，并且在重绘时保持滚动位置”
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        },
        actions: {
            // 招式操作
            addMove: XJZLWuxueSheet.prototype._onAddMove,
            deleteMove: XJZLWuxueSheet.prototype._onDeleteMove,

            // 嵌套数组操作 (属性加成)
            addScaling: XJZLWuxueSheet.prototype._onAddScaling,
            deleteScaling: XJZLWuxueSheet.prototype._onDeleteScaling,

            // 招式脚本操作
            addMoveScript: XJZLWuxueSheet.prototype._onAddMoveScript,
            deleteMoveScript: XJZLWuxueSheet.prototype._onDeleteMoveScript,

            // 特效Tab操作
            createEffect: XJZLWuxueSheet.prototype._onCreateEffect,
            editEffect: XJZLWuxueSheet.prototype._onEditEffect,
            deleteEffect: XJZLWuxueSheet.prototype._onDeleteEffect,
            toggleEffect: XJZLWuxueSheet.prototype._onToggleEffect,
            //编辑图片
            editImage: XJZLWuxueSheet.prototype._onEditImage,
            // 仅切换界面状态，不写入 Item 数据
            selectMove: XJZLWuxueSheet.prototype._onSelectMove,
            selectMoveSection: XJZLWuxueSheet.prototype._onSelectMoveSection
        }
    };

    static PARTS = {
        header: { template: "systems/xjzl-system/templates/item/wuxue/header.hbs" },
        tabs: { template: "systems/xjzl-system/templates/item/wuxue/tabs.hbs" },

        // 内容 Parts
        details: {
            template: "systems/xjzl-system/templates/item/wuxue/tab-details.hbs",
            // 只登记真正产生滚动的节点，交给 V13 在 Part 替换前后同步 scrollTop/scrollLeft。
            // 不额外监听 scroll 事件，避免与 Foundry 原生恢复重复执行。
            scrollable: [
                ".directory-list",
                ".wuxue-move-stack",
                ".wuxue-book-panel",
                ".move-editor-card.is-selected .move-requirements .martial-rich-preview",
                ".move-editor-card.is-selected .move-description .martial-rich-preview",
                ".wuxue-book-panel .book-requirements .martial-rich-preview",
                ".wuxue-book-panel .book-description .martial-rich-preview"
            ]
        },
        effects: { template: "systems/xjzl-system/templates/item/wuxue/tab-effects.hbs", scrollable: [""] }
    };

    // Foundry 的 submitOnChange 会替换 details Part；额外同步原生 details.open，避免保存后展开项跳变。
    _preSyncPartState(partId, newElement, priorElement, state) {
        super._preSyncPartState(partId, newElement, priorElement, state);
        if (partId !== "details") return;
        state.openScriptCards = Array.from(priorElement.querySelectorAll(".script-card"))
            .map(card => ({ key: card.dataset.scriptKey, open: card.open }))
            .filter(card => card.key);
    }

    _syncPartState(partId, newElement, priorElement, state) {
        super._syncPartState(partId, newElement, priorElement, state);
        if (partId !== "details" || !state.openScriptCards?.length) return;
        const openByKey = new Map(state.openScriptCards.map(card => [card.key, card.open]));
        newElement.querySelectorAll(".script-card").forEach(card => {
            if (openByKey.has(card.dataset.scriptKey)) card.open = openByKey.get(card.dataset.scriptKey);
        });
    }

    tabGroups = { primary: "details" };

    // 招式导航状态只存在于 Sheet 实例，不进入 Item.system。
    _uiState = { selectedMoveId: null, selectedMoveSection: "overview", moveSearchQuery: "" };

    _isRichTextDirty(editor) {
        try {
            return typeof editor?.isDirty === "function" ? editor.isDirty() : Boolean(editor?.isDirty);
        } catch {
            return false;
        }
    }

    async close(options = {}) {
        if (!options.force) {
            const dirtyEditors = Array.from(this.element?.querySelectorAll("prose-mirror") || [])
                .filter(editor => this._isRichTextDirty(editor));
            if (dirtyEditors.length) {
                const confirmed = await foundry.applications.api.DialogV2.confirm({
                    window: { title: game.i18n.localize("XJZL.UI.RichTextUnsavedTitle"), icon: "fas fa-triangle-exclamation" },
                    content: `<p>${game.i18n.localize("XJZL.UI.RichTextUnsavedContent")}</p>`,
                    rejectClose: false
                });
                if (!confirmed) return false;
            }
        }
        return super.close(options);
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        this._uiState ??= { selectedMoveId: null, selectedMoveSection: "overview", moveSearchQuery: "" };
        context.selectedMoveSection = this._uiState.selectedMoveSection || "overview";
        context.moveSearchQuery = this._uiState.moveSearchQuery || "";
        // 表单必须编辑持久化的源数据（其中可能含等级公式），而不是
        // prepareDerivedData 生成的当前等级显示值。
        context.system = this.document.system.toObject(true);
        const preparedMoves = this.document.system.moves || [];
        const preparedMovesById = new Map(preparedMoves.map(move => [move.id, move]));

        const moveIds = (context.system.moves || []).map(move => move.id);
        if (this._uiState.selectedMoveId !== "__book__" && !moveIds.includes(this._uiState.selectedMoveId)) {
            this._uiState.selectedMoveId = moveIds[0] ?? "__book__";
        }
        context.bookOverviewSelected = this._uiState.selectedMoveId === "__book__";

        // 只把界面需要的衍生属性叠加到源数据副本；绝不覆盖 description、
        // range、actionCost，确保自动保存不会把公式替换成当前等级快照。
        for (const [index, sourceMove] of (context.system.moves || []).entries()) {
            const preparedMove = preparedMovesById.get(sourceMove.id) ?? preparedMoves[index];
            if (!preparedMove) continue;

            for (const key of [
                "computedTier",
                "computedLevel",
                "maxLevel",
                "effectiveStage",
                "progress",
                "currentCost",
                "baseFeint"
            ]) {
                sourceMove[key] = preparedMove[key];
            }
            sourceMove._preparedDescription = preparedMove.description;
        }
        context.tabs = this.tabGroups;

        // 1. 侧边栏总纲描述 (异步解析)
        const enrich = value => foundry.applications.ux.TextEditor.implementation.enrichHTML(
            value || "",
            { secrets: this.document.isOwner, async: true, relativeTo: this.document }
        );
        [context.enrichedDescription, context.enrichedRequirements] = await Promise.all([
            enrich(this.document.system.description),
            enrich(this.document.system.requirements)
        ]);

        // 1. 准备下拉菜单选项
        context.choices = {
            tiers: localizeConfig(XJZL.tiers),
            sects: localizeConfig(XJZL.sects),
            subSects: localizeConfig(XJZL.subSects || {}), //二级势力
            moveTiers: {
                "": "继承 (默认)",
                1: game.i18n.localize("XJZL.Tiers.1"),
                2: game.i18n.localize("XJZL.Tiers.2"),
                3: game.i18n.localize("XJZL.Tiers.3")
            },
            categories: localizeConfig(XJZL.wuxueCategories),
            moveTypes: localizeConfig(XJZL.moveTypes),
            elements: localizeConfig(XJZL.elements),
            actionTypes: {
                buff: "BUFF",
                heal: "治疗",
                attack: "攻击"
            },
            doubleFeintModes: {
                both: game.i18n.localize("XJZL.Wuxue.Moves.DoubleFeintModeBoth"),
                any: game.i18n.localize("XJZL.Wuxue.Moves.DoubleFeintModeAny")
            },
            attributes: localizeConfig(XJZL.attributes),
            weaponTypes: localizeConfig(XJZL.weaponTypes),
            damageTypes: localizeConfig(XJZL.damageTypes),
            triggers: localizeConfig(XJZL.effectTriggers),
            targets: localizeConfig(XJZL.effectTargets),
            progressionModes: {
                standard: game.i18n.localize("XJZL.Wuxue.Progression.ModeList.standard"),
                custom: game.i18n.localize("XJZL.Wuxue.Progression.ModeList.custom")
            },
            mappedStages: {
                0: game.i18n.localize("XJZL.Wuxue.Progression.StageList.0"),
                1: game.i18n.localize("XJZL.Wuxue.Progression.StageList.1"),
                2: game.i18n.localize("XJZL.Wuxue.Progression.StageList.2"),
                3: game.i18n.localize("XJZL.Wuxue.Progression.StageList.3"),
                4: game.i18n.localize("XJZL.Wuxue.Progression.StageList.4"),
                5: game.i18n.localize("XJZL.Wuxue.Progression.StageList.5")
            }
        };

        context.isJianghuShiLi = this.document.system.sect === "jianghushili";

        // 触发器下拉选项
        context.scriptTriggerChoices = {};
        for (const [key, labelKey] of Object.entries(TRIGGER_CHOICES)) {
            context.scriptTriggerChoices[key] = game.i18n.localize(labelKey);
        }

        // 2. 准备特效列表
        context.effects = this.document.effects.map(e => {
            return {
                id: e.id,
                name: e.name,
                img: e.img,
                disabled: e.disabled,
                description: e.description,
                isSuppressed: e.isSuppressed
            };
        });

        // 3. 准备招式列表 (使用 Promise.all 并行处理)
        if (context.system.moves && context.system.moves.length > 0) {

            // 并行解析所有招式的富文本，避免逐项串行等待。
            await Promise.all(context.system.moves.map(async move => {

                // 解析每个招式的描述
                // 编辑器的 value 使用原始 description；预览区域使用计算后的描述。
                [move.enrichedDescription, move.enrichedRequirements] = await Promise.all([
                    enrich(move._preparedDescription || ""),
                    enrich(move.requirements)
                ]);
                delete move._preparedDescription;

                // 为下拉菜单准备一个专门的值：如果 tier 是 null，就转为空字符串 ""
                // 这样 selectOptions 就能匹配到 choices 中的 "" 选项了
                move.uiTierSelected = move.tier ?? "";

                let levels = [];
                let labels = [];
                // 注入 CSS 类名
                move._uiClass = `type-${move.type || 'real'}`;
                // 招式类型已经由颜色与文字区分，图标统一为剑势，减少视觉噪音。
                move._uiIcon = "fa-sword";

                // 判断模式
                const mode = move.progression?.mode || "standard";

                if (mode === "custom") {
                    const count = Math.max(1, move.progression?.customThresholds?.length || 1);
                    for (let i = 0; i < count; i++) {
                        levels.push(i);
                        labels.push(`L${i + 1}`);
                    }
                } else {
                    const moveTier = move.computedTier ?? (move.tier ?? (context.system.tier || 1));
                    const count = (moveTier === 3) ? 4 : 3;
                    const tierLabels = (moveTier === 3)
                        ? ["领悟", "掌握", "精通", "合一"]
                        : ["领悟", "掌握", "精通"];

                    for (let i = 0; i < count; i++) {
                        levels.push(i);
                        labels.push(tierLabels[i]);
                    }
                    move._uiTier = moveTier;
                }

                move._ui = {
                    costLevels: levels,
                    costLabels: labels
                };
                move._uiOpenScripts = (move.scripts || []).map((_, scriptIndex) =>
                    this._uiState.openScriptKey === `${move.id}:${scriptIndex}`
                );
                move._uiSelected = move.id === this._uiState.selectedMoveId;
                move._uiSection = this._uiState.selectedMoveSection || "overview";
            }));
        }

        return context;
    }

    /**
     * 处理表单提交数据
     * 核心逻辑：拦截 "temp.thresholds" 代理字段，将字符串转换为数字数组，并写入 system 数据
     */
    _prepareSubmitData(event, form, formData) {
        // 1. 获取基础数据
        const data = super._prepareSubmitData(event, form, formData);

        // 2. 直接遍历 FormData 查找临时字段 (比操作 data 对象更稳健)
        for (const [key, value] of formData.entries()) {

            // 匹配 HBS 中定义的 name="temp.thresholds.{{i}}"
            if (key.startsWith("temp.thresholds.")) {

                // 提取索引
                const parts = key.split(".");
                const indexStr = parts[parts.length - 1];
                const i = parseInt(indexStr);

                // 解析逻辑: "1000, 2000" -> [1000, 2000]
                let arr = [];
                if (typeof value === "string" && value.trim() !== "") {
                    arr = value.split(/[,，]/) // 兼容中英文逗号
                        .map(s => Number(s.trim()))
                        .filter(n => !isNaN(n)); // 过滤非数字
                } else if (typeof value === "number") {
                    arr = [value];
                }

                // 3. 将处理好的数组写入正确的系统路径
                // 使用 setProperty 确保深层路径正确创建
                foundry.utils.setProperty(data, `system.moves.${i}.progression.customThresholds`, arr);
            }
        }

        // 4. 清理临时数据容器，防止 Schema 校验报错
        if ("temp" in data) {
            delete data.temp;
        }

        return data;
    }

    /* -------------------------------------------- */
    /*  自动保存 (Auto-Save)                        */
    /* -------------------------------------------- */
    _onRender(context, options) {
        super._onRender(context, options);
        // 注入品阶类名 (Rank Coloring)
        const allRanks = ["rank-ren", "rank-di", "rank-tian"];
        this.element.classList.remove(...allRanks);

        // 武学品阶: 1(人) / 2(地) / 3(天)
        const tierMap = { 1: "ren", 2: "di", 3: "tian" };
        const val = this.document.system.tier;
        const targetClass = tierMap[val] || "ren";

        this.element.classList.add(`rank-${targetClass}`);

        const search = this.element.querySelector("[data-move-search]");
        if (search && !search.dataset.bound) {
            search.dataset.bound = "true";
            search.addEventListener("input", event => {
                this._uiState ??= { selectedMoveId: null, selectedMoveSection: "overview", moveSearchQuery: "" };
                this._uiState.moveSearchQuery = event.currentTarget.value || "";
                const query = this._uiState.moveSearchQuery.trim().toLocaleLowerCase();
                this.element.querySelectorAll(".wuxue-move-entry").forEach(entry => {
                    const name = entry.querySelector(".move-entry-copy strong")?.textContent || "";
                    entry.hidden = Boolean(query) && !name.toLocaleLowerCase().includes(query);
                });
            });
        }
    }

    /* -------------------------------------------- */
    /*  嵌套数组操作                  */
    /* -------------------------------------------- */

    /** 切换当前编辑的招式，仅改变界面，不触发文档更新。 */
    _onSelectMove(event, target) {
        const moveId = target.dataset.moveId;
        if (!moveId) return;
        this._uiState ??= { selectedMoveId: null, selectedMoveSection: "overview", moveSearchQuery: "" };
        this._uiState.selectedMoveId = moveId;

        // 直接切换现有 DOM，避免点击谱录时打断当前输入框的自动保存。
        this.element.querySelectorAll(".directory-entry").forEach(entry => {
            const selected = entry.dataset.moveId === moveId;
            entry.classList.toggle("is-selected", selected);
            entry.setAttribute("aria-pressed", String(selected));
        });
        this.element.querySelectorAll(".move-editor-card[data-move-id]").forEach(card => {
            const selected = card.dataset.moveId === moveId;
            card.classList.toggle("is-selected", selected);
            card.classList.toggle("is-collapsed", !selected);
        });
        const bookPanel = this.element.querySelector(".wuxue-book-panel");
        const bookSelected = moveId === "__book__";
        bookPanel?.classList.toggle("is-selected", bookSelected);
        bookPanel?.classList.toggle("is-collapsed", !bookSelected);
        this.element.querySelector(".move-section-tabs")?.classList.toggle("is-hidden", bookSelected);
        this.element.querySelector(".wuxue-move-stack")?.classList.toggle("is-hidden", bookSelected);
    }

    /** 切换当前招式的编辑分区，仅改变界面，不触发文档更新。 */
    _onSelectMoveSection(event, target) {
        const section = target.dataset.section;
        if (!section) return;
        this._uiState ??= { selectedMoveId: null, selectedMoveSection: "overview", moveSearchQuery: "" };
        this._uiState.selectedMoveSection = section;
        this.element.querySelectorAll(".move-section-tabs [data-section]").forEach(button => {
            button.classList.toggle("is-selected", button.dataset.section === section);
        });
        this.element.querySelectorAll(".move-editor-card.is-selected [data-move-section-panel]").forEach(panel => {
            const selected = panel.dataset.moveSectionPanel === section;
            panel.classList.toggle("is-selected", selected);
            panel.classList.toggle("is-collapsed", !selected);
        });
    }

    // 通用辅助：获取当前招式及招式集合
    _getMove(target) {
        const index = Number(target.closest("[data-move-index]").dataset.moveIndex);
        const source = this.document.system.toObject(true);
        const moves = source.moves || [];
        return { moves, move: moves[index] };
    }

    // --- 属性加成 (Scalings) ---
    async _onAddScaling(event, target) {
        const { moves, move } = this._getMove(target);
        // 向该招式的 scalings 数组追加
        move.calculation.scalings.push({ prop: "liliang", ratio: 0.5 });
        await this.document.update({ "system.moves": moves });
    }

    async _onDeleteScaling(event, target) {
        const { moves, move } = this._getMove(target);
        const scalingIndex = Number(target.dataset.idx);
        // 删除指定索引
        move.calculation.scalings.splice(scalingIndex, 1);
        await this.document.update({ "system.moves": moves });
    }

    /* -------------------------------------------- */
    /*  Moves Logic (招式管理)                      */
    /* -------------------------------------------- */

    async _onAddMove(event, target) {
        const source = this.document.system.toObject(true);
        const moves = source.moves || [];

        // 创建新招式默认数据
        const newMove = {
            id: foundry.utils.randomID(),
            name: "新招式",
            img: "icons/svg/sword.svg",
            type: "real",
            // 明确初始化 tier 为 null (继承)
            tier: null,
            costs: { mp: [], rage: [], hp: [] },
            applyEffects: [],
            calculation: { scalings: [] }
        };

        this._uiState ??= { selectedMoveId: null, selectedMoveSection: "overview", moveSearchQuery: "" };
        this._uiState.selectedMoveId = newMove.id;
        await this.document.update({
            "system.moves": [...moves, newMove]
        });
    }

    async _onDeleteMove(event, target) {
        const moveId = target.dataset.id;
        const source = this.document.system.toObject(true);
        const moves = source.moves || [];

        // 按 ID 过滤
        const newMoves = moves.filter(m => m.id !== moveId);

        // 确认弹窗
        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("XJZL.UI.Delete") },
            content: `<p>${game.i18n.format("XJZL.Wuxue.DeleteMoveConfirm", { name: moves.find(move => move.id === moveId)?.name || "" })}</p>`,
            rejectClose: false
        });

        if (confirm) {
            this._uiState ??= { selectedMoveId: null, selectedMoveSection: "overview", moveSearchQuery: "" };
            if (this._uiState.selectedMoveId === moveId) {
                const deletedIndex = moves.findIndex(move => move.id === moveId);
                const fallback = newMoves[deletedIndex] || newMoves[deletedIndex - 1] || newMoves[0];
                this._uiState.selectedMoveId = fallback?.id ?? "__book__";
            }
            await this.document.update({ "system.moves": newMoves });
        }
    }

    /* -------------------------------------------- */
    /*  Active Effects Logic (特效管理)             */
    /* -------------------------------------------- */

    async _onCreateEffect(event, target) {
        // 创建一个新的 AE 文档嵌入到此 Item
        return ActiveEffect.create({
            name: "新特效",
            icon: "icons/svg/aura.svg",
            origin: this.document.uuid,
            // 默认为不自动应用 (transfer=false)，因为这是给招式触发用的
            transfer: false
        }, { parent: this.document });
    }

    async _onEditEffect(event, target) {
        const effectId = target.dataset.id;
        const effect = this.document.effects.get(effectId);
        if (effect) effect.sheet.render(true);
    }

    async _onDeleteEffect(event, target) {
        const effectId = target.dataset.id;
        const effect = this.document.effects.get(effectId);
        if (!effect) return;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("XJZL.UI.Delete") },
            content: `<p>${game.i18n.format("XJZL.Wuxue.DeleteEffectConfirm", { name: effect.name })}</p>`,
            rejectClose: false
        });
        if (confirmed) await effect.delete();
    }

    async _onToggleEffect(event, target) {
        const effectId = target.dataset.id;
        const effect = this.document.effects.get(effectId);
        if (effect) await effect.update({ disabled: !effect.disabled });
    }

    /* -------------------------------------------- */
    /*  Moves Script Logic (招式脚本管理)            */
    /* -------------------------------------------- */

    /**
     * 添加招式脚本
     */
    async _onAddMoveScript(event, target) {
        const { moves, move } = this._getMove(target);

        // 确保 scripts 数组存在
        if (!move.scripts) move.scripts = [];

        move.scripts.push({
            label: "新特效",
            trigger: "calc", // 招式默认为计算修正
            script: "",
            active: true
        });

        this._uiState ??= { selectedMoveId: null, selectedMoveSection: "overview", moveSearchQuery: "" };
        this._uiState.openScriptKey = `${move.id}:${move.scripts.length - 1}`;

        await this.document.update({ "system.moves": moves });
    }

    /**
     * 删除招式脚本
     */
    async _onDeleteMoveScript(event, target) {
        const { moves, move } = this._getMove(target);
        const scriptIndex = Number(target.dataset.idx);

        if (move.scripts) {
            if (move.scripts[scriptIndex]?.script || move.scripts[scriptIndex]?.label) {
                const confirmed = await foundry.applications.api.DialogV2.confirm({
                    window: { title: game.i18n.localize("XJZL.UI.Delete") },
                    content: `<p>${game.i18n.localize("XJZL.Wuxue.DeleteScriptConfirm")}</p>`,
                    rejectClose: false
                });
                if (!confirmed) return;
            }
            move.scripts.splice(scriptIndex, 1);
            await this.document.update({ "system.moves": moves });
        }
    }

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
}
