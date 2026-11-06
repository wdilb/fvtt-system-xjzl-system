import {
  GENERATION_MATCH_THRESHOLDS, calculateWuxingContribution, countLearnedHealing,
  deriveMoveProgress, evaluateMoveCompatibility, isFormalMove, moveStageChoices,
  resourceIdentity, selectRepresentativeMove, xpForMoveStage
} from "./character-generation.mjs";

function choose(values, rng) {
  if (!values.length) return null;
  return values[Math.min(values.length - 1, Math.max(0, Math.floor(rng() * values.length)))];
}

function shuffled(values, rng) {
  const result = [...values];
  for (let index = 0; index < result.length - 1; index += 1) {
    const other = index + Math.min(result.length - index - 1, Math.max(0, Math.floor(rng() * (result.length - index))));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/** 累加未封顶的逐招贡献；人武、地武封顶必须在全局而非逐套路结算。 */
function contribution(items) {
  const value = calculateWuxingContribution(items);
  return [value.rawHuman, value.rawEarth, value.heaven];
}

function add(left, right) {
  return left.map((value, index) => value + right[index]);
}

function total(value) {
  return Math.min(value[0], 10) + Math.min(value[1], 10) + value[2];
}

/** 在实际投入上物化境界，避免把映射境界或零修为门槛当成可随意降低的等级。 */
function materialize(source, stages) {
  const item = structuredClone(source);
  item.system.moves = (item.system.moves || []).map(move => {
    const investment = xpForMoveStage(item, move, isFormalMove(move) ? stages.get(move.id) || 0 : 1);
    const xp = investment?.xp || 0;
    return { ...move, xpInvested: xp, sourceBreakdown: { general: 0, specific: xp }, ...deriveMoveProgress(item, move, xp) };
  });
  return item;
}

function representativeMoves(moves) {
  const first = selectRepresentativeMove(moves, () => 0);
  if (!first) return [];
  // 复用正式代表招式优先级：将同优先级的候选置首，只有能被选中的才属于该组。
  return moves.filter(move => selectRepresentativeMove([move, ...moves.filter(other => other !== move)], () => 0)?.id === move.id);
}

/**
 * 枚举一套武学的最低合法分配；只枚举目标境界、核心和达到目标的一招，不枚举所有招式的笛卡尔积。
 * @param {object} source - 规则来源快照。
 * @param {object} options - target 可为空；locked 为明确单招锁定，matches 为代表招式筛选器。
 * @returns {object[]} 含最小投入和可升级范围的分配方案；空数组表示这些硬条件无法同时满足。
 */
export function minimumMovePlans(source, { target = null, strategy = "independent", locked = {}, matches = () => true } = {}) {
  const formal = (source.system?.moves || []).filter(isFormalMove);
  const allTargets = [...new Set(formal.flatMap(move => moveStageChoices(source, move)))].sort((a, b) => a - b);
  const targets = target == null ? allTargets : [target];
  const plans = [];
  const seen = new Set();
  for (const maximum of targets) {
    const choices = new Map(formal.map(move => [move.id, moveStageChoices(source, move, maximum)]));
    const base = new Map(formal.map(move => [move.id,
      Object.hasOwn(locked, move.id) ? Number(locked[move.id]) : choices.get(move.id)[0] || 0
    ]));
    if (formal.some(move => Object.hasOwn(locked, move.id)
      && (base.get(move.id) > maximum || (base.get(move.id) > 0 && !choices.get(move.id).includes(base.get(move.id)))))) continue;
    const unlocked = formal.filter(move => !Object.hasOwn(locked, move.id));
    const cores = strategy === "core"
      ? representativeMoves(materialize(source, base).system.moves.filter(move => unlocked.some(entry => entry.id === move.id)))
      : [null];
    for (const core of cores.length ? cores : [null]) {
      const stages = new Map(base);
      for (const move of unlocked) {
        if (strategy === "uniform" || (core && move.id === core.id)) stages.set(move.id, choices.get(move.id).at(-1) || 0);
      }
      const prepared = materialize(source, stages);
      const hasTarget = prepared.system.moves.some(move => isFormalMove(move) && move.computedLevel > 0 && move.effectiveStage === maximum);
      const witnesses = hasTarget ? [null] : unlocked.filter(move => choices.get(move.id).includes(maximum));
      for (const witness of witnesses) {
        const assigned = new Map(stages);
        if (witness) assigned.set(witness.id, maximum);
        const item = materialize(source, assigned);
        const moves = item.system.moves.filter(isFormalMove);
        if (moves.some(move => move.computedLevel > 0 && move.effectiveStage > maximum)
          || !moves.some(move => move.computedLevel > 0 && move.effectiveStage === maximum)
          || moves.some(move => Object.hasOwn(locked, move.id) && Number(locked[move.id]) > 0
            && move.effectiveStage !== Number(locked[move.id]))) continue;
        const representatives = core
          ? moves.filter(move => move.id === core.id && move.computedLevel > 0)
          : representativeMoves(moves);
        const matching = representatives.filter(matches);
        if (representatives.length && !matching.length) continue;
        const signature = JSON.stringify([maximum, core?.id, [...assigned]]);
        if (seen.has(signature)) continue;
        seen.add(signature);
        plans.push({ item, target: maximum, coreId: core?.id || null, stages: assigned, choices, locked, representatives: matching, cost: contribution([item]) });
      }
    }
  }
  return plans;
}

/**
 * 在所有套路最低需求已预留后随机升级；每次只抽仍满足全局上限的境界，不先超限再降级。
 * @param {object[]} allocations - 已选中的最低分配方案。
 * @param {number|null} limit - 全局招式贡献上限，null 表示不限。
 * @param {string} strategy - uniform/core/independent。
 * @param {Function} rng - 请求级 RNG。
 * @returns {object[]} 已准备的武学快照。
 */
function randomizeAllocations(allocations, limit, strategy, rng) {
  let used = allocations.reduce((sum, plan) => add(sum, plan.cost), [0, 0, 0]);
  const items = allocations.map(plan => structuredClone(plan.item));
  // 打乱处理顺序，避免固定排在前面的套路总是先占完可用预算；上限不作为必须填满的目标。
  const entries = allocations.flatMap((plan, index) => plan.item.system.moves.filter(isFormalMove)
    .filter(move => !Object.hasOwn(plan.locked, move.id))
    .map(move => ({ plan, index, move })));
  for (const { plan, index, move } of shuffled(entries, rng)) {
    if (strategy === "uniform" || (strategy === "core" && plan.coreId === move.id)) continue;
    let choices = plan.choices.get(move.id) || [];
    if (strategy === "core" && plan.coreId) {
      const below = choices.filter(stage => stage < plan.target);
      if (below.length && plan.stages.get(move.id) < plan.target) choices = below;
    }
    const minimum = plan.stages.get(move.id);
    const legal = choices.filter(stage => stage >= minimum).filter(stage => {
      const trial = new Map(plan.stages);
      trial.set(move.id, stage);
      const item = materialize(plan.item, trial);
      const cost = contribution([item]);
      return limit == null || total(add(used, cost.map((value, key) => value - plan.cost[key]))) <= limit;
    });
    const stage = choose(legal, rng);
    if (stage == null) continue;
    plan.stages.set(move.id, stage);
    const item = materialize(plan.item, plan.stages);
    const cost = contribution([item]);
    used = add(used, cost.map((value, key) => value - plan.cost[key]));
    plan.cost = cost;
    items[index] = item;
  }
  return items.map((item, index) => {
    const plan = allocations[index];
    const ids = new Set(plan.representatives.map(move => move.id));
    item._generationTargetStage = plan.target;
    item._generationCore = choose(item.system.moves.filter(move => ids.has(move.id)), rng);
    item._generationConflicts = [];
    return item;
  });
}

/**
 * 以稳定配置槽位缓存两次独立投骰；rolls 须在同一个人物的候选搜索间复用，返回 [0,1) 投骰及启用标记。
 */
export function generationMatchDecision(config, slotKey, rolls, rng) {
  const probability = (config.synergyProbability ?? 100) / 100;
  const result = {};
  for (const relation of ["compatibility", "scaling"]) {
    const key = `wuxue:${slotKey}:${relation}`;
    if (!rolls.has(key)) rolls.set(key, Math.min(0.9999999999999999, Math.max(0, rng())));
    result[`${relation}Roll`] = rolls.get(key);
    result[`${relation}Applied`] = rolls.get(key) < probability;
  }
  return result;
}

/** 从运行内功快照的实际投入读取阶段属性；返回配置属性，最终仍由真实 Actor 派生复核。 */
export function generationNeigongStats(run) {
  const system = run?.system || {};
  const tier = Number(system.tier) || 1;
  const raw = tier === 1 ? [0, 1000, 3000] : tier === 2 ? [1000, 4000, 10000] : [2000, 12000, 30000];
  let threshold = 0;
  let stage = 0;
  for (let index = 0; index < 3; index += 1) {
    threshold += (raw[index] - (raw[index - 1] || 0)) * (system.config?.[`stage${index + 1}`]?.xpCostRatio ?? 1);
    if (Number(system.xpInvested) >= Math.floor(threshold)) stage = index + 1;
  }
  return system.config?.[`stage${stage}`]?.stats || {};
}

/**
 * 为独立主修模型联合选择资源和最低境界，再在合法预算内随机成长。
 * @param {object} snapshot - 当前范围与规范化配置。
 * @param {object} context - 最终运行内功、稳定配套投骰；不传内功时只约束数量、境界和悟性。
 * @returns {{selected:object[],primary:object|null,conflicts:object[]}} 搜索预算耗尽与可证明的条件冲突分别报告。
 */
export function planGenerationWuxue(snapshot, config, rng, { runNeigong = null, decisionRolls = new Map() } = {}) {
  const pool = snapshot.pools.wuxue || [];
  const fixed = config.wuxue.fixed || {};
  const primaryId = config.wuxue.primary?.uuid || fixed.wuxue?.[0] || null;
  const healingIds = new Set(config.wuxue.healingUuids || []);
  const fixedIds = new Set([primaryId, ...healingIds,
    ...["sanshou", "qinggong", "zhenfa"].flatMap(category => fixed[category] || [])].filter(Boolean));
  if (!decisionRolls.has("wuxue:additional:count")) decisionRolls.set("wuxue:additional:count", Math.min(0.9999999999999999, Math.max(0, rng())));
  const randomCount = config.wuxue.additionalRandomMin + Math.min(
    config.wuxue.additionalRandomMax - config.wuxue.additionalRandomMin,
    Math.floor(decisionRolls.get("wuxue:additional:count") * (config.wuxue.additionalRandomMax - config.wuxue.additionalRandomMin + 1))
  );
  const slots = [{ category: "wuxue", tier: config.wuxue.primary.tier, primary: true,
    fixedId: primaryId, field: "wuxue.primary", target: config.wuxue.primary.stage }];
  for (const tier of [1, 2, 3]) {
    for (let index = 0; index < config.wuxue.additionalTierCounts[tier]; index += 1) {
      slots.push({ category: "wuxue", tier, field: `wuxue.additionalTierCounts.${tier}` });
    }
  }
  for (let index = 0; index < randomCount; index += 1) slots.push({ category: "wuxue", tier: null, field: "wuxue.additionalRandomMax" });
  for (const category of ["sanshou", "qinggong", "zhenfa"]) {
    const count = config.wuxue[`${category}Count`];
    for (let index = 0; index < count; index += 1) slots.push({ category, tier: null,
      fixedId: fixed[category]?.[index] || null, target: ["qinggong", "zhenfa"].includes(category) ? 1 : null,
      field: `wuxue.${category}Count` });
  }
  const conflicts = [];
  if ((fixed.wuxue || []).length > 1) conflicts.push({ type: "condition", field: "wuxue.primary", reason: "主修武学只能指定一套", expected: 1, actual: fixed.wuxue.length });
  for (const category of ["sanshou", "qinggong", "zhenfa"]) {
    if ((fixed[category] || []).length > config.wuxue[`${category}Count`]) conflicts.push({ type: "condition", field: `wuxue.${category}Count`, reason: "指定资源数量超过该分类槽位", expected: config.wuxue[`${category}Count`], actual: fixed[category].length });
  }
  const limit = config.wuxue.wuxingLimit;
  const stats = generationNeigongStats(runNeigong);
  const threshold = GENERATION_MATCH_THRESHOLDS[config.matchStandard] || GENERATION_MATCH_THRESHOLDS.standard;
  const requiredHealing = config.wuxue.healingRequired ? config.wuxue.healingCount : 0;
  const cache = new Map();
  for (const [index, slot] of slots.entries()) {
    slot.index = index;
    slot.slotKey = `${slot.category}:${index}`;
    const decision = generationMatchDecision(config, slot.slotKey, decisionRolls, rng);
    const candidates = pool.filter(item => item.system?.category === slot.category
      && (slot.tier == null || Number(item.system?.tier) === slot.tier)
      && (!slot.fixedId || resourceIdentity(item) === slot.fixedId));
    slot.options = [];
    for (const source of candidates) {
      const id = resourceIdentity(source);
      if (!slot.fixedId && fixedIds.has(id) && !healingIds.has(id)) continue;
      const enforce = Boolean(runNeigong) && (slot.primary || config.matchAllRandomWuxue)
        && !(fixedIds.has(id) && (!slot.primary || config.neigong.runUuid));
      const key = JSON.stringify([id, slot.target, enforce && decision.compatibilityApplied, enforce && decision.scalingApplied]);
      if (!cache.has(key)) {
        const matches = move => {
          if (!enforce) return true;
          const match = evaluateMoveCompatibility(runNeigong, move, { matchStandard: config.matchStandard, actorStats: stats });
          return (!decision.compatibilityApplied || match.compatibility == null || match.compatibility >= threshold.compatibility)
            && (!decision.scalingApplied || match.scaling == null || match.scaling >= threshold.scaling);
        };
        cache.set(key, minimumMovePlans(source, { target: slot.target ?? null, strategy: config.wuxue.allocation,
          locked: fixed.moves?.[id] || {}, matches }));
      }
      for (const plan of cache.get(key)) {
        slot.options.push({ ...plan, sourceId: id, healing: countLearnedHealing([plan.item]).count > 0 });
      }
    }
    slot.options = shuffled(slot.options, rng);
    slot.sourceIds = [...new Set(slot.options.map(option => option.sourceId))];
    if (!slot.options.length) conflicts.push({ type: slot.fixedId && !candidates.length ? "source" : "condition", field: slot.field,
      reason: !candidates.length ? "当前范围没有满足指定资源、分类和品阶的候选" : "当前范围没有同时满足境界、单招锁定和配套要求的候选",
      expected: slot.fixedId || 1, actual: 0, resources: slot.fixedId ? [slot.fixedId] : [] });
  }
  for (const id of healingIds) {
    if (!slots.some(slot => slot.options.some(option => option.sourceId === id && option.healing))) conflicts.push({
      type: "condition", field: "wuxue.healingUuids", reason: "指定治疗武学没有符合条件的数量槽位或可学治疗招式", expected: id, actual: null, resources: [id]
    });
  }
  if (conflicts.length) return { selected: [], primary: null, conflicts };
  const ordered = [...slots].sort((a, b) => Number(Boolean(b.fixedId)) - Number(Boolean(a.fixedId))
    || a.sourceIds.length - b.sourceIds.length);
  const selected = new Map();
  const used = new Set();
  let visited = 0;
  let exhausted = false;
  let lowestRejected = Infinity;
  // 完全相同贡献状态只保留一个失败分支；资源身份仍进入键，不能把不同的稀缺资源混为同一状态。
  const failed = new Set();
  const walk = (position, cost, healing, specifiedHealing) => {
    if (++visited > 50000) { exhausted = true; return false; }
    if (position === ordered.length) return healing >= requiredHealing && specifiedHealing.size === healingIds.size;
    const key = JSON.stringify([position, cost.map((value, index) => index < 2 ? Math.min(value, 10) : value), [...used].sort(), healing, [...specifiedHealing].sort()]);
    if (failed.has(key)) return false;
    const remaining = ordered.slice(position);
    if (healing + remaining.filter(slot => slot.options.some(option => !used.has(option.sourceId) && option.healing)).length < requiredHealing
      || [...healingIds].some(id => !specifiedHealing.has(id) && !remaining.some(slot => slot.options.some(option => option.sourceId === id && option.healing)))) return false;
    // 用二分图匹配检查后续槽位是否仍有不同资源可用，避免通配槽位抢走唯一的精确品阶候选。
    const owners = new Map();
    const reserve = (slot, seen) => {
      for (const id of slot.sourceIds) {
        if (used.has(id) || seen.has(id)) continue;
        seen.add(id);
        if (!owners.has(id) || reserve(owners.get(id), seen)) { owners.set(id, slot); return true; }
      }
      return false;
    };
    if (!remaining.every(slot => reserve(slot, new Set()))) return false;
    // 给所有剩余槽位预留一个保守下界；按维度取最小值可能低估成本，但绝不会错误剪掉合法组合。
    if (limit != null) {
      let minimum = [...cost];
      for (const pending of remaining) {
        const lower = [Infinity, Infinity, Infinity];
        for (const option of pending.options) {
          if (used.has(option.sourceId)) continue;
          for (let index = 0; index < 3; index += 1) lower[index] = Math.min(lower[index], option.cost[index]);
        }
        minimum = add(minimum, lower);
      }
      if (total(minimum) > limit) {
        lowestRejected = Math.min(lowestRejected, total(minimum));
        return false;
      }
    }
    const slot = ordered[position];
    for (const option of slot.options) {
      if (used.has(option.sourceId)) continue;
      const next = add(cost, option.cost);
      if (limit != null && total(next) > limit) { lowestRejected = Math.min(lowestRejected, total(next)); continue; }
      selected.set(slot.index, option);
      used.add(option.sourceId);
      const specified = new Set(specifiedHealing);
      if (option.healing && healingIds.has(option.sourceId)) specified.add(option.sourceId);
      if (walk(position + 1, next, healing + Number(option.healing), specified)) return true;
      selected.delete(slot.index);
      used.delete(option.sourceId);
      if (exhausted) return false;
    }
    failed.add(key);
    return false;
  };
  if (!walk(0, [0, 0, 0], 0, new Set())) {
    return { selected: [], primary: null, conflicts: [{ type: exhausted ? "budget" : "condition",
      field: exhausted ? "generation" : Number.isFinite(lowestRejected) ? "wuxue.wuxingLimit" : "wuxue.primary",
      reason: exhausted ? "约束搜索达到预算，尚不能确定配置是否有解" : Number.isFinite(lowestRejected)
        ? "指定境界、数量和可学招式的最低贡献无法同时满足悟性上限" : "当前范围无法同时满足不同资源数量、配套和治疗要求",
      expected: exhausted ? 50000 : Number.isFinite(lowestRejected) ? limit : "满足全部硬条件", actual: exhausted ? visited : null }] };
  }
  const allocations = slots.map(slot => {
    const option = selected.get(slot.index);
    return { ...option, stages: new Map(option.stages), cost: [...option.cost] };
  });
  const items = randomizeAllocations(allocations, limit, config.wuxue.allocation, rng);
  return { selected: items, primary: items[0] || null, conflicts: [] };
}
