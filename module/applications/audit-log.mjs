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

    constructor(options = {}) {
        super(options);
        this.actor = options.actor;
    }

    /**
     * 准备数据给 HBS
     */
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
     * 绑定事件 (V13 原生机制)
     */
    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;

        // 1. 原有的搜索逻辑
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

        // 2. 绑定删除按钮
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

        // 根据你 `manualModifyXP` 里的逻辑，修为变动会记录 balance: "poolKey: newBalance"
        // 我们通过切割 balance 字符串提取池子类型
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

                // 计算新的修为值：原本加上去的，现在减掉；原本减掉的，现在加回来。
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

        // 确保 App 重绘
        this.render();
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

        // 确保 App 重绘
        this.render();
    }
}
