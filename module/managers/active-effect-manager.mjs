// module/managers/active-effect-manager.mjs
import { XJZLActiveEffect } from "../documents/active-effect.mjs";
import { xjzlSocket } from "../socket.mjs";
export class ActiveEffectManager {

    /**
     * 核心方法：向 Actor 添加或叠加特效
     * @param {Actor} actor - 目标角色
     * @param {Object} effectDataOrId - 特效源数据 (普通 Object或者系统状态 ID)
     * @param {Number} [count=1] - 添加的层数，默认为 1
     * @returns {Promise<ActiveEffect|undefined>} 返回更新或创建的特效文档
     */
    static async addEffect(actor, effectDataOrId, count = 1) {
        if (!actor || !effectDataOrId) return;

        // [权限拦截]
        if (!actor.isOwner) return await xjzlSocket.executeAsGM("addEffect", actor.uuid, effectDataOrId, count);

        let effectData;
        // =====================================================
        // 0. 数据源解析与规范化 (Normalization)
        // =====================================================

        // 情况 A: 传入的是字符串 ID (如 "qixu", "stun")
        if (typeof effectDataOrId === "string") {
            // 1. 尝试从系统状态列表查找
            const statusData = CONFIG.statusEffects.find(e => e.id === effectDataOrId);

            if (!statusData) {
                console.warn(`XJZL ActiveEffectManager | 未找到系统状态 ID: ${effectDataOrId}`);
                return;
            }
            // 2. 克隆数据，防止修改 CONFIG
            effectData = foundry.utils.deepClone(statusData);

            // 3. 补全 statuses 数组 (V11+ 标准)
            // 确保系统能通过 actor.statuses.has("qixu") 检测到它
            if (!effectData.statuses) effectData.statuses = [statusData.id];
        }
        // 情况 B: 传入的是对象 (Object)
        else if (typeof effectDataOrId === "object") {
            // 如果外部已经克隆过了，这里再克隆一次开销很小；
            // 但如果外部忘了克隆（比如直接传了 CONFIG 对象），这一行能救命。
            effectData = foundry.utils.deepClone(effectDataOrId);
        }
        else {
            return; // 无效输入
        }

        if (!effectData) return;
        // game.i18n.localize 的特性是：如果找到了 key 就翻译，找不到就返回原字符串。
        // 所以即使外部已经翻译过了（传进来的是中文），再 localize 一次通常也只是返回中文本身，没有副作用。
        if (effectData.name) {
            effectData.name = game.i18n.localize(effectData.name);
        }

        // 补全 statuses (用于系统逻辑判定)
        if (effectData.id && !effectData.statuses) {
            effectData.statuses = [effectData.id];
        }

        // =====================================================
        // 1. 预处理：确定唯一标识符 (Slug)
        // =====================================================
        // 直接调用通用方法
        const lookupSlug = XJZLActiveEffect.getSlug(effectData);

        // =====================================================
        // 2. 查找：是否已存在同名/同Slug特效
        // =====================================================
        const existingEffect = actor.effects.find(e => {
            const eSlug = e.getFlag("xjzl-system", "slug");
            // 优先匹配 slug，其次匹配 name (兼容老数据)
            return eSlug === lookupSlug || (!eSlug && e.name === effectData.name);
        });

        // =====================================================
        // 3. 分支 A: 不存在 -> 直接创建
        // =====================================================
        if (!existingEffect) {
            // 多层初始化的预处理
            // 获取该特效定义的最大层数
            const definedMax = foundry.utils.getProperty(effectData, "flags.xjzl-system.maxStacks") || 0;
            // 如果有上限且超标，强行钳制
            if (definedMax > 0 && count > definedMax) {
                count = definedMax;
            }
            // 如果需要一次性创建多层 (count > 1) 且该特效可堆叠
            const isStackable = foundry.utils.getProperty(effectData, "flags.xjzl-system.stackable");

            if (isStackable && count > 1) {
                // 1. 显式记录 BaseChanges (这是1层的原始值)
                // 必须在修改 changes 之前保存，否则 _preCreate 会把乘算后的值当成基准值！
                foundry.utils.setProperty(effectData, "flags.xjzl-system.baseChanges", foundry.utils.deepClone(effectData.changes));

                // 2. 设置初始层数
                foundry.utils.setProperty(effectData, "flags.xjzl-system.stacks", count);

                // 3. 计算多层数值 (复用类方法，不手写公式)
                // 在内存中创建一个临时特效实例 (不保存)
                const tempEffect = new XJZLActiveEffect(effectData, { parent: actor });
                // 调用写好的正确逻辑
                effectData.changes = tempEffect.calculateChangesForStacks(count);
            }
            // 创建时，系统会自动处理 duration.startTime 等初始化工作
            const createdDocs = await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
            return createdDocs[0];
        }

        // =====================================================
        // 4. 分支 B: 已存在 -> 准备更新数据
        // =====================================================
        const isStackable = existingEffect.getFlag("xjzl-system", "stackable");
        const updateData = {}; // 用于收集所有需要变更的属性，最后一次性 update

        // -----------------------------------------------------
        // 4.1 叠层与数值逻辑
        // -----------------------------------------------------
        if (isStackable) {
            // --- 叠层模式 ---
            const currentStacks = existingEffect.getFlag("xjzl-system", "stacks") || 1;
            // 使用 let，因为可能存在同一个id的AE但是叠层上限不同的情况
            let maxStacks = existingEffect.getFlag("xjzl-system", "maxStacks") || 0;

            // 判断一下传入的AE的最大层数是否比已经在身上的大，如果是，更新它（有那种升级武学加叠层上限的情况，虽然这极其罕见）
            const incomingMax = foundry.utils.getProperty(effectData, "flags.xjzl-system.maxStacks");

            if (Number.isFinite(incomingMax) && incomingMax > maxStacks) {
                // 写入数据库更新队列
                updateData["flags.xjzl-system.maxStacks"] = incomingMax;
                // 更新内存变量，确保本次就能叠加上去
                maxStacks = incomingMax;
            }

            // =======================================================
            // 颤手 (Chanshou) 特殊转化逻辑，目前就这一个，保留在这，
            // 以后如果多了可以考虑抛出一个自定义钩子:
            // Hooks.callAll("xjzl.preStackEffect", actor, existingEffect, newStacks);
            // 在其他地方监听处理
            // =======================================================
            const isChanshou = existingEffect.getFlag("xjzl-system", "slug") === "chanshou";

            if (isChanshou && (currentStacks + count) >= 5) {
                // 1. 删除 颤手 (静默)
                await existingEffect.delete({ scrollingStatusText: false });

                // 2. 添加 缴械
                const jiaoxieData = foundry.utils.deepClone(
                    CONFIG.statusEffects.find(e => e.id === "jiaoxie")
                );

                if (jiaoxieData) {
                    // 强制缴械持续 1 回合
                    jiaoxieData.duration = { rounds: 1 };
                    await this.addEffect(actor, jiaoxieData);
                }

                // 3. 卸下所有已装备的武器
                // 筛选条件：类型是 weapon 且 system.equipped 为 true
                const equippedWeapons = actor.items.filter(i =>
                    i.type === "weapon" && i.system.equipped
                );

                if (equippedWeapons.length > 0) {
                    // 构建批量更新数据
                    const weaponUpdates = equippedWeapons.map(w => ({
                        _id: w.id,
                        "system.equipped": false
                    }));

                    // 执行批量更新
                    await actor.updateEmbeddedDocuments("Item", weaponUpdates);

                    // 飘字提示
                    this._showScrollingText(actor, "武器脱手!", "neutral");
                } else {
                    // 如果手里没武器，只提示转化
                    this._showScrollingText(actor, "颤手 -> 缴械", "neutral");
                }

                // 终止后续逻辑
                return;
            }
            // =======================================================


            // 判断是否达到上限
            // 注意：这里不再直接 return，而是由后续逻辑决定是否只刷新时间
            if (maxStacks > 0 && currentStacks >= maxStacks) {
                // 达到上限：不增加层数，不修改数值，仅在下方逻辑中刷新时间
                ui.notifications.info(`${existingEffect.name} 已达到最大层数。`);
                // 满层刷新：手动飘个灰色提示
                this._showScrollingText(actor, `~ ${existingEffect.name}`, "neutral");
            } else {
                // 未达上限：增加层数
                const newStacks = currentStacks + count;

                // 溢出检查
                if (maxStacks > 0 && newStacks > maxStacks) {
                    newStacks = maxStacks;
                }
                if (newStacks !== currentStacks) {
                    // 调用 Document 类的方法，基于 BaseChanges 快照重新计算数值
                    updateData.changes = existingEffect.calculateChangesForStacks(newStacks);
                    // 记录新层数
                    updateData["flags.xjzl-system.stacks"] = newStacks;
                    // 因为这是 Update 操作，核心默认不飘字，我们补上
                    this._showScrollingText(actor, `+ ${existingEffect.name} (${newStacks})`, "create");
                }
            }
        } else {
            // --- 覆盖模式 (不可叠层) ---
            // 如果新传入的数据带有 changes，我们通常认为新来源可能更强，予以覆盖
            // 如果希望保留旧的数值，可以在这里加判断逻辑
            if (effectData.changes) {
                updateData.changes = effectData.changes;
                // 覆盖时：手动字幕
                this._showScrollingText(actor, `! ${existingEffect.name}`, "neutral");
            }
        }

        // -----------------------------------------------------
        // 4.2 持续时间逻辑 (Duration) - 核心修正
        // -----------------------------------------------------
        if (effectData.duration) {
            // 判定是否需要更新持续时间：
            // 1. 如果是可叠层的 (isStackable) -> 总是视为“刷新/重置”，需要更新
            // 2. 如果不可叠层 -> 调用比较函数，只有新时间更长(或相等)时才更新
            const shouldUpdateDuration = isStackable ||
                this.compareDurations(effectData.duration, existingEffect.duration) >= 0;

            if (shouldUpdateDuration) {
                // 深拷贝一份新的时间数据
                const newDuration = foundry.utils.deepClone(effectData.duration);

                // 时间锚点重置
                // 无论是在战斗内还是战斗外，必须更新“开始时刻”，否则系统会按旧的开始时间计算，导致瞬间过期

                // 1. 重置世界时间 (秒) - 适用于大地图探索
                newDuration.startTime = game.time.worldTime;

                // 2. 重置战斗轮次 - 适用于战斗追踪器 (Combat Tracker)
                if (game.combat) {
                    // 如果当前处于战斗中，锁定为当前的 Round 和 Turn
                    newDuration.startRound = game.combat.round;
                    newDuration.startTurn = game.combat.turn;
                } else {
                    // 如果不在战斗中，清除战斗锚点
                    // 防止遗留了旧的 round 数据，导致下次进战时计算错误
                    newDuration.startRound = null;
                    newDuration.startTurn = null;
                }

                updateData.duration = newDuration;
            }
        }

        // -----------------------------------------------------
        // 4.3 其他元数据更新
        // -----------------------------------------------------
        // 更新来源 (origin)，指向最新的那个物品或使用者
        if (effectData.origin) updateData.origin = effectData.origin;

        // =====================================================
        // 5. 执行更新
        // =====================================================
        // 只有当 updateData 不为空时才执行数据库操作 (节省性能)
        if (!foundry.utils.isEmpty(updateData)) {
            return existingEffect.update(updateData);
        }

        return existingEffect;
    }

    /**
     * 核心方法：移除或减少层数
     * @param {Actor} actor 
     * @param {string} targetId - 可以是 Effect ID，也可以是 Slug
     * @param {number} amount - 移除的层数，默认 1
     */
    static async removeEffect(actor, targetId, amount = 1) {
        if (!actor || !targetId) return;
        // [权限拦截]
        if (!actor.isOwner) return await xjzlSocket.executeAsGM("removeEffect", actor.uuid, targetId, amount);

        // 1. 查找特效 (支持 ID 或 Slug)
        const effect = actor.effects.get(targetId) ||
            actor.effects.find(e => e.getFlag("xjzl-system", "slug") === targetId);

        if (!effect) return;

        // 2. 判断是否堆叠
        const isStackable = effect.getFlag("xjzl-system", "stackable");
        const currentStacks = effect.getFlag("xjzl-system", "stacks") || 1;

        // 3. 分支 A: 不可叠 或 移除层数 >= 当前层数 -> 直接删除
        if (!isStackable || amount >= currentStacks) {
            return effect.delete();
        }

        // 4. 分支 B: 减少层数
        const newStacks = currentStacks - amount;

        // 重新计算数值
        const newChanges = effect.calculateChangesForStacks(newStacks);

        // 核心 Update 不飘字，我们补上
        this._showScrollingText(actor, `- ${effect.name} (${newStacks})`, "delete");

        await effect.update({
            changes: newChanges,
            "flags.xjzl-system.stacks": newStacks
        });
    }

    /**
     * 私有辅助：在 Token 上显示浮动字幕
     */
    static _showScrollingText(actor, text, type = "neutral") {
        if (!actor) return;

        const colors = {
            create: 0x00FF00, // 绿
            delete: 0xFF0000, // 红
            neutral: 0xFFFFFF // 白
        };

        const color = colors[type] || colors.neutral;

        // 方案 A: 如果 Actor 是 XJZLActor 的实例
        if (typeof actor.showFloatyText === 'function') {
            actor.showFloatyText(text, { fill: color, fontSize: 28 });
            return;
        }

        // 方案 B (兼容性保底): 直接调用 Socket
        if (xjzlSocket) {
            xjzlSocket.executeForEveryone("showScrollingText", actor.uuid, text, {
                anchor: CONST.TEXT_ANCHOR_POINTS.CENTER,
                direction: CONST.TEXT_ANCHOR_POINTS.TOP,
                fontSize: 28,
                fill: color,
                stroke: 0x000000,
                strokeThickness: 4,
                jitter: 0.25
            });
        }
    }

    /**
     * 辅助方法：切换状态 (类似 Core 的 toggleStatusEffect，但走我们的叠层逻辑)
     * 用于 Token HUD 或 宏
     * @param {Actor} actor 
     * @param {string} slug - 通用状态的 Slug (如 "blind")
     * @param {boolean} [active] - 强制开启(true) 或 关闭(false)。如果不填则切换。
     * @param {Object} [options] - 额外选项，如 overlay
     */
    static async toggleStatus(actor, slug, active, options = {}) {
        // 1. 从 CONFIG 中获取基础数据模板
        const statusData = CONFIG.statusEffects.find(e => e.id === slug);
        if (!statusData) {
            console.warn(`XJZL | Status Effect "${slug}" not found in CONFIG.`);
            return;
        }

        // 检查是否存在
        const existing = actor.effects.find(e => e.getFlag("xjzl-system", "slug") === slug);

        // 确定目标状态
        const state = active !== undefined ? active : !existing;

        if (state) {
            // 开启：调用 addEffect (支持叠层)
            // 我们需要把 CONFIG 里的数据转换成标准 effectData
            // 注意：CONFIG.statusEffects 里的格式通常比较简化，这里要做一次深拷贝
            const effectData = foundry.utils.deepClone(statusData);

            // 确保 slug 存在 (防御性)
            foundry.utils.setProperty(effectData, "flags.xjzl-system.slug", slug);

            // 如果需要覆盖图标 (overlay)，可在 options 里传
            if (options.overlay) effectData.flags.core = { overlay: true };

            return this.addEffect(actor, effectData);
        } else {
            // 关闭：调用 removeEffect
            // 如果是 toggle 逻辑，通常意味着完全移除，而不是减一层
            // 所以我们传一个很大的数，或者扩展 removeEffect 支持 forceDelete
            // 这里简单处理：直接删除，或者只减一层？
            // 标准 toggle 行为通常是“关掉”，所以建议直接 delete
            if (existing) return existing.delete();
        }
    }

    /**
     * 辅助工具：比较两个持续时间的长短
     * @param {Object} d1 - 新持续时间
     * @param {Object} d2 - 旧持续时间
     * @returns {number} 1(d1长), -1(d2长), 0(相等)
     */
    static compareDurations(d1, d2) {
        const val1 = this.getDurationScore(d1);
        const val2 = this.getDurationScore(d2);

        if (val1 > val2) return 1;
        if (val1 < val2) return -1;
        return 0;
    }

    /**
     * 辅助工具：计算持续时间评分 (用于比较)
     * 假设：
     * 1. 没写 duration = 无限 (Infinity)
     * 2. Rounds 优先级 > Turns
     * 3. 忽略 Seconds (除非只有 Seconds)
     */
    static getDurationScore(d) {
        if (!d) return Infinity;
        // 全空视为无限
        if (d.rounds === undefined && d.turns === undefined && d.seconds === undefined) return Infinity;

        // 评分算法：
        // Round * 100 + Turn
        // 这样 1 Round (100分) > 10 Turns (10分)
        // 10 Turns (10分) > 8 Turns (8分)
        let score = 0;

        if (typeof d.rounds === "number") score += d.rounds * 100;
        if (typeof d.turns === "number") score += d.turns;

        // 如果没有 Rounds/Turns 只有 Seconds (极少见)，折算一下
        if (score === 0 && typeof d.seconds === "number") {
            // 简单粗暴：读取定义的一轮的时间，然后一轮 = 100分 (1轮)
            const roundSeconds = CONFIG.time?.roundTime || 2;  //侠界默认2秒一轮
            score += (d.seconds / roundSeconds) * 100;
        }

        return score;
    }

    /**
   * 清理过期特效
   * 检查目标身上的所有特效，如果过期则删除
   * @param {Actor} actor 
   */
    static async cleanExpiredEffects(actor) {
        if (!actor || !actor.effects) return;

        // 筛选出需要删除的 ID
        const expiredIds = actor.effects.filter(e => {
            // 1. 如果是临时特效 (有持续时间)
            if (e.isTemporary) {
                // 2. 获取剩余时间 (FVTT 核心已经帮我们算好了)
                const duration = e.duration;
                // 注意：remaining 属性在 V13 中通常是剩下的秒数或轮数
                // 如果 remaining 存在且 <= 0，说明过期了
                // 使用 typeof 严格判断 number，防止 null <= 0 为 true 的 JS 陷阱
                if (typeof duration.remaining === "number" && duration.remaining <= 0) {
                    return true;
                }
            }
            return false;
        }).map(e => e.id);

        // 执行批量删除
        if (expiredIds.length > 0) {
            console.log(`XJZL | 清理 ${actor.name} 的过期特效:`, expiredIds);
            await actor.deleteEmbeddedDocuments("ActiveEffect", expiredIds);
        }
    }

}