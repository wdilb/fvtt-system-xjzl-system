/**
 * 武器数据模型
 */
import { makeScriptEffectSchema } from "../common.mjs";
export class XJZLWeaponData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      // === 基础状态 ===
      equipped: new fields.BooleanField({ initial: false, label: "XJZL.Equipment.Equipped" }),// 是否已装备
      quantity: new fields.NumberField({ initial: 1, min: 0, integer: true, label: "XJZL.Equipment.Quantity" }),//品质
      price: new fields.NumberField({ initial: 0, min: 0, label: "XJZL.Equipment.Price" }),//价格
      quality: new fields.NumberField({
        initial: 0,
        choices: [0, 1, 2, 3, 4],
        label: "XJZL.Qualities.Label"
      }), //品质(0-4)

      // === 核心属性 ===
      // 对应 config.mjs 中的 XJZL.weaponTypes
      type: new fields.StringField({ initial: "sword", label: "XJZL.Wuxue.Moves.WeaponType" }), //武器类型
      subtype: new fields.StringField({ label: "XJZL.Wuxue.Moves.WeaponSubtype" }), // 子类型 (如: 重剑)

      damage: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Equipment.Damage" }), // 基础伤害
      block: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Equipment.Block" }),   // 格挡值

      // 【删除】 equipChanges (交给 AE 处理)

      // === 高级逻辑 ===
      // 以前: equipScript
      scripts: new fields.ArrayField(makeScriptEffectSchema(), {
        label: "XJZL.Item.ScriptList"
      }),

      description: new fields.HTMLField({ label: "XJZL.Info.Bio" }), //描述
      // 自动化说明
      automationNote: new fields.StringField({
        required: false,
        initial: "",
        label: "XJZL.AutomationNote" // 使用全局 Key
      })
    };
  }
}