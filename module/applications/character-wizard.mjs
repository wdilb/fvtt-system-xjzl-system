import { XJZLSectSelectorApp } from "./sect-selector.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLCharacterWizardApp extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(options) {
        super(options);

        this.actor = options.actor;

        // 核心：内存状态机 (State)
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

            origins: { background: null, personality: null },
            social: {
                rep_chaoting: 0, rep_wulin: 0,
                attitude_chaoting: "none", attitude_wulin: "none", attitude_shisu: "none",
                shihao: ["", "", ""], relations: []
            },
            budget: { general: 0, neigong: 0, wuxue: 0, arts: 0 },
            assembly: { items: [] },
            artsBonus: {}
        };
    }

    static DEFAULT_OPTIONS = {
        id: "xjzl-character-wizard",
        tag: "form",
        classes: ["xjzl-window", "theme-dark", "character-wizard-app"],
        // 尺寸放大：占据屏幕视觉中心，更有RPG游戏建卡感
        position: { width: 1200, height: 750 },
        window: {
            title: "侠界之旅 - 角色建卡向导",
            icon: "fas fa-hat-wizard",
            resizable: false
        },
        // 关键：关闭自动提交，由我们手动接管数据
        form: {
            submitOnChange: false,
            closeOnSubmit: false
        },
        actions: {
            nextStep: XJZLCharacterWizardApp.prototype._onNextStep,
            prevStep: XJZLCharacterWizardApp.prototype._onPrevStep,
            finishWizard: XJZLCharacterWizardApp.prototype._onFinishWizard,
            openSectSelector: XJZLCharacterWizardApp.prototype._onOpenSectSelector, // 门派选择器
            selectOriginItem: XJZLCharacterWizardApp.prototype._onSelectOriginItem, // 选择背景/性格
            togglePersonalitySkill: XJZLCharacterWizardApp.prototype._onTogglePersonalitySkill, // 勾选性格技能
            addRelation: XJZLCharacterWizardApp.prototype._onAddRelation, // 增加关系
            deleteRelation: XJZLCharacterWizardApp.prototype._onDeleteRelation // 删除关系
        }
    };

    static PARTS = {
        sidebar: {
            template: "systems/xjzl-system/templates/apps/character-wizard/sidebar.hbs",
            classes: ["wizard-sidebar"]
        },
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

    async _prepareContext(options) {
        // === 将数据缓存到 this 实例上，方便 DOM 极速读取 ===
        if (!this.cachedOrigins) {
            this.cachedOrigins = { backgrounds: [], personalities: [] };
            const originsPack = game.packs.get("xjzl-system.origins");

            if (originsPack) {
                const docs = await originsPack.getDocuments();
                this.cachedOrigins.backgrounds = docs.filter(d => d.type === "background").map(d => {
                    const obj = d.toObject();
                    obj.uuid = d.uuid;
                    return obj;
                });
                this.cachedOrigins.personalities = docs.filter(d => d.type === "personality").map(d => {
                    const obj = d.toObject();
                    obj.uuid = d.uuid;
                    return obj;
                });
            }
        }

        return {
            actor: this.actor,
            data: this.wizardData,
            isFirstStep: this.wizardData.currentStep === 1,
            isLastStep: this.wizardData.currentStep === this.wizardData.maxStep,
            choices: {
                genders: CONFIG.XJZL.genders,
                sects: CONFIG.XJZL.sects,
                attitudes: CONFIG.XJZL.attitudes,
                hobbies: CONFIG.XJZL.hobbies,
                arts: CONFIG.XJZL.arts
            },
            // 传入缓存的数据供 HBS 初次渲染列表
            originsPack: this.cachedOrigins,
            hobbySlots: [0, 1, 2].map(i => ({
                index: i,
                value: this.wizardData.social.shihao[i] || ""
            }))
        };
    }

    /* -------------------------------------------- */
    /*  交互与流程控制                              */
    /* -------------------------------------------- */

    /**
     * 手动提取并展开表单数据
     */
    _saveCurrentStepData() {
        if (!this.element) return;
        // 1. 获取原生 FormData
        const fd = new FormData(this.element);
        // 2. 将 FormData 转换为普通对象 { "info.name": "xxx", "info.silver": 10 }
        const rawData = Object.fromEntries(fd.entries());
        // 3. 利用 Foundry 工具，将其展开为嵌套对象 { info: { name: "xxx", silver: 10 } }
        const expandedData = foundry.utils.expandObject(rawData);
        // 4. 深度合并到我们的内存状态中
        foundry.utils.mergeObject(this.wizardData, expandedData);
    }

    async _onNextStep(event, target) {
        event.preventDefault();
        this._saveCurrentStepData();

        if (this.wizardData.currentStep < this.wizardData.maxStep) {
            this.wizardData.currentStep++;
            this.render();
        }
    }

    async _onPrevStep(event, target) {
        event.preventDefault();
        this._saveCurrentStepData();

        if (this.wizardData.currentStep > 1) {
            this.wizardData.currentStep--;
            this.render();
        }
    }

    // ==========================================
    // Step 1: 基础身世
    // ==========================================

    /**
     * 呼出门派选择器
     */
    async _onOpenSectSelector(event, target) {
        event.preventDefault();

        // 关键：在打开弹窗前，必须先保存玩家目前在文本框里输入的名字等信息，防止重绘时丢失
        this._saveCurrentStepData();

        // 实例化门派选择器，传入当前选中的门派和回调函数
        new XJZLSectSelectorApp({
            currentSect: this.wizardData.info.sect,
            onSelect: (selectedSectKey) => {
                this.wizardData.info.sect = selectedSectKey;
                this.render(); // 重新渲染 Step 1，更新门派显示
            }
        }).render(true);
    }

    // ==========================================
    // Step 2: 命理性格 (Origin Selection)
    // ==========================================
    async _onSelectOriginItem(event, target) {
        event.preventDefault();

        const type = target.dataset.type; // 'background' 或 'personality'
        const uuid = target.dataset.uuid;

        // 1. 从缓存中读取数据
        const dataPool = type === "background" ? this.cachedOrigins.backgrounds : this.cachedOrigins.personalities;
        const itemData = dataPool.find(i => i.uuid === uuid);
        if (!itemData) return;

        // 2. 更新内存 State
        this.wizardData.origins[type] = itemData;
        if (type === "personality") {
            this.wizardData.origins.personality.system.chosen = [];
        }
        this._saveCurrentStepData();

        // 3. 纯 DOM 操作更新界面，不调用 this.render()
        const container = target.closest('.origin-column');

        // 3.1 更新左侧列表的高亮状态
        container.querySelectorAll('.origin-list-item').forEach(el => el.classList.remove('selected'));
        target.classList.add('selected');

        // 3.2 动态生成右侧详情的 HTML
        const detailView = container.querySelector('.origin-detail-view');

        let html = `
            <div class="detail-header">
                <img src="${itemData.img}" class="detail-icon">
                <h4 class="detail-name">${itemData.name}</h4>
            </div>
            <div class="detail-desc">${itemData.system.description || "<span style='color:#666;font-style:italic;'>暂无描述</span>"}</div>
        `;

        if (type === "background") {
            html += `
                <div class="detail-assets">
                    <strong><i class="fas fa-box-open"></i> 初始行囊：</strong>
                    ${itemData.system.assets || "无"}
                </div>
            `;
        } else if (type === "personality") {
            const options = itemData.system.options || [];
            if (options.length > 0) {
                const skillCheckboxes = options.map(opt => {
                    const capOpt = opt.charAt(0).toUpperCase() + opt.slice(1);
                    return `
                    <label class="skill-checkbox">
                        <input type="checkbox" value="${opt}" data-action="togglePersonalitySkill">
                        <span>${game.i18n.localize("XJZL.Skills." + capOpt)}</span>
                    </label>
                    `;
                }).join('');

                html += `
                    <div class="personality-skills">
                        <label class="skill-prompt"><i class="fas fa-hand-sparkles"></i> 请选择 2 项性格专长 (每项 +2)：</label>
                        <div class="skill-checkbox-group">
                            ${skillCheckboxes}
                        </div>
                    </div>
                `;
            }
        }

        // 3.3 注入 HTML
        detailView.innerHTML = html;
    }

    async _onTogglePersonalitySkill(event, target) {
        // Checkbox 本身自带勾选动画，我们只做逻辑拦截，不重新渲染页面
        const skillKey = target.value;
        const isChecked = target.checked;

        const personality = this.wizardData.origins.personality;
        if (!personality) return;

        let chosen = personality.system.chosen || [];

        if (isChecked) {
            if (chosen.length >= 2) {
                ui.notifications.warn("最多只能选择 2 项性格加成！");
                target.checked = false; // DOM 直接取消勾选
                return;
            }
            chosen.push(skillKey);
        } else {
            chosen = chosen.filter(k => k !== skillKey);
        }

        personality.system.chosen = chosen;
        this._saveCurrentStepData(); // 静默同步到 State
    }

    // ==========================================
    // Step 3: 处世结交 (Social Relations)
    // ==========================================
    async _onAddRelation(event, target) {
        event.preventDefault();
        this._saveCurrentStepData(); // 先保存已填写的数据

        this.wizardData.social.relations.push({
            id: foundry.utils.randomID(),
            name: "",
            type: "",
            value: 0
        });
        this.render();
    }

    async _onDeleteRelation(event, target) {
        event.preventDefault();
        this._saveCurrentStepData();

        const index = Number(target.dataset.index);
        this.wizardData.social.relations.splice(index, 1);
        this.render();
    }

    // ==========================================
    // Step 6: 降生结算 (核心写入逻辑)
    // ==========================================
    async _onFinishWizard(event, target) {
        event.preventDefault();
        this._saveCurrentStepData();

        const actor = this.actor;
        if (!actor) return;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: "初入江湖", icon: "fas fa-check-circle" },
            content: `<p>所有的命运馈赠已计算完毕。</p><p>点击确认，角色将正式降生于江湖之中。此操作不可逆！</p>`,
            rejectClose: false
        });

        if (!confirmed) return;

        ui.notifications.info("正在重塑角色躯体...");

        const oldItemIds = actor.items.map(i => i.id);
        if (oldItemIds.length > 0) {
            await actor.deleteEmbeddedDocuments("Item", oldItemIds);
        }

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

        const artsChanges = [];
        for (const [artKey, level] of Object.entries(this.wizardData.artsBonus)) {
            if (level > 0) {
                artsChanges.push({ key: `system.arts.${artKey}.value`, value: level });
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

        const historyLog = {
            id: foundry.utils.randomID(), realTime: Date.now(), type: "text",
            importance: 2, title: "踏入江湖", reason: "通过向导完成建卡",
            delta: "", balance: ""
        };
        const currentHistory = actor.system.history || [];
        actorUpdates["system.history"] = [historyLog, ...currentHistory];

        await actor.update(actorUpdates);

        const itemsToCreate = [];
        if (this.wizardData.origins.background) itemsToCreate.push(this.wizardData.origins.background);
        if (this.wizardData.origins.personality) itemsToCreate.push(this.wizardData.origins.personality);
        if (this.wizardData.assembly.items.length > 0) itemsToCreate.push(...this.wizardData.assembly.items);

        if (itemsToCreate.length > 0) {
            await actor.createEmbeddedDocuments("Item", itemsToCreate);
        }

        ui.notifications.success(`${actor.name} 降生成功！`);
        this.close();
        actor.sheet.render(true);
    }
}