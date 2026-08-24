const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ActionTracker extends HandlebarsApplicationMixin(ApplicationV2) {
    static instance = null;
    static currentActor = null;
    static currentToken = null; // 新增：记录当前Token
    static debouncedRefresh = null; // 新增：防抖函数

    static DEFAULT_OPTIONS = {
        id: "xjzl-action-tracker",
        classes: ["xjzl-action-tracker-window"], // 挂上专属的 class
        tag: "div",
        window: {
            title: "XJZL.UI.ActionTracker.Title",
            icon: "",
            minimizable: false,
            resizable: false,
            frame: true
        },
        position: {
            width: 200, // 宽度固定，高度自适应
            height: "auto",
            top: 150,
            left: 150
        }
    };

    static PARTS = {
        main: {
            template: "systems/xjzl-system/templates/apps/action-tracker.hbs"
        }
    };

    /**
     * 界面初始化与全局事件监听
     */
    static init() {
        this.instance = new ActionTracker();

        // 借鉴你的 PlayerHUD，创建 50ms 的防抖刷新
        this.debouncedRefresh = foundry.utils.debounce(() => this.refreshUI(), 50);

        // 1. 监听选中 Token 变化 (使用防抖)
        Hooks.on("controlToken", () => this.debouncedRefresh());
        Hooks.on("canvasReady", () => this.debouncedRefresh());

        // 2. 监听 Actor 数据变化 (使用防抖)
        Hooks.on("updateActor", (actor, changes) => {
            if (this.currentActor && actor.id === this.currentActor.id) {
                if (foundry.utils.hasProperty(changes, "flags.xjzl-system.actions")) {
                    this.debouncedRefresh();
                }
            }
        });

        // 3. 战斗回合更新重置
        Hooks.on("updateCombat", async (combat, changed, options, userId) => {
            if (!game.user.isGM) return;
            if (changed.turn !== undefined || changed.round !== undefined) {
                const combatant = combat.combatant;
                if (combatant?.actor) {
                    await ActionTracker.resetActions(combatant.actor);
                }
            }
        });

        // 4. 删除 Token (强制刷新)
        Hooks.on("deleteToken", () => this.debouncedRefresh());
    }

    /**
     * 刷新 UI 显示状态
     */
    static refreshUI() {
        const controlled = canvas.tokens.controlled;
        // 规则：只选中一个Token，且玩家有权限
        if (controlled.length === 1 && controlled[0].actor?.isOwner) {
            this.currentToken = controlled[0];
            this.currentActor = controlled[0].actor;

            if (!this.currentActor.getFlag("xjzl-system", "actions")) {
                this.resetActions(this.currentActor);
            }
            // V13 AppV2 的 render 会自动处理更新，不需要删 DOM
            this.instance.render({ force: true });
        } else {
            this.currentToken = null;
            this.currentActor = null;
            this.instance.close(); // 没选中或选中多个时关闭悬浮窗
        }
    }

    /**
     * 准备传递给模板的数据
     */
    async _prepareContext(options) {
        if (!ActionTracker.currentActor) return {};

        const actions = ActionTracker.currentActor.getFlag("xjzl-system", "actions") || {
            major: true, minor: true, reaction: true, swift: true
        };

        return {
            // 优先使用 Token 名称，如果没有则降级使用 Actor 名称
            tokenName: ActionTracker.currentToken?.document?.name || ActionTracker.currentActor.name,
            actions: actions
        };
    }

    /**
     * 绑定点击事件 (玩家手动切换状态)
     */
    _attachPartListeners(partId, htmlElement, options) {
        super._attachPartListeners(partId, htmlElement, options);

        const buttons = htmlElement.querySelectorAll(".action-btn");
        buttons.forEach(btn => {
            btn.addEventListener("click", async (e) => {
                e.preventDefault();
                if (!ActionTracker.currentActor) return;

                const type = e.currentTarget.dataset.type;
                const currentFlags = ActionTracker.currentActor.getFlag("xjzl-system", "actions") || {};
                const newState = !(currentFlags[type] ?? true);

                await ActionTracker.currentActor.setFlag("xjzl-system", `actions.${type}`, newState);
            });
        });
    }

    // ==========================================
    // 自动化辅助方法
    // ==========================================

    /**
     * 重置所有动作为可用
     */
    static async resetActions(actor) {
        if (!actor) return;
        await actor.setFlag("xjzl-system", "actions", {
            major: true, minor: true, reaction: true, swift: true
        });
    }

    /**
     * 根据招式类型自动消耗动作
     * @param {Actor} actor 
     * @param {String} actionCostStr (如 "主要动作", "蓄力动作")
     */
    static async consumeAction(actor, actionCostStr) {
        if (!actor || !actionCostStr) return;
        if (!game.settings.get("xjzl-system", "enableActionTracker")) return;

        const current = actor.getFlag("xjzl-system", "actions") || {
            major: true, minor: true, reaction: true, swift: true
        };
        const updates = { ...current };

        const firstChar = actionCostStr.trim().charAt(0);

        switch (firstChar) {
            case '主': updates.major = false; break;
            case '次': updates.minor = false; break;
            case '反': updates.reaction = false; break;
            case '简': updates.swift = false; break;
            case '蓄':
                updates.major = false;
                updates.minor = false;
                break;
            case '全':
                updates.major = false;
                updates.minor = false;
                updates.reaction = false;
                updates.swift = false;
                break;
            default:
                return; // 匹配不上就不做处理
        }

        // 判断是否有权更新（玩家只能更新自己的，NPC需要GM权限）
        if (actor.isOwner) {
            await actor.setFlag("xjzl-system", "actions", updates);
        } else {
            // 如果你使用了 xjzlSocket 代理：
            // await xjzlSocket.executeAsGM("updateDocument", actor.uuid, { "flags.xjzl-system.actions": updates });
        }
    }
}
