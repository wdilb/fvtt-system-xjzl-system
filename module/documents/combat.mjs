import { XJZLActiveEffect } from "./active-effect.mjs";
import {
  recordEffectTurnStart, persistEffectTurnCount, captureEffectTurnContext, synchronizeEffectTurnCounts
} from "../utils/effect-duration.mjs";

/** 在核心过期结算之前记录实际回合开始，避免先攻重排改变角色关联时长。 */
export class XJZLCombat extends foundry.documents.Combat {
  #effectTurnEvents = Promise.resolve();

  /** 系统回合脚本等待同次核心流转完成，避免在计数提交前创建下一批效果。 */
  get effectTurnEvents() { return this.#effectTurnEvents; }

  /** 在所有客户端同步记入实际流转，再透传核心流程；回退和纯重排不增加次数。 */
  _manageTurnEvents() {
    const { current, previous } = this;
    const progressed = this.started && current && previous && (current.round > previous.round
      || (current.round === previous.round && current.turn > previous.turn)
      || (current.round === previous.round && current.turn === previous.turn
        && current.combatantId !== previous.combatantId));
    if (progressed && current.combatantId) {
      recordEffectTurnStart(this, current.combatantId, current);
      if (!game.users.activeGM?.isSelf) XJZLActiveEffect.refreshCombatDurations(this);
    }
    return this.#effectTurnEvents = super._manageTurnEvents();
  }

  /** GM 广播只在校正本地已知计数时补刷，避免与客户端预记账重复计算全部时长。 */
  _onUpdate(changed, options, userId) {
    const prefix = "flags.xjzl-system.effectTurnCounts";
    const countsChanged = Object.hasOwn(changed.flags?.["xjzl-system"] ?? {}, "effectTurnCounts")
      || Object.keys(changed).some(key => key === prefix || key.startsWith(`${prefix}.`));
    // 基类可能触发新一轮本地记账，先判断这次广播是否带来有效变化。
    const refresh = countsChanged && !game.users.activeGM?.isSelf && synchronizeEffectTurnCounts(this);
    super._onUpdate(changed, options, userId);
    if (refresh) XJZLActiveEffect.refreshCombatDurations(this);
  }

  /**
   * 只持久化实际到达的回合；被跳过的中间位置不消耗角色关联时长。
   * @param {Combatant} combatant 当前行动者。
   * @param {object} context 核心传入的 round/turn/skipped 快照。
   */
  async _onStartTurn(combatant, context) {
    captureEffectTurnContext(this, context, combatant.id, true);
    await super._onStartTurn(combatant, context);
    if (context.skipped || !game.users.activeGM?.isSelf) return;
    await XJZLActiveEffect.initializeTurnCounters(this, context);
    await persistEffectTurnCount(this, combatant.id, context);
  }

  /** 保留回合结束的实际行动者，避免核心已跳至下一人时误匹配实时 Combat 状态。 */
  async _onEndTurn(combatant, context) {
    captureEffectTurnContext(this, context, combatant.id);
    await super._onEndTurn(combatant, context);
  }

  /** 轮末仍处于终点回合开始之前，使用该阶段的计数快照。 */
  async _onEndRound(context) {
    captureEffectTurnContext(this, context);
    await super._onEndRound(context);
  }

  /** 轮初先于当前角色回合开始，不能提前消耗该角色的下一次回合。 */
  async _onStartRound(context) {
    captureEffectTurnContext(this, context);
    await super._onStartRound(context);
  }
}
