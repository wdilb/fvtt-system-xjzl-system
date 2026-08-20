/**
 * 物资节点交易内核。
 * 约束：只在活动 GM 端读取并修改节点/角色，调用方必须提供真实 socket 用户 ID。
 */

const locks = new Map();
const completedOperations = new Map();
const MAX_COMPLETED_OPERATIONS = 256;

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

        this.#assertNodeAccess(node, normalized.userId, normalized.action);
        if (participant) this.#assertParticipantAccess(participant, normalized.userId);

        const lockKeys = [node.uuid, participant?.uuid].filter(Boolean);
        const result = await this.#withLocks(lockKeys, async () => {
            // 锁等待期间重新解析文档，避免使用等待前已经过期的库存快照。
            const lockedNode = await this.#loadContainer(normalized.containerUuid);
            const lockedParticipant = normalized.actorUuid
                ? await this.#loadActor(normalized.actorUuid)
                : null;

            this.#assertNodeAccess(lockedNode, normalized.userId, normalized.action);
            if (lockedParticipant) this.#assertParticipantAccess(lockedParticipant, normalized.userId);

            switch (normalized.action) {
                case "inspect":
                    return this.#inspect(lockedNode, normalized.userId);
                case "currencyTransfer":
                    return this.#transferCurrency(lockedNode, lockedParticipant, normalized);
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
            direction: request.direction ? String(request.direction) : null,
            amount: request.amount == null ? null : Number(request.amount)
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

    static #assertNodeAccess(node, userId, action) {
        const user = game.users.get(userId);
        if (!user) throw new XJZLContainerTransactionError("INVALID_USER", "操作用户不存在或已离线。");
        if (user.isGM) return;

        if (!node.testUserPermission(user, "OBSERVER")) {
            throw new XJZLContainerTransactionError("NO_VIEW_PERMISSION", "你没有查看这个物资节点的权限。");
        }
        if (!node.system.isOpen) {
            throw new XJZLContainerTransactionError("NODE_CLOSED", "这个物资节点当前未开放。");
        }

        const settings = node.system.settings;
        const allowed = {
            inspect: true,
            currencyTransfer: Boolean(settings.allowTake || settings.allowDeposit || settings.allowWithdraw)
        }[action];
        if (!allowed) {
            throw new XJZLContainerTransactionError("ACTION_NOT_ALLOWED", "这个物资节点不允许当前操作。");
        }
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
            canSeeHidden || !item.getFlag("xjzl-system", "containerHidden")
        ));
        const visibleRewards = node.system.rewards.filter(reward => canSeeHidden || !reward.hidden);

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

    static async #transferCurrency(node, participant, request) {
        if (!participant) {
            throw new XJZLContainerTransactionError("INVALID_PARTICIPANT", "货币操作需要指定角色。");
        }
        if (!Number.isInteger(request.amount) || request.amount <= 0) {
            throw new XJZLContainerTransactionError("INVALID_AMOUNT", "银两数量必须是正整数。");
        }
        if (!["take", "deposit"].includes(request.direction)) {
            throw new XJZLContainerTransactionError("INVALID_DIRECTION", "银两操作方向无效。");
        }

        const settings = node.system.settings;
        const actorSilver = Number(participant.system.resources?.silver) || 0;
        const nodeSilver = Number(node.system.currency) || 0;
        const isTake = request.direction === "take";
        const isGM = game.users.get(request.userId)?.isGM;

        const canTake = node.system.mode === "storage"
            ? settings.allowWithdraw
            : settings.allowTake;
        if (isTake && !canTake && !isGM) {
            throw new XJZLContainerTransactionError("ACTION_NOT_ALLOWED", "这个物资节点不允许取出银两。");
        }
        if (!isTake && !settings.allowDeposit && !isGM) {
            throw new XJZLContainerTransactionError("ACTION_NOT_ALLOWED", "这个物资节点不允许存入银两。");
        }
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

        return {
            action: "currencyTransfer",
            direction: request.direction,
            amount: request.amount,
            containerUuid: node.uuid,
            actorUuid: participant.uuid,
            nodeCurrency: nextNodeSilver,
            actorCurrency: nextActorSilver
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
