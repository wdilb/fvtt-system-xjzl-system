
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
export const DEFAULT_CONTAINER_IMAGES = Object.freeze({
    active: "systems/xjzl-system/assets/ui/container/wuxia-chest-closed.webp",
    depleted: "systems/xjzl-system/assets/ui/container/wuxia-chest-open.webp"
});

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

            // Actor.img 仍作为资料图；战利品使用独立状态图驱动工作台和 Token 外观。
            appearance: new SchemaField({
                activeImg: new StringField({ required: true, initial: DEFAULT_CONTAINER_IMAGES.active }),
                depletedImg: new StringField({ required: true, initial: DEFAULT_CONTAINER_IMAGES.depleted })
            }),

            // 节点钱箱只保存银两余额；角色银两仍由角色自身的资源事务维护。
            currency: new NumberField({ required: true, initial: 0, min: 0, integer: true }),

            // 战利品只保留“全部拾取”开关；仓库存取直接由 Foundry Actor 所有权决定。
            settings: new SchemaField({
                allowTakeAll: new BooleanField({ required: true, initial: true }),
                buyDiscount: new NumberField({ required: true, initial: 1, min: 0 }),
                sellDiscount: new NumberField({ required: true, initial: 0.5, min: 0 }),
                infiniteStock: new BooleanField({ required: true, initial: false }),
                infiniteWallet: new BooleanField({ required: true, initial: true })
            }),

            // 修为是按玩家领取的个人奖励，不放进嵌入 Item，以免和共享库存混淆。
            rewards: new ArrayField(makeRewardSchema(), { initial: [] })
        };
    }

    /** 共享物资是否已经取尽；个人修为奖励不参与节点耗尽判定。 */
    get isEmpty() {
        return this.parent.items.size === 0 && this.currency === 0;
    }

    get isOpen() {
        return this.status === "active";
    }
}
