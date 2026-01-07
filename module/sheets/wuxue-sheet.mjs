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
        classes: ["xjzl-window", "item", "wuxue", "theme-dark"],
        position: { width: 1050, height: 800 }, // 武学卡需要宽一点
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
            editImage: XJZLWuxueSheet.prototype._onEditImage
        }
    };

    static PARTS = {
        header: { template: "systems/xjzl-system/templates/item/wuxue/header.hbs", scrollable: [".xjzl-sidebar__content"] },
        tabs: { template: "systems/xjzl-system/templates/item/wuxue/tabs.hbs" },

        // 内容 Parts
        details: { template: "systems/xjzl-system/templates/item/wuxue/tab-details.hbs", scrollable: [""] },
        effects: { template: "systems/xjzl-system/templates/item/wuxue/tab-effects.hbs", scrollable: [""] }
    };

    tabGroups = { primary: "details" };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.system = this.document.system;
        context.tabs = this.tabGroups;

        // 1. 侧边栏总纲描述 (异步解析)
        context.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
            this.document.system.description,
            { secrets: this.document.isOwner, async: true, relativeTo: this.document }
        );

        // 1. 准备下拉菜单选项
        context.choices = {
            tiers: localizeConfig(XJZL.tiers),
            sects: localizeConfig(XJZL.sects),
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
                default: "默认",
                heal: "治疗",
                attack: "攻击"
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

            // 将原来的 forEach 替换为 map + async，并用 Promise.all 等待所有解析完成
            // 这是一个并行操作，不会因为招式多而阻塞
            await Promise.all(context.system.moves.map(async (move) => {

                // 解析每个招式的描述
                // 这里需要处理 description 可能为 null 的情况
                move.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
                    move.description || "",
                    { secrets: this.document.isOwner, async: true, relativeTo: this.document }
                );

                // 为下拉菜单准备一个专门的值：如果 tier 是 null，就转为空字符串 ""
                // 这样 selectOptions 就能匹配到 choices 中的 "" 选项了
                move.uiTierSelected = move.tier ?? "";
                
                let levels = [];
                let labels = [];
                // 注入 CSS 类名
                move._uiClass = `type-${move.type || 'real'}`;

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
    }

    /* -------------------------------------------- */
    /*  嵌套数组操作                  */
    /* -------------------------------------------- */

    // 通用辅助：获取招式和索引
    _getMove(target) {
        const index = Number(target.closest("[data-move-index]").dataset.moveIndex);
        const source = this.document.system.toObject();
        const moves = source.moves || [];
        return { index, moves, move: moves[index] };
    }

    // --- 属性加成 (Scalings) ---
    async _onAddScaling(event, target) {
        const { index, moves, move } = this._getMove(target);
        // 向该招式的 scalings 数组追加
        move.calculation.scalings.push({ prop: "liliang", ratio: 0.5 });
        await this.document.update({ "system.moves": moves });
    }

    async _onDeleteScaling(event, target) {
        const { index, moves, move } = this._getMove(target);
        const scalingIndex = Number(target.dataset.idx);
        // 删除指定索引
        move.calculation.scalings.splice(scalingIndex, 1);
        await this.document.update({ "system.moves": moves });
    }

    /* -------------------------------------------- */
    /*  Moves Logic (招式管理)                      */
    /* -------------------------------------------- */

    async _onAddMove(event, target) {
        const source = this.document.system.toObject();
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

        await this.document.update({
            "system.moves": [...moves, newMove]
        });
    }

    async _onDeleteMove(event, target) {
        const moveId = target.dataset.id;
        const source = this.document.system.toObject();
        const moves = source.moves || [];

        // 按 ID 过滤
        const newMoves = moves.filter(m => m.id !== moveId);

        // 确认弹窗
        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: "删除招式" },
            content: "<p>确定要删除这个招式吗？</p>",
            rejectClose: false
        });

        if (confirm) {
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
        if (effect) await effect.delete();
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

        await this.document.update({ "system.moves": moves });
    }

    /**
     * 删除招式脚本
     */
    async _onDeleteMoveScript(event, target) {
        const { moves, move } = this._getMove(target);
        const scriptIndex = Number(target.dataset.idx);

        if (move.scripts) {
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