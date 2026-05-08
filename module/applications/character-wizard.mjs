import { XJZLSectSelectorApp } from "./sect-selector.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * 侠界之旅 - 角色建卡向导 (Character Wizard)
 * 在向导中的所有操作均保存在 this.wizardData 中，不直接写入数据库。
 * 只有在最后一步 (Step 6) 点击确认后，才会一次性写入 Actor 和 Items。
 */
export class XJZLCharacterWizardApp extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(options) {
        super(options);

        this.actor = options.actor;

        // ==========================================
        // 核心数据池：内存状态机
        // ==========================================
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
            // Step 2: 命理性格 (存放完整 Item 对象快照)
            origins: { background: null, personality: null },

            // Step 3: 处世结交
            social: {
                rep_chaoting: 0, rep_wulin: 0,
                attitude_chaoting: "none", attitude_wulin: "none", attitude_shisu: "none",
                shihao: ["", "", ""], relations: []
            },

            // Step 4: 预算与武学装配
            // budget: 玩家手动输入的初始资源量
            budget: { general: 0, neigong: 0, wuxue: 0, arts: 0 },
            // runtimeBudget: 扣除武学内功消耗后，真正剩余的资源量 (由 _onRefreshBudget 实时计算)
            runtimeBudget: { general: 0, neigong: 0, wuxue: 0, arts: 0 },
            // assembly: 从万卷阁拖入的武学/内功列表
            assembly: { items: [] },

            // Step 5: 技艺 (预留给后续开发)
            artsBonus: {}
        };
    }

    static DEFAULT_OPTIONS = {
        id: "xjzl-character-wizard",
        tag: "form",
        classes: ["xjzl-window", "theme-dark", "character-wizard-app"],
        position: { width: 1200, height: 750 },
        window: {
            title: "侠界之旅 - 角色建卡向导",
            icon: "fas fa-hat-wizard",
            resizable: false
        },
        // 关闭 FVTT 原生自动提交，由向导引擎接管数据流转
        form: {
            submitOnChange: false,
            closeOnSubmit: false
        },
        actions: {
            // 基础导航
            nextStep: XJZLCharacterWizardApp.prototype._onNextStep,
            prevStep: XJZLCharacterWizardApp.prototype._onPrevStep,
            finishWizard: XJZLCharacterWizardApp.prototype._onFinishWizard,
            // Step 1 动作
            openSectSelector: XJZLCharacterWizardApp.prototype._onOpenSectSelector,
            // Step 2 动作
            selectOriginItem: XJZLCharacterWizardApp.prototype._onSelectOriginItem,
            togglePersonalitySkill: XJZLCharacterWizardApp.prototype._onTogglePersonalitySkill,
            // Step 3 动作
            addRelation: XJZLCharacterWizardApp.prototype._onAddRelation,
            deleteRelation: XJZLCharacterWizardApp.prototype._onDeleteRelation,
            // Step 4 动作
            openBrowser: XJZLCharacterWizardApp.prototype._onOpenBrowser,
            removeAssemblyItem: XJZLCharacterWizardApp.prototype._onRemoveAssemblyItem,
            refreshBudget: XJZLCharacterWizardApp.prototype._onRefreshBudget
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

    /**
     * 数据准备阶段
     * 只在初次加载时读取一次 Compendium Pack，后续全部读取内存缓存
     */
    async _prepareContext(options) {
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
            originsPack: this.cachedOrigins,
            hobbySlots: [0, 1, 2].map(i => ({
                index: i,
                value: this.wizardData.social.shihao[i] || ""
            }))
        };
    }

    /**
     * DOM 渲染后绑定特殊事件
     * 处理拖拽 (Drag & Drop) 以及表单输入的实时监听
     */
    _onRender(context, options) {
        super._onRender(context, options);
        // 防止重绘时重复绑定
        if (this.element.hasAttribute("data-drag-bound")) return;

        // 绑定拖拽：必须使用 bind(this) 保留类上下文
        this.element.addEventListener("dragover", (e) => e.preventDefault());
        this.element.addEventListener("drop", this._onDropItem.bind(this));

        // 绑定实时预算计算：监听 input (输入) 和 change (下拉框)
        const refreshTrigger = (e) => {
            if (e.target.closest(".budget-input-group") || e.target.closest(".assembly-list-container")) {
                this._onRefreshBudget();
            }
        };
        this.element.addEventListener("input", refreshTrigger);
        this.element.addEventListener("change", refreshTrigger);

        this.element.setAttribute("data-drag-bound", "true");
    }

    /* -------------------------------------------- */
    /*  交互与流程控制                              */
    /* -------------------------------------------- */

    /**
     * [辅助方法] 手动提取并展开表单数据到 state 中
     * 解决 FVTT 数据提取时的数组转对象 Bug
     */
    _saveCurrentStepData() {
        if (!this.element) return;
        const fd = new FormData(this.element);
        const rawData = Object.fromEntries(fd.entries());
        const expandedData = foundry.utils.expandObject(rawData);

        // 解决 FVTT 表单将数组解析为对象的 Bug
        if (expandedData.social && expandedData.social.relations) {
            expandedData.social.relations = Object.values(expandedData.social.relations);
        } else if (expandedData.social) {
            expandedData.social.relations = [];
        }

        foundry.utils.mergeObject(this.wizardData, expandedData);
    }

    /**
     * 下一步导航
     */
    async _onNextStep(event, target) {
        event.preventDefault();
        this._saveCurrentStepData();

        // 校验：在离开第 4 步前，强制检查资源是否变为负数 (防透支)
        if (this.wizardData.currentStep === 4) {
            this._onRefreshBudget();
            const rb = this.wizardData.runtimeBudget || { general: 0, neigong: 0, wuxue: 0 };

            if (rb.general < 0 || rb.neigong < 0 || rb.wuxue < 0) {
                return ui.notifications.error("修为已透支！请减少武学配置，或增加左侧的初始资源后再继续。");
            }
        }

        if (this.wizardData.currentStep < this.wizardData.maxStep) {
            this.wizardData.currentStep++;
            this.render();
        }
    }

    /**
     * 上一步导航
     */
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
    async _onOpenSectSelector(event, target) {
        event.preventDefault();
        this._saveCurrentStepData();

        new XJZLSectSelectorApp({
            currentSect: this.wizardData.info.sect,
            onSelect: (selectedSectKey) => {
                this.wizardData.info.sect = selectedSectKey;
                this.render();
            }
        }).render(true);
    }

    // ==========================================
    // Step 2: 命理性格
    // ==========================================
    async _onSelectOriginItem(event, target) {
        event.preventDefault();

        const type = target.dataset.type;
        const uuid = target.dataset.uuid;

        const dataPool = type === "background" ? this.cachedOrigins.backgrounds : this.cachedOrigins.personalities;
        const itemData = dataPool.find(i => i.uuid === uuid);
        if (!itemData) return;

        this.wizardData.origins[type] = itemData;
        if (type === "personality") {
            // 切换性格时清空之前的选择
            this.wizardData.origins.personality.system.chosen = [];
        }
        this._saveCurrentStepData();

        // 极速更新DOM (不触发 render，实现无缝切换)
        const container = target.closest('.origin-column');
        container.querySelectorAll('.origin-list-item').forEach(el => el.classList.remove('selected'));
        target.classList.add('selected');

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
        detailView.innerHTML = html;
    }

    async _onTogglePersonalitySkill(event, target) {
        const skillKey = target.value;
        const isChecked = target.checked;

        const personality = this.wizardData.origins.personality;
        if (!personality) return;

        let chosen = personality.system.chosen || [];

        if (isChecked) {
            if (chosen.length >= 2) {
                ui.notifications.warn("最多只能选择 2 项性格加成！");
                target.checked = false;
                return;
            }
            chosen.push(skillKey);
        } else {
            chosen = chosen.filter(k => k !== skillKey);
        }

        personality.system.chosen = chosen;
        this._saveCurrentStepData();
    }

    // ==========================================
    // Step 3: 处世结交
    // ==========================================
    async _onAddRelation(event, target) {
        event.preventDefault();
        const container = this.element.querySelector('.relations-list-container');
        if (!container) return;

        const emptyHint = container.querySelector('.empty-hint');
        if (emptyHint) emptyHint.remove();

        const uniqueIndex = Date.now();
        const html = `
            <div class="relation-row fade-in">
                <input type="text" name="social.relations.${uniqueIndex}.name" value="" placeholder="输入NPC姓名">
                <input type="text" name="social.relations.${uniqueIndex}.type" value="" placeholder="如: 挚友/宿敌/恩师">
                <input type="number" name="social.relations.${uniqueIndex}.value" value="0" title="好感度">
                <button type="button" data-action="deleteRelation" class="btn-delete-rel" title="删除"><i class="fas fa-trash"></i></button>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', html);
    }

    async _onDeleteRelation(event, target) {
        event.preventDefault();
        const row = target.closest('.relation-row');
        if (row) row.remove();

        const container = this.element.querySelector('.relations-list-container');
        if (container && container.querySelectorAll('.relation-row').length === 0) {
            container.innerHTML = `<div class="empty-hint">孤身一人，暂无牵绊</div>`;
        }
    }

    // ==========================================
    // Step 4: 武学内功 (装配与预算引擎)
    // ==========================================

    /**
     * 调出合集包浏览器
     */
    async _onOpenBrowser(event, target) {
        event.preventDefault();
        const type = target.dataset.type;

        const cb = game.xjzl?.compendiumBrowser;
        if (!cb) return ui.notifications.warn("江湖万卷阁尚未初始化！");

        // 注入默认配置：锁定官方、锁定门派
        cb.browserState.activeTab = type;
        cb.browserState.filters = { isOfficial: new Set(["true"]) };

        const currentSect = this.wizardData.info.sect;
        if (currentSect && currentSect !== "none") {
            cb.browserState.filters.sect = new Set([currentSect]);
        }

        cb.browserState.searchQuery = "";
        cb.render(true);
    }

    /**
     * 响应万卷阁的拖拽放置
     */
    async _onDropItem(event) {
        if (this.wizardData.currentStep !== 4) return;

        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); }
        catch (err) { return; }

        if (data.type !== "Item" || !data.uuid) return;

        const item = await fromUuid(data.uuid);
        if (!item || !["neigong", "wuxue"].includes(item.type)) {
            return ui.notifications.warn("只能将【内功】或【武学】拖入此处！");
        }

        if (this.wizardData.assembly.items.some(i => i.uuid === item.uuid)) {
            return ui.notifications.warn("该心法/武学已在参悟列表中。");
        }

        const itemDataObj = item.toObject();

        // [业务判定]：为模板准备 hasHeyi 字段，如果是天级武学才有第4层(合一)
        if (item.type === "wuxue") {
            const defaultTier = itemDataObj.system.tier ?? 1;
            itemDataObj.system.moves.forEach(m => {
                const t = m.tier ?? defaultTier;
                m.hasHeyi = t >= 3;
            });
        }

        const assemblyItem = {
            id: item.id,
            uuid: item.uuid,
            type: item.type,
            name: item.name,
            img: item.img,
            itemData: itemDataObj,
            // 运行时的计算结果缓存，供最终结算时写入系统
            runtime: { requiredXP: 0, costGeneral: 0, costSpecific: 0, moves: {} }
        };

        // 先写入数组 -> 更新预算内存 -> 重绘界面
        this.wizardData.assembly.items.push(assemblyItem);
        this._onRefreshBudget();
        this.render();
    }

    /**
     * 移除武学卡片
     */
    async _onRemoveAssemblyItem(event, target) {
        event.preventDefault();
        const uuid = target.dataset.uuid;
        // 过滤掉被移除的项 -> 更新预算内存 -> 重绘界面
        this.wizardData.assembly.items = this.wizardData.assembly.items.filter(i => i.uuid !== uuid);
        this._onRefreshBudget();
        this.render();
    }

    /**
     * 【逆向预算计算器】
     * 在用户修改下拉框或输入修为时实时触发。
     * 计算所有物品的消耗，优先扣除“专属修为”，不足部分扣除“通用修为”。
     */
    _onRefreshBudget() {
        this._saveCurrentStepData();
        const state = this.wizardData;

        let usedGeneral = 0;
        let usedNeigong = 0;
        let usedWuxue = 0;

        for (const asm of state.assembly.items) {
            // 重置当前项的运行时缓存
            asm.runtime = { requiredXP: 0, costGeneral: 0, costSpecific: 0, moves: {} };

            // ---------------------------------
            // A. 内功计算逻辑
            // ---------------------------------
            if (asm.type === "neigong") {
                const config = state.config_neigong?.[asm.id];
                if (!config) continue;

                const targetStage = parseInt(config.targetStage) || 0;
                const tier = asm.itemData.system.tier || 1;
                // 获取当前品阶的基础阈值
                let rawThresholds = tier === 1 ? [0, 1000, 3000] : (tier === 2 ? [1000, 4000, 10000] : [2000, 12000, 30000]);

                const cnf = asm.itemData.system.config;
                const cost0 = rawThresholds[0] * (cnf.stage1?.xpCostRatio ?? 1);
                const cost1 = (rawThresholds[1] - rawThresholds[0]) * (cnf.stage2?.xpCostRatio ?? 1);
                const cost2 = (rawThresholds[2] - rawThresholds[1]) * (cnf.stage3?.xpCostRatio ?? 1);
                // 累加计算最终实际阈值
                const thresholds = [Math.floor(cost0), Math.floor(cost0 + cost1), Math.floor(cost0 + cost1 + cost2)];

                // 提取用户所需境界的总经验
                const requiredXP = targetStage > 0 ? (thresholds[targetStage - 1] || 0) : 0;
                asm.runtime.requiredXP = requiredXP;

                // [扣费规则分流]
                if (targetStage > 0) {
                    if (config.payment === "free") {
                        // 赠送：不扣除玩家的资金池，但记录其自身价值
                        asm.runtime.costSpecific = requiredXP;
                        asm.runtime.costGeneral = 0;
                    } else {
                        // 自费：优先扣除内功专属池，不够再扣通用
                        let costSpec = Math.min(requiredXP, Math.max(0, state.budget.neigong - usedNeigong));
                        let costGen = requiredXP - costSpec;

                        usedNeigong += costSpec;
                        usedGeneral += costGen;

                        // 缓存拆分结果，备最后生成物品使用
                        asm.runtime.costSpecific = costSpec;
                        asm.runtime.costGeneral = costGen;
                    }
                }

                // ---------------------------------
                // B. 武学计算逻辑
                // ---------------------------------
            } else if (asm.type === "wuxue") {
                const wuxueConfig = state.config_wuxue?.[asm.id] || {};

                for (const move of asm.itemData.system.moves) {
                    const moveConfig = wuxueConfig[move.id];
                    if (!moveConfig) continue;

                    const targetLvl = parseInt(moveConfig.targetLevel) || 0;
                    const tier = move.tier ?? (asm.itemData.system.tier ?? 1);
                    const isQG = ["qinggong", "zhenfa"].includes(asm.itemData.system.category);
                    let baseT = [];

                    if (move.progression?.mode === "custom" && move.progression.customThresholds.length > 0) {
                        baseT = move.progression.customThresholds;
                    } else if (isQG) {
                        baseT = tier === 1 ? [1000] : (tier === 2 ? [3000] : [6000]);
                    } else {
                        baseT = tier === 1 ? [0, 500, 1000] : (tier === 2 ? [500, 1500, 3000] : [1000, 3000, 6000, 10000]);
                    }

                    const ratio = move.xpCostRatio ?? 1;
                    const thresholds = baseT.map(t => Math.floor(t * ratio));
                    const requiredXP = (targetLvl > 0 && targetLvl <= thresholds.length) ? thresholds[targetLvl - 1] : 0;

                    let moveCostSpec = 0;
                    let moveCostGen = 0;

                    // [扣费规则分流]
                    if (targetLvl > 0) {
                        if (moveConfig.payment === "free") {
                            moveCostSpec = requiredXP;
                            moveCostGen = 0;
                        } else {
                            // 自费：优先扣武学专属，不够扣通用
                            moveCostSpec = Math.min(requiredXP, Math.max(0, state.budget.wuxue - usedWuxue));
                            moveCostGen = requiredXP - moveCostSpec;

                            usedWuxue += moveCostSpec;
                            usedGeneral += moveCostGen;
                        }
                    }

                    // 将计算结果缓存在当前招式下
                    asm.runtime.moves[move.id] = {
                        requiredXP,
                        costSpecific: moveCostSpec,
                        costGeneral: moveCostGen
                    };
                }
            }
        }

        // 统一结算真实余额
        state.runtimeBudget = {
            general: state.budget.general - usedGeneral,
            neigong: state.budget.neigong - usedNeigong,
            wuxue: state.budget.wuxue - usedWuxue
        };

        // 极速更新 DOM 数值和颜色 (避开 this.render() 避免闪烁)
        const updateDOM = (id, remain) => {
            const el = this.element.querySelector(`#${id}`);
            if (el) {
                el.innerText = remain;
                el.style.color = remain < 0 ? "#e74c3c" : (remain === 0 ? "#95a5a6" : "#2ecc71");
            }
        };

        updateDOM("remain-gen", state.runtimeBudget.general);
        updateDOM("remain-ng", state.runtimeBudget.neigong);
        updateDOM("remain-wx", state.runtimeBudget.wuxue);
    }

    // ==========================================
    // Step 6: 降生结算
    // ==========================================
    async _onFinishWizard(event, target) {
        event.preventDefault();

        // 确保数值是最新鲜的
        this._onRefreshBudget();

        const actor = this.actor;
        if (!actor) return;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: "初入江湖", icon: "fas fa-check-circle" },
            content: `<p>所有的命运馈赠已计算完毕。</p><p>点击确认，角色将正式降生于江湖之中。此操作不可逆！</p>`,
            rejectClose: false
        });

        if (!confirmed) return;
        ui.notifications.info("正在重塑角色躯体...");

        // 洗号：清除原有的全部物品
        const oldItemIds = actor.items.map(i => i.id);
        if (oldItemIds.length > 0) {
            await actor.deleteEmbeddedDocuments("Item", oldItemIds);
        }

        // 提取最终预算
        const rb = this.wizardData.runtimeBudget || { general: 0, neigong: 0, wuxue: 0 };

        const actorUpdates = {
            "name": this.wizardData.info.name || "无名氏",
            "system.info": {
                gender: this.wizardData.info.gender,
                title: this.wizardData.info.title,
                zi: this.wizardData.info.zi,
                age: this.wizardData.info.age,
                height: this.wizardData.info.height,
                weight: this.wizardData.info.weight,
                sect: this.wizardData.info.sect,
                appearance: this.wizardData.info.appearance,
                bio: this.wizardData.info.bio
            },
            "system.social": this.wizardData.social,
            "system.resources.silver": this.wizardData.info.silver,
            "system.cultivation": {
                general: rb.general,
                neigong: rb.neigong,
                wuxue: rb.wuxue,
                arts: this.wizardData.budget.arts // 技艺原样传入，等待Step 5逻辑
            }
        };

        // --- 构建规范的审计日志 ---
        const historyLogs = [];
        let logTimeCursor = Date.now();

        const addLog = (title, deltaVal, reason) => {
            if (deltaVal <= 0) return; // 不产生 0 或 负数 日志
            historyLogs.push({
                id: foundry.utils.randomID(),
                realTime: logTimeCursor -= 10,
                type: "resource",
                importance: 1,
                title: title,
                reason: reason,
                delta: `+${deltaVal}`,
                balance: ""
            });
        };

        // 独立分块记录初始资源
        addLog("初始通用修为", this.wizardData.budget.general, "开局资源");
        addLog("初始内功专属", this.wizardData.budget.neigong, "开局资源");
        addLog("初始武学专属", this.wizardData.budget.wuxue, "开局资源");
        addLog("初始技艺专属", this.wizardData.budget.arts, "开局资源");

        // --- 物品装配与经验注入 ---
        const itemsToCreate = [];
        if (this.wizardData.origins.background) itemsToCreate.push(this.wizardData.origins.background);
        if (this.wizardData.origins.personality) itemsToCreate.push(this.wizardData.origins.personality);

        for (const asm of this.wizardData.assembly.items) {
            const newItemData = foundry.utils.deepClone(asm.itemData);

            if (asm.type === "neigong") {
                const reqXP = asm.runtime?.requiredXP || 0;
                newItemData.system.xpInvested = reqXP;

                // 写入拆分后的专用/通用比例
                if (reqXP > 0) {
                    newItemData.system.sourceBreakdown = {
                        general: asm.runtime.costGeneral || 0,
                        specific: asm.runtime.costSpecific || 0
                    };
                }

                // 赠送折算日志
                const config = this.wizardData.config_neigong?.[asm.id];
                if (config && config.payment === "free" && reqXP > 0) {
                    addLog(`开局赠送: ${asm.name}`, reqXP, "内功境界折算");
                }
            }
            else if (asm.type === "wuxue") {
                const movesRuntime = asm.runtime?.moves || {};
                const config = this.wizardData.config_wuxue?.[asm.id] || {};
                let freeMoveXpTotal = 0;

                for (const move of newItemData.system.moves) {
                    const moveRun = movesRuntime[move.id] || { requiredXP: 0, costGeneral: 0, costSpecific: 0 };
                    const reqXP = moveRun.requiredXP;

                    move.xpInvested = reqXP;

                    if (reqXP > 0) {
                        move.sourceBreakdown = {
                            general: moveRun.costGeneral || 0,
                            specific: moveRun.costSpecific || 0
                        };
                    }

                    const moveCfg = config[move.id];
                    if (moveCfg && moveCfg.payment === "free" && reqXP > 0) {
                        freeMoveXpTotal += reqXP;
                    }
                }

                if (freeMoveXpTotal > 0) {
                    addLog(`开局赠送: ${asm.name}`, freeMoveXpTotal, "武学境界折算");
                }
            }
            itemsToCreate.push(newItemData);
        }

        // 把最终的降生文本日志加上（排在第一条显示）
        historyLogs.unshift({
            id: foundry.utils.randomID(), realTime: Date.now(), type: "text",
            importance: 2, title: "踏入江湖", reason: "通过向导完成建卡",
            delta: "", balance: ""
        });
        actorUpdates["system.history"] = historyLogs;

        // 提交变更
        await actor.update(actorUpdates);

        if (itemsToCreate.length > 0) {
            await actor.createEmbeddedDocuments("Item", itemsToCreate);
        }

        ui.notifications.success(`${actor.name} 降生成功！`);
        this.close();
        actor.sheet.render(true);
    }
}