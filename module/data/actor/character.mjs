/**
 * 玩家角色 (PC) 数据模型
 * ==========================================
 * 系统: xjzl-system
 * 版本: Foundry VTT V13
 * 
 * 核心职责:
 * 1. 定义数据库结构 (defineSchema)
 * 2. 初始化用于 AE 修改的临时数据 (prepareBaseData)
 * 3. 计算复杂的武侠规则衍生数据 (prepareDerivedData)
 * ==========================================
 */
export class XJZLCharacterData extends foundry.abstract.TypeDataModel {

  /**
   * ------------------------------------------------------------
   * 1. 数据库结构定义 (Schema)
   * ------------------------------------------------------------
   * 定义存储在 actors.db 中的字段。
   * 使用 foundry.data.fields 保证类型安全。
   */
  static defineSchema() {
    const fields = foundry.data.fields;

    // [Helper] 七维属性模板：包含 基础值(value)、分配值(assigned) 和 修正值(mod)
    // assigned: 自由属性点分配的数值
    const makeStatField = (labelKey) => new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 1, label: "XJZL.Stats.Base" }),
      assigned: new fields.NumberField({ required: true, integer: true, initial: 0, label: "XJZL.Stats.Assigned" }),
      mod: new fields.NumberField({ required: true, integer: true, initial: 0, label: "XJZL.Stats.Mod" })
    }, { label: labelKey });

    // [Helper] 资源池模板：包含 当前值(value)、最大值(max)、额外上限修正(bonus)
    const makeResourceField = (initialVal, maxVal, labelKey) => new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: initialVal, label: labelKey }),
      max: new fields.NumberField({ required: true, integer: true, initial: maxVal }),
      bonus: new fields.NumberField({ required: true, integer: true, initial: 0 })
    });

    // [Helper] 通用数值模板 (用于抗性、伤害修正、武器等级等)
    // 结构: { value: 基础值, mod: 修正值(AE), total: 最终值 }
    const makeModField = (initial = 0, label = "") => new fields.SchemaField({
      value: new fields.NumberField({ initial: initial, integer: true }),
      mod: new fields.NumberField({ initial: 0, integer: true }),
      total: new fields.NumberField({ initial: initial, integer: true })
    }, { label: label });

    return {
      // === A. 基础档案 (Info) ===
      // 记录角色的身份、外貌等 Roleplay 信息
      info: new fields.SchemaField({
        gender: new fields.StringField({ initial: "", label: "XJZL.Info.Gender" }),   // 性别
        zi: new fields.StringField({ initial: "", label: "XJZL.Info.Zi" }),           // 字
        title: new fields.StringField({ initial: "", label: "XJZL.Info.Title" }),     // 称号

        age: new fields.NumberField({ min: 0, initial: 18, integer: true, label: "XJZL.Info.Age" }), // 年龄
        height: new fields.StringField({ initial: "", label: "XJZL.Info.Height" }),   // 身高 
        weight: new fields.StringField({ initial: "", label: "XJZL.Info.Weight" }),   // 体重

        sect: new fields.StringField({ initial: "", label: "XJZL.Info.Sect" }),       // 门派 (ID或Key)
        background: new fields.StringField({ initial: "", label: "XJZL.Info.Background" }), // 身世背景
        personality: new fields.StringField({ initial: "", label: "XJZL.Info.Personality" }), // 性格特质

        bio: new fields.HTMLField({ label: "XJZL.Info.Bio" }),                        // 详细传记 (富文本)
        appearance: new fields.StringField({ label: "XJZL.Info.Appearance" })         // 外貌简述
      }),

      // === B. 七维属性 (Stats) ===
      // 核心骨架，全拼音命名。初始为1，变为负数触发死亡逻辑。
      stats: new fields.SchemaField({
        // 自由属性点 (可自由分配到除悟性外的属性上)
        freePoints: new fields.SchemaField({
          value: new fields.NumberField({ min: 0, initial: 0, integer: true }), // 初始赠送
          mod: new fields.NumberField({ initial: 0, integer: true }),           // AE/升级获得
          total: new fields.NumberField({ initial: 0, integer: true })          // 剩余可用
        }, { label: "XJZL.Stats.FreePoints" }),

        // 悟性特殊处理：包含玄关打通状态
        wuxing: new fields.SchemaField({
          value: new fields.NumberField({ required: true, integer: true, initial: 1, label: "XJZL.Stats.Base" }),
          mod: new fields.NumberField({ required: true, integer: true, initial: 0, label: "XJZL.Stats.Mod" })
        }, { label: "XJZL.Stats.Wuxing" }),

        liliang: makeStatField("XJZL.Stats.Liliang"), // 力量
        shenfa: makeStatField("XJZL.Stats.Shenfa"),   // 身法
        neixi: makeStatField("XJZL.Stats.Neixi"),     // 内息
        tipo: makeStatField("XJZL.Stats.Tipo"),       // 体魄
        qigan: makeStatField("XJZL.Stats.Qigan"),     // 气感
        shencai: makeStatField("XJZL.Stats.Shencai")  // 神采
      }),

      // === C. 修为池 (Cultivation) ===
      // 仅存储“存量”数据 (当前余额)。
      // 这里的数值 = 总获得量 - 已投入到内功/武学中的量
      cultivation: new fields.SchemaField({
        general: new fields.NumberField({ min: 0, initial: 0, label: "XJZL.Cultivation.General" }), // 通用修为
        neigong: new fields.NumberField({ min: 0, initial: 0, label: "XJZL.Cultivation.Neigong" }), // 专属内功修为
        wuxue: new fields.NumberField({ min: 0, initial: 0, label: "XJZL.Cultivation.Wuxue" }),     // 专属武学修为
        arts: new fields.NumberField({ min: 0, initial: 0, label: "XJZL.Cultivation.Arts" })        // 专属技艺修为
      }),

      // === D. 核心资源 (Resources) ===
      // 战斗中高频变动的数据
      resources: new fields.SchemaField({
        hp: makeResourceField(10, 10, "XJZL.Resources.HP"),    // 气血 (Health)
        mp: makeResourceField(0, 0, "XJZL.Resources.MP"),      // 内力 (Mana/Qi)
        rage: makeResourceField(0, 10, "XJZL.Resources.Rage"), // 怒气 (Rage) - 初始0, 上限10

        // 银两：只存余额。
        // 交易记录存储在 history 中，通过 type="item" 或 "resource" 区分
        silver: new fields.NumberField({ min: 0, initial: 0, label: "XJZL.Resources.Silver" }),

        satiety: makeResourceField(100, 100, "XJZL.Resources.Satiety"),// 饱食度 (Satiety): 上限100
        alcohol: makeResourceField(0, 0, "XJZL.Resources.Alcohol"),//酒量 (Alcohol): 当前值可超上限,上限在 prepareDerivedData 中计算 (等于体魄)，这里初始设为0
        morale: makeResourceField(0, 100, "XJZL.Resources.Morale"),// 士气 (Morale): 0-100
        // 杀戮 (Shalu): 0-100
        // 注意：达到100转杀孽的逻辑需要在 Actor._onUpdate 或 Item 逻辑中处理，这里只管存
        shalu: makeResourceField(0, 100, "XJZL.Resources.Shalu"),
        // 杀孽 (Shanie): 无上限整数
        shanie: new fields.NumberField({ min: 0, initial: 0, integer: true, label: "XJZL.Resources.Shanie" }),
        // 护体真气 (Huti): 无限叠加，优先扣除
        // 只需要存当前值，不需要 max
        huti: new fields.NumberField({ min: 0, initial: 0, integer: true, label: "XJZL.Resources.Huti" })
      }),

      // === E. 战斗属性 (Combat) ===
      // 这里的字段主要用于接收 Active Effects (如装备、Buff) 的修正值。
      // 最终面板值 (Total) 由 prepareDerivedData 计算。
      combat: new fields.SchemaField({
        // 1. 基础战斗属性 
        block: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.Block" }),       // 格挡修正
        kanpo: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.Kanpo" }),       // 看破修正
        xuzhao: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.XuZhao" }),     //虚招加值
        speed: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.Speed" }),       // 速度修正
        dodge: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.Dodge" }),       // 闪避修正
        initiative: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.Initiative" }), // 先攻修正

        // 2. 攻防复合属性 (前缀_拼音)
        def_waigong: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.DefWaigong" }), // 外防修正
        def_neigong: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.DefNeigong" }), // 内防修正
        hit_waigong: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.HitWaigong" }), // 外功命中修正
        hit_neigong: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.HitNeigong" }), // 内功命中修正
        crit_waigong: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.CritWaigong" }), // 外功暴击修正
        crit_neigong: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.CritNeigong" }), // 内功暴击修正

        // 3. 武器等级 (Weapon Ranks) - 移至 combat 下以支持 mod (AE)
        // 结构: { value: 基础(武学), mod: 修正(装备), total: 最终 }
        weaponRanks: new fields.SchemaField({
          sword: makeModField(0, "XJZL.Combat.Rank.Sword"),           // 剑
          blade: makeModField(0, "XJZL.Combat.Rank.Blade"),           // 刀
          staff: makeModField(0, "XJZL.Combat.Rank.Staff"),           // 棍 (长棍/长枪)
          dagger: makeModField(0, "XJZL.Combat.Rank.Dagger"),         // 匕首 (双刺/扇)
          hidden: makeModField(0, "XJZL.Combat.Rank.Hidden"),         // 暗器
          unarmed: makeModField(0, "XJZL.Combat.Rank.Unarmed"),       // 徒手 (拳/掌/腿)
          instrument: makeModField(0, "XJZL.Combat.Rank.Instrument"), // 乐器
          special: makeModField(0, "XJZL.Combat.Rank.Special")        // 奇门
        }, { label: "XJZL.Combat.WeaponRanks" }),

        // 4. 详细伤害修正 (Damage Bonuses)
        // 用于接收各类 Buff/装备 的 mod，替代旧的 weapon_dmg_bonus
        damages: new fields.SchemaField({
          global: makeModField(0, "XJZL.Combat.Dmg.Global"), // 全局伤害加成
          weapon: makeModField(0, "XJZL.Combat.Dmg.Weapon"), // 武器伤害加成
          normal: makeModField(0, "XJZL.Combat.Dmg.Normal"), // 普通攻击伤害加成
          skill: makeModField(0, "XJZL.Combat.Dmg.Skill"),  // 招式伤害加成
          yang: makeModField(0, "XJZL.Combat.Dmg.Yang"),  // 阳属性伤害加成
          yin: makeModField(0, "XJZL.Combat.Dmg.Yin"),    // 阴属性伤害加成
          gang: makeModField(0, "XJZL.Combat.Dmg.Gang"),   // 刚属性伤害加成
          rou: makeModField(0, "XJZL.Combat.Dmg.Rou"),    // 柔属性伤害加成
          taiji: makeModField(0, "XJZL.Combat.Dmg.Taiji")   // 太极伤害加成
        }, { label: "XJZL.Combat.Damages" }),

        // 5. 抗性 (Resistances)
        resistances: new fields.SchemaField({
          global: makeModField(0, "XJZL.Combat.Res.Global"),     // 全局抗性 (预留)
          bleed: makeModField(0, "XJZL.Combat.Res.Bleed"),      // 流血抗性 (基础=凝血)
          poison: makeModField(0, "XJZL.Combat.Res.Poison"),     // 毒素抗性 (基础=韧性)
          fire: makeModField(0, "XJZL.Combat.Res.Fire"),       // 火焰抗性
          mental: makeModField(0, "XJZL.Combat.Res.Mental"),      // 精神抗性
          liushi: makeModField(0, "XJZL.Combat.Res.Liushi")      // 流失抗性
        }, { label: "XJZL.Combat.Resistances" }),

        //6.消耗减少
        costs: new fields.SchemaField({
          neili: makeModField(0, "XJZL.Combat.Cost.Neili"),   // 内力消耗减少
          rage: makeModField(0, "XJZL.Combat.Cost.Rage") // 怒气消耗减少
        }, { label: "XJZL.Combat.ReduceCost" })

      }),

      // === F. 武学状态 (Martial Status) ===
      martial: new fields.SchemaField({
        active_neigong: new fields.StringField({ label: "XJZL.Resources.ActiveNeigong" }), // 当前运行内功的 UUID

        // 当前架招 (Stance)
        stance: new fields.StringField({ label: "XJZL.Martial.Stance" }),     // 存 Move ID (具体哪一招)
        stanceItemId: new fields.StringField({ label: "XJZL.Martial.StanceItemId" }), // 存 Item ID (所属武学)
        stanceActive: new fields.BooleanField({ initial: false }),                    // 架招是否激活
      }),

      // === G. 社交与声望 (Social) ===
      social: new fields.SchemaField({
        // 势力声望
        rep_chaoting: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Social.RepChaoting" }), // 朝廷
        rep_wulin: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Social.RepWulin" }),       // 武林

        // 道德指数
        xiayi: new fields.NumberField({ initial: 0, min: 0, integer: true, label: "XJZL.Social.Xiayi" }), // 侠义
        exing: new fields.NumberField({ initial: 0, min: 0, integer: true, label: "XJZL.Social.Exing" }), // 恶行

        // 处世态度 (重视/无视)
        attitude_chaoting: new fields.StringField({ initial: "none", label: "XJZL.Social.AttitudeChaoting" }),
        attitude_wulin: new fields.StringField({ initial: "none", label: "XJZL.Social.AttitudeWulin" }),
        attitude_shisu: new fields.StringField({ initial: "none", label: "XJZL.Social.AttitudeShisu" }),

        // 嗜好 (最多3个)
        shihao: new fields.ArrayField(new fields.StringField(), { max: 3, label: "XJZL.Info.Hobbies" }),

        // 关系网 (NPC好感度)
        relations: new fields.ArrayField(new fields.SchemaField({
          id: new fields.StringField(),   // 目标 Actor UUID
          name: new fields.StringField(), // 名字快照
          type: new fields.StringField(), // 关系类型 (friend/enemy)
          value: new fields.NumberField({ initial: 0 }) // 数值
        }), { label: "XJZL.Social.Relations" })
      }),

      // === 经脉系统 (jingmai) ===
      jingmai: new fields.SchemaField({
        // 1. 十二正经 (Standard 12)
        standard: new fields.SchemaField({
          // 第一关
          hand_shaoyin: new fields.BooleanField(),  // 手少阴心经（少冲）
          foot_shaoyin: new fields.BooleanField(),  // 足少阴肾经（涌泉）
          hand_shaoyang: new fields.BooleanField(), // 手少阳三焦经（关冲）
          foot_shaoyang: new fields.BooleanField(), // 足少阳胆经（足窍）
          // 第二关
          hand_jueyin: new fields.BooleanField(),   // 手厥阴心包经（中冲）
          foot_jueyin: new fields.BooleanField(),   // 足厥阴肝经（大敦）
          hand_yangming: new fields.BooleanField(), // 手阳明大肠经（商阳）
          foot_yangming: new fields.BooleanField(), // 足阳明胃经（厉兑）
          // 第三关
          hand_taiyin: new fields.BooleanField(),   // 手太阴肺经（少商）
          foot_taiyin: new fields.BooleanField(),   // 足太阴脾经（隐白）
          hand_taiyang: new fields.BooleanField(),  // 手太阳小肠经（少泽）
          foot_taiyang: new fields.BooleanField()   // 足太阳膀胱经（足通）
        }),

        // 2. 奇经八脉 (Extra 8)
        extra: new fields.SchemaField({
          du: new fields.BooleanField(),      // 督脉
          ren: new fields.BooleanField(),     // 任脉
          chong: new fields.BooleanField(),   // 冲脉
          dai: new fields.BooleanField(),     // 带脉
          yangwei: new fields.BooleanField(), // 阳维脉
          yinwei: new fields.BooleanField(),  // 阴维脉
          yangqiao: new fields.BooleanField(),// 阳跷脉
          yinqiao: new fields.BooleanField()  // 阴跷脉
        }),

        // 3. 生死玄关与突破记录
        xuanguan: new fields.SchemaField({
          // 是否打通生死玄关 (影响悟性上限、属性奖励)
          broken: new fields.BooleanField({ initial: false }),
          // 突破时选择加强的武学 UUID
          buffedItem: new fields.StringField()
        })
      }),

      // 手动修正组列表
      customModifiers: new fields.ArrayField(new fields.SchemaField({
        // ID: 用于稳定索引和未来扩展
        id: new fields.StringField({ required: true, initial: () => foundry.utils.randomID() }),

        // 来源名称 (如 "剧情Buff", "重伤")
        name: new fields.StringField({ required: true, initial: "新修正组", label: "XJZL.Modifier.Name" }),

        // 启用开关
        enabled: new fields.BooleanField({ initial: true, label: "XJZL.Modifier.Enabled" }),

        // 具体的修正条目列表
        changes: new fields.ArrayField(new fields.SchemaField({
          // 目标属性路径 (如 "stats.liliang.mod", "combat.speed")
          key: new fields.StringField({ required: true, label: "XJZL.Modifier.Key" }),
          // 修正数值 (支持正负数)
          value: new fields.NumberField({ required: true, initial: 0, label: "XJZL.Modifier.Value" })
        }))
      }), { label: "XJZL.Modifier.Label" }),

      // === 生平经历 (History / Audit Log) ===
      // 记录角色的所有关键变动。
      // 设计目标：支持 DM 查账 (审计模式) 和 玩家查看故事 (生平模式)
      history: new fields.ArrayField(new fields.SchemaField({
        // 1. 唯一标识符 (ID)
        // 用于技术上的索引，比如未来可能需要“删除某条错误日志”
        id: new fields.StringField({ required: true, initial: () => foundry.utils.randomID() }),

        // 2. 双重时间系统
        // realTime: 现实时间戳 (毫秒)。必填，用于默认的时间倒序排列。
        realTime: new fields.NumberField({ required: true, initial: Date.now, label: "XJZL.History.RealTime" }),
        // gameDate: 游戏内时间 (字符串)。选填，DM 或系统逻辑可以留空。
        gameDate: new fields.StringField({ initial: "", label: "XJZL.History.GameDate" }),

        // 3. 分类与筛选 (Filter Tags)
        // 这里的 choices 是存入数据库的值，前端显示时请使用 localize("XJZL.History.Type." + type)
        type: new fields.StringField({
          required: true,
          choices: ["resource", "item", "social", "text"],
          initial: "text",
          label: "XJZL.History.Type.Label"
        }),

        // importance: 重要性分级 (用于前端“防乱”过滤)
        // 0 = 琐事 (如: 买消耗品, 卖杂物, 小额修为变动) -> 默认隐藏，审计模式可见
        // 1 = 正常 (如: 获得新武学, 突破境界, 大额交易) -> 默认显示
        // 2 = 关键 (如: 结识关键NPC, DM手动发放奖励, 获得神兵) -> 高亮显示
        importance: new fields.NumberField({
          initial: 1,
          choices: [0, 1, 2],
          integer: true,
          label: "XJZL.History.Importance.Label"
        }),

        // 4. 内容描述
        // title: 标题
        title: new fields.StringField({ required: true, label: "XJZL.History.Title" }),
        // delta: 变动量字符串 (如 "+1", "-500", "+20")
        delta: new fields.StringField({ initial: "", label: "XJZL.History.Delta" }),
        // balance: (快照) 变动后的余额，仅对资源类有效，方便查账
        balance: new fields.StringField({ initial: "", label: "XJZL.History.Balance" }),
        // reason: 原因/备注 (如 "商店购买", "副本掉落", "闭关修炼")
        reason: new fields.StringField({ initial: "", label: "XJZL.History.Reason" }),

        // 5. 关联引用 (Reference)
        // 存储 Item UUID 或 Actor UUID。
        // 点击日志时，可以尝试获取该对象并显示详情 (如果对象还在身上的话)
        refId: new fields.StringField({ initial: "" })
      }))
    };
  }

  /**
   * ------------------------------------------------------------
   * 2. 基础数据准备 (prepareBaseData)
   * ------------------------------------------------------------
   * 在 Active Effects 应用之前运行。
   * 用于初始化那些"不存在于 Schema 中，但需要被 AE 修改"的数据结构。
   * FVTT的执行步骤：
   * Step 1: prepareBaseData() (初始化数据结构)
   * Step 2: applyActiveEffects() (应用装备/Buff的修改)
   * Step 3: prepareDerivedData() (计算最终结果)
   * 所以放在prepareBaseData中的属性可以被AE修改。
   */
  prepareBaseData() {
    // 初始化技能对象 (Skills)
    // 这样 Active Effect 就可以指向 "system.skills.qinggong.mod" 并修改它
    this.skills = {};

    // 完整的技能列表
    const skillList = [
      "jiaoli", "zhengtuo", "paozhi", "qinbao",    // 力量系
      "qianxing", "qiaoshou", "qinggong", "mashu", // 身法系
      "renxing", "biqi", "rennai", "ningxue",      // 体魄系
      "liaoshang", "chongxue", "lianxi", "duqi",   // 内息系
      "dianxue", "zhuizong", "tancha", "dongcha",  // 气感系
      "jiaoyi", "qiman", "shuofu", "dingli",       // 神采系
      // 悟性系技能
      "wuxue",    // 武学内功
      "jianding", // 物品鉴定
      "bagua",    // 江湖八卦
      "shili"     // 角色实力
    ];

    // 构建结构: { base: 0, mod: 0, total: 0 }
    for (const sk of skillList) {
      this.skills[sk] = {
        base: 0,  // 由属性计算得出 (在 derivedData)
        mod: 0,   // 由 Active Effects 填充
        total: 0  // 最终值
      };
    }

    // 初始化内功静态加成 (neigongBonus)
    // 这样我们就有了三个明确的数据来源：
    // 1. value (基础)
    // 2. mod (装备/Buff/脚本)
    // 3. neigongBonus (内功静态加成)
    for (const [key, stat] of Object.entries(this.stats)) {
      if (key === 'freePoints') continue;
      // 初始化 neigongBonus，防止后续计算 NaN
      stat.neigongBonus = 0;
    }

    // 初始化衍生容器，防止访问 undefined
    if (!this.cultivation) this.cultivation = {};
    this.cultivation.wuxingBonus = 0;  // 存储计算后的悟性加成
    // 武器等级现在移到了 combat.weaponRanks，这里不需要初始化了
  }

  /**
   * ------------------------------------------------------------
   * 3. 衍生数据计算 (prepareDerivedData)
   * ------------------------------------------------------------
   * 在 Active Effects 应用之后运行。
   * 负责处理所有复杂的武侠逻辑计算。
   * 
   * 为了支持“脚本依赖最终属性，且脚本能修正最终属性”的双重需求，
   * 我们将原来的大函数拆分为四个子步骤：
   * 1. _prepareStatsAndCultivation: 遍历物品，叠加静态加成 (只运行一次！)
   * 2. _calculateStatsTotals: 计算 Total = Value + Assigned + Mod (可重复运行)
   * 3. _prepareSkills: 计算技能 (可重复运行)
   * 4. _prepareCombatAndResources: 计算 HP/战斗/抗性/伤害 (可重复运行)
   * 
   * Actor 可以在运行脚本后，手动调用 recalculate() 来刷新数据。
   */
  prepareDerivedData() {
    this._applyCustomModifiers(); //应用手动修正 (最优先)
    this._prepareStatsAndCultivation(); // 步骤A: 静态累加 (Pass 1 独有)
    this._calculateStatsTotals();       // 步骤B: 计算总值
    this._prepareSkills();              // 步骤C: 技能
    this._prepareCombatAndResources();  // 步骤D: 资源与战斗
  }

  /**
   * [公开接口] 重新计算衍生数据
   * 供 Actor 在执行完内功动态脚本 (修改了 mod) 后调用。
   * 
   * 注意：这里【不】调用 _prepareStatsAndCultivation，
   * 从而保证内功的静态加成不会被重复叠加。
   */
  recalculate() {
    this._calculateStatsTotals();      // 重新计算 Total
    this._prepareSkills();             // 重新计算技能
    this._prepareCombatAndResources(); // 重新计算资源与战斗
  }

  /**
   * 应用手动修正逻辑
   * 遍历数组，修改内存中的 this (即 system)
   */
  _applyCustomModifiers() {
    const groups = this.customModifiers || [];

    for (const group of groups) {
      // 1. 如果整组被禁用，直接跳过
      if (!group.enabled) continue;

      for (const change of group.changes) {
        // 安全检查
        if (!change.key) continue;

        // 2. 获取当前值 (基于 this，即 system)
        // 这个值是 prepareBaseData 初始化后的值 (包含 AE 的修改)
        const current = foundry.utils.getProperty(this, change.key);

        // 3. 累加修正
        // 仅对数值型属性生效，防止错误的 Key 导致 NaN 或报错
        if (typeof current === "number") {
          foundry.utils.setProperty(this, change.key, current + change.value);
        }
      }
    }
  }

  /**
   * [内部步骤 A] 计算境界、武器等级(Base)、叠加内功静态属性
   * 【只执行一次】
   * 累加型操作 (+=)
   */
  _prepareStatsAndCultivation() {
    const stats = this.stats;
    const actor = this.parent; // 获取 Actor 实例以访问 Items
    const combat = this.combat;

    // =======================================================
    // 逻辑一：遍历 Items 计算 [境界]、[悟性加成]、[武器等级]
    // =======================================================

    let maxRealmLevel = 0; // 最高境界 (0-7)
    let wuxingBonus = 0;   // 悟性额外加成点数

    // 武器等级的“基础值”暂存 (不直接写 Total，因为 Total 还需要加 Mod)
    const rankBases = {};

    // 武器积分计数器 { "blade": { t1: 0, t2: 0, t3: 0 } }
    const weaponCounts = {};

    // 悟性加成计数器 (受人数限制)
    let wuxingHumanCount = 0; // 人级精通数
    let wuxingEarthCount = 0; // 地级精通数

    if (actor) {
      // 优化了写法，fvtt会自动将物品按类型索引到 actor.itemTypes，性能更好
      const neigongs = actor.itemTypes.neigong || [];
      for (const item of neigongs) {
        // 自动应用属性加成 (仅当内功正在运行 active=true 时)
        if (item.system.active) {
          const bonuses = item.system.current.stats; // 直接读取我们在 Item 里算好的 current

          // 累加到 Actor 的 neigongBonus 上 (分离 mod 字段)
          // 注意：这里我们修改的是 stats.xxx.neigongBonus
          if (bonuses) {
            stats.liliang.neigongBonus = (stats.liliang.neigongBonus || 0) + bonuses.liliang;
            stats.shenfa.neigongBonus = (stats.shenfa.neigongBonus || 0) + bonuses.shenfa;
            stats.tipo.neigongBonus = (stats.tipo.neigongBonus || 0) + bonuses.tipo;
            stats.neixi.neigongBonus = (stats.neixi.neigongBonus || 0) + bonuses.neixi;
            stats.qigan.neigongBonus = (stats.qigan.neigongBonus || 0) + bonuses.qigan;
            stats.shencai.neigongBonus = (stats.shencai.neigongBonus || 0) + bonuses.shencai;
          }
        }

        // ---  圆满加成 (Mastery Bonus) ---
        // 只要达到 Stage 3 (圆满)，无论是否运功，都永久生效
        // 我们直接读取 item.system.masteryStats
        if (item.system.stage >= 3 && item.system.masteryChanges) {
          for (const change of item.system.masteryChanges) {
            if (!change.key || !change.value) continue;

            // 1. 读取 Actor 当前属性值 (可能是 0)
            // 例如 key = "system.stats.liliang.mod"
            // 注意：Foundry 的 DataModel 中，this 就是 system，所以我们去掉 "system." 前缀
            let propPath = change.key;
            if (propPath.startsWith("system.")) {
              propPath = propPath.substring(7); // 去掉 "system."
            }

            // 2. 获取当前值
            const currentVal = foundry.utils.getProperty(this, propPath) || 0;

            // 3. 累加数值
            // 注意：这里修改的是 this (即 system)，
            // 因为 mod 属性在 prepareBaseData 里已经被重置为 0，所以这里累加是安全的
            foundry.utils.setProperty(this, propPath, currentVal + change.value);
          }
        }
        // tier: 1(人), 2(地), 3(天)
        // stage: 1(领), 2(小/掌), 3(圆/精), 4(合)
        const tier = item.system.tier || 1;
        const stage = item.system.stage || 1;
        let realm = 0;

        // 境界判定规则
        if (tier === 1) { // 人级
          if (stage === 1) realm = 1;
          if (stage === 2) realm = 2;
          if (stage >= 3) realm = 3;
        } else if (tier === 2) { // 地级
          if (stage === 1) realm = 3;
          if (stage === 2) realm = 4;
          if (stage >= 3) realm = 5;
        } else if (tier === 3) { // 天级
          if (stage === 1) realm = 5;
          if (stage === 2) realm = 6;
          if (stage >= 3) realm = 7;
        }
        // 取最高境界
        if (realm > maxRealmLevel) maxRealmLevel = realm;
      }

      const wuxues = actor.itemTypes.wuxue || [];
      for (const item of wuxues) {
        const tier = item.system.tier || 1;
        const moves = item.system.moves || [];
        // 遍历每一招
        for (const move of moves) {
          // 读取 effectiveStage 不再读取computedLevel
          // 如果 mappedStage=5，effectiveStage 会是 0，这里 stage=0，后续 if (stage >= 2) 不会通过，完美忽略
          const stage = move.effectiveStage || 0;
          const wType = move.weaponType; // 武器类型

          if (wType && wType !== 'none') { //确实存在不带武器类型的招式，哎
            // 初始化计数器
            if (!weaponCounts[wType]) weaponCounts[wType] = { t1: 0, t2: 0, t3: 0 };

            // 1. 统计悟性加成 (需达到 精通/Stage>=3)
            if (stage >= 3) {
              if (tier === 1) wuxingHumanCount++;
              if (tier === 2) wuxingEarthCount++;
              if (tier === 3) wuxingBonus += 1; // 天级精通 +1
            }
            if (stage >= 4 && tier === 3) wuxingBonus += 1; // 天级合一 +1

            // 2. 统计武器积分 (Tier 1/2/3 分组计数)
            // 梯度1: 掌握(Stage>=2)
            if (stage >= 2) weaponCounts[wType].t1++;

            // 梯度2: 精通(Stage>=3) 且 地级以上
            if (stage >= 3 && tier >= 2) weaponCounts[wType].t2++;

            // 梯度3: 合一(Stage>=4) 且 天级
            if (stage >= 4 && tier >= 3) weaponCounts[wType].t3++;
          }
        }
      }

    }

    // --- 结算：境界与悟性 ---

    // 1. 设置当前境界 (内存值)
    this.cultivation.realmLevel = maxRealmLevel;

    // 2. 计算悟性总加成
    wuxingBonus += maxRealmLevel; // 境界加成 (1级+1)
    wuxingBonus += Math.min(wuxingHumanCount, 10); // 人级上限 10
    wuxingBonus += Math.min(wuxingEarthCount, 10); // 地级上限 10
    this.cultivation.wuxingBonus = wuxingBonus;

    // =======================================================
    // 逻辑二：结算武器等级基础值 (Weapon Ranks Base)
    // =======================================================

    for (const [wType, counts] of Object.entries(weaponCounts)) {
      let rank = 0;
      // 梯度1 (1-4级): 只要掌握就算，上限 4
      const r1 = Math.min(counts.t1, 4);
      // 梯度2 (5-8级): 地/天级精通，上限 4
      const r2 = Math.min(counts.t2, 4);
      // 梯度3 (9+级): 天级合一，无上限
      const r3 = counts.t3;

      // 总等级 = 各梯度之和
      rank = r1 + r2 + r3;
      rankBases[wType] = rank;
    }

    // 将计算出的 Base 填入 combat.weaponRanks.value
    // 这样在后续步骤中就能计算 Total = Value(Base) + Mod(AE)
    for (const key of Object.keys(combat.weaponRanks)) {
      combat.weaponRanks[key].value = rankBases[key] || 0;
    }
  }

  /**
   * [内部步骤 B] 计算七维属性最终值 (Totals)
   * 【可重复执行】
   * 职责：覆盖型操作 (=)
   */
  _calculateStatsTotals() {
    const stats = this.stats;
    const jingmai = this.jingmai;
    const wuxingBonus = this.cultivation.wuxingBonus || 0; // 读取 A 步骤存的值

    // ===========================================
    // 1. 计算经脉提供的自由属性点
    // ===========================================
    let jingmaiFreePoints = 0;
    const s = jingmai.standard;
    const x = jingmai.xuanguan;

    // 第一关 (每个 +5)
    if (s.hand_shaoyin) jingmaiFreePoints += 5;
    if (s.foot_shaoyin) jingmaiFreePoints += 5;
    if (s.hand_shaoyang) jingmaiFreePoints += 5;
    if (s.foot_shaoyang) jingmaiFreePoints += 5;

    // 第二关 (每个 +10)
    if (s.hand_jueyin) jingmaiFreePoints += 10;
    if (s.foot_jueyin) jingmaiFreePoints += 10;
    if (s.hand_yangming) jingmaiFreePoints += 10;
    if (s.foot_yangming) jingmaiFreePoints += 10;

    // 第三关 (每个 +20)
    if (s.hand_taiyin) jingmaiFreePoints += 20;
    if (s.foot_taiyin) jingmaiFreePoints += 20;
    if (s.hand_taiyang) jingmaiFreePoints += 20;
    if (s.foot_taiyang) jingmaiFreePoints += 20;

    // 生死玄关突破 (自由属性 +100)
    if (x.broken) jingmaiFreePoints += 100;

    // ===========================================
    // 2. 处理任督二脉的全属性加成 (这里只处理 Mod，不处理 Value)
    // ===========================================
    const e = jingmai.extra;
    let allStatBonus = 0;
    // 督脉/任脉 基础全属性+10
    if (e.du) allStatBonus += 10;
    if (e.ren) allStatBonus += 10;

    if (allStatBonus > 0) {
      for (const [key, stat] of Object.entries(stats)) {
        if (key === 'wuxing' || key === 'freePoints') continue;
        stat.mod = (stat.mod || 0) + allStatBonus;
      }
    }

    // ===========================================
    // 3. 计算悟性 (含玄关上限逻辑)
    // ===========================================
    const wuxingBase = stats.wuxing.value || 0;
    const wuxingMod = stats.wuxing.mod || 0;
    const wuxingTotal = wuxingBase + wuxingMod + wuxingBonus;

    // 上限逻辑: 读取 jingmai.xuanguan.broken
    const wuxingLimit = x.broken ? 40 : 30;
    stats.wuxing.total = Math.min(wuxingTotal, wuxingLimit);

    // ===========================================
    // 4. 计算剩余自由属性点
    // ===========================================
    let totalAssigned = 0;
    for (const [key, stat] of Object.entries(stats)) {
      if (key === 'wuxing' || key === 'freePoints') continue;
      totalAssigned += (stat.assigned || 0);
    }
    // 剩余点数 = (初始 + AE + 经脉赠送) - 已分配
    const freePool = (stats.freePoints.value || 0) + (stats.freePoints.mod || 0) + jingmaiFreePoints;
    stats.freePoints.total = Math.max(0, freePool - totalAssigned);

    // ===========================================
    // 5. 处理其他六维属性 Total
    // ===========================================
    for (const [key, stat] of Object.entries(stats)) {
      if (key === 'wuxing' || key === 'freePoints') continue;

      // Total = Base + Assigned + Mod + NeigongBonus
      // mod: AE修正 + (如果有)脚本动态修正
      // neigongBonus: 内功静态修正
      stat.total = (stat.value || 0) + (stat.assigned || 0) + (stat.mod || 0) + (stat.neigongBonus || 0);

      // TODO 属性小于0 死亡
    }
  }

  /**
   * [内部步骤 C] 计算技能 (Skills)
   * 【可重复执行】
   * 依赖：stats.total
   */
  _prepareSkills() {
    // 快捷引用 (S for Stats) - 使用已计算好的 total
    const stats = this.stats;
    const S = {
      wuxing: stats.wuxing.total,
      liliang: stats.liliang.total,
      shenfa: stats.shenfa.total,
      neixi: stats.neixi.total,
      tipo: stats.tipo.total,
      qigan: stats.qigan.total,
      shencai: stats.shencai.total
    };

    // =======================================================
    // 计算属性技能 (Skills)
    // 此时 mod 字段已被 AE 填充
    // =======================================================
    const calcSkill = (key, statVal, isFlat = false) => {
      const skill = this.skills[key];
      // 防止重算时没有初始化
      if (!skill) return;
      // 悟性系直接等于属性值，其他系除以 10
      skill.base = isFlat ? statVal : Math.floor(statVal / 10);
      skill.total = skill.base + (skill.mod || 0); // mod 来自 AE
    };

    // 执行计算
    // 力量系
    calcSkill("jiaoli", S.liliang); calcSkill("zhengtuo", S.liliang); calcSkill("paozhi", S.liliang); calcSkill("qinbao", S.liliang);
    // 身法系
    calcSkill("qianxing", S.shenfa); calcSkill("qiaoshou", S.shenfa); calcSkill("qinggong", S.shenfa); calcSkill("mashu", S.shenfa);
    // 体魄系
    calcSkill("renxing", S.tipo); calcSkill("biqi", S.tipo); calcSkill("rennai", S.tipo); calcSkill("ningxue", S.tipo);
    // 内息系
    calcSkill("liaoshang", S.neixi); calcSkill("chongxue", S.neixi); calcSkill("lianxi", S.neixi); calcSkill("duqi", S.neixi);
    // 气感系
    calcSkill("dianxue", S.qigan); calcSkill("zhuizong", S.qigan); calcSkill("tancha", S.qigan); calcSkill("dongcha", S.qigan);
    // 神采系
    calcSkill("jiaoyi", S.shencai); calcSkill("qiman", S.shencai); calcSkill("shuofu", S.shencai); calcSkill("dingli", S.shencai);
    // 悟性系
    calcSkill("wuxue", S.wuxing, true); calcSkill("jianding", S.wuxing, true); calcSkill("bagua", S.wuxing, true); calcSkill("shili", S.wuxing, true);
  }

  /**
   * [内部步骤 D] 计算资源与战斗面板
   * 【可重复执行】
   * 依赖：stats.total, skills.total
   */
  _prepareCombatAndResources() {
    const jingmai = this.jingmai;
    const s = jingmai.standard;
    const e = jingmai.extra;
    const x = jingmai.xuanguan;
    const stats = this.stats;
    const combat = this.combat;
    const resources = this.resources;

    // 快捷引用
    const S = {
      liliang: stats.liliang.total,
      shenfa: stats.shenfa.total,
      neixi: stats.neixi.total,
      tipo: stats.tipo.total,
      qigan: stats.qigan.total,
      shencai: stats.shencai.total,
      renxing: this.skills.renxing.total, // 韧性
      ningxue: this.skills.ningxue.total  // 凝血
    };

    // 1. 经脉资源加成 (HP/MP)
    // ==========================

    // =======================================================
    // 初始化临时变量 (Bonuses)
    // 每次函数运行时，这些变量都会归零，确保不会重复叠加
    // =======================================================
    // 资源类
    let hpAdd = 0;
    let mpAdd = 0;

    // 战斗属性类 (用于暂存经脉带来的数值变化)
    const bonuses = {
      // 基础
      block: 0, kanpo: 0, xuzhao: 0, speed: 0, dodge: 0, initiative: 0,
      // 攻防
      defWaigong: 0, defNeigong: 0, hitWaigong: 0, hitNeigong: 0,
      critWaigong: 0, critNeigong: 0,
      // 伤害
      skillDmg: 0, yang: 0, yin: 0, gang: 0, rou: 0
    };

    // =======================================================
    // 2. 累加经脉效果 (只修改临时变量)
    // =======================================================

    // --- 第一关 ---
    if (s.hand_shaoyin) { hpAdd += 10; bonuses.critWaigong -= 1; }              // 手少阴心经: 气血+10, 外功暴击骰-1
    if (s.foot_shaoyin) { mpAdd += 5; bonuses.block += 5; }                    // 足少阴肾经: 内力+5, 格挡值+5
    if (s.hand_shaoyang) { hpAdd += 10; bonuses.hitWaigong += 5; bonuses.hitNeigong += 5; }               // 手少阳三焦经: 气血+10, 命中+5
    if (s.foot_shaoyang) { mpAdd += 5; bonuses.speed += 1; bonuses.initiative += 1; } // 足少阳胆经: 内力+5, 速度+1, 先攻+1

    // --- 第二关 ---
    if (s.hand_jueyin) { hpAdd += 30; bonuses.dodge += 5; }                    // 手厥阴心包经: 气血+30, 闪避+5
    if (s.foot_jueyin) { mpAdd += 15; bonuses.skillDmg += 5; }                 // 足厥阴肝经: 内力+15, 招式伤害+5
    if (s.hand_yangming) { hpAdd += 30; bonuses.defWaigong += 5; bonuses.defNeigong += 5; } // 手阳明大肠经: 气血+30, 内外防御+5
    if (s.foot_yangming) { mpAdd += 15; bonuses.critNeigong -= 2; }              // 足阳明胃经: 内力+15, 内功暴击骰-2

    // --- 第三关 ---
    if (s.hand_taiyin) { // 手太阴肺经: 气血+60, 外暴-1, 内暴-2, 命中+10
      hpAdd += 60; bonuses.critWaigong -= 1; bonuses.critNeigong -= 2; bonuses.hitWaigong += 10; bonuses.hitNeigong += 10;
    }
    if (s.foot_taiyin) { // 足太阴脾经: 内力+30, 先攻+5, 闪避+10, 虚招+1
      mpAdd += 30; bonuses.initiative += 5; bonuses.dodge += 10; bonuses.xuzhao += 1;
    }
    if (s.hand_taiyang) { // 手太阳小肠经: 气血+60, 外暴-1, 内暴-2, 招式伤害+10
      hpAdd += 60; bonuses.critWaigong -= 1; bonuses.critNeigong -= 2; bonuses.skillDmg += 10;
    }
    if (s.foot_taiyang) { // 足太阳膀胱经: 内力+30, 速度+2, 格挡+10, 看破+1
      mpAdd += 30; bonuses.speed += 2; bonuses.block += 10; bonuses.kanpo += 1;
    }

    // --- 奇经八脉 ---
    if (e.chong) hpAdd += 200; // 冲脉: 气血上限+200
    if (e.dai) bonuses.block += 40; // 带脉: 格挡值+40

    // 阳维: 阳/刚 +20
    if (e.yangwei) { bonuses.yang += 20; bonuses.gang += 20; }
    // 阴维: 阴/柔 +20
    if (e.yinwei) { bonuses.yin += 20; bonuses.rou += 20; }

    // 阳跷: 速度+1, 先攻+5, 暴击-1
    if (e.yangqiao) { bonuses.speed += 1; bonuses.initiative += 5; bonuses.critWaigong -= 1; }
    // 阴跷: 速度+1, 闪避+5, 暴击-1
    if (e.yinqiao) { bonuses.speed += 1; bonuses.dodge += 5; bonuses.critWaigong -= 1; }

    // --- 生死玄关 ---
    if (x.broken) {
      hpAdd += 100; mpAdd += 100;
      bonuses.block += 100;
      bonuses.kanpo += 3; //看破+3
      bonuses.xuzhao += 3; //虚招+3
    }

    // =======================================================
    // 计算资源与战斗面板 (Combat & Resources)
    // =======================================================

    // 1. 资源上限计算 (Resource Max)
    // ------------------------------------
    // HP = 体魄*4 + 力量*1 + 额外 + 经脉加成(Temp)
    resources.hp.max = Math.floor(S.tipo * 4 + S.liliang * 1 + (resources.hp.bonus || 0) + hpAdd);
    // MP = 内息*1 + 额外
    resources.mp.max = Math.floor(S.neixi * 1 + (resources.mp.bonus || 0) + mpAdd);
    // 怒气上限固定
    resources.rage.max = 10;
    // 酒量 = 体魄
    resources.alcohol.max = S.tipo;


    // 2. 抗性计算 (Resistances)
    // ------------------------------------
    const res = combat.resistances;
    // 毒素抗性: 基础(韧性) + Mod
    res.poison.total = S.renxing + (res.poison.mod || 0);
    // 流血抗性: 基础(凝血) + Mod
    res.bleed.total = S.ningxue + (res.bleed.mod || 0);
    // 其他抗性: 基础0 + Mod
    res.fire.total = 0 + (res.fire.mod || 0);
    res.mental.total = 0 + (res.mental.mod || 0);
    res.global.total = 0 + (res.global.mod || 0);

    // 3. 武器等级修正与伤害计算 (Weapon Ranks & Dmg)
    // ------------------------------------
    let maxGenericDmgBonus = 0;

    for (const [key, rankData] of Object.entries(combat.weaponRanks)) {
      // Total = Base(武学计算) + Mod(AE)
      rankData.total = (rankData.value || 0) + (rankData.mod || 0);
      const rank = rankData.total;

      // 伤害加成逻辑 (断层式暴涨: 4级=4, 5级=10, 9级=27)
      let dmg = 0;
      if (rank <= 4) {
        dmg = rank * 1;
      } else if (rank <= 8) {
        dmg = rank * 2;
      } else {
        dmg = rank * 3;
      }

      // 如果这个武器伤害加成比通用的高，记录下来 (通用战斗面板显示用)
      if (dmg > maxGenericDmgBonus) maxGenericDmgBonus = dmg;
    }

    // 4. 伤害修正汇总 (Damage Bonuses)
    // ------------------------------------
    const dmg = combat.damages;
    // Total = Value(基础) + Mod(AE)
    dmg.global.total = (dmg.global.value || 0) + (dmg.global.mod || 0);

    // Weapon Damage Total 在这里主要作为面板参考值 (取最大值 + 修正)
    dmg.weapon.total = maxGenericDmgBonus + (dmg.weapon.mod || 0);

    // 公式: Value + Mod(AE) + Bonus(Jingmai)

    dmg.skill.total = (dmg.skill.value || 0) + (dmg.skill.mod || 0) + bonuses.skillDmg;
    dmg.yang.total = (dmg.yang.value || 0) + (dmg.yang.mod || 0) + bonuses.yang;
    dmg.gang.total = (dmg.gang.value || 0) + (dmg.gang.mod || 0) + bonuses.gang;
    dmg.yin.total = (dmg.yin.value || 0) + (dmg.yin.mod || 0) + bonuses.yin;
    dmg.rou.total = (dmg.rou.value || 0) + (dmg.rou.mod || 0) + bonuses.rou;

    // 其他类型 (太极和平A伤害，目前没有经脉加成)
    for (const k of ["taiji", "normal"]) {
      dmg[k].total = (dmg[k].value || 0) + (dmg[k].mod || 0);
    }

    // 5. 战斗属性计算 (Combat Stats)
    // ------------------------------------
    // 基础

    // 架招逻辑处理 (Stance Logic)
    let stanceBlockValue = 0; // 架招【额外】提供的格挡值

    // 1. 获取数据
    const stanceMoveId = this.martial.stance;      // Move ID
    const stanceItemId = this.martial.stanceItemId;// Item ID
    const isStanceActive = this.martial.stanceActive;

    // 2. 获取 Flag: 是否允许被动格挡
    // 假设你的 Actor 逻辑已经处理好 Flags 并挂在 actor.xjzlStatuses 上
    const actor = this.parent;
    const hasPassiveBlock = actor?.xjzlStatuses?.passiveBlock || false;

    // 3. 计算架招本身的强度 (仅当架招开启且ID有效时)
    if (isStanceActive && stanceItemId && stanceMoveId && actor) {
      // 直接通过 ID 获取物品，不再遍历整个背包
      const stanceItem = actor.items.get(stanceItemId);

      // 只有物品存在且装备中(可选)才生效
      if (stanceItem) {
        // 在物品里找招式 (find 是必须的，但只在一个物品的moves里找，极快)
        const move = stanceItem.system.moves.find(m => m.id === stanceMoveId);

        if (move) {
          // 公式: Base + Growth * (Level - 1)
          const lvl = Math.max(1, move.computedLevel || 1);
          const base = move.calculation.base || 0;
          const growth = move.calculation.growth || 0;

          stanceBlockValue = base + growth * (lvl - 1);
        }
      }
    }

    // 计算最终格挡总值 (Total Block)
    // ------------------------------------
    // 基础格挡 = 属性衍生(通常为0) + 装备/Buff修正 + 经脉修正
    // 注意：bonuses.block 包含了经脉和AE的加值
    const baseBlock = (combat.block || 0) + bonuses.block;

    // 新增一个字段用来记录架招的格挡值，这个字段不需要定义在 schema 里，直接挂在 combat 内存对象上即可
    combat.stanceBlockValue = 0;

    if (isStanceActive) {
      // 情况 1: 架招开启
      // Total = 基础(含装备/经脉) + 架招本体强度
      combat.blockTotal = baseBlock + stanceBlockValue;
      combat.stanceBlockValue = stanceBlockValue;
    } else if (hasPassiveBlock) {
      // 情况 2: 架招关闭，但有“被动格挡”特效 (如密宗瑜伽内功)
      // Total = 基础(含装备/经脉)
      combat.blockTotal = baseBlock;
    } else {
      // 情况 3: 架招关闭，且无特殊特效
      // Total = 0 (所有格挡失效)
      combat.blockTotal = 0;
    }

    // 看破的基础值=武学内功
    const kanpoBase = this.skills.wuxue?.total || 0;
    combat.kanpoTotal = kanpoBase + (combat.kanpo || 0) + bonuses.kanpo;
    combat.xuzhaoTotal = (combat.xuzhao || 0) + bonuses.xuzhao;

    // 速度 (基础5 + 轻功/2 + 修正)
    // 注意：this.skills.qinggong.total 必须在步骤C已计算
    combat.speedTotal = Math.floor(5 + (this.skills.qinggong.total / 2) + (combat.speed || 0) + bonuses.speed);

    // 闪避 (基础10 + 身法/4 + 修正)
    combat.dodgeTotal = Math.floor(10 + (S.shenfa / 4) + (combat.dodge || 0) + bonuses.dodge);

    // 先攻 (身法 + 修正)
    combat.initiativeTotal = Math.floor(S.shenfa + (combat.initiative || 0) + bonuses.initiative);

    // 士气影响暴击
    const moraleCritMod = Math.floor((resources.morale.value || 0) / 10);

    // 攻防面板
    combat.defWaigongTotal = Math.floor(S.tipo / 5 + (combat.def_waigong || 0) + bonuses.defWaigong);
    combat.defNeigongTotal = Math.floor(S.neixi / 3 + (combat.def_neigong || 0) + bonuses.defNeigong);
    combat.hitWaigongTotal = Math.floor(S.shenfa / 2 + (combat.hit_waigong || 0) + bonuses.hitWaigong);
    combat.hitNeigongTotal = Math.floor(S.qigan / 2 + (combat.hit_neigong || 0) + bonuses.hitNeigong);

    //消耗减少
    combat.costs.neili.total = (combat.costs.neili.value || 0) + (combat.costs.neili.mod || 0);
    combat.costs.rage.total = (combat.costs.rage.value || 0) + (combat.costs.rage.mod || 0);

    // 暴击 (基础20 - 属性加成 + 修正 - 士气) *越低越好*
    // 最小值限制为 0
    combat.critWaigongTotal = Math.max(0, 20 - Math.floor(S.liliang / 20) + (combat.crit_waigong || 0) + bonuses.critWaigong - moraleCritMod);
    combat.critNeigongTotal = Math.max(0, 20 - Math.floor(S.qigan / 20) + (combat.crit_neigong || 0) + bonuses.critNeigong - moraleCritMod);
  }

  /**
   * 计算内功对招式的伤害系数加成
   * @param {String} moveElement - 招式的五行属性 (yin, yang, gang, rou, taiji, none)
   * @returns {Number} 加成系数 (例如 0.2 或 0.1)
   */
  getNeigongDamageBonus(moveElement) {
    if (!moveElement || moveElement === "none") return 0;

    // 1. 获取当前运行内功的属性
    // 我们需要从 parent (Actor) 获取 Item，因为 DataModel 本身不存 Item 数据
    const actor = this.parent;
    if (!actor) return 0;

    const activeNeigongId = this.martial.active_neigong;
    if (!activeNeigongId) return 0;

    const neigong = actor.items.get(activeNeigongId);
    if (!neigong) return 0;

    const neigongElement = neigong.system.element; // yin, yang, taiji

    // 2. 根据规则判定加成
    let bonus = 0;

    // 规则 A: 阴柔内功 (yin)
    // 施展 阴(yin)、柔(rou) -> +0.2
    // 施展 太极(taiji) -> +0.1
    if (neigongElement === "yin") {
      if (["yin", "rou"].includes(moveElement)) bonus = 0.2;
      else if (moveElement === "taiji") bonus = 0.1;
    }

    // 规则 B: 阳刚内功 (yang)
    // 施展 阳(yang)、刚(gang) -> +0.2
    // 施展 太极(taiji) -> +0.1
    else if (neigongElement === "yang") {
      if (["yang", "gang"].includes(moveElement)) bonus = 0.2;
      else if (moveElement === "taiji") bonus = 0.1;
    }

    // 规则 C: 太极内功 (taiji)
    // 施展 太极(taiji) -> +0.2
    // 施展 阴/柔/阳/刚 -> +0.1
    else if (neigongElement === "taiji") {
      if (moveElement === "taiji") bonus = 0.2;
      else if (["yin", "yang", "gang", "rou"].includes(moveElement)) bonus = 0.1;
    }

    return bonus;
  }
}