/**
 * 聊天卡片交互管理器
 * 职责：监听聊天消息渲染，处理按钮点击，执行战斗结算流程
 */
import { SCRIPT_TRIGGERS } from "../data/common.mjs";
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

        // 0. 特殊处理：撤销伤害不需要选中任何目标，也不需要攻击者（只需要数据回滚）
        if (action === "undoDamage") {
            await ChatCardManager._undoDamage(message);
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
        if (flags.itemId && attacker) item = attacker.items.get(flags.itemId);

        // 3. 获取目标
        // 逻辑：如果历史有记录，强制使用历史记录
        // 只有当历史记录为空时 (说明 Roll 的时候没选目标)，才允许使用当前选中的目标
        let targets = [];
        const historyUuids = flags.targets || [];

        // 防御请求(rollDefendFeint)不需要目标
        if (action === "rollDefendFeint") {
            await ChatCardManager._onDefendFeint(attacker, flags, message);
            return;
        }

        if (historyUuids.length > 0) {
            // A. 如果 Roll 阶段记录了目标，强制使用历史目标
            // 使用 fromUuidSync 同步获取 (因为在同一场景下通常都在内存里)
            targets = historyUuids.map(uuid => fromUuidSync(uuid)).filter(a => a);
            if (targets.length === 0) return ui.notifications.warn("历史目标已不存在 (可能被删除)。");
        } else {
            // B. 如果 Roll 阶段没目标，使用当前选中
            // 这里不能取t.actor，因为我们之前传递的是token的uuid
            // game.user.targets 是 Token(Placeable)，它的 .document 是 TokenDocument
            targets = Array.from(game.user.targets).map(t => t.document).filter(t => t);
            if (targets.length === 0 && action !== "rollDefendFeint") {
                return ui.notifications.warn("请先在场景中选中目标。");
            }
        }

        // === 分发逻辑 ===
        switch (action) {
            case "applyDamage":
                if (!item) return ui.notifications.warn("源物品数据已丢失。");
                await ChatCardManager._applyDamage(attacker, item, flags, targets, message);
                break;

            case "rollFeintContest":
                // 这是攻击者点的
                if (!item) return ui.notifications.warn("源物品数据已丢失。");
                await ChatCardManager._rollFeintContest(attacker, item, flags, targets, message);
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

        const needsCheck = isValidDamage && !isCounter;

        // 如果不需要检定 (如气招/反击)，直接返回全命中
        if (!needsCheck) {
            const results = {};
            targets.forEach(t => results[t.uuid] = { isHit: true, total: 0 });
            return results;
        }

        // 提前计算公共加值 (修复 ReferenceError 的关键)
        const hitMod = (damageType === "waigong" ? attacker.system.combat.hitWaigongTotal : attacker.system.combat.hitNeigongTotal);
        const manualBonus = flags.attackBonus || 0;

        // 恢复骰子数据
        if (!flags.rollJSON) return null;
        const baseRoll = Roll.fromData(flags.rollJSON);

        // D1: 第一个骰子 (永远存在)
        const d1 = baseRoll.terms[0].results[0].result;

        // D2: 获取第二个骰子 (可能来自 2d20，也可能来自之前的补骰)
        let d2 = null;
        let isNativeDouble = false; // 标记：是否本来就是双骰
        if (baseRoll.terms[0].results.length > 1) {
            // 情况 A: 初始 Roll 就是 2d20
            d2 = baseRoll.terms[0].results[1].result;
            isNativeDouble = true;
        } else if (flags.supplementalDie !== undefined && flags.supplementalDie !== null) {
            // 情况 B: 初始 Roll 是 1d20，但 flag 里有补骰记录
            d2 = flags.supplementalDie;
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

        for (const target of targets) {
            const uuid = target.uuid;
            const targetActor = target.actor || target;
            if (!targetActor) continue;

            // A. 如果有缓存结果，直接跳过计算 (但在最终结算时直接用)
            if (flags.targetsResultMap?.[uuid]) continue;

            // 只要进入这里，说明有新目标
            hasNewTargets = true;
            // B. 现场计算优劣势 (跑 CHECK 脚本)
            // const checkContext = { target: targetActor, flags: { grantAdvantage: false, grantDisadvantage: false } };
            const checkContext = {
                target: targetActor,
                flags: {
                    grantLevel: 0
                }
            }; //换成优劣势计数
            const move = item.system.moves.find(m => m.id === flags.moveId);
            await attacker.runScripts(SCRIPT_TRIGGERS.CHECK, checkContext, move);


            // 1. 目标给予 (当前时刻)
            const targetStatusGrant = targetActor.xjzlStatuses?.grantAttackLevel || 0;

            // 2. 脚本临时修正
            const scriptGrant = checkContext.flags.grantLevel || 0;

            // 汇总
            const totalLevel = selfLevel + targetStatusGrant + scriptGrant;
            let finalState = 0;
            if (totalLevel > 0) finalState = 1;
            else if (totalLevel < 0) finalState = -1;

            targetStates.set(uuid, finalState);

            // 关键判断：如果状态不平，且没有 D2，则需要补骰
            if (finalState !== 0 && d2 === null) {
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
                // 如果是旧缓存，跳过显示（因为已经在之前的卡片里显示过了）
                // 这里我们只显示本次新计算的目标
                if (flags.targetsResultMap?.[uuid]) continue;

                const tActor = target.actor || target;
                if (!tActor) continue;

                const displayName = target.name || tActor.name;

                // 复用计算逻辑 (局部)
                const state = targetStates.get(uuid) ?? 0;
                let finalDie = d1;
                let stateLabel = "平";

                if (state === 1) { finalDie = Math.max(d1, d2); stateLabel = "优"; }
                else if (state === -1) { finalDie = Math.min(d1, d2); stateLabel = "劣"; }

                const total = finalDie + hitMod + manualBonus;
                const dodge = tActor.system.combat.dodgeTotal || 10;

                // 判定命中 (含20必中/1必失)
                let isHit = false;
                if (finalDie === 20) isHit = true;
                else if (finalDie === 1) isHit = false;
                else isHit = total >= dodge;

                const color = isHit ? "green" : "red";
                const label = isHit ? "命中" : "未中";

                resultListHtml += `
                    <li style="display:flex; justify-content:space-between; font-size:0.9em; border-bottom:1px dashed #eee;">
                        <span>${displayName}</span>
                        <span>
                            <span style="color:#666;">[${stateLabel}]</span> 
                            ${total} vs ${dodge} 
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
                        <div style="font-size:1.1em; text-align:center; padding:5px; border-bottom:1px solid #ccc;">
                            ${headerHtml}
                        </div>
                        <ul style="list-style:none; padding:5px; margin:0;">
                            ${resultListHtml}
                        </ul>
                    </div>`
                });
            }
        }

        // =====================================================
        // 4. 计算最终结果 (Final Resolution)
        // =====================================================
        const results = {};

        for (const target of targets) {
            const uuid = target.uuid;
            const targetActor = target.actor || target;
            if (!targetActor) continue;

            // A. 缓存优先 (如果是 ApplyDamage 二次调用，且不需要补骰，可能走缓存)
            // 但如果刚补了骰子，这里的缓存可能还是旧的，所以要注意 flags 更新时机
            // 通常建议如果 d2 存在，总是重新计算最稳妥
            const cached = flags.targetsResultMap?.[uuid];
            if (cached && !needsSupplemental) {
                results[uuid] = cached;
                continue;
            }

            // B. 确定最终使用的骰子 (Final Die)
            const state = targetStates.get(uuid) ?? 0;
            let finalDie = d1;

            // 此时 d2 一定就位 (除非 state=0 或者用户取消了)
            if (state === 1 && d2 !== null) finalDie = Math.max(d1, d2);
            else if (state === -1 && d2 !== null) finalDie = Math.min(d1, d2);

            // C. 计算数值
            const total = finalDie + hitMod + manualBonus;
            const dodge = targetActor.system.combat.dodgeTotal || 10;

            // D. 判定命中
            let isHit = false;
            // 规则：20必中，1必失
            if (finalDie === 20) {
                isHit = true;
            } else if (finalDie === 1) {
                isHit = false;
            } else {
                isHit = total >= dodge;
            }

            results[uuid] = {
                isHit: isHit,
                total: total,
                dieUsed: finalDie // 这里的 Key 改为 dieUsed 比较明确，之前的代码混用了 die 和 dieUsed
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
                skippedLog.push({ name: displayName , reason: "已闪避" });  //改为在卡片里提醒
                continue;
            }

            // C. 架招检查
            if (!targetActor.system.martial.stanceActive) {
                // ui.notifications.info(`${target.name} 未开启架招。`);
                skippedLog.push({ name: displayName , reason: "未开启架招。" });
                continue;
            }

            // 存入待处理列表
            validTargetsToRequest.push({
                uuid: uuid,
                actor: targetActor,
                target: target, // 保留原始target对象以获取纹理
                displayName: displayName 
            });
        }

        // 准备更新到 message 的数据对象
        const updateData = {};
        let newlyRequested = [];

        if (validTargetsToRequest.length > 0) {

            // 2. 准备攻方虚招结果 (Check Attacker Roll)
            // 逻辑：一次出招，对所有人的虚招值是一样的
            let attackerFeintRoll = flags.feintRollTotal;

            if (attackerFeintRoll === undefined) { // 第一次点，还没投过
                const r = await new Roll("1d20").evaluate();
                attackerFeintRoll = r.total;

                if (game.dice3d) game.dice3d.showForRoll(r, game.user, true);

                // 记录需要更新的骰子结果
                updateData["flags.xjzl-system.feintRollTotal"] = attackerFeintRoll;
            }
            const attackTotal = attackerFeintRoll + feintVal;

            // 3. 遍历有效目标发送请求
            for (const tData of validTargetsToRequest) {
                const { uuid, actor: targetActor, target, displayName } = tData;

                // 获取头像
                const imgPath = target.texture?.src || targetActor.img;

                // D. 渲染并发送防御请求卡
                const templateData = {
                    attackerName: attacker.name,
                    targetName: displayName,
                    targetImg: imgPath,
                    rollTotal: attackerFeintRoll,
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
     * 动作: 响应虚招防御 (Defend)
     */
    static async _onDefendFeint(defender, flags, message) {
        // 1. 获取文档对象 (可能是 TokenDocument，也可能是 Actor)
        const targetDoc = await fromUuid(flags.targetUuid);
        if (!targetDoc) {
            ui.notifications.warn("目标已不存在。");
            return;
        }
        // 如果是 TokenDocument，它没有 system，必须取 .actor
        // 如果 targetDoc 本身就是 Actor (很少见，但为了健壮性)，直接用它
        const targetActor = targetDoc.actor || targetDoc;

        // 再次检查 actor 是否存在
        if (!targetActor || !targetActor.system) {
            ui.notifications.error("无法获取目标角色的数据。");
            return;
        }

        const displayName = targetDoc.name || targetActor.name;

        // --- 防重复检查 ---
        const originMsg = game.messages.get(flags.originMessageId);
        if (originMsg) {
            const currentResults = originMsg.flags["xjzl-system"]?.feintResults || {};
            // 如果该目标的 UUID 已经在结果列表中，说明已经点过了
            if (currentResults[flags.targetUuid]) {
                // 为了视觉同步，顺便把按钮废掉
                await message.update({
                    content: message.content.replace(
                        /data-action="rollDefendFeint"/,
                        'disabled style="background:#555; color:#999; cursor:not-allowed;"'
                    ).replace('进行看破检定', '已检定')
                });
                return ui.notifications.warn(`${displayName} 已经进行过对抗了。`);
            }
        } else {
            return ui.notifications.warn("原始攻击消息已丢失，无法记录对抗结果。");
        }

        // 2. 弹窗询问加值
        const kanpoBase = targetActor.system.combat.kanpoTotal || 0;

        const input = await foundry.applications.api.DialogV2.prompt({
            window: { title: `看破检定: ${displayName}`, icon: "fas fa-eye" },
            content: `
            <div style="text-align:center; padding:10px;">
                <p>敌方虚招强度: <b style="color:red;">${flags.attackTotal}</b></p>
                <p>你的看破值: <b>${kanpoBase}</b></p>
                <label>额外加值</label>
                <input type="number" name="bonus" value="0" style="text-align:center; width:100%;"/>
            </div>
          `,
            ok: {
                label: "投掷",
                callback: (event, button) => button.closest(".window-content").querySelector("input").value
            },
            rejectClose: false // 设为 false，这样关闭窗口时返回 null 而不是报错
        });

        if (input === null) return; // 取消
        const bonus = parseInt(input) || 0;

        // 2. 投掷
        const roll = await new Roll("1d20 + @kanpo + @bonus", { kanpo: kanpoBase, bonus: bonus }).evaluate();
        if (game.dice3d) game.dice3d.showForRoll(roll, game.user, true);

        const defTotal = roll.total;
        const atkTotal = flags.attackTotal;

        // 3. 判定胜负
        // 攻击方 >= 防御方 则破防。反之防御方 > 攻击方 则守住。
        // 所以 broken = atkTotal >= defTotal
        const isBroken = atkTotal >= defTotal;

        // === 执行状态变更 ===
        if (isBroken) {
            // A. 关闭架招状态
            // 只要这里改为 false，你的 Actor 数据类里的格挡计算逻辑就会自动把 stanceBlockValue 去掉
            await targetActor.update({ "system.martial.stanceActive": false });

            // B. (TODO) 先手动创建一个ae，到时候我们创建通用的破防ae
            // 添加“破防” Debuff
            // 这里我们动态创建一个 ActiveEffect
            // 破防效果通常是：无法再次开启架招、或者受到的伤害增加
            const breakEffectData = {
                name: "破防",
                icon: "icons/svg/downgrade.svg", // 或者找一个破盾的图标
                origin: message.uuid, // 记录来源
                duration: { rounds: 1 }, // 持续 1 回合
                statuses: ["brokenDefense"], // 方便系统识别
                description: "架招被虚招击破，处于破防状态。",
                // 如果你想让破防禁止被动格挡，可以加上这个 change:
                // changes: [{ key: "system.combat.block", mode: 2, value: 0 }] 
            };

            await targetActor.createEmbeddedDocuments("ActiveEffect", [breakEffectData]);

            // 飘字提示
            if (targetActor.token?.object) {
                canvas.interface.createScrollingText(targetActor.token.object.center, "被击破架招！", {
                    fill: "#ff0000", stroke: "#000000", strokeThickness: 4, jitter: 0.25
                });
            }
        } else {
            // 守住了
            if (targetActor.token?.object) {
                canvas.interface.createScrollingText(targetActor.token.object.center, "看破！", {
                    fill: "#00ff00", stroke: "#000000", strokeThickness: 4, jitter: 0.25
                });
            }
        }

        // 4. 显示结果
        ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: targetActor }),
            flavor: "看破检定结果",
            content: `
            <div class="xjzl-chat-card">
                <div>1d20(${roll.total - kanpoBase - bonus}) + 看破(${kanpoBase}) + 修正(${bonus}) = <b>${defTotal}</b></div>
                <hr>
                <div style="font-size:1.2em; font-weight:bold; color:${!isBroken ? 'green' : 'red'};">
                    ${!isBroken ? "看破！(架招维持)" : "被破防！(架招将在伤害阶段移除)"}
                </div>
            </div>
          `
        });

        // 5. 回写状态到原始攻击卡片
        // 让应用伤害的时候可以知道这次是否击破架招，是否要触发击破架招的特效
        const feintResults = originMsg.flags["xjzl-system"]?.feintResults || {};
        feintResults[flags.targetUuid] = isBroken ? "broken" : "resisted";

        await originMsg.update({
            "flags.xjzl-system.feintResults": feintResults
        });

        // 更新当前的请求卡片，禁用按钮
        // 这样玩家就知道自己已经点过了，无需再点
        await message.update({
            content: message.content.replace(
                /data-action="rollDefendFeint"/,
                'disabled style="background:#555; color:#999; cursor:not-allowed;"'
            ).replace('进行看破检定', '已检定')
        });
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
        const feintResults = message.flags["xjzl-system"]?.feintResults || {};
        const isFeintMove = move?.type === "feint";
        let missingDefense = false;

        if (isFeintMove) {
            for (const target of targets) {
                const targetActor = target.actor || target; // 兼容 Token/Actor
                // 必须用 target.uuid (Token UUID) 来查表
                const hasResult = feintResults[target.uuid];
                const stanceActive = targetActor.system?.martial?.stanceActive;
                const res = hitResults[target.uuid];
                // 如果没命中，不需要对抗，自然也不算漏网
                if (!res || !res.isHit) continue;

                // 如果开了架招，且没有对抗结果，视为“漏网”
                if (stanceActive && !hasResult) {
                    missingDefense = true;
                    console.log(`漏网：${target.name}`);
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
            const feintStatus = feintResults[uuid];
            const isBroken = (feintStatus === "broken");

            // C. 调用 Actor 伤害处理
            const damageResult = await targetActor.applyDamage({
                amount: flags.damage,      // 面板伤害
                type: flags.damageType,    // 伤害类型
                attacker: attacker,        // 攻击者
                isHit: isHit,              // 命中状态
                isCrit: isCrit,            // 暴击状态 (用于触发特效)
                applyCritDamage: flags.canCrit, // 配置: 是否应用暴击伤害倍率 (用于计算数值)
                isBroken: isBroken,        // 破防状态
                ignoreBlock: false,        //无视格挡，先预留
                ignoreDefense: false       //无视内外功防御，先预留
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

        // C. 移除状态
        if (undoData.gainedDead) {
            await actor.toggleStatusEffect("dead", { active: false });
        }
        // 濒死状态回退暂留空

        // 4. 更新卡片状态
        const content = message.content.replace(
            /<button data-action="undoDamage".*?<\/button>/,
            `<div style="text-align:center; color:#888; border:1px solid #ccc; padding:5px; background:#eee;">已撤销</div>`
        );

        await message.update({
            content: content,
            "flags.xjzl-system.isUndone": true
        });

        ui.notifications.info("目标状态已回滚。但攻击者获得的怒气与触发的特效需要手动调整。");
    }

}