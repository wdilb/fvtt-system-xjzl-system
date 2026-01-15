/* module/utils/seeding/seed-wuxue.mjs */

const PACK_NAME = "xjzl-system.wuxue";

// 门派映射
const SECT_MAP = {
    // "none": "江湖/无门派",
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
 * 文件列表配置
 * 如果某个门派有多个 JSON 文件，或者文件名不符合默认命名规则，请在此处列出。
 * 格式：门派Key: ["文件名1", "文件名2"]
 */
const MULTI_FILE_CONFIG = {
    "jianghushili": [
        "qinwangfu",      // 秦王府
        "shenjiaxujia",   // 沈家徐家
        "dongfangtianyan", // 东方天阉
        "huashengumu",    // 花神古墓
        "bixiaoshishen",  // 碧宵食神
        "canglancaobang", // 沧澜槽帮
        "yanwangmiaomiao", // 阎王喵喵
        "dabeiwudu",      // 大悲五毒
        "mingguiqianmen", // 明鬼千门
        "luoshengongjia", // 洛神宫家
        "wuyueqingcheng", // 五岳青城
        "beiyuan",        // 北原
        "dongyingxiyang", // 东瀛西洋
        "murongduanshiwuzu", // 慕容段氏巫族
        "tushou",         // 徒手
        "jianfa",         // 剑法
        "daofa",          // 刀法
        "gunfa",          // 棍法
        "bishou",         // 匕首
        "anqi",           // 暗器
        "qimen",          // 奇门
        "yueqi",          // 乐器
        "sanshou",        // 散手
        "putong",         // 普通传承
        // 以后每增加一个 JSON，只需在这里添加文件名即可
    ],
    // 如果其他门派也变多了，也可以支持：
    // "gaibang": ["gaibang_low", "gaibang_high"]
};

// 额外的数据文件
const EXTRA_FILES = [
    "qinggong", // 轻功
    "yuepu",    // 乐谱
];

/**
 * 辅助函数：处理招式列表 (Moves Processing)
 * 将 JSON 中的简略数据转换为符合 WuxueDataModel 的完整结构
 */
const processMoves = (rawMoves, bookReqs = "", defaultTier = null) => {
    if (!Array.isArray(rawMoves)) return [];

    // 预处理武学需求，去除首尾空格
    const baseReq = bookReqs.trim();

    return rawMoves.map(m => {

        // === 核心修改：需求继承与拼接逻辑 ===
        let moveReq = (m.requirements || "").trim();
        let finalReq = "";

        if (!moveReq) {
            // 情况1: 招式没写需求 -> 直接继承书本
            finalReq = baseReq;
        } else {
            // 情况2: 招式写了需求
            if (moveReq === baseReq) {
                // 子集和父集完全一致 -> 直接使用
                finalReq = moveReq;
            } else {
                // 子集和父集不一致
                // 检查子集是否已经包含了父集的内容（防止人工录入时已经手动拼接过了）
                if (baseReq && !moveReq.includes(baseReq)) {
                    // 拼接：父集 + 中文分号 + 子集
                    // 例如: "剑-单剑；处于半空中"
                    finalReq = `${baseReq}；${moveReq}`;
                } else {
                    // 如果已经包含了，就直接用子集的
                    finalReq = moveReq;
                }
            }
        }

        // 1. 基础数据
        const moveData = {
            id: m.id || foundry.utils.randomID(),
            name: m.name || "新招式",
            img: m.img || "icons/svg/sword.svg",
            type: m.type || "real", // real, feint, qi, stance, counter
            element: m.element || "none", // taiji, yin, yang...
            damageType: m.damageType || "none",
            weaponType: m.weaponType || "none",

            // 2. 描述与显示
            description: m.description || "",
            range: m.range || "1米",
            targetInfo: m.targetInfo || "单体",
            actionCost: m.actionCost || "主要动作",
            automationNote: m.automationNote || "",
            requirements: finalReq,

            // 3. 进阶配置
            isUltimate: m.isUltimate || false, // 是否绝招
            actionType: m.actionType || "buff", // 气招类型 (heal/attack/buff)
            tier: m.tier ?? defaultTier ?? null,  // null 代表继承书本品阶,优先取招式tier -> 其次取书本tier (defaultTier) -> 最后 null,如果后面想修改，可以去掉读取wuxue的品级的代码重新导入

            // 4. 成长数据 (初始化)
            level: 1,
            xpInvested: 0,
            xpCostRatio: m.xpCostRatio ?? 1,

            progression: {
                mode: m.progression?.mode || "standard",
                customThresholds: Array.isArray(m.progression?.customThresholds) ? m.progression.customThresholds : [],
                mappedStage: m.progression?.mappedStage ?? 0
            },

            sourceBreakdown: { general: 0, specific: 0 },

            // 5. 数值计算公式 (Calculation)
            calculation: {
                base: m.calculation?.base || 0,
                growth: m.calculation?.growth || 0,
                // 属性加成数组 [{prop: "liliang", ratio: 0.5}]
                scalings: Array.isArray(m.calculation?.scalings) ? m.calculation.scalings : []
            },

            // 6. 消耗配置 (Costs - Array per level)
            // 确保是数组，防止报错
            costs: {
                mp: Array.isArray(m.costs?.mp) ? m.costs.mp : [],
                rage: Array.isArray(m.costs?.rage) ? m.costs.rage : [],
                hp: Array.isArray(m.costs?.hp) ? m.costs.hp : []
            },

            // 7. 脚本列表 (Scripts)
            scripts: Array.isArray(m.scripts) ? m.scripts.map(s => ({
                label: s.label || "招式特效",
                trigger: s.trigger || "hit",
                script: s.script || "",
                active: s.active ?? true
            })) : []
        };

        return moveData;
    });
};

/**
 * 核心导出函数：生成武学
 */
export async function seedWuxue() {
    ui.notifications.info("XJZL | 正在读取武学数据...");

    // 1. 读取 JSON
    let wuxueData = [];
    const sectKeys = Object.keys(SECT_MAP);

    for (const sect of sectKeys) {
        let filesToFetch = [];

        // 处理江湖势力多文件的情况
        if (MULTI_FILE_CONFIG[sect]) {
            // 如果在配置表里，则遍历数组生成路径
            filesToFetch = MULTI_FILE_CONFIG[sect].map(fileName =>
                `systems/xjzl-system/data/wuxue/${fileName}.json`
            );
        } else if (sect !== "jianghushili") {
            // 否则，按默认规则：门派Key.json
            filesToFetch.push(`systems/xjzl-system/data/wuxue/${sect}.json`);
        }
        // 借用“江湖势力”的循环，顺便把额外文件加载了
        // 这样既不需要写第二遍 fetch 代码，也不会重复加载
        if (sect === "jianghushili" && typeof EXTRA_FILES !== "undefined") {
            const extraPaths = EXTRA_FILES.map(f => `systems/xjzl-system/data/wuxue/${f}.json`);
            filesToFetch.push(...extraPaths);
            console.log(`XJZL Seeder | 追加加载额外文件: ${EXTRA_FILES.join(", ")}`);
        }
        for (const filePath of filesToFetch) {
            try {
                const response = await fetch(filePath);
                if (!response.ok) continue; // 文件不存在则跳过

                const data = await response.json();
                const dataArray = Array.isArray(data) ? data : [data];

                // 预处理
                dataArray.forEach(d => {
                    if (!d.system) d.system = {};
                    if (!d.system.sect) d.system.sect = sect; // 补全门派
                });

                console.log(`XJZL Seeder | 已加载武学 [${SECT_MAP[sect]}]: ${dataArray.length} 条数据`);
                wuxueData.push(...dataArray);

            } catch (err) {
                console.error(`XJZL Seeder | 加载 ${filePath} 出错:`, err);
            }
        }
    }

    if (wuxueData.length === 0) {
        return ui.notifications.error("未找到任何有效武学数据，请检查 data/wuxue/ 目录。");
    }

    // 2. 清理合集包
    const pack = game.packs.get(PACK_NAME);
    if (!pack) return ui.notifications.error(`错误：未找到合集包 ${PACK_NAME}`);

    await pack.configure({ locked: false });

    // 清空 Items
    const index = await pack.getIndex();
    if (index.size > 0) {
        await Item.deleteDocuments(index.map(d => d._id), { pack: PACK_NAME });
    }
    // 清空 Folders
    if (pack.folders.size > 0) {
        await Folder.deleteDocuments(pack.folders.map(f => f.id), { pack: PACK_NAME });
    }

    // 3. 创建文件夹结构 (按门派)
    console.log("XJZL Seeder | 创建武学门派文件夹...");
    const folders = {}; // { sectKey: folderId }
    const activeSects = [...new Set(wuxueData.map(d => d.system.sect))];

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

    for (const d of wuxueData) {
        const bookTier = d.system.tier;
        // 1. 处理招式
        const processedMoves = processMoves(d.system.moves, d.system.requirements, bookTier);

        // 2. 确定书本品阶 (Book Tier Resolution)
        // 逻辑：优先读取 JSON 数据中的 tier。
        // 如果 JSON 中未定义，则尝试根据招式自动推断（取招式中最低的品阶）。
        // 如果都无法确定，默认为 1 (人级)。

        let finalTier = d.system.tier; // 1. 尝试直接读取

        if (finalTier === undefined || finalTier === null) {
            // 2. JSON 没写，开始自动计算
            let calculatedTier = 1; // 默认保底

            if (processedMoves.length > 0) {
                // 提取所有有效的数字品阶 (非 null 的)
                const validTiers = processedMoves
                    .map(m => m.tier)
                    .filter(t => typeof t === 'number');

                if (validTiers.length > 0) {
                    calculatedTier = Math.min(...validTiers);
                }
            }
            finalTier = calculatedTier;
        }

        // 武学一般没有 Item 级的 effects，通常脚本都在 moves 里
        // 但如果有些被动武学有全局效果，也可以支持
        // AI生成的JSON 似乎有时候会把 effects 写在 system 里，这里做一下兼容性的查找
        const rawEffects = d.effects || d.system?.effects || [];
        const effects = rawEffects.map(e => {
            // === 自动修复逻辑：根目录 scripts 迁移 ===
            if (e.scripts) {
                // 严厉校验：如果有 scripts 但连 flags 对象都没有，视为严重结构错误，直接阻断
                if (!e.flags) {
                    const errMsg = `[XJZL Import Error] 武学 [${d.name}] 的特效 [${e.name}] 在根目录定义了 scripts，但完全缺失 flags 字段。导入已紧急停止。`;
                    ui.notifications.error(errMsg);
                    console.error(e); // 打印出错的对象以便调试
                    throw new Error(errMsg); // 抛出错误以停止 Promise 执行
                }

                // 确保 xjzl-system 命名空间存在
                if (!e.flags["xjzl-system"]) e.flags["xjzl-system"] = {};

                // 执行迁移：将根目录的 scripts 移动到 flags.xjzl-system 下
                e.flags["xjzl-system"].scripts = e.scripts;

                console.warn(`XJZL Seeder | ⚠️ 自动修复: 已将特效 [${e.name}] 的脚本移动至 flags 正确位置。`);
            }
            // ================================================
            // 基础结构
            const effectData = {
                name: e.name,
                icon: d.img, // 如果特效没配图标，默认用物品图标，暂时使用物品图标吧，AI会给特效配上不存在的图标 e.icon
                transfer: e.transfer ?? false,
                disabled: e.disabled ?? false,
                changes: e.changes || [],
                flags: e.flags || {},
                description: e.description || ""
            };
            // 只有当 JSON 里显式定义了 duration 时才写入
            if (e.duration) {
                effectData.duration = e.duration;
            }
            return effectData;
        });



        // 如果存在全局 Item 脚本 (非常少见，比如“装备此书获得被动”)
        const itemScripts = Array.isArray(d.system.scripts) ? d.system.scripts.map(s => ({
            label: s.label,
            trigger: s.trigger,
            script: s.script,
            active: s.active
        })) : [];

        items.push({
            name: d.name,
            type: "wuxue",
            img: d.img,
            folder: folders[d.system.sect],
            system: {
                // 总纲配置
                category: d.system.category || "wuxue", // wuxue, sanshou, qinggong, zhenfa
                sect: d.system.sect || "none",
                // 使用自动计算出的 Tier
                tier: finalTier,

                description: d.system.description || "",
                requirements: d.system.requirements || "",

                // 核心：招式列表
                moves: processedMoves,

                // 核心：全局脚本
                scripts: itemScripts
            },
            effects: effects
        });
    }

    // 5. 批量写入
    if (items.length > 0) {
        console.log(`XJZL Seeder | 正在写入 ${items.length} 个武学...`);
        await Item.createDocuments(items, { pack: PACK_NAME, keepId: false });
    }

    ui.notifications.info(`XJZL | 成功生成 ${items.length} 个武学！`);
}