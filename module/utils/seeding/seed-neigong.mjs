/* module/utils/seeding/seed-neigong.mjs */

const PACK_NAME = "xjzl-system.neigong";

const SECT_MAP = {
    "none": "江湖/无门派",
    "zhengqizong": "正气宗",
    "zhenwujiao": "真武教",
    "wanfosi": "万佛寺",
    "xiaoyaopai": "逍遥派",
    "qingtianmen": "擎天门",
    "emeipai": "峨眉派",
    "huashanpai": "华山派",
    "tangmen": "唐门",
    "mingjiao": "明教",
    "gaibang": "丐帮",
    "fenghuayuan": "枫华院",
    "liushanmen": "六扇门",
    "jiangnange": "江南阁",
    "shenfengbang": "神风帮",
    "sihaibiaomeng": "四海镖盟",
    "jiangjunying": "将军营",
    "wanshoushanzhuang": "万兽山庄",
    "baicaoge": "百草阁",
    "jianghushili": "江湖势力"
};

/**
 * 核心导出函数：生成内功
 */
export async function seedNeigong() {
    ui.notifications.info("XJZL | 正在读取内功数据...");

    // 1. 读取 JSON
    // 遍历门派列表，读取对应的 JSON 文件
    let neigongData = [];
    const sectKeys = Object.keys(SECT_MAP);

    for (const sect of sectKeys) {
        // 定义一个需要尝试读取的文件列表
        let filesToFetch = [];

        if (sect === "jianghushili") {
            // 如果是江湖势力，尝试读取 1-10 号文件（可以根据需求调整范围）
            for (let i = 1; i <= 10; i++) {
                filesToFetch.push(`systems/xjzl-system/data/neigong/${sect}${i}.json`);
            }
        } else {
            // 普通门派只读取一个文件
            filesToFetch.push(`systems/xjzl-system/data/neigong/${sect}.json`);
        }
        for (const filePath of filesToFetch) {
            try {
                const response = await fetch(filePath);

                if (!response.ok) {
                    // 很多门派可能还没录入数据，静默跳过或仅输出 Debug
                    // console.debug(`XJZL Seeder | 跳过内功文件 ${filePath}`);
                    continue;
                }

                const data = await response.json();
                const dataArray = Array.isArray(data) ? data : [data];

                // 简单校验并打上门派标记（防止JSON里漏写sect字段）
                dataArray.forEach(d => {
                    if (!d.system) d.system = {};
                    // 如果 JSON 里没写 sect，强行用文件名的门派归类
                    if (!d.system.sect) d.system.sect = sect;
                });

                console.log(`XJZL Seeder | 已加载内功 [${SECT_MAP[sect]}]: ${dataArray.length} 条数据`);
                neigongData.push(...dataArray);

            } catch (err) {
                console.error(`XJZL Seeder | 加载 ${sect}.json 出错:`, err);
            }
        }

    }

    if (neigongData.length === 0) {
        return ui.notifications.error("未找到任何有效内功数据，请检查 data/neigong/ 目录。");
    }

    // 2. 获取并清理合集包
    const pack = game.packs.get(PACK_NAME);
    if (!pack) return ui.notifications.error(`错误：未找到合集包 ${PACK_NAME}`);

    await pack.configure({ locked: false });

    // 清空旧数据
    const index = await pack.getIndex();
    if (index.size > 0) {
        await Item.deleteDocuments(index.map(d => d._id), { pack: PACK_NAME });
    }
    // 清空旧文件夹
    if (pack.folders.size > 0) {
        await Folder.deleteDocuments(pack.folders.map(f => f.id), { pack: PACK_NAME });
    }

    // 3. 创建文件夹结构 (按门派)
    console.log("XJZL Seeder | 创建内功门派文件夹...");
    const folders = {}; // { sectKey: folderId }

    // 仅为有数据的门派创建文件夹
    const activeSects = [...new Set(neigongData.map(d => d.system.sect))];

    const folderPromises = activeSects.map(sectKey =>
        Folder.create({
            name: SECT_MAP[sectKey] || sectKey,
            type: "Item",
            pack: PACK_NAME
        }, { pack: PACK_NAME })
    );

    const createdFolders = await Promise.all(folderPromises);
    activeSects.forEach((key, i) => folders[key] = createdFolders[i].id);

    // 4. 构建 Item 数组
    const items = [];

    // 辅助函数：处理阶段数据 (Stage Schema)
    const processStage = (stageData) => {
        if (!stageData) return {};
        return {
            stats: stageData.stats || { liliang: 0, shenfa: 0, tipo: 0, neixi: 0, qigan: 0, shencai: 0 },
            // effect: stageData.effect || "",  忽略这个属性，完全没用
            description: stageData.description || "",
            xpCostRatio: stageData.xpCostRatio ?? 1,
            // 脚本处理：确保是数组对象结构
            scripts: Array.isArray(stageData.scripts) ? stageData.scripts.map(s => ({
                label: s.label || "阶段特效",
                trigger: s.trigger || "passive",
                script: s.script || "",
                active: s.active ?? true
            })) : []
        };
    };

    for (const d of neigongData) {
        // 内功通常不需要 Active Effects 来处理被动属性（因为 DataModel 会自动计算 system.current.stats）
        // 但如果有特殊效果（如持续性 Buff 模板），依然可以保留
        const effects = d.effects ? d.effects.map(e => ({
            name: e.name,
            icon: e.icon || d.img,
            transfer: e.transfer ?? false, // 内功特效通常不直接 transfer，而是通过脚本调用
            disabled: e.disabled ?? false,
            changes: e.changes || [],
            flags: e.flags || {},
            description: e.description || ""
        })) : [];

        items.push({
            name: d.name,
            type: "neigong",
            img: d.img,
            folder: folders[d.system.sect], // 放入对应门派文件夹
            system: {
                // 静态配置
                tier: d.system.tier ?? 1,      // 1=人, 2=地, 3=天
                element: d.system.element || "taiji", // yin, yang, taiji
                sect: d.system.sect || "none",

                description: d.system.description || "",
                requirement: d.system.requirement || "",
                automationNote: d.system.automationNote || "",

                // 三阶配置
                config: {
                    stage1: processStage(d.system.config?.stage1),
                    stage2: processStage(d.system.config?.stage2),
                    stage3: processStage(d.system.config?.stage3)
                },

                // 圆满特效
                masteryEffect: d.system.masteryEffect || "",
                masteryChanges: Array.isArray(d.system.masteryChanges) ? d.system.masteryChanges : [],

                // 动态数据初始值 (归零)
                xpInvested: 0,
                active: false,
                sourceBreakdown: { general: 0, specific: 0 }
            },
            effects: effects
        });
    }

    // 5. 批量写入
    if (items.length > 0) {
        console.log(`XJZL Seeder | 正在写入 ${items.length} 个内功...`);
        await Item.createDocuments(items, { pack: PACK_NAME, keepId: false });
    }

    ui.notifications.info(`XJZL | 成功生成 ${items.length} 个内功！`);
}