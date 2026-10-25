/**
 * 野兽/怪物 (Creature) 数据模型
 * ==========================================
 * 设计目标：
 * 1. 只持久化体力与战斗属性基础值；mod/total 在每次数据准备时重建。
 * 2. 接口兼容 (Duck Typing)：
 *    在内存中动态生成 stats, skills, martial 等结构，
 *    欺骗脚本引擎和战斗系统，使其认为这是一个"数值为0的侠客"。
 * ==========================================
 */
import { localizeConfig } from "../../utils/utils.mjs";

const COMBAT_KEYS = ["speed", "dodge", "hit", "protection"];

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

    /** 定义野兽存档结构；战斗属性只持久化 value，省略项由字段默认值补齐。 */
    static defineSchema() {
        const fields = foundry.data.fields;

        // 与人物属性相同：只保存 value，AE 修正与最终值不进入存档或编辑表单。
        const combatStat = (initial, label, min) => new fields.SchemaField({
            value: new fields.NumberField({ initial, integer: true, ...(min === undefined ? {} : { min }) })
        }, { label });

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
            // 未勾选时沿用所选状态自身的叠层设定；勾选后允许本次后果叠层。
            effectStackable: new fields.BooleanField({ initial: false }),
            effectCount: new fields.NumberField({ initial: 1, min: 1, integer: true }),
            effectMaxStacks: new fields.NumberField({ initial: 0, min: 0, integer: true }),
            effectDuration: new fields.SchemaField({
                value: new fields.NumberField({ initial: 0, min: 0 }),
                units: new fields.StringField({ initial: "rounds" }),
                expiry: new fields.StringField({ initial: "turnStart" })
            }),
            ...(isContest ? {
                selfDamage: checkDamage(),
                selfEffects: new fields.ArrayField(new fields.StringField(), { initial: [] }),
                selfEffectStackable: new fields.BooleanField({ initial: false }),
                selfEffectCount: new fields.NumberField({ initial: 1, min: 1, integer: true }),
                selfEffectMaxStacks: new fields.NumberField({ initial: 0, min: 0, integer: true }),
                selfEffectDuration: new fields.SchemaField({
                    value: new fields.NumberField({ initial: 0, min: 0 }),
                    units: new fields.StringField({ initial: "rounds" }),
                    expiry: new fields.StringField({ initial: "turnStart" })
                }),
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

            // === 2. 战斗属性基础值 ===
            combat: new fields.SchemaField({
                speed: combatStat(5, "XJZL.Combat.Speed"),
                dodge: combatStat(10, "XJZL.Combat.Dodge"),
                hit: combatStat(0, "XJZL.Combat.HitWaigong"),
                protection: combatStat(0, "XJZL.Combat.Protection", 0)
            }),

            // === 3. 描述信息 ===
            info: new fields.SchemaField({
                // 凡/猛/珍
                type: new fields.StringField({ initial: "fan", choices: ["fan", "meng", "zhen"], label: "XJZL.Creature.Type" }),
                difficulty: new fields.NumberField({ initial: 10, label: "XJZL.Creature.Difficulty" }), // 捕捉难度
                price: new fields.StringField({ initial: "", label: "XJZL.Equipment.Price" }), // 饲养价格
                size: new fields.StringField({ initial: "medium", choices: ["tiny", "small", "medium", "large", "huge"], label: "XJZL.Info.Height" }) // 体型
            }),

            description: new fields.HTMLField({ label: "XJZL.Info.Bio" }), // 描述

            // 技能列表 (简单的数组对象，不走 Item， 只存描述)
            abilities: new fields.ArrayField(new fields.SchemaField({
                name: new fields.StringField(),
                description: new fields.StringField(),
                automationNote: new fields.StringField({ initial: "" }),
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
                // 不单独发起豁免/对抗的状态；攻击型特性仍先完成命中（击飞、落地等由 automationNote 提示手动处理）
                directEffects: new fields.ArrayField(new fields.StringField(), { initial: [] }),
                // 未勾选时沿用状态自身的叠层设定；勾选后允许直接附加状态叠层。
                directEffectStackable: new fields.BooleanField({ initial: false }),
                directEffectCount: new fields.NumberField({ initial: 1, min: 1, integer: true }),
                directEffectMaxStacks: new fields.NumberField({ initial: 0, min: 0, integer: true }),
                directEffectDuration: new fields.SchemaField({
                    value: new fields.NumberField({ initial: 0, min: 0 }),
                    units: new fields.StringField({ initial: "rounds" }),
                    expiry: new fields.StringField({ initial: "turnStart" })
                }),
                // 检定型特性（豁免/对抗）：可与攻击段融合（先攻击，再按命中过滤发起请求卡）。
                // 结算完全复用 XJZLMacros 请求卡管线，数据模型只存配置。
                check: new fields.SchemaField({
                    enabled: new fields.BooleanField({ initial: false, label: "XJZL.Creature.Check.Enabled" }),
                    // save=目标掷骰过 DC；contest=双方对抗（野兽属性恒 0，强度由 attBonus 体现）
                    mode: new fields.StringField({ initial: "save", choices: ["save", "contest"], label: "XJZL.Creature.Check.Mode" }),
                    // 攻击+检定同时启用时生效：仅对本次攻击命中的目标发起检定
                    requireHit: new fields.BooleanField({ initial: false }),
                    afterDamage: new fields.BooleanField({ initial: false }),
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
     * 加载时幂等转换旧的纯数字战斗属性，并纠正不受支持的自身恢复资源。
     * 仅包装原有基础值，不推测或回减历史上可能已被写入的状态加成。
     * @param {object} source 野兽 system 源数据；允许局部更新、缺失 abilities。
     * @returns {object} 就地转换后的源数据。
     */
    static migrateData(source) {
        for (const key of COMBAT_KEYS) {
            if (Number.isFinite(source?.combat?.[key])) source.combat[key] = { value: source.combat[key] };
        }
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

    /** 每轮清零战斗修正；AE 只修改本轮内存，禁用或移除后自然撤销。 */
    prepareBaseData() {
        for (const key of COMBAT_KEYS) {
            this.combat[key].mod = 0;
            this.combat[key].total = this.combat[key].value;
        }
    }

    /**
     * 准备最终战斗数值，并填充人物战斗管线读取所需的零值兼容结构。
     */
    prepareDerivedData() {
        // ----------------------------------------------------
        // 1. 战斗属性映射 (Mapping)
        // ----------------------------------------------------
        const combat = this.combat;

        this.recalculate();

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
     * 从 value + mod 重算战斗最终值；可重复调用，不把修正累计到基础值。
     * 保留 speedTotal 等战斗管线入口，旧象王命中 flag 仍可作用于存量 AE。
     */
    recalculate() {
        const combat = this.combat;
        for (const key of COMBAT_KEYS) {
            const stat = combat[key];
            stat.total = Math.floor(stat.value + stat.mod);
        }
        const statuses = this.parent?.xjzlStatuses || {};
        if (statuses.unstable) combat.speed.total = Math.floor(combat.speed.total / 2);
        if (statuses.forceSpeedZero) combat.speed.total = 0;
        if (statuses.forceDodgeZero) combat.dodge.total = 0;
        combat.protection.total = Math.max(0, combat.protection.total);
        combat.hit.total += Number(statuses.beastHitBonus) || 0;
        combat.speedTotal = combat.speed.total;
        combat.dodgeTotal = combat.dodge.total;
        combat.protectionTotal = combat.protection.total;
        combat.hitWaigongTotal = combat.hit.total;
        combat.hitNeigongTotal = combat.hit.total;
    }
}
