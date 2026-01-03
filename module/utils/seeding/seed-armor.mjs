/* module/utils/seeding/seed-armor.mjs */

const PACK_NAME = "xjzl-system.armor";

/**
 * 核心导出函数：生成防具
 */
export async function seedArmor() {
    ui.notifications.info("XJZL | 正在读取防具数据...");

    // 0. 定义分类和对应的中文标签 (对应 XJZLArmorData.type 的 choices)
    const types = [
        "head",      // 头部
        "top",       // 上装
        "bottom",    // 下装
        "shoes",     // 鞋靴
        "ring",      // 戒指
        "earring",   // 耳环
        "necklace",  // 项链
        "accessory"  // 饰品
    ];

    const typeLabels = {
        head: "头部",
        top: "上装",
        bottom: "下装",
        shoes: "鞋靴",
        ring: "戒指",
        earring: "耳环",
        necklace: "项链",
        accessory: "饰品"
    };

    // 1. 读取 JSON
    let armorData = [];
    for (const t of types) {
        try {
            // 假设文件名为 head.json, top.json 等
            const filePath = `systems/xjzl-system/data/armor/${t}.json`;
            const response = await fetch(filePath);

            if (!response.ok) {
                // 有些部位可能暂时没有数据，报个警告跳过即可
                console.warn(`XJZL Seeder | 跳过防具文件 ${filePath} (可能不存在)`);
                continue;
            }

            const data = await response.json();
            // 确保数据是数组
            const dataArray = Array.isArray(data) ? data : [data];
            console.log(`XJZL Seeder | 已加载防具 [${typeLabels[t] || t}]: ${dataArray.length} 条数据`);
            armorData.push(...dataArray);
        } catch (err) {
            console.error(`XJZL Seeder | 加载 ${t}.json 出错:`, err);
        }
    }

    if (armorData.length === 0) {
        return ui.notifications.error("未找到任何有效防具数据，请检查 data/armor/ 目录。");
    }

    // 2. 获取合集包
    const pack = game.packs.get(PACK_NAME);
    if (!pack) return ui.notifications.error(`错误：未找到合集包 ${PACK_NAME}，请检查 system.json 并重启`);

    // 3. 解锁并清理旧数据
    await pack.configure({ locked: false });
    const index = await pack.getIndex();
    if (index.size > 0) {
        console.log(`XJZL Seeder | 清理旧防具数据 (${index.size}条)...`);
        await Item.deleteDocuments(index.map(d => d._id), { pack: PACK_NAME });
    }
    // 清理文件夹
    if (pack.folders.size > 0) {
        await Folder.deleteDocuments(pack.folders.map(f => f.id), { pack: PACK_NAME });
    }

    // 4. 创建文件夹结构 (按部位)
    console.log("XJZL Seeder | 创建防具分类文件夹...");
    const folders = {};
    const folderPromises = types.map(t =>
        Folder.create({ 
            name: typeLabels[t] || t, 
            type: "Item", 
            pack: PACK_NAME 
        }, { pack: PACK_NAME })
    );
    
    // 等待所有文件夹创建完成
    const createdFolders = await Promise.all(folderPromises);
    // 建立 type -> folderId 的映射
    types.forEach((t, i) => folders[t] = createdFolders[i].id);

    // 5. 构建 Item 数组
    const items = [];
    for (const d of armorData) {
        
        // --- 5.1 处理 Active Effects ---
        // 防具的属性加成现在全部依赖 AE。
        // 通常防具的特效是 transfer: true (被动)。
        // 你的 XJZLActiveEffect 类会自动处理 "未装备时抑制" 的逻辑，所以这里放心设为 true。
        const effects = d.effects ? d.effects.map(e => ({
            name: e.name,
            icon: e.icon || d.img, // 如果没配图标，默认用物品图标
            // 防具通常是被动传输，除非是主动使用的技能
            transfer: e.transfer ?? true, 
            disabled: e.disabled ?? false,
            changes: e.changes || [],
            // 重要：保留 flags，因为里面存了 slug, stackable, 以及 AE 内部的 scripts
            flags: e.flags || {}, 
            description: e.description || ""
        })) : [];

        // --- 5.2 处理 Item 自身的 Scripts ---
        // 对应 XJZLArmorData.scripts (makeScriptEffectSchema 数组)
        // 格式: [{ label: "...", trigger: "damaged", script: "...", active: true }]
        const itemScripts = d.system.scripts || [];

        items.push({
            name: d.name,
            type: "armor", // 固定类型
            img: d.img,
            folder: folders[d.system.type], // 归类到对应部位文件夹
            system: {
                // 基础数据
                type: d.system.type, // head, top, ...
                price: d.system.price ?? 0,
                quality: d.system.quality ?? 0, // 0-4
                quantity: d.system.quantity ?? 1,
                equipped: false, // 导入时默认未装备

                // 描述与备注
                description: d.system.description || "",
                automationNote: d.system.automationNote || "",

                // 物品级脚本 (例如：受击触发 damaged, 穿戴触发 passive 等)
                scripts: itemScripts
            },
            effects: effects
        });
    }

    // 6. 批量写入
    if (items.length > 0) {
        console.log(`XJZL Seeder | 正在写入 ${items.length} 个防具...`);
        await Item.createDocuments(items, { pack: PACK_NAME, keepId: false });
    }

    ui.notifications.info(`XJZL | 成功生成 ${items.length} 个防具！`);
}