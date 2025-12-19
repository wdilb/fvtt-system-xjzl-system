import { XJZL } from "../config.mjs";
import { localizeConfig } from "../utils/utils.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLPersonalitySheet extends HandlebarsApplicationMixin(ItemSheetV2) {
    constructor(options = {}) {
        super(options);
        this._isEditing = false; // 内部状态：仅控制 GM 编辑视图切换
    }

    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "item", "personality", "xjzl-system"],
        position: { width: 500, height: "auto" },
        window: { resizable: true },
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        },
        actions: {
            toggleEditing: function () { this._isEditing = !this._isEditing; this.render(); },
            manageOption: XJZLPersonalitySheet._onManageOption, // GM 选择 5 个可选技能
            toggleChoice: XJZLPersonalitySheet._onToggleChoice,   // 玩家勾选 2 个生效技能
            editImage: XJZLPersonalitySheet._onEditImage
        }
    };

    static PARTS = {
        header: { template: "systems/xjzl-system/templates/item/personality/header.hbs" },
        details: { template: "systems/xjzl-system/templates/item/personality/details.hbs", scrollable: [""] }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = this.document.system;

        context.system = system;
        context.isEditing = this._isEditing;
        context.isGM = game.user.isGM;

        // 准备所有技能供 GM 勾选
        context.allSkills = localizeConfig(XJZL.skills);

        // 准备当前性格提供的 5 个选项供玩家勾选
        context.availableOptions = system.options.map(key => ({
            key: key,
            label: XJZL.skills[key] || key,
            selected: system.chosen.includes(key)
        }));

        return context;
    }

    /**
     * 处理图片编辑
     */
    static async _onEditImage(event, target) {
        const attr = target.dataset.edit || "img";
        const current = foundry.utils.getProperty(this.document, attr);

        // V13 标准写法：不再直接 new FilePicker
        const fp = new foundry.applications.apps.FilePicker({
            type: "image",
            current: current,
            callback: path => {
                this.document.update({ [attr]: path });
            }
        });
        return fp.browse();
    }

    /**
     * GM 管理 5 个可选技能池
     */
    static async _onManageOption(event, target) {
        const skillKey = target.dataset.skill;
        let options = [...this.document.system.options];

        if (target.checked) {
            if (options.length >= 5) {
                ui.notifications.warn("性格预设最多只能提供 5 个可选技能");
                target.checked = false;
                return;
            }
            if (!options.includes(skillKey)) options.push(skillKey);
        } else {
            options = options.filter(k => k !== skillKey);
            // 如果删除了某个选项，且该选项已被选中，则同步移除选中状态
            if (this.document.system.chosen.includes(skillKey)) {
                const newChosen = this.document.system.chosen.filter(k => k !== skillKey);
                await this.document.update({ "system.chosen": newChosen });
            }
        }

        await this.document.update({ "system.options": options });
    }

    /**
     * 玩家 5 选 2 逻辑
     */
    static async _onToggleChoice(event, target) {
        const skillKey = target.dataset.skill;
        let chosen = [...this.document.system.chosen];

        if (chosen.includes(skillKey)) {
            chosen = chosen.filter(k => k !== skillKey);
        } else {
            if (chosen.length >= 2) {
                ui.notifications.warn(game.i18n.localize("XJZL.Personality.SelectLimit"));
                return;
            }
            chosen.push(skillKey);
        }

        // 1. 更新数据
        await this.document.update({ "system.chosen": chosen });
        // 2. 触发 DataModel 里的 AE 同步方法
        await this.document.system.syncToEffect();
    }
}