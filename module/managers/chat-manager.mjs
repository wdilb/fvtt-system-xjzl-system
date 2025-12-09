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
        const damageType = flags.damageType || "waigong";
        // 只有内/外功需要检定
        const needsCheck = ["waigong", "neigong"].includes(damageType);

        // 不需要检定，直接返回命中
        if (!needsCheck) {
            const results = {};
            targets.forEach(t => results[t.uuid] = { isHit: true, total: 0 });
            return results;
        }

        // 1. 恢复基准骰子 (D1)
        if (!flags.rollJSON) return null;
        const baseRoll = Roll.fromData(flags.rollJSON);
        // D1: 第一个骰子 (永远存在)
        const d1 = baseRoll.terms[0].results[0].result;

        // D2: 第二个骰子 (可能来自 2d20，也可能来自之前的补骰)
        let d2 = null;
        // 情况 A: 初始 Roll 就是 2d20 (自身有优劣势)
        if (baseRoll.terms[0].results.length > 1) {
            d2 = baseRoll.terms[0].results[1].result;
        }
        // 情况 B: 初始 Roll 是 1d20，检查是否有补骰记录
        else if (flags.supplementalDie !== undefined && flags.supplementalDie !== null) {
            d2 = flags.supplementalDie;
        }

        // 2. 预计算所有新目标的状态 (Pre-Calculate States)
        // 我们需要知道到底有没有人需要 D2，才能决定是否弹窗
        const targetStates = new Map();
        let needsSupplemental = false;

        // 读取攻击者自身计数 (从 Flags 恢复)
        const ctx = flags.contextFlags || {};
        const selfAdvCount = ctx.selfAdvCount || 0;
        const selfDisCount = ctx.selfDisCount || 0;

        for (const target of targets) {
            // 改为了TokenDocument 直接取 uuid
            const uuid = target.uuid;

            // 获取 Actor 对象，用于下面获取闪避属性
            // TokenDocument 包含 actor 属性。如果是直接传的 Actor，这行也能兼容 (Actor.actor 是 undefined，回退到 target 自身)
            const targetActor = target.actor || target;

            if (!targetActor) continue; // 安全检查
            // A. 缓存命中 (Cache Hit) -> 跳过计算
            if (flags.targetsResultMap?.[uuid]) continue;

            // B. 缓存未命中 -> 现场计算优劣势
            // 跑 CHECK 脚本
            //避免脚本里用 target.system会报错，所以这里也修改为将targetActor传递给脚本
            const checkContext = { target: targetActor, flags: { grantAdvantage: false, grantDisadvantage: false } };
            const move = item.system.moves.find(m => m.id === flags.moveId);
            await attacker.runScripts(SCRIPT_TRIGGERS.CHECK, checkContext, move);

            // 读取目标被动
            // 状态在 Actor 上，必须用 targetActor 读取
            const tStatus = targetActor.xjzlStatuses || {};
            const grantAdv = tStatus.grantAttackAdvantage || checkContext.flags.grantAdvantage;
            const grantDis = tStatus.grantAttackDisadvantage || checkContext.flags.grantDisadvantage;

            // 汇总计算
            const totalAdv = selfAdvCount + (grantAdv ? 1 : 0);
            const totalDis = selfDisCount + (grantDis ? 1 : 0);

            let finalState = 0;
            if (totalAdv > totalDis) finalState = 1;//优势
            else if (totalDis > totalAdv) finalState = -1;//劣势

            targetStates.set(uuid, finalState); // 记录对这个目标的优势、劣势的状态

            // 判断是否缺骰子
            if (finalState !== 0 && d2 === null) {
                needsSupplemental = true;
            }
        }

        // 3. 交互式补骰 (如果需要)
        if (needsSupplemental) {
            // 弹出 Dialog 询问玩家
            const confirm = await foundry.applications.api.DialogV2.confirm({
                window: { title: "补投检定", icon: "fas fa-dice-d20" },
                content: `<p>部分目标的当前状态导致攻击具有 <b>优势</b> 或 <b>劣势</b>。</p>
                        <p>需要补投一个 <b>d20</b> 来进行最终裁定。</p>`,
                ok: { label: "投掷" },
                rejectClose: false
            });

            if (!confirm) return null; // 玩家取消，中断流程

            // 投掷
            const r = await new Roll("1d20").evaluate();
            d2 = r.total;
            //3D骰子
            if (game.dice3d) game.dice3d.showForRoll(r, game.user, true);

            // 异步更新消息 (不阻塞后续流程)
            // 这样下次再点的时候，d2 就已经存在于 flags 里了
            await message.update({ "flags.xjzl-system.supplementalDie": d2 });

        }

        // 4. 计算最终结果
        const results = {};
        const hitMod = (damageType === "waigong" ? attacker.system.combat.hitWaigongTotal : attacker.system.combat.hitNeigongTotal);
        const manualBonus = flags.attackBonus || 0; // 手动加值

        for (const target of targets) {
            const uuid = target.uuid;
            const targetActor = target.actor || target;
            if (!targetActor) continue;

            // A. 缓存优先
            const cached = flags.targetsResultMap?.[uuid];
            if (cached) {
                results[uuid] = cached;
                continue;
            }

            // B. 使用刚才算好的状态
            const state = targetStates.get(uuid) ?? 0;
            let finalDie = d1;

            // 此时 d2 一定就位 (除非 state=0 或者用户取消了)
            if (state === 1 && d2 !== null) finalDie = Math.max(d1, d2);
            else if (state === -1 && d2 !== null) finalDie = Math.min(d1, d2);

            const total = finalDie + hitMod + manualBonus;
            // 使用 targetActor 获取属性
            const dodge = targetActor.system.combat.dodgeTotal || 10;

            results[uuid] = {
                isHit: total >= dodge,
                total: total
            };
        }

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
        // 1. 命中复核 (包含潜在的补骰交互)
        // 这会返回一个 Map: { uuid: { isHit: true/false, ... } }
        const hitResults = await this._resolveHitRoll(attacker, item, flags, targets, message);

        // 如果返回 null，说明在补骰阶段玩家点击了取消，中断流程
        if (!hitResults) return;

        const feintVal = flags.feint || 0;

        // 2. 准备攻方虚招结果 (Check Attacker Roll)
        // 逻辑：一次出招，对所有人的虚招值是一样的
        let attackerFeintRoll = flags.feintRollTotal;

        if (attackerFeintRoll === undefined) { // 第一次点，还没投过
            const r = await new Roll("1d20").evaluate();
            attackerFeintRoll = r.total;

            if (game.dice3d) game.dice3d.showForRoll(r, game.user, true);

            // 存入数据库，下次点就能读到了
            await message.update({ "flags.xjzl-system.feintRollTotal": attackerFeintRoll });
        }
        const attackTotal = attackerFeintRoll + feintVal;

        // 3. 读取“已发送请求名单” (防刷逻辑)
        // 如果 flags 里没有这个数组，初始化为空数组
        const alreadyRequested = flags.feintRequestSent || [];
        const newlyRequested = []; // 本次新发送的目标
        const skippedLog = []; // 用于记录无需对抗的目标及其原因

        // 4. 遍历目标
        for (const target of targets) {
            const uuid = target.uuid;

            // 获取 Actor (TokenDocument 不包含 system 数据，必须取 actor)
            const targetActor = target.actor || target;
            if (!targetActor) continue;

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
                skippedLog.push({ name: targetActor.name, reason: "已闪避" });  //改为在卡片里提醒
                continue;
            }

            // C. 架招检查
            if (!targetActor.system.martial.stanceActive) {
                // ui.notifications.info(`${target.name} 未开启架招。`);
                skippedLog.push({ name: targetActor.name, reason: "未开启架招。" });
                continue;
            }
            // 获取头像
            const imgPath = target.texture?.src || targetActor.img;

            // D. 渲染并发送防御请求卡
            const templateData = {
                attackerName: attacker.name,
                targetName: targetActor.name,
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
                speaker: ChatMessage.getSpeaker({ actor: targetActor }), // 使用 Actor
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

            // ui.notifications.info(`已向 ${target.name} 发送对抗请求。`);

            // 记录到本次新增名单里
            newlyRequested.push(uuid);
        }

        // 5. 更新“已发送名单”到数据库
        if (newlyRequested.length > 0) {
            // 合并旧名单和新名单
            const updatedList = [...alreadyRequested, ...newlyRequested];
            await message.update({ "flags.xjzl-system.feintRequestSent": updatedList });
        }
        // 发送“忽略名单”汇总卡片 (公开消息)
        if (skippedLog.length > 0) {
            // 这里我们也做一个简单的 HBS 风格的 HTML，保持一致性
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
                speaker: { alias: "战斗提示" }, // 使用别名，而不是具体的 Token
                content: summaryHtml
                // 删除了 whisper 属性，现在所有人可见
            });
        }
        if (newlyRequested.length === 0 && skippedLog.length === 0) {
            ui.notifications.warn("没有有效的目标进行对抗。");
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

        // 2. 弹窗询问加值
        const kanpoBase = targetActor.system.combat.kanpoTotal || 0;

        const input = await foundry.applications.api.DialogV2.prompt({
            window: { title: `看破检定: ${targetActor.name}`, icon: "fas fa-eye" },
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
            rejectClose: true
        });

        if (input === null) return; // 取消
        const bonus = parseInt(input) || 0;

        // 2. 投掷
        const roll = await new Roll("1d20 + @kanpo + @bonus", { kanpo: kanpoBase, bonus: bonus }).evaluate();
        if (game.dice3d) game.dice3d.showForRoll(roll, game.user, true);

        const defTotal = roll.total;
        const atkTotal = flags.attackTotal;

        // 3. 判定胜负
        const success = defTotal > atkTotal; // 守方胜 (看破 > 虚招)
        // 注意规则：攻击方 >= 防御方 则破防。反之防御方 > 攻击方 则守住。
        // 所以 broken = atkTotal >= defTotal
        const isBroken = atkTotal >= defTotal;

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
                    ${!isBroken ? "识破！(架招维持)" : "被破防！(状态将在伤害阶段移除)"}
                </div>
            </div>
          `
        });

        // 5. 回写状态到原始攻击卡片
        // 我们不在这里修改 Actor 状态，而是记在攻击卡上
        const originMsg = game.messages.get(flags.originMessageId);
        if (originMsg) {
            const feintResults = originMsg.flags["xjzl-system"]?.feintResults || {};
            // 更新该目标的对抗结果
            feintResults[targetActor.uuid] = isBroken ? "broken" : "resisted";

            await originMsg.update({
                "flags.xjzl-system.feintResults": feintResults
            });
            // ui.notifications.info("对抗结果已记录。请攻击者点击 [应用伤害] 结算。");
        }
    }

    /**
     * 动作 A: 应用伤害
     * 流程：命中检查 -> 格挡(Parry) -> 受伤脚本(Damaged) -> 扣血
     */
    static async _applyDamage(attacker, item, flags, targets, message) {
        // 1. 命中复核
        const hitResults = await this._resolveHitRoll(attacker, flags, targets, message);
        const damageAmount = flags.damage;
        const damageType = flags.damageType;

        for (const target of targets) {
            // A. 命中判定
            if (hitResults) {
                const res = hitResults[target.uuid];
                if (res && !res.isHit) {
                    ui.notifications.info(`${target.name} 闪避了攻击！`);
                    continue; // 跳过此目标
                }
            }

            let finalDamage = damageAmount;

            // B. 护甲减免 (Armor) - 仅对外功生效?
            // if (damageType === "waigong") finalDamage -= target.system.combat.armorValue || 0;

            // C. 格挡判定 (Parry)
            if (target.system.martial.stanceActive) {
                // 触发 PARRY 脚本 (防御者)
                const parryContext = { attacker, damage: finalDamage, type: damageType };
                await target.runScripts(SCRIPT_TRIGGERS.PARRY, parryContext);

                // 硬减免
                const blockVal = target.system.combat.blockTotal || 0;
                finalDamage -= blockVal;
                ui.notifications.info(`${target.name} 格挡了攻击 (减免 ${blockVal})`);
            }

            // 保底 0
            finalDamage = Math.max(0, finalDamage);

            // D. 受伤脚本 (DAMAGED) - 最终修正
            const damageContext = {
                attacker: attacker,
                type: damageType,
                output: {
                    damage: finalDamage,
                    abort: false
                },
                // 传递快照
                hp: target.system.resources.hp.value,
                huti: target.system.resources.huti.value || 0
            };

            await target.runScripts(SCRIPT_TRIGGERS.DAMAGED, damageContext);

            if (damageContext.output.abort) {
                ui.notifications.info(`${target.name} 免疫了此次伤害。`);
                continue;
            }

            finalDamage = Math.max(0, Math.floor(damageContext.output.damage));

            // E. 结算扣血
            if (finalDamage > 0) {
                const currentHP = target.system.resources.hp.value;
                await target.update({ "system.resources.hp.value": Math.max(0, currentHP - finalDamage) });

                // 飘字
                canvas.interface.createScrollingText(target.token?.object?.center || { x: 0, y: 0 }, `-${finalDamage}`, {
                    fill: "#ff0000", stroke: "#000000", strokeThickness: 4, jitter: 0.25
                });
            } else {
                ui.notifications.info(`${target.name} 未受到伤害。`);
            }

            // F. 应用特效 (On-Hit Effects)
            // 只有命中了才应用特效
            if (item) {
                const move = item.system.moves.find(m => m.id === flags.moveId);
                if (move && move.applyEffects.length > 0) {
                    // 复用之前的逻辑，或者直接在这里处理
                    // 为了代码简洁，这里简单实现：
                    for (const ref of move.applyEffects) {
                        if (ref.target !== "target") continue;
                        // 检查触发条件
                        // 比如 trigger="crit" 但没暴击，就跳过。这里暂略，默认 hit 都触发。

                        const template = item.effects.find(e => e.name === ref.key);
                        if (template) {
                            const effectData = template.toObject();
                            effectData.origin = item.uuid;
                            effectData.transfer = false;
                            await target.applyStackableEffect(effectData);
                        }
                    }
                }
            }
        }
    }

}