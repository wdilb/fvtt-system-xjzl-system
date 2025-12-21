/**
 * 武学/招式 数据模型
 * ==========================================
 * 核心职责：
 * 1. 定义武学套路的基本信息 (品阶、门派)。
 * 2. 管理招式列表 (Moves)，每个招式都是一个独立的数据实体。
 * 3. 计算招式的等级、消耗和伤害面板。
 * ==========================================
 */
import { makeScriptEffectSchema } from "../common.mjs";
export class XJZLWuxueData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;

    // [Helper] 伤害/数值计算公式模板
    // 公式: 最终值 = (基础 + 成长 * (等级-1)) + Sum(属性 * 系数)
    const makeCalculationSchema = () => new fields.SchemaField({
      base: new fields.NumberField({ initial: 0, label: "XJZL.Wuxue.Calc.Base" }),
      growth: new fields.NumberField({ initial: 0, label: "XJZL.Wuxue.Calc.Growth" }), // 每级成长
      // 属性加成 (支持多个属性混合加成，如: 0.5*力量 + 0.3*内息)
      scalings: new fields.ArrayField(new fields.SchemaField({
        prop: new fields.StringField({ initial: "liliang", label: "XJZL.Wuxue.Calc.Prop" }),
        ratio: new fields.NumberField({ initial: 0.5, label: "XJZL.Wuxue.Calc.Ratio" })
      }), { label: "XJZL.Wuxue.Calc.Scalings" })
    });

    // [Helper] 招式结构定义 (Move Schema)
    // 这是数组中的每一项的数据结构
    const moveSchema = new fields.SchemaField({
      // --- 1. 索引与标识 ---
      id: new fields.StringField({ required: true, initial: () => foundry.utils.randomID() }),

      name: new fields.StringField({ required: true, initial: "新招式", label: "XJZL.Wuxue.Moves.Name" }),
      img: new fields.StringField({ required: true, initial: "icons/svg/sword.svg" }), // 招式独立图标

      // --- 2. 核心标签 ---
      type: new fields.StringField({
        initial: "real",
        choices: ["qi", "real", "feint", "stance", "counter"],
        label: "XJZL.Wuxue.Moves.Type"
      }),
      element: new fields.StringField({
        initial: "none",
        choices: ["taiji", "yin", "yang", "gang", "rou", "none"],
        label: "XJZL.Wuxue.Moves.Element"
      }),
      // 功能类型 (仅气招使用)
      // default=自动判断, heal=治疗流程, attack=攻击流程(即使是气招)
      actionType: new fields.StringField({
        initial: "default",
        choices: ["default", "heal", "attack"], 
        label: "XJZL.Wuxue.Moves.ActionType"
      }),
      // 新增绝招标记，把绝招从招式类别中分离出来，因为存在即是绝招也是气招的东西，哎
      isUltimate: new fields.BooleanField({ initial: false, label: "XJZL.Wuxue.Moves.IsUltimate" }),

      // 武器限制 (移动到招式层级)
      // 对应 Character.system.combat.weaponRanks 中的 key (sword, blade...)
      weaponType: new fields.StringField({ initial: "unarmed", label: "XJZL.Wuxue.Moves.WeaponType" }),
      // 文本描述限制 (如 "仅限重剑")，仅做显示，不自动化
      weaponSubtype: new fields.StringField({ label: "XJZL.Wuxue.Moves.WeaponSubtype" }),

      // --- 3. 描述与显示 ---
      description: new fields.HTMLField(),
      range: new fields.StringField({ initial: "2米", label: "XJZL.Wuxue.Moves.Range" }),
      targetInfo: new fields.StringField({ initial: "单体", label: "XJZL.Wuxue.Moves.Target" }),
      actionCost: new fields.StringField({ initial: "主要动作", label: "XJZL.Wuxue.Moves.ActionCost" }),

      // --- 4. 成长数据 ---
      // 招式独立升级，不依赖套路总等级
      level: new fields.NumberField({ min: 1, initial: 1, label: "XJZL.Wuxue.Moves.Level" }),
      xpInvested: new fields.NumberField({ min: 0, initial: 0, label: "XJZL.Neigong.XPInvested" }),
      // 该招式的修炼消耗系数
      xpCostRatio: new fields.NumberField({
        required: true, initial: 1, min: 0,
        label: "XJZL.Wuxue.Moves.XPCostRatio"
      }),

      // --- 进阶配置 (存在那种不是按照普通套路升级的武学，哎) ---
      // 用于处理“只有学会/没学会”、“特殊修为需求”等特例
      progression: new fields.SchemaField({
        // 模式: standard(按品阶自动), custom(自定义门槛)
        mode: new fields.StringField({ initial: "standard", choices: ["standard", "custom"] }),

        // 自定义门槛 (仅在 custom 模式下生效)
        // 例如: [5000] 表示 0-4999为未入门, 5000+为满级
        customThresholds: new fields.ArrayField(new fields.NumberField({ min: 0 }), { initial: [] }),

        // 境界映射 (Stat Equivalent Stage)
        // 用于解决"只有1级但视为精通"的问题。
        // 0=自动(等于当前level), 1=领悟, 2=掌握, 3=精通, 4=合一, 5=无
        mappedStage: new fields.NumberField({ initial: 0, choices: [0, 1, 2, 3, 4] })
      }),

      // 招式修为成分
      sourceBreakdown: new fields.SchemaField({
        general: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        specific: new fields.NumberField({ initial: 0, min: 0, integer: true })
      }),

      // --- 5. 数值配置 ---
      calculation: makeCalculationSchema(),

      // --- 6. 消耗配置 (数组形式) ---
      // 使用 ArrayField 存储每一级的消耗，方便填表
      // 例如: [10, 20, 30] 表示 1级耗10，2级耗20...
      costs: new fields.SchemaField({
        mp: new fields.ArrayField(new fields.NumberField({ integer: true }), { label: "XJZL.Wuxue.Cost.MP" }),
        rage: new fields.ArrayField(new fields.NumberField({ integer: true }), { label: "XJZL.Wuxue.Cost.Rage" }),
        hp: new fields.ArrayField(new fields.NumberField({ integer: true }), { label: "XJZL.Wuxue.Cost.HP" })
      }),

      // --- 7. 特效与脚本 ---
      // 这里我们不再搞复杂的 Schema，只存储“引用”

      // 附加特效列表: 存储要应用到目标身上的 ActiveEffect 的名称/ID
      // 逻辑: 攻击命中后，代码会在 Item.effects 里找同名特效，复制给目标
      // 不需要了，附加逻辑在scripts里完成，普通的交给AE处理

      // 以前: script (计算用), executionScript (执行用)
      // 现在: 统一放在 effects 数组里，通过 trigger 区分
      scripts: new fields.ArrayField(makeScriptEffectSchema(), {
        label: "XJZL.Item.ScriptList",
        initial: []
      }),

      // --- 7. 伤害类型 ---
      // 决定了是否需要进行命中检定，以及应用伤害时对抗哪种抗性
      damageType: new fields.StringField({
        initial: "waigong",
        label: "XJZL.Wuxue.Moves.DamageType",
        choices: Object.keys(CONFIG.XJZL.damageTypes) // 校验
      }),

    });

    return {
      // === 武学套路总纲 ===

      // 1. 分类与来源
      category: new fields.StringField({
        initial: "wuxue",
        choices: ["wuxue", "sanshou", "qinggong", "zhenfa"],
        label: "XJZL.Wuxue.Category"
      }),
      sect: new fields.StringField({ label: "XJZL.Wuxue.Sect" }),

      // 2. 核心规则属性
      // 1=人, 2=地, 3=天 (使用 XJZL.Tiers 本地化)
      tier: new fields.NumberField({ initial: 1, choices: [1, 2, 3], label: "XJZL.Wuxue.Tier" }),

      // 3. 描述与要求
      description: new fields.HTMLField({ label: "XJZL.Info.Bio" }),
      // 自动化说明 (Automation Note)
      // 用于告知玩家/GM：本武学的哪些特效已自动化，哪些需要手动修正
      automationNote: new fields.StringField({
        required: false,
        initial: "",
        label: "XJZL.Wuxue.AutomationNote",
        hint: "XJZL.Wuxue.AutomationNoteHint" // 提示语：例如“说明本武学的脚本覆盖范围”
      }),
      // 悟性要求等限制条件，仅作为文本提示，不强制自动化
      requirements: new fields.HTMLField({ label: "XJZL.Wuxue.Requirements" }),

      // 4. 招式列表 (最核心的数据)
      moves: new fields.ArrayField(moveSchema, { label: "XJZL.Wuxue.Moves.Label" })
    };
  }

  /**
   * 衍生数据计算
   * 核心职责：计算每个招式的当前等级、升级门槛、当前消耗
   */
  prepareDerivedData() {
    // 1. 获取当前武学品阶对应的 修为门槛表
    // 预设标准门槛表 (Standard Thresholds)
    let standardThresholds = [];
    let feintCoef = 0; // 虚招系数

    if (this.category === "qinggong" || this.category === "zhenfa") {
      // 轻功/阵法: 一次性学会
      if (this.tier === 1) standardThresholds = [1000];
      else if (this.tier === 2) standardThresholds = [3000];
      else if (this.tier === 3) standardThresholds = [6000];
    } else {
      // 常规武学: 多层进阶
      // 注意：这里存储的是【累积】所需修为
      if (this.tier === 1) {
        standardThresholds = [0, 500, 1000]; // 1层(0), 2层(500), 3层(1000)
        feintCoef = 2; // 人级系数
      } else if (this.tier === 2) {
        standardThresholds = [500, 1500, 3000]; // 1层(500), 2层(1500)...
        feintCoef = 3; // 地级系数
      } else if (this.tier === 3) {
        standardThresholds = [1000, 3000, 6000, 10000]; // 4层(10000)
        feintCoef = 4; // 天级系数
      }
    }

    // 2. 遍历每个招式，计算状态
    for (const move of this.moves) {
      let baseThresholds = [];

      // --- 门槛判定逻辑 ---
      if (move.progression.mode === "custom" && move.progression.customThresholds.length > 0) {
        // 使用自定义门槛
        baseThresholds = move.progression.customThresholds;
      } else {
        // 使用标准门槛
        baseThresholds = standardThresholds;
      }

      const ratio = move.xpCostRatio ?? 1;
      // 直接把所有门槛都乘以系数
      // 例如 [500, 1000] * 0.8 = [400, 800]
      const thresholds = baseThresholds.map(t => Math.floor(t * ratio));

      // 获取绝对上限
      const absoluteMax = thresholds.length > 0 ? thresholds[thresholds.length - 1] : 0;

      // A. 计算等级 (Level)
      let lvl = 0;
      // 倒序查找满足的门槛
      for (let i = thresholds.length - 1; i >= 0; i--) {
        if (move.xpInvested >= thresholds[i]) {
          lvl = i + 1; // 索引0对应1层
          break;
        }
      }
      // 特殊处理：如果连第0个门槛都没达到 (针对地/天级需前置修为)，则为0级(未领悟)
      if (move.xpInvested < thresholds[0]) lvl = 0;

      // 存入内存变量，方便前端读取
      move.computedLevel = lvl;
      move.maxLevel = thresholds.length;

      // --- 计算“等效等级” (Stat Stage) ---
      // 供 Actor 用来计算悟性加成和武器等级
      // 如果 mappedStage 是 5 (无)，则 effectiveStage 为 0 (不参与计算)
      // 如果 mappedStage 是 1-4 且已入门 (lvl>0)，则强制为该值
      // 否则使用实际等级
      if (move.progression.mappedStage === 5) {
        move.effectiveStage = 0;
      } else if (lvl > 0 && move.progression.mappedStage > 0) {
        move.effectiveStage = move.progression.mappedStage;
      } else {
        move.effectiveStage = lvl;
      }
      // B. 计算进度条数据 (Progress)
      // 结构: { current, max, pct, isMax }
      move.progress = { current: 0, max: 0, pct: 0, isMax: false, absoluteMax: absoluteMax };

      if (lvl === move.maxLevel) {
        move.progress.isMax = true;
        move.progress.pct = 100;
        move.progress.current = "MAX";
      } else {
        // 下一级目标
        const nextT = thresholds[lvl];
        // 当前级基准 (如果lvl=0, 基准是0)
        const prevT = lvl > 0 ? thresholds[lvl - 1] : 0;

        move.progress.max = nextT - prevT; // 本级需要填满的坑
        move.progress.current = move.xpInvested - prevT; // 当前填了多少

        if (move.progress.max > 0) {
          move.progress.pct = Math.min(100, Math.floor((move.progress.current / move.progress.max) * 100));
        }
      }

      // C. 计算当前消耗 (Snapshot)
      // 数组索引 = level - 1。如果未入门(level 0)，则显示第1级的消耗作为预览
      const costIndex = Math.max(0, lvl - 1);

      move.currentCost = {
        mp: move.costs.mp?.[costIndex] || 0,
        rage: move.costs.rage?.[costIndex] || 0,
        hp: move.costs.hp?.[costIndex] || 0
      };

      // 如果是虚招类型，计算基础值：层数 * 系数
      // 注意：如果未入门(lvl=0)，虚招值也为0
      move.baseFeint = (move.type === 'feint') ? (lvl * feintCoef) : 0;
    }
  }
}