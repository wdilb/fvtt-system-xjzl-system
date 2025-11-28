/**
 * 内功物品数据模型
 * 
 * 职责：
 * 1. 定义内功的三阶成长数据结构 (Schema)
 * 2. 根据投入的修为自动计算当前重数 (Derived Data)
 * 3. 汇总当前生效的属性加成，供 Actor 调用
 */
export class XJZLNeigongData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;

    // [Helper] 创建一个“阶段数据”的模板
    // 每个阶段都包含：5维属性加成 + 特效描述
    const makeStageSchema = (label) => new fields.SchemaField({
      // 属性加成 (填写该阶段生效的总数值)
      stats: new fields.SchemaField({
        liliang: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Neigong.BonusLiliang" }),
        shenfa: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Neigong.BonusShenfa" }),
        tipo: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Neigong.BonusTipo" }),
        neixi: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Neigong.BonusNeixi" }),
        shencai: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Neigong.BonusShencai" })
      }),
      // 该阶段的特效描述 (HTML富文本)
      effect: new fields.HTMLField({ label: "XJZL.Neigong.EffectConfig" }),

      // 被动脚本 (Passive Script)
      // 这是一段 JS 代码，会在 Actor 计算数据时执行
      // 上下文变量: actor, item, system (actor.system)
      script: new fields.StringField({ 
        required: false,
        initial: "", // 默认值为空，确保不自动生效
        label: "XJZL.Neigong.ScriptLabel", 
        hint: "XJZL.Neigong.ScriptHint"
      })
    }, { label: label });

    return {
      // === 1. 静态配置 (GM设定) ===
      
      // 品阶: 1=人, 2=地, 3=天
      tier: new fields.NumberField({ required: true, initial: 1, choices: [1, 2, 3], label: "XJZL.Neigong.Tier" }),
      
      // 内功属性: yin, yang, taiji
      element: new fields.StringField({ required: true, initial: "taiji", choices: ["yin", "yang", "taiji"], label: "XJZL.Neigong.Element" }),

      // 三个阶段的详细配置
      // GM 需要在这里分别填入“领悟时给多少属性”、“小成时给多少属性”
      config: new fields.SchemaField({
        stage1: makeStageSchema("XJZL.Neigong.Stage1"), // 领悟
        stage2: makeStageSchema("XJZL.Neigong.Stage2"), // 小成
        stage3: makeStageSchema("XJZL.Neigong.Stage3"), // 圆满
      }),
      
      // 圆满特效 (额外独立字段，仅圆满生效)
      masteryEffect: new fields.HTMLField({ label: "XJZL.Neigong.MasteryEffect" }),

      // === 2. 动态数据 (玩家存档) ===
      
      // 核心：已投入修为 (银行账户)
      xpInvested: new fields.NumberField({ required: true, min: 0, initial: 0, label: "XJZL.Neigong.XPInvested" }),
      
      // 状态：是否正在运行
      active: new fields.BooleanField({ initial: false, label: "XJZL.Neigong.Active" })
    };
  }

  /**
   * 衍生数据计算
   * 核心逻辑：xpInvested -> stage -> 提取对应的属性加成到内存中
   */
  prepareDerivedData() {
    // 1. 定义升级门槛 (累积投入量)
    // 规则参考：
    // 人级: 0(领) -> 1000(小) -> 3000(圆)
    // 地级: 1000(领) -> 4000(小) -> 10000(圆)
    // 天级: 2000(领) -> 12000(小) -> 30000(圆)
    
    let thresholds = [0, 0, 0];
    if (this.tier === 1) thresholds = [0, 1000, 3000];
    else if (this.tier === 2) thresholds = [1000, 4000, 10000];
    else if (this.tier === 3) thresholds = [2000, 12000, 30000];

    // 2. 计算当前阶段 (Stage)
    // 0: 未入门
    // 1: 领悟
    // 2: 小成
    // 3: 圆满
    let stage = 0;
    if (this.xpInvested >= thresholds[0]) stage = 1;
    if (this.xpInvested >= thresholds[1]) stage = 2;
    if (this.xpInvested >= thresholds[2]) stage = 3;
    
    this.stage = stage; // 存入内存

    // 3. 生成“当前生效数据” (Snapshot)
    // Actor 在计算属性时，直接读取 item.system.current.stats 即可，
    // 不需要 Actor 再写一遍判断逻辑。
    
    this.current = {
      stats: { liliang: 0, shenfa: 0, tipo: 0, neixi: 0, shencai: 0 },
      effect: "",         // 常驻特效文本
      masteryEffect: "",   // 圆满特效文本
      script: ""        //脚本
    };

    if (stage > 0) {
      // 根据阶段读取对应的 config
      const stageKey = `stage${stage}`;
      const stageConfig = this.config[stageKey];

      // 复制属性加成
      if (stageConfig) {
        this.current.stats = { ...stageConfig.stats };
        this.current.effect = stageConfig.effect;
      }
      
      // 如果圆满，激活圆满特效
      if (stage === 3) {
        this.current.masteryEffect = this.masteryEffect;
      }
    }

    // 4. 计算进度条 (UI用)
    this.progressData = {
      pct: 0,
      current: this.xpInvested,
      max: null,
      label: ""
    };

    // 显示逻辑：显示距离下一级的进度
    if (stage < 3) {
      const nextThreshold = thresholds[stage]; // 下一级的门槛 (注意 stage 从 0 或 1 开始对应)
      // 特殊情况：如果是未入门(0)，下一级是 thresholds[0]
      // 如果是领悟(1)，下一级是 thresholds[1]
      // 修正逻辑：
      // 阶段 0 (未入门) -> 目标 thresholds[0]
      // 阶段 1 (领悟)   -> 目标 thresholds[1]
      // 阶段 2 (小成)   -> 目标 thresholds[2]
      
      const target = thresholds[stage];
      const prev = stage > 0 ? thresholds[stage-1] : 0;
      
      this.progressData.max = target;
      // 计算百分比
      const den = target - prev;
      const num = this.xpInvested - prev;
      this.progressData.pct = den > 0 ? Math.min(100, Math.floor((num / den) * 100)) : 0;
    } else {
      this.progressData.pct = 100;
      this.progressData.label = "已圆满";
    }
  }
}