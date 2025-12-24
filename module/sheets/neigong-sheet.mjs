/**
 * 先简单写一个让系统运行起来
 */
/* module/sheets/item-sheet.mjs */
const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;
import { TRIGGER_CHOICES } from "../data/common.mjs";

export class XJZLNeigongSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        // xjzl-window 触发 Grid 布局, item-neigong 用于特定样式
        classes: ["xjzl-window", "item-neigong"],
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