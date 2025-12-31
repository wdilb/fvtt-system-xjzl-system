const PACK_NAME = "xjzl-system.consumables";

/**
 * 核心导出函数：生成消耗品
 */
export async function seedConsumables() {
    ui.notifications.info("XJZL | 正在读取消耗品数据...");

    // 1. 读取 JSON
    let consumablesData = [];
    try {
        const response = await fetch("systems/xjzl-system/data/consumables.json");
        consumablesData = await response.json();
    } catch (err) {
        return ui.notifications.error("无法加载 systems/xjzl-system/data/consumables.json，请检查文件是否存在。");
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
    const types = ["medicine", "poison", "tea", "food", "wine", "other"];
    const typeLabels = {
        medicine: "药品",
        poison: "毒药",
        tea: "茶叶",
        food: "佳肴",
        wine: "美酒",
        other: "其他"
    };

    for (const t of types) {
        const f = await Folder.create({ name: typeLabels[t] || t, type: "Item", pack: PACK_NAME }, { pack: PACK_NAME });
        folders[t] = f.id;
    }

    // 5. 构建 Item 数组
    const items = [];
    for (const d of consumablesData) {
        // 准备 AE 数据
        const effects = d.effects ? d.effects.map(e => ({
            name: e.name,
            icon: e.icon,
            transfer: e.transfer, // 消耗品通常为 false
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