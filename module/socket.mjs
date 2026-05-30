import { CombatStatsManager } from "./managers/combat-stats-manager.mjs";

export let xjzlSocket;

export function setupSocket() {
    xjzlSocket = socketlib.registerSystem("xjzl-system");

    // 注册所有需要 GM 权限的方法
    xjzlSocket.register("applyDamage", _socketApplyDamage);
    xjzlSocket.register("applyHealing", _socketApplyHealing);
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

    // === 视觉类 (所有人执行) ===
    // 注册飘字广播
    xjzlSocket.register("showScrollingText", _socketShowScrollingText);

}

// ================= GM 侧执行函数 =================
// 定义一个检查函数：如果我不是负责干活的主 GM，我就不管
function isNotActiveGM() {
    // game.users.activeGM 会自动指向当前在线的唯一的、ID最小的 GM
    // 如果那个 GM 不是我自己 (.isSelf)，那我就返回 true (表示我不执行)
    return !game.users.activeGM?.isSelf;
}
async function _socketApplyDamage(targetUuid, data) {
    // 在此拦截：如果有多个GM 在线，只有 1 个会通过这个判断
    if (isNotActiveGM()) return null;
    const target = await fromUuid(targetUuid);
    if (!target) return null;
    if (data.attackerUuid) data.attacker = await fromUuid(data.attackerUuid);
    return await target.applyDamage(data);
}

async function _socketApplyHealing(targetUuid, data) {
    // 在此拦截：如果有多个GM 在线，只有 1 个会通过这个判断
    if (isNotActiveGM()) return null;
    const target = await fromUuid(targetUuid);
    if (!target) return { actualHeal: 0 };
    return await target.applyHealing(data);
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

// 供脚本代理使用的底层文档操作
async function _socketUpdateDocument(uuid, data, context) {
    // 在此拦截：如果有多个GM 在线，只有 1 个会通过这个判断
    if (isNotActiveGM()) return null;
    const doc = await fromUuid(uuid);
    // 强制 context 为对象，防止 null 导致核心 update 方法崩溃
    return await doc?.update(data, context || {});
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