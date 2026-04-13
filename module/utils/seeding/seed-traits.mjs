const PACK_NAME = "xjzl-system.traits";

export async function seedTraits() {
    ui.notifications.info("XJZL | 正在读取特效数据...");

    const filePath = "systems/xjzl-system/data/traits/traits.json";
    let traitsData = [];

    try {
        const response = await fetch(filePath);
        if (!response.ok) {
            return ui.notifications.error(`XJZL Seeder | 无法加载特效数据文件: ${filePath}`);
        }

        const data = await response.json();
        // 兼容单对象和数组
        traitsData = Array.isArray(data) ? data : [data];

    } catch (err) {
        console.error("XJZL Seeder | 读取特效 JSON 出错:", err);
        return ui.notifications.error("读取 traits.json 失败，请检查控制台。");
    }

    if (traitsData.length === 0) {
        return ui.notifications.warn("XJZL | traits.json 数据为空。");
    }

    const pack = game.packs.get(PACK_NAME);
    if (!pack) return ui.notifications.error(`错误：未找到合集包 ${PACK_NAME}`);

    await pack.configure({ locked: false });

    // 清空旧数据
    const index = await pack.getIndex();
    if (index.size > 0) {
        await Item.deleteDocuments(index.map(d => d._id), { pack: PACK_NAME });
    }

    // 构建 Item 数组
    const items = traitsData.map(t => {
        return {
            name: t.name || "未命名特效",
            type: "trait",
            img: t.img || "icons/magic/light/explosion-star-glow-green.webp",
            system: {
                type: t.type || "general",
                description: t.description || "",
                automationNote: t.automationNote || "",
                scripts: Array.isArray(t.scripts) ? t.scripts.map(s => ({
                    label: s.label || "特效",
                    trigger: s.trigger || "passive",
                    script: s.script || "",
                    active: s.active ?? true
                })) : []
            },
            // 如果 JSON 里配置了附带的 AE (例如某些特效其实是一个光环，附带 AE 模板)
            effects: Array.isArray(t.effects) ? t.effects : []
        };
    });

    console.log(`XJZL Seeder | 正在写入 ${items.length} 个特效...`);
    await Item.createDocuments(items, { pack: PACK_NAME, keepId: false });

    ui.notifications.info(`XJZL | 成功生成 ${items.length} 个武道特效！`);
}