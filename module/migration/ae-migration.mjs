/* module/migration/ae-migration.mjs */

import { convertEffectSource, convertBaseChanges } from "../utils/effect-conversion.mjs";

/**
 * 按 world setting 中的版本号执行 AE 数据迁移；仅活动 GM 写入，失败不推进版本。
 * 阶段转换须幂等，新增阶段只能追加更高版本，确保中断后重试和旧世界补迁。
 * 读取的 `_source` 已经过核心清洗；并存的旧时长单位可能已丢失，须在 V13 世界
 * 升级前预处理。本迁移只处理仍可确定转换的字段。
 */

/**
 * 迁移阶段表（按 version 升序）。
 * @type {Array<{version: number, name: string, run: () => Promise<number>}>}
 */
export const AE_MIGRATION_STAGES = [
    {
        version: 1,
        name: "AE V14 数据结构：清洗残留清理、baseChanges、非被动 showIcon 常显",
        run: migrateEffectStructures
    }
    // 用户脚本不在启动时自动改写，避免覆盖自定义逻辑。
];

const SETTING_KEY = "aeMigrationVersion";

/** 注册迁移进度 world setting（init 时调用一次）。 */
export function registerAEMigrationSetting() {
    game.settings.register("xjzl-system", SETTING_KEY, {
        name: "AE 世界迁移已完成版本",
        hint: "记录侠界之旅 AE 数据迁移已完成的阶段版本，仅由系统迁移流程写入。",
        scope: "world",
        config: false,
        type: Number,
        default: 0
    });
}

/**
 * ready 入口：世界版本号落后于阶段表时由 activeGM 端执行迁移。
 * activeGM 指向在线 GM 中 ID 最小者；版本达标时只做一次数字比较即返回。
 */
export async function runAEMigrationsIfNeeded() {
    if (!game.user.isGM || !game.users.activeGM?.isSelf) return;
    const current = game.settings.get("xjzl-system", SETTING_KEY) ?? 0;
    const latest = AE_MIGRATION_STAGES[AE_MIGRATION_STAGES.length - 1]?.version ?? 0;
    if (current >= latest) return;
    await runStages(current);
}

/**
 * 依次执行未完成的迁移阶段。
 * @param {number} currentVersion 世界已完成的版本号
 */
async function runStages(currentVersion) {
    let completedAny = false;
    for (const stage of AE_MIGRATION_STAGES) {
        if (stage.version <= currentVersion) continue;
        console.log(`XJZL | AE 世界迁移阶段 ${stage.version} 开始：${stage.name}`);
        try {
            const count = await stage.run();
            await game.settings.set("xjzl-system", SETTING_KEY, stage.version);
            completedAny = true;
            console.log(`XJZL | AE 世界迁移阶段 ${stage.version} 完成，更新 ${count} 条特效`);
        } catch (err) {
            // 失败不推进版本号：下次启动自动重试（转换幂等，已成功文档重试为直通）
            console.error(`XJZL | AE 世界迁移阶段 ${stage.version} 失败，版本号未推进，重启后将重试:`, err);
            ui.notifications.error(`侠界之旅 AE 数据迁移阶段 ${stage.version} 失败：${err.message}（重启后自动重试）`);
            return;
        }
    }
    if (completedAny) ui.notifications.info("侠界之旅 AE 数据迁移完成");
}

/**
 * 阶段 1：遍历全部 AE 存储位置做结构转换。
 * 范围：世界 Actor 的 AE 与其内嵌 Item 的 AE、世界 Item 的 AE、
 * 非关联 Token 的差量数据（delta.effects 及 delta.items 的内嵌 AE）。
 * 每条特效读取 `_source`（核心清洗后的加载形态）计算更新差异，有变化才写回；
 * 单条失败记录定位并继续，最终有失败则整体抛错、版本号不推进。
 * @returns {Promise<number>} 实际发生写回的特效数量
 */
async function migrateEffectStructures() {
    const failures = [];
    let migrated = 0;

    /**
     * 转换单个 AE 源数据并产出 update 差异；无变化返回 null。
     * 不使用 diffObject：其默认不生成删除操作（deletionKeys/bidirectional 均需显式
     * 开启且 bidirectional 产出无法跨 socket 序列化的 ForcedDeletion 实例），旧键会
     * 残留在数据库；这里手动逐键对比，对删除的顶层键生成 `-=键` 操作。
     */
    const buildEffectUpdate = source => {
        const converted = foundry.utils.deepClone(source);
        let changed = convertEffectSource(converted);
        if (convertBaseChanges(converted)) changed = true;
        if (!changed) return null;
        const update = { _id: source._id };
        for (const [key, value] of Object.entries(converted)) {
            if (JSON.stringify(value) !== JSON.stringify(source[key])) update[key] = value;
        }
        for (const key of Object.keys(source)) {
            // V14 识别的旧删除语法是 "-=键"（isDeletionKey 要求第二字符为 "="），
            // 写成 "-键" 会被当作 schema 外字段静默丢弃、残留键不会被清理
            if (!(key in converted)) update[`-=${key}`] = null;
        }
        return update;
    };

    /** 逐条迁移一个嵌入式 AE 集合，失败记录定位后继续其余条目 */
    const migrateEmbeddedEffects = async (effects, ownerLabel) => {
        for (const effect of effects) {
            try {
                const update = buildEffectUpdate(effect._source);
                if (!update) continue;
                await effect.update(update);
                migrated++;
            } catch (err) {
                failures.push(`${effect.uuid ?? ownerLabel}: ${err?.message ?? err}`);
            }
        }
    };

    // 1. 世界 Actor：本体 AE + 内嵌 Item 的 AE（模板随 Actor 存储于世界层）
    for (const actor of game.actors) {
        await migrateEmbeddedEffects(actor.effects, actor.uuid);
        for (const item of actor.items) {
            await migrateEmbeddedEffects(item.effects, `${actor.uuid}>${item.uuid}`);
        }
    }

    // 2. 世界物品
    for (const item of game.items) {
        await migrateEmbeddedEffects(item.effects, item.uuid);
    }

    // 3. 非关联 Token：V13 的 actorData 经核心服务端迁移在读入时原样转为 delta。
    //    写回必须走合成 Actor/合成 Item 的嵌入式文档 update（官方路径，经 delta 持久化）——
    //    实测 token.update({"delta.effects": 数组}) 等整体替换写法会被核心静默丢弃。
    //    遍历以 _source.delta 为准（数据库差量），写回目标为合成集合中同 _id 的文档；
    //    delta.items 中的独立修改物品及其内嵌 AE 同属迁移范围，一并覆盖
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            if (token.actorLink) continue;
            const delta = token._source.delta;
            if (!delta) continue;
            const synthetic = token.actor;

            // 3a. 差量特效
            for (const source of delta.effects ?? []) {
                try {
                    if (!source?._id || source._tombstone) continue;
                    const update = buildEffectUpdate(source);
                    if (!update) continue;
                    const doc = synthetic?.effects.get(source._id);
                    if (!doc) {
                        // 孤儿 Token（原型 Actor 已删除）：数据不可经文档 API 触达且无人可见，
                        // 不阻塞迁移（否则永远无法推进版本），仅记录供人工清理
                        console.warn(`XJZL | AE 世界迁移跳过孤儿 Token 的特效 ${token.uuid} > ${source._id}`);
                        continue;
                    }
                    await doc.update(update);
                    migrated++;
                } catch (err) {
                    failures.push(`${token.uuid} > ${source._id}: ${err?.message ?? err}`);
                }
            }

            // 3b. 差量物品的内嵌 AE（Token 上独立修改过的物品模板）
            const syntheticItems = synthetic?.items;
            for (const itemSource of delta.items ?? []) {
                if (!itemSource?._id || itemSource._tombstone) continue;
                const itemDoc = syntheticItems?.get(itemSource._id);
                if (!itemDoc) continue;
                await migrateEmbeddedEffects(itemDoc.effects, `${token.uuid} > ${itemSource._id}`);
            }
        }
    }

    if (failures.length > 0) {
        throw new Error(`${failures.length} 条特效转换失败（定位已保留，版本号未推进）：${failures.join("；")}`);
    }
    return migrated;
}
