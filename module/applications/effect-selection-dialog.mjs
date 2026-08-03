// module/applications/effect-selection-dialog.mjs
import { ActiveEffectManager } from "../managers/active-effect-manager.mjs";
import { promptEffectDuration } from "../sheets/behaviors/effect-interactions.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const RECENT_STATUS_LIMIT = 12;
const FAVORITE_STATUS_LIMIT = 24;
const DEFAULT_FAVORITE_STATUS_IDS = ["prone", "root", "unstable", "blind", "bleed_stack", "pain", "pofang", "unconscious", "dying", "dead"];

const STATUS_CATEGORIES = [
    {
        id: "common",
        label: "常用",
        icon: "fas fa-star",
        ids: []
    },
    { id: "recent", label: "最近", icon: "fas fa-clock-rotate-left", ids: [] },
    { id: "injury", label: "伤势", icon: "fas fa-droplet", ids: ["sielie", "bleed_stack", "endless_bleed", "pain", "bloodloss", "pofang", "cuogu", "dying", "dead", "unconscious"] },
    { id: "control", label: "控制", icon: "fas fa-hand", ids: ["dianxue", "xuanyun", "stun", "root", "fushen", "prone", "zuidao", "blind", "deaf"] },
    { id: "seal", label: "封招", icon: "fas fa-ban", ids: ["jinxu", "jinshi", "jinfan", "jinqi", "jinjue", "fengzhao", "jiaoxie"] },
    { id: "resource", label: "封锁", icon: "fas fa-lock", ids: ["bunu", "jinliao", "qizhi", "poyi", "fatigue", "hunger"] },
    { id: "buff", label: "增益", icon: "fas fa-arrow-trend-up", ids: ["yangxue", "juqi", "chengfeng", "gangjin", "mianjin", "panshi", "hushen", "xujin", "yanli", "qingling", "jinli", "wuqishi", "jinqi_stack", "wutong"] },
    { id: "debuff", label: "减益", icon: "fas fa-arrow-trend-down", ids: ["qixu", "tuoli", "cuoluan", "youyu", "yudun", "shizhun", "benzhuo", "fali", "chanshou", "yishang", "unstable", "chizhi", "rage", "zibi"] },
    { id: "scene", label: "场上特效", icon: "fas fa-location-dot", ids: [] },
    { id: "all", label: "全部", icon: "fas fa-border-all", ids: [] }
];

export class EffectSelectionDialog extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "xjzl-effect-picker",
        classes: ["xjzl-effect-picker-window", "theme-dark"],
        window: {
            title: "侠界状态盘",
            icon: "fas fa-hand-sparkles",
            width: 760,
            height: 700,
            resizable: true
        },
        position: {
            width: 760,
            height: 700
        },
        actions: {
            applyStatus: EffectSelectionDialog.prototype._onApplyStatus,
            applyItemEffect: EffectSelectionDialog.prototype._onApplyItemEffect,
            adjustEffect: EffectSelectionDialog.prototype._onAdjustEffect,
            deleteEffect: EffectSelectionDialog.prototype._onDeleteEffect,
            removeRecent: EffectSelectionDialog.prototype._onRemoveRecent,
            clearRecent: EffectSelectionDialog.prototype._onClearRecent,
            toggleFavorite: EffectSelectionDialog.prototype._onToggleFavorite,
            resetFavorites: EffectSelectionDialog.prototype._onResetFavorites
        }
    };

    static PARTS = {
        form: {
            template: "systems/xjzl-system/templates/apps/effect-selection.hbs"
        }
    };

    constructor(options = {}) {
        super(options);
        this.actor = options.actor || null;
        this._activeCategory = "common";
    }

    static openForActor(actor) {
        const existingApp = Object.values(ui.windows).find(app => app.options.id === "xjzl-effect-picker");
        if (existingApp) {
            existingApp.actor = actor;
            existingApp.render(true, { focus: true });
            return existingApp;
        }
        return new EffectSelectionDialog({ actor }).render(true);
    }

    /**
     * 准备渲染数据 - 扫描全场景
     */
    async _prepareContext(options) {
        const targetActors = this._getTargetActors();
        const targetMode = targetActors.length === 0 ? "none" : (targetActors.length === 1 ? "single" : "multiple");
        const targetActor = targetMode === "single" ? targetActors[0] : null;
        const currentEffects = targetActor ? this._prepareCurrentEffects(targetActor) : [];
        const activeEffectSlugs = new Set(currentEffects.map(e => e.slug).filter(Boolean));
        const recentIds = await this._getRecentStatusIds();
        const recentSceneEffectUuids = await this._getRecentSceneEffectUuids();
        const recentSceneEffectSet = new Set(recentSceneEffectUuids);
        const favoriteIds = await this._getFavoriteStatusIds();

        // ===========================================
        // 1. 通用状态 (Universal)
        // ===========================================
        const statusEffects = CONFIG.statusEffects.map(e => {
            const name = game.i18n.localize(e.name);
            const descKey = e.description || ""; // 获取配置里的 description key
            const desc = descKey ? game.i18n.localize(descKey) : "无详细描述";
            const slug = foundry.utils.getProperty(e, "flags.xjzl-system.slug") || e.id;
            const categories = this._getStatusCategories(e.id, recentIds, favoriteIds);

            // 构建富文本 Tooltip
            // Foundry 支持 data-tooltip 传入 HTML
            const richTooltip = `
                <div style="text-align: left; min-width: 200px; max-width: 300px;">
                    <h3 style="margin: 0 0 5px 0; border-bottom: 1px solid #777; padding-bottom: 2px;">${name}</h3>
                    <p style="margin: 0; font-size: 0.9em; line-height: 1.4;">${desc}</p>
                    ${e.flags?.['xjzl-system']?.stackable ?
                    '<p style="margin-top: 5px; color: #aaa; font-size: 0.8em;"><i class="fas fa-layer-group"></i> 可堆叠</p>' : ''}
                </div>
            `;

            return {
                ...e,
                name: name,
                slug,
                categories,
                categoryString: categories.join(" "),
                isActive: activeEffectSlugs.has(slug),
                isRecent: recentIds.includes(e.id),
                isFavorite: favoriteIds.includes(e.id),
                isStackable: !!e.flags?.['xjzl-system']?.stackable,
                richTooltip: richTooltip // 传给模板
            };
        });

        const categoryCounts = this._countCategories(statusEffects);
        const categories = STATUS_CATEGORIES.map(c => ({
            ...c,
            count: c.id === "scene" ? 0 : (categoryCounts[c.id] || 0),
            active: c.id === this._activeCategory
        }));

        // ===========================================
        // 2. 扫描场景内的特效 (Scene Context)
        // ===========================================
        // 结构目标：按 Actor 分组，方便 GM 找是谁出的招
        // [ { actorName: "Boss", items: [ {name: "毒掌", img: "..."} ] } ]
        const sceneGroups = [];

        // 获取场景内所有 Token (不管是通过 canvas.tokens.placeables 还是 document 集合)
        const tokens = canvas?.tokens?.placeables || [];

        for (const token of tokens) {
            const actor = token.actor;
            if (!actor) continue;
            if (!token.visible) continue; //隐藏的token不显示
            if (!game.user.isGM && !actor.isOwner) continue;

            const actorEffects = [];

            for (const item of actor.items) {
                for (const effect of item.effects) {
                    // 筛选：非被动传输 (transfer: false) 且 未禁用
                    // 还可以加一个逻辑：必须有 changes 或者有 duration (防止空壳特效)
                    if (effect.transfer === false && !effect.disabled) {
                        // 构建物品特效的 Tooltip
                        const itemTooltip = `
                            <div style="text-align: left; min-width: 150px;">
                                <strong style="display:block; font-size: 1.1em; margin-bottom: 4px;">${effect.name}</strong>
                                <div style="font-size: 0.85em; color: #aaa; margin-bottom: 4px;">
                                    <i class="fas fa-box-open"></i> 来源: ${item.name}
                                </div>
                                <div style="font-size: 0.85em; color: #ccc;">
                                    ${effect.description || ""}
                                </div>
                            </div>
                        `;

                        actorEffects.push({
                            uuid: effect.uuid,
                            name: effect.name,
                            img: effect.img || item.img, // 优先用特效图标，没有则用物品图标
                            itemName: item.name,
                            actorName: token.name,
                            isRecent: recentSceneEffectSet.has(effect.uuid),
                            richTooltip: itemTooltip // 传给模板
                        });
                    }
                }
            }

            if (actorEffects.length > 0) {
                sceneGroups.push({
                    actorName: token.name, // 使用 Token 名字 (可能和 Actor 名字不同)
                    effects: actorEffects
                });
            }
        }

        const sceneCategory = categories.find(c => c.id === "scene");
        if (sceneCategory) sceneCategory.count = sceneGroups.reduce((total, group) => total + group.effects.length, 0);
        const recentCategory = categories.find(c => c.id === "recent");
        if (recentCategory) {
            recentCategory.count += sceneGroups.reduce((total, group) => {
                return total + group.effects.filter(effect => effect.isRecent).length;
            }, 0);
        }

        return {
            targetMode,
            targetActor,
            targetActors,
            currentEffects,
            hasTarget: targetActors.length > 0,
            activeCategory: this._activeCategory,
            categories,
            statusEffects,
            sceneGroups
        };
    }

    _prepareCurrentEffects(actor) {
        return actor.effects
            .filter(e => !e.disabled)
            .map(e => {
                const slug = e.getFlag("xjzl-system", "slug") || e.name?.slugify?.() || e.id;
                let source = e.sourceName;
                if (source === "Unknown" || !source) source = e.parent instanceof Item ? e.parent.name : "未知来源";

                let durationLabel = "";
                const d = e.duration;
                if (d?.rounds) {
                    if (game.combat?.round) {
                        const elapsed = game.combat.round - (d.startRound || game.combat.round);
                        const remaining = Math.max(0, d.rounds - elapsed);
                        durationLabel = remaining === 0 ? "即将结束" : `${remaining} 回合`;
                    } else {
                        durationLabel = `${d.rounds} 回合`;
                    }
                }

                return {
                    id: e.id,
                    slug,
                    name: e.name,
                    img: e.img,
                    sourceName: source,
                    description: e.description,
                    isStackable: e.isStackable,
                    stacks: e.stacks || 1,
                    durationLabel
                };
            });
    }

    _getStatusCategories(statusId, recentIds = [], favoriteIds = []) {
        const categories = [];
        for (const category of STATUS_CATEGORIES) {
            if (category.id === "recent" && recentIds.includes(statusId)) categories.push(category.id);
            else if (category.id === "common" && favoriteIds.includes(statusId)) categories.push(category.id);
            else if (category.id === "all") categories.push(category.id);
            else if (category.ids.includes(statusId)) categories.push(category.id);
        }
        if (categories.length === 1 && categories[0] === "all") categories.unshift("debuff");
        return categories;
    }

    _countCategories(statusEffects) {
        const counts = {};
        for (const status of statusEffects) {
            for (const category of status.categories) counts[category] = (counts[category] || 0) + 1;
        }
        return counts;
    }

    async _getRecentStatusIds() {
        const existingIds = new Set(CONFIG.statusEffects.map(e => e.id));
        const savedIds = await game.user.getFlag("xjzl-system", "recentStatusPickerIds") || [];
        return savedIds.filter(id => existingIds.has(id)).slice(0, RECENT_STATUS_LIMIT);
    }

    async _getRecentSceneEffectUuids() {
        const savedUuids = await game.user.getFlag("xjzl-system", "recentSceneEffectPickerUuids") || [];
        if (!Array.isArray(savedUuids)) return [];
        return savedUuids.filter(Boolean).slice(0, RECENT_STATUS_LIMIT);
    }

    async _getFavoriteStatusIds() {
        const existingIds = new Set(CONFIG.statusEffects.map(e => e.id));
        const savedIds = await game.user.getFlag("xjzl-system", "favoriteStatusPickerIds");
        const sourceIds = Array.isArray(savedIds) ? savedIds : DEFAULT_FAVORITE_STATUS_IDS;
        return sourceIds.filter(id => existingIds.has(id)).slice(0, FAVORITE_STATUS_LIMIT);
    }

    /**
     * 辅助：获取当前选中的目标
     */
    _getTargetActors({ notify = false } = {}) {
        if (this.actor) return [this.actor].filter(Boolean);

        const targets = (canvas?.tokens?.controlled || []).map(t => t.actor).filter(Boolean);
        if (targets.length === 0) {
            if (notify) ui.notifications.warn("请先选择一个 Token 作为目标！");
            return [];
        }
        return targets;
    }

    static getControlledActors(app, options = {}) {
        return app._getTargetActors(options);
    }

    async _rememberStatus(statusId) {
        if (!statusId) return;
        const current = await this._getRecentStatusIds();
        const next = [statusId, ...current.filter(id => id !== statusId)].slice(0, RECENT_STATUS_LIMIT);
        await game.user.setFlag("xjzl-system", "recentStatusPickerIds", next);
    }

    async _forgetStatus(statusId) {
        if (!statusId) return;
        const current = await this._getRecentStatusIds();
        const next = current.filter(id => id !== statusId);
        await game.user.setFlag("xjzl-system", "recentStatusPickerIds", next);
    }

    async _rememberSceneEffect(uuid) {
        if (!uuid) return;
        const current = await this._getRecentSceneEffectUuids();
        const next = [uuid, ...current.filter(id => id !== uuid)].slice(0, RECENT_STATUS_LIMIT);
        await game.user.setFlag("xjzl-system", "recentSceneEffectPickerUuids", next);
    }

    async _forgetSceneEffect(uuid) {
        if (!uuid) return;
        const current = await this._getRecentSceneEffectUuids();
        const next = current.filter(id => id !== uuid);
        await game.user.setFlag("xjzl-system", "recentSceneEffectPickerUuids", next);
    }

    async _toggleFavoriteStatus(statusId) {
        if (!statusId) return;
        const current = await this._getFavoriteStatusIds();
        const next = current.includes(statusId)
            ? current.filter(id => id !== statusId)
            : [statusId, ...current].slice(0, FAVORITE_STATUS_LIMIT);
        await game.user.setFlag("xjzl-system", "favoriteStatusPickerIds", next);
    }

    /**
     * 动作：应用通用状态
     */
    async _onApplyStatus(event, target) {
        const actors = EffectSelectionDialog.getControlledActors(this, { notify: true });
        if (!actors.length) return; // 如果没选 Token，getControlledActors 内部会弹警告

        const slug = target.dataset.slug;

        // 从 CONFIG 中查找数据模板
        const statusData = CONFIG.statusEffects.find(e => e.id === slug);
        if (!statusData) return;

        for (const actor of actors) {
            // 深拷贝并应用
            const effectData = foundry.utils.deepClone(statusData);
            await game.xjzl.api.effects.addEffect(actor, effectData);
        }

        await this._rememberStatus(statusData.id);
        ui.notifications.info(`已对 ${actors.length} 个目标应用 [${game.i18n.localize(statusData.name)}]`);
        this.render();
    }

    /**
     * 动作：应用物品特效
     */
    async _onApplyItemEffect(event, target) {
        const actors = EffectSelectionDialog.getControlledActors(this, { notify: true });
        if (!actors.length) return;

        const uuid = target.dataset.uuid;
        const sourceEffect = await fromUuid(uuid); // 异步获取源数据
        if (!sourceEffect) return;

        // 准备数据
        const baseData = sourceEffect.toObject();
        delete baseData._id;

        // 关键：设置 Origin 为源物品的 UUID
        // 这样我们知道这个状态是 "Boss 的 毒掌" 造成的
        baseData.origin = sourceEffect.parent.uuid;

        for (const actor of actors) {
            // 注意：每次循环都要深拷贝一份，因为 addEffect 可能会修改数据
            const effectData = foundry.utils.deepClone(baseData);
            await game.xjzl.api.effects.addEffect(actor, effectData);
        }

        await this._rememberSceneEffect(uuid);
        ui.notifications.info(`已对 ${actors.length} 个目标应用 [${sourceEffect.name}]`);
        this.render();
    }

    async _onAdjustEffect(event, target) {
        const actors = EffectSelectionDialog.getControlledActors(this, { notify: true });
        if (actors.length !== 1) return ui.notifications.warn("调整已有状态时请只选择一个目标。");

        const effect = actors[0].effects.get(target.dataset.id);
        if (!effect) return;

        if (effect.isStackable) await ActiveEffectManager.addEffect(actors[0], effect.toObject(), 1);
        else await promptEffectDuration(this, effect);

        this.render();
    }

    async _onDeleteEffect(event, target) {
        const actors = EffectSelectionDialog.getControlledActors(this, { notify: true });
        if (actors.length !== 1) return ui.notifications.warn("移除已有状态时请只选择一个目标。");

        const effect = actors[0].effects.get(target.dataset.id);
        if (!effect) return;

        await effect.delete();
        ui.notifications.info(`已移除状态: ${effect.name}`);
        this.render();
    }

    async _onRemoveRecent(event, target) {
        event.preventDefault();
        event.stopPropagation();
        if (target.dataset.recentType === "scene") await this._forgetSceneEffect(target.dataset.uuid);
        else await this._forgetStatus(target.dataset.slug);
        this.render();
    }

    async _onClearRecent(event, target) {
        event.preventDefault();
        event.stopPropagation();
        await game.user.setFlag("xjzl-system", "recentStatusPickerIds", []);
        await game.user.setFlag("xjzl-system", "recentSceneEffectPickerUuids", []);
        this.render();
    }

    async _onToggleFavorite(event, target) {
        event.preventDefault();
        event.stopPropagation();
        await this._toggleFavoriteStatus(target.dataset.slug);
        this.render();
    }

    async _onResetFavorites(event, target) {
        event.preventDefault();
        event.stopPropagation();
        await game.user.unsetFlag("xjzl-system", "favoriteStatusPickerIds");
        this.render();
    }

    // --- 搜索过滤逻辑 (可选优化) ---
    // 如果想实现实时搜索，可以监听 keyup 事件
    _onRender(context, options) {
        super._onRender(context, options);

        const html = this.element;
        const searchInput = html.querySelector('input[name="filter"]');
        const categoryButtons = html.querySelectorAll(".category-tab");
        const pickerRoot = html.matches?.(".xjzl-effect-picker") ? html : html.querySelector(".xjzl-effect-picker");

        const applyFilters = () => {
            const query = (searchInput?.value || "").toLowerCase().trim();
            const activeCategory = this._activeCategory;
            html.dataset.activeCategory = activeCategory;
            if (pickerRoot) pickerRoot.dataset.activeCategory = activeCategory;
            categoryButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.category === activeCategory));

            let visibleStatusCount = 0;
            let visibleSceneCount = 0;
            html.querySelectorAll(".effect-btn[data-action='applyStatus']").forEach(btn => {
                const text = (btn.textContent + (btn.dataset.tooltip || "") + (btn.dataset.search || "")).toLowerCase();
                const isCategoryMatch = activeCategory === "all" || (btn.dataset.categories || "").split(" ").includes(activeCategory);
                const isMatch = isCategoryMatch && text.includes(query);
                btn.hidden = !isMatch;
                if (isMatch) visibleStatusCount++;
            });

            html.querySelectorAll(".actor-group").forEach(group => {
                let visibleCount = 0;
                group.querySelectorAll(".effect-btn[data-action='applyItemEffect']").forEach(btn => {
                    const text = (btn.textContent + (btn.dataset.tooltip || "") + (btn.dataset.search || "")).toLowerCase();
                    const isCategoryMatch = activeCategory === "scene" || (activeCategory === "recent" && btn.dataset.recent === "true");
                    const isMatch = isCategoryMatch && text.includes(query);
                    btn.hidden = !isMatch;
                    if (isMatch) visibleCount++;
                });
                group.hidden = !["scene", "recent"].includes(activeCategory) || visibleCount === 0;
                visibleSceneCount += visibleCount;
            });

            const sceneEmpty = html.querySelector(".scene-empty");
            if (sceneEmpty) sceneEmpty.hidden = activeCategory !== "scene";

            const statusEmpty = html.querySelector(".status-empty");
            if (statusEmpty) statusEmpty.hidden = activeCategory === "scene" || (visibleStatusCount + visibleSceneCount) > 0;
        };

        categoryButtons.forEach(btn => {
            btn.addEventListener("click", event => {
                event.preventDefault();
                this._activeCategory = btn.dataset.category;
                categoryButtons.forEach(b => b.classList.toggle("active", b === btn));
                applyFilters();
            });
        });

        // 定义搜索处理函数
        const handleSearch = (e) => {
            applyFilters();
        };

        // 绑定事件
        searchInput?.addEventListener("input", handleSearch);
        // =====================================================
        // 3. 右键点击逻辑 (减层/移除)
        // =====================================================

        // 获取所有带有 data-action 的按钮
        const actionButtons = html.querySelectorAll('[data-action="applyStatus"], [data-action="applyItemEffect"], [data-action="adjustEffect"]');

        actionButtons.forEach(btn => {
            btn.addEventListener('contextmenu', async (event) => {
                if (event.target?.closest?.("[data-action]") !== btn) return;

                const action = btn.dataset.action;
                if (!["applyStatus", "applyItemEffect", "adjustEffect"].includes(action)) return;

                event.preventDefault(); // 阻止浏览器默认菜单

                const actors = EffectSelectionDialog.getControlledActors(this, { notify: true });
                if (!actors.length) return;

                // 逻辑分支 A: 通用状态减层
                if (action === "applyStatus") {
                    const slug = btn.dataset.slug;
                    // 直接调用 Manager 的移除
                    for (const actor of actors) {
                        await game.xjzl.api.effects.removeEffect(actor, slug, 1);
                    }
                    ui.notifications.info(`已对选中目标执行移除/减层操作。`);
                    this.render();
                }

                // 逻辑分支 B: 物品特效减层
                else if (action === "applyItemEffect") {
                    const uuid = btn.dataset.uuid;
                    const sourceEffect = await fromUuid(uuid);
                    if (!sourceEffect) return;

                    // 我们需要知道这个特效在目标身上叫什么 (Slug)
                    // 通常逻辑是：优先取 flag.slug，否则取 slugify(name)
                    const flagSlug = sourceEffect.getFlag("xjzl-system", "slug");
                    const targetSlug = flagSlug || sourceEffect.name.slugify();

                    for (const actor of actors) {
                        await game.xjzl.api.effects.removeEffect(actor, targetSlug, 1);
                    }
                    ui.notifications.info(`已对选中目标执行移除/减层操作。`);
                    this.render();
                }

                else if (action === "adjustEffect") {
                    if (actors.length !== 1) return ui.notifications.warn("减少已有状态时请只选择一个目标。");
                    const effect = actors[0].effects.get(btn.dataset.id);
                    if (!effect) return;
                    if (!effect.isStackable) return;
                    const currentStacks = effect.stacks || 1;
                    if (currentStacks > 1) await ActiveEffectManager.removeEffect(actors[0], effect.id, 1);
                    else ui.notifications.info(`"${effect.name}" 当前只有 1 层。如需移除请点击删除按钮。`);
                    this.render();
                }
            });
        });

        applyFilters();
    }
}
