/**
 * 背景 (Background) 数据模型
 * ==========================================
 * 核心逻辑：
 * 1. description: 存储背景故事描述。
 * 2. items: [预留口子] 未来用于存储背景赠送的物品 UUID 数组。
 * ------------------------------------------
 * 这种设计现在不强制任何逻辑，但未来如果你想实现“拖动物品到背景里”的功能，
 * 数据结构已经是现成的了。
 * ==========================================
 */
export class XJZLBackgroundData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      // 背景故事/来源详细描述
      description: new fields.HTMLField({ 
        initial: "", 
        label: "XJZL.Background.Description" 
      }),

      // 【未来预留：物资包】
      // 存储背景关联的物品引用（如：武学、武器、行囊物品的 UUID）
      // 当前仅作为数据接口存在，不触发自动化逻辑
      items: new fields.ArrayField(new fields.SchemaField({
        uuid: new fields.StringField({ required: true }),
        quantity: new fields.NumberField({ initial: 1, min: 1, integer: true })
      }), { 
        initial: [], 
        label: "XJZL.Background.StoredItems" 
      })
    };
  }
}