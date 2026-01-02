/* module/utils/seeding/seed-misc.mjs */

const PACK_NAME = "xjzl-system.misc";

/**
 * 核心导出函数：生成杂物
 * 逻辑：单文件读取 -> 清空合集包 -> 批量写入
 */
export async function seedMisc() {
    ui.notifications.info("XJZL | 正在读取杂物数据...");

    const filePath = "systems/xjzl-system/data/misc/misc.json";
    let miscData = [];

    // 1. 读取唯一的 JSON 文件
    try {
        const response = await fetch(filePath);
        if (!response.ok) {
            return ui.notifications.error(`错误：无法找到数据文件 ${filePath}`);
        }
        const data = await response.json();
        miscData = Array.isArray(data) ? data : [data];
        console.log(`XJZL Seeder | 已加载杂物数据: ${miscData.length} 条`);
    } catch (err) {
        console.error("XJZL Seeder | 读取 misc.json 出错:", err);
        return ui.notifications.error("读取数据文件失败，详情请看控制台。");
    }

    if (miscData.length === 0) {
        return ui.notifications.warn("XJZL | 杂物数据为空。");
    }

    // 2. 获取合集包
    const pack = game.packs.get(PACK_NAME);
    if (!pack) return ui.notifications.error(`错误：未找到合集包 ${PACK_NAME}，请检查 system.json 并重启`);

    // 3. 解锁并清理旧数据
    await pack.configure({ locked: false });
    const index = await pack.getIndex();
    if (index.size > 0) {
        console.log(`XJZL Seeder | 清理杂物旧数据 (${index.size}条)...`);
        await Item.deleteDocuments(index.map(d => d._id), { pack: PACK_NAME });
    }
    // 既然没有分类，也不需要清理或创建文件夹

    // 4. 构建 Item 数组
    const items = miscData.map(d => ({
        name: d.name,
        type: "misc", // 对应 system.json documentTypes 中的 misc
        img: d.img || "icons/svg/item-bag.svg",
        system: {
            quantity: d.system?.quantity ?? 1,
            price: d.system?.price ?? 0,
            quality: d.system?.quality ?? 0,
            description: d.system?.description ?? ""
        },
        effects: [] // 杂物无特效
    }));

    // 5. 批量写入
    if (items.length > 0) {
        console.log(`XJZL Seeder | 正在写入 ${items.length} 个杂物...`);
        await Item.createDocuments(items, { pack: PACK_NAME, keepId: false });
    }

    ui.notifications.info(`XJZL | 成功生成 ${items.length} 个杂物！`);
}