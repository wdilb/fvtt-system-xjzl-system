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
import { localizeConfig } from "../../utils/utils.mjs";

/**
 * 检定后果可用的伤害/流失类型。
 * 系统伤害类型（poison/bleed 等）走 applyDamage 完整抗性结算；
 * 资源键（hp/mp/rage/tili）走 applyHealing 负数直接流失。
 * 供后果配置下拉与 schema choices 共用，是两者的单一事实源。
 * @returns {Object} key → 本地化标签
 */
export function getCheckOutcomeTypes() {
    const types = {};
    for (const [key, labelKey] of Object.entries(CONFIG.XJZL.damageTypes)) {
        // "无"伤害类型服务于气招等攻击展示，对检定后果没有结算意义
        if (key === "none") continue;
        types[key] = game.i18n.localize(labelKey);
    }
    return { ...types, ...getCheckResourceTypes() };
}

/**
 * 按完整元素写回单条野兽特性。
 * abilities 数组元素在 Foundry update 中按"整体替换"处理：只提交部分字段
 * （如仅 check）会把同级的 isAttack/damage 等重置为默认值。因此任何特性写入
 * 都必须携带该特性的完整数据，以现有数据为底、partial 覆盖。
 * @param {Actor} actor 野兽 Actor
 * @param {Number} index 特性下标
 * @param {Object} partial 要覆盖的字段（如 { check: {...} } 或 { isAttack: true }）
 * @returns {Promise} update 结果
 */
export async function updateCreatureAbility(actor, index, partial) {
    const ability = actor.system.abilities[index];
    if (!ability) throw new Error(`XJZL | 特性下标不存在: ${index}`);
    const full = ability.toObject?.() ?? foundry.utils.deepClone(ability);
    await actor.update({ [`system.abilities.${index}`]: foundry.utils.mergeObject(full, partial) });
}

/**
 * 检定后果"直接资源流失/恢复"可用的资源键（对应 applyHealing 的 type）。
 * @returns {Object} key → 中文标签
 */
export function getCheckResourceTypes() {
    return { hp: "气血", mp: "内力", rage: "怒气", tili: "体力" };
}

/**
 * 野兽"自身恢复"可用的资源键（对应 applyHealing 的 type）。
 * 野兽只持久化 tili 与 rage（见 resources schema）；hp 是 prepareDerivedData
 * 派生的只读视图，applyHealing 恢复 hp 不会写回 tili，因此不进入选项。
 * @returns {Object} key → 中文标签
 */
export function getSelfRecoveryTypes() {
    return { tili: "体力", rage: "怒气" };
}

/**
 * 检定/对抗可用的属性 key（属性 + 技能 + 技艺合并）。
 * 野兽自身属性恒为 0，此列表主要用于目标侧检定属性与对抗属性。
 * @returns {Object} key → 本地化标签
 */
export function getCheckAttrChoices() {
    return localizeConfig({
        ...CONFIG.XJZL.attributes,
        ...CONFIG.XJZL.skills,
        ...CONFIG.XJZL.arts
    });
}

export class XJZLCreatureData extends foundry.abstract.TypeDataModel {

    static defineSchema() {
        const fields = foundry.data.fields;

        // --- 检定型特性（豁免/对抗）子结构 ---
        // 字段契约与 XJZLMacros.requestSave / requestContest 的参数一一对应；
        // 发起端（creature-sheet）通过 buildCreature*Outcome 转换，不在此处存请求参数。
        // 一笔后果的伤害配置；value>0 才会生成实际后果
        const checkDamage = () => new fields.SchemaField({
            value: new fields.NumberField({ initial: 0, min: 0, label: "XJZL.Creature.Check.DamageValue" }),
            type: new fields.StringField({
                initial: "poison",
                choices: Object.keys(getCheckOutcomeTypes()),
                label: "XJZL.Wuxue.Moves.DamageType"
            }),
            isCrit: new fields.BooleanField({ initial: false }),
            applyCritDamage: new fields.BooleanField({ initial: true }),
            ignoreBlock: new fields.BooleanField({ initial: false }),
            ignoreDefense: new fields.BooleanField({ initial: false }),
            ignoreStance: new fields.BooleanField({ initial: false }),
            element: new fields.StringField({ initial: "none", choices: Object.keys(CONFIG.XJZL.elements) }),
            ignoreMinDamage: new fields.BooleanField({ initial: false })
        });

        // 一侧后果块：isContest=true 时额外携带野兽自身后果与恢复（对抗侧特有）
        const checkOutcome = (isContest) => new fields.SchemaField({
            // 结算卡上显示的描述文本（宏侧 successText/failureText 或 outcome.text）
            text: new fields.StringField({ initial: "" }),
            // 目标侧伤害/流失与状态；effects 存 CONFIG.statusEffects 的状态 ID
            damage: checkDamage(),
            effects: new fields.ArrayField(new fields.StringField(), { initial: [] }),
            ...(isContest ? {
                selfDamage: checkDamage(),
                selfEffects: new fields.ArrayField(new fields.StringField(), { initial: [] }),
                selfRecovery: new fields.SchemaField({
                    value: new fields.NumberField({ initial: 0, min: 0 }),
                    // 野兽只持久化 tili/rage，hp 恢复会被静默丢弃，默认与选项都限定这两项
                    type: new fields.StringField({
                        initial: "tili",
                        choices: Object.keys(getSelfRecoveryTypes())
                    })
                })
            } : {
                // 豁免特有：判定后解除检定者的架招（宏侧 removeStanceOnSuccess/Fail）
                removeStance: new fields.BooleanField({ initial: false })
            })
        });

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
                protection: new fields.NumberField({ initial: 0, min: 0, integer: true, label: "XJZL.Combat.Protection" }) // 防护阈值
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
                description: new fields.StringField(),
                // 是否为攻击型特性：勾选后可点击发起一次纯攻击
                isAttack: new fields.BooleanField({ initial: false, label: "XJZL.Creature.AbilityIsAttack" }),
                // 攻击型特性的固定伤害数值
                damage: new fields.NumberField({ initial: 0, min: 0, integer: true, label: "XJZL.Equipment.Damage" }),
                // 攻击型特性的伤害类型（同人物武学，下拉选择）
                damageType: new fields.StringField({
                    initial: "waigong",
                    choices: Object.keys(CONFIG.XJZL.damageTypes),
                    label: "XJZL.Wuxue.Moves.DamageType"
                }),
                // 检定型特性（豁免/对抗）：可与攻击段融合（先攻击，再按命中过滤发起请求卡）。
                // 结算完全复用 XJZLMacros 请求卡管线，数据模型只存配置。
                check: new fields.SchemaField({
                    enabled: new fields.BooleanField({ initial: false, label: "XJZL.Creature.Check.Enabled" }),
                    // save=目标掷骰过 DC；contest=双方对抗（野兽属性恒 0，强度由 attBonus 体现）
                    mode: new fields.StringField({ initial: "save", choices: ["save", "contest"], label: "XJZL.Creature.Check.Mode" }),
                    // 攻击+检定同时启用时生效：仅对本次攻击命中的目标发起检定
                    requireHit: new fields.BooleanField({ initial: false }),
                    save: new fields.SchemaField({
                        attr: new fields.StringField({
                            initial: "dingli",
                            choices: Object.keys(getCheckAttrChoices()),
                            label: "XJZL.Creature.Check.AttrLabel"
                        }),
                        dc: new fields.NumberField({ initial: 10, min: 0, integer: true, label: "XJZL.Creature.Check.DC" }),
                        // 预设优劣势（正=优）与加值，发起确认窗中可临场覆盖
                        level: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Creature.Check.Level" }),
                        bonus: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Creature.Check.Bonus" }),
                        success: checkOutcome(false),
                        fail: checkOutcome(false)
                    }),
                    contest: new fields.SchemaField({
                        attAttr: new fields.StringField({
                            initial: "liliang",
                            choices: Object.keys(getCheckAttrChoices()),
                            label: "XJZL.Creature.Check.AttAttr"
                        }),
                        defAttr: new fields.StringField({
                            initial: "liliang",
                            choices: Object.keys(getCheckAttrChoices()),
                            label: "XJZL.Creature.Check.DefAttr"
                        }),
                        attBonus: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Creature.Check.AttBonus" }),
                        defBonus: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Creature.Check.DefBonus" }),
                        // 发起者视角：win=野兽获胜时的后果，lose=野兽落败时的后果
                        win: checkOutcome(true),
                        lose: checkOutcome(true)
                    })
                })
            }))
        };
    }

    /**
     * @override 旧版 selfRecovery.type 默认 "hp"：野兽不持久化 hp（由 tili 派生），
     * 恢复会被静默丢弃；choices 收紧为体力/怒气后，存量非法键若不迁移，
     * 特性整元素写回（编辑器自动保存、卡片表单提交）会被字段校验拒绝。
     * 加载时统一迁到 tili，幂等且不动合法值。
     */
    static migrateData(source) {
        const abilities = source?.abilities;
        // 表单展开后可能是数组或数字键对象，两种形态都按条目遍历；null/缺失直接跳过
        if (!abilities || typeof abilities !== "object") return source;
        const valid = Object.keys(getSelfRecoveryTypes());
        for (const ability of Object.values(abilities)) {
            for (const side of ["win", "lose"]) {
                const recovery = ability?.check?.contest?.[side]?.selfRecovery;
                if (recovery && !valid.includes(recovery.type)) recovery.type = "tili";
            }
        }
        return source;
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

    /**
     * [接口兼容] 重新计算
     * 即使野兽不需要重算，也必须保留这个空方法，防止 Actor 调用报错
     */
    recalculate() {
        // 野兽逻辑简单，脚本修改数值后不需要复杂的二次计算，留空即可
        // 或者如果未来野兽也有复杂逻辑，可以在这里再次调用 prepareDerivedData
        // this.prepareDerivedData(); 
    }
}