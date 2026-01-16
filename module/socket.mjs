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
    return await doc?.update(data, context);
}

async function _socketCreateEmbedded(parentUuid, type, data, context) {
    // 在此拦截：如果有多个GM 在线，只有 1 个会通过这个判断
    if (isNotActiveGM()) return null;
    const parent = await fromUuid(parentUuid);
    return await parent?.createEmbeddedDocuments(type, data, context);
}

async function _socketDeleteEmbedded(parentUuid, type, ids, context) {
    // 在此拦截：如果有多个GM 在线，只有 1 个会通过这个判断
    if (isNotActiveGM()) return null;
    const parent = await fromUuid(parentUuid);
    return await parent?.deleteEmbeddedDocuments(type, ids, context);
}