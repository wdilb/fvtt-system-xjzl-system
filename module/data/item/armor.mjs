/**
 * 防具数据模型
 */
import { makeScriptEffectSchema } from "../common.mjs";
export class XJZLArmorData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      // === 基础状态 ===
      equipped: new fields.BooleanField({ initial: false, label: "XJZL.Equipment.Equipped" }), // 是否已装备
      quantity: new fields.NumberField({ initial: 1, min: 0, integer: true, label: "XJZL.Equipment.Quantity" }), // 品质
      price: new fields.NumberField({ initial: 0, min: 0, label: "XJZL.Equipment.Price" }), // 价格
      quality: new fields.NumberField({
        initial: 0,
        choices: [0, 1, 2, 3, 4],
        label: "XJZL.Qualities.Label"
      }), //品质(0-4)

      // === 核心分类 ===
      // 对应 config.mjs 中的 XJZL.armorTypes
      type: new fields.StringField({
        initial: "top",
        choices: ["head", "top", "bottom", "shoes", "ring", "earring", "necklace", "accessory"],
        label: "XJZL.Wuxue.Category"
      }),  //装备部位

      // 【删除】 equipChanges (交给 AE 处理)

      // === 高级逻辑 ===
      scripts: new fields.ArrayField(makeScriptEffectSchema(), {
        label: "XJZL.Item.ScriptList"
      }),

      description: new fields.HTMLField({ label: "XJZL.Info.Bio" }), // 描述

      // 自动化说明
      automationNote: new fields.StringField({
        required: false,
        initial: "",
        label: "XJZL.AutomationNote" // 使用全局 Key
      })
    };
  }
}