const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLCharacterWizardApp extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(options) {
        super(options);
        
        this.actor = options.actor;

        this.wizardData = {
            currentStep: 1,
            maxStep: 6,
            
            // Step 1: 基础与背景
            info: {
                name: this.actor.name,
                gender: "male",
                title: "",
                sect: "none",
                appearance: "",
                bio: "",
                silver: 0
            },

            // Step 2: 性格和背景
            origins: { background: null, personality: null },

            // Step 3: 社交网
            social: {
                rep_chaoting: 0, rep_wulin: 0,
                attitude_chaoting: "none", attitude_wulin: "none", attitude_shisu: "none",
                shihao: ["", "", ""], relations: []
            },

            // Step 4: 预算与武学装配
            budget: { general: 0, neigong: 0, wuxue: 0, arts: 0 },
            assembly: { items: [] },

            // Step 5: 技艺与天赋
            artsBonus: {} 
        };
    }

    static DEFAULT_OPTIONS = {
        id: "xjzl-character-wizard",
        tag: "form",
        classes: ["xjzl-window", "theme-dark", "character-wizard-app"], // 复用你的黑暗主题
        position: { width: 950, height: 700 },
        window: {
            title: "侠界之旅 - 角色建卡向导",
            icon: "fas fa-hat-wizard",
            resizable: false
        },
        // 开启表单变化自动提交，方便我们实时抓取输入框数据
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        },
        actions: {
            nextStep: XJZLCharacterWizardApp.prototype._onNextStep,
            prevStep: XJZLCharacterWizardApp.prototype._onPrevStep,
            finishWizard: XJZLCharacterWizardApp.prototype._onFinishWizard
        }
    };

    // 🔥 利用 PARTS 机制拆分模板
    static PARTS = {
        sidebar: {
            template: "systems/xjzl-system/templates/apps/character-wizard/sidebar.hbs",
            classes: ["wizard-sidebar"]
        },
        // 主内容区 (所有步骤都在这一个 Part 里，通过 hbs 的 if 判断显示)
        main: {
            template: "systems/xjzl-system/templates/apps/character-wizard/main.hbs",
            classes: ["wizard-main-content"],
            scrollable: [".wizard-step-body"]
        },
        footer: {
            template: "systems/xjzl-system/templates/apps/character-wizard/footer.hbs",
            classes: ["wizard-footer"]
        }
    };

    /**
     * 将状态传递给模板
     */
    async _prepareContext(options) {
        return {
            actor: this.actor,
            data: this.wizardData, // 传给模板的数据
            isFirstStep: this.wizardData.currentStep === 1,
            isLastStep: this.wizardData.currentStep === this.wizardData.maxStep,
            choices: {
                genders: CONFIG.XJZL.genders,
                sects: CONFIG.XJZL.sects,
                attitudes: CONFIG.XJZL.attitudes,
                hobbies: CONFIG.XJZL.hobbies,
                arts: CONFIG.XJZL.arts
            }
        };
    }

    /* -------------------------------------------- */
    /*  交互与流程控制                              */
    /* -------------------------------------------- */

    /**
     * 捕获表单输入，实时同步到内存中
     * 因为我们配置了 submitOnChange: true，输入框变化会触发此方法
     */
    async _processFormData(event, form, formData) {
        // V13 标准获取 object 的方法
        const dataObj = formData.object;
        
        // 我们利用 foundry 的深度合并功能，将表单数据直接合并到 wizardData.info 或 social 中
        // 只要 hbs 中的 name 属性写成 info.name, info.gender 即可
        foundry.utils.mergeObject(this.wizardData, dataObj);
    }

    async _onNextStep(event, target) {
        event.preventDefault();
        if (this.wizardData.currentStep < this.wizardData.maxStep) {
            this.wizardData.currentStep++;
            this.render(); // 刷新界面
        }
    }

    async _onPrevStep(event, target) {
        event.preventDefault();
        if (this.wizardData.currentStep > 1) {
            this.wizardData.currentStep--;
            this.render(); // 刷新界面
        }
    }

    // ==========================================
    // 🔥 Step 6: 降生结算 (核心写入逻辑)
    // ==========================================
    async _onFinishWizard(event, target) {
        event.preventDefault();
        const actor = this.actor;
        if (!actor) return;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: "初入江湖", icon: "fas fa-check-circle" },
            content: `<p>所有的命运馈赠已计算完毕。</p><p>点击确认，角色将正式降生于江湖之中。此操作不可逆！</p>`,
            rejectClose: false
        });

        if (!confirmed) return;

        ui.notifications.info("正在重塑角色躯体...");

        // 1. 清理旧躯壳
        const oldItemIds = actor.items.map(i => i.id);
        if (oldItemIds.length > 0) {
            await actor.deleteEmbeddedDocuments("Item", oldItemIds);
        }

        // 2. 构建 Actor 核心数据更新
        const actorUpdates = {
            "name": this.wizardData.info.name || "无名氏",
            "system.info": {
                gender: this.wizardData.info.gender,
                title: this.wizardData.info.title,
                sect: this.wizardData.info.sect,
                appearance: this.wizardData.info.appearance,
                bio: this.wizardData.info.bio
            },
            "system.social": this.wizardData.social,
            "system.resources.silver": this.wizardData.info.silver,
            "system.cultivation": {
                general: this.wizardData.budget.general,
                neigong: this.wizardData.budget.neigong,
                wuxue: this.wizardData.budget.wuxue,
                arts: this.wizardData.budget.arts
            }
        };

        // 3. 构建技艺初始赠送 (自定义修改组)
        const artsChanges = [];
        for (const [artKey, level] of Object.entries(this.wizardData.artsBonus)) {
            if (level > 0) {
                artsChanges.push({
                    key: `system.arts.${artKey}.value`, 
                    value: level
                });
            }
        }
        if (artsChanges.length > 0) {
            actorUpdates["system.customModifiers"] = [{
                id: foundry.utils.randomID(),
                name: "初始背景赠送技艺",
                enabled: true,
                changes: artsChanges
            }];
        }

        // 4. 生成创角历史日志
        const historyLog = {
            id: foundry.utils.randomID(),
            realTime: Date.now(),
            type: "text",
            importance: 2,
            title: "踏入江湖",
            reason: "通过向导完成建卡",
            delta: "", balance: ""
        };
        const currentHistory = actor.system.history || [];
        actorUpdates["system.history"] = [historyLog, ...currentHistory];

        // 5. 执行属性更新
        await actor.update(actorUpdates);

        // 6. 批量创建物品
        const itemsToCreate = [];
        if (this.wizardData.origins.background) itemsToCreate.push(this.wizardData.origins.background);
        if (this.wizardData.origins.personality) itemsToCreate.push(this.wizardData.origins.personality);
        if (this.wizardData.assembly.items.length > 0) itemsToCreate.push(...this.wizardData.assembly.items);

        if (itemsToCreate.length > 0) {
            await actor.createEmbeddedDocuments("Item", itemsToCreate);
        }

        // 7. 收尾工作
        ui.notifications.success(`${actor.name} 降生成功！`);
        this.close();
        actor.sheet.render(true);
    }
}