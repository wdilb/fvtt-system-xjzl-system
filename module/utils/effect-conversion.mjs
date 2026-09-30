/* module/utils/effect-conversion.mjs */

/**
 * 将旧 AE 源数据转换为当前结构，供世界迁移和离线数据处理共用。
 * 不依赖 Foundry 全局对象，以便在 Node 中运行；转换保持幂等，支持中断后重试。
 */

/** V13 数字 mode → V14 字符串 type 对照（与核心 BaseActiveEffect.#MODES_TO_TYPES 一致） */
export const MODES_TO_TYPES = { 0: "custom", 1: "multiply", 2: "add", 3: "downgrade", 4: "upgrade", 5: "override" };

/**
 * 判断施加型 AE 是否需要常显图标。
 * V14 会把缺省 showIcon 物化为 1，无法与显式 1 区分；transfer:false 的效果
 * 统一设为 2，显式 0 保留。独立 AE 默认 transfer:true，不落入此规则。
 * @param {object} effect AE 源数据对象
 * @returns {boolean}
 */
export function needsShowIconAlways(effect) {
    return effect.transfer === false && (effect.showIcon === undefined || effect.showIcon === 1);
}

/**
 * 归一化单条变更：数字 mode → 字符串 type（就地修改）。
 * @param {object} change 单条变更对象
 * @returns {boolean} 是否发生了变化
 */
export function convertChange(change) {
    if (!change || typeof change !== "object") return false;
    if (change.type === undefined && typeof change.mode === "number") {
        change.type = MODES_TO_TYPES[change.mode] ?? `custom.${change.mode}`;
        delete change.mode;
        return true;
    }
    return false;
}

/**
 * 归一化变更数组：逐条 mode → type（就地修改）。
 * @param {Array} changes 变更数组
 * @returns {boolean} 是否发生了变化
 */
export function convertChangesArray(changes) {
    if (!Array.isArray(changes)) return false;
    let changed = false;
    for (const change of changes) {
        if (convertChange(change)) changed = true;
    }
    return changed;
}

/**
 * 转换 flags.xjzl-system.baseChanges 叠层基准快照（就地修改）。
 * 核心 AE 结构清洗不处理 flags，旧格式快照须单独转换。
 * @param {object} effect AE 源数据对象
 * @returns {boolean} 是否发生了变化
 */
export function convertBaseChanges(effect) {
    const base = effect?.flags?.["xjzl-system"]?.baseChanges;
    return Array.isArray(base) ? convertChangesArray(base) : false;
}

/**
 * 转换单个 AE 源数据为 V14 结构（就地修改）。
 * 覆盖：label→name、icon→img、顶层 changes→system.changes、数字 mode→type、
 * 旧 duration（单位键与 startRound/startTime 等锚点键）→{value,units,expiry}+顶层 start、
 * 非被动施加型的 showIcon 常显补设。
 * 入参可能是数据库原始形态（seeding/离线脚本），也可能是核心清洗后的加载形态
 * （世界迁移的 _source）；已转换的数据不会再次变化。
 * @param {object} effect AE 源数据对象（就地修改）
 * @returns {boolean} 是否发生了变化
 */
export function convertEffectSource(effect) {
    if (!effect || typeof effect !== "object") return false;
    let changed = false;

    // label：V13 核心字段兜底；V14 schema 无 label，残留一律删除
    if ("label" in effect) {
        if (!effect.name && typeof effect.label === "string") effect.name = effect.label;
        delete effect.label;
        changed = true;
    }

    // icon：V14 schema 无 icon 字段，残留会被核心清洗丢弃导致图标回退默认值
    if ("icon" in effect) {
        if (!effect.img) effect.img = effect.icon;
        delete effect.icon;
        changed = true;
    }

    // changes：V13 数据在顶层；清洗后的半新数据顶层键已 rename，此处兼容两种形态。
    // 顶层 changes 是 V13 权威数据，与 system.changes 异常并存时以顶层为准
    if (Array.isArray(effect.changes)) {
        effect.system ??= {};
        effect.system.changes = effect.changes;
        delete effect.changes;
        changed = true;
    }
    if (effect.system && typeof effect.system === "object" && Array.isArray(effect.system.changes)) {
        if (convertChangesArray(effect.system.changes)) changed = true;
    }

    // duration 与开始锚点
    if (convertDuration(effect)) changed = true;

    // 施加型效果的图标常显；显式 0 不覆盖。
    if (needsShowIconAlways(effect)) {
        effect.showIcon = 2;
        changed = true;
    }

    return changed;
}

/**
 * 转换 duration 与旧开始锚点（就地修改）。
 * 世界迁移读取的是核心清洗后的 `_source`；核心可能已按 seconds→turns→rounds
 * 选取并存单位并删除旧键，无法恢复原始时长。并存单位须在 V13 世界预处理。
 * 对仍保留旧键的数据，seconds 固定使用 expiry:null；回合制仅在缺省时补 turnStart。
 * 旧锚点仅在顶层 start 缺失时迁入；无锚点模板由施加流程初始化 start。
 * @param {object} effect AE 源数据对象（就地修改）
 * @returns {boolean} 是否发生了变化
 */
export function convertDuration(effect) {
    const d = effect.duration;
    if (!d || typeof d !== "object" || Array.isArray(d)) return false;

    const OLD_UNITS = ["rounds", "turns", "seconds"];
    const OLD_ANCHORS = ["startTime", "startRound", "startTurn", "combat"];
    const hasOldUnit = OLD_UNITS.some(k => k in d);
    const hasOldAnchor = OLD_ANCHORS.some(k => k in d);
    if (!hasOldUnit && !hasOldAnchor) return false;

    if (typeof d.rounds === "number") {
        d.value = d.rounds;
        d.units = "rounds";
    } else if (typeof d.turns === "number") {
        d.value = d.turns;
        d.units = "turns";
    } else if (typeof d.seconds === "number") {
        d.value = d.seconds;
        d.units = "seconds";
    }

    if (d.units === "seconds") d.expiry = null;
    else if (d.units && !d.expiry) d.expiry = "turnStart";

    // 顶层 start 只在缺失时生成；模板（无锚点）不受影响，施加时由核心初始化
    if (hasOldAnchor && !effect.start) {
        const start = {};
        if (typeof d.combat === "number") start.combat = d.combat;
        if (typeof d.startRound === "number") start.round = d.startRound;
        if (typeof d.startTurn === "number") start.turn = d.startTurn;
        if (typeof d.startTime === "number") start.time = d.startTime;
        effect.start = start;
    }

    for (const key of [...OLD_UNITS, ...OLD_ANCHORS]) delete d[key];
    return true;
}
