/**
 * 战斗流转三时机（combatStart/turnStart/turnEnd）的活动 GM 本地执行。
 *
 * 第三步起系统战斗流转不再把脚本整批路由给 owner 客户端：活动 GM 在本地
 * 等待全部脚本（含 ask 问答）完成后，updateCombat 队列才继续战局后续阶段。
 * round/turn 是事件数值快照，由调用方在进入队列与任何 await 之前捕获；
 * 脚本内的活文档 round/turn 可能已变化，一律读取注入的快照值。
 */

import { SCRIPT_TRIGGERS } from "../data/common.mjs";

/** 三时机的 processRegen 时机映射；combatStart 无自动回复阶段。 */
const REGEN_TIMING_BY_TRIGGER = Object.freeze({
  [SCRIPT_TRIGGERS.TURN_START]: "TurnStart",
  [SCRIPT_TRIGGERS.TURN_END]: "TurnEnd"
});

/**
 * 事件作用域判定：战斗仍是删除前的活文档，且仍处于进行中的状态（round > 0）。
 * 删除与回退到战前状态（round 回到 0）同样使已排队事件与绑定问询过期；
 * 生命周期执行、问询发起与消费答案共用本判断，避免各处语义漂移。
 * @param {Combat} combat - 事件对应的 Combat 文档
 * @returns {boolean} 事件作用域仍有效时为 true
 */
export function isCombatEventLive(combat) {
  return Boolean(combat?.id)
    && game.combats?.get(combat.id) === combat
    && (Number(combat.round) || 0) > 0;
}

/**
 * 以活动 GM 身份在本地等待执行一个流转阶段的全部脚本。
 * 单个宿主的普通脚本错误保持既有隔离语义（记录后继续其他宿主）；
 * 宿主删除等中止错误同样按既有语义被捕获，不跨宿主传播。
 * @param {object} params
 * @param {Combat} params.combat - 事件对应的 Combat 文档（活引用，供脚本操作）
 * @param {Combatant|Combatant[]} params.combatants - 本阶段的 Combatant；
 *   combatStart 传全部参战者，turnStart/turnEnd 传单个
 * @param {string} params.trigger - combatStart/turnStart/turnEnd
 * @param {number} params.round - 事件轮次快照（进队列前捕获）
 * @param {number|null} params.turn - 事件零基回合位置快照；无有效位置为 null
 * @param {boolean} [params.parallel=false] - combatStart 为 true：保持原有
 *   各 Combatant 并行进战的语义；回合脚本串行
 */
export async function runCombatLifecycleScripts({ combat, combatants, trigger, round, turn, parallel = false }) {
  const list = Array.isArray(combatants) ? combatants : [combatants];
  const regenTiming = REGEN_TIMING_BY_TRIGGER[trigger] ?? null;
  const runOne = async combatant => {
    const actor = combatant?.actor;
    if (!actor) return;
    // 事件作用域复核：等待期间战斗被删除时，跳过该宿主及后续全部宿主。
    if (!isCombatEventLive(combat)) return;
    // 上下文在排队与任何 await 之前捕获的快照值；args.combat 仍是活文档。
    const context = { combat, combatant, round, turn };
    try {
      if (regenTiming) {
        await actor.processRegen(regenTiming);
        // 自动回复内部可能等待资源事件中的问询或死亡结算；期间事件作用域
        // 或本次参战者身份可能失效，不得继续扣资源、施加效果或弹窗。
        if (!isCombatEventLive(combat) || combat.combatants.get(combatant.id) !== combatant) return;
      }
      await actor.runScripts(trigger, context);
    } catch (err) {
      console.error(`XJZL | [GM] ${trigger} 流转脚本执行错误 [${actor.name}]:`, err);
    }
  };
  if (parallel) {
    await Promise.all(list.map(runOne));
    return;
  }
  for (const combatant of list) {
    await runOne(combatant);
  }
}
