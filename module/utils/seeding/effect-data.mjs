/* module/utils/seeding/effect-data.mjs */

/**
 * 将 AE 变更数组中的数字 mode 转为字符串 type。
 * 核心只在迁移顶层 changes 时转换 mode；直接写入 system.changes 的旧条目
 * 否则会按默认 add 处理，导致 override 等语义丢失。
 */

/** V13 数字 mode → V14 字符串 type 对照（与核心 BaseActiveEffect.#MODES_TO_TYPES 一致） */
const MODES_TO_TYPES = { 0: "custom", 1: "multiply", 2: "add", 3: "downgrade", 4: "upgrade", 5: "override" };

/**
 * 归一化变更数组：数字 mode → 字符串 type，并移除旧 mode 键。
 * 已带字符串 type 的条目原样保留。
 * @param {Array|null|undefined} changes 源 JSON 中的变更数组（可为空）
 * @returns {Array} V14 结构的变更数组；入参为空时返回 []
 */
export function normalizeLegacyChanges(changes) {
    return (changes || []).map(change => {
        if (!change || typeof change !== "object") return change;
        if (change.type === undefined && typeof change.mode === "number") {
            const { mode, ...rest } = change;
            return { ...rest, type: MODES_TO_TYPES[mode] ?? `custom.${mode}` };
        }
        return change;
    });
}
