import { XJZLSectSelectorApp } from "./sect-selector.mjs";
import { parseBackgroundAssets, resolveBackgroundItems, getSectItemNames } from "../utils/background-assets.mjs";

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
            maxStep: 7,

            // Step 1: 基础与背景
            info: {
                name: this.actor.name,
                gender: "male",
                title: "",
                sect: "none",
                appearance: "",
                bio: ""
            },
            // Step 2: 命理性格 (存放完整 Item 对象快照)
            origins: { background: null, personality: null },

            // Step 3: 处世结交
            social: {
                rep_chaoting: 0, rep_wulin: 0,
                attitude_chaoting: "none", attitude_wulin: "none", attitude_shisu: "none",
                shihao: ["", "", ""], relations: [],
                xiayi: 0, exing: 0
            },

            // Step 4: 预算与武学装配
            // budget: 玩家手动输入的初始资源量
            budget: { general: 0, neigong: 0, wuxue: 0, arts: 0 },
            // runtimeBudget: 扣除武学内功消耗后，真正剩余的资源量 (由 _onRefreshBudget 实时计算)
            runtimeBudget: { general: 0, neigong: 0, wuxue: 0, arts: 0 },
            // assembly: 从万卷阁拖入的武学/内功列表
            assembly: { items: [] },

            // Step 5: 技艺
            artsBonus: {},

            // Step 6: 行囊采买
            shopping: {
                silver: 0,
                runtimeSilver: 0,
                items: []
            }
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
            refreshBudget: XJZLCharacterWizardApp.prototype._onRefreshBudget,
            // Step 6 动作
            removeShoppingItem: XJZLCharacterWizardApp.prototype._onRemoveShoppingItem
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
            // 监听购物区的输入变化
            if (e.target.closest(".shopping-budget-group") || e.target.closest(".shopping-list-container")) {
                this._onRefreshShoppingBudget();
            }
        };
        this.element.addEventListener("input", refreshTrigger);
        this.element.addEventListener("change", refreshTrigger);

        this.element.setAttribute("data-drag-bound", "true");
    }

    /**
     * 拦截窗口关闭事件，防止按 ESC 或误点右上角导致建卡进度丢失
     */
    async close(options = {}) {
        // 如果是系统强制关闭（比如降生结算完毕），直接放行
        if (options.force) return super.close(options);

        // 弹出确认框
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: "放弃建卡？", icon: "fas fa-exclamation-triangle" },
            content: "<p>你确定要关闭向导吗？<strong style='color:#e74c3c;'>所有未保存的建卡进度将会丢失！</strong></p>",
            rejectClose: false
        });

        // 只有玩家点击确认，才执行真实的关闭
        if (confirmed) {
            return super.close(options);
        }
        return false;
    }

    /* -------------------------------------------- */
    /*  交互与流程控制                              */
    /* -------------------------------------------- */

    /**
     * 解析背景的 assets 文本，将赠品推入购物车免费区 + 添加银两
     * 在进入 Step 6 时调用
     */
    async _populateBackgroundAssets() {
        if (this.wizardData._bgAssetsPopulated) return;
        this.wizardData._bgAssetsPopulated = true;

        const bg = this.wizardData.origins.background;
        if (!bg) return;

        const assetsText = bg.system.assets;
        if (!assetsText) return;

        const parsed = parseBackgroundAssets(assetsText);
        const resolved = await resolveBackgroundItems(parsed.items);

        for (const r of resolved) {
            if (!r.found) {
                console.warn(`XJZL Wizard | 背景 "${bg.name}" 赠品 "${r.name}" 在合集包中未找到`);
                continue;
            }
            this.wizardData.shopping.items.push({
                id: foundry.utils.randomID(),
                uuid: r.uuid,
                type: r.itemData.type,
                name: r.itemData.name,
                img: r.itemData.img,
                price: r.itemData.system?.price ?? 0,
                quantity: r.quantity,
                zone: "free",
                isBackgroundAsset: true,
                itemData: r.itemData
            });
        }

        this.wizardData.shopping.silver += parsed.silver;
    }

    /**
     * 将门派赠品推入购物车免费区
     * 在进入 Step 6 时调用，背景填充之后
     */
    async _populateSectAssets() {
        if (this.wizardData._sectAssetsPopulated) return;
        this.wizardData._sectAssetsPopulated = true;

        const sectKey = this.wizardData.info.sect;
        if (!sectKey || sectKey === "none") return;

        const names = await getSectItemNames(sectKey);
        if (names.length === 0) return;

        const parsed = names.map(name => ({ name, quantity: 1 }));
        const resolved = await resolveBackgroundItems(parsed);

        for (const r of resolved) {
            if (!r.found) {
                console.warn(`XJZL Wizard | 门派 "${sectKey}" 赠品 "${r.name}" 在合集包中未找到`);
                continue;
            }
            this.wizardData.shopping.items.push({
                id: foundry.utils.randomID(),
                uuid: r.uuid,
                type: r.itemData.type,
                name: r.itemData.name,
                img: r.itemData.img,
                price: r.itemData.system?.price ?? 0,
                quantity: r.quantity,
                zone: "free",
                isSectAsset: true,
                itemData: r.itemData
            });
        }
    }

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

        // 校验：离开第 6 步前，检查银两是否透支
        if (this.wizardData.currentStep === 6) {
            this._onRefreshShoppingBudget();
            if (this.wizardData.shopping.runtimeSilver < 0) {
                return ui.notifications.error("银两已透支！请减少购买的物品，或增加初始银两后再继续。");
            }
        }

        // 进入 Step 6 前，填充背景/门派赠品到免费区
        if (this.wizardData.currentStep === 5) {
            // 清理旧门派赠品（若从 Step 1 返回修改了门派）
            this.wizardData.shopping.items = this.wizardData.shopping.items.filter(i => !i.isSectAsset);
            this.wizardData._sectAssetsPopulated = false;
            await this._populateBackgroundAssets();
            await this._populateSectAssets();
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

        // 切换背景前：收回旧背景的银两和购物车赠品
        if (type === "background") {
            this.wizardData._bgAssetsPopulated = false;
            this.wizardData.shopping.items = this.wizardData.shopping.items.filter(i => !i.isBackgroundAsset);
            const oldBg = this.wizardData.origins.background;
            if (oldBg?.system?.assets) {
                const oldSilver = parseBackgroundAssets(oldBg.system.assets).silver;
                this.wizardData.shopping.silver = Math.max(0, this.wizardData.shopping.silver - oldSilver);
            }
        }

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
    // Step 4: 武学内功 (装配与预算引擎) 与部分 Step6：行囊采买
    // ==========================================

    /**
     * 调出合集包浏览器
     */
    async _onOpenBrowser(event, target) {
        event.preventDefault();
        const type = target.dataset.type;

        const cb = game.xjzl?.compendiumBrowser;
        if (!cb) return ui.notifications.warn("江湖万卷阁尚未初始化！");

        // 通过公开的 applyTabState 注入初始筛选：锁定官方，内功/武学追加门派过滤
        const filters = { isOfficial: new Set(["true"]) };
        if (["neigong", "wuxue"].includes(type)) {
            const currentSect = this.wizardData.info.sect;
            if (currentSect && currentSect !== "none") {
                filters.sect = new Set([currentSect]);
            }
        }
        cb.applyTabState(type, filters);
        cb.render(true);
    }

    /**
     * 响应万卷阁的拖拽放置
     */
    async _onDropItem(event) {
        if (this.wizardData.currentStep !== 4 && this.wizardData.currentStep !== 6) return;

        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); }
        catch (err) { return; }

        if (data.type !== "Item" || !data.uuid) return;

        // ==========================================
        // 分支 A: 第 4 步 (武学内功)
        // ==========================================
        if (this.wizardData.currentStep === 4) {
            const item = await fromUuid(data.uuid);
            if (!item || !["neigong", "wuxue"].includes(item.type)) {
                return ui.notifications.warn("只能将【内功】或【武学】拖入此处！");
            }
            if (this.wizardData.assembly.items.some(i => i.uuid === item.uuid)) {
                return ui.notifications.warn("该心法/武学已在参悟列表中。");
            }

            const itemDataObj = item.toObject();

            // 纯文本清洗辅助函数
            const cleanText = (htmlStr) => {
                if (!htmlStr) return "暂无描述";
                const formulaResults = [];
                const tokenized = htmlStr.replace(
                    /<span class="xjzl-level-formula-result">([^<]*)<\/span>/g,
                    (_match, result) => String.fromCharCode(0xE000 + formulaResults.push(result) - 1)
                );
                let txt = tokenized.replace(/<[^>]*>?/gm, '');
                const truncated = txt.length > 120;
                // 先按正文截断、后转义引号：先转义会让 &quot; 膨胀计入长度导致过早截断，
                // 截断还可能切断实体留下字面乱码。tooltip 会嵌入 data-tooltip="..." 属性，
                // 未转义的引号会提前截断属性，触发 "must render a single HTML element"。
                txt = txt.substring(0, 120);
                txt = txt.replace(/"/g, "&quot;").replace(/'/g, "&apos;");
                for (const [index, result] of formulaResults.entries()) {
                    txt = txt.replace(
                        String.fromCharCode(0xE000 + index),
                        `<span class='xjzl-level-formula-result'>${result}</span>`
                    );
                }
                return truncated ? txt + "..." : txt;
            };

            let tooltipHtml = "";
            const tierLabels = { 1: "人级", 2: "地级", 3: "天级" };

            if (item.type === "wuxue") {
                const defaultTier = itemDataObj.system.tier ?? 1;
                const preparedMovesById = new Map((item.system.moves || []).map(move => [move.id, move]));

                // 武学书本：蓝色主题 + 显眼品阶徽章
                tooltipHtml = `
                    <div style='text-align:left; max-width:260px; border-left: 3px solid #3498db; padding-left: 8px;'>
                        <strong style='color:#3498db; font-size:1.1em;'>${item.name}</strong>
                        <span style='background:#3498db; color:#fff; padding:2px 6px; border-radius:3px; font-size:0.8em; margin-left:6px; box-shadow:0 0 5px rgba(52,152,219,0.5);'>${tierLabels[defaultTier]}武学</span>
                        <div style='font-size:12px; color:#ccc; margin-top:8px; line-height:1.5;'>${cleanText(itemDataObj.system.description)}</div>
                    </div>
                `;

                itemDataObj.system.moves.forEach(m => {
                    const t = m.tier ?? defaultTier;
                    m.hasHeyi = t >= 3;
                    const typeLabel = game.i18n.localize(`XJZL.Wuxue.Type.${m.type}`);
                    const preparedDescription = preparedMovesById.get(m.id)?.description ?? m.description;

                    // 招式效果：绿色主题 + 招式类型徽章
                    m.tooltip = `
                        <div style='text-align:left; max-width:260px; border-left: 3px solid #2ecc71; padding-left: 8px;'>
                            <strong style='color:#2ecc71; font-size:1.1em;'>${m.name}</strong>
                            <span style='background:#2ecc71; color:#000; padding:2px 6px; border-radius:3px; font-size:0.8em; margin-left:6px; box-shadow:0 0 5px rgba(46,204,113,0.5);'>${typeLabel}</span>
                            <div style='font-size:12px; color:#ccc; margin-top:8px; line-height:1.5;'>${cleanText(preparedDescription)}</div>
                        </div>
                    `;
                });
            } else if (item.type === "neigong") {
                const tier = itemDataObj.system.tier ?? 1;

                // 内功心法：红色主题 + 显眼品阶徽章
                tooltipHtml = `
                    <div style='text-align:left; max-width:260px; border-left: 3px solid #e74c3c; padding-left: 8px;'>
                        <strong style='color:#e74c3c; font-size:1.1em;'>${item.name}</strong>
                        <span style='background:#e74c3c; color:#fff; padding:2px 6px; border-radius:3px; font-size:0.8em; margin-left:6px; box-shadow:0 0 5px rgba(231,76,60,0.5);'>${tierLabels[tier]}内功</span>
                        <div style='font-size:12px; color:#ccc; margin-top:8px; line-height:1.5;'>${cleanText(itemDataObj.system.description)}</div>
                    </div>
                `;
            }

            const assemblyItem = {
                id: item.id,
                uuid: item.uuid,
                type: item.type,
                name: item.name,
                img: item.img,
                tooltip: tooltipHtml, // 将生成的提示存入内存
                itemData: itemDataObj,
                runtime: { requiredXP: 0, costGeneral: 0, costSpecific: 0, moves: {} }
            };

            this.wizardData.assembly.items.push(assemblyItem);
            this._onRefreshBudget();
            this.render();
        }
        // ==========================================
        // 分支 B: 第 6 步 (行囊采买)
        // ==========================================
        else if (this.wizardData.currentStep === 6) {
            // 拖拽发生瞬间，先保存当前界面的输入状态
            this._saveCurrentStepData();
            // 刷新一次内存状态，使其与DOM完全同步
            this._onRefreshShoppingBudget(true);

            const item = await fromUuid(data.uuid);
            const validTypes = ["weapon", "armor", "consumable", "misc", "qizhen"];

            if (!item || !validTypes.includes(item.type)) {
                return ui.notifications.warn("只能将装备、杂物或消耗品拖入此处！");
            }

            const dropZone = event.target.closest("[data-zone]");
            if (!dropZone) return ui.notifications.warn("请将物品明确拖入【免费区】、【半价区】或【全价区】内！");

            const zone = dropZone.dataset.zone;
            const price = item.system.price || 0;

            let rawDesc = item.system.description || "暂无描述";
            let cleanDesc = rawDesc.replace(/<[^>]*>?/gm, '').substring(0, 100);
            if (rawDesc.length > 100) cleanDesc += "...";
            const tooltipHtml = `
                <div style='text-align:left; max-width:250px;'>
                    <strong style='color:var(--c-highlight);'>${item.name}</strong><hr style='border-color:#555; margin:4px 0;'>
                    <div style='font-size:12px; color:#ccc; line-height:1.4;'>${cleanDesc}</div>
                </div>
            `;

            // 仅限消耗品、杂物、秘籍可以堆叠
            const stackableTypes = ["consumable", "misc", "manual"];
            const isStackable = stackableTypes.includes(item.type);

            let existing = null;
            if (isStackable) {
                existing = this.wizardData.shopping.items.find(i => i.uuid === item.uuid && i.zone === zone);
            }

            if (existing) {
                existing.quantity += 1;
                // 强制修改表单缓存，防止被旧数据覆盖
                this.wizardData[`shopping_qty_${existing.id}`] = existing.quantity;
            } else {
                this.wizardData.shopping.items.push({
                    id: foundry.utils.randomID(),
                    uuid: item.uuid,
                    type: item.type,
                    name: item.name,
                    img: item.img,
                    price: price,
                    quantity: 1,
                    zone: zone,
                    tooltip: tooltipHtml,
                    itemData: item.toObject()
                });
            }

            // 再次计算总价，跳过 DOM 读取
            this._onRefreshShoppingBudget(true);
            this.render();
        }
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
    // Step 5: 技艺精通 (无需额外代码)
    // ==========================================

    // ==========================================
    // Step 6: 行囊采购
    // ==========================================

    /**
     * 移除购物车物品
     */
    async _onRemoveShoppingItem(event, target) {
        event.preventDefault();
        this._saveCurrentStepData(); // 先保存其他可能正在输入的内容
        const id = target.dataset.id;

        // 背景/门派赠品不可删除
        const item = this.wizardData.shopping.items.find(i => i.id === id);
        if (item?.isBackgroundAsset) {
            return ui.notifications.warn("身世赠送物品无法移除。如需更换，请返回第2步重新选择背景。");
        }
        if (item?.isSectAsset) {
            return ui.notifications.warn("门派赠送物品无法移除。如需更换，请返回第1步重新选择门派。");
        }

        this.wizardData.shopping.items = this.wizardData.shopping.items.filter(i => i.id !== id);
        this._onRefreshShoppingBudget(true); // 跳过读取旧DOM
        this.render();
    }

    /**
     * 逆向计算购物车花费
     * @param {boolean} skipSave 是否跳过从表单抓取数据（防止拖拽增加数量时被旧DOM覆盖）
     */
    _onRefreshShoppingBudget(skipSave = false) {
        if (!skipSave) {
            this._saveCurrentStepData();
        }

        const state = this.wizardData;
        let totalCost = 0;

        for (const item of state.shopping.items) {
            const qtyInputName = `shopping_qty_${item.id}`;
            // 只有在表单中真实存在该字段时，才去覆盖内存
            if (state[qtyInputName] !== undefined) {
                item.quantity = Math.max(1, parseInt(state[qtyInputName]) || 1);
            }

            let multiplier = 1;
            if (item.zone === "free") multiplier = 0;
            else if (item.zone === "half") multiplier = 0.5;

            totalCost += Math.floor(item.price * item.quantity * multiplier);
        }

        state.shopping.runtimeSilver = state.shopping.silver - totalCost;

        const remainEl = this.element.querySelector("#remain-silver");
        if (remainEl) {
            remainEl.innerText = state.shopping.runtimeSilver;
            remainEl.style.color = state.shopping.runtimeSilver < 0 ? "#e74c3c" : (state.shopping.runtimeSilver === 0 ? "#95a5a6" : "#2ecc71");
        }
    }

    // ==========================================
    // Step 7: 降生结算
    // ==========================================
    async _onFinishWizard(event, target) {
        event.preventDefault();

        // 确保数值是最新鲜的
        this._onRefreshBudget();
        this._onRefreshShoppingBudget(); // 确保购物结算也是最新的

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
        // 提取最终银两
        const finalSilver = this.wizardData.shopping.runtimeSilver || 0;

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
            "system.resources.silver": finalSilver,
            "system.cultivation": {
                general: rb.general,
                neigong: rb.neigong,
                wuxue: rb.wuxue,
                arts: this.wizardData.budget.arts
            }
        };

        // --- 构建规范的审计日志 ---
        const historyLogs = [];
        let logTimeCursor = Date.now();

        const addLog = (title, deltaVal, reason, poolKey = null) => {
            if (deltaVal <= 0) return; // 不产生 0 或 负数 日志

            // 构造符合系统解析格式的字符串，例如 "general: 5000"
            const balanceStr = poolKey ? `${poolKey}: ${deltaVal}` : "";

            historyLogs.push({
                id: foundry.utils.randomID(),
                realTime: logTimeCursor -= 10,
                type: "resource",
                importance: 1,
                title: title,
                reason: reason,
                delta: `+${deltaVal}`,
                balance: balanceStr
            });
        };

        // 独立分块记录初始资源
        addLog("初始通用修为", this.wizardData.budget.general, "开局资源", "general");
        addLog("初始内功专属", this.wizardData.budget.neigong, "开局资源", "neigong");
        addLog("初始武学专属", this.wizardData.budget.wuxue, "开局资源", "wuxue");
        addLog("初始技艺专属", this.wizardData.budget.arts, "开局资源", "arts");

        // 技艺部分
        const artsChanges = [];

        // 遍历所有技艺输入值
        for (const [artKey, lvlStr] of Object.entries(this.wizardData.artsBonus || {})) {
            const lvl = parseInt(lvlStr) || 0;
            if (lvl > 0) {
                // 推入修改配置：路径指向 arts.xxx.mod
                artsChanges.push({
                    key: `arts.${artKey}.mod`,
                    value: lvl
                });
            }
        }

        // 清理旧的向导赠送数据，防止重复建卡时无限累加
        let existingModifiers = (actor.system.customModifiers || []).filter(m => m.name !== "开卡赠送技艺等级");

        if (artsChanges.length > 0) {
            existingModifiers.push({
                id: foundry.utils.randomID(),
                name: "开卡赠送技艺等级",
                enabled: true,
                changes: artsChanges
            });
        }
        actorUpdates["system.customModifiers"] = existingModifiers;

        // --- 物品装配与经验注入 ---
        const itemsToCreate = [];

        // 背景：保留原始 assets（删除时需计算应收回银两），用 _wizardCreated 标记阻止钩子重复发放
        // grantToken 用于删除背景时定位赠品（与 Actor 钩子拖入流程一致的清理机制）
        const bgGrantToken = this.wizardData.origins.background ? foundry.utils.randomID() : null;
        if (this.wizardData.origins.background) {
            const bgClone = foundry.utils.deepClone(this.wizardData.origins.background);
            foundry.utils.setProperty(bgClone, "flags.xjzl-system.grantToken", bgGrantToken);
            foundry.utils.setProperty(bgClone, "flags.xjzl-system._wizardCreated", true);
            itemsToCreate.push(bgClone);
        }
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
                    addLog(`开卡赠送: ${asm.name}`, reqXP, "内功折算", "neigong");
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
                    addLog(`开卡赠送: ${asm.name}`, freeMoveXpTotal, "武学折算", "wuxue");
                }
            }
            itemsToCreate.push(newItemData);
        }

        // 遍历并写入购物车的所有物品
        for (const shopItem of this.wizardData.shopping.items) {
            const newItemData = foundry.utils.deepClone(shopItem.itemData);
            // 将购物车里决定的数量覆盖原物品的数量
            newItemData.system.quantity = shopItem.quantity;
            // 背景赠品打标记，确保后续删除背景时能正确清理
            if (shopItem.isBackgroundAsset && bgGrantToken) {
                foundry.utils.setProperty(newItemData, "flags.xjzl-system.grantedByBackground", bgGrantToken);
            }
            // 门派赠品打标记，确保后续更换门派时能正确清理
            if (shopItem.isSectAsset) {
                foundry.utils.setProperty(newItemData, "flags.xjzl-system.grantedBySect", true);
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

        // 提交变更（设置 _wizardActive 标记，阻止 updateActor 钩子自动发放门派赠品）
        await actor.setFlag("xjzl-system", "_wizardActive", true);
        await actor.update(actorUpdates);

        if (itemsToCreate.length > 0) {
            await actor.createEmbeddedDocuments("Item", itemsToCreate);
        }
        await actor.unsetFlag("xjzl-system", "_wizardActive");

        ui.notifications.success(`${actor.name} 降生成功！`);
        // 强制关闭，跳过确认弹窗
        this.close({ force: true });
        actor.sheet.render(true);
    }
}
