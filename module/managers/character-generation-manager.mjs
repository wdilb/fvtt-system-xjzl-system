import {
  ARMOR_SLOT_LIMITS,
  ARMOR_TYPES,
  CHARACTER_GENERATION_VERSION,
  GENERATION_STATS,
  GENERATION_MATCH_THRESHOLDS,
  MERIDIAN_DEFINITIONS,
  allocateAttributePoints,
  allocateMoveStages,
  buildMeridianQualifications,
  calculateWuxingContribution,
  countLearnedHealing,
  createSeededRng,
  deriveMoveProgress,
  evaluateMoveCompatibility,
  getMoveThresholds,
  isFormalMove,
  maxMoveStage,
  moveStageChoices,
  normalizeGenerationConfig,
  resourceIdentity,
  solveMeridians
} from "../utils/character-generation.mjs";
import { generationMatchDecision, planGenerationWuxue } from "../utils/character-generation-planner.mjs";

// 旧模型和武器配套保留有限回溯；新模型的悟性与内功配套在纯构筑器内约束选择。
// 搜索预算耗尽只说明尚未找到组合，不能声称用户的配置无解。
const GENERATION_MAX_ATTEMPTS = 8;
const RUNTIME_KEYS = new Set([
  "stage", "current", "progressData", "computedTier", "computedLevel", "maxLevel",
  "effectiveStage", "progress", "currentCost", "baseFeint", "formulaFields"
]);

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback = 0) {
  return Math.trunc(number(value, fallback));
}

/**
 * 读取并缓存本次生成的关系判定；回溯更换候选时按稳定槽位和关系类型复用同一投骰。
 * @param {Map<string, number>} rolls - 当前生成请求的判定缓存。
 * @param {string} key - 稳定关系槽位。
 * @param {Function} rng - 当前请求 RNG。
 * @returns {number} [0, 1) 范围内的判定值。
 */
function getDecisionRoll(rolls, key, rng) {
  if (!rolls.has(key)) rolls.set(key, Math.min(0.9999999999999999, Math.max(0, number(rng?.(), 0))));
  return rolls.get(key);
}

function relationDecisionKey(decision, relation) {
  const raw = String(decision?.slotKey || `wuxue:${decision?.slot || "unknown"}`);
  const base = raw.replace(/:(compatibility|scaling)$/, "");
  return `${base}:${relation}`;
}

/**
 * 在包含上下限的整数区间取值；把注入 RNG 的边界值收敛到 [0, 1)，保证测试 RNG=1 时仍不会越界。
 * @param {Function} rng - 返回随机数的函数。
 * @param {number} min - 包含的下限。
 * @param {number} max - 包含的上限。
 * @returns {number} 区间内整数。
 */
function randomInteger(rng, min, max) {
  const lower = integer(min, 0);
  const upper = Math.max(lower, integer(max, lower));
  const ratio = Math.min(0.9999999999999999, Math.max(0, number(rng?.(), 0)));
  return lower + Math.floor(ratio * (upper - lower + 1));
}

function randomId() {
  return globalThis.foundry?.utils?.randomID?.() || `xjzl-${Math.random().toString(36).slice(2, 12)}`;
}

function stripRuntimeFields(value, type = "") {
  const result = clone(value || {});
  if (!result || typeof result !== "object") return result;
  for (const key of RUNTIME_KEYS) delete result[key];
  if (type === "wuxue" && Array.isArray(result.moves)) {
    result.moves = result.moves.map(move => stripRuntimeFields(move));
  }
  return result;
}

function sourceObject(document) {
  const source = clone(document?._source || document?.toObject?.() || document || {});
  source.type ??= document?.type;
  source.name ??= document?.name;
  source.img ??= document?.img;
  source.uuid ??= document?.uuid;
  source.system = stripRuntimeFields(source.system, source.type);
  if (source.type === "wuxue" && Array.isArray(document?.system?.moves)) {
    source.system.moves = (source.system.moves || []).map((move, index) => ({
      ...move,
      id: move.id || document.system.moves[index]?.id || randomId()
    }));
  }
  const effects = document?.effects?.contents || document?.effects;
  if (Array.isArray(effects)) {
    source.effects = effects.map(effect => clone(effect.toObject?.() || effect));
  }
  return source;
}

function rangeSnapshot(browser, tab, range) {
  if (typeof browser.getResourceRangeSnapshot === "function") {
    return browser.getResourceRangeSnapshot(tab, range || {});
  }
  const filters = Object.fromEntries(Object.entries(range?.filters || {}).map(([key, values]) => [
    key, values instanceof Set ? values : new Set(values || [])
  ]));
  return (browser.cachedData?.[tab] || []).filter(item => browser._filterItems(item ? [item] : [], filters, range?.query || "").length);
}

function sourceId(document) {
  return document?.uuid || document?._id || document?.id;
}

/**
 * 取得跨来源复制仍稳定的来源 UUID；嵌入 Actor 后普通 uuid 会变成 Actor.Item.uuid，
 * 只能依赖 V14 schema 内的 _stats.compendiumSource 继续识别固定资源。
 * @param {object} document - 索引项、来源文档或嵌入 Item。
 * @returns {string|null} 原始来源 UUID。
 */
function sourceCompendiumId(document) {
  return document?._stats?.compendiumSource
    || document?._source?._stats?.compendiumSource
    || document?.uuid
    || document?._source?.uuid
    || null;
}

function byIdentity(candidates, identity) {
  if (!identity) return null;
  return candidates.find(candidate => sourceId(candidate) === identity || resourceIdentity(candidate) === identity) || null;
}

function dedupe(candidates) {
  const result = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const id = resourceIdentity(candidate);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(candidate);
  }
  return result.sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "zh"));
}

function validateRawNumber(value, field, conflicts, { min = -Infinity, max = Infinity, integerOnly = true } = {}) {
  if (value === undefined || value === null || value === "") return;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integerOnly && !Number.isInteger(parsed)) || parsed < min || parsed > max) {
    conflicts.push({
      type: "condition", field, reason: "输入必须是有限数值且处于允许范围",
      expected: `${integerOnly ? "整数且 " : ""}[${min}, ${max}]`, actual: value
    });
  }
}

function validateRawConfig(input = {}) {
  const conflicts = [];
  const source = input || {};
  const neigong = source.neigong || {};
  const jingmai = source.jingmai || {};
  const wuxue = source.wuxue || {};
  const stats = source.stats || {};
  const equipment = source.equipment || {};
  validateRawNumber(source.quantity, "quantity", conflicts, { min: 1, max: 20 });
  validateRawNumber(source.synergyProbability, "synergyProbability", conflicts, { min: 0, max: 100 });
  validateRawNumber(neigong.runTier, "neigong.runTier", conflicts, { min: 1, max: 3 });
  validateRawNumber(neigong.runStage, "neigong.runStage", conflicts, { min: 1, max: 3 });
  if (neigong.additionalCountMode && !["random", "fixed"].includes(neigong.additionalCountMode)) {
    conflicts.push({ type: "condition", field: "neigong.additionalCountMode", reason: "附修内功数量模式无效", expected: ["random", "fixed"], actual: neigong.additionalCountMode });
  }
  if (neigong.additionalCountMode !== "random" && neigong.additionalCount !== "random") {
    validateRawNumber(neigong.additionalCount, "neigong.additionalCount", conflicts, { min: 0, max: 10 });
  }
  validateRawNumber(neigong.additionalRandomMax, "neigong.additionalRandomMax", conflicts, { min: 0, max: 10 });
  validateRawNumber(neigong.additionalRandomMin, "neigong.additionalRandomMin", conflicts, { min: 0, max: 10 });
  if (neigong.additionalRandomMin !== undefined && neigong.additionalRandomMax !== undefined
    && Number(neigong.additionalRandomMin) > Number(neigong.additionalRandomMax)) {
    conflicts.push({ type: "condition", field: "neigong.additionalRandomMin", reason: "随机数量下限不能大于上限", expected: `<= ${neigong.additionalRandomMax}`, actual: neigong.additionalRandomMin });
  }
  for (const [index, group] of (Array.isArray(neigong.additionalGroups) ? neigong.additionalGroups : []).entries()) {
    validateRawNumber(group?.count, `neigong.additionalGroups.${index}.count`, conflicts, { min: 0 });
    validateRawNumber(group?.tier, `neigong.additionalGroups.${index}.tier`, conflicts, { min: 1, max: 3 });
    validateRawNumber(group?.stage, `neigong.additionalGroups.${index}.stage`, conflicts, { min: 1, max: 3 });
  }
  validateRawNumber(jingmai.total, "jingmai.total", conflicts, { min: 0, max: 12 });
  validateRawNumber(jingmai.yin, "jingmai.yin", conflicts, { min: 0, max: 6 });
  validateRawNumber(jingmai.yang, "jingmai.yang", conflicts, { min: 0, max: 6 });
  const primaryModel = wuxue.primary && typeof wuxue.primary === "object";
  if (primaryModel) {
    validateRawNumber(wuxue.primary.tier, "wuxue.primary.tier", conflicts, { min: 1, max: 3 });
    validateRawNumber(wuxue.primary.stage, "wuxue.primary.stage", conflicts, { min: 1, max: 4 });
    for (const tier of [1, 2, 3]) {
      validateRawNumber(wuxue.additionalTierCounts?.[tier], `wuxue.additionalTierCounts.${tier}`, conflicts, { min: 0, max: 20 });
    }
    validateRawNumber(wuxue.additionalRandomMin, "wuxue.additionalRandomMin", conflicts, { min: 0, max: 20 });
    validateRawNumber(wuxue.additionalRandomMax, "wuxue.additionalRandomMax", conflicts, { min: 0, max: 20 });
    if (wuxue.additionalRandomMin !== undefined && wuxue.additionalRandomMax !== undefined
      && Number(wuxue.additionalRandomMin) > Number(wuxue.additionalRandomMax)) {
      conflicts.push({ type: "condition", field: "wuxue.additionalRandomMin", reason: "其他武学随机数量下限不能大于上限", expected: `<= ${wuxue.additionalRandomMax}`, actual: wuxue.additionalRandomMin });
    }
  } else {
    validateRawNumber(wuxue.mainCount, "wuxue.mainCount", conflicts, { min: 0 });
    validateRawNumber(wuxue.mainTier, "wuxue.mainTier", conflicts, { min: 1, max: 3 });
    for (const tier of [1, 2, 3]) {
      validateRawNumber(wuxue.mainTierCounts?.[tier], `wuxue.mainTierCounts.${tier}`, conflicts, { min: 0 });
    }
    validateRawNumber(wuxue.mainRandomMin, "wuxue.mainRandomMin", conflicts, { min: 0, max: 20 });
    validateRawNumber(wuxue.mainRandomMax, "wuxue.mainRandomMax", conflicts, { min: 0, max: 20 });
    if (wuxue.mainRandomMin !== undefined && wuxue.mainRandomMax !== undefined
      && Number(wuxue.mainRandomMin) > Number(wuxue.mainRandomMax)) {
      conflicts.push({ type: "condition", field: "wuxue.mainRandomMin", reason: "随机数量下限不能大于上限", expected: `<= ${wuxue.mainRandomMax}`, actual: wuxue.mainRandomMin });
    }
    validateRawNumber(wuxue.mainStage, "wuxue.mainStage", conflicts, { min: 1, max: 4 });
  }
  for (const key of ["sanshouCount", "qinggongCount", "zhenfaCount"]) {
    validateRawNumber(wuxue[key], `wuxue.${key}`, conflicts, { min: 0 });
  }
  validateRawNumber(wuxue.healingCount, "wuxue.healingCount", conflicts, { min: 1 });
  validateRawNumber(wuxue.wuxingLimit, "wuxue.wuxingLimit", conflicts, { min: 0 });
  validateRawNumber(stats.freePoints, "stats.freePoints", conflicts, { min: 0 });
  validateRawNumber(equipment.weaponQuality, "equipment.weaponQuality", conflicts, { min: 0, max: 4 });
  validateRawNumber(equipment.armorQuality, "equipment.armorQuality", conflicts, { min: 0, max: 4 });
  validateRawNumber(equipment.armorMinCount, "equipment.armorMinCount", conflicts, { min: 0, max: Object.values(ARMOR_SLOT_LIMITS).reduce((sum, limit) => sum + limit, 0) });
  validateRawNumber(equipment.armorRandomExtraMax, "equipment.armorRandomExtraMax", conflicts, { min: 0, max: Object.values(ARMOR_SLOT_LIMITS).reduce((sum, limit) => sum + limit, 0) });
  if (Array.isArray(equipment.armorTypes)) {
    const invalidTypes = equipment.armorTypes.filter(type => !ARMOR_TYPES.includes(type));
    if (invalidTypes.length) conflicts.push({ type: "condition", field: "equipment.armorTypes", reason: "存在无效防具部位", expected: ARMOR_TYPES, actual: invalidTypes });
    const selectedTypes = new Set(equipment.armorTypes.filter(type => ARMOR_TYPES.includes(type)));
    const requiredCount = [...selectedTypes].reduce((sum, type) => sum + Math.min(
      ARMOR_SLOT_LIMITS[type], Math.max(1, integer(equipment.armorTypeCounts?.[type], 1))
    ), 0);
    if (equipment.armorMinCount !== undefined && Number(equipment.armorMinCount) < requiredCount) {
      conflicts.push({ type: "condition", field: "equipment.armorMinCount", reason: "最低件数不能少于指定部位数量", expected: requiredCount, actual: equipment.armorMinCount });
    }
  }
  return conflicts;
}

function choose(rng, values) {
  if (!values.length) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor(number(rng(), 0) * values.length)));
  return values[index];
}

function neigongThresholds(item) {
  const tier = integer(item.system?.tier, 1);
  const base = tier === 1 ? [0, 1000, 3000] : tier === 2 ? [1000, 4000, 10000] : [2000, 12000, 30000];
  const config = item.system?.config || {};
  const ratios = [config.stage1?.xpCostRatio, config.stage2?.xpCostRatio, config.stage3?.xpCostRatio]
    .map(value => Math.max(0, number(value, 1)));
  return [
    Math.floor(base[0] * ratios[0]),
    Math.floor(base[0] * ratios[0] + (base[1] - base[0]) * ratios[1]),
    Math.floor(base[0] * ratios[0] + (base[1] - base[0]) * ratios[1] + (base[2] - base[1]) * ratios[2])
  ];
}

function neigongStage(item, requested) {
  const thresholds = neigongThresholds(item);
  const stage = Math.max(1, Math.min(3, integer(requested, 1)));
  return { stage, xp: thresholds[stage - 1], thresholds };
}

function applyNeigongStage(item, requested, locked = false) {
  const result = neigongStage(item, requested);
  item.system.xpInvested = result.xp;
  item.system.sourceBreakdown = { general: 0, specific: result.xp };
  item.system.stage = result.stage;
  item._generationStageLocked = locked;
  return item;
}

function itemCategory(item) {
  return item.system?.category || item.category;
}

function hasFormalMove(item) {
  return (item.system?.moves || []).some(isFormalMove);
}

/**
 * 返回套路正式招式可达到的最高境界；固定主修境界筛选必须先用这个上限排除不可能的候选。
 * @param {object} item - 武学来源快照。
 * @returns {number} 0 至 4 的最高正式招式境界。
 */
function wuxueStageCapacity(item) {
  return Math.max(0, ...(item.system?.moves || [])
    .filter(isFormalMove)
    .map(move => maxMoveStage(item, move)));
}

/**
 * 返回整套武学正式招式实际存在的境界选项，供未固定目标的辅助武学随机选择。
 * @param {object} item - 武学来源快照。
 * @returns {number[]} 去重后的境界选项。
 */
function wuxueStageChoices(item) {
  return [...new Set((item.system?.moves || [])
    .filter(isFormalMove)
    .flatMap(move => moveStageChoices(item, move)))].sort((left, right) => left - right);
}

function hasHealingPotential(item) {
  return (item.system?.moves || []).some(move => isFormalMove(move)
    && move.type === "qi" && move.actionType === "heal");
}

function fixedForCategory(fixed, category) {
  if (Array.isArray(fixed)) return category === "wuxue" ? fixed : [];
  return Array.isArray(fixed?.[category]) ? fixed[category] : [];
}

function makeStatSource() {
  const stat = () => ({ value: 1, assigned: 0 });
  return {
    freePoints: { value: 0 }, wuxing: { value: 1, breakLimit: 0 },
    liliang: stat(), shenfa: stat(), neixi: stat(), tipo: stat(), qigan: stat(), shencai: stat()
  };
}

function makeActorSystem(draft) {
  const stats = makeStatSource();
  for (const [key, value] of Object.entries(draft.stats?.assigned || {})) {
    if (stats[key]) stats[key].assigned = Math.max(0, integer(value));
  }
  stats.freePoints.value = Math.max(0, integer(draft.stats?.freePoints, 0));
  const standard = Object.fromEntries(MERIDIAN_DEFINITIONS.map(definition => [definition.key, false]));
  for (const key of draft.jingmai?.selected || []) standard[key] = true;
  const attempts = Object.fromEntries(MERIDIAN_DEFINITIONS.map(definition => [definition.key, 0]));
  return {
    info: { gender: "", zi: "", title: "", age: 18, height: "", weight: "", sect: "none", background: "", personality: "", bio: "", appearance: "" },
    stats,
    cultivation: { general: 0, neigong: 0, wuxue: 0, arts: 0 },
    resources: {
      hp: { value: 10, max: 10 }, mp: { value: 0, max: 0 }, rage: { value: 0, max: 10 },
      rest: { value: 2, max: 2 }, silver: 0, satiety: { value: 100, max: 100 }, alcohol: { value: 0, max: 0 },
      morale: { value: 0, max: 100 }, shalu: { value: 0, max: 100 }, shanie: 0, huti: 0
    },
    martial: { active_neigong: draft.runNeigongId || "", stance: "", stanceItemId: "", stanceActive: false },
    social: { rep_chaoting: 0, rep_wulin: 0, xiayi: 0, exing: 0, attitude_chaoting: "none", attitude_wulin: "none", attitude_shisu: "none", shihao: ["", "", ""], relations: [] },
    jingmai: { attempts, standard, extra: { du: false, ren: false, chong: false, dai: false, yangwei: false, yinwei: false, yangqiao: false, yinqiao: false }, xuanguan: { broken: draft.jingmai?.xuanguanBroken === true, buffedItem: "" } },
    customModifiers: [], history: []
  };
}

function rebuildDraftSystem(draft) {
  draft.system = makeActorSystem(draft);
  draft.system.info.title = "随机生成 NPC";
  draft.system.martial.active_neigong = draft.runNeigongId;
  draft.system.stats.freePoints.value = Math.max(0, integer(draft.config?.stats?.freePoints, 0));
}

function removeEmbeddedIds(data, { keepId = false } = {}) {
  const cloneData = clone(data);
  if (!keepId) delete cloneData._id;
  if (Array.isArray(cloneData.effects)) for (const effect of cloneData.effects) delete effect._id;
  const compendiumSource = sourceCompendiumId(data);
  // 普通 uuid 会在嵌入 Item 初始化时变成 Actor.Item.uuid；写入 V14 _stats schema，
  // 让草案评估和最终创建后的固定资源识别使用同一身份。
  if (compendiumSource) cloneData._stats = { ...(cloneData._stats || {}), compendiumSource };
  return cloneData;
}

function preparedItemData(candidate, type) {
  const data = removeEmbeddedIds(candidate);
  data.type = type || data.type;
  data.system = stripRuntimeFields(data.system, data.type);
  return data;
}

function assignmentSummary(item) {
  const formalMoves = (item.system?.moves || []).filter(isFormalMove);
  return {
    uuid: item.uuid,
    name: item.name,
    category: itemCategory(item),
    tier: item.system?.tier,
    stage: item.system?.stage,
    targetStage: item._generationTargetStage ?? null,
    actualStage: Math.max(0, ...formalMoves.map(move => number(move.effectiveStage))),
    itemId: item._id,
    core: item._generationCore?.name || null,
    coreMove: clone(item._generationCore),
    moves: formalMoves.map(move => ({
      id: move.id, name: move.name, level: move.computedLevel, stage: move.effectiveStage,
      xpInvested: move.xpInvested, healing: move.type === "qi" && move.actionType === "heal"
    })),
    operations: (item.system?.moves || []).filter(move => !isFormalMove(move)).map(move => ({
      id: move.id, name: move.name, level: move.computedLevel, stage: move.effectiveStage,
      xpInvested: move.xpInvested
    }))
  };
}

/**
 * 返回配置中明确指定的武学身份；悟性上限要先保留这些固定内容的贡献。
 * @param {object} config - 规范化或原始生成配置。
 * @returns {Set<string>} 固定武学资源身份集合。
 */
function fixedWuxueIdentities(config = {}) {
  const wuxue = config.wuxue || {};
  const fixed = wuxue.fixed || {};
  const ids = new Set();
  if (wuxue.primary?.uuid) ids.add(String(wuxue.primary.uuid));
  for (const category of ["wuxue", "sanshou", "qinggong", "zhenfa"]) {
    for (const uuid of fixedForCategory(fixed, category)) ids.add(String(uuid));
  }
  for (const uuid of wuxue.healingUuids || []) ids.add(String(uuid));
  return ids;
}

/**
 * 计算固定武学贡献供预览说明；固定内容仍须遵守用户明确填写的悟性上限。
 * @param {object} config - 生成配置。
 * @param {object[]} items - 已完成招式派生的武学文档/快照。
 * @returns {object} 与 calculateWuxingContribution 相同的贡献摘要。
 */
function calculateFixedWuxing(config, items = []) {
  const fixed = fixedWuxueIdentities(config);
  const primary = config.wuxue?.primary;
  const primaryIds = new Set([
    primary?.uuid,
    ...fixedForCategory(config.wuxue?.fixed || {}, "wuxue")
  ].filter(Boolean).map(String));
  const fullPrimaryBaseline = primary?.stage != null
    || (!Object.prototype.hasOwnProperty.call(config.wuxue || {}, "primary")
      && primaryIds.size > 0);
  const moveLocks = config.wuxue?.fixed?.moves || {};
  const matchesFixed = item => {
    const identities = [
      resourceIdentity(item), sourceCompendiumId(item), item?.uuid,
      item?._source?.uuid, item?._source?._stats?.compendiumSource,
      item?.flags?.core?.sourceId, item?._source?.flags?.core?.sourceId
    ].filter(Boolean).map(String);
    const identity = identities.find(value => fixed.has(value));
    if (!identity) return null;
    if (fullPrimaryBaseline && primaryIds.has(identity)) return item;
    const locks = Object.entries(moveLocks).find(([key]) => identities.includes(String(key)))?.[1];
    if (!locks || typeof locks !== "object") return null;
    const lockedMoves = (item.system?.moves || []).filter(move => Object.prototype.hasOwnProperty.call(locks, move.id));
    if (!lockedMoves.length) return null;
    const partial = clone(item);
    partial.system = { ...(partial.system || {}), moves: lockedMoves };
    return partial;
  };
  return calculateWuxingContribution(items.map(matchesFixed).filter(Boolean));
}

function allowedWuxingLimit(config) {
  return config.wuxue?.wuxingLimit ?? null;
}

/**
 * 在当前浏览器筛选快照上加载完整来源文档；来源缓存只保存规则原文，不保存人物状态。
 * @param {object} browser - XJZLCompendiumBrowser 实例。
 * @param {string} tab - 浏览器分类。
 * @param {object} range - 搜索和筛选快照。
 * @param {Map<string,object>} cache - 请求级完整来源缓存。
 * @param {(entry:object) => boolean|null} predicate - 可选的索引级候选筛选器。
 * @returns {Promise<object[]>} 稳定排序的候选来源。
 */
export async function loadGenerationCandidates(browser, tab, range, cache = new Map(), predicate = null) {
  const entries = dedupe(rangeSnapshot(browser, tab, range).filter(entry => !predicate || predicate(entry)));
  const candidates = [];
  const pendingByPack = new Map();
  const fallbackEntries = [];

  for (const entry of entries) {
    const key = entry.uuid || resourceIdentity(entry);
    if (cache.has(key)) {
      candidates.push(cache.get(key));
      continue;
    }
    const packCollection = entry.packCollection || String(entry.uuid || "").match(/^Compendium\.([^\.]+\.[^\.]+)\./)?.[1];
    const pack = packCollection ? globalThis.game?.packs?.get(packCollection) : null;
    if (!pack) {
      fallbackEntries.push(entry);
      continue;
    }
    const group = pendingByPack.get(pack.collection) || { pack, entries: [] };
    group.entries.push(entry);
    pendingByPack.set(pack.collection, group);
  }

  // V14 的 CompendiumCollection#getDocuments 支持 _id__in；每个包只发一次批量请求，
  // 避免默认范围下对上千个条目逐个 fromUuid、逐个触发文档初始化。
  await Promise.all([...pendingByPack.values()].map(async ({ pack, entries: packEntries }) => {
    try {
      const ids = packEntries.map(entry => String(entry.uuid).split(".").at(-1));
      const documents = await pack.getDocuments({ _id__in: ids });
      const byId = new Map(documents.map(document => [document.id, document]));
      for (const entry of packEntries) {
        const key = entry.uuid || resourceIdentity(entry);
        const document = byId.get(String(entry.uuid).split(".").at(-1));
        if (!document) continue;
        const data = sourceObject(document);
        data.uuid = document.uuid || entry.uuid;
        cache.set(key, data);
        candidates.push(data);
      }
    } catch (error) {
      console.warn(`XJZL | 随机人物批量读取资源失败 ${pack.collection}:`, error);
      fallbackEntries.push(...packEntries);
    }
  }));

  // 非合集 UUID 或批量接口失败时保留兼容回退；正常系统资源不会走这里。
  const fallback = await Promise.all(fallbackEntries.map(async entry => {
    const key = entry.uuid || resourceIdentity(entry);
    if (cache.has(key)) return cache.get(key);
    try {
      const document = await fromUuid(entry.uuid);
      if (!document) return null;
      const data = sourceObject(document);
      data.uuid = document.uuid || entry.uuid;
      cache.set(key, data);
      return data;
    } catch (error) {
      console.warn(`XJZL | 随机人物读取资源失败 ${entry.uuid}:`, error);
      return null;
    }
  }));
  return dedupe(candidates.concat(fallback.filter(Boolean)));
}

/**
 * 生成器只读取当前配置可能用到的武学来源；浏览器仍保留完整索引，避免首次预览为无关品阶/分类初始化文档。
 * @param {object} config - 已规范化的生成配置。
 * @returns {(entry:object) => boolean} 索引条目筛选器。
 */
function makeWuxueCandidatePredicate(config) {
  const additionalTierCounts = config.wuxue.additionalTierCounts || config.wuxue.mainTierCounts || {};
  const additionalRandomMax = config.wuxue.additionalRandomMax ?? config.wuxue.mainRandomMax;
  const primaryCount = config.wuxue.model === "primary" ? 1 : 0;
  const categoryCounts = {
    wuxue: primaryCount + Object.values(additionalTierCounts).reduce((sum, count) => sum + count, 0)
      + additionalRandomMax,
    sanshou: config.wuxue.sanshouCount,
    qinggong: config.wuxue.qinggongCount,
    zhenfa: config.wuxue.zhenfaCount
  };
  const fixedIds = new Set([
    ...config.wuxue.healingUuids,
    config.wuxue.primary?.uuid,
    ...Object.entries(config.wuxue.fixed || {})
      .filter(([category]) => category !== "moves")
      .flatMap(([, ids]) => Array.isArray(ids) ? ids : [])
  ].map(String));
  return entry => {
    const uuid = String(entry?.uuid || "");
    if (fixedIds.has(uuid)) return true;
    const category = entry?.system?.category;
    if (!category || !categoryCounts[category]) return false;
    if (category === "wuxue") {
      const tier = String(integer(entry?.system?.tier, 1));
      const primaryTier = config.wuxue.primary?.tier;
      return Boolean(additionalTierCounts?.[tier])
        || additionalRandomMax > 0
        || (primaryCount > 0 && (primaryTier == null || integer(entry?.system?.tier, 1) === primaryTier));
    }
    return true;
  };
}

/**
 * 仅在内功品阶已经被配置收窄且不会影响经脉补功时按品阶裁剪索引文档；
 * 任一随机槽位或自动补功存在时保留全品阶，避免把潜在资格来源提前过滤掉。
 * @param {object} config - 已规范化的生成配置。
 * @returns {(entry:object) => boolean} 索引条目筛选器。
 */
function makeNeigongCandidatePredicate(config) {
  const fixedIds = new Set([
    config.neigong.runUuid,
    ...(config.neigong.additionalGroups || []).flatMap(group => group.uuids || [])
  ].filter(Boolean).map(String));
  const allowedTiers = new Set();
  let allTiers = config.neigong.runTier == null;
  if (config.neigong.runTier != null) allowedTiers.add(config.neigong.runTier);
  let configuredSlots = 0;
  for (const group of config.neigong.additionalGroups || []) {
    const count = Math.max(0, integer(group?.count, 1));
    configuredSlots += count;
    if (count === 0 || group?.tier == null) allTiers = true;
    else allowedTiers.add(group.tier);
  }
  if (config.neigong.additionalCount > configuredSlots
    || config.neigong.additionalRandomMax > 0
    || config.neigong.additionalRandomMin > 0) allTiers = true;
  if (config.jingmai.mode !== "none" && config.jingmai.autoSupplement && config.neigong.supplementForJingmai) {
    allTiers = true;
  }
  return entry => fixedIds.has(String(entry?.uuid || ""))
    || allTiers
    || allowedTiers.has(integer(entry?.system?.tier, 1));
}

function validateConfig(config) {
  const conflicts = [];
  if (config.quantity < 1 || config.quantity > 20) conflicts.push({ type: "condition", field: "quantity", reason: "生成数量必须在 1-20 之间", expected: "1-20", actual: config.quantity });
  if (config.wuxue.healingRequired && config.wuxue.healingCount < 1) conflicts.push({ type: "condition", field: "wuxue.healingCount", reason: "必带治疗门数必须为正整数", expected: ">=1", actual: config.wuxue.healingCount });
  if (config.jingmai.total != null && config.jingmai.total > 12) conflicts.push({ type: "condition", field: "jingmai.total", reason: "十二正经最多 12 条", expected: "<=12", actual: config.jingmai.total });
  return conflicts;
}

function selectUnique(candidates, count, fixedIds, predicate, rng, field) {
  const conflicts = [];
  const pool = candidates.filter(candidate => !predicate || predicate(candidate));
  const result = [];
  const used = new Set();
  const fixedList = [...(fixedIds || [])];
  if (fixedList.length > count) {
    conflicts.push({ type: "condition", field, reason: "指定资源数量超过该分类槽位", expected: count, actual: fixedList.length, resources: fixedList });
  }
  for (const fixedId of fixedList.slice(0, Math.max(0, count))) {
    const fixed = byIdentity(pool, fixedId);
    if (!fixed) {
      conflicts.push({ type: "source", field, reason: "指定资源不在当前范围或来源已失效", expected: fixedId, actual: null, resources: [fixedId] });
      continue;
    }
    const identity = resourceIdentity(fixed);
    if (used.has(identity)) {
      conflicts.push({ type: "condition", field, reason: "指定资源重复", expected: "不同资源", actual: fixedId, resources: [fixedId] });
      continue;
    }
    used.add(identity);
    result.push(fixed);
  }
  const available = pool.filter(candidate => !used.has(resourceIdentity(candidate)));
  while (result.length < count && available.length) {
    const selected = choose(rng, available);
    if (!selected) break;
    result.push(selected);
    used.add(resourceIdentity(selected));
    available.splice(available.indexOf(selected), 1);
  }
  if (result.length < count) conflicts.push({ type: "condition", field, reason: "候选资源不足，无法满足门数", expected: count, actual: result.length, resources: result.map(resourceIdentity) });
  return { result, conflicts };
}

function makeTarget(config) {
  const target = config.jingmai;
  return {
    mode: target.mode,
    total: target.total,
    yin: target.yin > 0 ? target.yin : null,
    yang: target.yang > 0 ? target.yang : null,
    fixed: target.fixed
  };
}

function finiteNumbers(value, path = "", errors = []) {
  if (typeof value === "number" && !Number.isFinite(value)) errors.push(`${path}: ${value}`);
  else if (Array.isArray(value)) value.forEach((entry, index) => finiteNumbers(entry, `${path}[${index}]`, errors));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, entry]) => finiteNumbers(entry, path ? `${path}.${key}` : key, errors));
  return errors;
}

function makeEvaluationData(draft) {
  return {
    _id: draft.evaluationId,
    name: draft.name,
    type: draft.actorType,
    img: draft.img || "icons/svg/mystery-man.svg",
    system: clone(draft.system),
    items: clone(draft.items),
    effects: []
  };
}

/**
 * 用当前注册的 Actor/Item 文档类执行一次完整内存准备，并识别 V14 捕获的内嵌异常。
 * @param {object} draft - 完整原始草案。
 * @returns {Promise<object>} 准备结果；prepared=false 时禁止预览有效化和创建。
 */
export async function evaluateGenerationDraft(draft) {
  const errors = [];
  const errorHook = (location, error, data = {}) => {
    const uuid = String(data.uuid || "");
    const target = String(draft.evaluationId || "");
    if (uuid && target && uuid.includes(target)) {
      errors.push({ location, message: error?.message || String(error), uuid });
    }
  };
  const hookId = globalThis.Hooks?.on?.("error", errorHook);
  let actor = null;
  let thrown = null;
  try {
    const ActorClass = globalThis.CONFIG?.Actor?.documentClass;
    if (!ActorClass) throw new Error("当前 Actor 文档类尚未注册");
    actor = new ActorClass(makeEvaluationData(draft), { strict: false });
    // V14 就绪后构造器已执行一次 _safePrepareData；未就绪的测试/工具环境才补一次，避免 AE 重复应用。
    if (!globalThis.game?._documentsReady) {
      if (typeof actor._safePrepareData === "function") actor._safePrepareData();
      else actor.prepareData?.();
    }
  } catch (error) {
    thrown = error;
  } finally {
    if (hookId !== undefined) globalThis.Hooks?.off?.("error", hookId);
  }
  const preparationErrors = [...errors, ...(thrown ? [{ location: "Actor.prepareData", message: thrown.message, uuid: actor?.uuid || "" }] : [])];
  const items = actor?.items ? [...actor.items] : [];
  const finiteErrors = finiteNumbers(actor?.system, "system");
  items.forEach((item, index) => finiteNumbers(item.system, `items[${index}].system`, finiteErrors));
  const run = items.find(item => item.id === draft.runNeigongId);
  const wuxue = items.filter(item => item.type === "wuxue");
  const healing = countLearnedHealing(wuxue);
  // toObject() 返回来源数据，不含 Item.prepareDerivedData 写入的招式 computedLevel/effectiveStage；
  // 悟性必须读取已完成准备的内存 Document，才能与角色面板实际结果一致。
  const wuxing = calculateWuxingContribution(wuxue);
  const fixedWuxing = calculateFixedWuxing(draft.config, wuxue);
  const wuxingLimit = allowedWuxingLimit(draft.config);
  const constraints = {
    healing: !draft.config.wuxue.healingRequired || healing.count >= draft.config.wuxue.healingCount,
    wuxing: wuxingLimit == null || wuxing.total <= wuxingLimit,
    run: Boolean(run),
    finite: finiteErrors.length === 0
  };
  const prepared = Boolean(actor) && preparationErrors.length === 0 && constraints.finite;
  return {
    draftId: draft.draftId,
    requestId: draft.requestId,
    configVersion: draft.configVersion,
    prepared,
    actor,
    errors: preparationErrors,
    finiteErrors,
    constraints,
    derived: actor ? {
      hpMax: number(actor.system?.resources?.hp?.max),
      mpMax: number(actor.system?.resources?.mp?.max),
      rageMax: number(actor.system?.resources?.rage?.max),
      freePoints: number(actor.system?.stats?.freePoints?.total),
      assignedPoints: Object.entries(actor.system?.stats || {}).filter(([key]) => key !== "wuxing" && key !== "freePoints")
        .reduce((sum, [, stat]) => sum + number(stat?.assigned), 0),
      stats: Object.fromEntries(GENERATION_STATS.map(key => [key, number(actor.system?.stats?.[key]?.total)])),
      runNeigongStats: Object.fromEntries(GENERATION_STATS.map(key => [key, number(run?.system?.current?.stats?.[key])])),
      realmLevel: actor.system?.cultivation?.realmLevel,
      wuxingContribution: wuxing,
      fixedWuxingContribution: fixedWuxing,
      wuxingLimit,
      healing: { count: healing.count, items: healing.items.map(entry => ({ name: entry.item.name, moves: entry.moves.map(move => move.name) })) }
    } : null
  };
}

/**
 * 角色生成管理器：资源快照、受约束草案、内存评估与世界创建分层处理。
 * @param {object} options - browser 为现有万卷阁实例；rngFactory 仅供回归注入。
 */
export class XJZLCharacterGenerationManager {
  constructor({ browser, rngFactory = createSeededRng } = {}) {
    this.browser = browser;
    this.rngFactory = rngFactory;
    this.sourceCache = new Map();
    this._createLock = Promise.resolve();
  }

  /**
   * 冻结配置并读取各类型候选来源；浏览器后续操作不会改变本请求。
   * @param {object} input - 用户配置。
   * @param {{onProgress?: (phase:string)=>void|Promise<void>}} options - 可选阶段回调，用于显示首次读取候选的进度。
   * @returns {Promise<object>} 配置快照、候选池及来源冲突。
   */
  async snapshot(input = {}, { onProgress } = {}) {
    const rawConflicts = validateRawConfig(input);
    const config = normalizeGenerationConfig(input);
    config.requestId ||= randomId();
    const rawFields = new Set(rawConflicts.map(conflict => conflict.field));
    const conflicts = [...rawConflicts, ...validateConfig(config).filter(conflict => !rawFields.has(conflict.field))];
    if (!this.browser) conflicts.push({ type: "source", field: "browser", reason: "江湖万卷阁尚未初始化" });
    const pools = { neigong: [], wuxue: [], weapon: [], armor: [] };
    if (this.browser) {
      await onProgress?.("browser");
      // 世界就绪时万卷阁已在后台建立索引；只等待未完成的首次加载，避免每次预览重复重建全量索引。
      if (!this.browser.isLoaded) await this.browser.loadData?.();
      await onProgress?.("neigong");
      pools.neigong = await loadGenerationCandidates(
        this.browser, "neigong", config.neigong.pool, this.sourceCache, makeNeigongCandidatePredicate(config)
      );
      await onProgress?.("wuxue");
      pools.wuxue = await loadGenerationCandidates(
        this.browser, "wuxue", config.wuxue.mainPool, this.sourceCache, makeWuxueCandidatePredicate(config)
      );
      // 未指定武器类型且没有固定武器时不需要读取整包武器；防具首版只消费明确指定或
      // 明确设置了范围的条目。这样首次预览不会为默认的“无额外防具”加载整套装备文档。
      const weaponNeeded = config.wuxue.weaponType !== "none" || Boolean(config.equipment.weaponUuid);
      pools.weapon = weaponNeeded
        ? await loadGenerationCandidates(this.browser, "weapon", config.equipment.weaponPool, this.sourceCache)
        : [];
      const armorRange = config.equipment.armorPool || {};
      const armorRangeSelected = Boolean(armorRange.query) || Object.values(armorRange.filters || {}).some(values => values?.length);
      const armorNeeded = config.equipment.armorMinCount > 0
        || config.equipment.armorTypes?.length
        || config.equipment.armorUuids?.length
        || (config.equipment.armorFillMode === "random" && config.equipment.armorRandomExtraMax > 0)
        || armorRangeSelected;
      pools.armor = armorNeeded
        ? await loadGenerationCandidates(this.browser, "armor", armorRange, this.sourceCache)
        : [];
      await onProgress?.("ready");
    }
    return Object.freeze({ config: clone(config), pools, conflicts, sourceCacheSize: this.sourceCache.size });
  }

  /** 按配置保留附修槽位；runChoice 仅供联合构筑遍历随机运行候选，不改变用户的锁定语义。 */
  _selectNeigongs(snapshot, config, rng, decisionRolls = new Map(), runChoice = {}) {
    const candidates = snapshot.pools.neigong;
    const conflicts = [...snapshot.conflicts];
    const configuredGroups = config.neigong.additionalGroups || [];
    const randomAdditionalCount = randomInteger(
      rng, config.neigong.additionalRandomMin, config.neigong.additionalRandomMax
    );
    const additionalCount = config.neigong.additionalCount + randomAdditionalCount;
    // 先冻结实际生成的附修槽位，再保护“品阶候选数刚好够用”的资源，避免随机运行内功
    // 抢走唯一的天级/地级候选；候选仍不足时继续由原有冲突流程报告。
    const configuredSlots = configuredGroups.flatMap(group => {
      const count = Math.max(0, integer(group?.count, 1));
      const uuids = Array.isArray(group?.uuids) ? group.uuids : [];
      if (count === 0) return [];
      return Array.from({ length: count }, (_, index) => ({
        ...group,
        id: `${group?.id || "additional"}-${index + 1}`,
        count: 1,
        uuids: uuids[index] ? [uuids[index]] : []
      }));
    });
    const groups = additionalCount === 0 ? [] : Array.from({ length: additionalCount }, (_, index) => configuredSlots[index] || ({
      id: `additional-${index + 1}`,
      count: 1,
      tier: null,
      stage: null,
      uuids: []
    }));
    const reservedAdditionalIds = new Set(groups.flatMap(group => group.uuids || []).map(String));
    const tierDemands = new Map();
    let genericDemand = 0;
    for (const group of groups) {
      if (group.uuids?.length) continue;
      if (group.tier == null) genericDemand += group.count;
      else if (group.count > 0) tierDemands.set(group.tier, (tierDemands.get(group.tier) || 0) + group.count);
    }
    const explicitAdditionalIds = new Set(reservedAdditionalIds);
    // 只要没有明确运行 UUID，运行资源就是随机槽位；品阶/属性限定仍不能让它
    // 抢走后续已指定的附修资源，或让剩余品阶/通配槽位无法填满。
    const randomRun = !config.neigong.runUuid;
    const canPreserveAdditional = candidate => {
      const candidateId = String(sourceId(candidate));
      if (explicitAdditionalIds.has(candidateId)) return false;
      const occupied = new Set(explicitAdditionalIds);
      const remaining = candidates.filter(item => String(sourceId(item)) !== candidateId
        && !occupied.has(String(sourceId(item))));
      for (const [tier, demand] of tierDemands.entries()) {
        const available = remaining.filter(item => integer(item.system?.tier, 1) === tier).length;
        if (available < demand) return false;
      }
      return remaining.length >= genericDemand + [...tierDemands.values()].reduce((sum, count) => sum + count, 0);
    };
    const runPool = candidates.filter(item => {
      const matchesTier = config.neigong.runTier == null
        || integer(item.system?.tier, 1) === config.neigong.runTier;
      const matchesElement = config.neigong.runElement === "auto"
        || item.system?.element === config.neigong.runElement;
      const preservesLaterSlot = !randomRun || canPreserveAdditional(item);
      return matchesTier && matchesElement && preservesLaterSlot;
    });
    const runUuid = config.neigong.runUuid || runChoice.uuid;
    const runSelection = selectUnique(runPool, 1, runUuid ? [runUuid] : [], item => true, rng, "neigong.runUuid");
    conflicts.push(...runSelection.conflicts);
    const selected = [];
    const used = new Set();
    const assignments = new Map();
    const run = runSelection.result[0];
    if (run) {
      const runClone = clone(run);
      const stage = config.neigong.runStage || runChoice.stage || choose(rng, [1, 2, 3]);
      applyNeigongStage(runClone, stage, config.neigong.runStage != null);
      runClone.system.active = true;
      runClone._id = randomId();
      selected.push(runClone);
      used.add(resourceIdentity(runClone));
    }
    const restrictedAdditionalIds = new Set();
    const refreshRestrictedAdditionalIds = startIndex => {
      restrictedAdditionalIds.clear();
      const remainingDemands = new Map();
      for (let index = startIndex + 1; index < groups.length; index += 1) {
        const group = groups[index];
        if (group.uuids?.length || group.tier == null || group.count < 1) continue;
        remainingDemands.set(group.tier, (remainingDemands.get(group.tier) || 0) + group.count);
      }
      // 预留只针对后续尚未填满的品阶槽位；槽位填满后立即重算，
      // 让已经满足的配额不再继续阻塞通配附修。
      for (const [tier, demand] of remainingDemands.entries()) {
        const tierCandidates = candidates.filter(item => integer(item.system?.tier, 1) === tier
          && !used.has(resourceIdentity(item))
          && !reservedAdditionalIds.has(String(sourceId(item))));
        for (const item of tierCandidates.slice(0, demand)) {
          restrictedAdditionalIds.add(String(sourceId(item)));
        }
      }
    };
    // 数量是外层契约，槽位不足时补齐随机槽位；这样外部配置即使只指定了其中几门，也不会悄悄少生成。
    for (const [groupIndex, group] of groups.entries()) {
      refreshRestrictedAdditionalIds(groupIndex);
      const laterSpecified = new Set(groups.slice(groupIndex + 1)
        .flatMap(laterGroup => laterGroup.uuids || []).map(String));
      const isSpecifiedGroup = Boolean(group.uuids?.length);
      const pool = candidates.filter(item => (group.tier == null || integer(item.system?.tier, 1) === group.tier)
        && !used.has(resourceIdentity(item))
        // 随机槽位不能抢占后面逐槽位指定的内功；指定槽位本身仍由 selectUnique 报告无效/重复。
        && (isSpecifiedGroup || !laterSpecified.has(String(sourceId(item))))
        && (isSpecifiedGroup || group.tier != null || !restrictedAdditionalIds.has(String(sourceId(item)))));
      const chosen = selectUnique(pool, group.count, group.uuids, item => !used.has(resourceIdentity(item)), rng, `neigong.${group.id}`);
      conflicts.push(...chosen.conflicts);
      assignments.set(group.id, chosen.result.map(sourceId));
      for (const source of chosen.result) {
        const item = clone(source);
        applyNeigongStage(item, group.stage || choose(rng, [1, 2, 3]), group.stage != null);
        item.system.active = false;
        item._id = randomId();
        selected.push(item);
        used.add(resourceIdentity(item));
      }
    }
    const runItem = run ? selected.find(item => resourceIdentity(item) === resourceIdentity(run)) || selected[0] : null;
    return {
      selected,
      run: runItem,
      groups,
      assignments,
      conflicts
    };
  }

  /**
   * 在经脉补功完成后协调运行内功；只有能保留附修指定资源、品阶、境界和门数时
   * 才替换运行项。未指定的通配槽位允许与原运行项交换，判定值沿用本次缓存。
   * @param {object} selection - 内功选择和附修槽位分配结果。
   * @param {object} config - 规范化生成配置。
   * @param {Function} rng - 当前请求 RNG。
   * @param {Map<string, number>} decisionRolls - 本次生成的稳定判定缓存。
   * @returns {object} 保留附修约束并更新运行标记的选择结果。
   */
  _coordinateRunNeigong(selection, config, rng, decisionRolls = new Map()) {
    const selected = selection.selected || [];
    let runItem = selection.run
      ? selected.find(item => resourceIdentity(item) === resourceIdentity(selection.run)) || selected[0]
      : null;
    const fullyAutomaticRun = !config.neigong.runUuid
      && config.neigong.runTier == null
      && config.neigong.runStage == null
      && config.neigong.runElement === "auto";
    if (runItem && fullyAutomaticRun && selected.length > 1) {
      const coordinate = getDecisionRoll(decisionRolls, "neigong:run:growth", rng)
        < number(config.synergyProbability, 0) / 100;
      if (coordinate) {
        const assignments = selection.assignments || new Map();
        const runScore = integer(runItem.system?.tier, 1) * 10 + integer(runItem.system?.stage, 1);
        const replacement = selected
          .filter(item => resourceIdentity(item) !== resourceIdentity(runItem))
          .filter(item => integer(item.system?.tier, 1) * 10 + integer(item.system?.stage, 1) > runScore)
          .sort((left, right) => {
            const leftScore = integer(left.system?.tier, 1) * 10 + integer(left.system?.stage, 1);
            const rightScore = integer(right.system?.tier, 1) * 10 + integer(right.system?.stage, 1);
            return rightScore - leftScore;
          })
          .find(candidate => {
            const candidateId = String(sourceId(candidate));
            const assignment = [...assignments.entries()]
              .find(([, ids]) => (ids || []).map(String).includes(candidateId));
            if (!assignment) return true;
            const group = (selection.groups || []).find(entry => entry.id === assignment[0]);
            const canReplace = group && !(group.uuids || []).length
              && (group.tier == null || integer(runItem.system?.tier, 1) === group.tier)
              && (group.stage == null || integer(runItem.system?.stage, 1) === group.stage);
            if (!canReplace) return false;
            const ids = [...assignment[1]];
            ids[ids.map(String).indexOf(candidateId)] = sourceId(runItem);
            assignments.set(assignment[0], ids);
            return true;
          });
        if (replacement) runItem = replacement;
      }
    }
    for (const item of selected) item.system.active = item._id === runItem?._id;

    const conflicts = [...(selection.conflicts || [])];
    for (const group of selection.groups || []) {
      const assignedIds = selection.assignments?.get(group.id) || [];
      const expectedCount = Math.max(0, integer(group.count, 0));
      if (assignedIds.length !== expectedCount && !conflicts.some(conflict => conflict.field === `neigong.${group.id}`)) {
        conflicts.push({
          type: "condition", field: `neigong.${group.id}`, reason: "附修内功数量未满足", expected: expectedCount, actual: assignedIds.length
        });
      }
      for (const uuid of group.uuids || []) {
        if (!assignedIds.map(String).includes(String(uuid)) && !conflicts.some(conflict => conflict.resources?.includes(uuid))) {
          conflicts.push({ type: "source", field: `neigong.${group.id}`, reason: "指定附修内功未保留", expected: uuid, actual: assignedIds, resources: [uuid] });
        }
      }
      for (const id of assignedIds) {
        const item = selected.find(candidate => String(sourceId(candidate)) === String(id));
        if (!item) continue;
        if (group.tier != null && integer(item.system?.tier, 1) !== group.tier) {
          conflicts.push({ type: "condition", field: `neigong.${group.id}`, reason: "附修内功品阶不符合配置", expected: group.tier, actual: item.system?.tier, resources: [String(id)] });
        }
        if (group.stage != null && integer(item.system?.stage, 1) !== group.stage) {
          conflicts.push({ type: "condition", field: `neigong.${group.id}`, reason: "附修内功境界不符合配置", expected: group.stage, actual: item.system?.stage, resources: [String(id)] });
        }
      }
    }
    return { ...selection, run: runItem, conflicts };
  }

  _solveMeridians(selected, candidates, config, rng) {
    if (config.jingmai.mode === "none") return { selected, result: { selected: [], assignments: {}, feasible: true }, conflicts: [] };
    const allowSupplement = config.jingmai.autoSupplement && config.neigong.supplementForJingmai;
    const adjustments = [];
    const target = makeTarget(config);
    const solve = (sources, options = {}) => solveMeridians({
      sources,
      target: options.target || target,
      rng: options.rng || rng,
      maximize: options.maximize ?? (config.jingmai.mode === "max")
    });
    const sourceTier = source => integer(source?.system?.tier ?? source?.tier, 0);
    const sourceElement = source => source?.system?.element || source?.element || "none";
    const tierCapacity = (sources, tier) => {
      const tierSources = sources.filter(source => sourceTier(source) === tier);
      const yin = tierSources.filter(source => sourceElement(source) === "yin").length;
      const yang = tierSources.filter(source => sourceElement(source) === "yang").length;
      const taiji = tierSources.filter(source => sourceElement(source) === "taiji").length;
      let best = 0;
      for (let yinNodes = 0; yinNodes <= 2; yinNodes += 1) {
        for (let yangNodes = 0; yangNodes <= 2; yangNodes += 1) {
          const taijiNeeded = Math.max(0, yinNodes - yin) + Math.max(0, yangNodes - yang);
          if (taijiNeeded <= taiji) best = Math.max(best, yinNodes + yangNodes);
        }
      }
      return Math.min(4, best);
    };
    const legalCapacity = sources => {
      const first = tierCapacity(sources, 1);
      const second = first > 0 ? tierCapacity(sources, 2) : 0;
      const third = second > 0 ? tierCapacity(sources, 3) : 0;
      return first + second + third;
    };
    const canAssign = (definitions, sources) => {
      const walk = (index, used) => {
        if (index >= definitions.length) return true;
        const definition = definitions[index];
        for (const source of sources) {
          const id = resourceIdentity(source);
          const element = sourceElement(source);
          if (used.has(id) || (element !== definition.element && element !== "taiji")) continue;
          used.add(id);
          if (walk(index + 1, used)) return true;
          used.delete(id);
        }
        return false;
      };
      return walk(0, new Set());
    };
    const maxAssignable = (definitions, sources) => {
      let best = 0;
      const walk = (index, used, count) => {
        best = Math.max(best, count);
        if (index >= definitions.length) return;
        // 允许跳过当前定义，才能得到部分匹配数，用于判断候选是否正在补齐固定节点，
        // 而不是只在整组固定节点突然可行时才给高阶功法加分。
        walk(index + 1, used, count);
        const definition = definitions[index];
        for (const source of sources) {
          const id = resourceIdentity(source);
          const element = sourceElement(source);
          if (used.has(id) || (element !== definition.element && element !== "taiji")) continue;
          used.add(id);
          walk(index + 1, used, count + 1);
          used.delete(id);
        }
      };
      walk(0, new Set(), 0);
      return best;
    };
    const fixedRequirementVector = sources => {
      const fixedDefinitions = (target.fixed || [])
        .map(key => MERIDIAN_DEFINITIONS.find(definition => definition.key === key))
        .filter(Boolean);
      const highestTier = Math.max(0, ...fixedDefinitions.map(definition => definition.tier));
      const vector = [];
      for (let tier = 1; tier <= highestTier; tier += 1) {
        const tierSources = sources.filter(source => sourceTier(source) === tier);
        const fixedAtTier = fixedDefinitions.filter(definition => definition.tier === tier);
        if (tier < highestTier) vector.push(Math.min(1, tierSources.length));
        if (fixedAtTier.length) vector.push(maxAssignable(fixedAtTier, tierSources));
      }
      return vector;
    };
    const fixedRequirementDelta = (currentSources, trialSources) => {
      const currentVector = fixedRequirementVector(currentSources);
      const trialVector = fixedRequirementVector(trialSources);
      const radix = 6;
      return trialVector.reduce((score, value, index) => score
        + Math.max(0, value - (currentVector[index] || 0)) * radix ** (trialVector.length - index - 1), 0);
    };
    const fixedTargetSupported = sources => {
      const fixedDefinitions = (target.fixed || [])
        .map(key => MERIDIAN_DEFINITIONS.find(definition => definition.key === key))
        .filter(Boolean);
      for (const tier of [1, 2, 3]) {
        const tierSources = sources.filter(source => sourceTier(source) === tier);
        const fixedAtTier = fixedDefinitions.filter(definition => definition.tier === tier);
        if (fixedAtTier.length && !canAssign(fixedAtTier, tierSources)) return false;
        if (fixedAtTier.length) {
          for (let priorTier = 1; priorTier < tier; priorTier += 1) {
            const priorSources = sources.filter(source => sourceTier(source) === priorTier);
            if (!priorSources.some(source => ["yin", "yang", "taiji"].includes(sourceElement(source)))) return false;
          }
        }
      }
      return true;
    };
    const potentialState = items => {
      const sources = buildMeridianQualifications(items);
      return { sources, capacity: legalCapacity(sources) };
    };
    const scoreProposal = (proposal, current) => {
      const candidate = proposal.candidate;
      const tier = sourceTier(candidate);
      const element = sourceElement(candidate);
      const trialSources = buildMeridianQualifications(proposal.trial);
      const capacityDelta = legalCapacity(trialSources) - current.capacity;
      // 先按固定节点及其逐关前置的进度做字典序选择，再看总体开脉容量；
      // 这样已有一门人内、目标第三关时，会先补地内，再补天内，不会被多余人内的容量增量吸走。
      const fixedProgress = target.fixed?.length
        ? fixedRequirementDelta(current.sources, trialSources) : 0;
      let score = fixedProgress * 1_000_000_000 + capacityDelta * 1000;
      if (target.fixed?.length && capacityDelta > 0
        && !fixedTargetSupported(current.sources) && fixedTargetSupported(trialSources)) score += 100000;
      const currentElementCount = current.sources.filter(source => sourceElement(source) === element).length;
      if (element === "yin" && target.yin != null && currentElementCount < target.yin) score += 100;
      if (element === "yang" && target.yang != null && currentElementCount < target.yang) score += 100;
      if (element === "taiji" && (target.yin != null || target.yang != null)) score += 50;
      // 同等收益优先低关，保证逐关前置自然被满足，且不先引入无法使用的高关资格。
      return score > 0 ? score + (3 - tier) * 0.01 : score;
    };
    let sources = buildMeridianQualifications(selected);
    let result = solve(sources);
    if (!result.feasible && allowSupplement) {
      // 每次只选择能最大化当前合法开脉潜力的一个已选功法升级；
      // 这样缺一门人级资格时不会顺手把无关的地/天级功法全部补圆。
      while (!result.feasible) {
        const current = potentialState(selected);
        const proposals = selected.flatMap((item, index) => {
          if (item._generationStageLocked || integer(item.system?.stage) >= 3) return [];
          const trial = selected.map((entry, trialIndex) => {
            const copy = clone(entry);
            if (trialIndex === index) applyNeigongStage(copy, 3, false);
            return copy;
          });
          return [{ kind: "upgrade", index, item, candidate: trial[index], trial }];
        });
        const scored = proposals.map(proposal => ({ proposal, score: scoreProposal(proposal, current) }));
        const bestValue = Math.max(...scored.map(entry => entry.score), 0);
        const best = scored.filter(entry => entry.score === bestValue).map(entry => entry.proposal);
        if (!best.length || bestValue <= 0) break;
        const proposal = choose(rng, best);
        applyNeigongStage(selected[proposal.index], 3, false);
        adjustments.push({ type: "upgrade", uuid: resourceIdentity(selected[proposal.index]), name: selected[proposal.index].name, stage: 3 });
        sources = buildMeridianQualifications(selected);
        result = solve(sources);
      }
    }
    if (!result.feasible && allowSupplement) {
      const used = new Set(selected.map(resourceIdentity));
      // 以“能否使合法最大开启数增加”为候选评分，优先满足缺失的品阶/属性资格；
      // 同分才使用本次 RNG，保证补功数量最少且不引入无关永久收益。
      while (!result.feasible) {
        const current = potentialState(selected);
        const proposals = candidates.filter(candidate => !used.has(resourceIdentity(candidate))).map(source => {
          const item = clone(source);
          applyNeigongStage(item, 3, false);
          item.system.active = false;
          item._id = randomId();
          return { source, item, candidate: item, trial: [...selected, item] };
        });
        const scored = proposals.map(proposal => ({ proposal, score: scoreProposal(proposal, current) }));
        const bestValue = Math.max(...scored.map(entry => entry.score), 0);
        const best = scored.filter(entry => entry.score === bestValue).map(entry => entry.proposal);
        if (!best.length || bestValue <= 0) break;
        const proposal = choose(rng, best);
        selected.push(proposal.item);
        used.add(resourceIdentity(proposal.item));
        adjustments.push({ type: "supplement", uuid: resourceIdentity(proposal.item), name: proposal.item.name, stage: 3 });
        sources = buildMeridianQualifications(selected);
        result = solve(sources);
      }
    }
    const conflicts = result.feasible ? [] : [{ type: "condition", field: "jingmai", reason: result.reason, expected: target, actual: sources }];
    return { selected, result, conflicts, adjustments };
  }

  /**
   * 选择独立主修套与其他武学；新模型让主修只占一个槽位，品阶配额只作用于其他武学。
   * @param {object} snapshot - 当前请求的资源快照。
   * @param {object} config - 规范化生成配置。
   * @param {Function} rng - 注入的随机函数。
   * @param {object} context - 已确定的运行内功和稳定配套投骰，供新模型联合约束选择。
   * @returns {{selected: object[],primary?:object|null,conflicts:object[]}} 选中来源和结构化冲突。
   */
  _selectWuxue(snapshot, config, rng, context = {}) {
    if (config.wuxue.model === "primary") return this._selectPrimaryWuxue(snapshot, config, rng, context);
    return this._selectLegacyWuxue(snapshot, config, rng);
  }

  /**
   * 按主修、配额、治疗、匹配和悟性约束联合构筑；只在最低需求已满足的合法选项中随机成长。
   * @param {object} snapshot - 当前请求的资源快照。
   * @param {object} config - 规范化生成配置。
   * @param {Function} rng - 注入的随机函数。
   * @param {object} context - 运行内功与稳定配套判定。
   * @returns {{selected: object[],primary:object|null,conflicts:object[]}} 生成结果。
   */
  _selectPrimaryWuxue(snapshot, config, rng, context = {}) {
    const result = planGenerationWuxue(snapshot, config, rng, context);
    for (const item of result.selected) {
      item._id = randomId();
      item.system.active = false;
    }
    return result;
  }

  /**
   * 兼容旧宏/旧存档的按主修人/地/天配额选择逻辑；新界面不会再写入此模型。
   * @param {object} snapshot - 当前请求的资源快照。
   * @param {object} config - 规范化生成配置。
   * @param {Function} rng - 注入的随机函数。
   * @returns {{selected: object[], conflicts: object[]}} 选中来源和结构化冲突。
   */
  _selectLegacyWuxue(snapshot, config, rng) {
    const pool = snapshot.pools.wuxue;
    const conflicts = [];
    const selected = [];
    const used = new Set();
    const healingPool = new Set(pool.filter(hasHealingPotential).map(sourceId));
    const matchedHealing = new Set();
    for (const uuid of config.wuxue.healingUuids) {
      if (!healingPool.has(uuid)) {
        conflicts.push({ type: "source", field: "wuxue.healingUuids", reason: "指定治疗武学不在当前范围或没有正式治疗招式", expected: uuid, actual: null, resources: [uuid] });
      }
    }
    const mainRandomCount = randomInteger(
      rng, config.wuxue.mainRandomMin, config.wuxue.mainRandomMax
    );
    const categoryRequests = [
      ...[1, 2, 3].map(tier => ({
        category: "wuxue", tier, count: config.wuxue.mainTierCounts?.[String(tier)] || 0,
        field: `wuxue.mainTierCounts.${tier}`, fixed: true
      })),
      { category: "wuxue", tier: null, count: mainRandomCount, field: "wuxue.mainRandomMax", fixed: false },
      { category: "sanshou", tier: null, count: config.wuxue.sanshouCount, field: "wuxue.sanshouCount", fixed: false },
      { category: "qinggong", tier: null, count: config.wuxue.qinggongCount, field: "wuxue.qinggongCount", fixed: false },
      { category: "zhenfa", tier: null, count: config.wuxue.zhenfaCount, field: "wuxue.zhenfaCount", fixed: false }
    ];
    const fixed = config.wuxue.fixed;
    const fixedMainIds = fixedForCategory(fixed, "wuxue");
    const assignedMainFixed = new Set();
    const requestedMainStage = config.wuxue.mainStage;
    // 治疗硬条件优先占用已有分类槽位，避免选满之后才发现治疗资源没有位置。
    let healingSlots = config.wuxue.healingRequired ? config.wuxue.healingCount : 0;
    for (const request of categoryRequests) {
      const { category, tier, count, field } = request;
      const categoryCandidates = pool.filter(item => itemCategory(item) === category
        && hasFormalMove(item)
        && (tier == null || integer(item.system?.tier, 1) === tier));
      // 主修指定资源不要求 GM 先猜它属于哪一个随机槽位：先占用对应品阶的固定槽位，
      // 固定槽位没有余量时再由“主修随机”槽位接收，避免指定资源被无声丢弃。
      const requestedAuxFixedIds = category !== "wuxue" && request.fixed !== false
        ? fixedForCategory(fixed, category) : [];
      const fixedIds = category === "wuxue"
        ? fixedMainIds.filter(uuid => !assignedMainFixed.has(uuid)
          && (tier == null || count > 0)
          && categoryCandidates.some(item => sourceId(item) === uuid))
        : requestedAuxFixedIds.filter(uuid => categoryCandidates.some(item => sourceId(item) === uuid));
      for (const uuid of requestedAuxFixedIds.filter(uuid => !fixedIds.includes(uuid))) {
        conflicts.push({ type: "source", field, reason: "指定辅助武学不在当前资源范围或分类不符", expected: uuid, actual: null, resources: [uuid] });
      }
      const stageEligible = category === "wuxue" && requestedMainStage != null
        ? categoryCandidates.filter(item => wuxueStageCapacity(item) >= requestedMainStage)
        : categoryCandidates;
      const impossibleFixed = category === "wuxue" && requestedMainStage != null
        ? fixedIds.filter(uuid => {
          const item = categoryCandidates.find(candidate => sourceId(candidate) === uuid);
          return item && wuxueStageCapacity(item) < requestedMainStage;
        })
        : [];
      for (const uuid of impossibleFixed) {
        assignedMainFixed.add(uuid);
        const item = categoryCandidates.find(candidate => sourceId(candidate) === uuid);
        conflicts.push({
          type: "condition", field: "wuxue.mainStage", reason: "指定主修套路无法达到目标境界",
          expected: requestedMainStage, actual: wuxueStageCapacity(item), resources: [uuid]
        });
      }
      const candidates = stageEligible;
      const selectableFixedIds = fixedIds.filter(uuid => !impossibleFixed.includes(uuid));
      const specifiedHealing = config.wuxue.healingUuids.filter(uuid => candidates.some(item => sourceId(item) === uuid));
      specifiedHealing.forEach(uuid => matchedHealing.add(uuid));
      for (const uuid of specifiedHealing) if (!selectableFixedIds.includes(uuid)) selectableFixedIds.push(uuid);
      healingSlots -= selectableFixedIds.filter(uuid => {
        const item = candidates.find(candidate => sourceId(candidate) === uuid);
        return item && hasHealingPotential(item);
      }).length;
      const healingCandidates = candidates.filter(hasHealingPotential).filter(item => !selectableFixedIds.includes(sourceId(item)));
      while (healingSlots > 0 && count - selectableFixedIds.length > 0 && healingCandidates.length) {
        const candidate = choose(rng, healingCandidates);
        selectableFixedIds.push(sourceId(candidate));
        healingCandidates.splice(healingCandidates.indexOf(candidate), 1);
        healingSlots -= 1;
      }
      const chosen = selectUnique(candidates.filter(item => !used.has(resourceIdentity(item))), count, selectableFixedIds, item => !used.has(resourceIdentity(item)), rng, field);
      // 固定主修境界时，候选不足的根因是“能达到该境界的套路数量”，不要再把它误报成普通资源范围不足。
      const stageShortage = category === "wuxue" && requestedMainStage != null && stageEligible.length < count;
      conflicts.push(...chosen.conflicts.filter(conflict => !(stageShortage && conflict.reason === "候选资源不足，无法满足门数")));
      if (stageShortage) {
        conflicts.push({
          type: "condition", field: "wuxue.mainStage", reason: `当前范围共有 ${categoryCandidates.length} 套，只有 ${stageEligible.length} 套可达到目标境界`,
          expected: count, actual: stageEligible.length,
          resources: stageEligible.map(resourceIdentity)
        });
      }
      for (const source of chosen.result) {
        const item = clone(source);
        item._id = randomId();
        const maxStage = Math.max(1, ...((item.system.moves || []).filter(isFormalMove).map(move => maxMoveStage(item, move))));
        // 主修目标境界只约束 category=wuxue；散手是独立的辅助分类，按自身可达境界随机，
        // 否则“主修合一 + 散手”会错误地把散手也强行升到合一并制造 mainStage 冲突。
        const target = category === "qinggong" || category === "zhenfa"
          ? 1
          : category === "wuxue" && requestedMainStage != null
            ? requestedMainStage
            : choose(rng, wuxueStageChoices(item)) || Math.min(4, maxStage);
        item._generationTargetStage = target;
        const assigned = allocateMoveStages(item, {
          targetStage: target,
          strategy: category === "wuxue" ? config.wuxue.allocation : config.wuxue.allocation,
          locked: category === "wuxue" ? (fixed?.moves?.[sourceId(source)] || {}) : {},
          rng
        });
        item.system = assigned.item.system;
        item._generationCore = assigned.core;
        item._generationConflicts = assigned.conflicts;
        item.system.category = itemCategory(item);
        item.system.active = false;
        selected.push(item);
        used.add(resourceIdentity(item));
        if (category === "wuxue" && fixedMainIds.includes(sourceId(source))) {
          assignedMainFixed.add(sourceId(source));
        }
        conflicts.push(...assigned.conflicts);
      }
    }
    for (const uuid of fixedMainIds) {
      const source = pool.find(item => sourceId(item) === uuid && itemCategory(item) === "wuxue");
      if (!source) {
        conflicts.push({ type: "source", field: "wuxue.fixed", reason: "指定主修武学不在当前资源范围", expected: uuid, actual: null, resources: [uuid] });
      } else if (!assignedMainFixed.has(uuid)) {
        conflicts.push({ type: "condition", field: "wuxue.mainCount", reason: "指定主修武学没有可用的固定或随机槽位", expected: "至少 1 个主修槽位", actual: 0, resources: [uuid] });
      }
    }
    for (const uuid of config.wuxue.healingUuids) {
      if (healingPool.has(uuid) && !matchedHealing.has(uuid)) {
        conflicts.push({ type: "condition", field: "wuxue.healingUuids", reason: "指定治疗武学不符合当前武学数量或资源范围条件", expected: uuid, actual: "未占用有效武学槽位", resources: [uuid] });
      }
    }
    return { selected, conflicts };
  }

  /**
   * 先选择武器，再按必含部位、最低总数和额外随机上限生成防具，保证预览装备状态与创建载荷一致。
   * @param {object} snapshot - 当前请求的资源快照。
   * @param {object} config - 规范化生成配置。
   * @param {object} draft - 正在构建的人物草案。
   * @param {Function} rng - 注入的随机函数。
   * @returns {object[]} 装备选择期间产生的结构化冲突。
   */
  _selectEquipment(snapshot, config, draft, rng, decisionRolls = new Map()) {
    const conflicts = [];
    const weaponPool = snapshot.pools.weapon;
    const weaponQuality = integer(config.equipment.weaponQuality, 0);
    const armorQuality = integer(config.equipment.armorQuality, 0);
    const matchesQuality = (item, quality) => integer(item?.system?.quality, -1) === quality;
    const primaryCoreType = draft.primary?.coreMove?.weaponType || draft.primary?.coreMove?.system?.weaponType;
    // 新模型的自动武器只服从独立主修套；辅助武学不能把刀/剑等类型混入主修需求。
    // 旧模型没有 primary 摘要时保留旧宏的全武学兼容行为。
    const coreTypes = (draft.primary
      ? [primaryCoreType]
      : draft.wuxue.map(item => item.coreMove?.weaponType || item.coreMove?.system?.weaponType))
      .filter(type => type && type !== "none");
    const weaponCandidates = (config.wuxue.weaponType && config.wuxue.weaponType !== "auto"
      ? weaponPool.filter(item => item.system?.type === config.wuxue.weaponType || item.system?.subtype === config.wuxue.weaponType)
      : coreTypes.length ? weaponPool.filter(item => coreTypes.includes(item.system?.type)) : weaponPool)
      .filter(item => matchesQuality(item, weaponQuality));
    let weapon = byIdentity(weaponPool, config.equipment.weaponUuid);
    let specifiedWeaponQualityConflict = false;
    if (config.equipment.weaponUuid && !weapon) conflicts.push({ type: "source", field: "equipment.weaponUuid", reason: "指定武器不在当前资源范围", expected: config.equipment.weaponUuid, actual: null });
    if (weapon && !matchesQuality(weapon, weaponQuality)) {
      conflicts.push({ type: "condition", field: "equipment.weaponQuality", reason: "指定武器不符合武器品质", expected: weaponQuality, actual: weapon.system?.quality, resources: [resourceIdentity(weapon)] });
      specifiedWeaponQualityConflict = true;
      weapon = null;
    }
    if (weapon && config.wuxue.weaponType !== "auto" && config.wuxue.weaponType !== "none"
      && weapon.system?.type !== config.wuxue.weaponType && weapon.system?.subtype !== config.wuxue.weaponType) {
      conflicts.push({ type: "condition", field: "wuxue.weaponType", reason: "指定武器不符合主要武器类型", expected: config.wuxue.weaponType, actual: weapon.system?.type || weapon.system?.subtype });
    }
    if (weapon && config.wuxue.weaponType === "auto" && coreTypes.length
      && !coreTypes.includes(weapon.system?.type)) {
      const relationKey = "wuxue:primary:weapon";
      const enabled = getDecisionRoll(decisionRolls, relationKey, rng)
        < number(config.synergyProbability, 0) / 100;
      if (enabled) {
        conflicts.push({ type: "condition", field: "equipment.weaponCompatibility", reason: "指定武器与主修核心招式武器类型不匹配", expected: coreTypes, actual: weapon.system?.type || weapon.system?.subtype, resources: [resourceIdentity(weapon)] });
      }
    }
    if (!weapon && !specifiedWeaponQualityConflict && weaponCandidates.length) weapon = choose(rng, weaponCandidates);
    if (!weapon && config.wuxue.weaponType !== "none" && (weaponPool.length === 0 || weaponCandidates.length === 0)) {
      conflicts.push({ type: "condition", field: "equipment.weaponPool", reason: "当前武器范围没有满足主要武器类型或主修需求的候选", expected: config.wuxue.weaponType, actual: weaponPool.length });
    }
    if (weapon) {
      weapon = clone(weapon);
      weapon._id = randomId();
      weapon.system.equipped = true;
      draft.items.push(weapon);
      draft.equipment.weapon = assignmentSummary(weapon);
    }
    const usedArmor = new Set();
    const armorByType = new Map(ARMOR_TYPES.map(type => [type, 0]));
    const armorItems = [];
    const armorLimit = type => ARMOR_SLOT_LIMITS[type] || 1;
    const isAvailableArmor = armor => {
      const type = armor?.system?.type;
      return matchesQuality(armor, armorQuality)
        && ARMOR_TYPES.includes(type)
        && !usedArmor.has(resourceIdentity(armor))
        && (armorByType.get(type) || 0) < armorLimit(type);
    };
    const addArmor = (armor, sourceField) => {
      const type = armor?.system?.type;
      if (!ARMOR_TYPES.includes(type)) {
        conflicts.push({ type: "condition", field: sourceField, reason: "防具缺少有效部位", expected: ARMOR_TYPES, actual: type });
        return false;
      }
      if (!matchesQuality(armor, armorQuality)) {
        conflicts.push({ type: "condition", field: "equipment.armorQuality", reason: "指定防具不符合防具品质", expected: armorQuality, actual: armor.system?.quality, resources: [resourceIdentity(armor)] });
        return false;
      }
      if (!isAvailableArmor(armor)) {
        conflicts.push({ type: "condition", field: sourceField, reason: "同一防具部位已达到装备上限或资源重复", expected: armorLimit(type), actual: armorByType.get(type) || 0, resources: [resourceIdentity(armor)] });
        return false;
      }
      const copy = clone(armor);
      copy.type = "armor";
      copy._id = randomId();
      copy.system.equipped = true;
      draft.items.push(copy);
      armorItems.push({ uuid: resourceIdentity(armor), name: copy.name, type, quality: copy.system.quality, itemId: copy._id });
      usedArmor.add(resourceIdentity(armor));
      armorByType.set(type, (armorByType.get(type) || 0) + 1);
      return true;
    };

    for (const uuid of config.equipment.armorUuids) {
      const armor = byIdentity(snapshot.pools.armor, uuid);
      if (!armor) {
        conflicts.push({ type: "source", field: "equipment.armorUuids", reason: "指定防具不在当前资源范围", expected: uuid, actual: null });
        continue;
      }
      addArmor(armor, "equipment.armorUuids");
    }

    // 指定部位是硬条件；每个部位的数量由 typeCounts 控制，戒指/饰品可使用多件槽位。
    for (const type of config.equipment.armorTypes) {
      const requiredCount = config.equipment.armorTypeCounts?.[type] || 1;
      while ((armorByType.get(type) || 0) < requiredCount) {
        const candidate = snapshot.pools.armor.find(item => item.system?.type === type && isAvailableArmor(item));
        if (!candidate || !addArmor(candidate, "equipment.armorTypes")) {
          conflicts.push({ type: "condition", field: "equipment.armorTypes", reason: "当前防具范围无法满足指定部位数量", expected: `${type} × ${requiredCount}`, actual: `${type} × ${armorByType.get(type) || 0}` });
          break;
        }
      }
    }

    const minimumCount = Math.max(config.equipment.armorMinCount, armorItems.length);
    const availableArmor = () => snapshot.pools.armor.filter(isAvailableArmor);
    const fillTo = target => {
      while (armorItems.length < target) {
        const candidates = availableArmor();
        const armor = choose(rng, candidates);
        if (!armor || !addArmor(armor, "equipment.armorMinCount")) break;
      }
    };
    // 最低件数始终是硬下限；“不额外穿戴”只表示达到下限后不继续随机增加。
    fillTo(minimumCount);
    if (armorItems.length < minimumCount) {
      conflicts.push({ type: "condition", field: "equipment.armorMinCount", reason: "当前防具范围无法满足最低穿戴件数", expected: minimumCount, actual: armorItems.length });
    } else if (config.equipment.armorFillMode === "random") {
      const extraCandidates = availableArmor();
      const extraMax = Math.min(config.equipment.armorRandomExtraMax, extraCandidates.length);
      const target = minimumCount + randomInteger(rng, 0, extraMax);
      fillTo(target);
    }
    draft.equipment.armor = armorItems;
    return conflicts;
  }

  /** 构筑纯内存草案；新模型在合法资源和悟性预算内选取，不依赖整个人物重抽碰运气。 */
  _buildDraft(snapshot, index, rng, decisionRolls = new Map()) {
    const config = snapshot.config;
    if (snapshot.conflicts?.length) {
      return { draftId: randomId(), requestId: config.requestId, configVersion: CHARACTER_GENERATION_VERSION,
        name: `${config.namePrefix}${config.quantity > 1 ? index + 1 : ""}`, config: clone(config),
        conflicts: clone(snapshot.conflicts), warnings: [], decisions: [], items: [], status: "conflict" };
    }
    const initialNeigong = this._selectNeigongs(snapshot, config, rng, decisionRolls);
    let meridians = this._solveMeridians(initialNeigong.selected, snapshot.pools.neigong, config, rng);
    let neigong = this._coordinateRunNeigong(initialNeigong, config, rng, decisionRolls);
    let wuxue = this._selectWuxue(snapshot, config, rng, { runNeigong: neigong.run, decisionRolls });
    // 主修固定、双方随机或运行境界未固定时，不能因首次抽中的内功状态无匹配对象就判失败。
    // 穷举剩余运行来源/可达阶段；附修、经脉和品阶限制仍由原选择器完整校验。
    if (config.wuxue.model === "primary" && (!config.neigong.runUuid || config.neigong.runStage == null)
      && !neigong.conflicts.length && !meridians.conflicts.length && wuxue.conflicts.length
      && !planGenerationWuxue(snapshot, config, rng, { decisionRolls }).conflicts.length) {
      const alternatives = snapshot.pools.neigong.filter(source => (!config.neigong.runUuid || sourceId(source) === config.neigong.runUuid)
        && (config.neigong.runTier == null || source.system?.tier === config.neigong.runTier)
        && (config.neigong.runElement === "auto" || source.system?.element === config.neigong.runElement))
        .flatMap(source => (config.neigong.runStage ? [config.neigong.runStage] : [1, 2, 3])
        .map(stage => ({ uuid: sourceId(source), stage })));
      while (alternatives.length) {
        const choice = choose(rng, alternatives);
        alternatives.splice(alternatives.indexOf(choice), 1);
        const selection = this._selectNeigongs(snapshot, config, rng, decisionRolls, choice);
        if (selection.conflicts.length) continue;
        const solved = this._solveMeridians(selection.selected, snapshot.pools.neigong, config, rng);
        if (solved.conflicts.length) continue;
        const planned = this._selectWuxue(snapshot, config, rng, { runNeigong: selection.run, decisionRolls });
        if (planned.conflicts.length) continue;
        meridians = solved;
        neigong = selection;
        wuxue = planned;
        break;
      }
    }
    const conflicts = [...neigong.conflicts, ...meridians.conflicts, ...wuxue.conflicts];
    const primary = wuxue.primary ? assignmentSummary(wuxue.primary) : null;
    const additionalWuxue = wuxue.primary
      ? wuxue.selected.filter(item => resourceIdentity(item) !== resourceIdentity(wuxue.primary))
      : wuxue.selected;
    const draft = {
      draftId: randomId(), evaluationId: randomId(), requestId: config.requestId, configVersion: CHARACTER_GENERATION_VERSION,
      name: `${config.namePrefix}${config.quantity > 1 ? index + 1 : ""}`, actorType: config.actorType,
      config: clone(config), sourceSnapshot: { requestId: config.requestId, configVersion: CHARACTER_GENERATION_VERSION },
      neigong: neigong.selected.map(assignmentSummary), runNeigongId: neigong.run?._id || "",
      runNeigong: neigong.run ? assignmentSummary(neigong.run) : null,
      jingmai: { ...meridians.result, xuanguanBroken: config.jingmai.xuanguanBroken, adjustments: meridians.adjustments || [] },
      wuxue: wuxue.selected.map((item, itemIndex) => ({
        ...assignmentSummary(item),
        // 选择回溯时资源会变化，但分类槽位顺序保持稳定；配套投骰使用这个槽位身份，不能使用随机 Item ID。
        slotKey: `${itemCategory(item) || "wuxue"}:${itemIndex}`
      })), primary, equipment: {}, stats: {}, items: [], conflicts,
      wuxueCounts: Object.fromEntries(["wuxue", "sanshou", "qinggong", "zhenfa"].map(category => [category, wuxue.selected.filter(item => itemCategory(item) === category).length])),
      wuxueTierCounts: Object.fromEntries([1, 2, 3].map(tier => [String(tier), wuxue.selected.filter(item => itemCategory(item) === "wuxue" && integer(item.system?.tier, 1) === tier).length])),
      additionalWuxueCount: additionalWuxue.filter(item => itemCategory(item) === "wuxue").length,
      additionalWuxueTierCounts: Object.fromEntries([1, 2, 3].map(tier => [String(tier), additionalWuxue.filter(item => itemCategory(item) === "wuxue" && integer(item.system?.tier, 1) === tier).length])),
      decisions: [], warnings: [], status: conflicts.length ? "conflict" : "ready"
    };
    // 物品统一从已冻结来源复制，写入新的内嵌 ID；草案源数据和派生摘要分开保存。
    draft.items.push(...neigong.selected.map(item => {
      const copy = preparedItemData(item, "neigong");
      copy._id = item._id;
      return copy;
    }));
    for (const item of wuxue.selected) {
      const copy = preparedItemData(item, "wuxue");
      copy._id = item._id;
      draft.items.push(copy);
    }
    const run = neigong.selected.find(item => item._id === draft.runNeigongId);
    if (run) {
      for (const item of neigong.selected) item.system.active = item._id === draft.runNeigongId;
    }
    draft.stats.assigned = {};
    draft.stats.freePoints = config.stats.freePoints;
    draft.jingmai.selected = meridians.result.selected;
    conflicts.push(...this._selectEquipment(snapshot, config, draft, rng, decisionRolls));
    rebuildDraftSystem(draft);
    // draft.items 已剥离运行时派生字段；这里使用刚完成分配的内存快照，保持预览摘要与实际学会状态一致。
    const fixedWuxing = calculateFixedWuxing(config, wuxue.selected);
    draft.wuxing = {
      ...calculateWuxingContribution(wuxue.selected),
      fixedBaseline: fixedWuxing.total,
      allowedLimit: allowedWuxingLimit(config)
    };
    draft.healing = countLearnedHealing(wuxue.selected);
    for (const item of draft.items) {
      if (item._id === draft.runNeigongId) item.system.active = true;
      if (item.type === "neigong") item.system.sourceBreakdown = { general: 0, specific: item.system.xpInvested || 0 };
    }
    if (draft.healing.count < config.wuxue.healingCount && config.wuxue.healingRequired) {
      conflicts.push({ type: "condition", field: "wuxue.healingCount", reason: "实际已学治疗套路不足", expected: config.wuxue.healingCount, actual: draft.healing.count });
    }
    if (draft.wuxing.allowedLimit != null && draft.wuxing.total > draft.wuxing.allowedLimit) {
      conflicts.push({ type: "condition", field: "wuxue.wuxingLimit", reason: "指定境界与实际招式贡献无法满足悟性上限", expected: draft.wuxing.allowedLimit, actual: draft.wuxing.total });
    }
    for (const item of draft.wuxue) {
      const isPrimary = draft.primary ? item.itemId === draft.primary.itemId : item === draft.wuxue[0];
      const specified = fixedWuxueIdentities(config).has(item.uuid);
      const pinnedPair = Boolean(isPrimary && specified && config.neigong.runUuid);
      if (!isPrimary && (!config.matchAllRandomWuxue || specified)) continue;
      const core = item.coreMove;
      const decision = {
        slot: item.itemId,
        slotKey: relationDecisionKey({ slotKey: `wuxue:${item.slotKey || item.itemId}` }, "compatibility"),
        relation: "compatibility", evaluated: Boolean(core && draft.runNeigong), result: "unevaluated", pinnedPair
      };
      if (core && draft.runNeigong) {
        const runData = draft.items.find(candidate => candidate._id === draft.runNeigongId);
        const match = evaluateMoveCompatibility(runData, core, { matchStandard: config.matchStandard, actorStats: {} });
        decision.result = match.status; decision.compatibility = match.compatibility; decision.scaling = match.scaling; decision.reason = match.reason;
        Object.assign(decision, generationMatchDecision(config, item.slotKey, decisionRolls, rng));
      }
      draft.decisions.push(decision);
    }
    draft.conflicts = conflicts;
    draft.status = conflicts.length ? "conflict" : "ready";
    return draft;
  }

  /**
   * 在装备已确定后先评估真实点池，再分配属性并复核；同一草案的匹配判定在此集中完成。
   * @param {object} draft - 当前内存草案。
   * @param {Function} rng - 当前请求 RNG。
   * @param {Map<string, number>} [decisionRolls] - 本次生成请求按稳定槽位保存的配套投骰。
   * @returns {Promise<object>} 带评估摘要和冲突的草案。
   */
  async _evaluateDraft(draft, rng, decisionRolls = new Map()) {
    const config = draft.config;
    draft.warnings ??= [];
    const beforeAllocation = await evaluateGenerationDraft(draft);
    if (!beforeAllocation.prepared) {
      draft.conflicts.push({ type: "evaluation", field: "actor.prepareData", reason: "装备/内嵌文档准备未完整完成，已阻止分配属性", expected: "prepared=true", actual: beforeAllocation.errors });
    }
    const availablePoints = Math.max(0, integer(beforeAllocation.derived?.freePoints, config.stats.freePoints));
    draft.stats.availableFreePoints = availablePoints;
    const preferredStats = draft.items.filter(item => item.type === "wuxue")
      .flatMap(item => (item.system?.moves || []).flatMap(move =>
        (move.calculation?.scalings || move.scalings || []).map(scaling => scaling.prop)));
    let statsStrategy = config.stats.strategy;
    if (statsStrategy === "match") {
      const matchRoll = getDecisionRoll(decisionRolls, "stats:allocation:match", rng);
      draft.stats.matchDecision = matchRoll < number(config.synergyProbability, 0) / 100;
      if (!draft.stats.matchDecision) statsStrategy = "balanced";
    }
    draft.stats.assigned = allocateAttributePoints({
      points: availablePoints,
      strategy: statsStrategy,
      preferred: preferredStats,
      rng
    });
    rebuildDraftSystem(draft);
    const assignedTotal = Object.values(draft.stats.assigned || {}).reduce((sum, value) => sum + number(value), 0);
    // 没有可分配点时，分配前后的 Actor 数据完全相同；复用第一次准备结果，
    // 避免默认配置下为相同草案重复执行一次完整 V14 文档生命周期。
    const evaluation = assignedTotal === 0 ? beforeAllocation : await evaluateGenerationDraft(draft);
    // 配套属性适配只看运行内功本身提供的 current.stats；角色总属性包含基础值、
    // 自由点和装备，不能代表“内功对招式取值的贡献”。
    const actorStats = evaluation.derived?.runNeigongStats || {};
    for (const decision of draft.decisions) {
      const summary = draft.wuxue.find(item => item.itemId === decision.slot);
      const runData = draft.items.find(candidate => candidate._id === draft.runNeigongId);
      const match = evaluateMoveCompatibility(runData, summary?.coreMove, {
        matchStandard: config.matchStandard,
        actorStats
      });
      decision.evaluated = match.compatibility != null || match.scaling != null;
      decision.result = match.status;
      decision.compatibility = match.compatibility;
      decision.scaling = match.scaling;
      decision.reason = match.reason;
      const compatibilityRoll = decision.compatibilityRoll ?? getDecisionRoll(
        decisionRolls, relationDecisionKey(decision, "compatibility"), rng
      );
      const scalingRoll = decision.scalingRoll ?? getDecisionRoll(
        decisionRolls, relationDecisionKey(decision, "scaling"), rng
      );
      decision.compatibilityRoll = compatibilityRoll;
      decision.scalingRoll = scalingRoll;
      decision.compatibilityApplied = compatibilityRoll < number(config.synergyProbability, 0) / 100;
      decision.scalingApplied = scalingRoll < number(config.synergyProbability, 0) / 100;
      const threshold = GENERATION_MATCH_THRESHOLDS[config.matchStandard]?.compatibility
        ?? GENERATION_MATCH_THRESHOLDS.standard.compatibility;
      const scalingThreshold = GENERATION_MATCH_THRESHOLDS[config.matchStandard]?.scaling
        ?? GENERATION_MATCH_THRESHOLDS.standard.scaling;
      const destination = decision.pinnedPair ? draft.warnings : draft.conflicts;
      const resource = draft.items.find(candidate => candidate._id === decision.slot);
      if ((decision.compatibilityApplied || decision.pinnedPair) && match.compatibility != null && match.compatibility < threshold) {
        destination.push({ type: decision.pinnedPair ? "warning" : "condition", field: `wuxue.${decision.slot}.compatibility`, fieldLabel: `${summary?.name || resource?.name || "主修武学"} · 相性`, reason: decision.pinnedPair ? "运行内功和主修均已指定，保留指定组合；代表招式相性低于匹配门槛" : "代表招式相性未达到匹配门槛", expected: threshold, actual: match.compatibility, resources: [resourceIdentity(runData), resourceIdentity(resource)] });
      }
      if ((decision.scalingApplied || decision.pinnedPair) && match.scaling != null && match.scaling < scalingThreshold) {
        destination.push({ type: decision.pinnedPair ? "warning" : "condition", field: `wuxue.${decision.slot}.scaling`, fieldLabel: `${summary?.name || resource?.name || "主修武学"} · 属性适配`, reason: decision.pinnedPair ? "运行内功和主修均已指定，保留指定组合；代表招式属性适配低于匹配门槛" : "代表招式属性适配未达到匹配门槛", expected: scalingThreshold, actual: match.scaling, resources: [resourceIdentity(runData), resourceIdentity(resource)] });
      }
    }
    const assignedPoints = Object.values(draft.stats.assigned || {}).reduce((sum, value) => sum + number(value), 0);
    const constraints = { ...evaluation.constraints, points: assignedPoints <= availablePoints };
    if (!constraints.wuxing && !draft.conflicts.some(conflict => conflict.field === "wuxue.wuxingLimit")) {
      draft.conflicts.push({ type: "condition", field: "wuxue.wuxingLimit", reason: "实际角色派生的招式贡献超过配置上限", expected: config.wuxue.wuxingLimit, actual: evaluation.derived?.wuxingContribution?.total });
    }
    if (!constraints.points) {
      draft.conflicts.push({ type: "condition", field: "stats.freePoints", reason: "属性分配超过装备、经脉和被动修正后的实际点池", expected: availablePoints, actual: assignedPoints });
    }
    if (!evaluation.prepared) {
      draft.conflicts.push({ type: "evaluation", field: "actor.prepareData", reason: "角色或内嵌物品准备未完整完成，已阻止创建", expected: "prepared=true", actual: evaluation.errors });
    }
    draft.evaluation = {
      draftId: draft.draftId, requestId: draft.requestId, configVersion: draft.configVersion,
      prepared: evaluation.prepared,
      valid: evaluation.prepared && !draft.conflicts.length && Object.values(constraints).every(Boolean),
      derived: evaluation.derived, errors: evaluation.errors, finiteErrors: evaluation.finiteErrors,
      constraints
    };
    draft.status = draft.evaluation.valid ? "ready" : "conflict";
    return draft;
  }

  /**
   * 生成一批只存在于内存的草案；新模型的构筑冲突直接展示，旧模型/武器关系保留有限回溯。
   * @param {object} snapshot - snapshot() 返回的冻结请求。
   * @param {object} [options] - seed/rng/attempts。
   * @returns {Promise<object>} 草案、评估结果与摘要。
   */
  async generate(snapshot, options = {}) {
    const config = snapshot.config;
    const rng = options.rng || this.rngFactory(options.seed || Date.now());
    const drafts = [];
    for (let index = 0; index < config.quantity; index += 1) {
      let draft = null;
      let last = null;
      const decisionRolls = new Map();
      const attempts = Math.max(1, Math.min(GENERATION_MAX_ATTEMPTS, integer(options.attempts, GENERATION_MAX_ATTEMPTS)));
      let tried = 0;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        tried += 1;
        const candidate = this._buildDraft(snapshot, index, rng, decisionRolls);
        last = candidate;
        const weaponRetry = candidate.conflicts.length > 0 && candidate.conflicts.every(conflict =>
          conflict.field === "equipment.weaponCompatibility" && !config.wuxue?.primary?.uuid
          && fixedForCategory(config.wuxue?.fixed || {}, "wuxue").length === 0);
        if (config.wuxue?.model === "primary" && candidate.conflicts.length && !weaponRetry) {
          // 构筑器已在约束内搜索；已证明的配置冲突直接展示，不再整批重抽或伪造预算警告。
          candidate.evaluation = { valid: false, prepared: false, constraints: {}, errors: [] };
          candidate.status = "conflict";
          draft = candidate;
          break;
        }
        // 资源范围、数量、品阶和目标境界属于构筑前硬条件；继续重复抽取只会重复构造同一类
        // 冲突，尤其是“范围内只有 N 套能达到目标境界”时会把预览无谓拖慢。只有完成纯构筑
        // 后的配套关系不匹配才进入有限回溯。
        const canRetryWeaponCompatibility = conflict => conflict.field === "equipment.weaponCompatibility"
          && !config.wuxue.primary?.uuid
          && fixedForCategory(config.wuxue.fixed || {}, "wuxue").length === 0;
        const isRetryableConflict = conflict => conflict.field === "wuxue.wuxingLimit"
          || conflict.field?.endsWith(".compatibility")
          || conflict.field?.endsWith(".scaling")
          || canRetryWeaponCompatibility(conflict);
        // 随机境界造成的悟性超限与配套不匹配都属于可重抽结果；来源缺失、输入
        // 不合法和数量不足仍立即停止，避免把确定性错误伪装成随机失败。
        if (candidate.conflicts.length && !candidate.conflicts.every(isRetryableConflict)) break;
        if (candidate.conflicts.length) continue;
        // 相性分数完全由内功/代表招式属性决定；100% 匹配时，低于相性门槛的组合
        // 不可能被后续 Actor 属性评估挽回，先在纯计算边界淘汰，避免无意义地构造完整 Actor。
        const compatibilityThreshold = GENERATION_MATCH_THRESHOLDS[config.matchStandard]?.compatibility
          ?? GENERATION_MATCH_THRESHOLDS.standard.compatibility;
        const impossibleCompatibility = config.wuxue?.model !== "primary" && config.synergyProbability >= 100
          && candidate.decisions.some(decision => decision.compatibility != null
            && decision.compatibility < compatibilityThreshold
            && (decision.compatibilityApplied ?? true) && !decision.pinnedPair);
        if (impossibleCompatibility) continue;
        const evaluated = await this._evaluateDraft(candidate, rng, decisionRolls);
        last = evaluated;
        const hasRetryableMismatch = evaluated.conflicts.some(isRetryableConflict);
        if (config.wuxue?.model === "primary" || !hasRetryableMismatch || !evaluated.conflicts.every(isRetryableConflict)) {
          draft = evaluated;
          break;
        }
      }
      draft ||= last;
      if (!draft) continue;
      const retryableMismatch = draft.conflicts.some(conflict => conflict.field?.endsWith(".compatibility")
        || conflict.field?.endsWith(".scaling")
        || (conflict.field === "equipment.weaponCompatibility"
          && !config.wuxue.primary?.uuid
          && fixedForCategory(config.wuxue.fixed || {}, "wuxue").length === 0));
      if (retryableMismatch && tried === attempts && config.wuxue?.model !== "primary") {
        draft.conflicts.push({ type: "budget", field: "generation", reason: "本次搜索达到预算，尚不能确定配置是否有解", expected: attempts, actual: tried });
        if (draft.evaluation) draft.evaluation.valid = false;
        draft.status = "conflict";
      }
      if (!draft.evaluation) {
        if (tried === attempts && draft.conflicts.length && draft.conflicts.every(conflict => conflict.type === "condition")) {
          draft.conflicts.push({ type: "budget", field: "generation", reason: "本次搜索达到预算，尚不能确定配置是否有解", expected: attempts, actual: tried });
        }
        draft = await this._evaluateDraft(draft, rng, decisionRolls);
      }
      drafts.push(draft);
    }
    return { requestId: config.requestId, configVersion: CHARACTER_GENERATION_VERSION, drafts, sourceSnapshot: snapshot, valid: drafts.length > 0 && drafts.every(draft => draft.evaluation.valid) };
  }

  /**
   * 持久化一张已评估草案；folderId 由批量创建复用同一批次文件夹。
   * @param {object} draft - 当前预览草案。
   * @param {{folderId?: string|null}} options - 可选 Actor 文件夹 ID。
   * @returns {Promise<object>} 实际 Actor 身份或失败原因。
   */
  async createDraft(draft, { folderId = null } = {}) {
    if (!globalThis.game?.user?.isGM) return { status: "failed", draftId: draft?.draftId, reason: "只有 GM 可以创建随机 NPC" };
    if (!draft?.evaluation?.valid) return { status: "failed", draftId: draft?.draftId, reason: "草案尚未通过准备与硬性条件校验" };
    if (draft.createResult?.status === "success") return draft.createResult;
    const task = async () => {
      const ActorClass = globalThis.CONFIG?.Actor?.documentClass;
      if (!ActorClass?.create) return { status: "failed", draftId: draft.draftId, reason: "当前 Actor 创建 API 尚未注册" };
      if (!folderId) {
        try {
          const FolderClass = globalThis.CONFIG?.Folder?.documentClass || globalThis.Folder;
          if (!FolderClass?.create) return { status: "failed", draftId: draft.draftId, reason: "当前 Folder 创建 API 尚未注册" };
          const folder = await FolderClass.create({
            name: this._makeGenerationFolderName(draft.config), type: "Actor"
          }, { render: false });
          folderId = folder?.id || null;
          if (!folderId) return { status: "failed", draftId: draft.draftId, reason: "随机人物文件夹创建失败" };
        } catch (error) {
          return { status: "failed", draftId: draft.draftId, reason: `随机人物文件夹创建失败：${error?.message || error}` };
        }
      }
      const payload = makeEvaluationData(draft);
      payload.system = clone(draft.system);
      payload.items = draft.items.map(item => removeEmbeddedIds(item, { keepId: true }));
      payload.folder = folderId;
      try {
        const actor = await ActorClass.create(payload, { keepEmbeddedIds: true, render: false });
        if (!actor?.id) return { status: "failed", draftId: draft.draftId, reason: "Actor.create 返回空结果" };
        const updates = {};
        const hpMax = number(actor.system?.resources?.hp?.max);
        const mpMax = number(actor.system?.resources?.mp?.max);
        if (Number.isFinite(hpMax)) updates["system.resources.hp.value"] = hpMax;
        if (Number.isFinite(mpMax)) updates["system.resources.mp.value"] = mpMax;
        updates["system.resources.rage.value"] = 0;
        if (Object.keys(updates).length) await actor.update(updates);
        actor.prepareData?.();
        const createdItems = Array.from(actor.items || []);
        const createdRun = createdItems.find(item => item.id === draft.runNeigongId);
        const healing = countLearnedHealing(Array.from(actor.itemTypes?.wuxue || []));
        const createdWuxing = calculateWuxingContribution(createdItems
          .filter(item => item.type === "wuxue" || item.type === "sanshou"));
        const createdWuxingLimit = allowedWuxingLimit(draft.config);
        const freePoints = number(actor.system?.stats?.freePoints?.total, -1);
        const initialized = number(actor.system?.resources?.hp?.value) === hpMax
          && number(actor.system?.resources?.mp?.value) === mpMax
          && number(actor.system?.resources?.rage?.value) === 0;
        const plannedAssigned = Object.values(draft.stats?.assigned || {})
          .reduce((sum, value) => sum + number(value), 0);
        const valid = Boolean(createdRun)
          && (!draft.config.wuxue.healingRequired || healing.count >= draft.config.wuxue.healingCount)
          && (createdWuxingLimit == null || createdWuxing.total <= createdWuxingLimit)
          && Number.isFinite(freePoints) && freePoints >= 0
          && plannedAssigned <= number(draft.stats?.availableFreePoints, plannedAssigned)
          && initialized;
        const result = valid
          ? { status: "success", draftId: draft.draftId, actorId: actor.id, actorUuid: actor.uuid, actor, reason: "已创建并完成资源初始化" }
          : { status: "failed", draftId: draft.draftId, actorId: actor.id, actorUuid: actor.uuid, actor, reason: "创建后复核失败，请 GM 检查角色目录中的残留 Actor" };
        draft.createResult = result;
        return result;
      } catch (error) {
        const result = { status: "failed", draftId: draft.draftId, reason: error?.message || String(error) };
        draft.createResult = result;
        return result;
      }
    };
    const result = this._createLock.then(task, task);
    this._createLock = result.catch(() => undefined);
    return result;
  }

  _makeGenerationFolderName(config = {}) {
    const prefix = String(config.namePrefix || "随机侠客").trim() || "随机侠客";
    const stamp = new Date().toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).replace(/[/:]/g, "-");
    return `随机人物 · ${prefix} · ${stamp}`;
  }

  /** @returns {Promise<object[]>} 为本批次建立独立文件夹后，按预览顺序串行创建。 */
  async createAll(drafts = []) {
    if (!drafts.length) return [];
    let folderId = null;
    try {
      const FolderClass = globalThis.CONFIG?.Folder?.documentClass || globalThis.Folder;
      if (!FolderClass?.create) throw new Error("当前 Folder 创建 API 尚未注册");
      const folder = await FolderClass.create({
        name: this._makeGenerationFolderName(drafts[0].config), type: "Actor"
      }, { render: false });
      folderId = folder?.id || null;
      if (!folderId) throw new Error("Folder.create 返回空结果");
    } catch (error) {
      return drafts.map(draft => ({
        status: "failed", draftId: draft.draftId,
        reason: `随机人物文件夹创建失败：${error?.message || error}`
      }));
    }
    const results = [];
    for (const draft of drafts) results.push(await this.createDraft(draft, { folderId }));
    return results;
  }
}

export { CHARACTER_GENERATION_VERSION };
