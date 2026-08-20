import { CombatStatsManager } from "./managers/combat-stats-manager.mjs";
import { EncounterManager } from "./managers/encounter-manager.mjs";
import { XJZLContainerTransactionManager } from "./managers/container-transaction-manager.mjs";
import { wrapResourceSocketError, wrapResourceSocketResult } from "./utils/resource-commit-error.mjs";

export let xjzlSocket;

export function setupSocket() {
    xjzlSocket = socketlib.registerSystem("xjzl-system");

    // 注册所有需要 GM 权限的方法
    xjzlSocket.register("applyDamage", _socketApplyDamage);
    xjzlSocket.register("applyHealing", _socketApplyHealing);
    xjzlSocket.register("changeResources", _socketChangeResources);
    xjzlSocket.register("addEffect", _socketAddEffect);
    xjzlSocket.register("removeEffect", _socketRemoveEffect);
    xjzlSocket.register("updateDocument", _socketUpdateDocument);
    xjzlSocket.register("createEmbedded", _socketCreateEmbedded);
    xjzlSocket.register("deleteEmbedded", _socketDeleteEmbedded);
    xjzlSocket.register("stopStance", _socketStopStance);
    // 注册战斗动作计数器
    xjzlSocket.register("recordCombatStat", _socketRecordCombatStat);
    xjzlSocket.register("broadcastCombatStats", _socketBroadcastCombatStats);
    xjzlSocket.register("requestCombatStats", _socketRequestCombatStats);
    xjzlSocket.register("useEncounterSupport", _socketUseEncounterSupport);
    xjzlSocket.register("executeContainerTransaction", _socketExecuteContainerTransaction);
    xjzlSocket.register("containerNeedPrompt", _socketContainerNeedPrompt);
    xjzlSocket.register("containerNeedResult", _socketContainerNeedResult);

    Hooks.on("xjzl.containerNeedTimeout", async request => {
        if (!game.user.isGM || !game.users.activeGM?.isSelf) return;
        const result = await XJZLContainerTransactionManager.executeAsGM({
            action: "needTimeout",
            containerUuid: request.containerUuid,
            needId: request.needId,
            operationId: foundry.utils.randomID()
        }, game.user.id);
        if (result?.action === "needResult") xjzlSocket.executeForEveryone("containerNeedResult", result);
    });

    // === 视觉类 (所有人执行) ===
    // 注册飘字广播
    xjzlSocket.register("showScrollingText", _socketShowScrollingText);

    // === 脚本执行路由 ===
    // 注册Actor脚本执行（用于战斗流转脚本路由到玩家端执行）
    xjzlSocket.register("runActorScript", _socketRunActorScript);
    xjzlSocket.register("runActorScriptWithRegen", _socketRunActorScriptWithRegen);

}

// ================= GM 侧执行函数 =================
// 定义一个检查函数：如果我不是负责干活的主 GM，我就不管
function isNotActiveGM() {
    // game.users.activeGM 会自动指向当前在线的唯一的、ID最小的 GM
    // 如果那个 GM 不是我自己 (.isSelf)，那我就返回 true (表示我不执行)
    return !game.users.activeGM?.isSelf;
}

/**
 * 将 socket 传输的资源上下文字段中的 UUID 还原为文档引用。
 * 先浅拷贝，避免修改 socketlib 传入的对象；UUID 解析失败时对应字段安全置为 null。
 */
async function deserializeResourceContext(context = {}) {
    const restored = { ...(context || {}) };
    const uuidToDoc = [
        ["itemUuid", "item"],
        ["sourceActorUuid", "sourceActor"],
        ["targetUuid", "target"],
        ["attackerUuid", "attacker"],
        ["healerUuid", "healer"]
    ];
    for (const [uuidKey, docKey] of uuidToDoc) {
        const uuid = restored[uuidKey];
        if (uuid) {
            const doc = await fromUuid(uuid);
            if (doc) restored[docKey] = doc;
            else if (restored[docKey] === undefined) restored[docKey] = null;
        }
        delete restored[uuidKey];
    }
    return restored;
}

async function _socketApplyDamage(targetUuid, data) {
    // 在此拦截：如果有多个GM 在线，只有 1 个会通过这个判断
    if (isNotActiveGM()) return null;
    const target = await fromUuid(targetUuid);
    if (!target) return null;
    data = await deserializeResourceContext(data);
    try {
        return wrapResourceSocketResult(await target.applyDamage(data));
    } catch (err) {
        return wrapResourceSocketError(err);
    }
}

async function _socketApplyHealing(targetUuid, data) {
    // 在此拦截：如果有多个GM 在线，只有 1 个会通过这个判断
    if (isNotActiveGM()) return null;
    const target = await fromUuid(targetUuid);
    if (!target) return { actualHeal: 0 };
    data = await deserializeResourceContext(data);
    try {
        return wrapResourceSocketResult(await target.applyHealing(data));
    } catch (err) {
        return wrapResourceSocketError(err);
    }
}

/** 在主 GM 端恢复资源上下文中的文档引用，并执行统一资源事务。 */
async function _socketChangeResources(targetUuid, updates, context = {}) {
    if (isNotActiveGM()) return null;
    const target = await fromUuid(targetUuid);
    if (!target) return null;
    context = await deserializeResourceContext(context);
    try {
        return wrapResourceSocketResult(await target.changeResources(updates, context));
    } catch (err) {
        return wrapResourceSocketError(err);
    }
}

async function _socketAddEffect(targetUuid, effectData, count) {
    // 在此拦截：如果有多个GM 在线，只有 1 个会通过这个判断
    if (isNotActiveGM()) return null;
    const target = await fromUuid(targetUuid);
    return await game.xjzl.api.effects.addEffect(target, effectData, count);
}

async function _socketRemoveEffect(targetUuid, targetId, amount) {
    // 在此拦截：如果有多个GM 在线，只有 1 个会通过这个判断
    if (isNotActiveGM()) return null;
    const target = await fromUuid(targetUuid);
    return await game.xjzl.api.effects.removeEffect(target, targetId, amount);
}

// 供脚本代理使用的底层文档操作。
// 注意：若通过本通道更新 Actor 资源，调用端必须用 unwrapResourceSocketResult() 解包，
// 否则资源事务专用错误信封会被误当成成功结果。
async function _socketUpdateDocument(uuid, data, context) {
    // 在此拦截：如果有多个GM 在线，只有 1 个会通过这个判断
    if (isNotActiveGM()) return null;
    const doc = await fromUuid(uuid);
    // 强制 context 为对象，防止 null 导致核心 update 方法崩溃
    const operation = { ...(context || {}) };
    if (operation.xjzlResourceContext) {
        operation.xjzlResourceContext = await deserializeResourceContext(operation.xjzlResourceContext);
    }
    try {
        return await doc?.update(data, operation);
    } catch (err) {
        // 仅资源事务错误需要保留 committed/phase 等字段；普通文档更新错误仍走 socketlib 异常通道。
        return wrapResourceSocketError(err);
    }
}

async function _socketCreateEmbedded(parentUuid, type, data, context) {
    // 在此拦截：如果有多个GM 在线，只有 1 个会通过这个判断
    if (isNotActiveGM()) return null;
    const parent = await fromUuid(parentUuid);
    // 强制 context 为对象
    return await parent?.createEmbeddedDocuments(type, data, context || {});
}

async function _socketDeleteEmbedded(parentUuid, type, ids, context) {
    // 在此拦截：如果有多个GM 在线，只有 1 个会通过这个判断
    if (isNotActiveGM()) return null;
    const parent = await fromUuid(parentUuid);
    // 强制 context 为对象
    return await parent?.deleteEmbeddedDocuments(type, ids, context || {});
}

/**
 * 在客户端本地执行飘字渲染
 * @param {string} tokenUuid - 目标 Token (或 Actor) 的 UUID
 * @param {string} text - 显示文本
 * @param {Object} settings - 样式配置 (fill, stroke, jitter 等)
 */
async function _socketShowScrollingText(tokenUuid, text, settings) {
    // 1. 解析目标
    // 尝试直接获取 Token，如果传入的是 Actor UUID，尝试获取其在当前场景的 Token
    const doc = await fromUuid(tokenUuid);
    let tokenObject = null;

    if (doc instanceof TokenDocument) {
        tokenObject = doc.object;
    } else if (doc instanceof Actor) {
        // 如果是 Actor，找当前画布上的 Token
        // getActiveTokens(false) 返回的是 PlaceableObject (即 token.object)
        const tokens = doc.getActiveTokens(false);
        if (tokens.length > 0) tokenObject = tokens[0];
    }

    // 2. 存在性检查
    // 如果当前场景没有这个 Token，直接放弃 (比如 GM 在 A 场景打架，玩家在 B 场景，玩家不需要看到飘字)
    if (!tokenObject || !tokenObject.renderable) return;

    // 3. 可见性检查 (防剧透关键)
    // 如果 Token 对当前用户不可见 (隐形/迷雾)，且当前用户不是 GM -> 不显示
    if (!tokenObject.visible && !game.user.isGM) return;

    // 4. 执行渲染
    // 使用 interface.createScrollingText 确保是 UI 层面的绘制
    canvas.interface.createScrollingText(tokenObject.center, text, settings);
}

/**
 * 执行解除架招
 * @param {string} targetUuid
 */
async function _socketStopStance(targetUuid) {
    if (isNotActiveGM()) return null;

    // 1. 获取文档
    const targetDoc = await fromUuid(targetUuid);
    if (!targetDoc) return null;

    // 2. 兼容关联Actor与不关联Token
    // 如果 targetDoc 是 TokenDocument，取它的 .actor；否则它本身就是 Actor
    const actor = targetDoc.actor || targetDoc;

    if (!actor || typeof actor.stopStance !== "function") return null;

    // 3. 执行
    return await actor.stopStance();
}

/**
 * 战斗统计
 * @returns 
 */
async function _socketRecordCombatStat(data) {
    // 只有活跃的 GM 会处理数据汇总
    if (isNotActiveGM()) return null;
    // 直接交给管理器处理
    CombatStatsManager.processStatRecord(data);
}

/**
 * 接收 GM 广播的战斗统计最新数据 (仅非 GM 客户端会收到并处理)
 */
async function _socketBroadcastCombatStats(syncData) {
    CombatStatsManager.importSyncData(syncData);
    // 触发本地的 UI 刷新
    Hooks.callAll("xjzl.combatStatsUpdated");

}

/**
 * 非 GM 玩家登录时，向 GM 索要当前的统计数据
 * 因为 socketlib 的 executeAsGM 支持返回值，所以直接 return 即可
 */
async function _socketRequestCombatStats() {
    if (isNotActiveGM()) return null;
    return CombatStatsManager.exportSyncData();
}

/**
 * 执行指定 Actor 的脚本（用于战斗流转脚本路由）
 * 此方法会在玩家端执行，不是 GM 专用，所以不需要 isNotActiveGM 检查
 * @param {string} actorUuid - Actor UUID
 * @param {string} trigger - 触发时机 (combatStart/turnStart/turnEnd)
 * @param {Object} context - 上下文对象
 */
async function _socketRunActorScript(actorUuid, trigger, context) {
    const actor = await fromUuid(actorUuid);
    if (!actor) {
        console.error(`XJZL | Socket 路由脚本失败：找不到 Actor [${actorUuid}]`);
        return;
    }
    try {
        await actor.runScripts(trigger, context);
    } catch (err) {
        console.error(`XJZL | Socket 路由脚本执行错误 [${actor.name}, ${trigger}]:`, err);
    }
}

/**
 * 执行指定 Actor 的回合脚本（包含 processRegen 和 runScripts）
 * 此方法会在玩家端执行，不是 GM 专用，所以不需要 isNotActiveGM 检查
 * @param {string} actorUuid - Actor UUID
 * @param {string} trigger - 触发时机 (turnStart/turnEnd)
 * @param {string} regenTiming - processRegen 的时机 (TurnStart/TurnEnd)
 */
async function _socketRunActorScriptWithRegen(actorUuid, trigger, regenTiming) {
    const actor = await fromUuid(actorUuid);
    if (!actor) {
        console.error(`XJZL | Socket 路由脚本失败：找不到 Actor [${actorUuid}]`);
        return;
    }
    try {
        await actor.processRegen(regenTiming);
        await actor.runScripts(trigger, {});
    } catch (err) {
        console.error(`XJZL | Socket 路由脚本执行错误 [${actor.name}, ${trigger}]:`, err);
    }
}

/**
 * 将玩家的支援请求交给主 GM 串行复核和结算。
 * @param {object} request 仅包含 Combat、编组、NPC、动作和 Combatant ID
 */
async function _socketUseEncounterSupport(request) {
    if (isNotActiveGM()) return null;
    // socketlib 会把真实发送者写入调用上下文；覆盖客户端字段，避免伪造 GM 身份绕过编组权限。
    return EncounterManager.executeSupportAsGM({ ...request, userId: this.socketdata.userId });
}

function _socketContainerNeedPrompt(payload) {
    Hooks.callAll("xjzl.containerNeedPrompt", payload);
}

function _socketContainerNeedResult(payload) {
    Hooks.callAll("xjzl.containerNeedResult", payload);
}

/**
 * 将物资节点请求交给活动 GM 串行复核和执行。
 * @param {Object} request - 仅包含业务请求数据，用户身份由 socketlib 上下文覆盖
 * @returns {Promise<Object|null>} 结构化成功或失败结果
 */
async function _socketExecuteContainerTransaction(request) {
    if (isNotActiveGM()) return null;

    try {
        const response = {
            ok: true,
            data: await XJZLContainerTransactionManager.executeAsGM(
                request,
                this.socketdata.userId
            )
        };
        if (response.data?.action === "needStart") {
            xjzlSocket.executeForEveryone("containerNeedPrompt", response.data);
        } else if (response.data?.action === "needResult") {
            xjzlSocket.executeForEveryone("containerNeedResult", response.data);
        }
        return response;
    } catch (err) {
        if (err?.name !== "XJZLContainerTransactionError") {
            console.error("XJZL | 物资节点交易执行异常:", err);
        }
        return {
            ok: false,
            error: {
                code: err?.code || "TRANSACTION_FAILED",
                message: err?.message || "物资节点交易失败。",
                details: err?.details || {}
            }
        };
    }
}
