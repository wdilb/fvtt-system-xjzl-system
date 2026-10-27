const SYSTEM_ID = "xjzl-system";
const turnCounts = new WeakMap();
const writes = new WeakMap();
// 客户端预记终点供即时交互使用；GM 核心补发事件必须暂时排除尚未真正开始的终点。
const pendingStarts = new WeakMap();

/** 注册世界级 AE 到期规则；world 设置仅 GM 可更改，默认关联角色。 */
export function registerEffectDurationSetting() {
  game.settings.register(SYSTEM_ID, "effectDurationMode", {
    name: "XJZL.Settings.EffectDuration.Name",
    hint: "XJZL.Settings.EffectDuration.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      combatant: "XJZL.Settings.EffectDuration.Combatant",
      initiative: "XJZL.Settings.EffectDuration.Initiative"
    },
    default: "combatant",
    requiresReload: true
  });
}

/** 返回当前世界的到期模式；未配置或旧设置值均采用角色关联。 */
export function getEffectDurationMode() {
  return game.settings.get(SYSTEM_ID, "effectDurationMode") === "initiative" ? "initiative" : "combatant";
}

/** 读取角色累计次数；核心事件有独立快照，显示与新状态创建则读取客户端最新计数。 */
export function getEffectTurnCount(combat, id, context) {
  if ((!context?.combat || context.combat === combat) && Object.hasOwn(context?.effectTurnCounts ?? {}, id)) {
    return context.effectTurnCounts[id];
  }
  // 主 GM 切换后，其他客户端提交的计数可能已超过本机缓存；计数只能向前增长。
  return Math.max(turnCounts.get(combat)?.[id] ?? 0,
    combat.getFlag(SYSTEM_ID, `effectTurnCounts.${id}`) ?? 0);
}

/** 合并 GM 广播到现有预记账状态；仅有效计数增长时返回 true，落后或相同的广播不触发补刷。 */
export function synchronizeEffectTurnCounts(combat) {
  const counts = turnCounts.get(combat) ?? {};
  let changed = false;
  for (const [id, saved] of Object.entries(combat.getFlag(SYSTEM_ID, "effectTurnCounts") ?? {})) {
    const known = counts[id] ?? 0;
    const next = Math.max(known, saved);
    if (next === known) continue;
    counts[id] = next;
    changed = true;
  }
  if (changed) turnCounts.set(combat, counts);
  return changed;
}

/** 所有客户端在流转入口同步记账；position 为终点的 round/turn，GM 另保留未提交标记。 */
export function recordEffectTurnStart(combat, id, position) {
  const count = getEffectTurnCount(combat, id) + 1;
  // 晚加入的客户端也已知已加载的历史次数，后续相同广播不能被误判为校正。
  const counts = turnCounts.get(combat) ?? { ...combat.getFlag(SYSTEM_ID, "effectTurnCounts") };
  counts[id] = count;
  turnCounts.set(combat, counts);
  if (game.users.activeGM?.isSelf) {
    const pending = pendingStarts.get(combat) ?? [];
    pending.push({ id, count, round: position.round, turn: position.turn });
    pendingStarts.set(combat, pending);
  }
}

/**
 * 为核心回合/大轮事件固定计数与角色快照，不让预记的终点次数泄漏到补发事件。
 * @param {Combat} combat 事件所属战斗。
 * @param {object} context 核心持有的可变 round/turn/skipped 上下文，供后续 Registry 使用。
 * @param {string} [id] 回合事件的实际参战者 ID；大轮事件省略。
 * @param {boolean} [start=false] 实际回合开始时才提交对应的预记次数。
 */
export function captureEffectTurnContext(combat, context, id, start = false) {
  const pending = pendingStarts.get(combat) ?? [];
  if (start && !context.skipped) {
    const index = pending.findIndex(p => p.id === id && p.round === context.round && p.turn === context.turn);
    if (index >= 0) pending.splice(index, 1);
  }
  const saved = combat.getFlag(SYSTEM_ID, "effectTurnCounts") ?? {};
  const counts = { ...saved, ...turnCounts.get(combat) };
  for (const key of Object.keys(counts)) counts[key] = getEffectTurnCount(combat, key);
  // 连续快速推进可能有多个终点在途，事件只能看到最早未提交的计数之前。
  for (const next of pending) {
    counts[next.id] = Math.min(counts[next.id], next.count - 1);
  }
  context.effectTurnCounts = counts;
  if (id) context.combatantId = id;
}

/**
 * 活动 GM 在核心过期结算前串行持久化已记账的次数，不再次累加。
 * @param {Combat} combat 本次回合所属战斗。
 * @param {string} id 当前参战者 ID。
 * @param {object} [context] 本次实际开始事件的计数快照，不能持久化更晚的在途次数。
 * @returns {Promise<unknown>} 写入失败向调用者传播，后续写入仍可继续。
 */
export function persistEffectTurnCount(combat, id, context) {
  const count = getEffectTurnCount(combat, id, context);
  const save = () => combat.setFlag(SYSTEM_ID, `effectTurnCounts.${id}`, count);
  const previous = writes.get(combat);
  const current = previous ? previous.then(save, error => {
    console.error("XJZL | 上次特效回合计数写入失败，继续保存当前计数:", error);
    return save();
  }) : save();
  writes.set(combat, current);
  return current;
}
