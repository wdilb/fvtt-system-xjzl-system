/* module/utils/seeding/seed-qizhen.mjs */

const PACK_NAME = "xjzl-system.qizhen";

/**
 * 核心导出函数：生成奇珍 (单文件导入版)
 * 读取 qizhen.json，根据 system.quality 自动分拣文件夹
 */
export async function seedQizhen() {
    ui.notifications.info("XJZL | 正在读取奇珍数据...");

    // =====================================================
    // 1. 读取单一数据文件
    // =====================================================
    const filePath = "systems/xjzl-system/data/qizhen/qizhen.json";
    let qizhenData = [];

    try {
        const response = await fetch(filePath);

        if (!response.ok) {
            throw new Error(`未找到数据文件: ${filePath}`);
        }

        const data = await response.json();
        // 兼容：如果是单个对象转为数组，如果是数组直接用
        qizhenData = Array.isArray(data) ? data : [data];

        console.log(`XJZL Seeder | 成功加载奇珍数据源: ${qizhenData.length} 条`);

    } catch (err) {
        console.error("XJZL Seeder | 读取失败:", err);
        return ui.notifications.error(`奇珍导入失败: ${err.message}`);
    }

    if (qizhenData.length === 0) {
        return ui.notifications.warn("XJZL | qizhen.json 数据为空，跳过生成。");
    }

    // =====================================================
    // 2. 准备合集包
    // =====================================================
    const pack = game.packs.get(PACK_NAME);
    if (!pack) {
        return ui.notifications.error(`错误：未找到合集包 ${PACK_NAME}。`);
    }

    // 解锁并清理旧数据
    await pack.configure({ locked: false });

    // 清理旧 Item
    const index = await pack.getIndex();
    if (index.size > 0) {
        console.log(`XJZL Seeder | 清理旧奇珍数据 (${index.size}条)...`);
        await Item.deleteDocuments(index.map(d => d._id), { pack: PACK_NAME });
    }

    // 清理旧 Folder
    if (pack.folders.size > 0) {
        await Folder.deleteDocuments(pack.folders.map(f => f.id), { pack: PACK_NAME });
    }

    // =====================================================
    // 3. 重建文件夹结构 (凡/铜/银/金/玉)
    // =====================================================
    // 定义品质映射
    const qualityLabels = {
        0: "凡",
        1: "铜",
        2: "银",
        3: "金",
        4: "玉"
    };
    const qualities = [0, 1, 2, 3, 4];

    console.log("XJZL Seeder | 创建品质分类文件夹...");

    // 批量创建文件夹
    const folderPromises = qualities.map(q =>
        Folder.create({
            name: qualityLabels[q],
            type: "Item",
            pack: PACK_NAME
        }, { pack: PACK_NAME })
    );

    const createdFolders = await Promise.all(folderPromises);

    // 建立映射表: quality(Int) -> folderId(String)
    const foldersMap = {};
    qualities.forEach((q, i) => foldersMap[q] = createdFolders[i].id);

    // =====================================================
    // 4. 构建 Item 数据数组
    // =====================================================
    const itemsToCreate = [];

    for (const d of qizhenData) {
        // 1. 确定品质 (默认为 0)
        // 数据源里应该是 system.quality，如果没有则容错处理
        const quality = d.system?.quality ?? 0;

        // 2. 确定文件夹 ID
        const targetFolderId = foldersMap[quality];

        // 3. 处理 Active Effects
        const effects = d.effects ? d.effects.map(e => ({
            name: e.name,
            icon: e.icon || d.img,
            transfer: e.transfer ?? true, // 奇珍默认为被动传输
            disabled: e.disabled ?? false,
            changes: e.changes || [],
            flags: e.flags || {},
            description: e.description || ""
        })) : [];

        // 4. 处理 Scripts
        const itemScripts = d.system?.scripts || [];

        // 5. 构建 Item 对象
        itemsToCreate.push({
            name: d.name,
            type: "qizhen",
            img: d.img,
            folder: targetFolderId, // 分配到对应品质的文件夹
            system: {
                // --- 基础状态 ---
                equipped: false,
                quantity: d.system?.quantity ?? 1,
                price: d.system?.price ?? 0,
                quality: quality,

                // --- 穴位: 强制重置为空 ---
                acupoint: "",

                // --- 脚本与文本 ---
                scripts: itemScripts,
                description: d.system?.description || "",
                automationNote: d.system?.automationNote || ""
            },
            effects: effects,
            flags: d.flags || {}
        });
    }

    // =====================================================
    // 5. 批量写入数据库
    // =====================================================
    if (itemsToCreate.length > 0) {
        console.log(`XJZL Seeder | 正在写入 ${itemsToCreate.length} 个奇珍...`);
        await Item.createDocuments(itemsToCreate, { pack: PACK_NAME, keepId: false });
    }

    ui.notifications.info(`XJZL | 成功生成 ${itemsToCreate.length} 个奇珍！(来源: qizhen.json)`);
}