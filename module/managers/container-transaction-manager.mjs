/**
 * 物资节点交易内核。
 * 约束：只在活动 GM 端读取并修改节点/角色，调用方必须提供真实 socket 用户 ID。
 */

const locks = new Map();
const completedOperations = new Map();
const MAX_COMPLETED_OPERATIONS = 256;
const STACKABLE_ITEM_TYPES = new Set(["consumable", "misc", "manual"]);

export class XJZLContainerTransactionError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "XJZLContainerTransactionError";
        this.code = code;
        this.details = details;
    }
}

export class XJZLContainerTransactionManager {
    /**
     * 在活动 GM 端执行一个容器业务请求。
     * @param {Object} request - action、containerUuid、actorUuid、amount、operationId 等请求字段
     * @param {string} userId - socketlib 注入的真实请求用户 ID
     * @returns {Promise<Object>} 结构化成功结果
     */
    static async executeAsGM(request = {}, userId) {
        const normalized = this.#normalizeRequest(request, userId);
        const cached = completedOperations.get(normalized.operationId);
        if (cached) return foundry.utils.deepClone(cached);

        const node = await this.#loadContainer(normalized.containerUuid);
        const participant = normalized.actorUuid
            ? await this.#loadActor(normalized.actorUuid)
            : null;

        this.#assertNodeAccess(node, normalized.userId, normalized);
        if (participant) this.#assertParticipantAccess(participant, normalized.userId);

        const lockKeys = [node.uuid, participant?.uuid].filter(Boolean);
        const result = await this.#withLocks(lockKeys, async () => {
            // 锁等待期间重新解析文档，避免使用等待前已经过期的库存快照。
            const lockedNode = await this.#loadContainer(normalized.containerUuid);
            const lockedParticipant = normalized.actorUuid
                ? await this.#loadActor(normalized.actorUuid)
                : null;

            this.#assertNodeAccess(lockedNode, normalized.userId, normalized);
            if (lockedParticipant) this.#assertParticipantAccess(lockedParticipant, normalized.userId);

            switch (normalized.action) {
                case "inspect":
                    return this.#inspect(lockedNode, normalized.userId);
                case "currencyTransfer": {
                    const result = await this.#transferCurrency(lockedNode, lockedParticipant, normalized);
                    await this.#updateNodeStatus(lockedNode, normalized.direction);
                    return result;
                }
                case "lootItem": {
                    const mutation = await this.#lootItem(lockedNode, lockedParticipant, normalized);
                    await this.#updateNodeStatus(lockedNode, "take");
                    return mutation.result;
                }
                case "storageWithdrawItem": {
                    const mutation = await this.#lootItem(lockedNode, lockedParticipant, normalized);
                    return { ...mutation.result, action: "storageWithdrawItem" };
                }
                case "storageDepositItem": {
                    const mutation = await this.#depositItem(lockedNode, lockedParticipant, normalized);
                    return mutation.result;
                }
                case "shopBuyItem": {
                    const mutation = await this.#shopBuyItem(lockedNode, lockedParticipant, normalized);
                    return mutation.result;
                }
                case "shopSellItem": {
                    const mutation = await this.#shopSellItem(lockedNode, lockedParticipant, normalized);
                    return mutation.result;
                }
                case "claimXp": {
                    const result = await this.#claimXp(lockedNode, lockedParticipant, normalized);
                    await this.#updateNodeStatus(lockedNode, "take");
                    return result;
                }
                case "lootAll":
                    return this.#lootAll(lockedNode, lockedParticipant, normalized);
                default:
                    throw new XJZLContainerTransactionError(
                        "UNSUPPORTED_ACTION",
                        `不支持的物资节点操作：${normalized.action}`
                    );
            }
        });

        completedOperations.set(normalized.operationId, result);
        while (completedOperations.size > MAX_COMPLETED_OPERATIONS) {
            completedOperations.delete(completedOperations.keys().next().value);
        }
        return foundry.utils.deepClone(result);
    }

    static #normalizeRequest(request, userId) {
        if (!userId || typeof userId !== "string") {
            throw new XJZLContainerTransactionError("INVALID_USER", "无法确认交易发起人。");
        }
        if (!request || typeof request !== "object") {
            throw new XJZLContainerTransactionError("INVALID_REQUEST", "物资节点请求格式无效。");
        }

        const operationId = String(request.operationId || "");
        if (!operationId || operationId.length > 128) {
            throw new XJZLContainerTransactionError("INVALID_OPERATION", "缺少有效的交易操作 ID。");
        }

        const action = String(request.action || "");
        if (!action) {
            throw new XJZLContainerTransactionError("INVALID_ACTION", "缺少物资节点操作类型。");
        }

        return {
            ...request,
            operationId,
            action,
            userId,
            containerUuid: String(request.containerUuid || ""),
            actorUuid: request.actorUuid ? String(request.actorUuid) : null,
            itemId: request.itemId ? String(request.itemId) : null,
            rewardId: request.rewardId ? String(request.rewardId) : null,
            direction: request.direction ? String(request.direction) : null,
            amount: request.amount == null ? null : Number(request.amount),
            quantity: request.quantity == null ? null : Number(request.quantity),
            sellDiscount: request.sellDiscount == null ? null : Number(request.sellDiscount)
        };
    }

    static async #loadContainer(uuid) {
        const node = await fromUuid(uuid);
        if (!node || !(node instanceof Actor) || node.type !== "container") {
            throw new XJZLContainerTransactionError("INVALID_CONTAINER", "找不到有效的物资节点。");
        }
        return node;
    }

    static async #loadActor(uuid) {
        const actor = await fromUuid(uuid);
        if (!actor || !(actor instanceof Actor) || !["character", "npc"].includes(actor.type)) {
            throw new XJZLContainerTransactionError("INVALID_PARTICIPANT", "操作角色无效。");
        }
        return actor;
    }

    /**
     * 按节点模式校验请求权限：战利品允许观察者领取，仓库存取必须拥有节点。
     * @param {Actor} node - 被操作的物资节点
     * @param {string} userId - socketlib 提供的真实用户 ID
     * @param {Object} request - 已规范化的事务请求
     */
    static #assertNodeAccess(node, userId, request) {
        const user = game.users.get(userId);
        if (!user) throw new XJZLContainerTransactionError("INVALID_USER", "操作用户不存在或已离线。");
        if (user.isGM) return;

        // 未关联 Token 的 Actor 是合成文档，权限来源仍是世界 Actor；直接检查合成 Actor 会误判为无权限。
        const permissionDocument = node.isToken ? node.token?.baseActor || node : node;
        if (!permissionDocument.testUserPermission(user, "OBSERVER")) {
            throw new XJZLContainerTransactionError("NO_VIEW_PERMISSION", "你没有查看这个物资节点的权限。");
        }
        if (!node.system.isOpen) {
            throw new XJZLContainerTransactionError("NODE_CLOSED", "这个物资节点当前未开放。");
        }

        const action = request.action;
        const settings = node.system.settings;
        if (action === "inspect") return;

        if (["lootItem", "lootAll", "claimXp"].includes(action)) {
            if (node.system.mode !== "loot") {
                throw new XJZLContainerTransactionError("INVALID_NODE_MODE", "只有战利品节点可以执行拾取操作。");
            }
            if (action === "lootAll" && !settings.allowTakeAll) {
                throw new XJZLContainerTransactionError("ACTION_NOT_ALLOWED", "这个战利品节点不允许全部拾取。");
            }
            return;
        }

        if (["storageWithdrawItem", "storageDepositItem"].includes(action)) {
            if (node.system.mode !== "storage") {
                throw new XJZLContainerTransactionError("INVALID_NODE_MODE", "只有仓库节点可以执行仓储操作。");
            }
            if (!permissionDocument.testUserPermission(user, "OWNER")) {
                throw new XJZLContainerTransactionError("NO_STORAGE_PERMISSION", "你必须拥有这个仓库才能存取物品。");
            }
            return;
        }

        if (["shopBuyItem", "shopSellItem"].includes(action)) {
            if (node.system.mode !== "shop") {
                throw new XJZLContainerTransactionError("INVALID_NODE_MODE", "只有商铺节点可以执行商铺交易。");
            }
            return;
        }

        if (action === "currencyTransfer") {
            if (node.system.mode === "loot") {
                if (request.direction !== "take") {
                    throw new XJZLContainerTransactionError("ACTION_NOT_ALLOWED", "玩家不能向战利品节点存入银两。");
                }
                return;
            }
            if (node.system.mode === "storage") {
                if (!permissionDocument.testUserPermission(user, "OWNER")) {
                    throw new XJZLContainerTransactionError("NO_STORAGE_PERMISSION", "你必须拥有这个仓库才能存取银两。");
                }
                return;
            }
            throw new XJZLContainerTransactionError("ACTION_NOT_ALLOWED", "商铺交易功能尚未开放。");
        }

        throw new XJZLContainerTransactionError("ACTION_NOT_ALLOWED", "这个物资节点不允许当前操作。");
    }

    static #assertParticipantAccess(actor, userId) {
        const user = game.users.get(userId);
        if (user?.isGM) return;
        if (!actor.testUserPermission(user, "OWNER")) {
            throw new XJZLContainerTransactionError("NO_PARTICIPANT_PERMISSION", "你不能操作这个角色的资源。");
        }
    }

    static #inspect(node, userId) {
        const user = game.users.get(userId);
        const canSeeHidden = Boolean(user?.isGM);
        const visibleItems = Array.from(node.items).filter(item => (
            canSeeHidden || node.system.mode !== "loot" || !item.getFlag("xjzl-system", "containerHidden")
        ));
        const visibleRewards = node.system.mode === "loot"
            ? node.system.rewards.filter(reward => canSeeHidden || !reward.hidden)
            : [];

        return {
            action: "inspect",
            containerUuid: node.uuid,
            mode: node.system.mode,
            status: node.system.status,
            currency: node.system.currency,
            itemCount: visibleItems.length,
            rewardCount: visibleRewards.length,
            isEmpty: node.system.isEmpty
        };
    }

    static async #lootItem(node, participant, request) {
        if (!participant) {
            throw new XJZLContainerTransactionError("INVALID_PARTICIPANT", "拾取物品需要指定接收角色。");
        }
        if (!request.itemId) {
            throw new XJZLContainerTransactionError("INVALID_ITEM", "缺少要拾取的物品。");
        }

        const sourceItem = node.items.get(request.itemId);
        if (!sourceItem) {
            throw new XJZLContainerTransactionError("ITEM_UNAVAILABLE", "这个物品已经被其他人取走了。");
        }
        const user = game.users.get(request.userId);
        if (!user?.isGM && node.system.mode === "loot" && sourceItem.getFlag("xjzl-system", "containerHidden")) {
            throw new XJZLContainerTransactionError("ITEM_HIDDEN", "这个物品当前不可领取。");
        }

        const stackable = STACKABLE_ITEM_TYPES.has(sourceItem.type);
        const sourceQuantity = stackable
            ? Math.max(1, Number(sourceItem.system.quantity) || 1)
            : 1;
        const quantity = request.quantity == null ? 1 : request.quantity;
        if (!Number.isInteger(quantity) || quantity <= 0 || quantity > sourceQuantity) {
            throw new XJZLContainerTransactionError("INVALID_QUANTITY", "拾取数量超出当前库存。");
        }
        if (!stackable && quantity !== 1) {
            throw new XJZLContainerTransactionError("INVALID_QUANTITY", "这个物品不能按数量拆分拾取。");
        }

        const sourceData = foundry.utils.deepClone(sourceItem.toObject());
        const stackKey = stackable ? this.#getStackKey(sourceItem) : null;
        const destinationItem = stackKey
            ? Array.from(participant.items).find(item => this.#getStackKey(item) === stackKey)
            : null;
        const destinationQuantity = destinationItem
            ? Math.max(1, Number(destinationItem.system.quantity) || 1)
            : null;
        let createdItem = null;
        let sourceRemoved = false;

        try {
            if (destinationItem) {
                await destinationItem.update({ "system.quantity": destinationQuantity + quantity });
            } else {
                const itemData = foundry.utils.deepClone(sourceData);
                // 隐藏仅属于节点展示元数据，领取后不能污染角色物品或阻断后续堆叠。
                itemData.flags?.["xjzl-system"] && delete itemData.flags["xjzl-system"].containerHidden;
                if (stackable) itemData.system.quantity = quantity;
                const created = await participant.createEmbeddedDocuments("Item", [itemData]);
                createdItem = created?.[0] || null;
                if (!createdItem) throw new Error("未能创建接收物品。");
            }

            const remaining = stackable ? sourceQuantity - quantity : 0;
            if (remaining > 0) {
                await sourceItem.update({ "system.quantity": remaining });
            } else {
                await node.deleteEmbeddedDocuments("Item", [sourceItem.id]);
                sourceRemoved = true;
            }
        } catch (err) {
            await this.#rollbackLootItem({
                node,
                participant,
                sourceItem,
                sourceData,
                sourceRemoved,
                destinationItem,
                destinationQuantity,
                createdItem,
                sourceQuantity
            });
            throw err;
        }

        return {
            result: {
                action: "lootItem",
                containerUuid: node.uuid,
                actorUuid: participant.uuid,
                itemId: sourceItem.id,
                itemName: sourceItem.name,
                quantity,
                remaining: stackable ? sourceQuantity - quantity : 0
            },
            undo: async () => this.#rollbackLootItem({
                node,
                participant,
                sourceItem,
                sourceData,
                sourceRemoved,
                destinationItem,
                destinationQuantity,
                createdItem,
                sourceQuantity
            })
        };
    }

    /** 将角色物品存入仓库；可堆叠物按类型和名称合并，失败时恢复双方库存。 */
    static async #depositItem(node, participant, request) {
        if (!participant) {
            throw new XJZLContainerTransactionError("INVALID_PARTICIPANT", "存入物品需要指定来源角色。");
        }
        if (!request.itemId) {
            throw new XJZLContainerTransactionError("INVALID_ITEM", "缺少要存入的物品。");
        }

        const sourceItem = participant.items.get(request.itemId);
        if (!sourceItem) {
            throw new XJZLContainerTransactionError("ITEM_UNAVAILABLE", "这个角色身上已经没有该物品了。");
        }
        const stackable = STACKABLE_ITEM_TYPES.has(sourceItem.type);
        const sourceQuantity = stackable ? Math.max(1, Number(sourceItem.system.quantity) || 1) : 1;
        const quantity = request.quantity == null ? 1 : request.quantity;
        if (!Number.isInteger(quantity) || quantity <= 0 || quantity > sourceQuantity) {
            throw new XJZLContainerTransactionError("INVALID_QUANTITY", "存入数量超出当前库存。");
        }
        if (!stackable && quantity !== 1) {
            throw new XJZLContainerTransactionError("INVALID_QUANTITY", "这个物品不能按数量拆分存入。");
        }

        const sourceData = foundry.utils.deepClone(sourceItem.toObject());
        const stackKey = stackable ? this.#getStackKey(sourceItem) : null;
        const destinationItem = stackKey
            ? Array.from(node.items).find(item => this.#getStackKey(item) === stackKey)
            : null;
        const destinationQuantity = destinationItem
            ? Math.max(1, Number(destinationItem.system.quantity) || 1)
            : null;
        let createdItem = null;
        let sourceRemoved = false;

        try {
            if (destinationItem) {
                await destinationItem.update({ "system.quantity": destinationQuantity + quantity });
            } else {
                const itemData = foundry.utils.deepClone(sourceData);
                itemData.flags?.["xjzl-system"] && delete itemData.flags["xjzl-system"].containerHidden;
                if (stackable) itemData.system.quantity = quantity;
                const created = await node.createEmbeddedDocuments("Item", [itemData]);
                createdItem = created?.[0] || null;
                if (!createdItem) throw new Error("未能创建仓库物品。");
            }

            const remaining = stackable ? sourceQuantity - quantity : 0;
            if (remaining > 0) {
                await sourceItem.update({ "system.quantity": remaining });
            } else {
                await participant.deleteEmbeddedDocuments("Item", [sourceItem.id]);
                sourceRemoved = true;
            }
        } catch (err) {
            await this.#rollbackDepositItem({
                node,
                participant,
                sourceItem,
                sourceData,
                sourceRemoved,
                destinationItem,
                destinationQuantity,
                createdItem
            });
            throw err;
        }

        return {
            result: {
                action: "storageDepositItem",
                containerUuid: node.uuid,
                actorUuid: participant.uuid,
                itemId: sourceItem.id,
                itemName: sourceItem.name,
                quantity,
                remaining: stackable ? sourceQuantity - quantity : 0
            },
            undo: async () => this.#rollbackDepositItem({
                node,
                participant,
                sourceItem,
                sourceData,
                sourceRemoved,
                destinationItem,
                destinationQuantity,
                createdItem
            })
        };
    }

    /** 玩家从商铺购买库存物品；无限库存只保留商铺样品，不扣减样品数量。 */
    static async #shopBuyItem(node, participant, request) {
        if (!participant) throw new XJZLContainerTransactionError("INVALID_PARTICIPANT", "购买物品需要指定角色。");
        const sourceItem = node.items.get(request.itemId);
        if (!sourceItem) throw new XJZLContainerTransactionError("ITEM_UNAVAILABLE", "这个商品已经下架了。");
        const quantity = request.quantity == null ? 1 : request.quantity;
        const stackable = STACKABLE_ITEM_TYPES.has(sourceItem.type);
        const stockQuantity = stackable ? Math.max(1, Number(sourceItem.system.quantity) || 1) : 1;
        if (!Number.isInteger(quantity) || quantity <= 0 || (!node.system.settings.infiniteStock && quantity > stockQuantity)) {
            throw new XJZLContainerTransactionError("INVALID_QUANTITY", "购买数量超出当前库存。");
        }
        if (!stackable && quantity !== 1) {
            throw new XJZLContainerTransactionError("INVALID_QUANTITY", "这个商品不能按数量购买。");
        }

        const price = this.#getShopBuyPrice(node, sourceItem);
        const total = price * quantity;
        const actorSilver = Number(participant.system.resources?.silver) || 0;
        if (actorSilver < total) {
            throw new XJZLContainerTransactionError("INSUFFICIENT_ACTOR_CURRENCY", "角色身上的银两不足。");
        }

        const mutation = await this.#addItemToActor(participant, sourceItem, quantity);
        const originalNodeCurrency = Number(node.system.currency) || 0;
        const sourceData = foundry.utils.deepClone(sourceItem.toObject());
        try {
            await participant.changeResources({ "system.resources.silver": actorSilver - total }, {
                cause: "containerShopPurchase",
                containerUuid: node.uuid
            });
            await node.update({ "system.currency": originalNodeCurrency + total });
            if (!node.system.settings.infiniteStock) {
                const remaining = stockQuantity - quantity;
                if (remaining > 0) await sourceItem.update({ "system.quantity": remaining });
                else await node.deleteEmbeddedDocuments("Item", [sourceItem.id]);
            }
        } catch (err) {
            try {
                await mutation.undo();
                if (!node.system.settings.infiniteStock) {
                    const currentSource = node.items.get(sourceItem.id);
                    if (!currentSource) await node.createEmbeddedDocuments("Item", [sourceData]);
                    else if (stackable) await currentSource.update({ "system.quantity": sourceData.system.quantity });
                }
                await participant.changeResources({ "system.resources.silver": actorSilver }, {
                    cause: "containerShopPurchaseRollback",
                    containerUuid: node.uuid
                });
                await node.update({ "system.currency": originalNodeCurrency });
            } catch (rollbackError) {
                console.error("XJZL | 商铺购买回滚失败:", { containerUuid: node.uuid, actorUuid: participant.uuid, rollbackError });
            }
            throw err;
        }
        return {
            result: {
                action: "shopBuyItem",
                containerUuid: node.uuid,
                actorUuid: participant.uuid,
                itemId: sourceItem.id,
                itemName: sourceItem.name,
                quantity,
                unitPrice: price,
                total
            },
            undo: async () => mutation.undo()
        };
    }

    /** 玩家向商铺出售物品；折扣由玩家在交易时输入，商铺不自动回购进库存。 */
    static async #shopSellItem(node, participant, request) {
        if (!participant) throw new XJZLContainerTransactionError("INVALID_PARTICIPANT", "出售物品需要指定角色。");
        const sourceItem = participant.items.get(request.itemId);
        if (!sourceItem) throw new XJZLContainerTransactionError("ITEM_UNAVAILABLE", "这个角色身上已经没有该物品了。");
        const stackable = STACKABLE_ITEM_TYPES.has(sourceItem.type);
        const sourceQuantity = stackable ? Math.max(1, Number(sourceItem.system.quantity) || 1) : 1;
        const quantity = request.quantity == null ? 1 : request.quantity;
        if (!Number.isInteger(quantity) || quantity <= 0 || quantity > sourceQuantity) {
            throw new XJZLContainerTransactionError("INVALID_QUANTITY", "出售数量超出当前库存。");
        }
        if (!stackable && quantity !== 1) {
            throw new XJZLContainerTransactionError("INVALID_QUANTITY", "这个物品不能按数量拆分出售。");
        }
        const discount = Number(request.sellDiscount);
        if (!Number.isFinite(discount) || discount < 0) {
            throw new XJZLContainerTransactionError("INVALID_DISCOUNT", "收购折扣必须是非负数字。");
        }
        const unitPrice = Math.max(0, Number(sourceItem.system.price) || 0);
        const total = Math.floor(unitPrice * quantity * discount);
        const wallet = Number(node.system.currency) || 0;
        if (!node.system.settings.infiniteWallet && wallet < total) {
            throw new XJZLContainerTransactionError("INSUFFICIENT_SHOP_WALLET", "商铺钱箱中的银两不足。");
        }
        const sourceData = foundry.utils.deepClone(sourceItem.toObject());
        const originalSilver = Number(participant.system.resources?.silver) || 0;
        try {
            if (sourceQuantity - quantity > 0) await sourceItem.update({ "system.quantity": sourceQuantity - quantity });
            else await participant.deleteEmbeddedDocuments("Item", [sourceItem.id]);
            await participant.changeResources({ "system.resources.silver": originalSilver + total }, {
                cause: "containerShopSale",
                containerUuid: node.uuid
            });
            if (!node.system.settings.infiniteWallet) await node.update({ "system.currency": wallet - total });
        } catch (err) {
            try {
                if (participant.items.get(sourceItem.id)) await sourceItem.update({ "system.quantity": sourceData.system.quantity });
                else await participant.createEmbeddedDocuments("Item", [sourceData]);
                await participant.changeResources({ "system.resources.silver": originalSilver }, {
                    cause: "containerShopSaleRollback",
                    containerUuid: node.uuid
                });
                if (!node.system.settings.infiniteWallet) await node.update({ "system.currency": wallet });
            } catch (rollbackError) {
                console.error("XJZL | 商铺出售回滚失败:", { containerUuid: node.uuid, actorUuid: participant.uuid, rollbackError });
            }
            throw err;
        }
        return {
            result: {
                action: "shopSellItem",
                containerUuid: node.uuid,
                actorUuid: participant.uuid,
                itemId: sourceItem.id,
                itemName: sourceItem.name,
                quantity,
                unitPrice,
                discount,
                total
            }
        };
    }

    static #getShopBuyPrice(node, item) {
        const shopData = item.getFlag("xjzl-system", "shop") || {};
        if (Number.isInteger(Number(shopData.buyPrice)) && Number(shopData.buyPrice) >= 0) return Number(shopData.buyPrice);
        const discount = Number.isFinite(Number(shopData.buyDiscount))
            ? Math.max(0, Number(shopData.buyDiscount))
            : Math.max(0, Number(node.system.settings.buyDiscount) || 0);
        return Math.floor(Math.max(0, Number(item.system.price) || 0) * discount);
    }

    static async #addItemToActor(actor, sourceItem, quantity) {
        const stackable = STACKABLE_ITEM_TYPES.has(sourceItem.type);
        const stackKey = stackable ? this.#getStackKey(sourceItem) : null;
        const destinationItem = stackKey
            ? Array.from(actor.items).find(item => this.#getStackKey(item) === stackKey)
            : null;
        const destinationQuantity = destinationItem
            ? Math.max(1, Number(destinationItem.system.quantity) || 1)
            : null;
        let createdItem = null;
        if (destinationItem) await destinationItem.update({ "system.quantity": destinationQuantity + quantity });
        else {
            const itemData = foundry.utils.deepClone(sourceItem.toObject());
            itemData.flags?.["xjzl-system"] && delete itemData.flags["xjzl-system"].containerHidden;
            itemData.flags?.["xjzl-system"] && delete itemData.flags["xjzl-system"].shop;
            if (stackable) itemData.system.quantity = quantity;
            createdItem = (await actor.createEmbeddedDocuments("Item", [itemData]))?.[0] || null;
            if (!createdItem) throw new Error("未能创建购买物品。");
        }
        return {
            undo: async () => {
                if (createdItem) await actor.deleteEmbeddedDocuments("Item", [createdItem.id]);
                else if (destinationItem && destinationQuantity != null) await destinationItem.update({ "system.quantity": destinationQuantity });
            }
        };
    }

    static async #rollbackDepositItem({
        node,
        participant,
        sourceItem,
        sourceData,
        sourceRemoved,
        destinationItem,
        destinationQuantity,
        createdItem
    }) {
        if (createdItem) {
            await node.deleteEmbeddedDocuments("Item", [createdItem.id]);
        } else if (destinationItem && destinationQuantity != null) {
            await destinationItem.update({ "system.quantity": destinationQuantity });
        }

        if (sourceRemoved || !participant.items.get(sourceItem.id)) {
            await participant.createEmbeddedDocuments("Item", [sourceData]);
        } else {
            await sourceItem.update({ "system.quantity": sourceData.system.quantity });
        }
    }

    /** 领取一次性修为奖励，并把玩家身份写入领取记录防止重复领取。 */
    static async #claimXp(node, participant, request) {
        if (!participant) {
            throw new XJZLContainerTransactionError("INVALID_PARTICIPANT", "领取修为需要指定接收角色。");
        }
        if (participant.type !== "character") {
            throw new XJZLContainerTransactionError("INVALID_PARTICIPANT", "只有角色卡可以领取修为奖励。");
        }
        if (!request.rewardId) {
            throw new XJZLContainerTransactionError("INVALID_REWARD", "缺少要领取的修为奖励。");
        }

        const reward = node.system.rewards.find(entry => entry.id === request.rewardId);
        if (!reward) {
            throw new XJZLContainerTransactionError("REWARD_UNAVAILABLE", "这个修为奖励不存在或已被移除。");
        }
        const user = game.users.get(request.userId);
        if (!user?.isGM && reward.hidden) {
            throw new XJZLContainerTransactionError("REWARD_HIDDEN", "这个修为奖励当前不可领取。");
        }
        if (reward.claims.some(claim => claim.userId === request.userId)) {
            throw new XJZLContainerTransactionError("REWARD_ALREADY_CLAIMED", "你已经领取过这个修为奖励了。");
        }

        const claims = foundry.utils.deepClone(reward.claims || []);
        claims.push({ userId: request.userId, actorUuid: participant.uuid, claimedAt: Date.now() });
        const rewards = foundry.utils.deepClone(node.system.rewards);
        const target = rewards.find(entry => entry.id === request.rewardId);
        target.claims = claims;
        await node.update({ "system.rewards": rewards });

        try {
            await participant.manualModifyXP(reward.poolKey, reward.amount, {
                title: reward.logTitle || reward.name,
                reason: reward.logReason || `获得战利品：${reward.name}`
            });
        } catch (err) {
            try {
                await node.update({ "system.rewards": node.system.rewards.map(entry => (
                    entry.id === request.rewardId ? { ...entry, claims: reward.claims } : entry
                )) });
            } catch (rollbackError) {
                console.error("XJZL | 修为奖励领取记录回滚失败:", {
                    containerUuid: node.uuid,
                    rewardId: request.rewardId,
                    rollbackError
                });
            }
            throw err;
        }

        return {
            action: "claimXp",
            containerUuid: node.uuid,
            actorUuid: participant.uuid,
            rewardId: reward.id,
            rewardName: reward.name,
            poolKey: reward.poolKey,
            amount: reward.amount
        };
    }

    static async #lootAll(node, participant, request) {
        if (!participant) {
            throw new XJZLContainerTransactionError("INVALID_PARTICIPANT", "全部拾取需要指定接收角色。");
        }

        const mutations = [];
        const results = [];
        try {
            const items = Array.from(node.items).filter(item => {
                const hidden = item.getFlag("xjzl-system", "containerHidden");
                return game.users.get(request.userId)?.isGM || !hidden;
            });
            for (const item of items) {
                const mutation = await this.#lootItem(node, participant, {
                    ...request,
                    action: "lootItem",
                    itemId: item.id,
                    quantity: STACKABLE_ITEM_TYPES.has(item.type)
                        ? Math.max(1, Number(item.system.quantity) || 1)
                        : 1
                });
                mutations.push(mutation);
                results.push(mutation.result);
            }

            if (node.system.currency > 0) {
                const currencyMutation = await this.#transferCurrency(node, participant, {
                    ...request,
                    action: "currencyTransfer",
                    direction: "take",
                    amount: node.system.currency
                }, { returnUndo: true });
                mutations.push(currencyMutation);
                results.push(currencyMutation.result);
            }

            if (results.length === 0) {
                throw new XJZLContainerTransactionError("NOTHING_TO_LOOT", "这个战利品节点已经没有可领取内容。");
            }

            await this.#updateNodeStatus(node, "take");
            return {
                action: "lootAll",
                containerUuid: node.uuid,
                actorUuid: participant.uuid,
                results,
                empty: node.system.isEmpty
            };
        } catch (err) {
            for (const mutation of mutations.reverse()) {
                try {
                    await mutation.undo();
                } catch (rollbackError) {
                    console.error("XJZL | 全部拾取回滚失败:", {
                        containerUuid: node.uuid,
                        actorUuid: participant.uuid,
                        rollbackError
                    });
                }
            }
            throw err;
        }
    }

    static #getStackKey(item) {
        if (!STACKABLE_ITEM_TYPES.has(item.type)) return null;
        // 当前物品没有稳定的模板 ID；同类型同名作为堆叠身份，来源 flag 不应制造重复堆。
        return `${item.type}|${String(item.name || "").trim()}`;
    }

    /** 根据库存变化维护一次性节点状态；补充任意库存会重新开放节点。 */
    static async #updateNodeStatus(node, direction) {
        try {
            if (node.system.mode !== "loot") return;
            if (direction === "deposit") {
                if (node.system.status === "depleted") await node.update({ "system.status": "active" });
                return;
            }
            if (node.system.isEmpty && node.system.status === "active") {
                await node.update({ "system.status": "depleted" });
            }
        } catch (err) {
            // 状态同步失败不能否定已经完成的库存事务，记录后由下一次打开节点时修正。
            console.error("XJZL | 物资节点状态同步失败:", { containerUuid: node.uuid, direction, err });
        }
    }

    static async #rollbackLootItem({
        node,
        participant,
        sourceItem,
        sourceData,
        sourceRemoved,
        destinationItem,
        destinationQuantity,
        createdItem
    }) {
        if (createdItem) {
            await participant.deleteEmbeddedDocuments("Item", [createdItem.id]);
        } else if (destinationItem && destinationQuantity != null) {
            await destinationItem.update({ "system.quantity": destinationQuantity });
        }

        if (sourceRemoved || !node.items.get(sourceItem.id)) {
            await node.createEmbeddedDocuments("Item", [sourceData]);
        } else {
            await sourceItem.update({ "system.quantity": sourceData.system.quantity });
        }
    }

    static async #transferCurrency(node, participant, request, { returnUndo = false } = {}) {
        if (!participant) {
            throw new XJZLContainerTransactionError("INVALID_PARTICIPANT", "货币操作需要指定角色。");
        }
        if (!Number.isInteger(request.amount) || request.amount <= 0) {
            throw new XJZLContainerTransactionError("INVALID_AMOUNT", "银两数量必须是正整数。");
        }
        if (!["take", "deposit"].includes(request.direction)) {
            throw new XJZLContainerTransactionError("INVALID_DIRECTION", "银两操作方向无效。");
        }

        const actorSilver = Number(participant.system.resources?.silver) || 0;
        const nodeSilver = Number(node.system.currency) || 0;
        const isTake = request.direction === "take";
        if (isTake && request.amount > nodeSilver) {
            throw new XJZLContainerTransactionError("INSUFFICIENT_NODE_CURRENCY", "物资节点中的银两不足。");
        }
        if (!isTake && request.amount > actorSilver) {
            throw new XJZLContainerTransactionError("INSUFFICIENT_ACTOR_CURRENCY", "角色身上的银两不足。");
        }

        const nextNodeSilver = isTake ? nodeSilver - request.amount : nodeSilver + request.amount;
        const nextActorSilver = isTake ? actorSilver + request.amount : actorSilver - request.amount;

        if (isTake) {
            await node.update({ "system.currency": nextNodeSilver });
            try {
                await participant.changeResources({ "system.resources.silver": nextActorSilver }, {
                    cause: "containerCurrencyTransfer",
                    containerUuid: node.uuid
                });
            } catch (err) {
                try {
                    await node.update({ "system.currency": nodeSilver });
                } catch (rollbackError) {
                    console.error("XJZL | 物资节点取出银两回滚失败:", {
                        containerUuid: node.uuid,
                        actorUuid: participant.uuid,
                        amount: request.amount,
                        rollbackError
                    });
                }
                throw err;
            }
        } else {
            await participant.changeResources({ "system.resources.silver": nextActorSilver }, {
                cause: "containerCurrencyTransfer",
                containerUuid: node.uuid
            });
            try {
                await node.update({ "system.currency": nextNodeSilver });
            } catch (err) {
                try {
                    await participant.changeResources({ "system.resources.silver": actorSilver }, {
                        cause: "containerCurrencyRollback",
                        containerUuid: node.uuid
                    });
                } catch (rollbackError) {
                    console.error("XJZL | 物资节点存入银两回滚失败:", {
                        containerUuid: node.uuid,
                        actorUuid: participant.uuid,
                        amount: request.amount,
                        rollbackError
                    });
                }
                throw err;
            }
        }

        const result = {
            action: "currencyTransfer",
            direction: request.direction,
            amount: request.amount,
            containerUuid: node.uuid,
            actorUuid: participant.uuid,
            nodeCurrency: nextNodeSilver,
            actorCurrency: nextActorSilver
        };
        if (!returnUndo) return result;

        return {
            result,
            undo: async () => {
                try {
                    if (isTake) {
                        await participant.changeResources({ "system.resources.silver": actorSilver }, {
                            cause: "containerCurrencyRollback",
                            containerUuid: node.uuid
                        });
                        await node.update({ "system.currency": nodeSilver });
                    } else {
                        await node.update({ "system.currency": nodeSilver });
                        await participant.changeResources({ "system.resources.silver": actorSilver }, {
                            cause: "containerCurrencyRollback",
                            containerUuid: node.uuid
                        });
                    }
                } catch (rollbackError) {
                    console.error("XJZL | 物资节点全部拾取的银两回滚失败:", {
                        containerUuid: node.uuid,
                        actorUuid: participant.uuid,
                        amount: request.amount,
                        rollbackError
                    });
                    throw rollbackError;
                }
            }
        };
    }

    static async #withLocks(keys, operation) {
        const uniqueKeys = [...new Set(keys)].sort();
        let release;
        const current = new Promise(resolve => { release = resolve; });
        const previous = uniqueKeys.map(key => locks.get(key)).filter(Boolean);
        uniqueKeys.forEach(key => locks.set(key, current));

        try {
            await Promise.all(previous);
            return await operation();
        } finally {
            release();
            uniqueKeys.forEach(key => {
                if (locks.get(key) === current) locks.delete(key);
            });
        }
    }
}
