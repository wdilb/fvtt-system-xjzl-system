const MYSTERY_MAN = "icons/svg/mystery-man.svg";

/**
 * 结算界面目标头像取图口径：优先 Token 立绘，贴图为视频（动态立绘）或缺失时回退角色卡立绘。
 * HTML <img> 无法加载视频路径，直接按扩展名回退，避免破图。
 * @param {TokenDocument|Actor|null} tokenDocument 目标文档；Actor 不提供 Token 贴图
 * @param {Actor|null} actor 目标 Actor
 * @returns {string} 可用于 <img> 的图片路径
 */
export function resolveTargetPortrait(tokenDocument, actor) {
    const src = tokenDocument?.texture?.src;
    if (src && !foundry.helpers.media.VideoHelper.hasVideoExtension(src)) return src;
    const actorImg = actor?.img;
    return actorImg && !foundry.helpers.media.VideoHelper.hasVideoExtension(actorImg) ? actorImg : MYSTERY_MAN;
}
