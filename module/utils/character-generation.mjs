/**
 * 随机人物生成器的纯规则层。
 *
 * 这里不读取 game、CONFIG 或 Document，所有函数只接收普通对象并接受可注入
 * RNG。这样浏览器候选搜索不会触发 Actor 派生，Node 回归也能覆盖实际投入、
 * 治疗招式、悟性和经脉资格的边界。
 */

export const CHARACTER_GENERATION_VERSION = 1;

export const GENERATION_MATCH_THRESHOLDS = Object.freeze({
  loose: Object.freeze({ compatibility: 0.5, scaling: 0.5 }),
  standard: Object.freeze({ compatibility: 0.5, scaling: 0.7 }),
  strict: Object.freeze({ compatibility: 1, scaling: 0.9 })
});

export const GENERATION_STATS = Object.freeze([
  "liliang", "shenfa", "neixi", "qigan", "shencai"
]);

export const ARMOR_TYPES = Object.freeze([
  "head", "top", "bottom", "shoes", "ring", "earring", "necklace", "accessory"
]);

// 与 Item.toggleEquip 的同部位限制保持一致；随机补齐必须遵守这些上限，避免预览与实际装备结果不同。
export const ARMOR_SLOT_LIMITS = Object.freeze({
  head: 1, top: 1, bottom: 1, shoes: 1, ring: 2, earring: 1, necklace: 1, accessory: 6
});

const RANDOM_ADDITIONAL_NEIGONG_MAX = 3;

export const MERIDIAN_DEFINITIONS = Object.freeze([
  { key: "hand_shaoyin", tier: 1, element: "yin" },
  { key: "foot_shaoyin", tier: 1, element: "yin" },
  { key: "hand_shaoyang", tier: 1, element: "yang" },
  { key: "foot_shaoyang", tier: 1, element: "yang" },
  { key: "hand_jueyin", tier: 2, element: "yin" },
  { key: "foot_jueyin", tier: 2, element: "yin" },
  { key: "hand_yangming", tier: 2, element: "yang" },
  { key: "foot_yangming", tier: 2, element: "yang" },
  { key: "hand_taiyin", tier: 3, element: "yin" },
  { key: "foot_taiyin", tier: 3, element: "yin" },
  { key: "hand_taiyang", tier: 3, element: "yang" },
  { key: "foot_taiyang", tier: 3, element: "yang" }
]);

const MERIDIAN_BY_KEY = new Map(MERIDIAN_DEFINITIONS.map(definition => [definition.key, definition]));

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, fallback = 0) {
  return Math.trunc(finiteNumber(value, fallback));
}

function choose(rng, values) {
  if (!values.length) return undefined;
  const value = finiteNumber(rng?.(), Math.random());
  const index = Math.min(values.length - 1, Math.max(0, Math.floor(value * values.length)));
  return values[index];
}

/**
 * 创建可复现的轻量 RNG；生产环境可直接传 Math.random，回归测试传固定种子。
 * @param {number|string} seed - 任意有限种子或字符串种子。
 * @returns {() => number} 返回 [0, 1) 的随机函数。
 */
export function createSeededRng(seed = Date.now()) {
  let state = typeof seed === "number" ? integer(seed, 1) >>> 0 : 2166136261;
  if (typeof seed !== "number") {
    for (const char of String(seed)) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state = Math.imul(state ^ state >>> 15, 1 | state);
    state ^= state + Math.imul(state ^ state >>> 7, 61 | state);
    return ((state ^ state >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * 将 UI/宏输入规范化为冻结前可比较的配置形状。
 * @param {object} input - 用户配置；未知字段保留在范围快照之外，避免污染契约。
 * @returns {object} 可安全用于生成请求的普通配置对象。
 */
export function normalizeGenerationConfig(input = {}) {
  const source = input || {};
  const quantity = integer(source.quantity, 1);
  const synergyProbability = finiteNumber(source.synergyProbability, 100);
  const matchStandard = ["loose", "standard", "strict"].includes(source.matchStandard)
    ? source.matchStandard : "standard";
  const normalizeRange = range => ({
    filters: clone(range?.filters || {}),
    query: String(range?.query || "").trim()
  });
  const neigong = source.neigong || {};
  const wuxue = source.wuxue || {};
  const jingmai = source.jingmai || {};
  const equipment = source.equipment || {};
  const armorTypes = [...new Set((equipment.armorTypes || []).filter(type => ARMOR_TYPES.includes(type)))];
  const rawArmorTypeCounts = equipment.armorTypeCounts && typeof equipment.armorTypeCounts === "object"
    ? equipment.armorTypeCounts : {};
  const armorTypeCounts = Object.fromEntries(armorTypes.map(type => [
    type, Math.min(ARMOR_SLOT_LIMITS[type], Math.max(1, integer(rawArmorTypeCounts[type], 1)))
  ]));
  const requiredArmorCount = Object.values(armorTypeCounts).reduce((sum, count) => sum + count, 0);
  const rawAdditionalGroups = Array.isArray(neigong.additionalGroups) ? neigong.additionalGroups : [];
  const hasAdditionalCount = Object.prototype.hasOwnProperty.call(neigong, "additionalCount");
  const legacyAdditionalCount = rawAdditionalGroups.length
    ? rawAdditionalGroups.reduce((sum, group) => sum + Math.max(0, integer(group?.count, 0)), 0)
    : null;
  const rawAdditionalCount = hasAdditionalCount ? neigong.additionalCount : legacyAdditionalCount;
  const legacyAdditionalMode = neigong.additionalCountMode === "fixed"
    || (neigong.additionalCountMode === undefined && rawAdditionalCount != null && rawAdditionalCount !== "" && rawAdditionalCount !== "random")
    ? "fixed" : "random";
  const additionalCount = legacyAdditionalMode === "fixed"
    ? Math.min(10, Math.max(0, integer(rawAdditionalCount, 0)))
    : neigong.additionalCountMode === undefined
      ? Math.min(10, Math.max(0, integer(neigong.additionalCount, 0)))
      : 0;
  const additionalRandomMin = Math.min(10, Math.max(0, integer(neigong.additionalRandomMin, 0)));
  const additionalRandomMax = Math.min(10, Math.max(additionalRandomMin, Math.max(0, integer(
    neigong.additionalRandomMax,
    legacyAdditionalMode === "random"
      ? rawAdditionalCount == null || rawAdditionalCount === "" || rawAdditionalCount === "random"
        ? RANDOM_ADDITIONAL_NEIGONG_MAX : rawAdditionalCount
      : 0
  ))));
  const mainTier = [1, 2, 3].includes(integer(wuxue.mainTier, 1)) ? integer(wuxue.mainTier, 1) : 1;
  const hasMainTierCounts = wuxue.mainTierCounts && typeof wuxue.mainTierCounts === "object";
  const mainTierCounts = Object.fromEntries([1, 2, 3].map(tier => [
    String(tier), Math.max(0, integer(
      hasMainTierCounts ? wuxue.mainTierCounts[tier] : tier === mainTier ? wuxue.mainCount : 0,
      0
    ))
  ]));
  const mainCount = Object.values(mainTierCounts).reduce((sum, count) => sum + count, 0);
  const primarySource = wuxue.primary && typeof wuxue.primary === "object" ? wuxue.primary : null;
  const wuxueModel = primarySource ? "primary" : "legacy";
  const primaryTierValue = primarySource ? primarySource.tier : wuxue.mainTier;
  const primaryTier = primaryTierValue == null || primaryTierValue === ""
    || primaryTierValue === "random" ? null
    : [1, 2, 3].includes(integer(primaryTierValue, 0)) ? integer(primaryTierValue, 0) : 1;
  const primaryStageValue = primarySource ? primarySource.stage : wuxue.mainStage;
  const primaryStage = primaryStageValue == null || primaryStageValue === ""
    || primaryStageValue === "random" ? null
    : Math.min(4, Math.max(1, integer(primaryStageValue, 1)));
  const primaryUuid = primarySource?.uuid
    ? String(primarySource.uuid)
    : Array.isArray(wuxue.fixed?.wuxue) && wuxue.fixed.wuxue.length
      ? String(wuxue.fixed.wuxue[0]) : null;
  const additionalTierSource = wuxue.additionalTierCounts || wuxue.fixedTierCounts || wuxue.mainTierCounts;
  const additionalTierCounts = Object.fromEntries([1, 2, 3].map(tier => [
    String(tier), Math.max(0, integer(
      primarySource && additionalTierSource && typeof additionalTierSource === "object"
        ? additionalTierSource[tier] : primarySource ? 0 : mainTierCounts[String(tier)],
      0
    ))
  ]));
  const rawWuxueRandomMin = primarySource
    ? wuxue.additionalRandomMin ?? wuxue.mainRandomMin
    : wuxue.mainRandomMin;
  const rawWuxueRandomMax = primarySource
    ? wuxue.additionalRandomMax ?? wuxue.mainRandomMax
    : wuxue.mainRandomMax;
  const wuxueRandomMin = Math.min(20, Math.max(0, integer(rawWuxueRandomMin, 0)));
  const wuxueRandomMax = Math.min(20, Math.max(wuxueRandomMin, integer(rawWuxueRandomMax, 0)));
  const additionalWuxueCount = Object.values(additionalTierCounts).reduce((sum, count) => sum + count, 0);
  const runTierValue = neigong.runTier;
  const runTier = runTierValue == null || runTierValue === "" || runTierValue === "random"
    ? null
    : [1, 2, 3].includes(integer(runTierValue, 0)) ? integer(runTierValue, 0) : 1;
  const fixedSource = wuxue.fixed || {};
  const fixedByCategory = Object.fromEntries(["wuxue", "sanshou", "qinggong", "zhenfa"].map(category => [
    category, [...new Set((Array.isArray(fixedSource) && category === "wuxue"
      ? fixedSource : Array.isArray(fixedSource[category]) ? fixedSource[category] : []).filter(Boolean).map(String))]
  ]));
  const normalized = {
    requestId: String(source.requestId || ""),
    configVersion: CHARACTER_GENERATION_VERSION,
    namePrefix: String(source.namePrefix || "随机侠客"),
    quantity,
    actorType: source.actorType === "character" ? "character" : "npc",
    synergyProbability: Math.min(100, Math.max(0, synergyProbability)),
    matchStandard,
    matchAllRandomWuxue: source.matchAllRandomWuxue === true,
    neigong: {
      runUuid: neigong.runUuid || null,
      runTier,
      runStage: neigong.runStage == null || neigong.runStage === ""
        ? null : Math.min(3, Math.max(1, integer(neigong.runStage, 1))),
      runElement: ["auto", "yin", "yang", "taiji", "none"].includes(neigong.runElement)
        ? neigong.runElement : "auto",
      pool: normalizeRange(neigong.pool),
      additionalCountMode: legacyAdditionalMode,
      additionalCount,
      additionalRandomMin,
      additionalRandomMax,
      additionalGroups: rawAdditionalGroups.map((group, index) => ({
        id: String(group?.id || `additional-${index + 1}`),
        count: Math.max(0, integer(group?.count, 0)),
        tier: group?.tier == null || group.tier === "" || group.tier === "random"
          ? null
          : [1, 2, 3].includes(integer(group.tier, 0)) ? integer(group.tier, 0) : 1,
        stage: group?.stage == null || group.stage === ""
          ? null : Math.min(3, Math.max(1, integer(group.stage, 1))),
        uuids: [...new Set((group?.uuids || []).filter(Boolean).map(String))]
      })),
      supplementForJingmai: neigong.supplementForJingmai !== false
    },
    jingmai: {
      mode: ["none", "target", "max"].includes(jingmai.mode) ? jingmai.mode : "none",
      total: jingmai.total == null || jingmai.total === "" ? null : Math.max(0, integer(jingmai.total, 0)),
      yin: Math.max(0, integer(jingmai.yin, 0)),
      yang: Math.max(0, integer(jingmai.yang, 0)),
      fixed: [...new Set((Array.isArray(jingmai.fixed) ? jingmai.fixed : []).filter(key => MERIDIAN_BY_KEY.has(key)))],
      autoSupplement: jingmai.autoSupplement !== false,
      xuanguanBroken: jingmai.xuanguanBroken === true
    },
    wuxue: {
      model: wuxueModel,
      primary: { tier: primaryTier, stage: primaryStage, uuid: primaryUuid },
      mainCount: wuxueModel === "primary" ? 1 + additionalWuxueCount : mainCount,
      mainRandomMin: wuxueRandomMin,
      mainRandomMax: wuxueRandomMax,
      mainTierCounts: wuxueModel === "primary" ? additionalTierCounts : mainTierCounts,
      additionalTierCounts,
      additionalRandomMin: wuxueRandomMin,
      additionalRandomMax: wuxueRandomMax,
      mainTier: wuxueModel === "primary" ? (primaryTier || 1) : mainTier,
      mainStage: wuxueModel === "primary" ? primaryStage : primaryStageValue == null || primaryStageValue === ""
        ? null : Math.min(4, Math.max(1, integer(primaryStageValue, 1))),
      allocation: ["uniform", "core", "independent"].includes(wuxue.allocation)
        ? wuxue.allocation : "independent",
      // moves 不属于资源分类，但属于指定主修的单招锁定；必须随配置规范化保留，
      // 否则 UI 重新读取表单后会把锁定静默丢掉。
      fixed: { ...fixedByCategory, moves: clone(fixedSource.moves || {}) },
      fixedPreview: clone(wuxue.fixedPreview || null),
      mainPool: normalizeRange(wuxue.mainPool || wuxue.pool),
      sanshouCount: Math.max(0, integer(wuxue.sanshouCount, 0)),
      qinggongCount: Math.max(0, integer(wuxue.qinggongCount, 0)),
      zhenfaCount: Math.max(0, integer(wuxue.zhenfaCount, 0)),
      auxiliaryTier: [1, 2, 3].includes(integer(wuxue.auxiliaryTier, mainTier))
        ? integer(wuxue.auxiliaryTier, mainTier) : mainTier,
      healingRequired: wuxue.healingRequired === true,
      healingCount: Math.max(1, integer(wuxue.healingCount, 1)),
      healingUuids: [...new Set((wuxue.healingUuids || []).filter(Boolean).map(String))],
      wuxingLimit: wuxue.wuxingLimit == null || wuxue.wuxingLimit === ""
        ? null : Math.max(0, integer(wuxue.wuxingLimit, 0)),
      weaponType: wuxue.weaponType || "auto",
      pool: normalizeRange(wuxue.pool)
    },
    stats: {
      strategy: ["match", "random", "balanced", "output", "survival"].includes(source.stats?.strategy)
        ? source.stats.strategy : "balanced",
      freePoints: Math.max(0, integer(source.stats?.freePoints, 0))
    },
    equipment: {
      weaponUuid: equipment.weaponUuid || null,
      weaponQuality: Math.min(4, Math.max(0, integer(equipment.weaponQuality, 0))),
      armorQuality: Math.min(4, Math.max(0, integer(equipment.armorQuality, 0))),
      armorUuids: [...new Set((equipment.armorUuids || []).filter(Boolean).map(String))],
      armorMinCount: Math.max(requiredArmorCount, Math.max(0, integer(equipment.armorMinCount, 0))),
      armorTypes,
      armorTypeCounts,
      armorFillMode: equipment.armorFillMode === "random" ? "random" : "minimum",
      armorRandomExtraMax: Math.min(
        Object.values(ARMOR_SLOT_LIMITS).reduce((sum, limit) => sum + limit, 0),
        Math.max(0, integer(equipment.armorRandomExtraMax, 0))
      ),
      armorPool: normalizeRange(equipment.armorPool),
      weaponPool: normalizeRange(equipment.weaponPool)
    }
  };
  return normalized;
}

/**
 * 返回资源身份；同一次人物生成内所有去重都使用此函数，避免名称重名导致误判。
 * @param {object} resource - 索引项、文档快照或普通候选对象。
 * @returns {string} 稳定身份。
 */
export function resourceIdentity(resource) {
  return String(resource?.uuid || resource?._stats?.compendiumSource || resource?._id
    || resource?.id || `${resource?.type || "resource"}:${resource?.name || ""}`);
}

/**
 * 获取招式实际品阶。招式明确品阶优先，否则继承套路顶层品阶。
 * @param {object} item - 武学快照。
 * @param {object} move - 招式快照。
 * @returns {number} 1/2/3。
 */
export function getMoveTier(item, move) {
  const tier = integer(move?.tier ?? item?.system?.tier ?? item?.tier, 1);
  return [1, 2, 3].includes(tier) ? tier : 1;
}

/**
 * 判定招式是否为正式招式；mappedStage=5 的辅助操作不能影响套路境界、核心或悟性。
 * @param {object} move - 招式快照。
 * @returns {boolean} 是否正式。
 */
export function isFormalMove(move) {
  return integer(move?.progression?.mappedStage, 0) !== 5;
}

/**
 * 计算与现有 XJZLWuxueData 相同的累计修为门槛。
 * @param {object} item - 武学快照。
 * @param {object} move - 招式快照。
 * @returns {number[]} 每个实际等级的累计投入。
 */
export function getMoveThresholds(item, move) {
  const category = item?.system?.category ?? item?.category;
  const tier = getMoveTier(item, move);
  let standard;
  if (["qinggong", "zhenfa"].includes(category)) {
    standard = tier === 1 ? [1000] : tier === 2 ? [3000] : [6000];
  } else {
    standard = tier === 1 ? [0, 500, 1000] : tier === 2 ? [500, 1500, 3000] : [1000, 3000, 6000, 10000];
  }
  const progression = move?.progression || {};
  const base = progression.mode === "custom" && Array.isArray(progression.customThresholds)
    && progression.customThresholds.length ? progression.customThresholds : standard;
  const ratio = Math.max(0, finiteNumber(move?.xpCostRatio, 1));
  return base.map(value => Math.floor(Math.max(0, finiteNumber(value)) * ratio));
}

/**
 * 由实际投入计算招式等级和等效境界，口径与正式 DataModel 保持一致。
 * @param {object} item - 武学快照。
 * @param {object} move - 招式快照。
 * @param {number} xpInvested - 累计专属投入。
 * @returns {{computedLevel:number,maxLevel:number,effectiveStage:number,xpInvested:number,thresholds:number[]}}
 */
export function deriveMoveProgress(item, move, xpInvested = move?.xpInvested) {
  const thresholds = getMoveThresholds(item, move);
  const xp = Math.max(0, finiteNumber(xpInvested));
  let computedLevel = 0;
  for (let index = thresholds.length - 1; index >= 0; index -= 1) {
    if (xp >= thresholds[index]) {
      computedLevel = index + 1;
      break;
    }
  }
  if (!thresholds.length || xp < thresholds[0]) computedLevel = 0;
  const mappedStage = integer(move?.progression?.mappedStage, 0);
  const effectiveStage = mappedStage === 5 ? 0
    : computedLevel > 0 && mappedStage > 0 ? mappedStage : computedLevel;
  return { computedLevel, maxLevel: thresholds.length, effectiveStage, xpInvested: xp, thresholds };
}

/**
 * 获取某招式在指定境界以内可达到的最高实际等级，并反推最低投入。
 * @param {object} item - 武学快照。
 * @param {object} move - 招式快照。
 * @param {number} targetStage - 1 至 4；0 表示不学习。
 * @returns {{level:number,xp:number,stage:number}|null} 无合法等级时返回 null。
 */
export function xpForMoveStage(item, move, targetStage) {
  const target = Math.max(0, integer(targetStage));
  if (target === 0) return { level: 0, xp: 0, stage: 0 };
  if (!isFormalMove(move)) {
    const thresholds = getMoveThresholds(item, move);
    return thresholds.length ? { level: 1, xp: thresholds[0], stage: 0 } : null;
  }
  const thresholds = getMoveThresholds(item, move);
  const choices = [];
  for (let level = 1; level <= thresholds.length; level += 1) {
    const progress = deriveMoveProgress(item, move, thresholds[level - 1]);
    if (progress.effectiveStage > 0 && progress.effectiveStage <= target) {
      choices.push({ level, xp: thresholds[level - 1], stage: progress.effectiveStage });
    }
  }
  return choices.at(-1) || null;
}

/**
 * 返回招式实际存在且不超过目标的境界选项，避免 mappedStage 跳级时随机到不存在的中间境界。
 * @param {object} item - 武学快照。
 * @param {object} move - 招式快照。
 * @param {number} maximum - 允许的最高境界。
 * @returns {number[]} 去重并升序排列的实际可达境界。
 */
export function moveStageChoices(item, move, maximum = 4) {
  if (!isFormalMove(move)) return [];
  const thresholds = getMoveThresholds(item, move);
  return [...new Set(thresholds.map((threshold, index) => deriveMoveProgress(item, move, threshold).effectiveStage)
    .filter(stage => stage > 0 && stage <= maximum))].sort((left, right) => left - right);
}

/**
 * 返回招式实际可达的最高境界；辅助操作返回 0。
 * @param {object} item - 武学快照。
 * @param {object} move - 招式快照。
 * @returns {number} 0 至 4。
 */
export function maxMoveStage(item, move) {
  if (!isFormalMove(move)) return 0;
  return Math.max(0, ...moveStageChoices(item, move));
}

/**
 * 选择代表招式，顺序对应计划确认的实招/虚招/绝招/治疗优先级。
 * @param {object[]} moves - 已带 computedLevel 的实际招式。
 * @param {() => number} rng - 随机函数。
 * @returns {object|null} 代表招式，找不到时返回 null。
 */
export function selectRepresentativeMove(moves = [], rng = Math.random) {
  const learned = moves.filter(move => isFormalMove(move) && finiteNumber(move.computedLevel) > 0);
  const groups = [
    learned.filter(move => !move.isUltimate && (move.type === "real" || (move.type === "qi" && move.actionType === "attack"))),
    learned.filter(move => !move.isUltimate && (move.type === "feint" || move.type === "counter")),
    learned.filter(move => move.isUltimate && ["real", "qi", "feint", "counter"].includes(move.type)),
    learned.filter(move => move.type === "qi" && move.actionType === "heal")
  ];
  for (const group of groups) {
    const selected = choose(rng, group);
    if (selected) return selected;
  }
  return null;
}

/**
 * 为一套武学分配正式招式境界并写入最低投入，同时保留 mappedStage=5 的操作条目；核心优先策略
 * 在准备后按原招式 ID 保留核心身份，避免同优先级招式重新随机。
 * @param {object} item - 原始武学快照。
 * @param {{targetStage:number,strategy:string,locked?:object,rng?:Function}} options - 分配参数。
 * @returns {{item:object,moves:object[],core:object|null,conflicts:object[]}}
 */
export function allocateMoveStages(item, options = {}) {
  const rng = options.rng || Math.random;
  const source = clone(item);
  const system = source.system || source;
  const rawMoves = Array.isArray(system.moves) ? system.moves : [];
  const target = Math.max(1, Math.min(4, integer(options.targetStage, 1)));
  const strategy = options.strategy || "independent";
  const locked = options.locked || {};
  const conflicts = [];
  const formal = rawMoves.filter(isFormalMove);
  const maxStages = new Map(formal.map(move => [move.id, maxMoveStage(source, move)]));
  const stageChoices = new Map(formal.map(move => [move.id, moveStageChoices(source, move, target)]));
  const assigned = new Map();

  for (const move of formal) {
    if (!(move.id in locked)) continue;
    const requested = integer(locked[move.id], 0);
    if (requested > target) {
      conflicts.push({ type: "condition", field: `moves.${move.id}`, reason: "单招锁定境界高于套路目标", expected: target, actual: requested });
    } else {
      assigned.set(move.id, requested);
    }
  }

  const unlocked = formal.filter(move => !assigned.has(move.id));
  const coreCandidates = formal.filter(move => !assigned.has(move.id) && stageChoices.get(move.id)?.length);
  let core = selectRepresentativeMove(unlocked
    .filter(move => stageChoices.get(move.id)?.length)
    .map(move => ({ ...move, computedLevel: 1 })), rng);
  if (core && !coreCandidates.some(move => move.id === core.id)) core = null;

  const randomBelow = move => choose(rng, stageChoices.get(move.id) || []) || 0;
  for (const move of unlocked) {
    const choices = stageChoices.get(move.id) || [];
    let stage = 0;
    if (strategy === "uniform") stage = choices.at(-1) || 0;
    else if (strategy === "core" && core && move.id === core.id) stage = choices.at(-1) || 0;
    else if (strategy === "core" && core) {
      const below = choices.filter(value => value < target);
      stage = choose(rng, below.length ? below : choices) || 0;
    } else stage = randomBelow(move);
    assigned.set(move.id, stage);
  }

  const actualStage = moveId => assigned.get(moveId) || 0;
  const progressFor = (move, stage = actualStage(move.id)) => {
    const result = xpForMoveStage(source, move, stage);
    const xp = result?.xp || 0;
    return { ...deriveMoveProgress(source, move, xp), sourceResult: result };
  };
  // 不能把“请求了某个阶段”当成“实际达到了该阶段”：映射境界、零投入等级和
  // 自定义门槛都可能让请求值与最终派生值不同，锁定和套路目标必须以后者为准。
  const hasTarget = () => formal.some(move => {
    const progress = progressFor(move);
    return progress.computedLevel > 0 && progress.effectiveStage >= target;
  });
  if (!hasTarget() && strategy !== "uniform") {
    const upgradeable = unlocked.filter(move => (stageChoices.get(move.id) || []).includes(target));
    const selected = choose(rng, upgradeable);
    if (selected) assigned.set(selected.id, target);
  }
  const preparedMoves = rawMoves.map(rawMove => {
    if (!isFormalMove(rawMove)) {
      const result = xpForMoveStage(source, rawMove, 1);
      const xp = result?.xp || 0;
      return { ...rawMove, xpInvested: xp, sourceBreakdown: { general: 0, specific: xp }, ...deriveMoveProgress(source, rawMove, xp) };
    }
    const stage = actualStage(rawMove.id);
    const result = xpForMoveStage(source, rawMove, stage);
    if (!result) return { ...rawMove, xpInvested: 0, sourceBreakdown: { general: 0, specific: 0 }, ...deriveMoveProgress(source, rawMove, 0) };
    const xp = result.xp;
    return { ...rawMove, xpInvested: xp, sourceBreakdown: { general: 0, specific: xp }, ...deriveMoveProgress(source, rawMove, xp) };
  });
  for (const move of formal) {
    if (!(move.id in locked)) continue;
    const requested = integer(locked[move.id], 0);
    const prepared = preparedMoves.find(candidate => candidate.id === move.id);
    if (requested > 0 && (!prepared || prepared.computedLevel <= 0 || prepared.effectiveStage !== requested)) {
      conflicts.push({ type: "condition", field: `moves.${move.id}`, reason: "招式实际派生境界与锁定境界不一致", expected: requested, actual: prepared?.effectiveStage || 0 });
    }
  }
  const preparedHasTarget = preparedMoves.some(move => isFormalMove(move)
    && move.computedLevel > 0 && move.effectiveStage >= target);
  const preparedAboveTarget = preparedMoves.some(move => isFormalMove(move)
    && move.computedLevel > 0 && move.effectiveStage > target);
  if (!preparedHasTarget || preparedAboveTarget) {
    conflicts.push({ type: "condition", field: "wuxue.mainStage", reason: preparedAboveTarget ? "正式招式实际境界超过套路目标" : "武学没有正式招式能够达到目标境界", expected: target, actual: Math.max(0, ...preparedMoves.filter(isFormalMove).map(move => move.effectiveStage || 0)) });
  }
  system.moves = preparedMoves;
  source.system = system;
  // 核心优先的核心身份必须跨过“分配投入→派生准备”保持稳定；否则准备后再次随机
  // 可能把同优先级的另一招当成核心，连带改变配套判定和自动武器选择。
  const actualCore = strategy === "core" && core
    ? preparedMoves.find(move => move.id === core.id && isFormalMove(move) && finiteNumber(move.computedLevel) > 0) || null
    : selectRepresentativeMove(preparedMoves, rng);
  if (!actualCore && core) conflicts.push({ type: "condition", field: "wuxue.core", reason: "核心招式在实际投入后未学会", expected: core.name, actual: null });
  return { item: source, moves: preparedMoves, core: actualCore, conflicts };
}

/**
 * 判断招式是否为已学正式治疗招式。
 * @param {object} move - 已准备的招式。
 * @returns {boolean} 是否满足治疗硬条件。
 */
export function isLearnedHealingMove(move) {
  return isFormalMove(move) && finiteNumber(move.computedLevel) > 0
    && move.type === "qi" && move.actionType === "heal";
}

/**
 * 统计一批已准备武学中不同套路的实际治疗招式数量。
 * @param {object[]} items - 武学快照。
 * @returns {{count:number,items:object[]}} 治疗套路和招式摘要。
 */
export function countLearnedHealing(items = []) {
  const result = [];
  for (const item of items) {
    const moves = item.system?.moves || [];
    const healingMoves = moves.filter(isLearnedHealingMove);
    if (healingMoves.length) result.push({ item, moves: healingMoves });
  }
  return { count: result.length, items: result };
}

/**
 * 按当前角色模型的逐招口径计算悟性贡献；轻功和阵法明确排除，散手保留。
 * @param {object[]} items - 已写入实际投入的武学快照。
 * @returns {{total:number,human:number,earth:number,heaven:number,details:object[]}}
 */
export function calculateWuxingContribution(items = []) {
  let human = 0;
  let earth = 0;
  let heaven = 0;
  const details = [];
  for (const item of items) {
    const category = item.system?.category;
    if (["qinggong", "zhenfa"].includes(category)) continue;
    for (const move of item.system?.moves || []) {
      if (!isFormalMove(move) || finiteNumber(move.computedLevel) <= 0) continue;
      const tier = getMoveTier(item, move);
      const stage = finiteNumber(move.effectiveStage);
      let contribution = 0;
      if (stage >= 3 && tier === 1) { human += 1; contribution = 1; }
      if (stage >= 3 && tier === 2) { earth += 1; contribution = 1; }
      if (stage >= 3 && tier === 3) { heaven += 1; contribution = 1; }
      if (stage >= 4 && tier === 3) { heaven += 1; contribution += 1; }
      if (contribution) details.push({ item: resourceIdentity(item), move: move.id, tier, stage, contribution });
    }
  }
  const cappedHuman = Math.min(human, 10);
  const cappedEarth = Math.min(earth, 10);
  return { total: cappedHuman + cappedEarth + heaven, human: cappedHuman, earth: cappedEarth, heaven, rawHuman: human, rawEarth: earth, details };
}

function qualifiesForMeridian(source, definition) {
  const element = source.element || source.system?.element;
  return element === definition.element || element === "taiji";
}

/**
 * 从已圆满内功生成按关卡分组的开脉资格来源。
 * @param {object[]} neigongs - 内功选择结果。
 * @returns {object[]} 每个来源只为所属品阶提供一份资格。
 */
export function buildMeridianQualifications(neigongs = []) {
  return neigongs.flatMap(item => {
    const system = item.system || item;
    const tier = integer(system.tier ?? item.tier, 1);
    const stage = integer(system.stage ?? item.stage, 0);
    if (stage < 3 || ![1, 2, 3].includes(tier)) return [];
    return [{ id: resourceIdentity(item), name: item.name, tier, element: system.element || item.element || "none" }];
  });
}

function hasPriorMeridian(selected, tier) {
  if (tier === 1) return true;
  return MERIDIAN_DEFINITIONS.some(definition => definition.tier === tier - 1 && selected.has(definition.key));
}

function enumerateSubsets(target = {}) {
  const fixed = new Set(target.fixed || []);
  const definitions = MERIDIAN_DEFINITIONS;
  const subsets = [];
  for (let mask = 0; mask < (1 << definitions.length); mask += 1) {
    const selected = definitions.filter((_, index) => Boolean(mask & (1 << index))).map(definition => definition.key);
    const set = new Set(selected);
    if ([...fixed].some(key => !set.has(key))) continue;
    if (target.total != null && set.size !== integer(target.total)) continue;
    if (target.yin != null && selected.filter(key => MERIDIAN_BY_KEY.get(key).element === "yin").length !== integer(target.yin)) continue;
    if (target.yang != null && selected.filter(key => MERIDIAN_BY_KEY.get(key).element === "yang").length !== integer(target.yang)) continue;
    if (selected.some(key => !hasPriorMeridian(set, MERIDIAN_BY_KEY.get(key).tier))) continue;
    subsets.push(selected);
  }
  return subsets;
}

function assignTierQualifications(selected, sources, tier) {
  const nodes = selected.map(key => MERIDIAN_BY_KEY.get(key)).filter(definition => definition.tier === tier);
  const candidates = sources.filter(source => source.tier === tier);
  const assignments = [];
  const walk = (index, used, result) => {
    if (index >= nodes.length) { assignments.push({ ...result }); return; }
    const definition = nodes[index];
    for (const source of candidates) {
      if (used.has(source.id) || !qualifiesForMeridian(source, definition)) continue;
      used.add(source.id);
      result[definition.key] = { sourceId: source.id, sourceName: source.name, element: source.element };
      walk(index + 1, used, result);
      delete result[definition.key];
      used.delete(source.id);
    }
  };
  walk(0, new Set(), {});
  return assignments;
}

/**
 * 精确枚举十二正经合法子集，并为每一关分配不重复的阴/阳/太极资格。
 * @param {{sources:object[],target:object,rng?:Function,maximize?:boolean}} options - 求解参数。
 * @returns {{selected:string[],assignments:object,feasible:boolean,alternatives:number,reason?:string}}
 */
export function solveMeridians(options = {}) {
  const target = options.target || {};
  if (target.mode === "none") return { selected: [], assignments: {}, feasible: true, alternatives: 1 };
  const candidates = [];
  for (const selected of enumerateSubsets(target)) {
    const assignments = {};
    let feasible = true;
    for (const tier of [1, 2, 3]) {
      const results = assignTierQualifications(selected, options.sources || [], tier);
      if (!results.length) { feasible = false; break; }
      assignments[tier] = results[0];
    }
    if (feasible) candidates.push({ selected, assignments });
  }
  if (!candidates.length) {
    return { selected: [], assignments: {}, feasible: false, alternatives: 0, reason: "没有满足资格分配与逐关前置的合法经脉组合" };
  }
  const maxCount = Math.max(...candidates.map(candidate => candidate.selected.length));
  const pool = options.maximize ? candidates.filter(candidate => candidate.selected.length === maxCount) : candidates;
  const selected = choose(options.rng || Math.random, pool) || pool[0];
  return { ...selected, feasible: true, alternatives: pool.length, maxCount };
}

/**
 * 计算内功和代表招式的相性与属性适配；无法评价时显式返回 unevaluated。
 * @param {object|null} runNeigong - 运行内功快照。
 * @param {object|null} move - 代表招式快照。
 * @param {object} [options] - matchStandard 与 actorStats。
 * @returns {{status:string,compatibility:number|null,scaling:number|null,reason:string}}
 */
export function evaluateMoveCompatibility(runNeigong, move, options = {}) {
  if (!runNeigong || !move) return { status: "unevaluated", compatibility: null, scaling: null, reason: "缺少运行内功或代表招式" };
  const ngElement = runNeigong.system?.element || runNeigong.element;
  const moveElement = move.element;
  if (!ngElement || !moveElement) {
    return { status: "unevaluated", compatibility: null, scaling: null, reason: "缺少内功或招式属性" };
  }
  const full = ngElement === "yin" ? ["yin", "rou"] : ngElement === "yang" ? ["yang", "gang"] : ngElement === "taiji" ? ["taiji"] : [];
  // 只有阴/阳内功对太极招式有半相性；无属性内功不属于阴阳内功，不能套用该分支。
  const half = ngElement === "taiji" ? ["yin", "rou", "yang", "gang"]
    : ["yin", "yang"].includes(ngElement) ? ["taiji"] : [];
  const bonus = full.includes(moveElement) ? 0.2 : half.includes(moveElement) ? 0.1 : 0;
  const compatibility = bonus / 0.2;
  const scalings = Array.isArray(move.calculation?.scalings) ? move.calculation.scalings : [];
  const merged = new Map();
  for (const scaling of scalings) {
    const prop = scaling?.prop;
    const ratio = finiteNumber(scaling?.ratio, 0);
    if (GENERATION_STATS.includes(prop) && ratio > 0) merged.set(prop, (merged.get(prop) || 0) + ratio);
  }
  const direct = options.directOutputStats || GENERATION_STATS;
  const usable = [...merged.entries()].filter(([prop]) => direct.includes(prop));
  const stats = options.actorStats || {};
  const bonusFor = prop => Math.max(0, finiteNumber(stats[prop], 0));
  // 最高基准必须来自完整直接输出属性集合，而不是招式恰好引用的属性；
  // 否则纯内息招式会把内息自身误当成最高项，力量 70/内息 50 会错误得到 1。
  const maxBonus = Math.max(0, ...direct.map(prop => bonusFor(prop)));
  const denominator = usable.reduce((sum, [, ratio]) => sum + ratio, 0) * maxBonus;
  const scalingScore = denominator > 0
    ? usable.reduce((sum, [prop, ratio]) => sum + ratio * bonusFor(prop), 0) / denominator : null;
  const threshold = GENERATION_MATCH_THRESHOLDS[options.matchStandard || "standard"] || GENERATION_MATCH_THRESHOLDS.standard;
  // 相性与属性适配是两条独立约束。即使招式没有可读取的取值属性，已知的
  // 阴阳相冲仍然必须返回 mismatch，不能被“属性无法评价”掩盖。
  if (compatibility < threshold.compatibility) {
    return { status: "mismatch", compatibility, scaling: scalingScore, reason: "内功与招式相性低于匹配门槛" };
  }
  if (scalingScore == null) {
    return { status: "unevaluated", compatibility, scaling: null, reason: "缺少直接输出属性或运行内功没有非零属性加成" };
  }
  const status = compatibility >= threshold.compatibility && scalingScore >= threshold.scaling ? "match" : "mismatch";
  return { status, compatibility, scaling: scalingScore, reason: status === "match" ? "达到匹配门槛" : "低于匹配门槛" };
}

/**
 * 根据策略把可用自由属性点分配到六维属性，缺少评价依据时均衡。
 * @param {{points:number,strategy?:string,preferred?:string[]}} options - 分点配置。
 * @returns {Record<string,number>} 各属性分配量。
 */
export function allocateAttributePoints(options = {}) {
  const points = Math.max(0, integer(options.points, 0));
  const result = Object.fromEntries(GENERATION_STATS.concat("tipo").map(key => [key, 0]));
  const strategy = options.strategy || "balanced";
  const preferred = (options.preferred || []).filter(key => key in result);
  const order = strategy === "survival" ? ["tipo", "neixi", "qigan"]
    : strategy === "output" ? (preferred.length ? preferred : ["liliang", "qigan", "neixi"])
      : strategy === "match" ? (preferred.length ? preferred : Object.keys(result))
        : Object.keys(result);
  if (strategy === "random") {
    for (let index = 0; index < points; index += 1) {
      const stat = choose(options.rng || Math.random, order);
      if (stat) result[stat] += 1;
    }
    return result;
  }
  for (let index = 0; index < points; index += 1) result[order[index % order.length]] += 1;
  return result;
}

/**
 * 生成属性/内功/武学/经脉条件的统一冲突记录，供 UI 直接展示。
 * @param {string} type - 冲突分类。
 * @param {string} field - 配置字段或槽位。
 * @param {string} reason - 人类可读原因。
 * @param {*} expected - 期望值。
 * @param {*} actual - 实际值。
 * @param {string[]} [resources] - 相关资源身份。
 * @returns {object} 标准冲突对象。
 */
export function makeGenerationConflict(type, field, reason, expected = null, actual = null, resources = []) {
  return { type, field, reason, expected, actual, resources: [...resources] };
}
