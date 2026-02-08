
const { StringField, BooleanField, NumberField, SchemaField, HTMLField } = foundry.data.fields;

/**
 * 容器/战利品 数据模型
 * 极其轻量，只存储必要信息
 */
export class XJZLContainerData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            // 描述信息
            description: new HTMLField({ required: false, blank: true }),

            // 状态标记
            locked: new BooleanField({ required: true, initial: false }), // 是否上锁 (预留给未来撬锁功能)
            isLooted: new BooleanField({ required: true, initial: false }), // 是否已被搜刮 (用于视觉变化)

            // 货币 (直接存储数值，不需要 resources.silver 的复杂结构)
            currency: new NumberField({ required: true, initial: 0, min: 0, integer: true }),

            // 来源 (可选，用于记录是谁掉落的，方便 GM 查账)
            source: new StringField({ required: false, blank: true })
        };
    }

    /**
     * 可以添加简单的逻辑 helper
     */
    get isEmpty() {
        return this.parent.items.size === 0 && this.currency === 0;
    }
}