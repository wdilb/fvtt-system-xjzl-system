const PERSONALITY_EFFECT_SLUG = "personality-modifier";

/**
 * 性格 (Personality) 数据模型
 * ==========================================
 * 核心逻辑：
 * 1. options: 存储由 GM 定义的 5 个备选技能 Key。
 * 2. chosen:  存储玩家从中选出的最多 2 个技能 Key。
 * 3. syncToEffect: 自动将 chosen 转化为 ActiveEffect 加成。
 * ==========================================
 */
export class XJZLPersonalityData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      // 性格描述 (例如：冷静的文字描述)
      description: new fields.HTMLField({
        initial: "",
        label: "XJZL.Personality.Description"
      }),

      // 【备选池】GM 在创建此物品时，从全局技能中选出 5 个存入此处
      options: new fields.ArrayField(new fields.StringField(), {
        initial: [],
        validate: (arr) => arr.length <= 5,
        label: "XJZL.Personality.Options"
      }),

      // 【选中池】玩家从 options 中勾选出的技能
      chosen: new fields.ArrayField(new fields.StringField(), {
        initial: [],
        validate: (arr) => arr.length <= 2,
        label: "XJZL.Personality.Chosen"
      }),

      // 修正强度 (规则固定为 +2)
      bonus: new fields.NumberField({
        initial: 2,
        integer: true,
        label: "XJZL.Modifier.Value"
      })
    };
  }

  /**
   * 根据当前选择构建性格加值 AE 数据。
   * @returns {object|null} 可直接嵌入 Item 的 AE 数据；无所属 Item 时返回 null。
   */
  buildModifierEffectData() {
    const item = this.parent;
    if (!item) return null;

    return {
      name: `${game.i18n.localize("XJZL.Personality.Label")}: ${item.name}`,
      icon: item.img || "icons/magic/life/heart-shadow-red.webp",
      changes: this.chosen.map(skillKey => ({
        key: `system.skills.${skillKey}.mod`,
        value: String(this.bonus),
        mode: CONST.ACTIVE_EFFECT_MODES.ADD
      })),
      transfer: true,
      flags: {
        "xjzl-system": {
          slug: PERSONALITY_EFFECT_SLUG,
          stackable: false
        }
      }
    };
  }

  /**
   * 将选中的技能同步到物品自带的 Active Effect 中
   * 这种方式保证了：只要玩家更换选择，加成就会刷新；删除性格，加成就会消失。
   */
  async syncToEffect() {
    const item = this.parent; // 获取此模型所属的 Item 实例
    if (!item) return;

    const effectData = this.buildModifierEffectData();

    // 查找是否已存在由本性格生成的 AE (通过 slug 识别)
    const effect = item.effects.find(e => e.getFlag("xjzl-system", "slug") === PERSONALITY_EFFECT_SLUG);

    if (effect) {
      // 如果已存在：更新数值。如果勾选为空，changes 也会为空，实现数值回退。
      await effect.update({
        name: effectData.name,
        changes: effectData.changes
      });
    } else if (effectData.changes.length > 0) {
      // 如果不存在且有选择：创建一个被动传输(transfer)的 AE
      await item.createEmbeddedDocuments("ActiveEffect", [effectData]);
    }
  }
}
