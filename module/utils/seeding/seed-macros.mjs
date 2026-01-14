/* module/utils/seeding/seed-macros.mjs */

const PACK_NAME = "xjzl-system.macros";

/**
 * 核心导出函数：生成宏指令
 */
export async function seedMacros() {
    ui.notifications.info("XJZL | 正在构建宏指令库...");

    // 0. 定义宏分类对应的数据文件
    // key: JSON文件名 (data/macros/xxx.json)
    // value: 生成的文件夹名称
    const fileMap = {
        "gm": "GM工具",
        "utility": "实用工具",
        "loot": "随机战利品"
    };

    // 1. 读取 JSON
    let macrosData = [];

    for (const [fileName, folderName] of Object.entries(fileMap)) {
        try {
            const filePath = `systems/xjzl-system/data/macros/${fileName}.json`;
            const response = await fetch(filePath);

            if (!response.ok) {
                console.warn(`XJZL Seeder | 未找到宏文件 ${filePath}`);
                continue;
            }

            const data = await response.json();
            const dataArray = Array.isArray(data) ? data : [data];

            // 标记文件夹
            dataArray.forEach(d => d._folderName = folderName);

            console.log(`XJZL Seeder | 加载 ${fileName}.json: ${dataArray.length} 条`);
            macrosData.push(...dataArray);

        } catch (err) {
            console.error(`XJZL Seeder | 加载 ${fileName}.json 失败:`, err);
        }
    }

    if (macrosData.length === 0) {
        return ui.notifications.warn("未找到任何宏数据文件。");
    }

    // 2. 获取合集包
    const pack = game.packs.get(PACK_NAME);
    if (!pack) return ui.notifications.error(`错误：未找到合集包 ${PACK_NAME}`);

    // 3. 清理旧数据
    await pack.configure({ locked: false });
    const index = await pack.getIndex();
    if (index.size > 0) {
        await Macro.deleteDocuments(index.map(d => d._id), { pack: PACK_NAME });
    }
    if (pack.folders.size > 0) {
        await Folder.deleteDocuments(pack.folders.map(f => f.id), { pack: PACK_NAME });
    }

    // 4. 创建文件夹
    console.log("XJZL Seeder | 创建文件夹结构...");
    const uniqueFolders = [...new Set(macrosData.map(d => d._folderName))];
    const folderMap = {};

    for (const name of uniqueFolders) {
        const folder = await Folder.create({
            name: name,
            type: "Macro",
            pack: PACK_NAME
        }, { pack: PACK_NAME });
        folderMap[name] = folder.id;
    }

    // 5. 构建数据
    const macrosToCreate = macrosData.map(d => ({
        name: d.name,
        type: d.type || "script",
        img: d.img || "icons/svg/dice-target.svg",
        command: d.command,
        folder: folderMap[d._folderName],
        author: game.user.id,
        ownership: { default: 2 }, // 观察者
        flags: d.flags || {}
    }));

    // 6. 写入
    if (macrosToCreate.length > 0) {
        await Macro.createDocuments(macrosToCreate, { pack: PACK_NAME, keepId: false });
    }

    ui.notifications.info(`XJZL | 成功生成 ${macrosToCreate.length} 个宏指令！`);
}