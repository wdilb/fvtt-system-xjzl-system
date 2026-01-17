/* module/utils/seeding/seed-weapons.mjs */

const PACK_NAME = "xjzl-system.weapons";

/**
 * 核心导出函数：生成兵器
 */
export async function seedWeapons() {
    ui.notifications.info("XJZL | 正在读取兵器数据...");

    // 0. 定义分类和对应的中文标签 
    // 对应 XJZLWeaponData.type 和 CONFIG.XJZL.weaponTypes
    const types = [
        "sword",      // 剑
        "blade",      // 刀
        "staff",      // 棍/枪
        "dagger",     // 短兵/扇/刺
        "hidden",     // 暗器
        "unarmed",    // 徒手/拳套
        "instrument", // 乐器
        "special"     // 奇门
    ];

    const typeLabels = {
        sword: "剑",
        blade: "刀",
        staff: "长兵",
        dagger: "短兵",
        hidden: "暗器",
        unarmed: "拳掌",
        instrument: "乐器",
        special: "奇门"
    };

    // 1. 读取 JSON
    let weaponData = [];
    for (const t of types) {
        try {
            // 文件路径约定：systems/xjzl-system/data/weapons/sword.json
            const filePath = `systems/xjzl-system/data/weapons/${t}.json`;
            const response = await fetch(filePath);

            if (!response.ok) {
                // 部分类型可能没有数据，仅记录调试信息
                console.log(`XJZL Seeder | 未找到兵器文件 ${filePath}，跳过。`);
                continue;
            }

            const data = await response.json();
            const dataArray = Array.isArray(data) ? data : [data];
            console.log(`XJZL Seeder | 已加载兵器 [${typeLabels[t] || t}]: ${dataArray.length} 条数据`);
            weaponData.push(...dataArray);
        } catch (err) {
            console.error(`XJZL Seeder | 加载 ${t}.json 出错:`, err);
        }
    }

    if (weaponData.length === 0) {
        return ui.notifications.error("未找到任何有效兵器数据，请检查 data/weapons/ 目录。");
    }

    // 2. 获取合集包
    const pack = game.packs.get(PACK_NAME);
    if (!pack) {
        return ui.notifications.error(`错误：未找到合集包 ${PACK_NAME}。请确保 system.json 的 packs 中已添加该配置。`);
    }

    // 3. 解锁并清理旧数据
    await pack.configure({ locked: false });
    const index = await pack.getIndex();
    if (index.size > 0) {
        console.log(`XJZL Seeder | 清理旧兵器数据 (${index.size}条)...`);
        await Item.deleteDocuments(index.map(d => d._id), { pack: PACK_NAME });
    }
    // 清理文件夹
    if (pack.folders.size > 0) {
        await Folder.deleteDocuments(pack.folders.map(f => f.id), { pack: PACK_NAME });
    }

    // 4. 创建文件夹结构 (按兵器类型)
    console.log("XJZL Seeder | 创建兵器分类文件夹...");
    const folders = {};
    const folderPromises = types.map(t =>
        Folder.create({
            name: typeLabels[t] || t,
            type: "Item",
            pack: PACK_NAME
        }, { pack: PACK_NAME })
    );

    const createdFolders = await Promise.all(folderPromises);
    types.forEach((t, i) => folders[t] = createdFolders[i].id);

    // 5. 构建 Item 数组
    const items = [];
    for (const d of weaponData) {

        // --- 5.1 处理 Active Effects ---
        // 兵器的 AE 通常用于：被动属性加成(装备生效)、特殊状态(中毒/发光等)
        const effects = d.effects ? d.effects.map(e => ({
            name: e.name,
            icon: e.icon || d.img,
            // 兵器特效通常随装备生效 (transfer: true)
            // 除非是主动使用的消耗型技能 (transfer: false)
            transfer: e.transfer ?? true,
            disabled: e.disabled ?? false,
            changes: e.changes || [],
            // 关键：保留 flags (slug, stacking, scripts inside AE)
            flags: e.flags || {},
            description: e.description || "",
            // 补上 duration
            duration: e.duration || {}, 
            // 补上 statuses (V11+ 系统状态标识) 和 tint (颜色)
            statuses: e.statuses || [],
            tint: e.tint || null,
            // 补上 origin，虽然通常是空的，但保持结构完整
            origin: e.origin || null
        })) : [];

        // --- 5.2 处理 Item 自身的 Scripts ---
        // 格式: [{ label, trigger, script, active }]
        // 这里的数据结构必须严格符合 makeScriptEffectSchema
        const itemScripts = d.system.scripts || [];

        items.push({
            name: d.name,
            type: "weapon", // 固定类型
            img: d.img,
            folder: folders[d.system.type] || null, // 放入对应类型的文件夹
            system: {
                // --- 基础状态 ---
                equipped: false,        // 导入时默认未装备
                quantity: d.system.quantity ?? 1,
                price: d.system.price ?? 0,
                quality: d.system.quality ?? 0, // 0-4 (凡/铜/银/金/玉)

                // --- 核心属性 ---
                type: d.system.type,    // sword, blade...
                subtype: d.system.subtype || "", // 重剑, 软剑...

                damage: d.system.damage ?? 0,
                block: d.system.block ?? 0,

                // --- 脚本逻辑 ---
                scripts: itemScripts,

                // --- 文本信息 ---
                description: d.system.description || "",
                automationNote: d.system.automationNote || ""
            },
            effects: effects,
            flags: d.flags || {} // 保留可能存在的自定义 flags
        });
    }

    // 6. 批量写入
    if (items.length > 0) {
        console.log(`XJZL Seeder | 正在写入 ${items.length} 把神兵利器...`);
        await Item.createDocuments(items, { pack: PACK_NAME, keepId: false });
    }

    ui.notifications.info(`XJZL | 成功生成 ${items.length} 把兵器！`);
}