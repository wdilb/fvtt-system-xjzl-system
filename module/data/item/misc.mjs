/**
 * 杂物数据模型
 * 用于任务物品、材料、信件等
 */
export class XJZLMiscData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      // === 基础属性 ===
      quantity: new fields.NumberField({ initial: 1, min: 0, integer: true, label: "XJZL.Equipment.Quantity" }), // 数量
      price: new fields.NumberField({ initial: 0, min: 0, label: "XJZL.Equipment.Price" }),    // 价格

      // === 品质 ===
      quality: new fields.NumberField({
        initial: 0,
        integer: true,
        min: 0,
        max: 4
      }),

      // === 描述 ===
      description: new fields.HTMLField({ label: "XJZL.Info.Bio" })
    };
  }
}