/**
 * 消耗品数据模型
 * 用于定义药品、食物、毒药等可使用的物品
 */
import { XJZL } from "../../config.mjs";

export class XJZLConsumableData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      // === 基础属性 ===
      // 堆叠数量
      quantity: new fields.NumberField({ initial: 1, min: 0, integer: true, label: "XJZL.Equipment.Quantity" }),
      // 单价
      price: new fields.NumberField({ initial: 0, min: 0, label: "XJZL.Equipment.Price" }),

      quality: new fields.NumberField({
        initial: 0,
        choices: [0, 1, 2, 3, 4],
        label: "XJZL.Qualities.Label"
      }), //品质(0-4)

      // === 核心分类 ===
      // 决定互斥逻辑 (如：药品buff覆盖药品，但不覆盖食物)
      // 对应 XJZL.consumableTypes
      type: new fields.StringField({
        initial: "medicine",
        choices: Object.keys(XJZL.consumableTypes),
        label: "XJZL.Consumable.TypeLabel"
      }),

      // === 使用效果 ===
      // 1. 基础恢复 (最常用的回血回蓝)
      recovery: new fields.SchemaField({
        hp: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Resources.HP" }),     // 恢复气血
        mp: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Resources.MP" }),     // 恢复内力
        rage: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Resources.Rage" })  // 恢复怒气
      }, { label: "XJZL.Consumable.Recovery" }),

      // 2. 高级脚本 (Script)
      // 用于处理特殊逻辑，如 "解毒"、"获得1000修为"、"传送"
      usageScript: new fields.StringField({
        label: "XJZL.Consumable.Script",
        hint: "使用时执行的脚本。变量: actor, item"
      }),

      // 3. Buff/Debuff
      // 直接使用 Item 原生的 effects 集合。
      // 逻辑：使用消耗品时，将 transfer=false 的特效复制给 Actor。

      // === 描述 ===
      description: new fields.HTMLField({ label: "XJZL.Info.Bio" }),

      // 自动化说明
      automationNote: new fields.StringField({
        required: false,
        initial: "",
        label: "XJZL.AutomationNote" // 使用全局 Key
      })
    };
  }
}