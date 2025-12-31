const PACK_NAME = "xjzl-system.consumables";

/**
 * 核心导出函数：生成消耗品
 */
export async function seedConsumables() {
    ui.notifications.info("XJZL | 正在读取消耗品数据...");

    // 1. 读取 JSON
    let itemsData = [];
    try {
        const response = await fetch("systems/xjzl-system/data/consumables.json");
        itemsData = await response.json();
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
    // 用于简单的图片轮询
    let imgCounter = 0;

    for (const d of itemsData) {
        // 图片逻辑：如果数据里有 icon 字段(我们在json里给部分物品加了)，就用它
        // 否则使用默认逻辑
        let img = d.effects && d.effects.length > 0 ? d.effects[0].icon : null;

        if (!img) {
            // 默认茶叶图片轮询
            if (d.type === 'tea') {
                const variant = (imgCounter % 2) + 1; // 1 或 2
                img = `systems/xjzl-system/assets/icons/consumable/茶${variant}.png`;
                imgCounter++;
            } else {
                // 其他类型的兜底
                img = "icons/svg/item-bag.svg";
            }
        }

        // 构造 Item 数据
        const item = {
            name: d.name,
            type: "consumable",
            img: img,
            folder: folders[d.type] || folders['other'],
            system: {
                quantity: 1, // 默认为1
                price: d.price || 0,
                quality: d.quality || 0,
                type: d.type,
                description: d.description,
                usageScript: d.usageScript,
                automationNote: d.automationNote,
                recovery: {} // 简单恢复留空，我们主要用 usageScript
            },
            effects: d.effects || []
        };

        items.push(item);
    }

    // 6. 批量写入
    if (items.length > 0) {
        console.log(`XJZL Seeder | 正在写入 ${items.length} 个消耗品...`);
        await Item.createDocuments(items, { pack: PACK_NAME, keepId: false });
    }

    ui.notifications.info(`XJZL | 成功生成 ${items.length} 个消耗品！`);
}