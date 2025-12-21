/* module/utils/seeding/seed-origins.mjs */

const PACK_NAME = "xjzl-system.origins";
// 使用统一的图标
const ICONS = {
    personality: "systems/xjzl-system/assets/icons/items/personality.png",
    background: "systems/xjzl-system/assets/icons/items/background.png",
    ae: "icons/svg/book.svg"
};

/**
 * 核心导出函数：生成身世与性格
 */
export async function seedOrigins() {
    ui.notifications.info("XJZL | 正在读取源数据...");

    // 1. 读取 JSON
    const [personalityData, backgroundData] = await Promise.all([
        fetch("systems/xjzl-system/data/personalities.json").then(r => r.json()),
        fetch("systems/xjzl-system/data/backgrounds.json").then(r => r.json())
    ]);

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

    // 4. 创建文件夹结构
    console.log("XJZL Seeder | 创建文件夹...");
    const folderP = await Folder.create({ name: "性格特质", type: "Item", pack: PACK_NAME }, { pack: PACK_NAME });
    const folderB = await Folder.create({ name: "身世背景", type: "Item", pack: PACK_NAME }, { pack: PACK_NAME });

    // 5. 构建 Item 数组
    const items = [];

    // --- 工厂逻辑：性格 ---
    for (const d of personalityData) {
        items.push({
            name: d.name,
            type: "personality",
            img: ICONS.personality,
            folder: folderP.id,
            system: {
                description: d.desc,
                options: d.options,
                chosen: [],
                bonus: 2,
                presetKey: d.id // 依然保留 presetKey 用于逻辑识别
            }
            // 删除了 flags.core.sourceId
            // 让 Foundry 自动生成 ID，不要手动指定不合法的 ID
        });
    }

    // --- 工厂逻辑：背景 ---
    for (const d of backgroundData) {
        const effects = [];
        if (d.modifiers) {
            const changes = Object.entries(d.modifiers).map(([k, v]) => ({
                key: k, value: String(v), mode: 2
            }));
            effects.push({
                name: "背景加成",
                icon: ICONS.ae,
                transfer: true,
                changes: changes,
                flags: { "xjzl-system": { slug: "background-modifier", stackable: false } }
            });
        }

        items.push({
            name: d.name,
            type: "background",
            img: ICONS.background,
            folder: folderB.id,
            system: {
                description: d.desc,
                assets: d.assets
            },
            effects: effects
            // 删除了 flags.core.sourceId
        });
    }

    // 6. 批量写入
    if (items.length > 0) {
        console.log(`XJZL Seeder | 正在写入 ${items.length} 个物品...`);
        // 使用 keepId: false 确保生成全新的合法 ID
        await Item.createDocuments(items, { pack: PACK_NAME, keepId: false });
    }

    ui.notifications.info(`XJZL | 成功生成 ${items.length} 个物品！`);
}