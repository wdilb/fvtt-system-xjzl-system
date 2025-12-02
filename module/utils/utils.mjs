/* module/utils.mjs */

/**
 * 将配置对象的值进行本地化
 * 输入: { key: "LOC.Key" }
 * 输出: { key: "翻译后的文本" }
 */
export function localizeConfig(config) {
  const localized = {};
  for (const [key, labelKey] of Object.entries(config)) {
    localized[key] = game.i18n.localize(labelKey);
  }
  return localized;
}