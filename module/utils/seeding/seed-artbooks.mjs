/* module/utils/seeding/seed-artbooks.mjs */
import { XJZL } from "../../config.mjs";

const PACK_NAME = "xjzl-system.artbooks";
const DATA_FILE = "systems/xjzl-system/data/artbooks/artbooks.json"; // 数据文件路径

/**
 * 核心导出函数：生成技艺书籍
 */
export async function seedArtBooks() {
    ui.notifications.info("XJZL | 正在读取技艺书籍数据...");

    // 1. 读取单一的 JSON 文件
    let bookData = [];
    try {
        const response = await fetch(DATA_FILE);
        if (!response.ok) {
            throw new Error(`无法读取文件 ${DATA_FILE}`);
        }
        const data = await response.json();
        // 确保是数组
        bookData = Array.isArray(data) ? data : [data];
        console.log(`XJZL Seeder | 已加载 ${bookData.length} 本技艺书籍`);
    } catch (err) {
        console.error("XJZL Seeder | 读取 artbooks.json 失败:", err);
        return ui.notifications.error("读取书籍数据失败，请检查控制台。");
    }

    if (bookData.length === 0) {
        return ui.notifications.warn("XJZL | artbooks.json 是空的。");
    }

    // 2. 获取合集包
    const pack = game.packs.get(PACK_NAME);
    if (!pack) {
        return ui.notifications.error(`错误：未找到合集包 ${PACK_NAME}，请检查 system.json`);
    }

    // 3. 解锁并清理旧数据
    await pack.configure({ locked: false });

    // 清理 Item
    const index = await pack.getIndex();
    if (index.size > 0) {
        console.log(`XJZL Seeder | 清理旧书籍数据 (${index.size}条)...`);
        await Item.deleteDocuments(index.map(d => d._id), { pack: PACK_NAME });
    }
    // 清理 Folder
    if (pack.folders.size > 0) {
        await Folder.deleteDocuments(pack.folders.map(f => f.id), { pack: PACK_NAME });
    }

    // 4. 动态创建文件夹结构
    // 根据数据中实际存在的 artType 来创建文件夹，而不是创建所有可能存在的文件夹
    console.log("XJZL Seeder | 分析数据并创建文件夹...");

    const folders = {};
    const activeArtTypes = new Set(bookData.map(d => d.system.artType));
    const folderPromises = [];

    for (const typeKey of activeArtTypes) {
        // 获取中文标签，如果 config 里没定义，就直接用 key
        const label = XJZL.arts[typeKey] ? game.i18n.localize(XJZL.arts[typeKey]) : typeKey;

        folderPromises.push(
            Folder.create({
                name: label,
                type: "Item",
                pack: PACK_NAME,
                sorting: "a"
            }, { pack: PACK_NAME })
                .then(folder => ({ key: typeKey, id: folder.id }))
        );
    }

    const createdFolders = await Promise.all(folderPromises);
    createdFolders.forEach(f => folders[f.key] = f.id);

    // 5. 构建 Item 数组
    const items = bookData.map(d => ({
        name: d.name,
        type: "art_book",
        img: d.img,
        folder: folders[d.system.artType], // 放入对应文件夹
        system: d.system // 直接使用 JSON 中准备好的 system 数据
    }));

    // 6. 批量写入
    if (items.length > 0) {
        console.log(`XJZL Seeder | 正在写入 ${items.length} 本技艺书籍...`);
        await Item.createDocuments(items, { pack: PACK_NAME, keepId: false });
    }

    ui.notifications.info(`XJZL | 成功生成 ${items.length} 本技艺书籍！`);
}