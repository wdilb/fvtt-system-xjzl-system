
/**
 * 物资节点的持久化数据模型。
 * 约束：节点只保存库存业务状态，不参与 Actor 的属性、资源或脚本生命周期。
 */

const {
    StringField,
    BooleanField,
    NumberField,
    SchemaField,
    HTMLField,
    ArrayField
} = foundry.data.fields;

export const CONTAINER_MODES = Object.freeze(["loot", "storage", "shop"]);
export const CONTAINER_STATUSES = Object.freeze(["active", "closed", "depleted"]);
export const CONTAINER_XP_POOLS = Object.freeze(["general", "neigong", "wuxue", "arts"]);

function makeClaimSchema() {
    return new SchemaField({
        userId: new StringField({ required: true }),
        actorUuid: new StringField({ required: true }),
        claimedAt: new NumberField({ required: true, integer: true, min: 0 })
    });
}

function makeRewardSchema() {
    return new SchemaField({
        id: new StringField({ required: true, initial: () => foundry.utils.randomID() }),
        kind: new StringField({ required: true, initial: "xp", choices: ["xp"] }),
        name: new StringField({ required: true, initial: "修为奖励" }),
        poolKey: new StringField({ required: true, initial: "general", choices: CONTAINER_XP_POOLS }),
        amount: new NumberField({ required: true, initial: 1, min: 1, integer: true }),
        logTitle: new StringField({ required: false, blank: true, initial: "" }),
        logReason: new StringField({ required: false, blank: true, initial: "" }),
        hidden: new BooleanField({ required: true, initial: false }),
        claims: new ArrayField(makeClaimSchema(), { initial: [] })
    });
}

export class XJZLContainerData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        return {
            description: new HTMLField({ required: false, blank: true }),

            // 模式决定玩家工作台的业务动作；depleted 表示一次性节点暂时清空，补货后会恢复 active。
            mode: new StringField({ required: true, initial: "loot", choices: CONTAINER_MODES }),
            status: new StringField({ required: true, initial: "active", choices: CONTAINER_STATUSES }),

            // 节点钱箱只保存银两余额；角色银两仍由角色自身的资源事务维护。
            currency: new NumberField({ required: true, initial: 0, min: 0, integer: true }),

            // 这些是业务能力开关，不替代 Foundry 的文档可见性/管理权限。
            settings: new SchemaField({
                allowTake: new BooleanField({ required: true, initial: true }),
                allowTakeAll: new BooleanField({ required: true, initial: true }),
                allowDeposit: new BooleanField({ required: true, initial: false }),
                allowWithdraw: new BooleanField({ required: true, initial: false }),
                buyDiscount: new NumberField({ required: true, initial: 1, min: 0 }),
                sellDiscount: new NumberField({ required: true, initial: 0.5, min: 0 }),
                infiniteStock: new BooleanField({ required: true, initial: false }),
                infiniteWallet: new BooleanField({ required: true, initial: true })
            }),

            // 修为是按玩家领取的个人奖励，不放进嵌入 Item，以免和共享库存混淆。
            rewards: new ArrayField(makeRewardSchema(), { initial: [] })
        };
    }

    get isEmpty() {
        return this.parent.items.size === 0
            && this.currency === 0
            && this.rewards.every(reward => reward.hidden || reward.claims.length > 0);
    }

    get isOpen() {
        return this.status === "active";
    }
}
