/**
 * 背景赠品自动化工具模块
 * ==========================================
 * 从背景的 assets 文本中解析物品和银两，
 * 在合集包中按名称查找，发放到角色。
 *
 * 设计原则：
 *  - 运行时解析 assets 文本，不依赖预存 UUID
 *  - 合集包 re-seed 后自动适应最新数据
 *  - 名称完全匹配，多匹配取第一个并 warn
 */

// ==============================================
// 1. 文本解析
// ==============================================

/** 货币正则：匹配 "10 两白银"、"50两黄金" 等 */
const CURRENCY_RE = /(\d+)\s*两\s*(白银|黄金)/;

/** 数量后缀正则：匹配 "碎石子*20"、"斗笔*1" */
const QTY_SUFFIX_RE = /^(.+)\*(\d+)$/;

/**
 * 解析背景 assets 文本
 * @param {string} assetsText  如 "粗麻上衣，粗麻鞋，10 两白银"
 * @returns {{ items: Array<{name: string, quantity: number}>, silver: number }}
 */
export function parseBackgroundAssets(assetsText) {
    const result = { items: [], silver: 0 };
    if (!assetsText || typeof assetsText !== "string") return result;

    // 按中文逗号分割
    const segments = assetsText.split("，");

    for (const seg of segments) {
        // 先尝试匹配货币
        const currencyMatch = seg.match(CURRENCY_RE);
        if (currencyMatch) {
            const amount = parseInt(currencyMatch[1], 10);
            const unit = currencyMatch[2]; // "白银" | "黄金"
            result.silver += unit === "黄金" ? amount * 10 : amount;
            continue;
        }

        // 按枚举顿号拆分（如 "绸缎上衣、绸缎下衣"）
        const subItems = seg.split("、");
        for (const sub of subItems) {
            const trimmed = sub.trim();
            if (!trimmed) continue;

            // 尝试匹配数量后缀
            const qtyMatch = trimmed.match(QTY_SUFFIX_RE);
            if (qtyMatch) {
                result.items.push({
                    name: qtyMatch[1].trim(),
                    quantity: parseInt(qtyMatch[2], 10)
                });
            } else {
                result.items.push({ name: trimmed, quantity: 1 });
            }
        }
    }

    return result;
}

// ==============================================
// 2. 合集包名称查找
// ==============================================

/** 参与查找的合集包列表 */
const SEARCH_PACKS = ["weapons", "armor", "consumables", "qizhen", "misc"];

/**
 * 构建 name → 合集包条目 的索引
 * @returns {Promise<Map<string, Array<{uuid: string, img: string, type: string, packName: string}>>>}
 */
async function _buildNameIndex() {
    const nameIndex = new Map();

    for (const packKey of SEARCH_PACKS) {
        const pack = game.packs.get(`xjzl-system.${packKey}`);
        if (!pack) {
            console.warn(`XJZL | 合集包 xjzl-system.${packKey} 未找到，跳过`);
            continue;
        }

        const index = await pack.getIndex();
        // V13 Collection: for...of 直接迭代值（entry），非 [id, entry]
        for (const entry of index) {
            const name = entry.name;
            if (!nameIndex.has(name)) {
                nameIndex.set(name, []);
            }
            nameIndex.get(name).push({
                uuid: entry.uuid || `Compendium.${pack.collection}.${entry._id}`,
                img: entry.img,
                type: entry.type,
                packName: packKey
            });
        }
    }

    return nameIndex;
}

/**
 * 在合集包中按名称查找物品
 * @param {Array<{name: string, quantity: number}>} parsedItems
 * @returns {Promise<Array<{name: string, quantity: number, found: boolean, itemData?: object, uuid?: string}>>}
 */
export async function resolveBackgroundItems(parsedItems) {
    if (!parsedItems?.length) return [];

    const nameIndex = await _buildNameIndex();
    const results = [];

    for (const { name, quantity } of parsedItems) {
        const matches = nameIndex.get(name);

        if (!matches || matches.length === 0) {
            console.warn(`XJZL | 物品名 "${name}" 未在任何合集包中找到，已跳过`);
            results.push({ name, quantity, found: false });
            continue;
        }

        if (matches.length > 1) {
            const packNames = matches.map(m => m.packName).join(", ");
            console.warn(`XJZL | 物品名 "${name}" 在多个合集包中存在 (${packNames})，已取第一个 (${matches[0].packName})`);
        }

        const match = matches[0];
        try {
            const item = await fromUuid(match.uuid);
            if (!item) {
                console.warn(`XJZL | 物品名 "${name}" 的 UUID (${match.uuid}) 解析失败，已跳过`);
                results.push({ name, quantity, found: false });
                continue;
            }

            results.push({
                name,
                quantity,
                found: true,
                uuid: match.uuid,
                itemData: item.toObject()
            });
        } catch (err) {
            console.warn(`XJZL | 物品名 "${name}" 解析时出错:`, err);
            results.push({ name, quantity, found: false });
        }
    }

    return results;
}

// ==============================================
// 3. 发放与清理
// ==============================================

/**
 * 发放背景赠品到角色
 * @param {Actor} actor              目标角色
 * @param {Array}  resolvedItems     resolveBackgroundItems 返回的 found=true 项
 * @param {number} silver            要添加的银两
 * @param {string} backgroundId      背景 Item 的 id（用于标记）
 */
export async function grantAndTrack(actor, resolvedItems, silver, backgroundId) {
    // 收集所有待创建物品
    const itemsToCreate = [];
    for (const entry of resolvedItems) {
        if (!entry.found || !entry.itemData) continue;

        const itemData = foundry.utils.deepClone(entry.itemData);

        // 设置数量
        if (entry.quantity > 1) {
            if (itemData.system?.quantity !== undefined) {
                itemData.system.quantity = entry.quantity;
            }
        }

        // 打标记：此物品由该背景赠予
        foundry.utils.setProperty(itemData, "flags.xjzl-system.grantedByBackground", backgroundId);
        itemsToCreate.push(itemData);
    }

    // 批量创建（Foundry 内部逐项处理，单项失败不影响其他）
    if (itemsToCreate.length > 0) {
        try {
            await actor.createEmbeddedDocuments("Item", itemsToCreate);
        } catch (err) {
            console.error("XJZL | 批量发放背景赠品失败:", err);
        }
    }

    // 发放银两
    if (silver > 0) {
        const currentSilver = actor.system.resources?.silver ?? 0;
        await actor.update({ "system.resources.silver": currentSilver + silver });
    }
}

/**
 * 清理背景赠品（删除物品 + 收回银两）
 * @param {Actor}   actor
 * @param {string}  backgroundId  背景 Item 的 id
 * @param {number}  silver        要扣除的银两
 * @param {string}  [grantToken]  可选：向导流程的 grantToken（背景已删除时无法从 item 读取，由调用方传入）
 */
export async function revokeBackgroundGrants(actor, backgroundId, silver, grantToken = null) {
    // 支持两种匹配模式：
    // 1. 直接 ID 匹配（Actor 钩子拖入流程，flag 值为 doc.id）
    // 2. Token 匹配（向导流程，grantToken 由调用方传入或从背景 flags 读取）
    if (!grantToken) {
        const bgItem = actor.items.get(backgroundId);
        grantToken = bgItem?.getFlag("xjzl-system", "grantToken") || null;
    }

    // 找到所有由该背景赠予的物品
    const grantedItems = actor.items.filter(i => {
        const flag = i.getFlag("xjzl-system", "grantedByBackground");
        return flag === backgroundId || (grantToken && flag === grantToken);
    });

    // 批量删除（容错玩家手动已删）
    const idsToDelete = grantedItems.map(i => i.id);
    if (idsToDelete.length > 0) {
        try {
            await actor.deleteEmbeddedDocuments("Item", idsToDelete);
        } catch (err) {
            // 部分物品可能已被手动删除，忽略
        }
    }

    // 收回银两（不低于 0）
    if (silver > 0) {
        const currentSilver = actor.system.resources?.silver ?? 0;
        await actor.update({ "system.resources.silver": Math.max(0, currentSilver - silver) });
    }
}

// ==============================================
// 4. 门派赠品
// ==============================================

/** 门派→物品名 映射缓存，首次加载后常驻 */
let _sectAssetsData = null;

/**
 * 加载门派赠品数据
 * @returns {Promise<Object<string, string[]>>}
 */
async function _loadSectAssets() {
    if (_sectAssetsData) return _sectAssetsData;
    try {
        const resp = await fetch("systems/xjzl-system/data/sect-assets.json");
        _sectAssetsData = await resp.json();
        console.log("XJZL | 门派赠品数据已加载");
    } catch (err) {
        console.error("XJZL | 加载门派赠品数据失败:", err);
        _sectAssetsData = {};
    }
    return _sectAssetsData;
}

/**
 * 获取指定门派的物品名列表
 * @param {string} sectKey  如 "zhengqizong"
 * @returns {Promise<string[]>}
 */
export async function getSectItemNames(sectKey) {
    if (!sectKey || sectKey === "none") return [];
    const data = await _loadSectAssets();
    return data[sectKey] || [];
}

/**
 * 发放门派赠品到角色
 * @param {Actor} actor
 * @param {string} sectKey
 */
export async function grantSectAssets(actor, sectKey) {
    const names = await getSectItemNames(sectKey);
    if (names.length === 0) return;

    const parsed = names.map(name => ({ name, quantity: 1 }));
    const resolved = await resolveBackgroundItems(parsed);

    const itemsToCreate = [];
    for (const r of resolved) {
        if (!r.found) {
            console.warn(`XJZL | 门派 "${sectKey}" 赠品 "${r.name}" 在合集包中未找到`);
            continue;
        }
        const itemData = foundry.utils.deepClone(r.itemData);
        foundry.utils.setProperty(itemData, "flags.xjzl-system.grantedBySect", true);
        itemsToCreate.push(itemData);
    }

    if (itemsToCreate.length > 0) {
        try {
            await actor.createEmbeddedDocuments("Item", itemsToCreate);
        } catch (err) {
            console.error("XJZL | 批量发放门派赠品失败:", err);
        }
    }
}

/**
 * 清理所有门派赠品
 * @param {Actor} actor
 */
export async function revokeAllSectGrants(actor) {
    const grantedItems = actor.items.filter(i =>
        i.getFlag("xjzl-system", "grantedBySect") === true
    );
    const idsToDelete = grantedItems.map(i => i.id);
    if (idsToDelete.length > 0) {
        try {
            await actor.deleteEmbeddedDocuments("Item", idsToDelete);
        } catch (err) {
            // 部分物品可能已被手动删除，忽略
        }
    }
}
