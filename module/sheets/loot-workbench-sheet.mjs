/**
 * 物资节点战利品工作台。
 * 约束：所有改变库存的动作都走活动 GM 事务路由，窗口只负责选择上下文和展示结果。
 */
import { xjzlSocket } from "../socket.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;
const ITEM_TYPES = ["weapon", "armor", "qizhen", "consumable", "manual", "art_book", "wuxue", "neigong", "misc"];
const STACKABLE_ITEM_TYPES = new Set(["consumable", "misc", "manual"]);
const XP_POOL_KEYS = ["general", "neigong", "wuxue", "arts"];

export class XJZLLootWorkbenchSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "actor", "container", "theme-dark"],
        position: { width: 720, height: 760 },
        window: { resizable: true, title: "XJZL.Sheet.Container", controls: [] },
        form: { submitOnChange: false, closeOnSubmit: false },
        actions: {
            editImage: XJZLLootWorkbenchSheet.prototype._onEditImage,
            lootItem: XJZLLootWorkbenchSheet.prototype._onLootItem,
            storageWithdrawItem: XJZLLootWorkbenchSheet.prototype._onLootItem,
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
        const canLoot = isLootMode
            && permissionActor.testUserPermission(game.user, "OBSERVER")
            && (isGM || system.isOpen);
        const ownsStorage = isGM || permissionActor.testUserPermission(game.user, "OWNER");
        const canWithdraw = isStorageMode && ownsStorage && (isGM || system.isOpen);
        const canDeposit = isStorageMode && ownsStorage && (isGM || system.isOpen);
        const storageHintKey = !ownsStorage
            ? "StorageOwnerReadOnlyHint"
            : (canDeposit ? "StorageDropHint" : "StorageReadOnlyHint");

        const sections = new Map(ITEM_TYPES.map(type => [type, { type, label: `TYPES.Item.${type}`, items: [] }]));
        for (const item of actor.items) {
            const hidden = isLootMode && Boolean(item.getFlag("xjzl-system", "containerHidden"));
            if (hidden && !isGM) continue;
            const type = sections.has(item.type) ? item.type : "misc";
            const quantity = Math.max(1, Number(item.system.quantity) || 1);
            sections.get(type).items.push({
                id: item.id,
                name: item.name,
                img: item.img,
                type,
                quantity,
                isStackable: STACKABLE_ITEM_TYPES.has(item.type),
                hidden,
                action: isStorageMode ? "storageWithdrawItem" : "lootItem",
                canAction: isStorageMode ? canWithdraw : canLoot
            });
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
                canClaim: selectedActor?.type === "character"
                    && canLoot
                    ? !reward.claims.some(claim => claim.userId === game.user.id)
                    : false
            }));
        const canLootAll = canLoot && (isGM || Boolean(system.settings.allowTakeAll));
        const currency = Math.max(0, Number(system.currency) || 0);
        const actorSilver = Math.max(0, Number(selectedActor?.system.resources?.silver) || 0);
        const modeLabel = game.i18n.localize(`XJZL.Container.${this.#capitalize(system.mode)}`);
        const statusKey = system.status === "closed"
            ? "StatusClosed"
            : system.status === "depleted" ? "StatusDepleted" : "StatusActive";
        const statusLabel = game.i18n.localize(`XJZL.Container.${statusKey}`);

        return {
            ...context,
            actor,
            actorName: actor.name,
            actorImg: actor.img,
            system,
            isGM,
            isLootMode,
            isStorageMode,
            isShopMode,
            canLoot,
            canWithdraw,
            canDeposit,
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
            inventory: [...sections.values()].filter(section => section.items.length > 0),
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
            if (game.user.isGM || this.document.system.mode === "storage") event.preventDefault();
        });
        dropZone?.addEventListener("drop", event => this._onDrop(event));
    }

    _onSearch(event) {
        const query = String(event.target.value || "").trim().toLocaleLowerCase("zh-Hans");
        for (const row of this.element.querySelectorAll(".loot-item-row")) {
            const name = row.querySelector(".loot-item-name")?.textContent?.toLocaleLowerCase("zh-Hans") || "";
            row.hidden = Boolean(query) && !name.includes(query);
        }
        for (const section of this.element.querySelectorAll(".loot-section")) {
            section.hidden = !section.querySelector(".loot-item-row:not([hidden])");
        }
    }

    /** 保存 GM 节点配置；模式变化只影响世界 Actor 与其原型 Token。 */
    async _onNodeConfigChange(event) {
        if (!game.user.isGM) return;
        const field = event.target;
        if (!field?.dataset?.configPath) return;
        this._nodeConfigOpen = Boolean(field.closest("details")?.open);
        const path = field.dataset.configPath;
        const value = field.type === "checkbox" ? field.checked : field.value;
        const baseActor = this.document.isToken ? this.document.token?.baseActor : this.document;
        if (!baseActor) return this.#notify("error", "XJZL.Container.TransactionFailed");

        if (path === "mode") {
            // 只修改原型关联策略；已放置 Token 保持原状，避免模式切换改写场景中的现有实例。
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
            quantity = await foundry.applications.api.DialogV2.prompt({
                window: { title: game.i18n.localize("XJZL.Container.Take") },
                content: `<label>${game.i18n.localize("XJZL.Container.Quantity")}（1-${max}）</label><input type="number" name="quantity" value="${max}" min="1" max="${max}" step="1" autofocus>`,
                ok: {
                    label: game.i18n.localize("XJZL.Container.Take"),
                    callback: (dialogEvent, button) => button.form.elements.quantity.valueAsNumber
                },
                rejectClose: false
            });
            if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) return;
        }
        const action = target.dataset.action === "storageWithdrawItem" ? "storageWithdrawItem" : "lootItem";
        await this.#executeTransaction({ action, containerUuid: this.document.uuid, actorUuid: participant.uuid, itemId: item.id, quantity });
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
        await this.#reactivateLootNode();
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
        await this.#reactivateLootNode();
    }

    async _onDeleteXpReward(event, target) {
        event.preventDefault();
        if (!game.user.isGM || this.document.system.mode !== "loot") return;
        const reward = this.document.system.rewards.find(entry => entry.id === target.dataset.rewardId);
        if (!reward) return;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("XJZL.Container.DeleteReward") },
            content: `<p>${game.i18n.format("XJZL.Container.DeleteRewardConfirm", { name: reward.name })}</p>`,
            rejectClose: false
        });
        if (!confirmed) return;
        await this.document.update({
            "system.rewards": this.document.system.rewards.filter(entry => entry.id !== reward.id)
        });
    }

    async _onToggleRewardHidden(event, target) {
        event.preventDefault();
        if (!game.user.isGM || this.document.system.mode !== "loot") return;
        const rewards = foundry.utils.deepClone(this.document.system.rewards);
        const reward = rewards.find(entry => entry.id === target.dataset.rewardId);
        if (!reward) return;
        reward.hidden = !reward.hidden;
        await this.document.update({ "system.rewards": rewards });
        if (!reward.hidden) await this.#reactivateLootNode();
    }

    async #promptXpReward(initial = {}) {
        const escape = value => this.#escapeHtml(value);
        const poolOptions = XP_POOL_KEYS.map(poolKey => (
            `<option value="${poolKey}" ${poolKey === (initial.poolKey || "general") ? "selected" : ""}>${escape(game.i18n.localize(`XJZL.Container.XpPool${this.#capitalize(poolKey)}`))}</option>`
        )).join("");
        const content = `
            <div class="xjzl-reward-form">
                <label>${game.i18n.localize("XJZL.Container.RewardName")}<input name="name" value="${escape(initial.name || "")}" required autofocus></label>
                <label>${game.i18n.localize("XJZL.Container.RewardAmount")}<input name="amount" type="number" min="1" step="1" value="${Number(initial.amount) || 1}" required></label>
                <label>${game.i18n.localize("XJZL.Container.RewardPool")}<select name="poolKey">${poolOptions}</select></label>
                <label>${game.i18n.localize("XJZL.Container.LogTitle")}<input name="logTitle" value="${escape(initial.logTitle || "")}"></label>
                <label>${game.i18n.localize("XJZL.Container.LogReason")}<textarea name="logReason">${escape(initial.logReason || "")}</textarea></label>
                <label><input name="hidden" type="checkbox" ${initial.hidden ? "checked" : ""}>${game.i18n.localize("XJZL.Container.Hidden")}</label>
            </div>`;
        const value = await foundry.applications.api.DialogV2.prompt({
            window: { title: game.i18n.localize(initial.id ? "XJZL.Container.EditReward" : "XJZL.Container.AddReward") },
            content,
            ok: {
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
            },
            rejectClose: false
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
        const value = await foundry.applications.api.DialogV2.prompt({
            window: { title: game.i18n.localize(direction === "deposit" ? "XJZL.Container.DepositCurrency" : "XJZL.Container.TakeCurrency") },
            content: `<label>${game.i18n.localize("XJZL.Container.Amount")}（1-${amount}）</label><input type="number" name="amount" value="${amount}" min="1" max="${amount}" step="1" autofocus>`,
            ok: {
                label: game.i18n.localize(direction === "deposit" ? "XJZL.Container.DepositCurrency" : "XJZL.Container.Take"),
                callback: (dialogEvent, button) => button.form.elements.amount.valueAsNumber
            },
            rejectClose: false
        });
        if (!Number.isInteger(value) || value < 1 || value > amount) return;
        await this.#executeTransaction({ action: "currencyTransfer", direction, amount: value, containerUuid: this.document.uuid, actorUuid: participant.uuid });
    }

    async _onEditCurrency(event) {
        event.preventDefault();
        if (!game.user.isGM) return;
        const current = Math.max(0, Number(this.document.system.currency) || 0);
        const value = await foundry.applications.api.DialogV2.prompt({
            window: { title: game.i18n.localize("XJZL.Container.EditCurrency") },
            content: `<label>${game.i18n.localize("XJZL.Container.Amount")}</label><input type="number" name="amount" value="${current}" min="0" step="1" autofocus>`,
            ok: {
                label: game.i18n.localize("XJZL.Container.Save"),
                callback: (dialogEvent, button) => button.form.elements.amount.valueAsNumber
            },
            rejectClose: false
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
        const value = await foundry.applications.api.DialogV2.prompt({
            window: { title: game.i18n.localize("XJZL.Container.EditQuantity") },
            content: `<label>${game.i18n.localize("XJZL.Container.Quantity")}</label><input type="number" name="quantity" value="${current}" min="1" step="1" autofocus>`,
            ok: {
                label: game.i18n.localize("XJZL.Container.Save"),
                callback: (dialogEvent, button) => button.form.elements.quantity.valueAsNumber
            },
            rejectClose: false
        });
        if (!Number.isInteger(value) || value < 1) return;
        await item.update({ "system.quantity": value });
    }

    async _onDeleteItem(event, target) {
        event.preventDefault();
        if (!game.user.isGM) return;
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("XJZL.Container.DeleteItem") },
            content: `<p>${game.i18n.format("XJZL.Container.DeleteConfirm", { name: item.name })}</p>`,
            rejectClose: false
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
                quantity = await foundry.applications.api.DialogV2.prompt({
                    window: { title: game.i18n.localize("XJZL.Container.DepositItem") },
                    content: `<label>${game.i18n.localize("XJZL.Container.Quantity")}（1-${max}）</label><input type="number" name="quantity" value="${max}" min="1" max="${max}" step="1" autofocus>`,
                    ok: {
                        label: game.i18n.localize("XJZL.Container.DepositItem"),
                        callback: (dialogEvent, button) => button.form.elements.quantity.valueAsNumber
                    },
                    rejectClose: false
                });
                if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) return;
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
        let duplicatesRemoved = false;
        let createdItem = null;
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
            if (sourceItem?.parent instanceof Actor && sourceItem.parent !== this.document) {
                await sourceItem.parent.deleteEmbeddedDocuments("Item", [sourceItem.id]);
            }
            if (this.document.system.mode === "loot" && this.document.system.status === "depleted") {
                await this.document.update({ "system.status": "active" });
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
            this.#notify("error", "XJZL.Container.TransactionFailed");
            return;
        }
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

    async #reactivateLootNode() {
        if (this.document.system.mode === "loot" && this.document.system.status === "depleted") {
            await this.document.update({ "system.status": "active" });
        }
    }

    /**
     * ActorSheetV2 会禁用非 Owner 窗口的全部表单控件；只恢复战利品领取与本地筛选所需控件。
     * 服务端仍会独立校验节点权限、状态及接收角色所有权。
     */
    #restorePlayerControls(context) {
        if (this.isEditable) return;
        const search = this.element.querySelector(".container-search-input");
        if (search) search.disabled = false;
        if (!context.canLoot) return;

        const participant = this.element.querySelector(".participant-select");
        if (participant && context.participants.length > 0) participant.disabled = false;
        const selectors = [
            '[data-action="lootItem"]',
            '[data-action="claimXp"]',
            '[data-action="lootAll"]',
            '[data-action="currencyAction"][data-type="take"]'
        ];
        for (const control of this.element.querySelectorAll(selectors.join(","))) {
            control.disabled = false;
        }
    }

    #notify(type, key) {
        ui.notifications[type](game.i18n.localize(key));
    }
}
