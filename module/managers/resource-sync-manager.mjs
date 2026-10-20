/**
 * 角色资源合集同步管理器。
 *
 * 只扫描世界中的 character/npc Actor；匹配到系统合集资源后，原地更新规则数据和
 * 可对应的物品特效，保留角色投入、装备状态、数量和 Item ID。角色独立 Active Effect
 * 与其他 Actor 字段不在本模块的写入范围内。
 */

const { DialogV2 } = foundry.applications.api;

const TYPE_PACKS = Object.freeze({
  neigong: ["neigong"],
  wuxue: ["wuxue"],
  art_book: ["artbooks"],
  weapon: ["weapons"],
  armor: ["armor"],
  qizhen: ["qizhen"],
  consumable: ["consumables"],
  misc: ["misc"],
  trait: ["traits"]
});

const RESOURCE_FIELDS = Object.freeze({
  neigong: ["xpInvested", "sourceBreakdown", "active"],
  weapon: ["equipped", "quantity"],
  armor: ["equipped", "quantity"],
  qizhen: ["equipped", "quantity", "acupoint"],
  consumable: ["quantity"],
  misc: ["quantity"]
});

const RUNTIME_KEYS = new Set([
  "stage", "current", "progressData", "computedTier", "computedLevel", "maxLevel",
  "effectiveStage", "progress", "currentCost", "baseFeint", "formulaFields", "derived",
  "tooltip", "totalLevelBonus", "totalCheckBonus"
]);

const SYNCABLE_TYPES = new Set(Object.keys(TYPE_PACKS));

let activeRun = null;

const t = key => game.i18n.localize(`XJZL.Settings.ResourceSync.${key}`);

function clone(value) {
  return foundry.utils.deepClone(value ?? {});
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** 去掉 DataModel 的派生字段，避免比较时把内存计算值误当成合集源数据。 */
function stripRuntimeFields(value, type = "") {
  const result = clone(value);
  if (result && typeof result === "object") {
    for (const key of RUNTIME_KEYS) delete result[key];
  }
  if (type === "wuxue" && Array.isArray(result.moves)) {
    result.moves = result.moves.map(move => stripRuntimeFields(move));
  }
  if (type === "art_book" && Array.isArray(result.chapters)) {
    result.chapters = result.chapters.map(chapter => stripRuntimeFields(chapter));
  }
  return result;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function equalData(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function sourceSystem(source, type) {
  // _source 保留合集数据库中的原始规则；DataModel 的派生属性不应被写回角色。
  const raw = clone(source?._source?.system || source?.system?.toObject?.() || {});
  if (type === "wuxue") {
    const preparedMoves = source?.system?.moves || [];
    raw.moves = (raw.moves || []).map((move, index) => ({
      ...move,
      id: move.id || preparedMoves[index]?.id || foundry.utils.randomID()
    }));
  }
  if (type === "art_book") {
    const preparedChapters = source?.system?.chapters || [];
    raw.chapters = (raw.chapters || []).map((chapter, index) => ({
      ...chapter,
      id: chapter.id || preparedChapters[index]?.id || foundry.utils.randomID()
    }));
  }
  return stripRuntimeFields(raw, type);
}

function currentSystem(item, type) {
  return stripRuntimeFields(clone(item?._source?.system || item?.system?.toObject?.() || {}), type);
}

function preserveFields(next, current, type) {
  for (const field of RESOURCE_FIELDS[type] || []) {
    if (current[field] !== undefined) next[field] = clone(current[field]);
  }
  return next;
}

/**
 * 迁移招式/篇章的局部修为：稳定 ID 优先，名称仅在合集侧和旧数据侧都唯一时回退。
 * 招式合集大多没有把 id 写入 JSON，DataModel 会为它们运行时生成随机 ID，
 * 因此不能把招式 ID 当成跨合集加载稳定的主键；重复名称则暂停本项同步，避免静默错迁。
 */
function preserveNestedProgress(next, current, key, label, result) {
  const oldEntries = Array.isArray(current?.[key]) ? current[key] : [];
  const used = new Set();
  const nextEntries = Array.isArray(next?.[key]) ? next[key] : [];
  const assignments = new Map();
  const ambiguous = new Set();
  const assignedIds = new Map();

  const addAmbiguous = (entry, index) => {
    ambiguous.add(index);
    result.details.push(t("Details.AmbiguousEntry")
      .replace("{label}", label)
      .replace("{name}", entry?.name || index + 1));
    result.blocked = true;
  };

  // 先完成全部 ID 匹配，避免前面的名称回退抢走后面本可按 ID 对应的旧条目。
  for (const [index, entry] of nextEntries.entries()) {
    if (!entry?.id) continue;
    if (assignedIds.has(entry.id)) {
      addAmbiguous(entry, index);
      continue;
    }
    assignedIds.set(entry.id, index);
    const idMatches = oldEntries
      .map((old, oldIndex) => ({ old, oldIndex }))
      .filter(({ old }) => old?.id === entry.id);
    if (idMatches.length > 1) {
      addAmbiguous(entry, index);
      continue;
    }
    if (idMatches.length === 1) {
      assignments.set(index, idMatches[0].oldIndex);
      used.add(idMatches[0].oldIndex);
    }
  }

  // 名称回退必须同时满足两侧唯一：旧角色侧多个同名条目，或合集侧多个仍待匹配的同名条目，
  // 都无法证明它们的修为归属。歧义直接跳过整个资源，避免按数组顺序静默迁移。
  const remainingSourceNameCounts = new Map();
  for (const [index, entry] of nextEntries.entries()) {
    if (assignments.has(index) || ambiguous.has(index) || !entry?.name) continue;
    remainingSourceNameCounts.set(entry.name, (remainingSourceNameCounts.get(entry.name) || 0) + 1);
  }
  for (const [index, entry] of nextEntries.entries()) {
    if (assignments.has(index) || ambiguous.has(index)) continue;
    const nameMatches = oldEntries
      .map((old, oldIndex) => ({ old, oldIndex }))
      .filter(({ old, oldIndex }) => !used.has(oldIndex) && old?.name === entry?.name);
    const sourceNameMatches = remainingSourceNameCounts.get(entry?.name) || 0;
    if (sourceNameMatches === 1 && nameMatches.length === 1) {
      assignments.set(index, nameMatches[0].oldIndex);
      used.add(nameMatches[0].oldIndex);
    }
    else if (sourceNameMatches > 1 || nameMatches.length > 1) addAmbiguous(entry, index);
  }

  next[key] = nextEntries.map((entry, index) => {
    const oldIndex = assignments.get(index);
    if (oldIndex === undefined) {
      if (!ambiguous.has(index)) {
        result.details.push(t("Details.NewEntry").replace("{label}", label).replace("{name}", entry?.name || index + 1));
      }
      return entry;
    }
    const old = oldEntries[oldIndex];
    entry.id = old.id || entry.id || foundry.utils.randomID();
    if (old.img !== undefined) entry.img = clone(old.img);
    if (old.xpInvested !== undefined) entry.xpInvested = old.xpInvested;
    if (old.sourceBreakdown !== undefined) entry.sourceBreakdown = clone(old.sourceBreakdown);
    return entry;
  });
  for (const [oldIndex, old] of oldEntries.entries()) {
    if (used.has(oldIndex)) continue;
    if ((old?.xpInvested || 0) > 0) {
      result.details.push(t("Details.MissingEntry").replace("{label}", label).replace("{name}", old?.name || oldIndex + 1));
      result.partial = true;
    }
  }
}

function buildDesiredSystem(item, source, result) {
  const type = item.type;
  const current = currentSystem(item, type);
  const next = sourceSystem(source, type);
  preserveFields(next, current, type);
  if (type === "art_book" && current.img !== undefined) next.img = clone(current.img);
  if (type === "wuxue") preserveNestedProgress(next, current, "moves", "招式", result);
  if (type === "art_book") preserveNestedProgress(next, current, "chapters", "篇章", result);
  return next;
}

function rawEffectData(effect) {
  return clone(effect?.toObject?.() || effect?._source || effect || {});
}

function effectData(effect) {
  const data = rawEffectData(effect);
  delete data._id;
  delete data._stats;
  // Foundry may rewrite embedded AE origin to the owning Item UUID; it is not resource content.
  delete data.origin;
  return data;
}

function effectIdentity(effect) {
  const data = rawEffectData(effect);
  return {
    id: data._id || "",
    slug: foundry.utils.getProperty(data, "flags.xjzl-system.slug") || "",
    name: data.name || ""
  };
}

function effectSnapshots(item) {
  return [...(item?.effects || [])].map(effect => {
    const data = rawEffectData(effect);
    delete data._stats;
    return data;
  });
}

function findEffectMatch(desiredIdentity, current, used) {
  const matchers = [
    desiredIdentity.id && (effect => effectIdentity(effect).id === desiredIdentity.id),
    desiredIdentity.slug && (effect => effectIdentity(effect).slug === desiredIdentity.slug),
    desiredIdentity.name && (effect => effectIdentity(effect).name === desiredIdentity.name)
  ].filter(Boolean);
  for (const matcher of matchers) {
    const index = current.findIndex((effect, currentIndex) => !used.has(currentIndex) && matcher(effect));
    if (index !== -1) return index;
  }
  return -1;
}

function effectContentEqual(currentEffect, desiredData) {
  const currentData = effectData(currentEffect);
  const currentFlags = currentData.flags?.["xjzl-system"];
  const desiredFlags = desiredData.flags?.["xjzl-system"];
  // These fields are generated by the ActiveEffect lifecycle when the source omits them.
  // A source that explicitly defines one still wins, which keeps authored values intact.
  if (currentFlags && desiredFlags?.slug === undefined) delete currentFlags.slug;
  if (currentFlags && desiredFlags?.stacks === undefined) delete currentFlags.stacks;
  if (currentFlags && desiredFlags?.baseChanges === undefined) delete currentFlags.baseChanges;
  return equalData(pruneEmptyRecords(currentData), pruneEmptyRecords(clone(desiredData)));
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 比较规则时去掉由字段删除留下的空父对象，避免仅剩运行时字段时重复同步。 */
function pruneEmptyRecords(value) {
  if (Array.isArray(value)) return value.map(pruneEmptyRecords);
  if (!isPlainRecord(value)) return value;
  for (const key of Object.keys(value)) {
    const child = pruneEmptyRecords(value[key]);
    if (isPlainRecord(child) && Object.keys(child).length === 0) delete value[key];
    else value[key] = child;
  }
  return value;
}

function collectRemovedPaths(current, desired, prefix = "", paths = []) {
  if (!isPlainRecord(current) || !isPlainRecord(desired)) return paths;
  for (const key of Object.keys(current)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!(key in desired)) {
      paths.push(path);
      continue;
    }
    collectRemovedPaths(current[key], desired[key], path, paths);
  }
  return paths;
}

function isGeneratedEffectPath(path) {
  return [
    "flags.xjzl-system.slug",
    "flags.xjzl-system.stacks",
    "flags.xjzl-system.baseChanges"
  ].includes(path);
}

/** 将完整路径转换为 Foundry 的嵌套删除语法，-= 必须位于被删除字段名之前。 */
function toDeletionKey(path) {
  const separator = path.lastIndexOf(".");
  if (separator === -1) return `-=${path}`;
  return `${path.slice(0, separator)}.-=${path.slice(separator + 1)}`;
}

/** 构造完整的 AE 规则更新，删除合集已移除的字段并重建单层基准。 */
function prepareEffectUpdateData(existing, desiredData) {
  const updateData = clone(desiredData);
  const systemChanges = updateData.system?.changes;
  if (systemChanges !== undefined) {
    updateData.flags ||= {};
    updateData.flags["xjzl-system"] ||= {};
    if (updateData.flags["xjzl-system"].baseChanges === undefined) {
      updateData.flags["xjzl-system"].baseChanges = clone(systemChanges);
    }
  }
  const currentData = effectData(existing);
  for (const path of collectRemovedPaths(currentData, updateData)) {
    if (isGeneratedEffectPath(path)) continue;
    updateData[toDeletionKey(path)] = null;
  }
  return updateData;
}

function effectsEqual(item, source) {
  const current = [...(item?.effects || [])];
  const desired = [...(source?.effects || [])].map(effect => ({
    data: effectData(effect),
    identity: effectIdentity(effect)
  }));
  if (current.length !== desired.length) return false;
  const used = new Set();
  for (const entry of desired) {
    let matchIndex = findEffectMatch(entry.identity, current, used);
    if (matchIndex === -1) {
      matchIndex = current.findIndex((_effect, index) => !used.has(index));
    }
    if (matchIndex === -1 || !effectContentEqual(current[matchIndex], entry.data)) return false;
    used.add(matchIndex);
  }
  return true;
}

/** 尽量原地更新物品特效，只有无法对应的新增/遗留特效才创建或删除。 */
async function syncItemEffects(item, source, updateOptions) {
  const current = [...(item?.effects || [])];
  const desired = [...(source?.effects || [])].map(effect => ({
    data: effectData(effect),
    identity: effectIdentity(effect)
  }));
  const used = new Set();
  const unmatchedDesired = [];
  let updated = 0;

  for (const entry of desired) {
    const matchIndex = findEffectMatch(entry.identity, current, used);
    if (matchIndex === -1) {
      unmatchedDesired.push(entry);
      continue;
    }
    used.add(matchIndex);
    const existing = current[matchIndex];
    if (!effectContentEqual(existing, entry.data)) {
      // 不提交 origin，保留现有效果与其外部引用之间的关系；只更新规则内容。
      const updatedEffect = await existing.update(prepareEffectUpdateData(existing, entry.data), updateOptions);
      if (!updatedEffect) throw new Error(`Active Effect 更新被取消：${existing.name || existing.id}`);
      updated += 1;
    }
  }

  // 名称或 slug 同时变化时没有语义键可用；只有双方数量完全相同，才按剩余顺序
  // 迁移，避免把新增/删除误认为同一条特效。这样可以尽量保留旧特效的身份。
  const remainingCurrent = current
    .map((effect, index) => ({ effect, index }))
    .filter(({ index }) => !used.has(index));
  const toCreate = [];
  if (unmatchedDesired.length === remainingCurrent.length) {
    for (let index = 0; index < unmatchedDesired.length; index += 1) {
      const entry = unmatchedDesired[index];
      const match = remainingCurrent[index];
      used.add(match.index);
      if (!effectContentEqual(match.effect, entry.data)) {
        const updatedEffect = await match.effect.update(prepareEffectUpdateData(match.effect, entry.data), updateOptions);
        if (!updatedEffect) throw new Error(`Active Effect 更新被取消：${match.effect.name || match.effect.id}`);
        updated += 1;
      }
    }
  } else {
    toCreate.push(...unmatchedDesired.map(entry => entry.data));
  }

  const toDelete = current.filter((_effect, index) => !used.has(index));
  // Foundry 的 preDelete/preCreate 可以取消单个文档而不抛异常；返回数量不足必须进入统一回滚。
  if (toDelete.length > 0) {
    const deletedEffects = await item.deleteEmbeddedDocuments("ActiveEffect", toDelete.map(effect => effect.id), updateOptions);
    if (!Array.isArray(deletedEffects) || deletedEffects.length !== toDelete.length) {
      throw new Error(`Active Effect 删除不完整：需要 ${toDelete.length} 个，实际 ${deletedEffects?.length || 0} 个`);
    }
  }
  if (toCreate.length > 0) {
    // 新建模板保留空 origin；光环/脚本入口会按实际复制来源补齐正确的来源 AE。
    const createdEffects = await item.createEmbeddedDocuments("ActiveEffect", toCreate, updateOptions);
    if (!Array.isArray(createdEffects) || createdEffects.length !== toCreate.length) {
      throw new Error(`Active Effect 创建不完整：需要 ${toCreate.length} 个，实际 ${createdEffects?.length || 0} 个`);
    }
  }
  return { updated, created: toCreate.length, removed: toDelete.length };
}

function buildIndexKey(type, name) {
  return `${type}\u0000${name}`;
}

async function buildSourceIndex() {
  const allowedPacks = new Set(Object.values(TYPE_PACKS).flat());
  const index = new Map();
  for (const pack of game.packs.filter(p =>
    p.metadata?.type === "Item"
    && p.metadata?.system === "xjzl-system"
    && allowedPacks.has(p.metadata.name)
  )) {
    const entries = await pack.getIndex({ fields: ["name", "type"] });
    for (const entry of entries) {
      if (!SYNCABLE_TYPES.has(entry.type)) continue;
      if (!(TYPE_PACKS[entry.type] || []).includes(pack.metadata.name)) continue;
      const key = buildIndexKey(entry.type, entry.name);
      const list = index.get(key) || [];
      list.push({
        uuid: entry.uuid || `Compendium.${pack.collection}.${entry._id}`,
        packName: pack.metadata.name,
        packLabel: pack.metadata.label || pack.metadata.name,
        name: entry.name,
        type: entry.type
      });
      index.set(key, list);
    }
  }
  return index;
}

async function chooseDuplicate(key, candidates, choices) {
  if (choices.has(key)) return choices.get(key);
  const content = `<p>${t("DuplicatePrompt").replace("{name}", `<strong>${escapeHtml(candidates[0].name)}</strong>`)}</p>
    <div class="xjzl-resource-sync-source-list">${candidates.map((candidate, index) =>
      `<div><strong>${index + 1}. ${escapeHtml(candidate.packLabel)}</strong><small>${escapeHtml(candidate.uuid)}</small></div>`
    ).join("")}</div>`;
  const buttons = candidates.map((candidate, index) => ({
    action: `source-${index}`,
    label: `${index + 1}. ${candidate.packLabel}`,
    icon: "fas fa-book-open"
  }));
  buttons.push({ action: "skip", label: t("DuplicateSkip"), icon: "fas fa-forward" });
  const action = await DialogV2.wait({
    window: { title: t("DuplicateTitle"), icon: "fas fa-code-branch", width: 520 },
    content,
    buttons,
    closeAction: "skip",
    rejectClose: false
  });
  const selected = action?.startsWith("source-") ? candidates[Number(action.slice(7))] : null;
  choices.set(key, selected || null);
  return selected;
}

async function resolveSource(item, index, choices) {
  const key = buildIndexKey(item.type, item.name);
  const candidates = index.get(key) || [];
  if (candidates.length === 0) return { source: null, status: "unmatched", reason: t("Reasons.Unmatched") };
  const candidate = candidates.length === 1 ? candidates[0] : await chooseDuplicate(key, candidates, choices);
  if (!candidate) return { source: null, status: "skipped", reason: t("Reasons.Skipped") };
  try {
    const source = await fromUuid(candidate.uuid);
    if (!source) return { source: null, status: "failed", reason: t("Reasons.ReadFailed").replace("{uuid}", candidate.uuid) };
    return { source, candidate };
  } catch (error) {
    console.error(`XJZL | 读取合集资源失败 ${candidate.uuid}:`, error);
    return { source: null, status: "failed", reason: t("Reasons.ReadException") };
  }
}

/**
 * 更新角色卡上的资源规则和 Active Effect；只有规则实际变化时才写入 system。
 * Foundry 在没有差异时允许 update() 返回 undefined，因此结果必须以文档状态核验，不能把返回值当作成功标记。
 */
async function replaceItemResource(item, source, desiredSystem, { updateSystem = true } = {}) {
  const snapshot = {
    name: item.name,
    img: item.img,
    system: clone(item._source?.system || item.system?.toObject?.() || {}),
    effects: effectSnapshots(item)
  };
  const updateOptions = { xjzlResourceSync: true };
  try {
    // 图片属于角色卡的展示选择，不是本次规则资源同步范围；即使规则内容变化也保留现图。
    if (updateSystem) {
      await item.update({ name: source.name, system: desiredSystem }, updateOptions);
      if (!equalData(currentSystem(item, item.type), desiredSystem)) {
        throw new Error(`物品更新后规则数据不一致：${item.name || item.id}`);
      }
    }
    const effects = await syncItemEffects(item, source, updateOptions);
    return { ok: true, effects };
  } catch (error) {
    console.error(`XJZL | 同步资源失败 ${item.name}:`, error);
    try {
      const currentEffectIds = [...(item.effects || [])].map(effect => effect.id);
      if (currentEffectIds.length > 0) {
        const deletedEffects = await item.deleteEmbeddedDocuments("ActiveEffect", currentEffectIds, updateOptions);
        if (!Array.isArray(deletedEffects) || deletedEffects.length !== currentEffectIds.length) {
          throw new Error(`回滚 Active Effect 删除不完整：需要 ${currentEffectIds.length} 个，实际 ${deletedEffects?.length || 0} 个`);
        }
      }
      await item.update({ name: snapshot.name, img: snapshot.img, system: snapshot.system }, updateOptions);
      if (!equalData(currentSystem(item, item.type), stripRuntimeFields(snapshot.system, item.type))) {
        throw new Error(`物品回滚后规则数据不一致：${snapshot.name || item.id}`);
      }
      if (snapshot.effects.length > 0) {
        const restoredEffects = await item.createEmbeddedDocuments(
          "ActiveEffect",
          snapshot.effects,
          { ...updateOptions, keepId: true }
        );
        if (!Array.isArray(restoredEffects) || restoredEffects.length !== snapshot.effects.length) {
          throw new Error(`回滚 Active Effect 创建不完整：需要 ${snapshot.effects.length} 个，实际 ${restoredEffects?.length || 0} 个`);
        }
        const restoredIds = new Set((restoredEffects || []).map(effect => effect.id));
        const expectedIds = snapshot.effects.map(effect => effect._id).filter(Boolean);
        if (expectedIds.some(id => !restoredIds.has(id))) {
          throw new Error("恢复 Active Effect 时无法保留原有身份");
        }
      }
      return { ok: false, recovered: true, error };
    } catch (restoreError) {
      console.error(`XJZL | 恢复同步前资源失败 ${item.name}:`, restoreError);
      return { ok: false, recovered: false, error, restoreError };
    }
  }
}

function makeItemResult(item) {
  return {
    itemId: item.id,
    name: item.name,
    type: item.type,
    typeLabel: t(`Types.${item.type}`),
    status: "updated",
    statusLabel: "已更新",
    statusClass: "updated",
    icon: "fa-rotate",
    details: [],
    partial: false,
    blocked: false
  };
}

function finishItemResult(result, status, reason = "") {
  const labels = {
    updated: [t("Updated"), "updated"], unchanged: [t("Unchanged"), "unchanged"], unmatched: [t("Unmatched"), "unmatched"],
    skipped: [t("Skipped"), "skipped"], failed: [t("FailedCount"), "failed"], recovered: [t("FailedRecovered"), "recovered"]
  };
  result.status = status;
  [result.statusLabel, result.statusClass] = labels[status] || [status, "failed"];
  result.icon = status === "updated" ? "fa-rotate" : status === "unchanged" ? "fa-circle-check" : "fa-circle-exclamation";
  if (reason) result.details.push(reason);
  return result;
}

function countReport(report) {
  const counts = { updated: 0, unchanged: 0, unmatched: 0, skipped: 0, failed: 0, recovered: 0 };
  for (const actor of report.actors) for (const item of actor.items) counts[item.status] = (counts[item.status] || 0) + 1;
  report.counts = counts;
  report.totalItems = Object.values(counts).reduce((sum, count) => sum + count, 0);
}

/** 扫描并同步全部世界角色卡，返回可供报告窗口展示和导出的完整结果。 */
export async function runResourceSync() {
  if (activeRun) return activeRun;
  activeRun = (async () => {
    const report = {
      startedAt: new Date().toISOString(),
      actors: [],
      counts: {},
      tokenPolicy: t("TokenPolicy"),
      backup: []
    };
    try {
      const sourceIndex = await buildSourceIndex();
      const choices = new Map();
      const actors = game.actors.filter(actor => actor.type === "character" || actor.type === "npc");
      report.scannedActors = actors.length;
      for (const actor of actors) {
        const actorResult = { actorId: actor.id, actorUuid: actor.uuid, name: actor.name, items: [] };
        for (const item of actor.items) {
          if (!SYNCABLE_TYPES.has(item.type)) continue;
          const itemResult = makeItemResult(item);
          const resolved = await resolveSource(item, sourceIndex, choices);
          if (!resolved.source) {
            finishItemResult(itemResult, resolved.status, resolved.reason);
            actorResult.items.push(itemResult);
            continue;
          }
          itemResult.sourcePack = resolved.candidate.packLabel;
          const desiredSystem = buildDesiredSystem(item, resolved.source, itemResult);
          if (itemResult.blocked || itemResult.partial) {
            finishItemResult(itemResult, "skipped", t("Reasons.ProgressNotMigrated"));
            actorResult.items.push(itemResult);
            continue;
          }
          const systemChanged = !equalData(currentSystem(item, item.type), desiredSystem);
          const effectsChanged = !effectsEqual(item, resolved.source);
          if (!systemChanged && !effectsChanged) {
            finishItemResult(itemResult, "unchanged");
            actorResult.items.push(itemResult);
            continue;
          }
          report.backup.push({
            actorUuid: actor.uuid,
            actorName: actor.name,
            itemId: item.id,
            itemName: item.name,
            itemType: item.type,
            data: clone(item._source || item.toObject()),
            effects: effectSnapshots(item)
          });
          const outcome = await replaceItemResource(item, resolved.source, desiredSystem, { updateSystem: systemChanged });
          if (outcome.ok) {
            if (outcome.effects?.removed > 0) {
              itemResult.details.push(t("Details.RebuiltEffects").replace("{count}", outcome.effects.removed));
            }
            finishItemResult(itemResult, "updated");
          }
          else finishItemResult(itemResult, outcome.recovered ? "recovered" : "failed", outcome.recovered ? t("Reasons.Restored") : t("Reasons.FailedAndNotRestored"));
          actorResult.items.push(itemResult);
        }
        actorResult.counts = actorResult.items.reduce((counts, item) => {
          counts[item.status] = (counts[item.status] || 0) + 1;
          return counts;
        }, {});
        if (actorResult.items.length > 0) report.actors.push(actorResult);
      }
      report.finishedAt = new Date().toISOString();
      countReport(report);
      return report;
    } catch (error) {
      console.error("XJZL | 角色资源同步整体失败:", error);
      report.fatalError = String(error?.message || error);
      report.finishedAt = new Date().toISOString();
      countReport(report);
      return report;
    }
  })();
  try {
    return await activeRun;
  } finally {
    activeRun = null;
  }
}

/** 返回同步任务是否仍在运行，供工具栏防止重复触发。 */
export function isResourceSyncRunning() {
  return Boolean(activeRun);
}

