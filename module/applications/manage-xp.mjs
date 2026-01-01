const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLManageXPDialog extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        this.actor = options.actor;
    }

    static DEFAULT_OPTIONS = {
        tag: "form", // 直接把窗口内容渲染为 form 标签，方便提交
        id: "xjzl-manage-xp",
        classes: ["xjzl-window", "xjzl-manage-xp", "theme-dark"], 
        window: {
            title: "修为管理",
            icon: "fas fa-coins",
            resizable: false,
            width: 420,
            height: "auto" // 高度自适应
        },
        position: {
            width: 420
        },
        form: {
            handler: XJZLManageXPDialog.formHandler,
            submitOnChange: false,
            closeOnSubmit: true
        }
    };

    static PARTS = {
        main: {
            template: "systems/xjzl-system/templates/actor/character/manage-xp.hbs"
        }
    };

    /**
     * 准备传递给模板的数据
     */
    async _prepareContext(options) {
        const cult = this.actor.system.cultivation;
        
        // 构造选项列表，方便模板渲染
        const poolChoices = {
            general: `通用修为 (当前: ${cult.general})`,
            neigong: `内功修为 (当前: ${cult.neigong})`,
            wuxue:   `武学修为 (当前: ${cult.wuxue})`,
            arts:    `技艺修为 (当前: ${cult.arts})`
        };

        return {
            actor: this.actor,
            cult: cult,
            poolChoices: poolChoices,
            defaultTitle: "手动调整"
        };
    }

    /**
     * 表单提交处理
     */
    static async formHandler(event, form, formData) {
        // 使用 formData.object 获取解析后的对象
        const data = formData.object;
        
        // 数据校验
        const amount = parseInt(data.amount);
        if (isNaN(amount) || amount === 0) {
            ui.notifications.warn("变动数值不能为 0 或空。");
            return;
        }

        // 调用 Actor 的方法
        await this.actor.manualModifyXP(data.poolKey, amount, {
            title: data.title,
            gameDate: data.gameDate,
            reason: data.reason
        });
    }
}