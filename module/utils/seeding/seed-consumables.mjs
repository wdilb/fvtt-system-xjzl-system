const PACK_NAME = "xjzl-system.consumables";

/**
 * 核心导出函数：生成消耗品
 */
export async function seedConsumables() {
    ui.notifications.info("XJZL | 正在读取消耗品数据...");

    // 0. 定义分类和对应的中文标签
    const types = ["medicine", "poison", "tea", "food", "wine", "other"];
    const typeLabels = {
        medicine: "药品",
        poison: "毒药",
        tea: "茶叶",
        food: "佳肴",
        wine: "美酒",
        other: "其他"
    };

    // 1. 读取 JSON
    let consumablesData = [];
    for (const t of types) {
        try {
            const filePath = `systems/xjzl-system/data/consumables/${t}.json`;
            const response = await fetch(filePath);

            if (!response.ok) {
                console.warn(`XJZL Seeder | 跳过文件 ${filePath} (可能不存在)`);
                continue;
            }

            const data = await response.json();
            // 确保数据是数组
            const dataArray = Array.isArray(data) ? data : [data];
            console.log(`XJZL Seeder | 已加载 ${t}: ${dataArray.length} 条数据`);
            consumablesData.push(...dataArray);
        } catch (err) {
            console.error(`XJZL Seeder | 加载 ${t}.json 出错:`, err);
        }
    }

    if (consumablesData.length === 0) {
        return ui.notifications.error("未找到任何有效数据，请检查 data/consumables/ 目录。");
    }

    // 2. 获取合集包
    const pack = game.packs.get(PACK_NAME);
    if (!pack) return ui.notifications.error(`错误：未找到合集包 ${PACK_NAME}，请检查 system.json 并重启`);

    // 3. 解锁并清理旧数据
    await pack.configure({ locked: false });
    const index = await pack.getIndex();
    if (index.size > 0) {
        console.log(`XJZL Seeder | 清理旧数据 (${index.size}条)...`);
        await Item.deleteDocuments(index.map(d => d._id), { pack: PACK_NAME });
    }
    // 清理文件夹
    if (pack.folders.size > 0) {
        await Folder.deleteDocuments(pack.folders.map(f => f.id), { pack: PACK_NAME });
    }

    // 4. 创建文件夹结构 (按类型)
    console.log("XJZL Seeder | 创建分类文件夹...");
    const folders = {};
    const folderPromises = types.map(t =>
        Folder.create({ name: typeLabels[t] || t, type: "Item", pack: PACK_NAME }, { pack: PACK_NAME })
    );
    const createdFolders = await Promise.all(folderPromises);
    types.forEach((t, i) => folders[t] = createdFolders[i].id);

    // 5. 构建 Item 数组
    const items = [];
    for (const d of consumablesData) {
        // 准备 AE 数据
        const effects = d.effects ? d.effects.map(e => ({
            name: e.name,
            icon: e.icon,
            transfer: e.transfer ?? false, // 消耗品通常为 false
            changes: e.changes,
            flags: e.flags,
            description: e.description
        })) : [];

        items.push({
            name: d.name,
            type: d.type,
            img: d.img,
            folder: folders[d.system.type] || folders['other'], // 归类到对应文件夹
            system: {
                quantity: d.system.quantity,
                price: d.system.price,
                quality: d.system.quality,
                type: d.system.type,
                description: d.system.description,
                usageScript: d.system.usageScript,
                automationNote: d.system.automationNote,
                recovery: d.system.recovery || { hp: 0, mp: 0, rage: 0 } // 默认值
            },
            effects: effects
        });
    }

    // 6. 批量写入
    if (items.length > 0) {
        console.log(`XJZL Seeder | 正在写入 ${items.length} 个物品...`);
        await Item.createDocuments(items, { pack: PACK_NAME, keepId: false });
    }

    ui.notifications.info(`XJZL | 成功生成 ${items.length} 个消耗品！`);
}