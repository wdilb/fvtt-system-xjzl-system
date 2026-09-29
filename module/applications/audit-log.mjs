const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export class XJZLAuditLog extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        tag: "div",
        id: "xjzl-audit-log",
        classes: ["xjzl-window", "xjzl-audit-window", "theme-dark"],
        window: {
            title: "XJZL.History.WindowTitle",
            icon: "fas fa-history",
            resizable: true,
            width: 500,
            height: 600
        },
        position: {
            width: 500,
            height: 600
        }
    };

    static PARTS = {
        main: {
            template: "systems/xjzl-system/templates/actor/character/audit-log.hbs",
            scrollable: [".audit-list-area"]
        }
    };

    // 核心注册表不覆盖首次渲染前的实例，单例判断需跟踪完整窗口生命周期。
    static #instances = new Set();

    constructor(options = {}) {
        super(options);
        this.actor = options.actor;
        XJZLAuditLog.#instances.add(this);
    }

    /**
     * 使用 Actor UUID 区分链接角色与各非关联 Token 的合成角色。
     * @param {Actor|null} actor 目标 Actor（可为合成 Actor）
     * @returns {string} 单例匹配键（含点号，不用于 DOM id）
     */
    static matchKey(actor) {
        return actor?.uuid ?? actor?.id ?? "unknown";
    }

    /**
     * 将 Actor 匹配键转换为 DOM id 可用的片段。
     * @param {Actor|null} actor 目标 Actor（可为合成 Actor）
     * @returns {string} 可用作 DOM id 片段的键
     */
    static windowKey(actor) {
        return this.matchKey(actor).replace(/[^a-zA-Z0-9]/g, "-");
    }

    /**
     * 初始化窗口标识、标题和位置。随机后缀避免关闭中的旧窗口注销新窗口的核心登记；
     * 同一 Actor 的窗口去重由类级实例表负责。
     * @param {object} options ApplicationV2 选项，须包含目标 actor。
     * @returns {object} 带独立窗口 id 的应用选项。
     */
    _initializeApplicationOptions(options) {
        const appOptions = super._initializeApplicationOptions(options);
        const actor = options.actor;
        appOptions.id = `xjzl-audit-log-${XJZLAuditLog.windowKey(actor)}-${foundry.utils.randomID()}`;
        appOptions.window.title = game.i18n.localize("XJZL.History.WindowTitle", { name: actor?.name ?? "?" });
        const offset = (XJZLAuditLog.#instances.size % 6) * 28;
        if (offset > 0) {
            const { width = 500, height = 600 } = appOptions.position;
            appOptions.position.left = Math.max(0, Math.round((window.innerWidth - width) / 2)) + offset;
            appOptions.position.top = Math.max(0, Math.round((window.innerHeight - height) / 2)) + offset;
        }
        return appOptions;
    }

    /**
     * 聚焦目标 Actor 的窗口；首次渲染中的窗口仍占用单例名额，关闭中的窗口允许重开。
     * @param {Actor|null} actor 目标 Actor（可为合成 Actor）
     * @returns {boolean} true=已有窗口在用，调用方无需新建；false=可新建
     */
    static focusActorWindow(actor) {
        const states = this.RENDER_STATES;
        const key = this.matchKey(actor);
        for (const app of XJZLAuditLog.#instances) {
            if (this.matchKey(app.actor) !== key) continue;
            if (app.state === states.RENDERED) {
                app.bringToFront();
                return true;
            }
            if (app.state === states.RENDERING || app.state === states.NONE) return true;
            XJZLAuditLog.#instances.delete(app);
        }
        return false;
    }

    /** @inheritdoc */
    _onClose(options) {
        XJZLAuditLog.#instances.delete(this);
        return super._onClose(options);
    }

    /**
     * 渲染失败时关闭可能已显示但未完成事件绑定的窗口，并释放单例登记。
     * @param {boolean|object} [options] ApplicationV2 渲染选项。
     * @param {object} [_options] 布尔形式调用时的兼容选项。
     * @returns {Promise<this>} 成功渲染的窗口；失败时抛出原始异常。
     */
    async render(options, _options) {
        try {
            return await super.render(options, _options);
        } catch (err) {
            console.error("XJZL | 审计日志窗口渲染失败:", err);
            try {
                await this.close({ animate: false });
            } catch (closeError) {
                console.error("XJZL | 审计日志窗口关闭失败:", closeError);
            } finally {
                XJZLAuditLog.#instances.delete(this);
                if (foundry.applications.instances.get(this.id) === this) {
                    foundry.applications.instances.delete(this.id);
                }
            }
            throw err;
        }
    }

    /** 准备历史记录的展示字段，供审计窗口模板使用。 */
    async _prepareContext(options) {
        const history = this.actor.system.history || [];

        const formattedHistory = history.map(entry => {
            const dateObj = new Date(entry.realTime);
            const searchTerm = (entry.title + " " + entry.reason).toLowerCase();
            const yyyy = dateObj.getFullYear();
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
            const dd = String(dateObj.getDate()).padStart(2, '0');
            const dateStr = `${yyyy}-${mm}-${dd}`;

            return {
                ...entry,
                realTimeStr: dateObj.toLocaleString(),
                gameDateDisplay: entry.gameDate || dateObj.toLocaleString(),
                deltaClass: entry.delta.startsWith("-") ? "minus" : "plus",
                cssClass: entry.importance > 0 ? "important" : "",
                searchTerm: searchTerm,
                dateStr: dateStr
            };
        });

        return { history: formattedHistory };
    }

    /**
     * 为搜索、日期过滤和删除按钮绑定窗口事件。
     */
    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;

        const searchInput = html.querySelector(".audit-filter-input");
        const dateInput = html.querySelector(".audit-date-input");
        const entries = html.querySelectorAll(".audit-entry");

        const filterList = () => {
            const query = searchInput.value.toLowerCase().trim();
            const dateQuery = dateInput.value;

            entries.forEach(entry => {
                const term = entry.dataset.search;
                const date = entry.dataset.date;
                const matchText = !query || term.includes(query);
                const matchDate = !dateQuery || date === dateQuery;
                entry.style.display = (matchText && matchDate) ? "block" : "none";
            });
        };

        if (searchInput) searchInput.addEventListener("input", filterList);
        if (dateInput) {
            dateInput.addEventListener("input", filterList);
            dateInput.addEventListener("change", filterList);
        }

        const deleteBtns = html.querySelectorAll(".audit-delete-btn");
        deleteBtns.forEach(btn => {
            btn.addEventListener("click", (event) => this._onClickDelete(event));
        });
    }

    /**
     * 处理删除日志的点击逻辑
     */
    async _onClickDelete(event) {
        event.preventDefault();

        // 获取点击按钮上的记录索引
        const btn = event.currentTarget;
        const index = parseInt(btn.dataset.index, 10);

        const historyArray = this.actor.system.history || [];
        const targetEntry = historyArray[index];
        if (!targetEntry) return;

        // === 1. 判断是否是修为记录 ===
        // 定义修为池名称映射，防止错扣其他资源（如 silver）
        const xiuweiPools = {
            general: "通用修为",
            neigong: "内功修为",
            wuxue: "武学修为",
            arts: "技艺修为"
        };

        let targetPoolKey = null;
        let poolName = "";

        // 修为记录的 balance 前缀标识所属修为池，避免误扣其他资源。
        if (targetEntry.balance) {
            const possibleKey = targetEntry.balance.split(":")[0].trim();
            if (xiuweiPools[possibleKey]) {
                targetPoolKey = possibleKey;
                poolName = xiuweiPools[possibleKey];
            }
        }

        // === 2. 判定：如果是合法的修为记录 ===
        if (targetPoolKey && targetEntry.delta) {

            // 提取数值 (例如 "+100" 提取出 100, "-50" 提取出 -50)
            const deltaValue = parseInt(targetEntry.delta, 10);

            // 如果解析失败或者是 0，直接走普通删除
            if (isNaN(deltaValue) || deltaValue === 0) {
                return this._executeNormalDelete(index, targetEntry);
            }

            const isGain = deltaValue > 0;
            const absValue = Math.abs(deltaValue);
            const actionText = isGain ? "扣除" : "返还";
            const currentPoolBalance = this.actor.system.cultivation[targetPoolKey] || 0;

            const choice = await DialogV2.wait({
                window: { title: game.i18n.localize("XJZL.History.DeleteTitle"), icon: "fas fa-exclamation-triangle" },
                content: `
                    <div style="margin-bottom:10px;">你要删除的记录【${targetEntry.title}】包含了修为变动 (${targetEntry.delta})。</div>
                    <div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:4px; border:1px solid #555;">
                        <p style="margin-top:0;">是否要同时撤销此修为操作？</p>
                        <p style="color:var(--xjzl-gold); margin-bottom:0;">
                            <i class="fas fa-coins"></i> 撤销将从丹田中 ${actionText} <b>${absValue}</b> 点【${poolName}】。
                        </p>
                    </div>
                `,
                buttons: [
                    { action: "revert", label: `是，撤销${poolName}`, icon: "fas fa-undo", default: true },
                    { action: "deleteOnly", label: "否，仅删记录", icon: "fas fa-trash" },
                    { action: "cancel", label: "取消", icon: "fas fa-times" }
                ],
                closeAction: "cancel"
            });

            if (choice === "cancel") return;

            if (choice === "revert") {
                // 判断：如果是要“扣除”，检查余额是否充足
                if (isGain && currentPoolBalance < absValue) {
                    ui.notifications.error(`修为不足！撤销需要扣除 ${absValue} 点【${poolName}】，但当前余额仅有 ${currentPoolBalance} 点。`);
                    return;
                }

                // 撤销修为变动时反向应用原记录的 delta。
                const newBalance = currentPoolBalance - deltaValue;

                await this._executeDeleteAndRevert(index, targetPoolKey, newBalance);
                ui.notifications.info(`已删除记录，并${actionText}了 ${absValue} 点【${poolName}】。`);
                return;
            }

            if (choice === "deleteOnly") {
                await this._executeDelete(index);
                ui.notifications.info("已删除记录（未改变任何修为）。");
                return;
            }

        } else {
            // === 3. 非修为的普通记录 ===
            await this._executeNormalDelete(index, targetEntry);
        }
    }

    /**
     * 普通弹窗确认删除（不含修为）
     */
    async _executeNormalDelete(index, entry) {
        const confirm = await DialogV2.confirm({
            window: { title: game.i18n.localize("XJZL.History.ConfirmDeleteTitle"), icon: "fas fa-trash" },
            content: `<p>确定要删除记录【${entry.title}】吗？删除后不可恢复。</p>`,
            rejectClose: false
        });

        if (confirm) {
            await this._executeDelete(index);
            ui.notifications.info("记录已删除。");
        }
    }

    /**
     * 执行：仅删除历史记录
     */
    async _executeDelete(index) {
        const newHistory = [...this.actor.system.history];
        newHistory.splice(index, 1);

        await this.actor.update({ "system.history": newHistory });

        // 写入已成功；刷新失败只提示重新打开窗口。
        this.render().catch(() => this.#notifyRefreshFailed());
    }

    /**
     * 执行：删除历史记录，并同步更新 Actor 的指定修为池
     */
    async _executeDeleteAndRevert(index, poolKey, newBalance) {
        const newHistory = [...this.actor.system.history];
        newHistory.splice(index, 1);

        // 使用动态键名更新对应的池子 (如 "system.cultivation.general", "system.cultivation.wuxue")
        await this.actor.update({
            "system.history": newHistory,
            [`system.cultivation.${poolKey}`]: newBalance
        });

        // 写入已成功；刷新失败只提示重新打开窗口。
        this.render().catch(() => this.#notifyRefreshFailed());
    }

    /** 删除成功但列表刷新失败时的用户提示（渲染异常详情已由 render 兜底记入控制台）。 */
    #notifyRefreshFailed() {
        ui.notifications.error(game.i18n.localize("XJZL.History.RefreshFailed"));
    }
}
