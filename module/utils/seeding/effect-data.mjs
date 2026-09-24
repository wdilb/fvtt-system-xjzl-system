/* module/utils/seeding/effect-data.mjs */

/**
 * seeding 过渡助手：把旧 V13 格式的 AE 变更数组转换为 V14 结构。
 * data/ 源 JSON 在 M4（AE-10）完成整体迁移前仍是旧格式（数字 mode），
 * 而 V14 核心只在迁移【顶层】changes 时转换 mode——直接包进 system.changes
 * 的旧条目不会转换，mode:5 会被 schema 按默认 "add" 处理而丢失覆盖语义，
 * 因此 seeding 在写入合集包前必须在此处完成转换（Q2：不做 seeding 时全量转换）。
 * M4 源 JSON 迁移完成后本助手可简化为直通。
 */

/** V13 数字 mode → V14 字符串 type 对照（与核心 BaseActiveEffect.#MODES_TO_TYPES 一致） */
const MODES_TO_TYPES = { 0: "custom", 1: "multiply", 2: "add", 3: "downgrade", 4: "upgrade", 5: "override" };

/**
 * 归一化变更数组：数字 mode → 字符串 type，并移除旧 mode 键。
 * 已带字符串 type 的条目原样保留，兼容 M4 之后的新格式源数据。
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
