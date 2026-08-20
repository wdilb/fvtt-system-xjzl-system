/**
 * 物资节点战利品工作台。
 * 约束：所有改变库存的动作都走活动 GM 事务路由，窗口只负责选择上下文和展示结果。
 */
import { xjzlSocket } from "../socket.mjs";

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;
const ITEM_TYPES = ["weapon", "armor", "qizhen", "consumable", "manual", "art_book", "wuxue", "neigong", "misc"];
const STACKABLE_ITEM_TYPES = new Set(["consumable", "misc", "manual"]);

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
            lootAll: XJZLLootWorkbenchSheet.prototype._onLootAll,
            currencyAction: XJZLLootWorkbenchSheet.prototype._onCurrencyAction,
            editCurrency: XJZLLootWorkbenchSheet.prototype._onEditCurrency,
            editQuantity: XJZLLootWorkbenchSheet.prototype._onEditQuantity,
            deleteItem: XJZLLootWorkbenchSheet.prototype._onDeleteItem,
            toggleHidden: XJZLLootWorkbenchSheet.prototype._onToggleHidden
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

        const sections = new Map(ITEM_TYPES.map(type => [type, { type, label: `TYPES.Item.${type}`, items: [] }]));
        for (const item of actor.items) {
            const hidden = Boolean(item.getFlag("xjzl-system", "containerHidden"));
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
                hidden
            });
        }
        for (const section of sections.values()) {
            section.items.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans"));
        }

        const visibleItems = [...sections.values()].flatMap(section => section.items);
        const isLootMode = system.mode === "loot";
        const canLoot = isGM || (isLootMode && system.isOpen && Boolean(system.settings.allowTake));
        const canLootAll = canLoot && (isGM || Boolean(system.settings.allowTakeAll));
        const currency = Math.max(0, Number(system.currency) || 0);
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
            canLoot,
            canLootAll,
            canTakeCurrency: canLoot && currency > 0,
            modeLabel,
            statusLabel,
            participants,
            selectedActor,
            inventory: [...sections.values()].filter(section => section.items.length > 0),
            visibleItemCount: visibleItems.length,
            hasVisibleItems: visibleItems.length > 0,
            hasCurrency: currency > 0,
            hasLootableContent: visibleItems.length > 0 || currency > 0
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        this.element.querySelector(".container-search-input")?.addEventListener("input", event => this._onSearch(event));
        this.element.querySelector(".participant-select")?.addEventListener("change", event => {
            this._selectedActorUuid = event.target.value || null;
            this.render({ force: true });
        });
        const dropZone = this.element.querySelector(".loot-scroll");
        dropZone?.addEventListener("dragover", event => {
            if (game.user.isGM) event.preventDefault();
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
        await this.#executeTransaction({ action: "lootItem", containerUuid: this.document.uuid, actorUuid: participant.uuid, itemId: item.id, quantity });
    }

    async _onLootAll(event) {
        event.preventDefault();
        const participant = this.#selectedActor();
        if (!participant) return this.#notify("warn", "XJZL.Container.NoSelectedActor");
        await this.#executeTransaction({ action: "lootAll", containerUuid: this.document.uuid, actorUuid: participant.uuid });
    }

    async _onCurrencyAction(event) {
        event.preventDefault();
        const participant = this.#selectedActor();
        const amount = Math.max(0, Number(this.document.system.currency) || 0);
        if (!participant || amount <= 0) return;
        const value = await foundry.applications.api.DialogV2.prompt({
            window: { title: game.i18n.localize("XJZL.Container.TakeCurrency") },
            content: `<label>${game.i18n.localize("XJZL.Container.Amount")}（1-${amount}）</label><input type="number" name="amount" value="${amount}" min="1" max="${amount}" step="1" autofocus>`,
            ok: {
                label: game.i18n.localize("XJZL.Container.Take"),
                callback: (dialogEvent, button) => button.form.elements.amount.valueAsNumber
            },
            rejectClose: false
        });
        if (!Number.isInteger(value) || value < 1 || value > amount) return;
        await this.#executeTransaction({ action: "currencyTransfer", direction: "take", amount: value, containerUuid: this.document.uuid, actorUuid: participant.uuid });
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
        if (!game.user.isGM) return;
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
        if (!game.user.isGM) return;
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

    #notify(type, key) {
        ui.notifications[type](game.i18n.localize(key));
    }
}
