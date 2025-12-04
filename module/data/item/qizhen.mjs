/**
 * 奇珍数据模型 (镶嵌在经脉穴位中)
 */
export class XJZLQizhenData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      // === 基础状态 ===
      equipped: new fields.BooleanField({ initial: false, label: "XJZL.Equipment.Equipped" }),  // 是否已装备
      quantity: new fields.NumberField({ initial: 1, min: 0, integer: true, label: "XJZL.Equipment.Quantity" }), // 品质
      price: new fields.NumberField({ initial: 0, min: 0, label: "XJZL.Equipment.Price" }), // 价格
      quality: new fields.NumberField({
        initial: 0,
        choices: [0, 1, 2, 3, 4],
        label: "XJZL.Qualities.Label"
      }), //品质(0-4)

      // 默认为空字符串，表示未镶嵌。
      // 当玩家把它拖到某个穴位时，这里会更新为该穴位的 Key (如 "hand_shaoyin")
      acupoint: new fields.StringField({ initial: "", label: "XJZL.Equipment.Acupoint" }),

      // 【删除】 equipChanges (交给 AE 处理)

      // === 高级逻辑 ===
      equipScript: new fields.StringField({ label: "XJZL.Equipment.EquipScript" }),

      description: new fields.HTMLField({ label: "XJZL.Info.Bio" }) // 描述
    };
  }
}