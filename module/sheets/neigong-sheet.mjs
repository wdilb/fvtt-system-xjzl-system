/**
 * 先简单写一个让系统运行起来
 */
/* module/sheets/item-sheet.mjs */
const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;
import { TRIGGER_CHOICES } from "../data/common.mjs";
import { getModifierChoices, localizeConfig  } from "../utils/utils.mjs";
import { XJZLModifierPicker } from "../applications/modifier-picker.mjs";

export class XJZLNeigongSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        // xjzl-window 触发 Grid 布局, item-neigong 用于特定样式
        classes: ["xjzl-window", "item-neigong", "theme-dark"],
        position: { width: 1000, height: 700 },
        window: { resizable: true },
        // 告诉 V13：“请帮我监听 Input 变化，并且在重绘时保持滚动位置”
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        },
        actions: {
            // 圆满属性修正
            addMasteryChange: XJZLNeigongSheet.prototype._onAddMasteryChange,
            deleteMasteryChange: XJZLNeigongSheet.prototype._onDeleteMasteryChange,

            // 阶段脚本操作
            addStageScript: XJZLNeigongSheet.prototype._onAddStageScript,
            deleteStageScript: XJZLNeigongSheet.prototype._onDeleteStageScript,

            // Active Effects 操作
            createEffect: XJZLNeigongSheet.prototype._onCreateEffect,
            editEffect: XJZLNeigongSheet.prototype._onEditEffect,
            deleteEffect: XJZLNeigongSheet.prototype._onDeleteEffect,
            toggleEffect: XJZLNeigongSheet.prototype._onToggleEffect,
            // 修改图片
            editImage: XJZLNeigongSheet.prototype._onEditImage,
            // 打开修正选择器
            openModifierPicker: XJZLNeigongSheet.prototype._onOpenModifierPicker
        }
    };

    /* 
       定义各个部分。
       注意：Header 对应侧栏，Tabs 对应右侧书脊，其余对应中间内容。
    */
    static PARTS = {
        header: { template: "systems/xjzl-system/templates/item/neigong/header.hbs" },
        tabs: { template: "systems/xjzl-system/templates/item/neigong/tabs.hbs" },
        config: { template: "systems/xjzl-system/templates/item/neigong/tab-config.hbs", scrollable: [""] },
        effects: { template: "systems/xjzl-system/templates/item/neigong/tab-effects.hbs", scrollable: [""] }
    };

    tabGroups = { primary: "config" };

    /* -------------------------------------------- */
    /*  数据准备                                    */
    /* -------------------------------------------- */

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.system = this.document.system;
        context.tabs = this.tabGroups;

        // 1. 本地化下拉菜单
        context.elementChoices = {
            "yin": game.i18n.localize("XJZL.Neigong.ElementYin"),
            "yang": game.i18n.localize("XJZL.Neigong.ElementYang"),
            "taiji": game.i18n.localize("XJZL.Neigong.ElementTaiji")
        };

        context.tierChoices = {
            1: game.i18n.localize("XJZL.Tiers.1"),
            2: game.i18n.localize("XJZL.Tiers.2"),
            3: game.i18n.localize("XJZL.Tiers.3")
        };

        // 触发器下拉选项
        context.scriptTriggerChoices = {};
        for (const [key, labelKey] of Object.entries(TRIGGER_CHOICES)) {
            context.scriptTriggerChoices[key] = game.i18n.localize(labelKey);
        }

        context.sects = localizeConfig(CONFIG.XJZL.sects);

        // 2. 内功阶段配置
        if (this.document.type === "neigong") {
            context.stages = [
                { id: 1, label: "XJZL.Neigong.Stage1", key: "stage1" },
                { id: 2, label: "XJZL.Neigong.Stage2", key: "stage2" },
                { id: 3, label: "XJZL.Neigong.Stage3", key: "stage3" }
            ];
        }
        // 3. 准备特效列表 (用于 Effects Tab)
        context.effects = this.document.effects.map(e => {
            return {
                id: e.id,
                name: e.name,
                img: e.img,
                disabled: e.disabled,
                description: e.description,
                isSuppressed: e.isSuppressed // V11+ 特性
            };
        });

        // === 动态样式数据 ===
        // 1. 品阶 Class: tier-1 (凡/人), tier-2 (地), tier-3 (天)
        context.tierClass = `tier-${this.document.system.tier || 1}`;

        // 2. 五行 Class: element-taiji, element-yin, element-yang
        context.elementClass = `element-${this.document.system.element || "taiji"}`;

        // 1. 获取原始的分组数据
        const groupedChoices = getModifierChoices();
        context.modifierChoices = groupedChoices;

        // 2. 扁平化数据，用于“Key -> Label”的快速查找
        // 这样在 HBS 里我们就能显示 "力量 (Mod)" 而不是 "stats.liliang.mod"
        const flatModifiers = {};
        for (const group of Object.values(groupedChoices)) {
            Object.assign(flatModifiers, group);
        }

        // 3. 将扁平映射挂载到 context，或者直接处理当前的数据
        // 既然我们是在遍历 system.masteryChanges，我们在那里注入 label 比较方便
        if (context.system.masteryChanges) {
            context.system.masteryChanges.forEach(change => {
                // 如果字典里有这个 key，就用字典的 label，否则显示 key 本身
                change.displayLabel = flatModifiers[change.key] || change.key || "请选择...";
            });
        }

        return context;
    }

    /* -------------------------------------------- */
    /*  生命周期与事件监听                          */
    /* -------------------------------------------- */

    /**
     * 自动保存逻辑
     * AppV2 默认不监听 input change，我们需要手动触发 submit
     */
    // _onRender(context, options) {
    //     super._onRender(context, options);

    //     // 性能优化：事件委托
    //     if (!this.element.dataset.delegated) {
    //         this.element.addEventListener("change", (event) => {
    //             const target = event.target;
    //             if (target.matches("input, select, textarea")) {
    //                 this.submit();
    //             }
    //         });
    //         this.element.dataset.delegated = "true";
    //     }
    // }

    /* -------------------------------------------- */
    /*  Action Handlers (动作处理)                  */
    /* -------------------------------------------- */

    /**
     * 打开属性选择器 (内功卡)
     */
    async _onOpenModifierPicker(event, target) {
        event.preventDefault();

        const index = Number(target.dataset.index);

        // 1. 从 DOM 抓取当前可能未保存的数值 (防回滚)
        const row = target.closest(".mastery-grid-row");
        const valInput = row.querySelector(`input[name="system.masteryChanges.${index}.value"]`);
        const lblInput = row.querySelector(`input[name="system.masteryChanges.${index}.label"]`);

        // 获取当前文档中的旧值作为兜底
        const currentEntry = this.document.system.masteryChanges[index] || {};

        // 优先取输入框的实时值
        const currentValue = valInput ? Number(valInput.value) : (currentEntry.value || 0);
        const currentLabel = lblInput ? lblInput.value : (currentEntry.label || "");

        // 2. 打开选择器
        new XJZLModifierPicker({
            choices: getModifierChoices(),
            selected: currentEntry.key,
            callback: async (newKey) => {

                // A. 深拷贝数组 (切断引用)
                // 这里的数组通常很小(也就几条到十几条)，深拷贝瞬间完成
                const newChanges = foundry.utils.deepClone(this.document.system.masteryChanges);

                // B. 修改目标项
                if (newChanges[index]) {
                    newChanges[index].key = newKey;
                    newChanges[index].value = currentValue;
                    newChanges[index].label = currentLabel;
                } else {
                    // 如果万一这个索引不存在(极罕见)，补上它
                    newChanges[index] = { key: newKey, value: currentValue, label: currentLabel };
                }

                // C. 写回整个数组
                await this.document.update({
                    "system.masteryChanges": newChanges
                });
            }
        }).render(true);
    }

    /**
     * 动作: 添加一行圆满修正
     */
    async _onAddMasteryChange(event, target) {
        // 获取当前数组，如果是 undefined 则初始化为空数组
        const changes = this.document.system.masteryChanges || [];

        // 更新数据：追加一个新的空对象
        await this.document.update({
            "system.masteryChanges": [
                ...changes,
                { key: "", value: 0, label: "" }
            ]
        });
        // AppV2 会自动重新渲染界面
    }

    /**
     * 动作: 删除一行圆满修正
     */
    async _onDeleteMasteryChange(event, target) {
        const index = Number(target.dataset.index);
        const changes = this.document.system.masteryChanges || [];

        // 过滤掉指定索引的项
        const newChanges = changes.filter((_, i) => i !== index);

        await this.document.update({
            "system.masteryChanges": newChanges
        });
    }

    /**
     * 添加脚本到指定阶段
     * 需要 target.dataset.stage (如 "stage1")
     */
    async _onAddStageScript(event, target) {
        const stageKey = target.dataset.stage;
        if (!stageKey) return;

        // 获取当前阶段配置
        const stageConfig = this.document.system.config[stageKey];
        // 获取当前脚本数组 (如果数据结构升级前为空，则初始化)
        const currentScripts = stageConfig.scripts || [];

        const newScript = {
            label: "新特效",
            trigger: "passive", // 内功默认是被动
            script: "",
            active: true
        };

        await this.document.update({
            [`system.config.${stageKey}.scripts`]: [...currentScripts, newScript]
        });
    }

    /**
     * 删除指定阶段的脚本
     * 需要 dataset.stage 和 dataset.index
     */
    async _onDeleteStageScript(event, target) {
        const stageKey = target.dataset.stage;
        const index = Number(target.dataset.index);
        if (!stageKey || isNaN(index)) return;

        const stageConfig = this.document.system.config[stageKey];
        const currentScripts = stageConfig.scripts || [];
        const newScripts = currentScripts.filter((_, i) => i !== index);

        await this.document.update({
            [`system.config.${stageKey}.scripts`]: newScripts
        });
    }

    /* --- 新增：Active Effects 管理 --- */

    async _onCreateEffect(event, target) {
        return ActiveEffect.create({
            name: this.document.name,
            icon: this.document.img,
            origin: this.document.uuid,
            transfer: false // 内功的被动通常在圆满特效就搞定了，这里如果配置的话一般是特有buff/debuff
        }, { parent: this.document });
    }

    async _onEditEffect(event, target) {
        const effectId = target.dataset.id;
        this.document.effects.get(effectId)?.sheet.render(true);
    }

    async _onDeleteEffect(event, target) {
        const effectId = target.dataset.id;
        this.document.effects.get(effectId)?.delete();
    }

    async _onToggleEffect(event, target) {
        const effectId = target.dataset.id;
        const effect = this.document.effects.get(effectId);
        if (effect) await effect.update({ disabled: !effect.disabled });
    }

    /**
     * 打开文件选择器更改图片
     */
    async _onEditImage(event, target) {
        const attr = target.dataset.edit || "img";
        const fp = new foundry.applications.apps.FilePicker({
            type: "image",
            current: foundry.utils.getProperty(this.document, attr),
            callback: path => this.document.update({ [attr]: path })
        });
        return fp.browse();
    }
}