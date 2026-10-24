/* module/utils/seeding/seed-beasts.mjs */

const PACK_NAME = "xjzl-system.beasts";
const DATA_URL = "systems/xjzl-system/data/beasts/beasts.json";

// 野兽图标目录：源 JSON 未提供 img 时按条目名称在此目录解析（如 野猪 → 野猪.png）
const ICON_DIR = "systems/xjzl-system/assets/icons/creature";
const FALLBACK_IMG = "icons/svg/mystery-man.svg";

// 体型 → 原型 Token 占格数（与 creature-sheet 的 size 选项一一对应）
const SIZE_TOKEN_SIZES = { small: 1, medium: 1, large: 2, huge: 3 };

// 品级 → 合集包文件夹名（对应 system.info.type，取值见 creature 数据模型）
const GRADE_FOLDERS = { fan: "凡兽", meng: "猛兽", zhen: "珍兽" };

/**
 * 解析野兽头像/Token 图片：显式 img > 按名称在图标目录猜测（HEAD 探测存在性）> 通用兜底。
 * @param {Object} beast 源 JSON 条目
 * @returns {Promise<String>} 图片路径
 */
async function resolveBeastImage(beast) {
    if (beast.img) return beast.img;
    const guess = `${ICON_DIR}/${beast.name}.png`;
    try {
        const response = await fetch(guess, { method: "HEAD" });
        if (response.ok) return guess;
    } catch (err) {
        console.warn(`XJZL Seeder | 探测野兽图片失败: ${guess}`, err);
    }
    return FALLBACK_IMG;
}

/**
 * 归一化资源字段：支持数字简写（tili: 12 → 满血起步；rage: 3 → 仅设置当前值），
 * 其余默认值交给 creature DataModel 的 Schema 在建卡时补齐，避免两处默认值漂移。
 * @param {Object} src 源 JSON 的 system 块
 * @returns {Object} resources 结构
 */
function normalizeResources(src) {
    const resources = foundry.utils.deepClone(src.resources ?? {});
    // 数字简写 → {value, max}：tili 满血起步（max=value），rage 上限交给 Schema 默认。
    // 显式对象写法优先于顶层简写，不做合并覆盖。
    if (Number.isFinite(resources.tili)) {
        resources.tili = { value: resources.tili, max: resources.tili };
    } else if (!resources.tili && Number.isFinite(src.tili)) {
        resources.tili = { value: src.tili, max: src.tili };
    }
    if (Number.isFinite(resources.rage)) {
        resources.rage = { value: resources.rage };
    } else if (!resources.rage && Number.isFinite(src.rage)) {
        resources.rage = { value: src.rage };
    }
    return resources;
}

/**
 * 校验单条源数据；合法返回 null，否则返回问题描述（带条目位置便于定位）。
 * @param {*} beast 源 JSON 条目
 * @param {Number} index 条目下标
 * @returns {String|null}
 */
function validateBeastEntry(beast, index) {
    if (!beast || typeof beast !== "object" || Array.isArray(beast)) return `第 ${index + 1} 条：不是对象`;
    if (typeof beast.name !== "string" || !beast.name.trim()) return `第 ${index + 1} 条：缺少 name`;
    return null;
}

/**
 * 核心导出函数：生成野兽图鉴（本系统首个 Actor 类型合集包）
 * 流程：读取 → 校验 → 内存构建 → 解锁清空重建 → 回锁。
 * 校验或构建在任何破坏性操作之前完成，失败时中止并保留现有合集内容。
 */
export async function seedBeasts() {
    ui.notifications.info("XJZL | 正在读取野兽数据...");

    let beastsData = [];
    try {
        const response = await fetch(DATA_URL);
        if (!response.ok) {
            return ui.notifications.error(`XJZL Seeder | 无法加载野兽数据文件: ${DATA_URL}`);
        }
        const data = await response.json();
        // 兼容单对象和数组
        beastsData = Array.isArray(data) ? data : [data];
    } catch (err) {
        console.error("XJZL Seeder | 读取野兽数据出错:", err);
        return ui.notifications.error("读取 beasts.json 失败，请检查控制台。");
    }

    if (beastsData.length === 0) {
        return ui.notifications.warn("XJZL | beasts.json 数据为空。");
    }

    // 源数据校验：存在无效条目时中止，不改动现有合集
    const invalid = beastsData
        .map((beast, index) => validateBeastEntry(beast, index))
        .filter(Boolean);
    if (invalid.length > 0) {
        console.error("XJZL Seeder | 野兽数据存在无效条目，已中止生成（现有合集未被改动）:", invalid);
        return ui.notifications.error(`XJZL | 野兽数据存在 ${invalid.length} 条无效条目，已中止生成，详见控制台。`);
    }

    const pack = game.packs.get(PACK_NAME);
    if (!pack) return ui.notifications.error(`错误：未找到合集包 ${PACK_NAME}，请检查 system.json 并重启 Foundry`);

    // 内存构建Actor数组；仅转换简写与展示性配置，字段默认值统一交给 creature Schema 补齐。
    // folder 依赖解锁后的文件夹创建结果，先记下品级、构建完成后再回填
    const actors = [];
    const grades = [];
    const missingImages = [];

    for (const beast of beastsData) {
        const system = foundry.utils.deepClone(beast.system ?? {});
        system.resources = normalizeResources(system);

        const img = await resolveBeastImage(beast);
        if (img === FALLBACK_IMG) missingImages.push(beast.name);

        const gridSize = SIZE_TOKEN_SIZES[system.info?.size] ?? 1;
        actors.push({
            name: beast.name,
            type: "creature",
            img,
            folder: null,
            // 野兽默认按敌对、不关联处理：拖入场景的每个 Token 独立结算体力
            prototypeToken: {
                actorLink: false,
                disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE,
                displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
                displayBars: CONST.TOKEN_DISPLAY_MODES.HOVER,
                // 血条路径相对 actor.system，含 value/max 的对象会被 Foundry 识别为血条
                bar1: { attribute: "resources.tili" },
                width: gridSize,
                height: gridSize,
                texture: { src: img }
            },
            system,
            effects: Array.isArray(beast.effects) ? beast.effects : []
        });
        grades.push(GRADE_FOLDERS[system.info?.type]);
    }

    if (missingImages.length > 0) {
        console.warn(`XJZL Seeder | 以下野兽未匹配到 ${ICON_DIR} 下的图标，已使用占位图:`, missingImages);
    }

    await pack.configure({ locked: false });

    let createdCount = 0;

    try {
        // 清理旧数据
        const index = await pack.getIndex();
        if (index.size > 0) {
            console.log(`XJZL Seeder | 清理旧数据 (${index.size}条)...`);
            await Actor.deleteDocuments(index.map(d => d._id), { pack: PACK_NAME });
        }
        if (pack.folders.size > 0) {
            await Folder.deleteDocuments(pack.folders.map(f => f.id), { pack: PACK_NAME });
        }

        // 按品级创建文件夹，未识别品级的野兽不入文件夹
        console.log("XJZL Seeder | 创建品级文件夹...");
        const folderMap = {};
        for (const grade of [...new Set(grades.filter(Boolean))]) {
            const folder = await Folder.create({ name: grade, type: "Actor", pack: PACK_NAME }, { pack: PACK_NAME });
            folderMap[grade] = folder.id;
        }
        actors.forEach((actor, i) => { actor.folder = folderMap[grades[i]]; });

        if (actors.length > 0) {
            console.log(`XJZL Seeder | 正在写入 ${actors.length} 只野兽...`);
            // V14 批量创建会静默跳过个别未通过校验的文档，必须按返回值统计，不能直接用预期数量
            const created = await Actor.createDocuments(actors, { pack: PACK_NAME, keepId: false });
            createdCount = created.length;
            if (createdCount !== actors.length) {
                console.error(`XJZL Seeder | 预期写入 ${actors.length} 只野兽，实际创建 ${createdCount} 只，请检查上方数据校验告警。`);
                ui.notifications.error(`XJZL | 有 ${actors.length - createdCount} 只野兽未能创建，详见控制台。`);
            }
        }
    } finally {
        // 写入完成后回锁：系统合集包在 Foundry 中默认锁定，保持只读可避免 GM 浏览时误改源数据
        await pack.configure({ locked: true });
    }

    ui.notifications.info(`XJZL | 成功生成 ${createdCount} 只野兽！`);
}
