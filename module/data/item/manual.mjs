/**
 * 秘籍/书籍数据模型
 * 用于学习内功、武学或技艺
 */
export class XJZLManualData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        const fields = foundry.data.fields;

        return {
            // === 基础属性 ===
            quantity: new fields.NumberField({ initial: 1, min: 0, integer: true, label: "XJZL.Equipment.Quantity" }), // 数量
            price: new fields.NumberField({ initial: 0, min: 0, label: "XJZL.Equipment.Price" }),    // 价格
            // 品阶 (1-3)
            tier: new fields.NumberField({
                initial: 1,
                choices: [1, 2, 3],
                label: "XJZL.Tiers.Label"
            }),
            // === 核心功能 ===

            // 目标物品的 UUID (内功/武学)
            // 逻辑：读取该 UUID 对应的物品数据，复制一份创建到 Actor 身上
            learnItemUuid: new fields.StringField({ label: "XJZL.Manual.TargetItem" }),

            // 是否消耗
            // true: 读完就消失 (如丹方、残页); false: 永久保留 (如书卷)
            destroyOnUse: new fields.BooleanField({ initial: true, label: "XJZL.Manual.Destroy" }),

            // === 描述 ===
            description: new fields.HTMLField({ label: "XJZL.Info.Bio" })
        };
    }
}