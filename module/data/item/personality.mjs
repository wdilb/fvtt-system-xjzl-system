/**
 * 性格 (Personality) 数据模型
 * ==========================================
 * 核心职责：
 * 1. 记录性格预设类型 (对应 config 中的 presets)。
 * 2. 存储玩家从 5 个备选技能中选出的 2 个。
 * 3. 维护一个被动传输的 Active Effect 以自动增加数值。
 * ==========================================
 */
export class XJZLPersonalityData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      description: new fields.HTMLField({ initial: "" }),
      
      // 性格预设 Key (如 "lengjing", "zishi")
      presetKey: new fields.StringField({ 
        required: true, 
        initial: "lengjing",
        label: "XJZL.Personality.PresetKey" 
      }),

      // 选中的技能列表 (最大长度 2)
      chosen: new fields.ArrayField(new fields.StringField(), {
        initial: [],
        validate: (arr) => arr.length <= 2,
        label: "XJZL.Personality.ChosenSkills"
      }),

      // 修正数值 (规则固定为 +2)
      bonus: new fields.NumberField({ 
        initial: 2, 
        integer: true, 
        label: "XJZL.Modifier.Value" 
      })
    };
  }

  /**
   * 自动同步选择到 Item 自身的 Active Effect
   * 当玩家在 Sheet 上勾选改变并提交后，应手动触发此方法
   */
  async syncToEffect() {
    const item = this.parent;
    if (!item) return;

    // 1. 构建 Changes 数组
    // 修改路径：system.skills.[skillKey].mod
    const changes = this.chosen.map(skillKey => ({
      key: `system.skills.${skillKey}.mod`,
      value: String(this.bonus),
      mode: CONST.ACTIVE_EFFECT_MODES.ADD
    }));

    // 2. 查找是否已存在性格加成的 AE
    const slug = "personality-modifier";
    let effect = item.effects.find(e => e.getFlag("xjzl-system", "slug") === slug);

    if (effect) {
      // 如果已存在，更新 Changes。如果 chosen 为空，AE 的 changes 也会变为空，数值会自动退回。
      await effect.update({ 
        name: `性格修正: ${item.name}`,
        changes: changes 
      });
    } else {
      // 如果不存在且有选择，创建 AE
      if (changes.length === 0) return;
      
      await item.createEmbeddedDocuments("ActiveEffect", [{
        name: `性格修正: ${item.name}`,
        icon: item.img || "icons/magic/life/heart-shadow-red.webp",
        changes: changes,
        transfer: true, // 关键：设为被动传输，拖入 Actor 后由系统自动计算数值
        flags: { 
          "xjzl-system": { 
            slug: slug,
            stackable: false 
          } 
        }
      }]);
    }
  }

  /**
   * 衍生数据准备
   * 这里我们可以通过 presetKey 动态获取当前的选项池，方便前端 Sheet 使用
   */
  prepareDerivedData() {
    const preset = CONFIG.XJZL.personalityPresets[this.presetKey];
    // 动态挂载选项池到内存，不存入数据库
    this.availableOptions = preset ? preset.options : [];
    this.label = preset ? preset.label : "XJZL.Personality.Unknown";
  }
}