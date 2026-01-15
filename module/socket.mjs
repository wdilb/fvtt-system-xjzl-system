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
async function _socketApplyDamage(targetUuid, data) {
    const target = await fromUuid(targetUuid);
    if (!target) return null;
    if (data.attackerUuid) data.attacker = await fromUuid(data.attackerUuid);
    return await target.applyDamage(data);
}

async function _socketApplyHealing(targetUuid, data) {
    const target = await fromUuid(targetUuid);
    if (!target) return { actualHeal: 0 };
    return await target.applyHealing(data);
}

async function _socketAddEffect(targetUuid, effectData, count) { 
    const target = await fromUuid(targetUuid);
    return await game.xjzl.api.effects.addEffect(target, effectData, count);
}

async function _socketRemoveEffect(targetUuid, targetId, amount) {
    const target = await fromUuid(targetUuid);
    return await game.xjzl.api.effects.removeEffect(target, targetId, amount);
}

// 供脚本代理使用的底层文档操作
async function _socketUpdateDocument(uuid, data, context) {
    const doc = await fromUuid(uuid);
    return await doc?.update(data, context);
}

async function _socketCreateEmbedded(parentUuid, type, data, context) {
    const parent = await fromUuid(parentUuid);
    return await parent?.createEmbeddedDocuments(type, data, context);
}

async function _socketDeleteEmbedded(parentUuid, type, ids, context) {
    const parent = await fromUuid(parentUuid);
    return await parent?.deleteEmbeddedDocuments(type, ids, context);
}