/**
 * 聊天卡片交互管理器
 * 职责：监听聊天消息渲染，处理按钮点击，执行战斗结算流程
 */
import { SCRIPT_TRIGGERS } from "../data/common.mjs";
import { rollDisabilityTable } from "../utils/utils.mjs";
const renderTemplate = foundry.applications.handlebars.renderTemplate;

export class ChatCardManager {

    /* -------------------------------------------- */
    /*  Hooks & Event Listeners                     */
    /* -------------------------------------------- */

    /**
     * 钩子入口：当聊天消息渲染时触发
     * @param {ChatMessage} message 
     * @param {HTMLElement} html 
     * @param {Object} data 
     */
    static onRenderChatMessage(message, html, data) {
        // html 本身就是 li.chat-message 元素或者其内容容器
        const content = html.querySelector(".xjzl-chat-card");

        if (!content) return;

        // 1. 绑定功能按钮点击事件 (应用伤害、虚招对抗等)
        const buttons = content.querySelectorAll("button[data-action]");
        buttons.forEach(btn => {
            btn.addEventListener("click", (ev) => ChatCardManager._onChatCardAction(ev, message));
        });

        // 2. 绑定骰子详情展开/折叠
        const rollHeaders = content.querySelectorAll(".roll-header");
        rollHeaders.forEach(header => {
            header.addEventListener("click", (ev) => {
                ev.preventDefault();
                const tooltip = header.nextElementSibling;
                if (tooltip && tooltip.classList.contains("dice-tooltip")) {
                    tooltip.style.display = (tooltip.style.display === "none" || tooltip.style.display === "") ? "block" : "none";
                }
            });
        });
    }

    /**
     * 统一点击处理分发
     */
    static async _onChatCardAction(event, message) {
        event.preventDefault();
        const button = event.currentTarget;
        const action = button.dataset.action;
        const flags = message.flags["xjzl-system"] || {};

        // 优先拦截撤回请求
        if (action === "refundCost") {
            await ChatCardManager._onRefundCost(message);
            return;
        }

        // 0. 特殊处理：撤销伤害不需要选中任何目标，也不需要攻击者（只需要数据回滚）
        if (action === "undoDamage") {
            await ChatCardManager._undoDamage(message);
            return;
        }
        // 0. 特殊处理2：属性判定请求处理 (前置拦截)
        // 判定是防御者自己的行为，不需要攻击者或源物品参与
        if (action === "rollSave") {
            await ChatCardManager._rollSave(flags, message);
            return;
        }

        // 1. 获取攻击者 (Speaker)
        // 对于防御请求卡，Speaker 可能是防御者自己，也可能是 GM
        const speaker = message.speaker;
        let attacker = null;
        if (speaker.token) attacker = game.actors.tokens[speaker.token];
        if (!attacker) attacker = game.actors.get(speaker.actor);

        if (!attacker) return ui.notifications.warn("无法找到发起攻击的角色。");

        // 注意：如果是 _onDefendFeint，这里的 actor 是防御者

        // 2. 获取源物品
        // 如果 flags 里没 ID (比如防御卡)，则可能不需要 item
        let item = null;
        // 处理普通攻击
        if (flags.actionType === "basic-attack") {
            // 构造虚拟 Item 对象
            // 满足后续 _applyDamage 对 item.name, item.img, item.actor 的调用需求
            const moveId = flags.moveId || "basic";
            item = {
                id: "basic",
                name: "普通攻击",
                type: "basic",
                img: "icons/skills/melee/unarmed-punch-fist.webp", // 或者从 message flags 里取
                actor: attacker, // 重要：链接回攻击者
                system: {
                    // 构造一个数组，里面放一个 ID 匹配的虚拟招式
                    moves: [
                        {
                            id: moveId,
                            name: "普通攻击",
                            type: "basic",
                            damageType: flags.damageType || "waigong",
                            calculation: {}, //以此防止读取属性报错
                            effects: []      //以此防止读取特效报错
                        }
                    ]
                }
            };
        }
        // 常规逻辑：从数据库获取
        else if (flags.itemId && attacker) {
            item = attacker.items.get(flags.itemId);
        }

        // 3. 获取目标
        // 逻辑：如果历史有记录，强制使用历史记录
        // 只有当历史记录为空时 (说明 Roll 的时候没选目标)，才允许使用当前选中的目标
        let targets = [];
        const historyUuids = flags.targets || [];
        const actionType = flags.actionType || "attack"; // 获取我们在 Item.roll 里存的类型

        // 防御请求(rollDefendFeint)不需要目标
        if (action === "rollDefendFeint") {
            await ChatCardManager._onDefendFeint(attacker, flags, message);
            return;
        }

        if (action === "applyDamage") {
            // 安全检查：因为绕过了后面的 switch，这里必须手动检查 item
            if (!item) return ui.notifications.warn("源物品数据已丢失。");
            if (event.shiftKey) {
                // Shift模式：走手动强制流程
                await ChatCardManager._handleManualDamage(attacker, item, flags, message);
                return;
            }
        }

        // --- 核心目标获取逻辑 ---
        if (historyUuids.length > 0) {
            // A. 优先使用历史记录
            targets = historyUuids.map(uuid => fromUuidSync(uuid)).filter(a => a);
            // 注意：如果历史目标被删了，这里 targets 可能会变空
        }

        // B. 如果没有历史目标 (或历史目标失效)，尝试使用当前选中
        if (targets.length === 0) {
            targets = Array.from(game.user.targets).map(t => t.document).filter(t => t);
        }

        // --- 智能后置目标判断 (Implicit Self) ---
        // 如果此时目标依然为空
        if (targets.length === 0) {

            // 情况 A: 治疗(applyHeal) 或 Buff(applyBuff/applyEffect)
            // 逻辑: 没选人 -> 默认给自己
            if (action === "applyHeal" || actionType === "buff") {
                // 如果 attacker 存在 (通常是 TokenDocument 或 Actor)
                if (attacker) {
                    // 统一转为 TokenDocument (如果 attacker 是 Actor，尝试找他在当前场景的 Token)
                    const selfToken = attacker.token || attacker.getActiveTokens()[0] || null;

                    if (selfToken) {
                        targets = [selfToken];
                        ui.notifications.info("未选择目标，默认对自身生效。");
                    } else if (attacker.uuid) {
                        // 如果实在没 Token，就传 Actor 本身 (applyHeal 支持 Actor)
                        targets = [attacker];
                        ui.notifications.info("未选择目标，默认对自身生效。");
                    }
                }
            }
            // 情况 B: 攻击 (applyDamage)
            // 逻辑: 没选人 -> 报错 (防止误伤自己)
            else if (action === "applyDamage" && actionType !== "buff") {
                return ui.notifications.warn("请先在场景中选中目标。");
            }
        }

        // 最后再次检查（防止上述补救措施也失败）
        if (targets.length === 0 && action !== "rollDefendFeint") {
            return ui.notifications.warn("无法确定生效目标。");
        }

        // === 分发逻辑 ===
        switch (action) {
            case "applyDamage":
                if (!item) return ui.notifications.warn("源物品数据已丢失。");
                await ChatCardManager._applyDamage(attacker, item, flags, targets, message);
                break;

            case "applyHeal":
                if (!item) return ui.notifications.warn("源物品数据已丢失。");
                await ChatCardManager._applyHeal(attacker, item, flags, targets, message);
                break;

            case "rollFeintContest":
                // 这是攻击者点的
                if (!item) return ui.notifications.warn("源物品数据已丢失。");
                await ChatCardManager._rollFeintContest(attacker, item, flags, targets, message);
                break;
            case "rollDisability":
                // 调用 utils 中的投掷逻辑
                await rollDisabilityTable(attacker);
                break;

            case "rollDeathSave":
                await ChatCardManager._rollDeathSave(attacker);
                break;
        }
    }

    /* -------------------------------------------- */
    /*  核心结算逻辑 (Resolution Logic)             */
    /* -------------------------------------------- */

    /**
     * 辅助：解析命中结果 (含 CHECK 脚本和补骰)
     * 特性：检测是否需要补骰 -> 弹窗让玩家投 -> 更新消息 -> 返回结果
     */
    static async _resolveHitRoll(attacker, item, flags, targets, message) {
        // =====================================================
        // 0. 【拦截】读取已锁定的结果
        // =====================================================
        // 检查这张卡片是否已经有了“最终裁定结果”
        // 注意：这里读取的是 message 自身的 flag，而不是传入的 flags 参数
        // 我们存的是 Array，取出来转回 Object Map 以供后续代码使用
        const lockedArray = message.getFlag("xjzl-system", "finalResolvedHit");

        if (lockedArray && Array.isArray(lockedArray)) {
            // 如果存在，直接返回，不再执行任何脚本、弹窗或后续逻辑
            // 哪怕 targets 变了，也只返回第一次计算时的那批结果
            const restoredResults = {};
            lockedArray.forEach(entry => {
                // 解构取出 uuid，剩下的作为结果数据
                const { uuid, ...data } = entry;
                restoredResults[uuid] = data;
            });
            return restoredResults;
        }
        // =====================================================
        // 1. 基础数据准备 (Common Data)
        // =====================================================
        const damageType = flags.damageType || "waigong";
        // 如果 flags.moveType 是 counter，或者 damageType 不属于内外功，则不需要检定
        const isCounter = flags.moveType === "counter"; // 读取你新加的 flag
        const isValidDamage = ["waigong", "neigong"].includes(damageType);
        // 反击(Counter) 或 非内外功招式 不需要投骰子比对闪避
        const needsCheck = isValidDamage && !isCounter;


        // 提前计算公共加值 (修复 ReferenceError 的关键)
        const hitMod = (damageType === "waigong" ? attacker.system.combat.hitWaigongTotal : attacker.system.combat.hitNeigongTotal);
        const manualBonus = flags.attackBonus || 0;
        // =====================================================
        // 1.5 安全获取骰子数据 (修正必中读取rolljson失败直接返回的问题)
        // =====================================================
        let d1 = "-"; // 默认值，用于必中情况显示
        let d2 = null;
        let isNativeDouble = false;// 标记：是否本来就是双骰
        // 只有在需要检定时，才去解析 rollJSON
        if (needsCheck) {
            // 如果需要检定但没有数据，说明出错了
            if (!flags.rollJSON) {
                console.error("XJZL | 命中检定需要 rollJSON 但数据缺失！");
                return null;
            }
            const baseRoll = Roll.fromData(flags.rollJSON);

            // D1: 第一个骰子 (永远存在)
            d1 = baseRoll.terms[0].results[0].result;

            // D2: 获取第二个骰子 (可能来自 2d20，也可能来自之前的补骰)
            d2 = null;
            if (baseRoll.terms[0].results.length > 1) {
                // 情况 A: 初始 Roll 就是 2d20
                d2 = baseRoll.terms[0].results[1].result;
                isNativeDouble = true;
            } else if (flags.supplementalDie !== undefined && flags.supplementalDie !== null) {
                // 情况 B: 初始 Roll 是 1d20，但 flag 里有补骰记录
                d2 = flags.supplementalDie;
            }
        }


        // =====================================================
        // 2. 预计算目标优劣势状态 (Pre-Calculate States)
        // =====================================================
        // 我们需要知道到底有没有人导致“优/劣势”，从而决定是否需要补骰
        const targetStates = new Map();
        let needsSupplemental = false;
        let hasNewTargets = false; // 标记是否有新目标参与计算

        const ctx = flags.contextLevel || {};
        const selfLevel = ctx.selfLevel || 0; // 读取数值等级
        const selfFeintLevel = ctx.selfFeintLevel || 0; // 虚招等级

        // 获取攻击者基础被动 (用于重算)
        const s = attacker.xjzlStatuses || {};
        const baseIgnoreBlock = s.ignoreBlock || false;
        const baseIgnoreDefense = s.ignoreDefense || false;
        const baseIgnoreStance = s.ignoreStance || false;

        for (const target of targets) {
            const uuid = target.uuid;
            const safeKey = uuid.replaceAll(".", "_");
            const targetActor = target.actor || target;
            if (!targetActor) continue;

            // A. 如果有缓存结果，直接跳过计算 (但在最终结算时直接用)
            if (flags.targetsResultMap?.[safeKey]) continue;

            // 只要进入这里，说明有新目标
            hasNewTargets = true;
            // B. 现场计算优劣势 (跑 CHECK 脚本)
            // const checkContext = { target: targetActor, flags: { grantAdvantage: false, grantDisadvantage: false } };
            const checkContext = {
                target: targetActor,
                flags: {
                    grantLevel: 0,
                    grantFeintLevel: 0,  // 虚招修正
                    ignoreBlock: false,
                    ignoreDefense: false,
                    ignoreStance: false
                }
            }; //换成优劣势计数
            const move = item.system.moves.find(m => m.id === flags.moveId);
            await attacker.runScripts(SCRIPT_TRIGGERS.CHECK, checkContext, move);

            // 合并逻辑 (Base OR Script)
            let finalIgnoreBlock = baseIgnoreBlock || checkContext.flags.ignoreBlock;
            let finalIgnoreDefense = baseIgnoreDefense || checkContext.flags.ignoreDefense;
            let finalIgnoreStance = baseIgnoreStance || checkContext.flags.ignoreStance;

            // 强制修正趁虚而入
            // 这样即使是重算（没有缓存），也能保证无视架招生效
            if (flags.moveId === "opportunity") {
                finalIgnoreBlock = true;
                finalIgnoreStance = true;
            }

            // --- 1. 计算命中优劣势 (Attack State) ---
            let attackState = 0;
            // 只有需要检定的招式才计算命中优劣
            if (needsCheck) {
                // 1. 目标给予 (当前时刻)
                const targetGrant = targetActor.xjzlStatuses?.grantAttackLevel || 0;
                // 2. 脚本临时修正
                const scriptGrant = checkContext.flags.grantLevel || 0;
                // 汇总
                const totalLevel = selfLevel + targetGrant + scriptGrant;

                if (totalLevel > 0) attackState = 1;
                else if (totalLevel < 0) attackState = -1;
            }

            // --- 2. 计算虚招优劣势 (Feint State) ---
            // 即使是必中招式，如果它是虚招，也需要这个状态
            const targetFeintGrant = targetActor.xjzlStatuses?.defendFeintLevel || 0;
            const scriptFeintGrant = checkContext.flags.grantFeintLevel || 0;
            const totalFeintLevel = selfFeintLevel + targetFeintGrant + scriptFeintGrant;

            let feintState = 0;
            if (totalFeintLevel > 0) feintState = 1;
            else if (totalFeintLevel < 0) feintState = -1;

            targetStates.set(uuid, {
                attackState: attackState,
                feintState: feintState,
                ignoreBlock: finalIgnoreBlock,
                ignoreDefense: finalIgnoreDefense,
                ignoreStance: finalIgnoreStance
            });

            // 关键判断：如果状态不平，且没有 D2，则需要补骰
            if (needsCheck && attackState !== 0 && d2 === null) {
                needsSupplemental = true;
            }
        }

        // =====================================================
        // 3. 交互式补骰 (Interactive Supplemental Roll)
        // =====================================================
        if (needsSupplemental) {
            const confirm = await foundry.applications.api.DialogV2.confirm({
                window: { title: "补投检定", icon: "fas fa-dice-d20" },
                content: `<p>部分目标的当前状态导致攻击具有 <b>优势</b> 或 <b>劣势</b>。</p>
                        <p>需要补投一个 <b>d20</b> 来进行最终裁定。</p>`,
                ok: { label: "投掷" },
                rejectClose: false
            });

            if (!confirm) return null; // 玩家取消，中断流程

            // 投掷 D2
            const r = await new Roll("1d20").evaluate();
            d2 = r.total;
            if (game.dice3d) game.dice3d.showForRoll(r, game.user, true);

            // 异步更新消息 (持久化 D2)
            await message.update({ "flags.xjzl-system.supplementalDie": d2 });
        }

        // =====================================================
        // 4. 发送结果汇总卡片 (New Targets Summary)
        // =====================================================

        // 只要有新目标参与计算，或者进行了补骰，就发送汇总卡片
        // 这样玩家就能看到新选中的这些人到底中没中
        if (needsSupplemental || hasNewTargets) {
            // --- 生成补骰结果卡片 (预览) ---
            let resultListHtml = "";

            for (const target of targets) {
                const uuid = target.uuid;
                const safeKey = uuid.replaceAll(".", "_");
                // 如果是旧缓存，跳过显示（因为已经在之前的卡片里显示过了）
                // 这里我们只显示本次新计算的目标
                if (flags.targetsResultMap?.[safeKey]) continue;

                const tActor = target.actor || target;
                if (!tActor) continue;

                const displayName = target.name || tActor.name;

                // 复用计算逻辑 (局部)
                const states = targetStates.get(uuid) || { attackState: 0, feintState: 0 }; // 读取刚才算的状态
                const state = states.attackState;

                // --- 命中判定逻辑 ---
                let stateLabel = "-";
                let displayTotal = "-";
                let dodge = "-";
                let isHit = true; // 默认为中 (针对反击等)
                let color = "green";
                let label = "必中";

                if (needsCheck) {
                    let finalDie = d1;
                    stateLabel = "平";

                    if (state === 1) { finalDie = Math.max(d1, d2); stateLabel = "优"; }
                    else if (state === -1) { finalDie = Math.min(d1, d2); stateLabel = "劣"; }

                    const total = finalDie + hitMod + manualBonus;
                    dodge = tActor.system.combat.dodgeTotal || 10;
                    displayTotal = total

                    // 判定命中 (含20必中/1必失)
                    if (finalDie === 20) isHit = true;
                    else if (finalDie === 1) isHit = false;
                    else isHit = total >= dodge;

                    color = isHit ? "green" : "red";
                    label = isHit ? "命中" : "未中";
                }

                resultListHtml += `
                    <li style="display:flex; justify-content:space-between; font-size:0.9em; border-bottom:1px dashed #eee;">
                        <span>${displayName}</span>
                        <span>
                            <span style="color:#666;">[${stateLabel}]</span> 
                            ${displayTotal} vs ${dodge} 
                            <b style="color:${color};">(${label})</b>
                        </span>
                    </li>`;
            }
            // --- 优化标题显示 ---
            let headerHtml = "";
            // 发送卡片
            if (needsSupplemental) {
                // 场景：刚刚现投了一个补骰
                headerHtml = `补骰: <span style="font-weight:bold; color:var(--xjzl-gold); font-size:1.4em;">${d2}</span> <span style="font-size:0.8em; color:#666;">(原始: ${d1})</span>`;
            } else if (d2 !== null) {
                // 场景：不需要现投，但使用了 D2 (可能是原生双骰，也可能是历史补骰)
                const sourceText = isNativeDouble ? "双骰取值" : "历史补骰";
                headerHtml = `${sourceText} <span style="font-size:0.8em; color:#666;">(D1:${d1} / D2:${d2})</span>`;
            } else if (!needsCheck) {
                headerHtml = `无需检定 <span style="font-size:0.8em; color:#666;">(必中)</span>`;
            } else {
                // 场景：普通单骰
                headerHtml = `结算结果 <span style="font-size:0.8em; color:#666;">(D20: ${d1})</span>`;
            }
            if (resultListHtml) {
                ChatMessage.create({
                    user: game.user.id,
                    speaker: ChatMessage.getSpeaker({ actor: attacker }),
                    flavor: "命中结算详情",
                    content: `
                    <div class="xjzl-chat-card">
                        <div class="card-content-wrapper">
                            <div style="font-size:1.1em; text-align:center; padding:5px; border-bottom:1px solid #ccc;">
                                ${headerHtml}
                            </div>
                            <ul style="list-style:none; padding:5px; margin:0;">
                                ${resultListHtml}
                            </ul>
                        </div>
                    </div>`
                });
            }
        }

        // =====================================================
        // 5. 计算最终结果 (Final Resolution)
        // =====================================================
        const results = {};

        for (const target of targets) {
            const uuid = target.uuid;
            const safeKey = uuid.replaceAll(".", "_");
            const targetActor = target.actor || target;
            if (!targetActor) continue;

            // A. 缓存优先 (如果是 ApplyDamage 二次调用，且不需要补骰，可能走缓存)
            // 但如果刚补了骰子，这里的缓存可能还是旧的，所以要注意 flags 更新时机
            // 通常建议如果 d2 存在，总是重新计算最稳妥
            const cached = flags.targetsResultMap?.[safeKey];
            if (cached && !needsSupplemental) {
                results[uuid] = cached;
                continue;
            }

            // B. 确定最终使用的骰子 (Final Die)
            const states = targetStates.get(uuid) || { attackState: 0, feintState: 0 };
            const state = states.attackState;
            let finalDie = d1;
            let isHit = true;
            let total = 0;
            if (needsCheck) {
                // 此时 d2 一定就位 (除非 state=0 或者用户取消了)
                if (state === 1 && d2 !== null) finalDie = Math.max(d1, d2);
                else if (state === -1 && d2 !== null) finalDie = Math.min(d1, d2);

                // C. 计算数值
                total = finalDie + hitMod + manualBonus;
                const dodge = targetActor.system.combat.dodgeTotal || 10;

                // D. 判定命中
                // 规则：20必中，1必失
                if (finalDie === 20) {
                    isHit = true;
                } else if (finalDie === 1) {
                    isHit = false;
                } else {
                    isHit = total >= dodge;
                }
            }

            results[uuid] = {
                isHit: isHit,
                total: total, //total为0且isHit为true说明是不需要判断的必中攻击
                dieUsed: needsCheck ? finalDie : "-", // 这里的 Key 改为 dieUsed 比较明确，之前的代码混用了 die 和 dieUsed
                stateLabel: state === 1 ? "优" : (state === -1 ? "劣" : "平"),
                feintState: states.feintState,
                ignoreBlock: states.ignoreBlock,
                ignoreDefense: states.ignoreDefense,
                ignoreStance: states.ignoreStance
            };
        }

        // 将计算出的 results 写入 Message Flag
        // 将 Results 对象转换为 Array，避免 Key 中包含 '.' 导致数据库存储为嵌套对象
        // 格式转换: { "Scene.x.Token.y": { isHit: true } } -> [ { uuid: "Scene.x.Token.y", isHit: true } ]
        const resultsArray = Object.entries(results).map(([uuid, res]) => ({
            uuid: uuid,
            ...res
        }));
        // 使用 setFlag 是原子操作，它会自动触发 update
        // 这一步之后，下次再调用这个函数，就会在第 0 步直接返回这个 results
        await message.setFlag("xjzl-system", "finalResolvedHit", resultsArray);

        return results;
    }

    /* -------------------------------------------- */
    /*  虚招对抗 (Feint Contest)             */
    /* -------------------------------------------- */

    /**
     * 执行虚招对抗流程
     * 1. 复核命中 -> 2. 攻方投掷(仅一次) -> 3. 发送防御请求
     */
    static async _rollFeintContest(attacker, item, flags, targets, message) {
        // 如果标记显示已经处理过，直接提示并退出
        if (flags.feintProcessed) {
            ui.notifications.warn("该虚招对抗请求已处理完毕，请勿重复点击。");
            return;
        }
        // 1. 命中复核 (包含潜在的补骰交互)
        // 这会返回一个 Map: { uuid: { isHit: true/false, ... } }
        const hitResults = await this._resolveHitRoll(attacker, item, flags, targets, message);

        // 如果返回 null，说明在补骰阶段玩家点击了取消，中断流程
        if (!hitResults) return;

        const feintVal = flags.feint || 0;
        const alreadyRequested = flags.feintRequestSent || [];
        // 临时存储预筛选出来的有效目标，避免直接循环时无法判断是否需要投骰子
        const validTargetsToRequest = [];
        const skippedLog = []; // 用于记录无需对抗的目标及其原因

        let needsTwoDice = false; // 是否需要投掷 2 个骰子

        for (const target of targets) {
            const uuid = target.uuid;
            // 获取 Actor (TokenDocument 不包含 system 数据，必须取 actor)
            const targetActor = target.actor || target;
            if (!targetActor) continue;

            // 获取显示名称：优先用 Token 名字
            const displayName = target.name || targetActor.name;

            // A. 防刷检查：如果已经给这个人发过卡了，直接跳过
            if (alreadyRequested.includes(uuid)) {
                // 可选：提示一下用户
                // ui.notifications.info(`已经向 ${target.name} 发送过请求了。`);
                // skippedLog.push({ name: targetActor.name, reason: "已请求" });
                continue;
            }

            // B. 命中检查
            const res = hitResults[uuid];
            if (res && !res.isHit) {
                // ui.notifications.warn(`${target.name} 闪避了攻击，无需对抗。`);
                skippedLog.push({ name: displayName, reason: "已闪避" });  //改为在卡片里提醒
                continue;
            }

            // C. 架招检查
            if (!targetActor.system.martial.stanceActive) {
                // ui.notifications.info(`${target.name} 未开启架招。`);
                skippedLog.push({ name: displayName, reason: "未开启架招。" });
                continue;
            }

            // D. 检查该目标的虚招优劣势 (从结果中直接读取)
            // res.feintState 在 Item.roll 阶段已计算并存入 targetsResultMap
            if (res.feintState !== 0) {
                needsTwoDice = true;
            }

            // 存入待处理列表
            validTargetsToRequest.push({
                uuid: uuid,
                actor: targetActor,
                target: target, // 保留原始target对象以获取纹理
                displayName: displayName,
                feintState: res.feintState || 0
            });
        }

        // 准备更新到 message 的数据对象
        const updateData = {};
        let newlyRequested = [];

        if (validTargetsToRequest.length > 0) {
            let d1 = 0;
            let d2 = null;
            if (needsTwoDice) {
                // 优势或劣势：一次性投 2d20，生成合并动画
                const r = await new Roll("2d20").evaluate();
                if (game.dice3d) game.dice3d.showForRoll(r, game.user, true);

                // 提取结果
                d1 = r.terms[0].results[0].result;
                d2 = r.terms[0].results[1].result;
            } else {
                // 普通：投 1d20
                const r = await new Roll("1d20").evaluate();
                if (game.dice3d) game.dice3d.showForRoll(r, game.user, true);

                d1 = r.total;
                d2 = null;
            }

            // 3. 遍历有效目标发送请求
            for (const tData of validTargetsToRequest) {
                const { uuid, actor: targetActor, target, displayName, feintState } = tData;

                // 计算针对该目标的最终点数
                let finalDie = d1;
                let rollDisplay = `${d1}`;

                if (feintState === 1 && d2 !== null) {
                    finalDie = Math.max(d1, d2);
                    rollDisplay = `优势(${d1}, ${d2}) ➔ <b>${finalDie}</b>`;
                } else if (feintState === -1 && d2 !== null) {
                    finalDie = Math.min(d1, d2);
                    rollDisplay = `劣势(${d1}, ${d2}) ➔ <b>${finalDie}</b>`;
                }

                const attackTotal = finalDie + feintVal;

                // 获取头像
                const imgPath = target.texture?.src || targetActor.img;

                // D. 渲染并发送防御请求卡
                const templateData = {
                    attackerName: attacker.name,
                    targetName: displayName,
                    targetImg: imgPath,
                    rollTotal: rollDisplay,
                    feintVal: feintVal,
                    attackTotal: attackTotal,
                    targetUuid: uuid,
                    originMessageId: message.id
                };

                const content = await renderTemplate(
                    "systems/xjzl-system/templates/chat/request-defense.hbs",
                    templateData
                );

                ChatMessage.create({
                    user: game.user.id,
                    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
                    content: content,
                    flags: {
                        "xjzl-system": {
                            type: "defense-request",
                            targetUuid: uuid,
                            attackTotal: attackTotal,
                            originMessageId: message.id
                        }
                    }
                });

                newlyRequested.push(uuid);
            }
        }
        // 4. 发送“忽略名单”汇总卡片 (公开消息)
        // 无论有没有有效目标，只要有被忽略的（比如闪避了），都显示出来
        if (skippedLog.length > 0) {
            let summaryHtml = `
            <div class="xjzl-chat-card">
                <header class="card-header" style="border-bottom: 2px solid #aaa; padding-bottom: 5px; margin-bottom: 5px; display: flex; align-items: center; gap: 5px;">
                    <i class="fas fa-info-circle" style="color: #666;"></i>
                    <h3 style="margin: 0; font-weight: bold; color: #555; font-size: 1em;">无需对抗名单</h3>
                </header>
                <div style="font-size: 0.9em; color: #444; background: rgba(0,0,0,0.03); padding: 5px; border-radius: 4px;">
                    <ul style="margin: 0; padding-left: 20px;">
                        ${skippedLog.map(log => `<li><b>${log.name}</b>: ${log.reason}</li>`).join('')}
                    </ul>
                </div>
            </div>`;

            ChatMessage.create({
                user: game.user.id,
                speaker: { alias: "战斗提示" },
                content: summaryHtml
            });
        }

        // 提示无目标
        if (validTargetsToRequest.length === 0 && skippedLog.length === 0) {
            ui.notifications.warn("没有有效的目标进行对抗。");
        }

        // --- 5. 批量更新数据库 (包含防刷名单、骰子结果、以及最重要的“已处理”锁) ---

        // 更新已发送名单
        if (newlyRequested.length > 0) {
            const updatedList = [...alreadyRequested, ...newlyRequested];
            updateData["flags.xjzl-system.feintRequestSent"] = updatedList;
        }

        // 只要代码跑到了这里，无论是发了卡还是因为全部闪避而结束，都视为本次交互已完成
        updateData["flags.xjzl-system.feintProcessed"] = true;

        // 执行一次性更新
        if (!foundry.utils.isEmpty(updateData)) {
            await message.update(updateData);
        }
    }

    /**
     * 响应虚招对抗
     */
    static async _onDefendFeint(defender, flags, message) {
        // =====================================================
        // 1. 基础校验 (Validation)
        // =====================================================

        // 获取文档对象 (可能是 TokenDocument 或 Actor)
        const targetDoc = await fromUuid(flags.targetUuid);
        if (!targetDoc) return ui.notifications.warn("目标已不存在。");

        // 统一获取 Actor 实例 (兼容性处理)
        const targetActor = targetDoc.actor || targetDoc;
        if (!targetActor || !targetActor.system) {
            return ui.notifications.error("无法获取目标角色的数据。");
        }

        const displayName = targetDoc.name || targetActor.name;
        // 将 UUID 中的点号替换为下划线，防止 update 时被解析为嵌套对象路径
        const safeKey = flags.targetUuid.replaceAll(".", "_");

        // =====================================================
        // 2. 防重复/状态校验 (Anti-Spam & State Check)
        // =====================================================

        const originMsg = game.messages.get(flags.originMessageId);

        if (originMsg) {
            // 读取原始攻击消息中的结果记录
            const currentResults = originMsg.flags["xjzl-system"]?.feintResults || {};

            // 如果该目标的 UUID 已经在结果列表中，说明已经处理过了
            if (currentResults[safeKey]) {
                // [UX优化] 为了视觉同步，尝试将当前卡片的按钮置灰 (即使逻辑上已拦截)
                const div = document.createElement("div");
                div.innerHTML = message.content;
                const btn = div.querySelector('button[data-action="rollDefendFeint"]');

                // 如果按钮存在且未禁用，更新它
                if (btn && !btn.disabled) {
                    btn.disabled = true;
                    btn.style.background = "#555";
                    btn.style.color = "#999";
                    btn.style.cursor = "not-allowed";
                    btn.innerText = "已检定";
                    await message.update({ content: div.innerHTML });
                }
                return ui.notifications.warn(`${displayName} 已经进行过对抗了。`);
            }
        } else {
            return ui.notifications.warn("原始攻击消息已丢失，无法记录对抗结果。");
        }

        // =====================================================
        // 3. 上下文准备 & 自动优劣势计算 (Context & Auto Levels)
        // =====================================================

        // 获取攻击者实例 (用于读取 attacker.xjzlStatuses)
        let attackerActor = null;
        const speaker = originMsg.speaker;
        if (speaker.token) attackerActor = game.actors.tokens[speaker.token];
        if (!attackerActor) attackerActor = game.actors.get(speaker.actor);

        // A. 自身抗性: 防御者自身的看破能力修正
        const selfLevel = targetActor.xjzlStatuses?.feintLevel || 0;

        // B. 外来影响: 攻击者状态赋予防御者的修正 (例如攻击者动作迟缓)
        let grantLevel = 0;
        if (attackerActor) {
            grantLevel = attackerActor.xjzlStatuses?.defendFeintLevel || 0;
        }

        // C. 汇总自动层级
        const autoLevel = selfLevel + grantLevel;
        // 获取基础看破值
        const kanpoBase = targetActor.system.combat.kanpoTotal || 0;

        // =====================================================
        // 4. 玩家交互弹窗 (Configuration Dialog)
        // =====================================================

        // 生成唯一 ID 用于 DOM 锚定 (遵循 V13 最佳实践)
        const formId = `defend-config-${foundry.utils.randomID()}`;

        // 渲染弹窗内容 (HBS)
        // 使用 defend-config.hbs，它复用了 roll-config 的 CSS 样式
        const dialogHtml = await renderTemplate("systems/xjzl-system/templates/apps/defend-config.hbs", {
            formId: formId,
            attackTotal: flags.attackTotal, // 敌方虚招强度
            kanpoBase: kanpoBase,           // 我方基础看破
            autoLevel: autoLevel            // 当前自动优劣势
        });

        // 等待玩家操作 (DialogV2.wait)
        const dialogResult = await foundry.applications.api.DialogV2.wait({
            window: { title: `看破检定: ${displayName}`, icon: "fas fa-eye" },
            content: dialogHtml,

            // [交互] 绑定加减号按钮事件
            render: (event) => {
                const root = document.getElementById(formId);
                if (!root) return;

                // 使用事件委托 (Event Delegation) 监听根节点点击
                root.addEventListener("click", (e) => {
                    const btn = e.target.closest("button[data-action]");
                    if (!btn) return;
                    e.preventDefault();

                    const action = btn.dataset.action; // increase / decrease
                    const targetName = btn.dataset.target; // input name

                    const input = root.querySelector(`input[name="${targetName}"]`);
                    if (!input) return;

                    let val = parseInt(input.value) || 0;
                    if (action === "increase") val++;
                    else if (action === "decrease") val--;

                    input.value = val;
                });
            },

            buttons: [{
                action: "ok",
                label: "投掷",
                icon: "fas fa-dice",
                default: true,
                callback: (event, button, dialog) => {
                    // 使用 ID 稳健获取数据，不依赖 event.form
                    const root = document.getElementById(formId);
                    if (!root) return null;
                    return {
                        bonus: parseInt(root.querySelector('[name="bonus"]').value) || 0,
                        manualLevel: parseInt(root.querySelector('[name="manualLevel"]').value) || 0
                    };
                }
            }],
            rejectClose: false, // 允许点击 X 关闭返回 null
            close: () => null
        });

        if (!dialogResult) return; // 用户取消操作

        // =====================================================
        // 5. 核心投掷与判定 (Core Roll & Resolution)
        // =====================================================

        // 最终层级 = 自动层级 + 手动调整
        const finalLevel = autoLevel + dialogResult.manualLevel;
        const bonus = dialogResult.bonus;

        // 确定骰子公式
        let diceFormula = "1d20";
        let flavorStatus = "";

        if (finalLevel > 0) {
            diceFormula = "2d20kh";
            flavorStatus = "(优势)";
        } else if (finalLevel < 0) {
            diceFormula = "2d20kl";
            flavorStatus = "(劣势)";
        }

        // 执行投掷
        const roll = await new Roll(`${diceFormula} + @kanpo + @bonus`, {
            kanpo: kanpoBase,
            bonus: bonus
        }).evaluate();

        // 播放 3D 骰子
        if (game.dice3d) game.dice3d.showForRoll(roll, game.user, true);

        const defTotal = roll.total;
        const atkTotal = flags.attackTotal;

        // 判定规则: 攻方 >= 守方 则破防 (Defender loses on ties)
        const isBroken = atkTotal >= defTotal;

        // =====================================================
        // 6. 状态变更与视觉反馈 (State Updates & VFX)
        // =====================================================
        // 把击破架招放到应用伤害里，避免aoe虚招有一个人反击了
        if (!isBroken) {
            // A. 判定成功：架招维持
            // B. 视觉反馈 (飘字: 绿色)
            if (targetActor.token?.object) {
                canvas.interface.createScrollingText(targetActor.token.object.center, "看破！", {
                    fill: "#00ff00", stroke: "#000000", strokeThickness: 4, jitter: 0.25
                });
            }
        }

        // =====================================================
        // 7. 渲染结果 HTML (Render Result)
        // =====================================================

        // 解析骰子详情用于显示
        const diceTerm = roll.terms[0];
        const diceTotal = diceTerm.total; // 骰子结果 (不含加值)
        const rawResults = diceTerm.results.map(r => r.result).join(", ");
        let rollDisplay = "";

        // 格式化显示逻辑 (如果是优势/劣势，显示原始点数和最终取值)
        if (diceTerm.results.length > 1) {
            rollDisplay = `${diceFormula} <span style="color:#666; font-size:0.9em;">(${rawResults})</span> <i class="fas fa-arrow-right" style="font-size:0.8em"></i> <b>${diceTotal}</b>`;
        } else {
            rollDisplay = `${diceFormula} <i class="fas fa-arrow-right" style="font-size:0.8em"></i> <b>${diceTotal}</b>`;
        }

        // 准备模板数据
        const templateData = {
            rollDisplay: rollDisplay,
            kanpoBase: kanpoBase,
            bonus: bonus,
            defTotal: defTotal,
            isBroken: isBroken
        };

        // 渲染结果面板 (defend-result.hbs)
        const resultHtml = await renderTemplate(
            "systems/xjzl-system/templates/chat/defend-result.hbs",
            templateData
        );

        // =====================================================
        // 8. 数据回写 (Data Persistence)
        // =====================================================

        // 将结果写入原始攻击消息的 Flags 中
        // 这样后续应用伤害时，就能查到 "broken" 或 "resisted" 状态
        const resultValue = isBroken ? "broken" : "resisted";
        await originMsg.update({
            [`flags.xjzl-system.feintResults.${safeKey}`]: resultValue
        });

        // =====================================================
        // 9. 界面闭环更新 (UI In-Place Update)
        // =====================================================

        // 核心体验优化：直接替换请求卡片上的按钮，而不是发新消息
        // 使用 DOM 操作避免正则替换的脆弱性

        const div = document.createElement("div");
        div.innerHTML = message.content;

        // 查找按钮容器 (.card-buttons)
        const btnContainer = div.querySelector(".card-buttons");

        if (btnContainer) {
            // 用结果面板完全替换按钮区域
            btnContainer.outerHTML = resultHtml;

            // 更新聊天消息内容
            await message.update({ content: div.innerHTML });
        } else {
            // 保底方案：如果因为模板变更找不到容器，则发送一条新消息
            console.warn("XJZL | 无法定位防御按钮进行原地更新，发送新卡片。");
            ChatMessage.create({
                user: game.user.id,
                speaker: ChatMessage.getSpeaker({ actor: targetActor }),
                content: resultHtml
            });
        }
    }

    /**
     * 应用伤害
     */
    static async _applyDamage(attacker, item, flags, targets, message) {
        // 1. 命中复核
        const hitResults = await this._resolveHitRoll(attacker, item, flags, targets, message);
        // 如果点取消，hitResults 为 null，中断流程
        if (!hitResults) return;
        // 2. 虚招“漏网之鱼”检查
        // 检查是否有：目标开了架招 && 是虚招攻击 && 还没有对抗结果 && 被命中
        const move = item.system.moves.find(m => m.id === flags.moveId);
        const feintResults = flags.feintResults || {};
        const isFeintMove = move?.type === "feint";
        let missingDefense = false;

        if (isFeintMove) {
            for (const target of targets) {
                const targetActor = target.actor || target; // 兼容 Token/Actor
                // 必须用 target.uuid (Token UUID) 来查表
                // 我们储存的时候把uuid的.替换成下划线来避免被视为嵌套对象，读取的时候也必须这样读取
                const safeKey = target.uuid.replaceAll(".", "_");
                const hasResult = feintResults[safeKey];
                const stanceActive = targetActor.system?.martial?.stanceActive;
                const res = hitResults[target.uuid];
                // 如果没命中，不需要对抗，自然也不算漏网
                if (!res || !res.isHit) continue;

                // 如果开了架招，且没有对抗结果，视为“漏网”
                if (stanceActive && !hasResult) {
                    missingDefense = true;
                    break;
                }
            }
        }

        if (missingDefense) {
            const confirm = await foundry.applications.api.DialogV2.confirm({
                window: { title: "未对抗警告", icon: "fas fa-exclamation-triangle" },
                content: `<p>检测到<b>已命中</b>且<b>开启架招</b>的目标尚未进行虚招对抗。</p>
                          <p>直接应用伤害将导致<b>无法触发破防效果</b>（架招格挡值将正常生效）。</p>
                          <p>是否继续？</p>`,
                ok: { label: "强行应用", icon: "fas fa-skull" },
                reject: { label: "我再去点一下", icon: "fas fa-arrow-left" }
            });
            if (!confirm) return;
        }

        // 3. 准备全局统计 (用于 HIT_ONCE)
        const summary = [];
        let hitCount = 0;

        // 4. 遍历目标
        for (const target of targets) {
            const uuid = target.uuid;
            const targetActor = target.actor || target;
            if (!targetActor) continue;

            const displayName = target.name || targetActor.name;


            // A. 准备基础参数
            const res = hitResults[uuid];
            const isHit = res ? res.isHit : false;
            const die = res ? res.die : 0;

            const ignoreBlock = res.ignoreBlock || false;
            const ignoreDefense = res.ignoreDefense || false;
            const ignoreStance = res.ignoreStance || false;

            // B. 判定暴击 (Critical)
            // 逻辑：只要命中且骰子点数 >= 阈值，就算暴击 (触发暴击特效)
            // 至于是否造成双倍伤害，由 flags.canCrit 控制，传给 Actor 处理
            let isCrit = false;
            const damageType = flags.damageType;

            if (["waigong", "neigong"].includes(damageType)) {
                // 阈值 (例如 18，代表 18,19,20 都是暴击)
                const critThreshold = (damageType === "neigong")
                    ? attacker.system.combat.critNeigongTotal
                    : attacker.system.combat.critWaigongTotal;

                // 命中 且 骰子 >= 阈值
                if (isHit && die >= critThreshold) {
                    isCrit = true;
                }
            }

            // 获取对抗结果 (broken / resisted / undefined)
            // 我们储存的时候把uuid的.替换成下划线来避免被视为嵌套对象，读取的时候也必须这样读取
            const safeKey = uuid.replaceAll(".", "_");
            const feintStatus = feintResults[safeKey];
            const isBroken = (feintStatus === "broken");
            // =====================================================
            // 把击破架招移动到这里来处理
            // =====================================================
            if (isHit && isBroken && targetActor.system.martial.stanceActive) {

                // A. 判定失败：移除架招状态
                await targetActor.update({ "system.martial.stanceActive": false });
                // B. 应用 "破防" 状态
                // 从配置中获取标准数据
                const statusConfig = CONFIG.statusEffects.find(e => e.id === "pofang");


                if (statusConfig) {
                    // [Optimized] 直接展开配置对象
                    // 这样 name, img, changes, duration, statuses 全部自动继承
                    const breakEffectData = {
                        ...statusConfig,
                        name: game.i18n.localize(statusConfig.name), // 确保本地化
                        description: game.i18n.localize(statusConfig.description),
                        origin: attacker ? attacker.uuid : message.uuid  // 只有来源是动态的
                    };
                    await targetActor.createEmbeddedDocuments("ActiveEffect", [breakEffectData]);
                }

                // C. 视觉反馈 (飘字: 红色)
                if (targetActor.token?.object) {
                    canvas.interface.createScrollingText(targetActor.token.object.center, "被击破架招！", {
                        fill: "#ff0000", stroke: "#000000", strokeThickness: 4, jitter: 0.25
                    });
                }
            }
            // 判断是否是招式
            const isSkillDamage = move.type !== "basic";
            // C. 调用 Actor 伤害处理
            const damageResult = await targetActor.applyDamage({
                amount: flags.damage,      // 面板伤害
                type: flags.damageType,    // 伤害类型
                attacker: attacker,        // 攻击者
                isHit: isHit,              // 命中状态
                isCrit: isCrit,            // 暴击状态 (用于触发特效)
                applyCritDamage: flags.canCrit, // 配置: 是否应用暴击伤害倍率 (用于计算数值)
                isBroken: isBroken,        // 破防状态
                ignoreBlock: ignoreBlock,    //无视格挡
                ignoreDefense: ignoreDefense, //无视内外功防御
                ignoreStance: ignoreStance,  //无视架招
                isSkill: isSkillDamage
            });

            // 统计数据更新为该目标发送独立伤害卡片 (仅命中时)
            if (isHit) {
                hitCount++;
                const templateData = {
                    name: displayName,
                    img: target.texture?.src || targetActor.img, // 优先取 Token 图
                    finalDamage: damageResult.finalDamage,
                    hutiLost: damageResult.hutiLost,
                    hpLost: damageResult.hpLost,
                    mpLost: damageResult.mpLost,
                    tiliLost: damageResult.tiliLost, // 传递体力损失，仅用于野兽
                    isDead: damageResult.isDead,
                    isDying: damageResult.isDying,
                    rageGained: damageResult.rageGained, // 防御者是否回怒
                    isUndone: false
                };

                const content = await renderTemplate(
                    "systems/xjzl-system/templates/chat/damage-card.hbs",
                    templateData
                );

                // 准备单人份的 Undo 数据
                const undoData = {
                    attackerUuid: attacker.uuid, // 仅用于提示
                    targetUuid: uuid,
                    hpLost: damageResult.hpLost,
                    hutiLost: damageResult.hutiLost,
                    mpLost: damageResult.mpLost,
                    tiliLost: damageResult.tiliLost, // 记录体力损失，仅用于野兽
                    gainedDead: damageResult.isDead,
                    gainedDying: damageResult.isDying,
                    gainedRage: damageResult.rageGained // 防御者回怒状态
                };

                // 发送消息
                ChatMessage.create({
                    user: game.user.id,
                    speaker: ChatMessage.getSpeaker({ actor: targetActor }), // Speaker 设为受害者
                    content: content,
                    flags: {
                        "xjzl-system": {
                            type: "damage-card", // 标记类型
                            undoData: undoData   // 存入数据
                        }
                    }
                });
            }



            // D. 收集结果
            // damageResult 应该包含: { finalDamage: 10, hpLost: 10, isDead: false ... }
            const resultEntry = {
                target: targetActor,
                isHit: isHit,
                isCrit: isCrit,
                isBroken: isBroken,
                baseDamage: flags.damage, // 面板伤害 (吸血逻辑可能需要这个)

                // 展开 Actor 返回的结算数据
                finalDamage: damageResult.finalDamage,  //实际伤害
                hpLost: damageResult.hpLost,
                hutiLost: damageResult.hutiLost,
                mpLost: damageResult.mpLost,
                isDying: damageResult.isDying,
                isDead: damageResult.isDead,

                // 保留完整对象备查
                damageResult: damageResult
            };
            summary.push(resultEntry);

            // E. 执行攻击者脚本 (Trigger: HIT)
            // 现在我们可以把“实际伤害”传给攻击者了 (比如：吸血逻辑，当然我们侠界的吸血是高贵的吸收没有减免的伤害)
            const hitContext = {
                ...resultEntry, // 展开上面的结果
                attacker: attacker,
                item: item,
                move: move
            };

            // 无论命中与否都执行，脚本内自己判断 if (args.isHit)
            await attacker.runScripts(SCRIPT_TRIGGERS.HIT, hitContext, move);
        }

        // =====================================================
        // 5. 攻击者后续处理 (Global Post-Process)
        // =====================================================

        // A. 攻击者回怒 (Attacker Rage)
        // 规则：只要本次出招命中了至少一个敌人，攻击者回复 1 点怒气
        // 放在这里执行满足 "AOE只回1点" 的需求
        // A. 攻击者回怒 (Attacker Rage)
        // 规则：只要本次出招命中了至少一个敌人，且是内外功伤害，攻击者回复 1 点怒气
        if (hitCount > 0) {
            const attRage = attacker.system.resources.rage;
            // 检查封穴状态
            const attNoRecover = attacker.xjzlStatuses?.noRecoverRage;
            // 检查伤害类型
            const isValidType = ["waigong", "neigong"].includes(flags.damageType);

            if (isValidType && attRage.value < attRage.max && !attNoRecover) {
                // 执行更新
                await attacker.update({ "system.resources.rage.value": attRage.value + 1 });
            }
        }

        // B. 执行全局结算脚本 (Trigger: HIT_ONCE)
        const globalContext = {
            targets: summary,         // 包含所有目标的详细结果
            hitCount: hitCount,       // 总命中数
            baseDamage: flags.damage, // 面板伤害
            // totalDamageDealt: summary.reduce((a, b) => a + (b.finalDamage || 0), 0), // 总造成伤害，感觉用不到，先注释掉
            attacker: attacker,
            item: item,
            move: move
        };

        await attacker.runScripts(SCRIPT_TRIGGERS.HIT_ONCE, globalContext, move);
    }

    /**
     * 动作: 撤销伤害 (Undo Damage)
     */
    static async _undoDamage(message) {
        const undoData = message.flags["xjzl-system"]?.undoData;
        if (!undoData) return ui.notifications.warn("无法读取撤销数据。");

        if (message.flags["xjzl-system"]?.isUndone) {
            return ui.notifications.warn("该次结算已撤销。");
        }

        // 1. 获取目标文档对象
        const doc = await fromUuid(undoData.targetUuid);
        if (!doc) return ui.notifications.warn("目标已不存在。");

        const actor = doc.actor || doc;

        const displayName = doc.name || actor.name;


        // 安全检查：确保 actor 存在且有 system 数据
        if (!actor || !actor.system) {
            return ui.notifications.error("无法获取目标角色的详细数据。");
        }

        // 2. 确认对话框
        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: `撤销结算: ${displayName}`, icon: "fas fa-undo" },
            content: `<p>确定要回退 <b>${displayName}</b> 的本次伤害结算吗？</p>
                      <ul style="font-size:0.9em; color:#555;">
                        <li>恢复损失的 HP/内力/护体</li>
                        ${undoData.gainedRage ? "<li>扣除获得的怒气 (1点)</li>" : ""}
                        ${undoData.gainedDead ? "<li>移除死亡状态</li>" : ""}
                      </ul>
                      <hr>
                      <p style="color:#e67e22; font-size:0.85em;">* 攻击者怒气需手动调整。</p>`,
            ok: { label: "撤销" }
        });
        if (!confirm) return;

        // 3. 执行回退
        const updates = {};
        const sys = actor.system;

        // A. 恢复数值 (注意兼容 NumberField 和 SchemaField)
        if (undoData.hpLost > 0) updates["system.resources.hp.value"] = sys.resources.hp.value + undoData.hpLost;

        // 恢复体力，用于野兽
        if (undoData.tiliLost > 0) {
            const currentTili = sys.resources.tili.value;
            updates["system.resources.tili.value"] = currentTili + undoData.tiliLost;
        }

        // Huti 兼容
        const currentHuti = typeof sys.resources.huti === 'object' ? sys.resources.huti.value : sys.resources.huti;
        if (undoData.hutiLost > 0) {
            if (typeof sys.resources.huti === 'object') updates["system.resources.huti.value"] = (currentHuti || 0) + undoData.hutiLost;
            else updates["system.resources.huti"] = (currentHuti || 0) + undoData.hutiLost;
        }

        if (undoData.mpLost > 0) updates["system.resources.mp.value"] = sys.resources.mp.value + undoData.mpLost;

        // B. 恢复怒气 (防御者)
        if (undoData.gainedRage) {
            if (sys.resources.rage.value > 0) {
                updates["system.resources.rage.value"] = sys.resources.rage.value - 1;
            }
        }

        // 应用数值更新
        if (!foundry.utils.isEmpty(updates)) {
            await actor.update(updates);
        }

        // =====================================================
        // C. 移除状态 (可以不用，因为已经在回血里处理了，所以删掉了)
        // =====================================================


        // 4. 更新卡片状态
        // const content = message.content.replace(
        //     /<button data-action="undoDamage".*?<\/button>/,
        //     `<div style="text-align:center; color:#888; border:1px solid #ccc; padding:5px; background:#eee;">已撤销</div>`
        // );

        // await message.update({
        //     content: content,
        //     "flags.xjzl-system.isUndone": true
        // });
        const div = document.createElement("div");
        div.innerHTML = message.content;

        // 精准查找撤销按钮
        const undoBtn = div.querySelector('button[data-action="undoDamage"]');

        if (undoBtn) {
            // 创建替代的提示元素
            const replacement = document.createElement("div");
            replacement.style.cssText = "text-align:center; color:#888; border:1px solid #ccc; padding:5px; background:#eee; font-size:0.85em; margin-top:5px;";
            replacement.innerHTML = '<i class="fas fa-history"></i> 已撤销';

            // 执行替换
            undoBtn.replaceWith(replacement);

            // 更新消息
            await message.update({
                content: div.innerHTML,
                "flags.xjzl-system.isUndone": true
            });
            ui.notifications.info("目标状态已回滚。但攻击者获得的怒气与触发的特效需要手动调整。");
        }


    }

    /**
     * 处理 Shift+点击 的手动伤害应用
     * 特点：使用当前目标，忽略命中检定，允许 GM 强行覆盖参数
     */
    static async _handleManualDamage(attacker, item, flags, message) {
        // 1. 强制获取当前选中的目标
        const targets = Array.from(game.user.targets).map(t => t.document);

        if (targets.length === 0) {
            return ui.notifications.warn("【手动模式】请先在场景中选中至少一个目标。");
        }

        // 2. 弹出配置窗口 (使用 DialogV2)
        // 默认值逻辑：
        // - 伤害: 0 (修正值)
        // - 暴击: false (是否强制暴击)
        // - 暴击倍率: true (如果暴击了，是否乘倍率)
        // - 击破架招: false
        // - 强制命中: true
        // - 无视格挡/防御: false
        const config = await ChatCardManager._promptManualConfig(flags.damage);
        if (!config) return; // 用户取消

        // 3. 准备数据
        // 基础伤害 = (面板伤害 + 手动修正)，不能小于0
        const finalBaseDamage = Math.max(0, flags.damage + config.damageMod);

        // 4. 循环应用
        const summary = [];
        let hitCount = 0;
        const move = item.system.moves.find(m => m.id === flags.moveId);

        for (const target of targets) {
            const targetActor = target.actor || target;
            if (!targetActor) continue;

            // “是否命中（默认命中）”，之所以需要配置这个，是为了触发可能存在的未命中特效
            const isHit = config.forceHit;

            // 判断是否为招式
            const isSkillDamage = move.type !== "basic";

            // 调用 Actor 伤害接口
            const damageResult = await targetActor.applyDamage({
                amount: finalBaseDamage,
                type: flags.damageType,    // 沿用招式类型
                attacker: attacker,
                isHit: isHit,
                isCrit: config.isCrit,     // 强制暴击状态
                applyCritDamage: config.applyCritDamage, // 是否计算双倍
                isBroken: config.isBroken, // 强制破防
                ignoreBlock: config.ignoreBlock,
                ignoreDefense: config.ignoreDefense,
                ignoreStance: config.ignoreStance,
                isSkill: isSkillDamage
            });

            if (isHit) {
                hitCount++;
                // 发送伤害卡片 (复用 damage-card.hbs)
                const templateData = {
                    name: target.name,
                    img: target.texture?.src || targetActor.img,
                    finalDamage: damageResult.finalDamage,
                    hutiLost: damageResult.hutiLost,
                    hpLost: damageResult.hpLost,
                    mpLost: damageResult.mpLost,
                    isDead: damageResult.isDead,
                    isDying: damageResult.isDying,
                    rageGained: damageResult.rageGained,
                    isUndone: false
                };

                const content = await renderTemplate(
                    "systems/xjzl-system/templates/chat/damage-card.hbs",
                    templateData
                );

                // 构造 Undo 数据
                const undoData = {
                    attackerUuid: attacker.uuid,
                    targetUuid: target.uuid,
                    hpLost: damageResult.hpLost,
                    hutiLost: damageResult.hutiLost,
                    mpLost: damageResult.mpLost,
                    gainedDead: damageResult.isDead,
                    gainedDying: damageResult.isDying,
                    gainedRage: damageResult.rageGained
                };

                ChatMessage.create({
                    user: game.user.id,
                    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
                    content: content,
                    flags: {
                        "xjzl-system": {
                            type: "damage-card",
                            undoData: undoData
                        }
                    }
                });
            }

            // 收集结果用于触发脚本
            const resultEntry = {
                target: targetActor,
                isHit: isHit,
                isCrit: config.isCrit,
                isBroken: config.isBroken,
                baseDamage: finalBaseDamage,
                ...damageResult,
                damageResult: damageResult
            };
            summary.push(resultEntry);

            // 触发 attacker 的 HIT 脚本
            // 即使是手动应用，我们也希望吸血、附毒等特效能触发，这样最符合直觉
            const hitContext = {
                ...resultEntry,
                attacker: attacker,
                item: item,
                move: move,
                isManual: true // 给脚本一个标记，万一脚本需要区分
            };
            await attacker.runScripts(SCRIPT_TRIGGERS.HIT, hitContext, move);
        }

        // 5. 触发全局 HIT_ONCE 脚本 & 攻击者回怒
        if (hitCount > 0) {
            // 手动模式也回怒
            const attRage = attacker.system.resources.rage;
            const attNoRecover = attacker.xjzlStatuses?.noRecoverRage;
            const isValidType = ["waigong", "neigong"].includes(flags.damageType);

            if (isValidType && attRage.value < attRage.max && !attNoRecover) {
                await attacker.update({ "system.resources.rage.value": attRage.value + 1 });
            }
        }

        const globalContext = {
            targets: summary,
            hitCount: hitCount,
            baseDamage: finalBaseDamage,
            attacker: attacker,
            item: item,
            move: move,
            isManual: true
        };
        await attacker.runScripts(SCRIPT_TRIGGERS.HIT_ONCE, globalContext, move);
    }

    /**
     * 弹出详细的手动伤害配置窗口
     */
    static async _promptManualConfig(baseDamage) {
        const content = `
        <div class="xjzl-dialog-content" style="padding:5px;">
            <div class="form-group">
                <label style="font-weight:bold;">当前面板伤害</label>
                <div style="font-family:monospace; font-size:1.2em; text-align:right;">${baseDamage}</div>
            </div>
            
            <hr>

            <div class="form-group">
                <label>伤害修正</label>
                <input type="number" name="damageMod" value="0" style="text-align:center; background:rgba(0,0,0,0.05);"/>
                <p class="notes">在原伤害基础上增减数值</p>
            </div>

            <div class="form-group">
                <label>是否命中</label>
                <input type="checkbox" name="forceHit" checked/>
            </div>

            <div class="form-group">
                <label>是否暴击</label>
                <input type="checkbox" name="isCrit"/>
            </div>

            <div class="form-group">
                <label>可以造成暴击伤害</label>
                <input type="checkbox" name="applyCritDamage" checked/>
            </div>

            <div class="form-group">
                <label>强制破架(击破架招)</label>
                <input type="checkbox" name="isBroken"/>
            </div>

            <div class="form-group">
                <label>无视格挡</label>
                <input type="checkbox" name="ignoreBlock"/>
            </div>

            <div class="form-group">
                <label>无视防御 (内/外)</label>
                <input type="checkbox" name="ignoreDefense"/>
            </div>

            <div class="form-group">
                <label>无视架招</label>
                <input type="checkbox" name="ignoreStance"/>
            </div>
        </div>
        `;

        return foundry.applications.api.DialogV2.prompt({
            window: { title: "手动应用伤害 (GM干预)", icon: "fas fa-wrench", width: 360 },
            content: content,
            ok: {
                label: "执行",
                icon: "fas fa-check",
                callback: (event, button) => {
                    const formData = new FormData(button.form);
                    return {
                        damageMod: parseInt(formData.get("damageMod")) || 0,
                        forceHit: formData.get("forceHit") === "on",
                        isCrit: formData.get("isCrit") === "on",
                        applyCritDamage: formData.get("applyCritDamage") === "on",
                        isBroken: formData.get("isBroken") === "on",
                        ignoreBlock: formData.get("ignoreBlock") === "on",
                        ignoreDefense: formData.get("ignoreDefense") === "on",
                        ignoreStance: formData.get("ignoreStance") === "on"
                    };
                }
            },
            rejectClose: false // 点击关闭或ESC返回 null
        });
    }

    /**
     * 执行属性判定 (Saving Throw)
     * 1. 读取 Actor 属性并投骰子
     * 2. 比对 DC
     * 3. 失败则自动创建 ActiveEffect
     */
    static async _rollSave(flags, message) {
        // 1. 获取防御者 (Flags 里存的是 targetUuid)
        const targetUuid = flags.targetUuid;
        const doc = await fromUuid(targetUuid);
        const actor = doc?.actor || doc;

        if (!actor) return ui.notifications.warn("目标已不存在。");

        // 权限检查：只有拥有者或GM可以点
        if (!actor.isOwner) return ui.notifications.warn("你没有权限操作此角色。");

        // 2. 调用 Actor 的检定方法
        // 这会弹出一个新的聊天卡片显示骰子结果
        // 读取 flags.level (发起请求时设定的优劣势)
        const roll = await actor.rollAttributeTest(flags.attribute, {
            level: flags.level || 0
        });

        // 3. 比对结果
        const total = roll.total;
        const dc = flags.dc || 10;
        const isSuccess = total >= dc;

        // 我们可以直接从 roll.data 里拿 (前提是 Actor 里传了)，或者重新读一遍
        // 这里最简单的方法是直接读取 roll.data.val，这是我们在 Actor.rollAttributeTest 里传入的
        const attrVal = roll.data.val || 0;
        const diceResult = roll.terms[0].total; // 骰子本身的结果

        // 4. 处理结果
        let resultHtml = "";
        let color = "";

        if (isSuccess) {
            color = "#27ae60"; // Green
            resultHtml = `
                <div style="color:${color}; font-weight:bold; font-size:1.2em;">
                    <i class="fas fa-check-circle"></i> ${game.i18n.localize("XJZL.UI.Chat.RequestSave.Success")}
                </div>
                <div style="font-size:0.8em; color:#666;">${game.i18n.localize("XJZL.UI.Chat.RequestSave.SuccessHint")}</div>
            `;
            // 如果有成功回调（比如发个聊天消息），以后可以扩展
        } else {
            color = "#c0392b"; // Red
            resultHtml = `
                <div style="color:${color}; font-weight:bold; font-size:1.2em;">
                    <i class="fas fa-times-circle"></i> ${game.i18n.localize("XJZL.UI.Chat.RequestSave.Failure")}
                </div>
                <div style="font-size:0.8em; color:#666;">${game.i18n.localize("XJZL.UI.Chat.RequestSave.FailureHint")}</div>
            `;

            // 应用惩罚 (Effects)
            // 脚本里传递过来的 onFail 对象，应该是一个标准的 ActiveEffect Data 对象 (或数组)
            if (flags.onFail) {
                // 标准化为数组
                const effectsData = Array.isArray(flags.onFail) ? flags.onFail : [flags.onFail];

                // 确保 origin 指向该消息，方便回溯
                const finalEffects = effectsData.map(e => ({
                    ...e,
                    origin: message.uuid,
                    disabled: false
                }));

                await actor.createEmbeddedDocuments("ActiveEffect", finalEffects);

                // 在卡片上追加一行小字
                const appliedLabel = game.i18n.localize("XJZL.UI.Chat.RequestSave.EffectApplied");
                resultHtml += `<div style="font-size:0.8em; margin-top:5px; padding:2px; background:rgba(0,0,0,0.05); border-radius:4px;">
                    ${appliedLabel}: <b>${finalEffects.map(e => e.name).join(", ")}</b>
                </div>`;
            }
        }

        // 5. 更新卡片 (禁用按钮，显示结果)
        // 构造替换 HTML
        const resultBlock = `
            <div style="text-align:center; padding:8px; background:#fff; border:1px solid ${color}; border-radius:4px; margin-top:5px;">
                <div style="font-size:0.9em; color:#555; margin-bottom:4px;">
                    1d20(${diceResult}) + ${attrVal} = <span style="font-size:1.5em; font-weight:bold;">${total}</span> vs DC ${dc}
                </div>
                ${resultHtml}
            </div>
        `;

        // 替换原来放置按钮的 .card-buttons 区域
        // 1. 创建临时 DOM 容器
        const div = document.createElement("div");
        div.innerHTML = message.content;

        // 2. 精准查找按钮容器
        const btnContainer = div.querySelector(".card-buttons");

        // 3. 替换内容
        if (btnContainer) {
            btnContainer.outerHTML = resultBlock;
            // 4. 更新消息
            await message.update({ content: div.innerHTML });
        } else {
            console.error("XJZL | 无法在卡片中找到 .card-buttons 容器");
        }
    }

    /**
     * 应用治疗 / Buff
     * 同时也负责触发 HIT 脚本 (用于添加 ActiveEffect)
     */
    static async _applyHeal(attacker, item, flags, targets, message) {
        // 1. 准备数据
        // 从 flags 中读取“面板数值”。对于 Buff 招式，这里可能是 0。
        const baseAmount = flags.damage || 0;
        const move = item.system.moves.find(m => m.id === flags.moveId);

        // 2. 循环处理目标
        const summaryData = [];

        for (const target of targets) {
            const targetActor = target.actor || target;
            if (!targetActor) continue;

            const displayName = target.name || targetActor.name;
            let finalRealHeal = 0; // 实际回血量
            let isHealAction = false;

            // A. 执行治疗 (仅当数值 > 0 时)
            if (baseAmount > 0) {
                isHealAction = true;
                // 默认治疗类型为 HP，除非我们未来扩展，其他暂时用脚本来处理
                // 调用 Actor 的 applyHealing (会处理飘字和数据库更新)
                const result = await targetActor.applyHealing({
                    amount: baseAmount,
                    type: "hp", // 默认回血
                    showScrolling: true
                });

                // 获取实际加了多少
                finalRealHeal = result.actualHeal;
            }

            // B. 记录结果
            summaryData.push({
                name: displayName,
                amount: finalRealHeal, // 显示实际值
                baseAmount: baseAmount, // (可选) 保留原始值备查
                isHeal: isHealAction,
                isBlocked: (isHealAction && finalRealHeal === 0) // 标记是否被完全阻挡(禁疗)
            });

            // C. 构造高兼容性的上下文 (Safe Context)
            // 补全了标准战斗参数，防止通用脚本报错
            const hitContext = {
                // 1. 核心身份
                target: targetActor,
                attacker: attacker,
                item: item,
                move: move,

                // 2. 行为标识
                type: "heal",         // 明确告知脚本这是治疗
                isHeal: true,         // 便捷布尔值
                isAttack: false,      // 明确不是攻击

                // 3. 战斗状态 (Polyfill)
                // 治疗/Buff 视为“必中”、“无暴击”、“无破防”
                // 这样脚本如果写了 if (args.isHit) 也能正常工作
                isHit: true,
                isCrit: false,
                isBroken: false,
                ignoreBlock: false,    // 治疗无视格挡
                ignoreDefense: false,  // 治疗无视防御

                // 4. 数值结果
                // 提供多套语义，方便脚本取用
                baseAmount: baseAmount,     // 原始面板
                finalAmount: finalRealHeal, // 传给脚本的是实际生效值
                healAmount: finalRealHeal,   // 语义化名称

                // 兼容性字段：攻击脚本通常找 hpLost，这里显式给 0，防止 undefined
                hpLost: 0,
                hutiLost: 0,
                mpLost: 0,

                // 5. 额外标记
                isBuffOnly: (baseAmount === 0)
            };

            //  D.无论有没有数值，都执行 HIT 脚本
            await attacker.runScripts(SCRIPT_TRIGGERS.HIT, hitContext, move);
        }

        // 3. 全局脚本 (HIT_ONCE)
        // 比如：群奶后，自己获得 1 点怒气 (不管奶了多少人)
        // 同样补全结构
        const globalContext = {
            targets: summaryData,
            hitCount: targets.length, // 治疗视为全部命中

            attacker: attacker,
            item: item,
            move: move,

            type: "heal",
            isHeal: true,
            totalHealAmount: summaryData.reduce((acc, cur) => acc + cur.amount, 0) // 方便统计总奶量
        };
        await attacker.runScripts(SCRIPT_TRIGGERS.HIT_ONCE, globalContext, move);
        // =====================================================
        // 4. 发送汇总卡片
        // =====================================================
        let listHtml = "";
        for (const entry of summaryData) {
            let valStr = "";

            if (entry.isHeal) {
                if (entry.amount > 0) {
                    valStr = `<span style="color:green; font-weight:bold;">+${entry.amount} HP</span>`;
                } else {
                    // 如果是治疗操作，但实际回血0，显示无效/禁疗/满血
                    valStr = `<span style="color:#888;">无效 (0)</span>`;
                }
            } else {
                valStr = `<span style="color:#666;">效果已应用</span>`;
            }

            listHtml += `
            <li style="display:flex; justify-content:space-between; border-bottom:1px dashed #eee; padding:3px 0;">
                <span>${entry.name}</span>
                ${valStr}
            </li>`;
        }

        const flavorText = (baseAmount > 0) ? "治疗结算" : "BUFF结算";

        ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: attacker }),
            flavor: flavorText,
            content: `
            <div class="xjzl-chat-card">
                <div class="card-content-wrapper">
                    <div class="card-header" style="border-bottom:1px solid #ccc; margin-bottom:5px; padding-bottom:3px;">
                        <h3 style="margin:0;">${move?.name || "未知招式"}</h3>
                    </div>
                    <ul style="list-style:none; padding:0; margin:0; font-size:0.9em;">
                        ${listHtml}
                    </ul>
                </div>
            </div>`
        });

        // 5. 更新原始卡片按钮 (防止重复点击)
        // 获取包含按钮的 DOM
        const div = document.createElement("div");
        div.innerHTML = message.content;
        const btn = div.querySelector('button[data-action="applyHeal"]');

        if (btn) {
            btn.disabled = true;
            btn.style.backgroundColor = "#78909c"; // 变灰
            btn.style.cursor = "not-allowed";
            btn.innerHTML = `<i class="fas fa-check"></i> ${game.i18n.localize("XJZL.UI.Chat.MoveCard.TargetSelected") || "已应用"}`;

            // 更新回消息中
            await message.update({ content: div.innerHTML });
        }
    }

    /**
     * 死检 (Death Save)
     * d20 > 10: 活 (回1血1内，去状态)
     * d20 <= 10: 死 (播报)
     */
    static async _rollDeathSave(actor) {
        // 1. 投掷
        const roll = await new Roll("1d20").evaluate();

        // 2. 展示骰子
        const total = roll.total;
        const isSuccess = total > 10;

        // 3. 构建结果内容
        let flavor = isSuccess ? "回光返照！" : "回天乏术...";
        let color = isSuccess ? "green" : "black";
        let desc = isSuccess
            ? "心脉护住了一口气，脱离死亡状态。"
            : "彻底气绝身亡。";

        // 4. 发送结果消息
        // roll.toMessage 会自动处理 rolls 数组和 3D 骰子
        await roll.toMessage({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            flavor: flavor,
            content: `
            <div class="xjzl-chat-card">
                <div style="font-size:1.5em; text-align:center; font-weight:bold; color:${color}; margin-bottom:5px;">
                    ${total}
                </div>
                <div style="text-align:center; color:#555;">${desc}</div>
            </div>`
        });

        // 5. 自动化处理 (仅成功时)
        if (isSuccess) {
            // A. 回复资源 (调用 Actor 接口，不仅改数据还飘字)
            await actor.applyHealing({ amount: 1, type: "hp" });
            await actor.applyHealing({ amount: 1, type: "mp" }); // 假设 mp 也是 1

            // B. 移除死亡状态
            // 注意：toggleStatusEffect 切换状态，如果当前有，toggle 会移除
            await actor.toggleStatusEffect("dead", { active: false });

            // 这里暂不移除 dying，只移除 dead，让玩家处于濒死(HP=1)状态比较合理
        }
    }

    /**
     * 动作: 撤回出招消耗 (Refund Cost)
     * 针对误操作，返还 MP/HP/Rage
     */
    static async _onRefundCost(message) {
        const flags = message.flags["xjzl-system"] || {};

        // 1. 检查是否已撤回
        if (flags.isCostRefunded) {
            return ui.notifications.warn("该次出招的消耗已撤回。");
        }

        // 2. 获取消耗数据
        const cost = flags.costConsumed;
        if (!cost) return ui.notifications.warn("无法读取消耗数据，记录已丢失。");

        // 3. 获取 Actor
        const speaker = message.speaker;
        let actor = null;
        if (speaker.token) actor = game.actors.tokens[speaker.token];
        if (!actor) actor = game.actors.get(speaker.actor);

        if (!actor) return ui.notifications.error("找不到该角色，无法返还资源。");

        // 4. 确认弹窗 (防止误触)
        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: "撤回消耗", icon: "fas fa-undo" },
            content: `<p>确定要返还出招消耗吗？</p>
                      <ul style="color:#555;">
                        ${cost.mp ? `<li>内力: +${cost.mp}</li>` : ""}
                        ${cost.rage ? `<li>怒气: +${cost.rage}</li>` : ""}
                        ${cost.hp ? `<li>气血: +${cost.hp}</li>` : ""}
                      </ul>`,
            ok: { label: "返还" }
        });
        if (!confirm) return;

        // 5. 执行返还
        const updates = {};
        const res = actor.system.resources;

        if (cost.mp) {
            // 简单相加，允许溢出（防止因为濒死一击导致上限判断问题），会被 Actor 的 _preUpdate 截断
            // 濒死一击的消耗可能很大，直接加回去即可
            updates["system.resources.mp.value"] = res.mp.value + cost.mp;
        }
        if (cost.rage) {
            updates["system.resources.rage.value"] = res.rage.value + cost.rage;
        }
        if (cost.hp) {
            updates["system.resources.hp.value"] = res.hp.value + cost.hp;
        }

        // 提交更新
        if (!foundry.utils.isEmpty(updates)) {
            await actor.update(updates);
            ui.notifications.info(`${actor.name} 的出招消耗已返还（特殊的buff与执行的脚本无法回退）。`);
        }

        // ==========================================================
        // 特殊处理：如果是架招，撤回消耗通常意味着也要关闭架招状态
        // ==========================================================
        if (flags.moveType === "stance") {
            // 检查当前架招是否正是这个物品
            if (actor.system.martial.stanceActive && actor.system.martial.stanceItemId === flags.itemId) {
                await actor.stopStance(); // 调用 Actor 里现成的停止架招方法
                ui.notifications.info("关联的架招状态已自动解除。");
            }
        }

        // 6. 更新 UI (禁用按钮)
        const div = document.createElement("div");
        div.innerHTML = message.content;
        const btn = div.querySelector('button[data-action="refundCost"]');

        if (btn) {
            // 替换为提示文本
            const replacement = document.createElement("div");
            replacement.style.cssText = "text-align:center; color:#888; font-size:0.85em; margin-top:5px; padding:4px; background:#f3f3f3; border-radius:4px;";
            replacement.innerHTML = '<i class="fas fa-check"></i> 消耗已返还';

            btn.parentNode.replaceWith(replacement);

            await message.update({
                content: div.innerHTML,
                "flags.xjzl-system.isCostRefunded": true
            });
        }
    }
}