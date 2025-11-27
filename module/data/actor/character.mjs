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

    // [Helper] 七维属性模板：包含 基础值(value) 和 修正值(mod)
    const makeStatField = (labelKey) => new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 1, label: "XJZL.Stats.Base" }),
      mod: new fields.NumberField({ required: true, integer: true, initial: 0, label: "XJZL.Stats.Mod" })
    }, { label: labelKey });

    // [Helper] 资源池模板：包含 当前值(value)、最大值(max)、额外上限修正(bonus)
    const makeResourceField = (initialVal, maxVal, labelKey) => new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: initialVal, label: labelKey }),
      max: new fields.NumberField({ required: true, integer: true, initial: maxVal }), 
      bonus: new fields.NumberField({ required: true, integer: true, initial: 0 }) 
    });

    return {
      // === A. 基础档案 (Info) ===
      // 记录角色的身份、外貌等 Roleplay 信息
      info: new fields.SchemaField({
        gender: new fields.StringField({ initial: "", label: "XJZL.Info.Gender" }),   // 性别
        zi: new fields.StringField({ initial: "", label: "XJZL.Info.Zi" }),           // 字
        title: new fields.StringField({ initial: "", label: "XJZL.Info.Title" }),     // 称号
        
        // 之前这里没有本地化，现已修正
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
        wuxing: makeStatField("XJZL.Stats.Wuxing"),   // 悟性
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
        wuxue: new fields.NumberField({ min: 0, initial: 0, label: "XJZL.Cultivation.Wuxue" }),     // 专属武学修为 (原 martial)
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
        // 1. 基础战斗属性 (拼音)
        block: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.Block" }),       // 格挡修正
        kanpo: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.Kanpo" }),       // 看破修正
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

        // 3. 额外伤害修正 (Global Damage Mod)
        // 作用：接收全局伤害 Buff。武学计算伤害时会加上这个值。
        weapon_dmg_bonus: new fields.NumberField({ initial: 0, integer: true, label: "XJZL.Combat.GlobalDmgMod" })
      }),

      // === F. 武学状态 (Martial Status) ===
      martial: new fields.SchemaField({
        active_neigong: new fields.StringField({ label: "XJZL.Resources.ActiveNeigong" }), // 当前运行内功的 UUID
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

      // === 8. 生平经历 (History / Audit Log) ===
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
      "jiaoyi", "qiman", "shuofu", "dingli"        // 神采系
    ];

    // 构建结构: { base: 0, mod: 0, total: 0 }
    for (const sk of skillList) {
      this.skills[sk] = {
        base: 0,  // 由属性计算得出 (在 derivedData)
        mod: 0,   // 由 Active Effects 填充
        total: 0  // 最终值
      };
    }
    
    // 初始化衍生容器，防止访问 undefined
    if (!this.cultivation) this.cultivation = {};
    this.cultivation.weaponRanks = {}; // 用于存储计算后的武器造诣等级
  }

  /**
   * ------------------------------------------------------------
   * 3. 衍生数据计算 (prepareDerivedData)
   * ------------------------------------------------------------
   * 在 Active Effects 应用之后运行。
   * 负责处理所有复杂的武侠逻辑计算。
   */
  prepareDerivedData() {
    const stats = this.stats;
    const combat = this.combat;
    const resources = this.resources;
    const actor = this.parent; // 获取 Actor 实例以访问 Items

    // =======================================================
    // 逻辑一：遍历 Items 计算 [境界]、[悟性加成]、[武器造诣]
    // =======================================================
    
    let maxRealmLevel = 0; // 最高境界 (0-7)
    let wuxingBonus = 0;   // 悟性额外加成点数
    
    // 武器积分计数器 { "blade": { t1: 0, t2: 0, t3: 0 } }
    const weaponCounts = {}; 

    // 悟性加成计数器 (受人数限制)
    let wuxingHumanCount = 0; // 人级精通数
    let wuxingEarthCount = 0; // 地级精通数

    if (actor && actor.items) {
      for (const item of actor.items) {
        
        // --- A. 内功 (Neigong) 计算境界 ---
        if (item.type === "neigong") {
          // 自动应用属性加成 (仅当内功正在运行 active=true 时)
          if (item.system.active) {
            const bonuses = item.system.current.stats; // 直接读取我们在 Item 里算好的 current
            
            // 累加到 Actor 的 mod 上
            // 注意：这里我们修改的是 stats.wuxing.mod (修正值)
            if (bonuses) {
              stats.liliang.mod = (stats.liliang.mod || 0) + bonuses.liliang;
              stats.shenfa.mod  = (stats.shenfa.mod || 0)  + bonuses.shenfa;
              stats.tipo.mod    = (stats.tipo.mod || 0)    + bonuses.tipo;
              stats.neixi.mod   = (stats.neixi.mod || 0)   + bonuses.neixi;
              stats.shencai.mod = (stats.shencai.mod || 0) + bonuses.shencai;
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

        // --- B. 武学 (wuxue) 计算悟性和造诣 ---
        if (item.type === "wuxue") {
          const tier = item.system.tier || 1;
          const stage = item.system.stage || 0;
          const wType = item.system.weaponType; // 武器类型

          if (wType) {
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

    // =======================================================
    // 逻辑二：计算七维属性 (Stats)
    // 公式：Total = 基础 + 装备修正 + 衍生加成
    // =======================================================
    
    // 特殊处理悟性 (加入 wuxingBonus)
    stats.wuxing.total = (stats.wuxing.value || 0) + (stats.wuxing.mod || 0) + wuxingBonus;

    // 处理其他属性
    for (const [key, stat] of Object.entries(stats)) {
      if (key === 'wuxing') continue; 
      stat.total = (stat.value || 0) + (stat.mod || 0);
      
      // 死亡标记
      if (stat.total < 0) this.parent.system.isDead = true; 
    }

    // 创建快捷引用 (S for Stats)
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
    // 逻辑三：结算武器造诣 (Weapon Ranks)
    // =======================================================
    
    // 用于 Combat 面板显示的通用最大加成
    let maxGenericDmgBonus = 0;

    for (const [wType, counts] of Object.entries(weaponCounts)) {
      let rank = 0;
      
      // 梯度1 (1-4级): 只要掌握就算，上限 4
      const r1 = Math.min(counts.t1, 4);
      
      // 梯度2 (5-8级): 地/天级精通，上限 4
      const r2 = Math.min(counts.t2, 4);
      
      // 梯度3 (9+级): 天级合一，无上限
      const r3 = counts.t3;

      // 总造诣等级 = 各梯度之和
      rank = r1 + r2 + r3;

      // 保存造诣等级 (如: 刀法=6)
      this.cultivation.weaponRanks[wType] = rank;

      // 2. 计算伤害加成 (分段函数累加)
      // 规则：
      // 等级 1-4: 每级 +1
      // 等级 5-8: 每级 +2
      // 等级 9+ : 每级 +3
      let dmg = 0;
      
      if (rank <= 4) {
        // 只有 1-4 级的部分
        dmg = rank * 1;
      } else if (rank <= 8) {
        // 满 4 级(4点) + 超出部分(每级2点)
        dmg = 4 + (rank - 4) * 2;
      } else {
        // 满 4 级(4点) + 满 5-8 级(8点) + 超出部分(每级3点)
        dmg = 4 + 8 + (rank - 8) * 3;
      }

      // 存入 weaponRanks 供 Roll 调用
      this.cultivation.weaponRanks[`${wType}_dmg`] = dmg;
      
      if (dmg > maxGenericDmgBonus) maxGenericDmgBonus = dmg;
    }

    // =======================================================
    // 逻辑四：计算属性技能 (Skills)
    // 此时 mod 字段已被 AE 填充
    // =======================================================
    const calcSkill = (key, statVal) => {
      const skill = this.skills[key];
      skill.base = Math.floor(statVal / 10);
      skill.total = skill.base + (skill.mod || 0);
    };

    // 执行计算
    calcSkill("jiaoli", S.liliang); calcSkill("zhengtuo", S.liliang); calcSkill("paozhi", S.liliang); calcSkill("qinbao", S.liliang);
    calcSkill("qianxing", S.shenfa); calcSkill("qiaoshou", S.shenfa); calcSkill("qinggong", S.shenfa); calcSkill("mashu", S.shenfa);
    calcSkill("renxing", S.tipo); calcSkill("biqi", S.tipo); calcSkill("rennai", S.tipo); calcSkill("ningxue", S.tipo);
    calcSkill("liaoshang", S.neixi); calcSkill("chongxue", S.neixi); calcSkill("lianxi", S.neixi); calcSkill("duqi", S.neixi);
    calcSkill("dianxue", S.qigan); calcSkill("zhuizong", S.qigan); calcSkill("tancha", S.qigan); calcSkill("dongcha", S.qigan);
    calcSkill("jiaoyi", S.shencai); calcSkill("qiman", S.shencai); calcSkill("shuofu", S.shencai); calcSkill("dingli", S.shencai);

    // =======================================================
    // 逻辑五：计算资源与战斗面板 (Combat & Resources)
    // =======================================================

    // 资源上限
    resources.hp.max = Math.floor(S.tipo * 4 + S.liliang * 1 + (resources.hp.bonus || 0));
    resources.mp.max = Math.floor(S.neixi * 1 + (resources.mp.bonus || 0));
    resources.rage.max = 10;
    resources.alcohol.max = S.tipo;
    // 战斗属性
    // ------------------------------------
    
    // 武器伤害修正 = 造诣加成(取最高) + 全局Buff(如大力丸)
    combat.weaponDmgTotal = maxGenericDmgBonus + (combat.weapon_dmg_bonus || 0);

    combat.blockTotal = 0 + combat.block;
    combat.kanpoTotal = 0 + combat.kanpo;

    // 速度 (依赖轻功 Total)
    combat.speedTotal = Math.floor(5 + (this.skills.qinggong.total / 2) + combat.speed);
    
    // 闪避
    combat.dodgeTotal = Math.floor(10 + (S.shenfa / 4) + combat.dodge);
    
    // 先攻
    combat.initiativeTotal = Math.floor(S.shenfa + combat.initiative);

    // [士气] 计算暴击骰修正
    const moraleCritMod = Math.floor((resources.morale.value || 0) / 10);
    // 攻防面板
    combat.defWaigongTotal = Math.floor(S.tipo / 5 + combat.def_waigong);
    combat.defNeigongTotal = Math.floor(S.neixi / 3 + combat.def_neigong);
    combat.hitWaigongTotal = Math.floor(S.shenfa / 2 + combat.hit_waigong);
    combat.hitNeigongTotal = Math.floor(S.qigan / 2 + combat.hit_neigong);
    combat.critWaigongTotal = Math.floor(20 - (S.liliang / 20) + combat.crit_waigong - moraleCritMod);
    combat.critNeigongTotal = Math.floor(20 - (S.qigan / 20) + combat.crit_neigong - moraleCritMod);
  }
}