// module/applications/effect-selection-dialog.mjs
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class EffectSelectionDialog extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "xjzl-effect-picker",
        window: {
            title: "智能状态选取器",
            icon: "fas fa-hand-sparkles",
            width: 600, //稍微宽一点显示来源
            height: 600,
            resizable: true
        },
        // 强制初始位置和大小
        position: {
            width: 600,
            height: 600
        },
        actions: {
            applyStatus: EffectSelectionDialog._onApplyStatus,
            applyItemEffect: EffectSelectionDialog._onApplyItemEffect
        }
    };

    static PARTS = {
        form: {
            template: "systems/xjzl-system/templates/apps/effect-selection.hbs"
        }
    };

    /**
     * 准备渲染数据 - 扫描全场景
     */
    async _prepareContext(options) {
        // ===========================================
        // 1. 通用状态 (Universal)
        // ===========================================
        const statusEffects = CONFIG.statusEffects.map(e => {
            const name = game.i18n.localize(e.name);
            const descKey = e.description || ""; // 获取配置里的 description key
            const desc = descKey ? game.i18n.localize(descKey) : "无详细描述";

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
                richTooltip: richTooltip // 传给模板
            };
        });

        // ===========================================
        // 2. 扫描场景内的特效 (Scene Context)
        // ===========================================
        // 结构目标：按 Actor 分组，方便 GM 找是谁出的招
        // [ { actorName: "Boss", items: [ {name: "毒掌", img: "..."} ] } ]
        const sceneGroups = [];

        // 获取场景内所有 Token (不管是通过 canvas.tokens.placeables 还是 document 集合)
        const tokens = canvas.tokens.placeables;

        for (const token of tokens) {
            const actor = token.actor;
            if (!actor) continue;

            const actorEffects = [];

            for (const item of actor.items) {
                for (const effect of item.effects) {
                    // 筛选：非被动传输 (transfer: false) 且 未禁用
                    // 还可以加一个逻辑：必须有 changes 或者有 duration (防止空壳特效)
                    if (effect.transfer === false && !effect.disabled) {
                        // 尝试获取特效描述，如果没有，显示来源物品名字
                        const effDesc = effect.description || `来源: ${item.name}`;

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

        return {
            statusEffects,
            sceneGroups
        };
    }

    /**
     * 辅助：获取当前选中的目标
     */
    static getControlledActors() {
        const targets = canvas.tokens.controlled.map(t => t.actor).filter(Boolean);
        if (targets.length === 0) {
            ui.notifications.warn("请先选择至少一个 Token 作为目标！");
            return [];
        }
        return targets;
    }

    /**
     * 动作：应用通用状态
     */
    static async _onApplyStatus(event, target) {
        const actors = EffectSelectionDialog.getControlledActors();
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

        ui.notifications.info(`已对 ${actors.length} 个目标应用 [${game.i18n.localize(statusData.name)}]`);
        // 应用后关闭窗口？
        // this.close(); 
    }

    /**
     * 动作：应用物品特效
     */
    static async _onApplyItemEffect(event, target) {
        const actors = EffectSelectionDialog.getControlledActors();
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

        ui.notifications.info(`已对 ${actors.length} 个目标应用 [${sourceEffect.name}]`);
    }

    // --- 搜索过滤逻辑 (可选优化) ---
    // 如果想实现实时搜索，可以监听 keyup 事件
    _onRender(context, options) {
        super._onRender(context, options);

        const html = this.element;
        const searchInput = html.querySelector('input[name="filter"]');

        searchInput.addEventListener("keyup", (e) => {
            const query = e.target.value.toLowerCase();

            // 过滤状态按钮
            const btns = html.querySelectorAll(".effect-btn");
            btns.forEach(btn => {
                const name = btn.dataset.tooltip.toLowerCase();
                btn.style.display = name.includes(query) ? "flex" : "none";
            });

            // 过滤场景特效 (按组过滤)
            const groups = html.querySelectorAll(".actor-group");
            groups.forEach(group => {
                let hasVisible = false;
                const rows = group.querySelectorAll(".effect-row");

                rows.forEach(row => {
                    // 搜索 特效名 或 来源物品名
                    const text = row.innerText.toLowerCase();
                    if (text.includes(query)) {
                        row.style.display = "flex";
                        hasVisible = true;
                    } else {
                        row.style.display = "none";
                    }
                });

                // 如果该组内没有匹配项，隐藏整组标题
                group.style.display = hasVisible ? "block" : "none";
            });
        });

        // =====================================================
        // 2. 【新增】右键点击逻辑 (减层/移除)
        // =====================================================

        // 获取所有带有 data-action 的按钮
        const actionButtons = html.querySelectorAll('[data-action]');

        actionButtons.forEach(btn => {
            btn.addEventListener('contextmenu', async (event) => {
                event.preventDefault(); // 阻止浏览器默认菜单

                const action = btn.dataset.action;
                const actors = EffectSelectionDialog.getControlledActors();
                if (!actors.length) return;

                // 逻辑分支 A: 通用状态减层
                if (action === "applyStatus") {
                    const slug = btn.dataset.slug;
                    // 直接调用 Manager 的移除
                    for (const actor of actors) {
                        await game.xjzl.api.effects.removeEffect(actor, slug, 1);
                    }
                    ui.notifications.info(`已对选中目标执行移除/减层操作。`);
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
                }
            });
        });
    }
}