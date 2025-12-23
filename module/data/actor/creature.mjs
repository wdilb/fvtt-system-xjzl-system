/**
 * 野兽/怪物 (Creature) 数据模型
 * ==========================================
 * 设计目标：
 * 1. 极简配置：只存储体力、防护、基础战斗数值。
 * 2. 接口兼容 (Duck Typing)：
 *    在内存中动态生成 stats, skills, martial 等结构，
 *    欺骗脚本引擎和战斗系统，使其认为这是一个"数值为0的侠客"。
 * ==========================================
 */
export class XJZLCreatureData extends foundry.abstract.TypeDataModel {

    static defineSchema() {
        const fields = foundry.data.fields;

        return {
            // === 1. 核心生存 ===
            resources: new fields.SchemaField({
                // 体力 (对应 HP)
                tili: new fields.SchemaField({
                    value: new fields.NumberField({ initial: 1, min: 0, integer: true }),
                    max: new fields.NumberField({ initial: 1, min: 1, integer: true })
                }),
                // 怒气 (野兽有怒气吗？规则书上好像说有)
                rage: new fields.SchemaField({
                    value: new fields.NumberField({ initial: 0, min: 0, max: 10, integer: true }),
                    max: new fields.NumberField({ initial: 10, integer: true })
                })
            }),

            // === 2. 战斗属性 (直接填值) ===
            combat: new fields.SchemaField({
                speed: new fields.NumberField({ initial: 5, integer: true, label: "XJZL.Combat.Speed" }),
                dodge: new fields.NumberField({ initial: 10, integer: true, label: "XJZL.Combat.Dodge" }),
                hit: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.HitWaigong" }),
                protection: new fields.NumberField({ initial: 0, min: 0, integer: true, label: "XJZL.Combat.Protection" }), // 防护阈值
                damage: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Equipment.Damage" }) // 基础伤害
            }),

            // === 3. 描述信息 ===
            info: new fields.SchemaField({
                // 凡/猛/珍
                type: new fields.StringField({ initial: "fan", choices: ["fan", "meng", "zhen"], label: "XJZL.Creature.Type" }),
                difficulty: new fields.NumberField({ initial: 10, label: "XJZL.Creature.Difficulty" }), // 捕捉难度
                price: new fields.StringField({ initial: "", label: "XJZL.Equipment.Price" }), // 饲养价格
                size: new fields.StringField({ initial: "medium", label: "XJZL.Info.Height" }) // 体型
            }),

            description: new fields.HTMLField({ label: "XJZL.Info.Bio" }), // 描述

            // 技能列表 (简单的数组对象，不走 Item， 只存描述)
            abilities: new fields.ArrayField(new fields.SchemaField({
                name: new fields.StringField(),
                description: new fields.StringField()
            }))
        };
    }

    /**
     * 数据准备：关键的兼容性映射 (Safety Padding)
     * 这里我们凭空捏造出侠客的所有属性，防止脚本报错，没有任何实际作用
     */
    prepareDerivedData() {
        // ----------------------------------------------------
        // 1. 战斗属性映射 (Mapping)
        // ----------------------------------------------------
        const combat = this.combat;

        // 系统读取的是 xxxTotal，我们把基础值赋给它
        combat.dodgeTotal = combat.dodge;
        combat.speedTotal = combat.speed;

        // 野兽只有一种命中，映射给内外功
        combat.hitWaigongTotal = combat.hit;
        combat.hitNeigongTotal = combat.hit;

        // 其他可能被读取的战斗属性，全部置 0
        combat.blockTotal = 0;
        combat.kanpoTotal = 0;
        combat.xuzhaoTotal = 0;
        combat.defWaigongTotal = 0; // 防御靠 protection 阈值，这里设0
        combat.defNeigongTotal = 0;
        combat.critWaigongTotal = 0;
        combat.critNeigongTotal = 0;
        combat.initiativeTotal = 0;

        // ----------------------------------------------------
        // 2. 虚拟结构填充 (Mocking)
        // ----------------------------------------------------

        // A. 架招 (Martial)
        // 脚本检测：!actor.system.martial?.stanceActive
        this.martial = {
            stanceActive: false,
            stance: "",
            stanceItemId: ""
        };

        // B. 七维属性 (Stats)
        // 脚本检测：actor.system.stats.liliang.total
        this.stats = {};
        const statKeys = ["liliang", "shenfa", "neixi", "tipo", "qigan", "shencai", "wuxing"];
        for (const key of statKeys) {
            this.stats[key] = { value: 0, mod: 0, total: 0, assigned: 0 };
        }

        // C. 资源 HP/MP/Huti (Resources)
        // 脚本检测：actor.system.resources.hp.value

        // 映射 HP -> Tili (让脚本能读到野兽的"血")
        if (!this.resources.hp) {
            this.resources.hp = {
                value: this.resources.tili.value,
                max: this.resources.tili.max,
                bonus: 0
            };
        }
        // 填充 MP/Huti 为 0
        if (!this.resources.mp) this.resources.mp = { value: 0, max: 0, bonus: 0 };
        if (!this.resources.huti) this.resources.huti = 0;

        // 其他资源
        if (!this.resources.silver) this.resources.silver = 0;

        // D. 技能 (Skills)
        // 脚本检测：actor.system.skills.qinggong.total
        this.skills = {};
        // 大多数脚本写得好会有 (val || 0)，所以 undefined 通常也是安全的。
        // 但为了绝对安全，我们把所有技能 Key 循环一遍赋 0。
        const skillKeys = [
            "jiaoli", "zhengtuo", "paozhi", "qinbao",
            "qianxing", "qiaoshou", "qinggong", "mashu",
            "renxing", "biqi", "rennai", "ningxue",
            "liaoshang", "chongxue", "lianxi", "duqi",
            "dianxue", "zhuizong", "tancha", "dongcha",
            "jiaoyi", "qiman", "shuofu", "dingli",
            "wuxue", "jianding", "bagua", "shili"
        ];
        for (const k of skillKeys) {
            this.skills[k] = { base: 0, mod: 0, total: 0 };
        }

        // E. 经脉 (Jingmai)
        // 防止读取 system.jingmai.standard 报错
        this.jingmai = {
            standard: {},
            extra: {},
            xuanguan: { broken: false }
        };

        // F. 技艺 (Arts)
        this.arts = {};
    }
}