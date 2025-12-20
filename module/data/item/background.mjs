/**
 * 背景 (Background) 数据模型
 * ==========================================
 * 核心逻辑：
 * 1. description: 存储背景故事描述。
 * 2. assets: 存储初始行囊的文字描述。
 * 3. items: [预留] 未来用于存储背景赠送的实体物品 UUID。
 * ==========================================
 */
export class XJZLBackgroundData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      // 1. 背景故事/来源详细描述
      description: new fields.HTMLField({
        initial: "",
        label: "XJZL.Background.Description"
      }),

      // 2. 初始行囊描述 (文字版)
      // 对应 JSON 中的 "assets" 字段，用于在界面显示 "粗麻上衣, 10两白银"
      assets: new fields.HTMLField({
        initial: "",
        label: "XJZL.Background.AssetsHeader"
      }),

      // 3. [未来预留] 实体物品引用
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