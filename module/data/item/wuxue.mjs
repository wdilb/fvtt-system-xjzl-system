/**
 * 武学/招式 数据模型
 * ==========================================
 * 核心职责：
 * 1. 定义武学套路的基本信息 (品阶、门派)。
 * 2. 管理招式列表 (Moves)，每个招式都是一个独立的数据实体。
 * 3. 计算招式的等级、消耗和伤害面板。
 * ==========================================
 */
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
        choices: ["qi", "real", "feint", "stance", "counter", "ultimate"],
        label: "XJZL.Wuxue.Moves.Type"
      }),
      element: new fields.StringField({
        initial: "none",
        choices: ["taiji", "yin", "yang", "gang", "rou", "none"],
        label: "XJZL.Wuxue.Moves.Element"
      }),

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
      applyEffects: new fields.ArrayField(new fields.SchemaField({
        key: new fields.StringField({ required: true }), // 特效名称
        trigger: new fields.StringField({ initial: "hit", choices: ["hit", "use", "crit", "parry", "kill"] }),
        target: new fields.StringField({ initial: "target", choices: ["self", "target"] })
      })),

      // 招式脚本: 用于处理极其复杂的逻辑 (如: 自身血量<50%时伤害翻倍)
      // 这是一个 JS 代码块，在 Roll 的时候执行
      script: new fields.StringField({ label: "XJZL.Wuxue.Moves.Script" }),
      // 2. 招式执行脚本 (异步，用于演出和特殊逻辑)
      executionScript: new fields.StringField({ label: "XJZL.Wuxue.Moves.ExecutionScript" })

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
    // 逻辑与之前讨论的一致
    let thresholds = [];
    let feintCoef = 0; // 虚招系数

    if (this.category === "qinggong" || this.category === "zhenfa") {
      // 轻功/阵法: 一次性学会
      if (this.tier === 1) thresholds = [1000];
      else if (this.tier === 2) thresholds = [3000];
      else if (this.tier === 3) thresholds = [6000];
    } else {
      // 常规武学: 多层进阶
      // 注意：这里存储的是【累积】所需修为
      if (this.tier === 1) {
        thresholds = [0, 500, 1000]; // 1层(0), 2层(500), 3层(1000)
        feintCoef = 2; // 人级系数
      } else if (this.tier === 2) {
        thresholds = [500, 1500, 3000]; // 1层(500), 2层(1500)...
        feintCoef = 3; // 地级系数
      } else if (this.tier === 3) {
        thresholds = [1000, 3000, 6000, 10000]; // 4层(10000)
        feintCoef = 4; // 天级系数
      }
    }

    // 获取绝对上限
    const absoluteMax = thresholds[thresholds.length - 1];

    // 2. 遍历每个招式，计算状态
    for (const move of this.moves) {
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