/**
 * 物资节点战利品工作台。
 * 约束：所有改变库存的动作都走活动 GM 事务路由，窗口只负责选择上下文和展示结果。
 */
import { xjzlSocket } from "../socket.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;
const ITEM_TYPES = ["weapon", "armor", "qizhen", "consumable", "manual", "art_book", "wuxue", "neigong", "misc"];
const STACKABLE_ITEM_TYPES = new Set(["consumable", "misc", "manual"]);
const NON_TRANSFERABLE_ITEM_TYPES = new Set(["neigong", "wuxue", "art_book", "background", "personality"]);
const XP_POOL_KEYS = ["general", "neigong", "wuxue", "arts"];
const activeNeedPrompts = new Set();
const CONTAINER_DIALOG_CLASSES = Object.freeze(["xjzl-container-dialog"]);

/**
 * 使用物资节点专属框体打开输入弹窗，避免默认 Dialog 表单布局受全局样式影响。
 * @param {Object} options - 标题、字段 HTML、确认回调、窗口宽度及附加样式类。
 * @returns {Promise<*>} 确认回调返回值；关闭窗口时为空。
 */
function promptContainerDialog({ title, content, label, callback, width = 420, icon = "fas fa-box", extraClasses = [] }) {
    return foundry.applications.api.DialogV2.prompt({
        classes: [...CONTAINER_DIALOG_CLASSES, ...extraClasses],
        // 需求投掷是从工作台上叠出的临时窗口，显式给出较高层级避免被 ActorSheet 的层级覆盖。
        position: { width, height: "auto", zIndex: 10000 },
        window: { title, icon, resizable: false },
        content: `<div class="container-dialog-panel"><div class="container-dialog-fields">${content}</div></div>`,
        ok: { label, icon: "fas fa-check", callback },
        rejectClose: false
    });
}

/**
 * 使用与输入弹窗一致的物资节点框体显示危险操作确认。
 * @param {Object} options - 标题、正文及确认按钮文案。
 * @returns {Promise<boolean>} 是否确认。
 */
function confirmContainerDialog({ title, content, label }) {
    return foundry.applications.api.DialogV2.confirm({
        classes: [...CONTAINER_DIALOG_CLASSES, "xjzl-container-confirm-dialog"],
        position: { width: 400, height: "auto" },
        window: { title, icon: "fas fa-triangle-exclamation", resizable: false },
        content: `<div class="container-dialog-panel container-dialog-message"><i class="fas fa-diamond" aria-hidden="true"></i><p>${content}</p></div>`,
        ok: { label, icon: "fas fa-check" },
        rejectClose: false
    });
}

/** 生成具有稳定纵向结构的弹窗字段，control 必须是可信的系统生成 HTML。 */
function containerDialogField(label, control, className = "") {
    return `<label class="container-dialog-field ${className}"><span>${label}</span>${control}</label>`;
}

/** 将物品富文本描述整理为 Foundry 悬停提示。 */
async function buildContainerItemTooltip(item, quantity, hidden = false) {
    const rawDescription = String(item.system.description || "").trim();
    const description = rawDescription
        ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(rawDescription, {
            secrets: item.isOwner,
            async: true,
            relativeTo: item
        })
        : `<p class="loot-tooltip-empty">${game.i18n.localize("XJZL.Container.NoDescription")}</p>`;
    const quantityLine = STACKABLE_ITEM_TYPES.has(item.type)
        ? `<span>${game.i18n.localize("XJZL.Container.Quantity")} ${quantity}</span>`
        : "";
    const hiddenNotice = hidden
        ? `<p class="loot-tooltip-note loot-tooltip-note-warning"><i class="fas fa-eye-slash" aria-hidden="true"></i>${game.i18n.localize("XJZL.Container.HiddenTooltip")}</p>`
        : "";
    return `<div class="loot-item-tooltip-content"><header><b>${foundry.utils.escapeHTML(item.name)}</b>${quantityLine}</header>${hiddenNotice}<div class="loot-tooltip-description">${description}</div></div>`;
}

function buildContainerRewardTooltip(reward) {
    const name = foundry.utils.escapeHTML(reward.name);
    return `<div class="loot-xp-tooltip-content"><b>${name}</b><span>${game.i18n.localize("XJZL.Container.XpRewardTooltip")}</span></div>`;
}

Hooks.on("xjzl.containerNeedPrompt", payload => {
    if (!payload?.needId || activeNeedPrompts.has(payload.needId)) return;
    activeNeedPrompts.add(payload.needId);
    showContainerNeedPrompt(payload)
        .catch(err => {
            console.error("XJZL | 打开战利品需求界面失败:", { needId: payload.needId, err });
            ui.notifications.error(game.i18n.localize("XJZL.Container.TransactionFailed"));
        })
        .finally(() => activeNeedPrompts.delete(payload.needId));
});

Hooks.on("xjzl.containerNeedResult", payload => {
    if (!payload?.needId) return;
    const winner = payload.winnerUserId ? game.users.get(payload.winnerUserId) : null;
    const outcome = payload.outcome || (winner ? "awarded" : "noNeed");
    const messageKey = {
        awarded: "XJZL.Container.NeedResultAwarded",
        noNeed: "XJZL.Container.NeedResultNoNeed",
        itemUnavailable: "XJZL.Container.NeedResultUnavailable",
        cancelled: "XJZL.Container.NeedResultCancelled",
        failed: "XJZL.Container.NeedResultFailed"
    }[outcome] || "XJZL.Container.NeedResultFailed";
    const message = game.i18n.format(messageKey, {
        item: payload.itemName,
        winner: winner?.name || ""
    });
    ui.notifications[outcome === "failed" ? "error" : "info"](message);
    for (const application of Object.values(ui.windows || {})) {
        if (application.document?.uuid === payload.containerUuid) application.render({ force: true });
    }
});

async function showContainerNeedPrompt(payload) {
    if (game.user.isGM) return;
    const actors = [...game.actors]
        .filter(actor => ["character", "npc"].includes(actor.type) && actor.isOwner)
        .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans"));
    const actorOptions = actors.length > 0
        ? actors.map(actor => `<option value="${foundry.utils.escapeHTML(actor.uuid)}">${foundry.utils.escapeHTML(actor.name)}</option>`).join("")
        : `<option value="">${game.i18n.localize("XJZL.Container.NoParticipant")}</option>`;
    const needId = foundry.utils.escapeHTML(String(payload.needId));
    const itemName = foundry.utils.escapeHTML(String(payload.itemName || game.i18n.localize("XJZL.Container.Loot")));
    const itemImg = foundry.utils.escapeHTML(String(payload.itemImg || ""));
    const rawDescription = String(payload.itemDescription || "").trim();
    const itemDescription = rawDescription
        ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(rawDescription, { secrets: false, async: true })
        : `<p class="need-roll-description-empty">${game.i18n.localize("XJZL.Container.NoDescription")}</p>`;
    const parsedExpiresIn = Number(payload.expiresIn);
    const expiresIn = Number.isFinite(parsedExpiresIn) ? Math.max(0, parsedExpiresIn) : 30000;
    const countdownDuration = Math.max(1, expiresIn);
    const expiresAt = Date.now() + expiresIn;
    const countdown = window.setInterval(() => {
        const root = document.querySelector(`[data-need-roll-id="${needId}"]`);
        if (!root) return;
        const remaining = Math.max(0, expiresAt - Date.now());
        const ratio = Math.max(0, Math.min(1, remaining / countdownDuration));
        const fill = root.querySelector(".need-roll-timer-fill");
        const label = root.querySelector(".need-roll-timer-label");
        const seconds = root.querySelector(".need-roll-timer-seconds");
        if (fill) fill.style.transform = `scaleX(${ratio})`;
        if (label) label.textContent = remaining > 0
            ? game.i18n.format("XJZL.Container.NeedRollRemaining", { seconds: Math.ceil(remaining / 1000) })
            : game.i18n.localize("XJZL.Container.NeedRollExpired");
        if (seconds) seconds.textContent = remaining > 0 ? `${Math.ceil(remaining / 1000)}` : "0";
        root.classList.toggle("is-urgent", remaining > 0 && remaining <= 10000);
        root.classList.toggle("is-expired", remaining <= 0);
    }, 100);
    try {
        const value = await promptContainerDialog({
            title: game.i18n.localize("XJZL.Container.NeedPromptTitle"),
            icon: "fas fa-dice-d20",
            width: 440,
            extraClasses: ["xjzl-container-need-dialog"],
            content: `<div class="need-roll-popup" data-need-roll-id="${needId}">
                    <div class="need-roll-item" tabindex="0" aria-label="${itemName}">
                        <div class="need-roll-item-icon">${itemImg ? `<img src="${itemImg}" alt="">` : `<i class="fas fa-gem" aria-hidden="true"></i>`}</div>
                        <div class="need-roll-item-copy"><span class="need-roll-item-kicker">${game.i18n.localize("XJZL.Container.NeedRollKicker")}</span><b>${itemName}</b><small>${game.i18n.localize("XJZL.Container.NeedRollInstruction")}</small></div>
                        <div class="need-roll-item-tooltip" role="tooltip"><strong>${game.i18n.localize("XJZL.Container.NeedRollDescription")}</strong>${itemDescription}</div>
                    </div>
                    <div class="need-roll-timer" aria-live="polite"><div class="need-roll-timer-track"><span class="need-roll-timer-fill"></span></div><div class="need-roll-timer-meta"><span class="need-roll-timer-label">${game.i18n.format("XJZL.Container.NeedRollRemaining", { seconds: Math.ceil(expiresIn / 1000) })}</span><b class="need-roll-timer-seconds">${Math.ceil(expiresIn / 1000)}</b></div></div>
                    <div class="need-roll-controls">
                        <div class="need-roll-choice-group" role="radiogroup" aria-label="${game.i18n.localize("XJZL.Container.NeedChoice")}">
                            <label class="need-roll-choice is-selected"><input type="radio" name="choice" value="need" checked><span><i class="fas fa-dice-d20" aria-hidden="true"></i>${game.i18n.localize("XJZL.Container.Need")}</span></label>
                            <label class="need-roll-choice"><input type="radio" name="choice" value="pass"><span><i class="fas fa-ban" aria-hidden="true"></i>${game.i18n.localize("XJZL.Container.Pass")}</span></label>
                        </div>
                        ${containerDialogField(game.i18n.localize("XJZL.Container.Participant"), `<select name="actorUuid">${actorOptions}</select>`, "need-roll-field")}
                    </div>
                    <p class="need-roll-hint"><i class="fas fa-circle-info" aria-hidden="true"></i>${game.i18n.localize("XJZL.Container.NeedRollHint")}</p>
                </div>`,
            label: game.i18n.localize("XJZL.Container.SubmitNeed"),
            callback: (dialogEvent, button) => ({
                choice: button.form.elements.choice.value,
                actorUuid: button.form.elements.actorUuid.value || null
            })
        });
        if (!value) return;
        const result = await xjzlSocket.executeAsGM("executeContainerTransaction", {
            action: "needChoice",
            containerUuid: payload.containerUuid,
            itemId: payload.itemId,
            needId: payload.needId,
            actorUuid: value.choice === "need" ? value.actorUuid : null,
            choice: value.choice,
            operationId: foundry.utils.randomID()
        });
        if (!result?.ok) {
            ui.notifications.error(result?.error?.message || game.i18n.localize("XJZL.Container.TransactionFailed"));
        }
    } finally {
        window.clearInterval(countdown);
    }
}

export class XJZLLootWorkbenchSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "actor", "container", "theme-dark"],
        position: { width: 720, height: 760 },
        window: { resizable: true, title: "XJZL.Sheet.Container", controls: [] },
        form: { submitOnChange: false, closeOnSubmit: false },
        actions: {
            editImage: XJZLLootWorkbenchSheet.prototype._onEditImage,
            editStateImage: XJZLLootWorkbenchSheet.prototype._onEditStateImage,
            lootItem: XJZLLootWorkbenchSheet.prototype._onLootItem,
            storageWithdrawItem: XJZLLootWorkbenchSheet.prototype._onLootItem,
            needStart: XJZLLootWorkbenchSheet.prototype._onNeedStart,
            shopBuyItem: XJZLLootWorkbenchSheet.prototype._onShopBuyItem,
            editShopItem: XJZLLootWorkbenchSheet.prototype._onEditShopItem,
            lootAll: XJZLLootWorkbenchSheet.prototype._onLootAll,
            currencyAction: XJZLLootWorkbenchSheet.prototype._onCurrencyAction,
            editCurrency: XJZLLootWorkbenchSheet.prototype._onEditCurrency,
            editQuantity: XJZLLootWorkbenchSheet.prototype._onEditQuantity,
            deleteItem: XJZLLootWorkbenchSheet.prototype._onDeleteItem,
            toggleHidden: XJZLLootWorkbenchSheet.prototype._onToggleHidden,
            claimXp: XJZLLootWorkbenchSheet.prototype._onClaimXp,
            addXpReward: XJZLLootWorkbenchSheet.prototype._onAddXpReward,
            editXpReward: XJZLLootWorkbenchSheet.prototype._onEditXpReward,
            deleteXpReward: XJZLLootWorkbenchSheet.prototype._onDeleteXpReward,
            toggleRewardHidden: XJZLLootWorkbenchSheet.prototype._onToggleRewardHidden
        }
    };

    static PARTS = {
        main: {
            template: "systems/xjzl-system/templates/actor/container/loot-workbench.hbs",
            scrollable: [".loot-scroll"]
        }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const actor = this.document;
        const system = actor.system;
        const isGM = Boolean(game.user?.isGM);
        const participants = this.#getParticipants(isGM);
        const selectedActor = participants.find(entry => entry.uuid === this._selectedActorUuid)?.actor
            || participants[0]?.actor
            || null;
        this._selectedActorUuid = selectedActor?.uuid || null;
        const isLootMode = system.mode === "loot";
        const isStorageMode = system.mode === "storage";
        const isShopMode = system.mode === "shop";
        const permissionActor = actor.isToken ? actor.token?.baseActor || actor : actor;
        // 未关联 Token 的合成 Actor 权限可能误判，前后端都以世界 Actor 的权限为准。
        const canObserveNode = isGM || permissionActor.testUserPermission(game.user, "OBSERVER");
        const canLoot = isLootMode && canObserveNode && (isGM || system.isOpen);
        // 修为是个人领取权益；共享物资取尽后仍可领取，但 GM 手动关闭节点时保持封闭。
        const canClaimRewards = isLootMode
            && canObserveNode
            && (isGM || system.status !== "closed");
        const ownsStorage = isGM || permissionActor.testUserPermission(game.user, "OWNER");
        const canWithdraw = isStorageMode && ownsStorage && (isGM || system.isOpen);
        const canDeposit = isStorageMode && ownsStorage && (isGM || system.isOpen);
        const canShop = isShopMode && (isGM || (system.isOpen && permissionActor.testUserPermission(game.user, "OBSERVER")));
        const storageHintKey = !ownsStorage
            ? "StorageOwnerReadOnlyHint"
            : (canDeposit ? "StorageDropHint" : "StorageReadOnlyHint");

        const sections = new Map(ITEM_TYPES.map(type => [type, { type, label: `TYPES.Item.${type}`, items: [] }]));
        // 富文本解析互不依赖；并行准备可避免物品较多时逐件等待描述处理。
        const preparedItems = await Promise.all([...actor.items].map(async item => {
            const hidden = isLootMode && Boolean(item.getFlag("xjzl-system", "containerHidden"));
            if (hidden && !isGM) return null;
            const type = sections.has(item.type) ? item.type : "misc";
            const quantity = Math.max(1, Number(item.system.quantity) || 1);
            const tooltip = await buildContainerItemTooltip(item, quantity, hidden);
            const shopData = item.getFlag("xjzl-system", "shop") || {};
            const basePrice = Math.max(0, Number(item.system.price) || 0);
            const shopDiscount = Number.isFinite(Number(shopData.buyDiscount))
                ? Math.max(0, Number(shopData.buyDiscount))
                : Math.max(0, Number(system.settings.buyDiscount) || 0);
            const shopPrice = Number.isInteger(Number(shopData.buyPrice)) && Number(shopData.buyPrice) >= 0
                ? Number(shopData.buyPrice)
                : Math.floor(basePrice * shopDiscount);
            return {
                type,
                data: {
                    id: item.id,
                    name: item.name,
                    img: item.img,
                    type,
                    quantity,
                    isStackable: STACKABLE_ITEM_TYPES.has(item.type),
                    hidden,
                    tooltip,
                    action: isStorageMode ? "storageWithdrawItem" : isShopMode ? "shopBuyItem" : "lootItem",
                    canAction: isStorageMode ? canWithdraw : isShopMode ? canShop : canLoot,
                    canNeed: isLootMode && canLoot && !hidden,
                    shopPrice,
                    shopPriceText: String(shopPrice)
                }
            };
        }));
        for (const prepared of preparedItems) {
            if (prepared) sections.get(prepared.type).items.push(prepared.data);
        }
        for (const section of sections.values()) {
            section.items.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans"));
        }

        const visibleItems = [...sections.values()].flatMap(section => section.items);
        const visibleRewards = (isLootMode ? system.rewards : [])
            .filter(reward => isGM || !reward.hidden)
            .map(reward => ({
                id: reward.id,
                name: reward.name,
                amount: reward.amount,
                poolKey: reward.poolKey,
                poolLabel: game.i18n.localize(`XJZL.Container.XpPool${this.#capitalize(reward.poolKey)}`),
                logTitle: reward.logTitle,
                logReason: reward.logReason,
                hidden: reward.hidden,
                claimed: reward.claims.some(claim => claim.userId === game.user.id),
                tooltip: buildContainerRewardTooltip(reward),
                canClaim: selectedActor?.type === "character"
                    && canClaimRewards
                    ? !reward.claims.some(claim => claim.userId === game.user.id)
                    : false
            }));
        const inventory = isLootMode && visibleItems.length > 0
            ? [{ type: "loot", label: "XJZL.Container.Loot", items: visibleItems }]
            : [...sections.values()].filter(section => section.items.length > 0);
        const canLootAll = canLoot && (isGM || Boolean(system.settings.allowTakeAll));
        const currency = Math.max(0, Number(system.currency) || 0);
        const actorSilver = Math.max(0, Number(selectedActor?.system.resources?.silver) || 0);
        const modeLabel = game.i18n.localize(`XJZL.Container.${this.#capitalize(system.mode)}`);
        const statusKey = system.status === "closed"
            ? "StatusClosed"
            : system.status === "depleted" ? "StatusDepleted" : "StatusActive";
        const statusLabel = game.i18n.localize(`XJZL.Container.${statusKey}`);
        const activeImg = system.appearance?.activeImg || actor.img;
        const depletedImg = system.appearance?.depletedImg || actor.img;
        const stateImg = system.status === "depleted" ? depletedImg : activeImg;

        return {
            ...context,
            actor,
            actorName: actor.name,
            actorImg: isLootMode ? stateImg : actor.img,
            activeImg,
            depletedImg,
            stateImageKey: system.status === "depleted" ? "depleted" : "active",
            headerImageAction: isLootMode ? "editStateImage" : "editImage",
            headerImageTitle: game.i18n.localize(isLootMode
                ? "XJZL.Container.EditStateImage"
                : "XJZL.Container.EditImage"),
            modeIcon: isLootMode ? "fa-box" : isStorageMode ? "fa-boxes-stacked" : "fa-store",
            system,
            isGM,
            isLootMode,
            isStorageMode,
            isShopMode,
            canLoot,
            canClaimRewards,
            canWithdraw,
            canDeposit,
            canShop,
            storageHint: game.i18n.localize(`XJZL.Container.${storageHintKey}`),
            canLootAll,
            canTakeCurrency: (isLootMode ? canLoot : canWithdraw) && currency > 0,
            canDepositCurrency: isStorageMode && canDeposit && actorSilver > 0,
            actorSilver,
            modeLabel,
            statusLabel,
            nodeConfigOpen: Boolean(this._nodeConfigOpen),
            modeChoices: ["loot", "storage", "shop"].map(mode => ({
                value: mode,
                label: game.i18n.localize(`XJZL.Container.${this.#capitalize(mode)}`)
            })),
            statusChoices: (isLootMode ? ["active", "closed", "depleted"] : ["active", "closed"]).map(status => ({
                value: status,
                label: game.i18n.localize(`XJZL.Container.Status${this.#capitalize(status)}`)
            })),
            participants,
            selectedActor,
            inventory,
            rewards: visibleRewards,
            xpPoolChoices: XP_POOL_KEYS.map(poolKey => ({
                value: poolKey,
                label: game.i18n.localize(`XJZL.Container.XpPool${this.#capitalize(poolKey)}`)
            })),
            visibleItemCount: visibleItems.length,
            visibleRewardCount: visibleRewards.length,
            hasVisibleItems: visibleItems.length > 0,
            hasVisibleRewards: visibleRewards.length > 0,
            hasClaimableRewards: visibleRewards.some(reward => reward.canClaim),
            hasCurrency: currency > 0,
            // 全部拾取目前只处理物品和银两；修为必须逐条确认并记录玩家领取身份。
            hasLootableContent: visibleItems.length > 0 || currency > 0
        };
    }

    async _onRender(context, options) {
        await super._onRender(context, options);
        this.#restorePlayerControls(context);
        this.element.querySelector(".container-search-input")?.addEventListener("input", event => this._onSearch(event));
        this.element.querySelector(".participant-select")?.addEventListener("change", event => {
            this._selectedActorUuid = event.target.value || null;
            this.render({ force: true });
        });
        const nodeConfig = this.element.querySelector(".node-config");
        nodeConfig?.addEventListener("toggle", () => {
            this._nodeConfigOpen = nodeConfig.open;
        });
        nodeConfig?.addEventListener("change", event => this._onNodeConfigChange(event));
        const dropZone = this.element.querySelector(".loot-scroll");
        dropZone?.addEventListener("dragover", event => {
            if (game.user.isGM || ["storage", "shop"].includes(this.document.system.mode)) event.preventDefault();
        });
        dropZone?.addEventListener("drop", event => this._onDrop(event));
    }

    _onSearch(event) {
        const query = String(event.target.value || "").trim().toLocaleLowerCase("zh-Hans");
        for (const card of this.element.querySelectorAll(".loot-item-card")) {
            const name = card.querySelector(".loot-slot-caption b")?.textContent?.toLocaleLowerCase("zh-Hans") || "";
            card.hidden = Boolean(query) && !name.includes(query);
        }
        for (const section of this.element.querySelectorAll(".loot-section")) {
            section.hidden = Boolean(query) && !section.querySelector(".loot-item-card:not([hidden])");
        }
    }

    /** 保存 GM 节点配置；模式变化只影响世界 Actor 与其原型 Token。 */
    async _onNodeConfigChange(event) {
        if (!game.user.isGM) return;
        const field = event.target;
        if (!field?.dataset?.configPath) return;
        this._nodeConfigOpen = Boolean(field.closest("details")?.open);
        const path = field.dataset.configPath;
        const value = field.type === "checkbox"
            ? field.checked
            : field.type === "number" ? Number(field.value) : field.value;
        const baseActor = this.document.isToken ? this.document.token?.baseActor : this.document;
        if (!baseActor) return this.#notify("error", "XJZL.Container.TransactionFailed");

        if (path === "mode") {
            // 只修改原型关联与外观策略；已放置 Token 保持原状，避免模式切换改写场景中的现有实例。
            const actorLink = value !== "loot";
            const update = {
                "system.mode": value,
                "prototypeToken.actorLink": actorLink
            };
            if (value !== "loot" && baseActor.system.status === "depleted") {
                update["system.status"] = "active";
            }
            await baseActor.update(update);
            return;
        }
        // 未关联战利品 Token 的状态和拾取设置属于当前实例，不能写回世界 Actor。
        await this.document.update({ [`system.${path}`]: value });
    }

    async _onLootItem(event, target) {
        event.preventDefault();
        const participant = this.#selectedActor();
        if (!participant) return this.#notify("warn", "XJZL.Container.NoSelectedActor");
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return this.#notify("warn", "XJZL.Container.ItemUnavailable");

        const max = Math.max(1, Number(item.system.quantity) || 1);
        let quantity = 1;
        if (STACKABLE_ITEM_TYPES.has(item.type) && max > 1) {
            quantity = await this.#promptQuantity(max, "XJZL.Container.Take");
            if (!quantity) return;
        }
        const action = target.dataset.action === "storageWithdrawItem" ? "storageWithdrawItem" : "lootItem";
        await this.#executeTransaction({ action, containerUuid: this.document.uuid, actorUuid: participant.uuid, itemId: item.id, quantity });
    }

    async _onShopBuyItem(event, target) {
        event.preventDefault();
        const participant = this.#selectedActor();
        if (!participant) return this.#notify("warn", "XJZL.Container.NoSelectedActor");
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return this.#notify("warn", "XJZL.Container.ItemUnavailable");
        const max = Math.max(1, Number(item.system.quantity) || 1);
        let quantity = 1;
        if (STACKABLE_ITEM_TYPES.has(item.type) && max > 1 && !this.document.system.settings.infiniteStock) {
            quantity = await this.#promptQuantity(max, "XJZL.Container.BuyItem");
            if (!quantity) return;
        }
        await this.#executeTransaction({
            action: "shopBuyItem",
            containerUuid: this.document.uuid,
            actorUuid: participant.uuid,
            itemId: item.id,
            quantity
        });
    }

    async _onNeedStart(event, target) {
        event.preventDefault();
        if (this.document.system.mode !== "loot") return;
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return this.#notify("warn", "XJZL.Container.ItemUnavailable");
        await this.#executeTransaction({
            action: "needStart",
            containerUuid: this.document.uuid,
            itemId: item.id
        });
    }

    async _onEditShopItem(event, target) {
        event.preventDefault();
        if (!game.user.isGM || this.document.system.mode !== "shop") return;
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;
        const shopData = item.getFlag("xjzl-system", "shop") || {};
        const priceValue = Number.isInteger(Number(shopData.buyPrice)) ? Number(shopData.buyPrice) : "";
        const discountValue = Number.isFinite(Number(shopData.buyDiscount)) ? Number(shopData.buyDiscount) : "";
        const value = await promptContainerDialog({
            title: game.i18n.localize("XJZL.Container.EditShopItem"),
            icon: "fas fa-tag",
            content: `${containerDialogField(game.i18n.localize("XJZL.Container.ShopPriceOverride"), `<input type="number" name="buyPrice" min="0" step="1" value="${priceValue}">`)}
                ${containerDialogField(game.i18n.localize("XJZL.Container.ShopDiscountOverride"), `<input type="number" name="buyDiscount" min="0" step="0.05" value="${discountValue}">`)}`,
            label: game.i18n.localize("XJZL.Container.Save"),
            callback: (dialogEvent, button) => ({
                buyPrice: button.form.elements.buyPrice.value.trim(),
                buyDiscount: button.form.elements.buyDiscount.value.trim()
            })
        });
        if (!value) return;
        const shop = {};
        if (value.buyPrice !== "") {
            const buyPrice = Number(value.buyPrice);
            if (!Number.isFinite(buyPrice) || buyPrice < 0) return this.#notify("warn", "XJZL.Container.InvalidShopPrice");
            shop.buyPrice = Math.floor(buyPrice);
        }
        if (value.buyDiscount !== "") {
            const buyDiscount = Number(value.buyDiscount);
            if (!Number.isFinite(buyDiscount) || buyDiscount < 0) return this.#notify("warn", "XJZL.Container.InvalidShopDiscount");
            shop.buyDiscount = buyDiscount;
        }
        await item.setFlag("xjzl-system", "shop", shop);
    }

    async #promptQuantity(max, titleKey) {
        const value = await promptContainerDialog({
            title: game.i18n.localize(titleKey),
            icon: "fas fa-layer-group",
            content: containerDialogField(
                `${game.i18n.localize("XJZL.Container.Quantity")} · 1—${max}`,
                `<input type="number" name="quantity" value="${max}" min="1" max="${max}" step="1" autofocus>`
            ),
            label: game.i18n.localize(titleKey),
            callback: (dialogEvent, button) => button.form.elements.quantity.valueAsNumber
        });
        return Number.isInteger(value) && value >= 1 && value <= max ? value : null;
    }

    async #promptShopSellDiscount() {
        const configuredDiscount = Number(this.document.system.settings.sellDiscount);
        const defaultDiscount = Math.max(0, Number.isFinite(configuredDiscount) ? configuredDiscount : 0.5);
        const value = await promptContainerDialog({
            title: game.i18n.localize("XJZL.Container.ShopSellItem"),
            icon: "fas fa-coins",
            content: containerDialogField(
                game.i18n.localize("XJZL.Container.ShopSellDiscount"),
                `<input type="number" name="sellDiscount" value="${defaultDiscount}" min="0" step="0.05" autofocus>`
            ),
            label: game.i18n.localize("XJZL.Container.ShopSellItem"),
            callback: (dialogEvent, button) => button.form.elements.sellDiscount.valueAsNumber
        });
        return Number.isFinite(value) && value >= 0 ? value : null;
    }
    async _onLootAll(event) {
        event.preventDefault();
        const participant = this.#selectedActor();
        if (!participant) return this.#notify("warn", "XJZL.Container.NoSelectedActor");
        await this.#executeTransaction({ action: "lootAll", containerUuid: this.document.uuid, actorUuid: participant.uuid });
    }

    async _onClaimXp(event, target) {
        event.preventDefault();
        const participant = this.#selectedActor();
        if (!participant) return this.#notify("warn", "XJZL.Container.NoSelectedActor");
        await this.#executeTransaction({
            action: "claimXp",
            containerUuid: this.document.uuid,
            actorUuid: participant.uuid,
            rewardId: target.dataset.rewardId
        });
    }

    async _onAddXpReward(event) {
        event.preventDefault();
        if (!game.user.isGM || this.document.system.mode !== "loot") return;
        const reward = await this.#promptXpReward();
        if (!reward) return;
        const rewards = foundry.utils.deepClone(this.document.system.rewards);
        rewards.push({ id: foundry.utils.randomID(), kind: "xp", claims: [], ...reward });
        await this.document.update({ "system.rewards": rewards });
        await this.#syncLootNodeStatus();
    }

    async _onEditXpReward(event, target) {
        event.preventDefault();
        if (!game.user.isGM || this.document.system.mode !== "loot") return;
        const reward = this.document.system.rewards.find(entry => entry.id === target.dataset.rewardId);
        if (!reward) return;
        const edited = await this.#promptXpReward(reward);
        if (!edited) return;
        const rewards = foundry.utils.deepClone(this.document.system.rewards);
        const index = rewards.findIndex(entry => entry.id === reward.id);
        if (index < 0) return;
        rewards[index] = { ...rewards[index], ...edited };
        await this.document.update({ "system.rewards": rewards });
        await this.#syncLootNodeStatus();
    }

    async _onDeleteXpReward(event, target) {
        event.preventDefault();
        if (!game.user.isGM || this.document.system.mode !== "loot") return;
        const reward = this.document.system.rewards.find(entry => entry.id === target.dataset.rewardId);
        if (!reward) return;
        const confirmed = await confirmContainerDialog({
            title: game.i18n.localize("XJZL.Container.DeleteReward"),
            content: game.i18n.format("XJZL.Container.DeleteRewardConfirm", { name: foundry.utils.escapeHTML(reward.name) }),
            label: game.i18n.localize("XJZL.Container.DeleteReward")
        });
        if (!confirmed) return;
        await this.document.update({
            "system.rewards": this.document.system.rewards.filter(entry => entry.id !== reward.id)
        });
        await this.#syncLootNodeStatus();
    }

    async _onToggleRewardHidden(event, target) {
        event.preventDefault();
        if (!game.user.isGM || this.document.system.mode !== "loot") return;
        const rewards = foundry.utils.deepClone(this.document.system.rewards);
        const reward = rewards.find(entry => entry.id === target.dataset.rewardId);
        if (!reward) return;
        reward.hidden = !reward.hidden;
        await this.document.update({ "system.rewards": rewards });
        await this.#syncLootNodeStatus();
    }

    async #promptXpReward(initial = {}) {
        const escape = value => this.#escapeHtml(value);
        const poolOptions = XP_POOL_KEYS.map(poolKey => (
            `<option value="${poolKey}" ${poolKey === (initial.poolKey || "general") ? "selected" : ""}>${escape(game.i18n.localize(`XJZL.Container.XpPool${this.#capitalize(poolKey)}`))}</option>`
        )).join("");
        const content = `<div class="container-dialog-grid">
            ${containerDialogField(game.i18n.localize("XJZL.Container.RewardName"), `<input name="name" value="${escape(initial.name || "")}" required autofocus>`, "is-wide")}
            ${containerDialogField(game.i18n.localize("XJZL.Container.RewardAmount"), `<input name="amount" type="number" min="1" step="1" value="${Number(initial.amount) || 1}" required>`)}
            ${containerDialogField(game.i18n.localize("XJZL.Container.RewardPool"), `<select name="poolKey">${poolOptions}</select>`)}
            ${containerDialogField(game.i18n.localize("XJZL.Container.LogTitle"), `<input name="logTitle" value="${escape(initial.logTitle || "")}">`, "is-wide")}
            ${containerDialogField(game.i18n.localize("XJZL.Container.LogReason"), `<textarea name="logReason">${escape(initial.logReason || "")}</textarea>`, "is-wide")}
            <label class="container-dialog-toggle is-wide"><input name="hidden" type="checkbox" ${initial.hidden ? "checked" : ""}><span>${game.i18n.localize("XJZL.Container.Hidden")}</span></label>
        </div>`;
        const value = await promptContainerDialog({
            title: game.i18n.localize(initial.id ? "XJZL.Container.EditReward" : "XJZL.Container.AddReward"),
            icon: "fas fa-yin-yang",
            width: 520,
            content,
            label: game.i18n.localize("XJZL.Container.Save"),
            callback: (dialogEvent, button) => {
                const form = button.form;
                const name = String(form.elements.name.value || "").trim();
                const amount = Number(form.elements.amount.value);
                if (!name || !Number.isInteger(amount) || amount < 1) return null;
                return {
                    name,
                    amount,
                    poolKey: form.elements.poolKey.value,
                    logTitle: String(form.elements.logTitle.value || "").trim(),
                    logReason: String(form.elements.logReason.value || "").trim(),
                    hidden: Boolean(form.elements.hidden.checked)
                };
            }
        });
        return value || null;
    }
    async _onCurrencyAction(event, target) {
        event.preventDefault();
        const participant = this.#selectedActor();
        const direction = target?.dataset?.type || "take";
        const nodeAmount = Math.max(0, Number(this.document.system.currency) || 0);
        const actorAmount = Math.max(0, Number(participant?.system.resources?.silver) || 0);
        const amount = direction === "deposit" ? actorAmount : nodeAmount;
        if (!participant || amount <= 0) return;
        const titleKey = direction === "deposit" ? "XJZL.Container.DepositCurrency" : "XJZL.Container.TakeCurrency";
        const value = await promptContainerDialog({
            title: game.i18n.localize(titleKey),
            icon: "fas fa-coins",
            content: containerDialogField(
                `${game.i18n.localize("XJZL.Container.Amount")} · 1—${amount}`,
                `<input type="number" name="amount" value="${amount}" min="1" max="${amount}" step="1" autofocus>`
            ),
            label: game.i18n.localize(direction === "deposit" ? titleKey : "XJZL.Container.Take"),
            callback: (dialogEvent, button) => button.form.elements.amount.valueAsNumber
        });
        if (!Number.isInteger(value) || value < 1 || value > amount) return;
        await this.#executeTransaction({ action: "currencyTransfer", direction, amount: value, containerUuid: this.document.uuid, actorUuid: participant.uuid });
    }

    async _onEditCurrency(event) {
        event.preventDefault();
        if (!game.user.isGM) return;
        const current = Math.max(0, Number(this.document.system.currency) || 0);
        const value = await promptContainerDialog({
            title: game.i18n.localize("XJZL.Container.EditCurrency"),
            icon: "fas fa-coins",
            content: containerDialogField(
                game.i18n.localize("XJZL.Container.Amount"),
                `<input type="number" name="amount" value="${current}" min="0" step="1" autofocus>`
            ),
            label: game.i18n.localize("XJZL.Container.Save"),
            callback: (dialogEvent, button) => button.form.elements.amount.valueAsNumber
        });
        if (!Number.isInteger(value) || value < 0) return;
        const updates = { "system.currency": value };
        if (this.document.system.mode === "loot" && value > 0 && this.document.system.status === "depleted") {
            updates["system.status"] = "active";
        }
        await this.document.update(updates);
        if (this.document.system.mode === "loot"
            && value === 0
            && this.document.system.status === "active"
            && this.document.system.isEmpty) {
            await this.document.update({ "system.status": "depleted" });
        }
    }

    async _onEditQuantity(event, target) {
        event.preventDefault();
        if (!game.user.isGM) return;
        const item = this.document.items.get(target.dataset.itemId);
        if (!item || !STACKABLE_ITEM_TYPES.has(item.type)) return;
        const current = Math.max(1, Number(item.system.quantity) || 1);
        const value = await promptContainerDialog({
            title: game.i18n.localize("XJZL.Container.EditQuantity"),
            icon: "fas fa-layer-group",
            content: containerDialogField(
                game.i18n.localize("XJZL.Container.Quantity"),
                `<input type="number" name="quantity" value="${current}" min="1" step="1" autofocus>`
            ),
            label: game.i18n.localize("XJZL.Container.Save"),
            callback: (dialogEvent, button) => button.form.elements.quantity.valueAsNumber
        });
        if (!Number.isInteger(value) || value < 1) return;
        await item.update({ "system.quantity": value });
    }

    async _onDeleteItem(event, target) {
        event.preventDefault();
        if (!game.user.isGM) return;
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;
        const confirmed = await confirmContainerDialog({
            title: game.i18n.localize("XJZL.Container.DeleteItem"),
            content: game.i18n.format("XJZL.Container.DeleteConfirm", { name: foundry.utils.escapeHTML(item.name) }),
            label: game.i18n.localize("XJZL.Container.DeleteItem")
        });
        if (confirmed) {
            await item.delete();
            if (this.document.system.mode === "loot"
                && this.document.system.status === "active"
                && this.document.system.isEmpty) {
                await this.document.update({ "system.status": "depleted" });
            }
        }
    }
    async _onDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (err) {
            return;
        }
        if (data?.type !== "Item") return;

        const sourceItem = data.uuid ? await fromUuid(data.uuid) : null;
        if (sourceItem?.parent === this.document) return;
        const itemData = sourceItem?.toObject?.() || data.data;
        if (!itemData?.name || !itemData?.type) return;
        if (sourceItem?.parent instanceof Actor
            && ["character", "npc"].includes(sourceItem.parent.type)
            && !this.#canTransferItem(sourceItem)) return;

        if (this.document.system.mode === "storage") {
            const permissionActor = this.document.isToken ? this.document.token?.baseActor || this.document : this.document;
            if (!game.user.isGM && !permissionActor.testUserPermission(game.user, "OWNER")) {
                return this.#notify("warn", "XJZL.Container.StorageOwnerRequired");
            }
            if (!(sourceItem?.parent instanceof Actor) || !["character", "npc"].includes(sourceItem.parent.type)) {
                return this.#notify("warn", "XJZL.Container.StorageDropActorOnly");
            }
            const sourceActor = sourceItem.parent;
            if (!game.user.isGM && !sourceActor.isOwner) {
                return this.#notify("warn", "XJZL.Container.StorageSourceNotOwned");
            }
            const max = STACKABLE_ITEM_TYPES.has(sourceItem.type)
                ? Math.max(1, Number(sourceItem.system.quantity) || 1)
                : 1;
            let quantity = 1;
            if (max > 1) {
                quantity = await this.#promptQuantity(max, "XJZL.Container.DepositItem");
                if (!quantity) return;
            }
            await this.#executeTransaction({
                action: "storageDepositItem",
                containerUuid: this.document.uuid,
                actorUuid: sourceActor.uuid,
                itemId: sourceItem.id,
                quantity
            });
            return;
        }

        if (this.document.system.mode === "shop" && !game.user.isGM) {
            if (!(sourceItem?.parent instanceof Actor) || !["character", "npc"].includes(sourceItem.parent.type)) {
                return this.#notify("warn", "XJZL.Container.ShopDropActorOnly");
            }
            const sourceActor = sourceItem.parent;
            if (!sourceActor.isOwner) return this.#notify("warn", "XJZL.Container.ShopSourceNotOwned");
            const max = STACKABLE_ITEM_TYPES.has(sourceItem.type)
                ? Math.max(1, Number(sourceItem.system.quantity) || 1)
                : 1;
            const quantity = max > 1 ? await this.#promptQuantity(max, "XJZL.Container.ShopSellItem") : 1;
            if (!quantity) return;
            const sellDiscount = await this.#promptShopSellDiscount();
            if (sellDiscount == null) return;
            await this.#executeTransaction({
                action: "shopSellItem",
                containerUuid: this.document.uuid,
                actorUuid: sourceActor.uuid,
                itemId: sourceItem.id,
                quantity,
                sellDiscount
            });
            return;
        }

        if (!game.user.isGM) return;

        const stackable = STACKABLE_ITEM_TYPES.has(itemData.type);
        const sourceQuantity = stackable ? Math.max(1, Number(itemData.system?.quantity) || 1) : 1;
        const stackKey = stackable ? this.#getStackKey(itemData) : null;
        const destinationItems = stackKey
            ? [...this.document.items].filter(item => this.#getStackKey(item) === stackKey)
            : [];
        const destinationItem = destinationItems[0] || null;
        const duplicateItems = destinationItems.slice(1);
        const destinationQuantity = destinationItem ? Math.max(1, Number(destinationItem.system.quantity) || 1) : null;
        const duplicateData = duplicateItems.map(item => foundry.utils.deepClone(item.toObject()));
        const duplicateQuantity = duplicateItems.reduce((total, item) => total + Math.max(1, Number(item.system.quantity) || 1), 0);
        const sourceParent = sourceItem?.parent instanceof Actor && sourceItem.parent !== this.document
            ? sourceItem.parent
            : null;
        const sourceData = sourceParent ? foundry.utils.deepClone(sourceItem.toObject()) : null;
        let duplicatesRemoved = false;
        let createdItem = null;
        let sourceRemoved = false;
        try {
            if (destinationItem) {
                await destinationItem.update({ "system.quantity": destinationQuantity + duplicateQuantity + sourceQuantity });
                if (duplicateItems.length > 0) {
                    await this.document.deleteEmbeddedDocuments("Item", duplicateItems.map(item => item.id));
                    duplicatesRemoved = true;
                }
            } else {
                const copy = foundry.utils.deepClone(itemData);
                copy.flags?.["xjzl-system"] && delete copy.flags["xjzl-system"].containerHidden;
                createdItem = (await this.document.createEmbeddedDocuments("Item", [copy]))?.[0] || null;
                if (!createdItem) throw new Error("未能创建物品。");
            }
            if (sourceParent) {
                await sourceParent.deleteEmbeddedDocuments("Item", [sourceItem.id]);
                sourceRemoved = true;
            }
        } catch (err) {
            console.error("XJZL | 放入物品失败:", err);
            if (createdItem) {
                try {
                    await this.document.deleteEmbeddedDocuments("Item", [createdItem.id]);
                } catch (rollbackError) {
                    console.error("XJZL | 放入物品创建回滚失败:", rollbackError);
                }
            }
            if (destinationItem && destinationQuantity != null) {
                try {
                    await destinationItem.update({ "system.quantity": destinationQuantity });
                } catch (rollbackError) {
                    console.error("XJZL | 放入物品回滚失败:", rollbackError);
                }
            }
            if (duplicatesRemoved && duplicateData.length > 0) {
                try {
                    await this.document.createEmbeddedDocuments("Item", duplicateData);
                } catch (rollbackError) {
                    console.error("XJZL | 重复堆叠项回滚失败:", rollbackError);
                }
            }
            if (sourceParent && sourceData && (sourceRemoved || !sourceParent.items.get(sourceItem.id))) {
                try {
                    await sourceParent.createEmbeddedDocuments("Item", [sourceData]);
                } catch (rollbackError) {
                    console.error("XJZL | 来源物品回滚失败:", {
                        actorUuid: sourceParent.uuid,
                        itemId: sourceItem.id,
                        rollbackError
                    });
                }
            }
            this.#notify("error", "XJZL.Container.TransactionFailed");
            return;
        }
        await this.#syncLootNodeStatus();
        await this.render({ force: true });
    }

    async _onToggleHidden(event, target) {
        event.preventDefault();
        if (!game.user.isGM || this.document.system.mode !== "loot") return;
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;
        try {
            const hidden = !item.getFlag("xjzl-system", "containerHidden");
            await item.setFlag("xjzl-system", "containerHidden", hidden);
            await this.render({ force: true });
        } catch (err) {
            console.error("XJZL | 更新战利品隐藏状态失败:", err);
            this.#notify("error", "XJZL.Container.TransactionFailed");
        }
    }

    /** 为战利品的可用/耗尽状态选择独立图片；状态变化会由 Actor 钩子同步到 Token。 */
    async _onEditStateImage(event, target) {
        event.preventDefault();
        if (!game.user.isGM || this.document.system.mode !== "loot") return;
        const state = target.dataset.imageState;
        if (!["active", "depleted"].includes(state)) return;
        const current = this.document.system.appearance?.[`${state}Img`] || this.document.img;
        const picker = new foundry.applications.apps.FilePicker({
            type: "image",
            current,
            callback: async path => {
                await this.document.update({ [`system.appearance.${state}Img`]: path });
                await this.render({ force: true });
            }
        });
        return picker.browse();
    }

    async _onEditImage(event) {
        event.preventDefault();
        if (!game.user.isGM) return;
        const picker = new foundry.applications.apps.FilePicker({ type: "image", current: this.document.img, callback: path => this.document.update({ img: path }) });
        return picker.browse();
    }

    async #executeTransaction(request) {
        const result = await xjzlSocket.executeAsGM("executeContainerTransaction", { ...request, operationId: foundry.utils.randomID() });
        if (!result?.ok) {
            ui.notifications.error(result?.error?.message || game.i18n.localize("XJZL.Container.TransactionFailed"));
            return null;
        }
        await this.render({ force: true });
        return result.data;
    }

    #getParticipants(isGM) {
        const actors = new Map();
        for (const actor of game.actors) {
            if (["character", "npc"].includes(actor.type) && (isGM || actor.isOwner)) actors.set(actor.uuid, actor);
        }
        for (const token of canvas.tokens?.controlled || []) {
            const actor = token.actor;
            if (actor && ["character", "npc"].includes(actor.type) && (isGM || actor.isOwner)) actors.set(actor.uuid, actor);
        }
        return [...actors.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans"))
            .map(actor => ({ actor, uuid: actor.uuid, name: actor.name, img: actor.img }));
    }

    #selectedActor() {
        return this.#getParticipants(Boolean(game.user?.isGM)).find(entry => entry.uuid === this._selectedActorUuid)?.actor || null;
    }

    #getStackKey(item) {
        if (!STACKABLE_ITEM_TYPES.has(item.type)) return null;
        // 项目没有稳定的物品模板 ID；同类型同名即视为同一堆，避免来源标记和默认字段差异拆成多堆。
        return `${item.type}|${String(item.name || "").trim()}`;
    }

    /** 前端提前拦截不允许移出角色的物品；GM 端事务仍会执行同一规则作为最终校验。 */
    #canTransferItem(item) {
        if (item.system?.equipped) {
            this.#notify("warn", "XJZL.Container.ItemEquippedTransferBlocked");
            return false;
        }
        if (NON_TRANSFERABLE_ITEM_TYPES.has(item.type)) {
            this.#notify("warn", "XJZL.Container.ItemTypeTransferBlocked");
            return false;
        }
        return true;
    }

    #capitalize(value) {
        const text = String(value || "");
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    #escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[character]));
    }

    /** 按共享物品与银两同步战利品状态；修为奖励不参与判定，closed 保留 GM 的手工封闭意图。 */
    async #syncLootNodeStatus() {
        try {
            if (this.document.system.mode !== "loot" || this.document.system.status === "closed") return;
            const status = this.document.system.isEmpty ? "depleted" : "active";
            if (this.document.system.status !== status) {
                await this.document.update({ "system.status": status });
            }
        } catch (err) {
            // 状态是库存操作后的派生标记，更新失败不能反向撤销已完成的库存事务。
            console.error("XJZL | 战利品节点状态同步失败:", { containerUuid: this.document.uuid, err });
        }
    }

    /**
     * ActorSheetV2 会禁用非 Owner 窗口的全部表单控件；按业务权限恢复观察者可用的节点操作。
     * 服务端仍会独立校验节点权限、状态及接收角色所有权。
     */
    #restorePlayerControls(context) {
        if (this.isEditable) return;
        const search = this.element.querySelector(".container-search-input");
        if (search) search.disabled = false;

        const selectors = [];
        if (context.canLoot) {
            selectors.push(
                '[data-action="lootItem"]',
                '[data-action="lootAll"]',
                '[data-action="currencyAction"][data-type="take"]',
                '[data-action="needStart"]'
            );
        }
        if (context.canClaimRewards) selectors.push('[data-action="claimXp"]');
        if (context.canShop) selectors.push('[data-action="shopBuyItem"]');
        if (selectors.length === 0) return;

        const participant = this.element.querySelector(".participant-select");
        if (participant && context.participants.length > 0) participant.disabled = false;
        for (const control of this.element.querySelectorAll(selectors.join(","))) {
            control.disabled = false;
        }
    }

    #notify(type, key) {
        ui.notifications[type](game.i18n.localize(key));
    }
}
