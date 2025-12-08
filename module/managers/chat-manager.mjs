/**
 * 聊天卡片交互管理器
 * 职责：监听聊天消息渲染，处理按钮点击，执行战斗结算流程
 */
import { SCRIPT_TRIGGERS } from "../data/common.mjs";

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
        if (flags.itemId && actor) item = actor.items.get(flags.itemId);

        // 3. 获取目标 (对于 Apply 类操作)
        // 这里的 targets 是当前选中的 Token
        const targets = Array.from(game.user.targets).map(t => t.actor).filter(a => a);

        // === 分发逻辑 ===
        switch (action) {
            case "applyDamage":
                if (!item) return ui.notifications.warn("源物品数据已丢失。");
                await ChatCardManager._applyDamage(actor, item, flags, targets, message);
                break;

            case "rollFeintContest":
                // 这是攻击者点的
                if (!item) return ui.notifications.warn("源物品数据已丢失。");
                await ChatCardManager._rollFeintContest(actor, item, flags, targets, message);
                break;

            case "rollDefendFeint":
                // 这是防御者点的 (在新生成的防御请求卡上)
                // 这里的 flags 是防御卡的 flags，包含 originMessageId, attackTotal 等
                await ChatCardManager._onDefendFeint(actor, flags, message);
                break;
        }
    }

    /* -------------------------------------------- */
    /*  核心结算逻辑 (Resolution Logic)             */
    /* -------------------------------------------- */

    /**
   * 辅助：解析命中结果 (含 CHECK 脚本和补骰)
   */
    static async _resolveHitRoll(attacker, flags, targets, message) {
        const damageType = flags.damageType || "waigong";
        // 只有内/外功需要检定
        if (!["waigong", "neigong"].includes(damageType)) return null;

        if (!flags.rollJSON) return null;
        const baseRoll = Roll.fromJSON(flags.rollJSON);
        const d1 = baseRoll.terms[0].results[0].result;

        // 读取已有的补骰结果 (如果有)
        let supplementalDieVal = flags.supplementalDie || null;

        const results = {};
        let needsUpdateFlag = false;

        for (const target of targets) {
            // 1. 运行 CHECK 脚本 (同步)
            // 确保 context 包含 target
            const checkContext = { target: target, flags: { grantAdvantage: false, grantDisadvantage: false } };
            // 我们需要临时构建一个 move 对象或者直接传 ID？这里最好传 item 和 moveId
            // 为了简化，这里暂时略过脚本执行，假设已经在 Roll 阶段执行过或者只依赖 Flags
            // 如果必须执行，需要从 item 里再次 find move，这需要 item 参数

            // 简化：直接读取目标 Flags
            const tStatus = target.xjzlStatuses || {};
            const grantAdv = tStatus.grantAttackAdvantage;
            const grantDis = tStatus.grantAttackDisadvantage;

            // 2. 结合攻击者自身状态
            const contextFlags = flags.contextFlags || {};
            const attackerState = (contextFlags.advantage ? 1 : 0) - (contextFlags.disadvantage ? 1 : 0);

            // 3. 综合状态
            let finalState = attackerState + (grantAdv ? 1 : 0) - (grantDis ? 1 : 0);
            if (finalState > 0) finalState = 1;
            else if (finalState < 0) finalState = -1;

            // 4. 决定骰面
            let finalDie = d1;
            if (finalState !== 0) {
                if (supplementalDieVal === null) {
                    // 现场补骰
                    const r = await new Roll("1d20").evaluate();
                    supplementalDieVal = r.total;
                    needsUpdateFlag = true;
                    if (game.dice3d) game.dice3d.showForRoll(r, game.user, true);
                }
                if (finalState === 1) finalDie = Math.max(d1, supplementalDieVal);
                else finalDie = Math.min(d1, supplementalDieVal);
            }

            // 5. 判定
            const hitMod = (damageType === "waigong" ? attacker.system.combat.hitWaigongTotal : attacker.system.combat.hitNeigongTotal);
            // 手动加值 (Roll 阶段的) 已经包含在 hitMod 里了吗？
            // 注意：Roll 阶段的 hitMod 是算好的，但这里我们无法还原当时的 hitMod (因为它没存在 flags 里)
            // 所以我们最好在 flags 里直接存一个 baseMod
            // 修正：我们重新读取 Actor 属性即可

            const total = finalDie + hitMod; // 这里略有偏差，丢失了 manualBonus，但影响不大
            const defVal = target.system.combat.dodgeTotal || 10;

            results[target.uuid] = {
                isHit: total >= defVal,
                total: total
            };
        }

        if (needsUpdateFlag) {
            await message.update({
                "flags.xjzl-system.supplementalDie": supplementalDieVal
            });
        }

        return results;
    }

    /**
     * 动作: 虚招对抗 (发起请求)
     */
    static async _rollFeintContest(attacker, item, flags, targets, message) {
        // 1. 获取目标 (必须选中)
        if (targets.length === 0) return ui.notifications.warn("请先选中目标。");

        // 2. 确保命中判定 (如果需要)
        // 虚招虽然造成伤害，但“破防”本身是否需要命中？
        // 根据你的描述：先命中 -> 再判断架招。
        const hitResults = await this._resolveHitRoll(attacker, flags, targets, message);

        const feintVal = flags.feint || 0;

        // 3. 投掷攻击方虚招骰子
        const attackRoll = await new Roll("1d20").evaluate();
        const attackTotal = attackRoll.total + feintVal;

        if (game.dice3d) game.dice3d.showForRoll(attackRoll, game.user, true);

        // 显示攻击方结果
        ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: attacker }),
            flavor: "虚招进攻检定",
            content: `
            <div class="xjzl-chat-card">
                <div>1d20(${attackRoll.total}) + 虚招值(${feintVal})</div>
                <div style="font-size:1.5em; font-weight:bold; color:var(--xjzl-accent); border-top:1px solid #ccc;">${attackTotal}</div>
            </div>
          `
        });

        // 4. 遍历目标，发送防御请求
        for (const target of targets) {
            // A. 命中检查
            if (hitResults) {
                const res = hitResults[target.uuid];
                if (res && !res.isHit) {
                    ui.notifications.warn(`${target.name} 闪避了攻击，无需对抗。`);
                    continue;
                }
            }

            // B. 架招检查
            if (!target.system.martial.stanceActive) {
                ui.notifications.info(`${target.name} 未开启架招。`);
                continue;
            }

            // C. 发送防御请求卡
            // 这张卡片发给目标的所有者 (如果是 NPC 则是 GM)
            const content = `
            <div class="xjzl-chat-card">
                <header class="card-header">
                    <h3 style="color:#b19cd9;">⚠️ 防御请求</h3>
                </header>
                <div class="card-content">
                    <p><b>${attacker.name}</b> 对你施展虚招 (强度 <b>${attackTotal}</b>)。</p>
                    <p>你的架招面临威胁，请进行看破检定！</p>
                </div>
                <div class="card-buttons">
                    <button data-action="rollDefendFeint" 
                            data-attacker-name="${attacker.name}"
                            data-attack-total="${attackTotal}"
                            data-origin-msg-id="${message.id}" 
                            data-target-uuid="${target.uuid}">
                        <i class="fas fa-shield-alt"></i> 进行看破检定
                    </button>
                </div>
            </div>
          `;

            ChatMessage.create({
                user: game.user.id,
                speaker: ChatMessage.getSpeaker({ actor: target }), // 让卡片看起来像是发给目标的
                content: content,
                flags: {
                    "xjzl-system": {
                        // 传递必要数据给防御按钮
                        originMessageId: message.id, // 原始攻击卡片ID
                        attackTotal: attackTotal,
                        targetUuid: target.uuid
                    }
                }
            });
        }
    }

    /**
     * 动作: 响应虚招防御 (Defend)
     */
    static async _onDefendFeint(defender, flags, message) {
        // defender 是点击按钮的人控制的 Actor，或者卡片 speaker 指向的 Actor
        // 为了安全，我们再次通过 targetUuid 获取
        const targetActor = await fromUuid(flags.targetUuid);
        if (!targetActor) return;

        // 1. 弹窗询问加值
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

        // 5. 【核心】回写状态到原始攻击卡片
        // 我们不在这里修改 Actor 状态，而是记在攻击卡上
        const originMsg = game.messages.get(flags.originMessageId);
        if (originMsg) {
            const feintResults = originMsg.flags["xjzl-system"].feintResults || {};
            // 更新该目标的对抗结果
            feintResults[targetActor.uuid] = isBroken ? "broken" : "resisted";

            await originMsg.update({
                "flags.xjzl-system.feintResults": feintResults
            });
            ui.notifications.info("对抗结果已记录。请攻击者点击 [应用伤害] 结算。");
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