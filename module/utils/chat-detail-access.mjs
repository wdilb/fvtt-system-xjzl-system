const SYSTEM_ID = "xjzl-system";

/**
 * 为自动发送的聊天卡片生成详情访问状态。
 * @param {Actor} actor 信息来源角色；必须是实际发起动作的 Actor。
 * @param {object} speaker ChatMessage.getSpeaker() 生成的说话者快照。
 * @returns {{state: "locked"}|null} 仅敌对来源且世界设置开启时返回锁定状态。
 */
export function createAutomaticDetailAccess(actor, speaker) {
  if (!actor || !game.settings.get(SYSTEM_ID, "hideHostileChatDetails")) return null;

  // 以本次消息对应的场景 Token 为准，避免友善 NPC 因 actor.type 被误判为敌对。
  const scene = speaker?.scene ? game.scenes.get(speaker.scene) : null;
  const speakerToken = scene?.tokens.get(speaker?.token);
  const disposition = speakerToken?.disposition
    ?? actor.token?.disposition
    ?? actor.prototypeToken?.disposition;

  // SECRET 比 HOSTILE 更严格，同样不能向玩家公开自动卡片的规则详情。
  const isProtected = disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE
    || disposition === CONST.TOKEN_DISPOSITIONS.SECRET;
  if (!isProtected) return null;
  return { state: "locked" };
}
