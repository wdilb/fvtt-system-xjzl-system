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
    { id: "buff", label: "增益", icon: "fas fa-arrow-trend-up", ids: ["yangxue", "juqi", "chengfeng", "gangjin", "mianjin", "panshi", "hushen", "xujin", "yanli", "qingling", "jinli", "wuqishi", "jinqi_stack", "wutong", "lianji", "yanzhan"] },
    { id: "debuff", label: "减益", icon: "fas fa-arrow-trend-down", ids: ["qixu", "tuoli", "cuoluan", "youyu", "yudun", "shizhun", "benzhuo", "fali", "chanshou", "yishang", "pojia", "unstable", "chizhi", "rage", "zibi"] },
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
            resetFavorites: EffectSelectionDialog.prototype._onResetFavorites,
            toggleGroupCollapse: EffectSelectionDialog.prototype._onToggleGroupCollapse,
            setTargetMode: EffectSelectionDialog.prototype._onSetTargetMode,
            clearTargets: EffectSelectionDialog.prototype._onClearTargets
        }
    };

    static PARTS = {
        form: {
            template: "systems/xjzl-system/templates/apps/effect-selection.hbs"
        }
    };

    constructor(options = {}) {
        super(options);
        // 目标 Actor：从角色卡打开状态盘时直接传入；为 null 时由 _getTargetActors 取当前选中的 Token
        this.actor = options.actor || null;
        // 当前激活的分类 tab id（"common" | "recent" | "scene" 等）
        this._activeCategory = "common";
        // 已折叠的「场上特效」角色分组（按 token.id 记录），保证切换分类/搜索重渲染后折叠状态不丢失
        this._collapsedActors = new Set();
        // 目标读取模式：controlled = 画布框选，targeted = Alt+左键瞄准（持久化到客户端设置）
        this._targetMode = game.settings.get("xjzl-system", "targetSelectionMode") === "targeted" ? "targeted" : "controlled";
        // 搜索词保存到实例，避免框选/瞄准变化触发重渲染时清空用户输入
        this._filterQuery = "";
        // 框选或瞄准变化时刷新头部目标显示；重渲染前记住滚动位置，避免状态列表被拉回顶部
        this._refreshTargets = foundry.utils.debounce(() => {
            if (!this.rendered) return;
            const scrollEl = this.element.querySelector(".picker-scroll");
            const tabEl = this.element.querySelector(".category-tabs");
            const scrollTop = scrollEl?.scrollTop ?? 0;
            const tabTop = tabEl?.scrollTop ?? 0;
            this.render({ force: true })
                .then(() => {
                    const nextScroll = this.element.querySelector(".picker-scroll");
                    const nextTab = this.element.querySelector(".category-tabs");
                    if (nextScroll) nextScroll.scrollTop = scrollTop;
                    if (nextTab) nextTab.scrollTop = tabTop;
                })
                .catch(error => console.error("XJZL | 状态盘目标刷新重渲染失败:", error));
        }, 60);
        this._hookIds = [
            // 只监听与当前目标模式相关的变化，避免整窗重绘干扰搜索框焦点与滚动
            ["controlToken", Hooks.on("controlToken", () => {
                if (this._targetMode === "controlled") this._refreshTargets();
            })],
            // targetToken 会为所有用户的瞄准变化触发（含其他玩家经 socket 同步的），只关心本客户端且处于瞄准模式时
            ["targetToken", Hooks.on("targetToken", (user) => {
                if (user === game.user && this._targetMode === "targeted") this._refreshTargets();
            })],
            // 与伤害工具共享同一份目标模式偏好：别处（含另一工具窗口）切换时，本窗口保持同步
            ["clientSettingChanged", Hooks.on("clientSettingChanged", (key, value) => {
                if (key !== "xjzl-system.targetSelectionMode") return;
                const mode = value === "targeted" ? "targeted" : "controlled";
                if (mode === this._targetMode) return;
                this._targetMode = mode;
                if (this.rendered) this.render();
            })]
        ];
    }

    /**
     * 关闭窗口时注销仅服务本工具的 Hooks，避免实例复用或反复开关后累积监听器。
     * @param {object} options ApplicationV2 关闭选项。
     * @returns {Promise<EffectSelectionDialog>} Foundry 的关闭结果。
     */
    async close(options = {}) {
        for (const [hook, id] of this._hookIds) Hooks.off(hook, id);
        this._hookIds = [];
        return super.close(options);
    }

    /**
     * 静态入口：为指定 Actor 打开状态盘
     * 窗口已存在则复用并切换目标（避免重复弹窗），否则新建实例
     */
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
        const targetAvatarInfo = targetMode === "multiple" ? this._buildTargetAvatars(targetActors) : null;
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
                    actorId: token.id, // 以 token.id 唯一标识分组，作为折叠状态的 key（同名角色可区分）
                    actorName: token.name, // 使用 Token 名字 (可能和 Actor 名字不同)
                    collapsed: this._collapsedActors.has(token.id), // 该角色当前是否处于折叠状态
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
            isActorBound: !!this.actor,
            boundActorName: this.actor?.name || "",
            targetModeControlled: this._targetMode !== "targeted",
            targetModeTargeted: this._targetMode === "targeted",
            targetAvatars: targetAvatarInfo?.avatars || [],
            targetAvatarTotal: targetAvatarInfo?.total || 0,
            filter: this._filterQuery,
            categories,
            statusEffects,
            sceneGroups
        };
    }

    /**
     * 构建多目标模式下头部展示的头像列表；入参已由 _getTargetActors 按 Actor UUID 去重。
     * @param {Actor[]} actors 当前目标 Actor 列表（去重后）。
     * @returns {{avatars: Array<{img: string, name: string}>, total: number}}
     */
    _buildTargetAvatars(actors) {
        const avatars = actors.map(actor => ({ img: actor.img, name: actor.name, uuid: actor.uuid }));
        return { avatars, total: avatars.length };
    }

    /**
     * 汇总选中目标身上当前生效的状态，供「身上状态」面板展示
     * 附带来源、堆叠层数、剩余回合数等展示信息
     */
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

    /**
     * 计算一个通用状态归属于哪些分类（供分类 tab 计数与搜索过滤匹配）
     * @param {string} statusId 状态 id
     * @param {string[]} recentIds 最近使用过的状态 id
     * @param {string[]} favoriteIds 收藏（常用）状态 id
     * @returns {string[]} 分类 id 列表（至少含 "all"）
     */
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

    /**
     * 统计每个分类下各有多少个状态，用于分类 tab 上的数量角标
     */
    _countCategories(statusEffects) {
        const counts = {};
        for (const status of statusEffects) {
            for (const category of status.categories) counts[category] = (counts[category] || 0) + 1;
        }
        return counts;
    }

    /**
     * 读取用户最近使用过的通用状态 id（存在 user flag，按使用时间倒序，过滤已失效的配置）
     */
    async _getRecentStatusIds() {
        const existingIds = new Set(CONFIG.statusEffects.map(e => e.id));
        const savedIds = await game.user.getFlag("xjzl-system", "recentStatusPickerIds") || [];
        return savedIds.filter(id => existingIds.has(id)).slice(0, RECENT_STATUS_LIMIT);
    }

    /**
     * 读取用户最近使用过的「场上特效」uuid（同样存在 user flag）
     */
    async _getRecentSceneEffectUuids() {
        const savedUuids = await game.user.getFlag("xjzl-system", "recentSceneEffectPickerUuids") || [];
        if (!Array.isArray(savedUuids)) return [];
        return savedUuids.filter(Boolean).slice(0, RECENT_STATUS_LIMIT);
    }

    /**
     * 读取用户收藏的「常用」状态 id；从未设置时回退到默认列表 DEFAULT_FAVORITE_STATUS_IDS
     */
    async _getFavoriteStatusIds() {
        const existingIds = new Set(CONFIG.statusEffects.map(e => e.id));
        const savedIds = await game.user.getFlag("xjzl-system", "favoriteStatusPickerIds");
        const sourceIds = Array.isArray(savedIds) ? savedIds : DEFAULT_FAVORITE_STATUS_IDS;
        return sourceIds.filter(id => existingIds.has(id)).slice(0, FAVORITE_STATUS_LIMIT);
    }

    /**
     * 辅助：获取当前选中的目标
     * 若从角色卡打开（this.actor 已指定）则固定为该角色；否则按当前目标模式读取框选或瞄准的 Token。
     * 统一按 Actor UUID 去重，让头部头像、目标计数与各项操作共用同一列表（同一 Actor 的多个 Token 只算一次）。
     */
    _getTargetActors({ notify = false } = {}) {
        if (this.actor) return [this.actor].filter(Boolean);

        const tokens = this._targetMode === "targeted"
            ? Array.from(game.user.targets || [])
            : (canvas?.tokens?.controlled || []);
        const seen = new Set();
        const targets = [];
        for (const token of tokens) {
            const actor = token.actor;
            if (!actor?.uuid || seen.has(actor.uuid)) continue;
            seen.add(actor.uuid);
            targets.push(actor);
        }
        if (targets.length === 0) {
            if (notify) ui.notifications.warn("请先选择一个 Token 作为目标！");
            return [];
        }
        return targets;
    }

    /**
     * 对外封装：获取应用当前的目标 Actor 列表（供各类动作处理复用）
     */
    static getControlledActors(app, options = {}) {
        return app._getTargetActors(options);
    }

    /**
     * 把某个通用状态记入「最近」列表（去重后置顶，超出上限裁掉最旧的）
     */
    async _rememberStatus(statusId) {
        if (!statusId) return;
        const current = await this._getRecentStatusIds();
        const next = [statusId, ...current.filter(id => id !== statusId)].slice(0, RECENT_STATUS_LIMIT);
        await game.user.setFlag("xjzl-system", "recentStatusPickerIds", next);
    }

    /**
     * 从「最近」列表中移除某个通用状态
     */
    async _forgetStatus(statusId) {
        if (!statusId) return;
        const current = await this._getRecentStatusIds();
        const next = current.filter(id => id !== statusId);
        await game.user.setFlag("xjzl-system", "recentStatusPickerIds", next);
    }

    /**
     * 把某个「场上特效」uuid 记入「最近」列表（去重后置顶）
     */
    async _rememberSceneEffect(uuid) {
        if (!uuid) return;
        const current = await this._getRecentSceneEffectUuids();
        const next = [uuid, ...current.filter(id => id !== uuid)].slice(0, RECENT_STATUS_LIMIT);
        await game.user.setFlag("xjzl-system", "recentSceneEffectPickerUuids", next);
    }

    /**
     * 从「最近」列表中移除某个「场上特效」uuid
     */
    async _forgetSceneEffect(uuid) {
        if (!uuid) return;
        const current = await this._getRecentSceneEffectUuids();
        const next = current.filter(id => id !== uuid);
        await game.user.setFlag("xjzl-system", "recentSceneEffectPickerUuids", next);
    }

    /**
     * 切换某个通用状态的收藏状态（在「常用」中加入/移出）
     */
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

    /**
     * 动作：调整目标身上已有的状态
     * 可堆叠状态左键加一层；不可堆叠则弹出持续时间设置窗口
     */
    async _onAdjustEffect(event, target) {
        const actors = EffectSelectionDialog.getControlledActors(this, { notify: true });
        if (actors.length !== 1) return ui.notifications.warn("调整已有状态时请只选择一个目标。");

        const effect = actors[0].effects.get(target.dataset.id);
        if (!effect) return;

        if (effect.isStackable) await ActiveEffectManager.addEffect(actors[0], effect.toObject(), 1);
        else await promptEffectDuration(this, effect);

        this.render();
    }

    /**
     * 动作：删除目标身上的一个状态（「身上状态」面板的 × 按钮）
     */
    async _onDeleteEffect(event, target) {
        const actors = EffectSelectionDialog.getControlledActors(this, { notify: true });
        if (actors.length !== 1) return ui.notifications.warn("移除已有状态时请只选择一个目标。");

        const effect = actors[0].effects.get(target.dataset.id);
        if (!effect) return;

        await effect.delete();
        ui.notifications.info(`已移除状态: ${effect.name}`);
        this.render();
    }

    /**
     * 动作：从「最近」列表中移除单个条目（通用状态或场上特效，由 recentType 区分）
     */
    async _onRemoveRecent(event, target) {
        event.preventDefault();
        event.stopPropagation();
        if (target.dataset.recentType === "scene") await this._forgetSceneEffect(target.dataset.uuid);
        else await this._forgetStatus(target.dataset.slug);
        this.render();
    }

    /**
     * 动作：一键清空全部「最近」记录（通用状态 + 场上特效）
     */
    async _onClearRecent(event, target) {
        event.preventDefault();
        event.stopPropagation();
        await game.user.setFlag("xjzl-system", "recentStatusPickerIds", []);
        await game.user.setFlag("xjzl-system", "recentSceneEffectPickerUuids", []);
        this.render();
    }

    /**
     * 动作：切换某个状态的「常用」收藏（点星标）
     */
    async _onToggleFavorite(event, target) {
        event.preventDefault();
        event.stopPropagation();
        await this._toggleFavoriteStatus(target.dataset.slug);
        this.render();
    }

    /**
     * 动作：把「常用」重置为默认列表（删除用户 flag）
     */
    async _onResetFavorites(event, target) {
        event.preventDefault();
        event.stopPropagation();
        await game.user.unsetFlag("xjzl-system", "favoriteStatusPickerIds");
        this.render();
    }

    /**
     * 动作：切换目标读取模式（框选 / 瞄准），并持久化到客户端设置
     */
    _onSetTargetMode(event, target) {
        event.preventDefault();
        const mode = target.dataset.targetMode;
        if (!["controlled", "targeted"].includes(mode) || mode === this._targetMode) return;
        this._targetMode = mode;
        game.settings.set("xjzl-system", "targetSelectionMode", mode)
            .catch(error => console.error("XJZL | 保存目标选择模式失败:", error));
        this.render();
    }

    /**
     * 动作：清空当前目标模式下选中的全部目标
     * 框选模式释放画布选中的 Token；瞄准模式取消全部瞄准。
     * 释放/取消瞄准会同步触发 controlToken / targetToken 钩子，统一由防抖的 _refreshTargets 重绘，
     * 这里不再显式 render()，避免同一操作触发两次全量扫描。
     */
    _onClearTargets(event, target) {
        event.preventDefault();
        if (this.actor) return; // 从角色卡打开时目标固定，无需清空
        const tokens = this._targetMode === "targeted"
            ? Array.from(game.user.targets || [])
            : [...(canvas?.tokens?.controlled || [])];
        for (const token of tokens) {
            if (this._targetMode === "targeted") token.setTarget(false, { releaseOthers: false });
            else token.release();
        }
    }

    /**
     * 动作：折叠/展开某个角色的「场上特效」分组
     * 点击角色姓名（组标题）触发；折叠状态记入 _collapsedActors，重渲染后仍保持
     */
    _onToggleGroupCollapse(event, target) {
        event.preventDefault();
        const group = target.closest(".actor-group");
        if (!group) return;
        const actorId = group.dataset.actorId;
        // 记录折叠状态（key 为 token.id）
        if (this._collapsedActors.has(actorId)) this._collapsedActors.delete(actorId);
        else this._collapsedActors.add(actorId);
        // 直接切换类名即时折叠/展开，无需整窗重渲染
        group.classList.toggle("collapsed");
    }

    /**
     * 渲染完成后的钩子：
     * 1) 绑定分类切换、实时搜索、右键减层等交互；
     * 2) 依据「当前分类 + 搜索词」统一过滤状态按钮与场上特效分组。
     * 每次 render() 后 DOM 均为全新元素，直接绑定事件即可，无需先解绑。
     */
    _onRender(context, options) {
        super._onRender(context, options);

        const html = this.element;
        const searchInput = html.querySelector('input[name="filter"]');
        const categoryButtons = html.querySelectorAll(".category-tab");
        const pickerRoot = html.matches?.(".xjzl-effect-picker") ? html : html.querySelector(".xjzl-effect-picker");

        /**
         * 统一过滤函数：根据当前分类与搜索词，决定每个状态/场上特效按钮及分组是否显示
         */
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

        // 定义搜索处理函数：同步保存搜索词，供框选/瞄准变化触发重渲染时恢复输入
        const handleSearch = (e) => {
            this._filterQuery = searchInput?.value || "";
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
