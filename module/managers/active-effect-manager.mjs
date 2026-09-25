// module/managers/active-effect-manager.mjs
import { XJZLActiveEffect } from "../documents/active-effect.mjs";
import { xjzlSocket } from "../socket.mjs";
export class ActiveEffectManager {

    /**
     * V13 数字 mode → V14 字符串 type 的映射表。
     * 注意：CONST.ACTIVE_EFFECT_CHANGE_TYPES 的成员值是默认优先级数字（如 add: 20），
     * 不能作为 type 字面量或反向映射使用，必须维护这张独立对照表。
     */
    static #MODES_TO_TYPES = { 0: "custom", 1: "multiply", 2: "add", 3: "downgrade", 4: "upgrade", 5: "override" };

    /**
     * 按状态 id 查询系统通用状态定义（S2.9/D3 公开门面）。
     * @param {string} id 状态 id（同 CONFIG.statusEffects 的键，如 "pain"、"stun"）
     * @returns {object|undefined} 可安全修改的 V14 格式深拷贝；未命中返回 undefined。不负责创建或更新文档。
     */
    static getStatus(id) {
        const status = CONFIG.statusEffects[id];
        return status ? foundry.utils.deepClone(status) : undefined;
    }

    /**
     * 获取 Actor 当前架招的武学来源、武学名和招式名，供跨角色比较。
     * Item 和招式 ID 只在各自 Actor 内有效，不用于跨角色比较。
     * @param {Actor|null} actor 来源或目标角色（可为合成 Actor）
     * @returns {{wuxueSource: string|null, wuxueName: string, moveName: string|null}|null}
     *   未开启架招或武学缺失时返回 null；招式 ID 无法定位时 moveName 为 null。
     */
    static getActiveStanceSignature(actor) {
        const martial = actor?.system?.martial;
        if (!martial?.stanceActive || !martial.stance || !martial.stanceItemId) return null;
        const wuxue = actor.items.get(martial.stanceItemId);
        if (!wuxue || wuxue.type !== "wuxue") return null;
        const move = (wuxue.system.moves ?? []).find(m => m.id === martial.stance);
        return {
            wuxueSource: wuxue._stats?.compendiumSource ?? null,
            wuxueName: wuxue.name,
            moveName: move?.name ?? null
        };
    }

    /**
     * 按武学来源或名称及招式名，判断来源与目标是否正在使用同一架招。
     * 缺少活动架招、武学或招式名时拒绝，调用方不得产生施加副作用。
     * @param {Actor|null} sourceActor 来源特效所属 Actor
     * @param {Actor} targetActor 施加目标 Actor
     * @returns {boolean}
     */
    static canApplyStanceTiedEffect(sourceActor, targetActor) {
        const src = this.getActiveStanceSignature(sourceActor);
        const tgt = this.getActiveStanceSignature(targetActor);
        if (!src?.moveName || !tgt?.moveName) return false;
        // 合集包来源相同时，武学身份已确定，只需比较招式名。
        if (src.wuxueSource && src.wuxueSource === tgt.wuxueSource) {
            return src.moveName === tgt.moveName;
        }
        // 来源缺失或不同时，按武学名和招式名比较。
        return src.wuxueName === tgt.wuxueName && src.moveName === tgt.moveName;
    }

    /**
     * 将拖放的 AE 施加到 Actor。
     * 物品内嵌的 transfer:true 被动 AE 不可施加；独立 AE 不受此限制。
     * 绑定架招的 AE 须先确认双方当前架招相同，再交由 addEffect 处理叠层和权限。
     * 语义按来源区分：角色身上内嵌的 AE 拖到**其他**角色视为转移（施加成功后删除
     * 来源特效，施加失败或被拦截不动来源）；物品模板、合集包 AE 仍是复制，来源保留。
     * @param {Actor} targetActor 目标 Actor（可为合成 Actor）
     * @param {ActiveEffect} effect 已解析的来源特效文档
     * @returns {Promise<ActiveEffect|undefined>} 施加结果；被拦截时返回 undefined，底层错误继续抛出
     */
    static async applyDraggedEffect(targetActor, effect) {
        if (!targetActor || !effect) return undefined;

        const parent = effect.parent;
        let sourceActor = null;
        if (parent instanceof foundry.documents.Actor) sourceActor = parent;
        else if (parent instanceof foundry.documents.Item && parent.parent instanceof foundry.documents.Actor) {
            sourceActor = parent.parent;
        }

        if (parent instanceof foundry.documents.Item && effect.transfer) {
            ui.notifications.warn(game.i18n.localize("XJZL.Effect.PassiveNoDrag"));
            return undefined;
        }

        // 架招判定必须先于叠层、飘字和聊天副作用。
        if (effect.getFlag?.("xjzl-system", "tiedToStance")) {
            if (!sourceActor) {
                ui.notifications.warn(game.i18n.localize("XJZL.Effect.TiedStanceNoSource"));
                return undefined;
            }
            if (!this.canApplyStanceTiedEffect(sourceActor, targetActor)) {
                ui.notifications.warn(game.i18n.localize("XJZL.Effect.TiedStanceMismatch"));
                return undefined;
            }
        }

        // 新父级不能沿用来源文档的 _id；其余效果数据保留。
        const data = effect.toObject();
        delete data._id;
        if (!data.origin) data.origin = effect.uuid;
        const result = await this.addEffect(targetActor, data, 1);

        // 转移语义：来源是角色身上的特效且施加到了另一角色，成功后移除来源。
        // 拖回自身（含同一 Token）不删；无权限时走 GM socket 委托，与 removeEffect 同路径。
        if (result && sourceActor && sourceActor !== targetActor
            && parent instanceof foundry.documents.Actor) {
            if (sourceActor.isOwner) await effect.delete();
            else await xjzlSocket.executeAsGM("deleteEmbedded", sourceActor.uuid, "ActiveEffect", [effect.id]);
        }
        return result;
    }


    /**
     * 把已到达门面的 V13 风格入参就地归一化为 V14 格式（D2 兼容层，仅归一化不回写）。
     * 覆盖：icon→img、顶层 changes 数组→system.changes、数字 mode→字符串 type、
     * 旧 duration 结构 {rounds/turns/seconds/startTime...}→{value,units,expiry}。
     * 调用前就访问 effect.changes 等旧文档路径的脚本无法由本层修复，须单独迁移。
     * @param {object} effectData 门面已解析出的普通对象数据（克隆体，可安全就地修改）
     */
    static #normalizeEffectData(effectData) {
        // img：V13 的 icon 字段在 V14 schema 中不存在，会被核心清洗丢弃导致图标回退默认值
        if (!effectData.img && effectData.icon) {
            effectData.img = effectData.icon;
        }
        delete effectData.icon;

        // changes：补丁对象里的顶层 changes 表达的是最新意图，整体替换底板已迁移的 system.changes
        if (Array.isArray(effectData.changes)) {
            effectData.system ??= {};
            effectData.system.changes = effectData.changes.map(change => this.#normalizeChange(change));
            delete effectData.changes;
        } else if (Array.isArray(effectData.system?.changes)) {
            effectData.system.changes = effectData.system.changes.map(change => this.#normalizeChange(change));
        }

        // duration：旧结构归一化；已是 {value, units} 的 V14 结构原样保留
        if (foundry.utils.isPlainObject(effectData.duration)) {
            this.#normalizeDuration(effectData.duration);
        }

        // 手写入参缺少 showIcon 时采用常显；toObject() 已带核心默认值，模板须自行显式设置。
        effectData.showIcon ??= 2;
    }

    /**
     * 归一化单条变更数据：数字 mode → 字符串 type，并移除旧 mode 键。
     * @param {object} change 单条变更对象（就地修改）
     * @returns {object} 原对象引用
     */
    static #normalizeChange(change) {
        if (!foundry.utils.isPlainObject(change)) return change;
        if (change.type === undefined && typeof change.mode === "number") {
            change.type = this.#MODES_TO_TYPES[change.mode] ?? `custom.${change.mode}`;
        }
        delete change.mode;
        return change;
    }

    /**
     * 归一化旧 duration 结构为 V14 的 {value, units, expiry}。
     * V14 单字段只支持一个单位：旧 rounds+turns 组合无法原义保留，按主单位 rounds 迁移；
     * rounds/turns 依到期事件结算（默认 turnStart），seconds 为纯时间制（expiry 置 null）。
     * 旧开始锚点（startTime/startRound/startTurn）删除：V14 锚点在顶层 start，新建由核心自动初始化。
     * @param {object} duration duration 对象（就地修改）
     */
    static #normalizeDuration(duration) {
        let value = null;
        let units = null;
        if (typeof duration.rounds === "number") {
            value = duration.rounds;
            units = "rounds";
        } else if (typeof duration.turns === "number") {
            value = duration.turns;
            units = "turns";
        } else if (typeof duration.seconds === "number") {
            value = duration.seconds;
            units = "seconds";
        }

        // 无旧单位键：已是 V14 结构或空对象/无限时长，原样保留
        if (value === null) return;

        // 有旧单位键时按其覆盖 value/units：可能是补丁与 V14 底板（如 CONFIG 状态条目）
        // 深度合并后的结果，旧键代表补丁意图，不能让底板已有的 value/units 抢先返回
        duration.value = value;
        duration.units = units;
        if (units === "seconds") duration.expiry = null;
        else if (!duration.expiry) duration.expiry = "turnStart";
        delete duration.rounds;
        delete duration.turns;
        delete duration.seconds;
        delete duration.startTime;
        delete duration.startRound;
        delete duration.startTurn;
    }

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
            const statusData = CONFIG.statusEffects[effectDataOrId];

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
            // 1. 检查对象里是否有 'id' 且该 'id' 存在于系统配置中
            // 这是一个 "Patch" 操作：以系统配置为底板，传入的对象为修改项
            if (effectDataOrId.id) {
                const baseStatus = CONFIG.statusEffects[effectDataOrId.id];

                if (baseStatus) {
                    // 合并对象：Base + Override
                    // 使用 foundry.utils.mergeObject 深度合并
                    effectData = foundry.utils.mergeObject(
                        foundry.utils.deepClone(baseStatus), // 底板
                        effectDataOrId,                      // 补丁 (例如 { duration: { rounds: 2 } })
                        { inplace: false }
                    );
                } else {
                    // ID 存在但不是系统状态，视为普通自定义数据
                    effectData = foundry.utils.deepClone(effectDataOrId);
                }
            } else {
                // 没有 ID，视为完全自定义数据
                // 如果外部已经克隆过了，这里再克隆一次开销很小；
                // 但如果外部忘了克隆（比如直接传了 CONFIG 对象），这一行能救命。
                effectData = foundry.utils.deepClone(effectDataOrId);
            }
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

        if (effectData.description) {
            effectData.description = game.i18n.localize(effectData.description);
        }

        // 入参归一化后，后续逻辑只读取当前 AE 结构。
        this.#normalizeEffectData(effectData);

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
        // 特殊规则：忍耐减免剧痛
        // =====================================================
        // 规则：每1级忍耐，减少1回合持续时间 (仅限有持续时间且单位是round)
        if (lookupSlug === "pain" && effectData.duration?.units === "rounds" && effectData.duration.value > 0) {
            const rennai = actor.system.skills?.rennai?.total || 0;

            if (rennai > 0) {
                const original = effectData.duration.value;
                const reduced = Math.max(0, original - rennai);
                const reducedAmount = original - reduced;

                // 修改持续时间
                effectData.duration.value = reduced;

                // 发送提示卡片
                const msgContent = `
                <div class="xjzl-chat-card" style="font-size: 13px; padding: 2px 6px;">
                    <div style="border-left: 3px solid #795548; background: rgba(121, 85, 72, 0.1); padding: 4px 6px; border-radius: 2px; margin-left: 2px;">
                        <div style="font-weight: bold; color: #5d4037;">
                            <i class="fas fa-user-shield"></i> 忍耐生效
                        </div>
                        <div style="margin-top: 3px; color: #444; padding-left: 4px; font-size: 0.9em;">
                            剧痛持续时间 -${reducedAmount} 回合<br>
                            <span style="color: #666;">(剩余: ${reduced} 回合)</span>
                        </div>
                    </div>
                </div>`;

                ChatMessage.create({
                    content: msgContent,
                    speaker: ChatMessage.getSpeaker({ actor: actor })
                });

                // 如果减到 0，视为完全豁免，直接中止添加
                if (reduced === 0) {
                    // 可选：飘字提示豁免
                    this._showScrollingText(actor, "忍耐豁免", "neutral");
                    return;
                }
            }
        }

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
            // 准备显示的文本，默认为特效名字
            let displayLabel = effectData.name;

            if (isStackable && count > 1) {
                // 1. 显式记录 BaseChanges (这是1层的原始值)
                // 必须在修改 changes 之前保存，否则 _preCreate 会把乘算后的值当成基准值！
                // V14：变更数组在 system.changes 下
                effectData.system ??= {};
                foundry.utils.setProperty(effectData, "flags.xjzl-system.baseChanges",
                    foundry.utils.deepClone(effectData.system.changes ?? []));

                // 2. 设置初始层数
                foundry.utils.setProperty(effectData, "flags.xjzl-system.stacks", count);

                // 更新显示文本，带上层数 (例如: "中毒 (3)")
                displayLabel = `${effectData.name} (${count})`;

                // 3. 计算多层数值 (复用类方法，不手写公式)
                // 在内存中创建一个临时特效实例 (不保存)
                const tempEffect = new XJZLActiveEffect(effectData, { parent: actor });
                // 调用写好的正确逻辑
                effectData.system.changes = tempEffect.calculateChangesForStacks(count);
            }
            // 显式禁止系统默认飘字 (scrollingStatusText: false)
            // 创建时，核心会自动初始化顶层 start 锚点（当前世界时间与战斗位置）
            const createdDocs = await actor.createEmbeddedDocuments("ActiveEffect", [effectData], { scrollingStatusText: false });

            // 手动调用我们的 Socket 飘字 (绿色 +)
            // 确保无论是第 1 层还是第 N 层，视觉效果统一且所有人可见
            this._showScrollingText(actor, `+ ${displayLabel}`, "create");
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
        // 新增标记：是否执行了持续时间延长逻辑
        // 用于阻止后续的 "4.2" 步骤重置开始时间
        let isDurationExtended = false;
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
                    CONFIG.statusEffects.jiaoxie
                );

                if (jiaoxieData) {
                    // 强制缴械持续 1 回合（V14：rounds 单位 + turnStart 到期事件）
                    jiaoxieData.duration = { value: 1, units: "rounds", expiry: "turnStart", expired: false };
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

            // =======================================================
            // 心火 (Xinhuo) 转化逻辑
            // =======================================================
            const isXinhuo = existingEffect.getFlag("xjzl-system", "slug") === "wuxue_mingjiao_xinhuo";

            if (isXinhuo && (currentStacks + count) >= 3) {
                // 1. 删除 所有心火 (静默)
                await existingEffect.delete({ scrollingStatusText: false });

                // 2. 添加 走火入魔 (持续1回合)
                const rageData = foundry.utils.deepClone(
                    CONFIG.statusEffects.rage
                );

                if (rageData) {
                    rageData.duration = { value: 1, units: "rounds", expiry: "turnStart", expired: false };
                    await this.addEffect(actor, rageData);
                }

                // 3. 飘字提示
                this._showScrollingText(actor, "心火焚身 -> 走火入魔!", "delete");

                // 终止后续叠层逻辑
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
                let newStacks = currentStacks + count;

                // 溢出检查
                if (maxStacks > 0 && newStacks > maxStacks) {
                    newStacks = maxStacks;
                }
                if (newStacks !== currentStacks) {
                    // 调用 Document 类的方法，基于 BaseChanges 快照重新计算数值
                    // V14：变更数组的更新键是 system.changes
                    updateData["system.changes"] = existingEffect.calculateChangesForStacks(newStacks);
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
            if (effectData.system?.changes) {
                updateData["system.changes"] = effectData.system.changes;
                // 覆盖时：手动字幕
                this._showScrollingText(actor, `! ${existingEffect.name}`, "neutral");
            }

            // 持续时间叠加 (Extension)
            // V14：读持久化源数据（toObject），避免取到派生层补了 Infinity 的展示值
            const oldDur = existingEffect.toObject().duration;
            const newDur = effectData.duration;

            // 只有当两者都存在且均为有限数值时长时才尝试同单位叠加。
            // 新数据为无限（value 为 null）时必须落空此分支，交给下方 4.2 的比较刷新，
            // 否则 `旧value + null` 仍是旧值，限时效果将无法被覆盖为无限
            if (oldDur && newDur && Number.isFinite(oldDur.value) && Number.isFinite(newDur.value)) {
                // 同单位：累加时长并保持旧锚点（start 不动），剩余时间正确顺延
                if (oldDur.units === newDur.units) {
                    updateData.duration = foundry.utils.deepClone(oldDur);
                    updateData.duration.value = oldDur.value + newDur.value;
                    // 延长使已到期的特效恢复生效
                    updateData.duration.expired = false;
                    isDurationExtended = true;
                }
                // 不同单位：不做跨单位换算，交给下方 4.2 按“新时长不短于旧时长”比较后整体刷新
            }
        }

        // -----------------------------------------------------
        // 4.2 持续时间逻辑 (Duration)
        // -----------------------------------------------------
        // 只有当提供了新时间，且没有执行刚才的叠加持续时间逻辑时，才执行标准的“重置/比较”逻辑
        if (effectData.duration && !isDurationExtended) {
            // 判定是否需要更新持续时间：
            // 1. 如果是可叠层的 (isStackable) -> 总是视为“刷新/重置”，需要更新
            // 2. 如果不可叠层 -> 调用比较函数，只有新时间更长(或相等)时才更新
            const shouldUpdateDuration = isStackable ||
                this.compareDurations(effectData.duration, existingEffect.duration) >= 0;

            if (shouldUpdateDuration) {
                // 深拷贝一份新的时间数据
                const newDuration = foundry.utils.deepClone(effectData.duration);

                // 时间锚点重置
                // 无论是在战斗内还是战斗外，必须重置“开始时刻”，否则会按旧锚点计算导致瞬间过期
                // V14：锚点在顶层 start（含世界时间与战斗位置），由核心 getEffectStart() 取当前值；
                // 新建特效时核心 _preCreate 会自动完成同样的初始化
                updateData.duration = newDuration;
                updateData.duration.expired = false;
                updateData.start = XJZLActiveEffect.getEffectStart();
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
            // 1. 先飘字 (红色 -)
            // 必须在 delete 之前飘，否则 delete 后 effect 可能就取不到名字了(虽然通常内存里还在)
            this._showScrollingText(actor, `- ${effect.name}`, "delete");

            // 2. 删除文档，并禁止系统默认白字
            return effect.delete({ scrollingStatusText: false });
        }

        // 4. 分支 B: 减少层数
        const newStacks = currentStacks - amount;

        // 重新计算数值
        const newChanges = effect.calculateChangesForStacks(newStacks);

        // 核心 Update 不飘字，我们补上
        this._showScrollingText(actor, `- ${effect.name} (${newStacks})`, "delete");

        await effect.update({
            "system.changes": newChanges,
            "flags.xjzl-system.stacks": newStacks
        });
    }

    /**
     * 私有辅助：在 Token 上显示浮动字幕
     */
    static _showScrollingText(actor, text, type = "neutral") {
        if (!actor) return;

        // =====================================================
        // 聊天卡片发送
        // =====================================================
        // 1. 检查设置是否开启
        const showCard = game.settings.get("xjzl-system", "showEffectChatCards");

        // 2. 发送卡片
        // 只让“当前执行逻辑的人”（也就是调用这个方法的人）来创建卡片，防止重复。
        if (showCard) {
            this._sendChatCard(actor, text, type);
        }
        // =====================================================

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
     * 辅助方法：构建并发送状态变更卡片
     */
    static async _sendChatCard(actor, text, type) {
        // 1. 清洗文本
        // 浮动文字通常带有 "+ ", "- ", "! " 等前缀，在聊天卡片里我们希望去掉它们，或者用图标代替
        const cleanText = text.replace(/^[\+\-\!\~]\s*/, "");

        // 2. 确定样式和措辞
        let actionLabel = "状态变更";
        let iconClass = "fas fa-info-circle";
        let colorStyle = "color: #4b4b4b;"; // 默认灰色

        if (type === "create") {
            actionLabel = "获得状态";
            iconClass = "fas fa-plus-circle";
            colorStyle = "color: #2e7d32;"; // 绿色
        } else if (type === "delete") {
            actionLabel = "移除状态";
            iconClass = "fas fa-minus-circle";
            colorStyle = "color: #c62828;"; // 红色
        } else if (text.includes("!")) {
            // 覆盖/刷新
            actionLabel = "状态刷新";
            iconClass = "fas fa-sync-alt";
            colorStyle = "color: #1565c0;"; // 蓝色
        }

        // 3. 构建 HTML 内容
        // 使用简单的内联样式，无需修改 CSS 文件
        const content = `
        <div class="xjzl-chat-card" style="font-size: 13px; padding: 2px 6px;"> 
            <div class="card-header flexrow" style="display: flex; align-items: center; border-bottom: 1px solid #AAA; padding-bottom: 5px; margin-bottom: 5px;">
                <img src="${actor.img}" style="flex: 0 0 36px; height: 36px; width: 36px; margin-right: 10px; border: none; border-radius: 4px; object-fit: cover;"/>
                <h3 style="margin: 0; line-height: 1.4; font-weight: bold;">${actor.name}</h3>
            </div>
            <div class="card-content" style="${colorStyle} font-weight: bold; padding-left: 2px;">
                <i class="${iconClass}"></i> ${actionLabel}: ${cleanText}
            </div>
        </div>
        `;

        // 4. 创建消息
        await ChatMessage.create({
            content: content,
            speaker: ChatMessage.getSpeaker({ actor: actor }),
        });
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
        const statusData = CONFIG.statusEffects[slug];
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
            // 这里简单处理：直接删除
            this._showScrollingText(actor, `- ${existing.name}`, "delete");
            if (existing) {
                if (actor.isOwner) return existing.delete();
                return await xjzlSocket.executeAsGM("deleteEmbedded", actor.uuid, "ActiveEffect", [existing.id]);
            }
        }
    }

    /**
     * 计算特效剩余时长的中文简写标签（角色/生物卡与状态选取器共用）。
     * V14 依核心派生数据（remaining/secondsRemaining）计算，替代旧 rounds/startRound/startTime 手工推算。
     * @param {ActiveEffect} effect 已完成数据准备的特效文档
     * @returns {string|null} 如 "3 回合"、"45s"；无限/无时长返回 null
     */
    static getDurationLabel(effect) {
        const d = effect?.duration;
        if (!d || !Number.isFinite(d.value)) return null;

        const roundTime = CONFIG.time?.roundTime || 2; // 侠界默认2秒一轮
        if (d.units === "seconds") {
            const s = Math.max(0, Math.ceil(d.secondsRemaining ?? d.remaining ?? 0));
            if (s >= 3600) return `${Math.floor(s / 3600)}h`;
            if (s >= 60) return `${Math.floor(s / 60)}m`;
            return `${s}s`;
        }

        // rounds/turns：战斗内核心派生的 remaining 就是剩余回合/轮数；
        // 战斗外核心按 turnTime/roundTime 把回合/轮时长折算为秒计时，据此回推
        let remaining;
        if (game.combat?.round) {
            remaining = d.remaining;
        } else {
            remaining = Math.ceil((d.secondsRemaining ?? 0) / roundTime);
        }
        // 防御：折算源异常导致剩余量为 Infinity 时回退总时长，避免出现"Infinity 轮"标签
        if (!Number.isFinite(remaining)) remaining = d.value;
        remaining = Math.max(0, Math.floor(remaining) || 0);
        const unit = d.units === "turns" ? "轮" : "回合";
        return remaining === 0 ? "即将结束" : `${remaining} ${unit}`;
    }

    /**
     * 辅助工具：比较两个持续时间的长短
     * 入参为 V14 duration 结构 {value, units, expiry}（源数据或派生数据均可）
     * @param {Object} d1 - 新持续时间
     * @param {Object} d2 - 旧持续时间
     * @returns {number} 1(d1长), -1(d2长), 0(相等)
     */
    static compareDurations(d1, d2) {
        const val1 = this.getDurationScore(d1);
        const val2 = this.getDurationScore(d2);

        if (val1 > val2) return 1;
        if (val1 < val2) return -1;

        // 数值折算等长时考虑到期事件；同一时长内到期越晚，效果存续越久。
        // 纯时间制（expiry 为 null，到点即失效，秒制归一化的产物）< turnStart < turnEnd，
        // 避免等值但更早到期的效果覆盖现有效果。
        // 其余事件（combatEnd、roundStart 等）本系统未使用，与 turnStart 同级保守处理。
        const expiryRank = e => e?.expiry === null ? 0 : e?.expiry === "turnEnd" ? 2 : 1;
        const r1 = expiryRank(d1);
        const r2 = expiryRank(d2);
        if (r1 > r2) return 1;
        if (r1 < r2) return -1;
        return 0;
    }

    /**
     * 辅助工具：按秒折算持续时间用于比较
     * 假设：没写 duration 或 value 非有限数值 = 无限 (Infinity)。
     * V14 不再沿用旧 rounds*100+turns 评分：rounds/turns 按系统回合口径
     * (CONFIG.time.roundTime，战斗外核心同样按它折算计时) 换算成秒后直接比较；
     * 其余日历时间单位交由核心日历换算，无法折算时保守视为无限。
     * 本评分不含到期事件差异；等长时的到期先后由 compareDurations 排序。
     * @param {Object} d - V14 duration 结构
     * @returns {number} 折算秒数；无限返回 Infinity
     */
    static getDurationScore(d) {
        if (!d) return Infinity;
        if (typeof d.value !== "number" || !Number.isFinite(d.value)) return Infinity;

        if (d.units === "seconds") return d.value;
        // rounds 按 roundTime（2 秒/轮）、turns 按 turnTime（1 秒/轮次，与 init 配置一致）折算
        if (d.units === "rounds") return d.value * (CONFIG.time?.roundTime || 2);
        if (d.units === "turns") return d.value * (CONFIG.time?.turnTime || 1);

        // 分钟/小时等日历单位：用核心日历换算成秒
        try {
            const seconds = game.time.calendar?.componentsToTime?.({ [d.units.replace(/s$/, "")]: d.value });
            if (typeof seconds === "number") return seconds;
        } catch (err) {
            console.warn(`XJZL ActiveEffectManager | 无法折算时长单位 "${d.units}"，按无限处理:`, err);
        }
        return Infinity;
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
                // 核心 remaining 是派生剩余量；缺失时不判为过期。
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
