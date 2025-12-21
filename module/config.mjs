export const XJZL = {};

// 1. 功法品阶
XJZL.tiers = {
  1: "XJZL.Tiers.1",
  2: "XJZL.Tiers.2",
  3: "XJZL.Tiers.3"
};

// 2. 武学分类
XJZL.wuxueCategories = {
  wuxue: "XJZL.Wuxue.CategoryList.wuxue",
  sanshou: "XJZL.Wuxue.CategoryList.sanshou",
  qinggong: "XJZL.Wuxue.CategoryList.qinggong",
  zhenfa: "XJZL.Wuxue.CategoryList.zhenfa"
};

// 3. 招式类型
XJZL.moveTypes = {
  real: "XJZL.Wuxue.Type.real",
  feint: "XJZL.Wuxue.Type.feint",
  qi: "XJZL.Wuxue.Type.qi",
  stance: "XJZL.Wuxue.Type.stance",
  counter: "XJZL.Wuxue.Type.counter"
  // ultimate: "XJZL.Wuxue.Type.ultimate"  把绝招从招式类型中移除
};

// 4. 属性 (通用)
XJZL.elements = {
  none: "XJZL.Elements.None",
  taiji: "XJZL.Elements.Taiji",
  yin: "XJZL.Elements.Yin",
  yang: "XJZL.Elements.Yang",
  gang: "XJZL.Elements.Gang",
  rou: "XJZL.Elements.Rou"
};

// 5. 角色属性 (对应 system.stats.xxx)
XJZL.attributes = {
  liliang: "XJZL.Stats.Liliang",
  shenfa: "XJZL.Stats.Shenfa",
  neixi: "XJZL.Stats.Neixi",
  tipo: "XJZL.Stats.Tipo",
  qigan: "XJZL.Stats.Qigan",
  shencai: "XJZL.Stats.Shencai"
};

// 6. 武器类型 (对应 Character 的 weaponRanks)
XJZL.weaponTypes = {
  unarmed: "XJZL.Combat.Rank.Unarmed",
  sword: "XJZL.Combat.Rank.Sword",
  blade: "XJZL.Combat.Rank.Blade",
  staff: "XJZL.Combat.Rank.Staff",
  dagger: "XJZL.Combat.Rank.Dagger",
  hidden: "XJZL.Combat.Rank.Hidden",
  instrument: "XJZL.Combat.Rank.Instrument",
  special: "XJZL.Combat.Rank.Special",
  none: "XJZL.Combat.Rank.None"
};

// 7. 特效触发时机
XJZL.effectTriggers = {
  hit: "XJZL.Wuxue.Trigger.Hit",       // 命中时
  use: "XJZL.Wuxue.Trigger.Use",       // 使用时(无论命中)
  crit: "XJZL.Wuxue.Trigger.Crit",     // 暴击时
  parry: "XJZL.Wuxue.Trigger.Parry",   // 格挡成功时
  kill: "XJZL.Wuxue.Trigger.Kill"      // 击杀时
};

// 8. 特效目标
XJZL.effectTargets = {
  self: "XJZL.Wuxue.Target.Self",      // 自己
  target: "XJZL.Wuxue.Target.Target"   // 敌方/目标
};

// 9. 防具部位/类型
XJZL.armorTypes = {
  head: "XJZL.Armor.Type.Head",       // 头饰
  top: "XJZL.Armor.Type.Top",         // 上衣
  bottom: "XJZL.Armor.Type.Bottom",   // 下衣
  shoes: "XJZL.Armor.Type.Shoes",     // 鞋子
  ring: "XJZL.Armor.Type.Ring",       // 戒指
  earring: "XJZL.Armor.Type.Earring", // 耳环
  necklace: "XJZL.Armor.Type.Necklace",// 项链
  accessory: "XJZL.Armor.Type.Accessory" // 饰品
};

// 10. 穴位列表 (用于遍历和UI显示)
XJZL.acupoints = {
  // 十二正经
  hand_shaoyin: "XJZL.Jingmai.Hand_shaoyin",
  foot_shaoyin: "XJZL.Jingmai.Foot_shaoyin",
  hand_shaoyang: "XJZL.Jingmai.Hand_shaoyang",
  foot_shaoyang: "XJZL.Jingmai.Foot_shaoyang",
  hand_jueyin: "XJZL.Jingmai.Hand_jueyin",
  foot_jueyin: "XJZL.Jingmai.Foot_jueyin",
  hand_yangming: "XJZL.Jingmai.Hand_yangming",
  foot_yangming: "XJZL.Jingmai.Foot_yangming",
  hand_taiyin: "XJZL.Jingmai.Hand_taiyin",
  foot_taiyin: "XJZL.Jingmai.Foot_taiyin",
  hand_taiyang: "XJZL.Jingmai.Hand_taiyang",
  foot_taiyang: "XJZL.Jingmai.Foot_taiyang"
};

// 11. 消耗品类型
XJZL.consumableTypes = {
  medicine: "XJZL.Consumable.Type.Medicine", // 药品
  poison: "XJZL.Consumable.Type.Poison",     // 毒药
  tea: "XJZL.Consumable.Type.Tea",           // 茶叶
  food: "XJZL.Consumable.Type.Food",         // 佳肴
  wine: "XJZL.Consumable.Type.Wine",         // 美酒
  other: "XJZL.Consumable.Type.Other"        // 其他
};

// 12. 物品品质
XJZL.qualities = {
  0: "XJZL.Qualities.0", // 凡
  1: "XJZL.Qualities.1", // 铜
  2: "XJZL.Qualities.2", // 银
  3: "XJZL.Qualities.3", // 金
  4: "XJZL.Qualities.4"  // 玉
};

// 13. 伤害类型
XJZL.damageTypes = {
  waigong: "XJZL.Damage.Waigong", // 外功 (需命中)
  neigong: "XJZL.Damage.Neigong", // 内功 (需命中)
  bleed: "XJZL.Damage.Bleed",     // 流血 (必中)
  poison: "XJZL.Damage.Poison",   // 毒素 (必中)
  mental: "XJZL.Damage.Mental",   // 精神 (必中)
  fire: "XJZL.Damage.Fire",       // 火焰 (必中)
  liushi: "XJZL.Damage.Liushi",   // 流失 (真实伤害)
  none: "XJZL.DamageType.None"  // 无(用于气招等地方)
};

// 14. 技能列表 (本地化映射)
XJZL.skills = {
  // 力量系
  jiaoli: "XJZL.Skills.Jiaoli",
  zhengtuo: "XJZL.Skills.Zhengtuo",
  paozhi: "XJZL.Skills.Paozhi",
  qinbao: "XJZL.Skills.Qinbao",
  // 身法系
  qianxing: "XJZL.Skills.Qianxing",
  qiaoshou: "XJZL.Skills.Qiaoshou",
  qinggong: "XJZL.Skills.Qinggong",
  mashu: "XJZL.Skills.Mashu",
  // 体魄系
  renxing: "XJZL.Skills.Renxing",
  biqi: "XJZL.Skills.Biqi",
  rennai: "XJZL.Skills.Rennai",
  ningxue: "XJZL.Skills.Ningxue",
  // 内息系
  liaoshang: "XJZL.Skills.Liaoshang",
  chongxue: "XJZL.Skills.Chongxue",
  lianxi: "XJZL.Skills.Lianxi",
  duqi: "XJZL.Skills.Duqi",
  // 气感系
  dianxue: "XJZL.Skills.Dianxue",
  zhuizong: "XJZL.Skills.Zhuizong",
  tancha: "XJZL.Skills.Tancha",
  dongcha: "XJZL.Skills.Dongcha",
  // 神采系
  jiaoyi: "XJZL.Skills.Jiaoyi",
  qiman: "XJZL.Skills.Qiman",
  shuofu: "XJZL.Skills.Shuofu",
  dingli: "XJZL.Skills.Dingli",
  // 悟性系
  wuxue: "XJZL.Skills.Wuxue",
  jianding: "XJZL.Skills.Jianding",
  bagua: "XJZL.Skills.Bagua",
  shili: "XJZL.Skills.Shili"
};

// 15. 技艺列表
XJZL.arts = {
  duanzao: "XJZL.Arts.Duanzao", // 锻造
  chengyi: "XJZL.Arts.Chengyi", // 成衣
  zhibao: "XJZL.Arts.Zhibao",   // 制宝
  pengren: "XJZL.Arts.Pengren", // 烹饪
  yishu: "XJZL.Arts.Yishu",     // 医术
  dushu: "XJZL.Arts.Dushu",     // 毒术
  chadao: "XJZL.Arts.Chadao",   // 茶道
  jiuyi: "XJZL.Arts.Jiuyi",     // 酒艺
  shuxie: "XJZL.Arts.Shuxie",   // 书写
  zuohua: "XJZL.Arts.Zuohua",   // 作画
  yanzou: "XJZL.Arts.Yanzou",   // 演奏
  qishu: "XJZL.Arts.Qishu",     // 棋术
  fofa: "XJZL.Arts.Fofa",       // 佛法
  daofa: "XJZL.Arts.Daofa",     // 道法
  biaoyan: "XJZL.Arts.Biaoyan", // 表演
  qitao: "XJZL.Arts.Qitao",     // 乞讨
  yushou: "XJZL.Arts.Yushou",   // 驭兽
  nongshi: "XJZL.Arts.Nongshi"  // 农事
};

// 16. 技艺身份配置 (Art Identities)
XJZL.artIdentities = {
  // === 锻造 ===
  duanzao: [
    { level: 1, titleKey: "1.Title", descKey: "1.Desc" },
    { level: 3, titleKey: "3.Title", descKey: "3.Desc", bonuses: { "stats.liliang": 5 } }, // 力量+5
    { level: 5, titleKey: "5.Title", descKey: "5.Desc" },
    { level: 7, titleKey: "7.Title", descKey: "7.Desc", bonuses: { "arts.duanzao.checkMod": 2 } }, // 锻造+2
    { level: 10, titleKey: "10.Title", descKey: "10.Desc", bonuses: { 
        "combat.weaponRanks.sword.mod": 1, "combat.weaponRanks.blade.mod": 1, 
        "combat.weaponRanks.staff.mod": 1, "combat.weaponRanks.dagger.mod": 1, 
        "combat.weaponRanks.hidden.mod": 1, "combat.weaponRanks.unarmed.mod": 1, 
        "combat.weaponRanks.instrument.mod": 1, "combat.weaponRanks.special.mod": 1 
    }} // 全武器等级+1
  ],
  // === 成衣 ===
  chengyi: [
    { level: 1, titleKey: "1.Title", descKey: "1.Desc", bonuses: { "arts.chengyi.checkMod": 1 } }, // 成衣+1
    { level: 3, titleKey: "3.Title", descKey: "3.Desc" },
    { level: 5, titleKey: "5.Title", descKey: "5.Desc", bonuses: { "stats.shenfa": 5 } }, // 身法+5
    { level: 7, titleKey: "7.Title", descKey: "7.Desc"}, 
    { level: 10, titleKey: "10.Title", descKey: "10.Desc"}
  ],
  // === 制宝 ===
  zhibao: [
    { level: 1, titleKey: "1.Title", descKey: "1.Desc" }, 
    { level: 3, titleKey: "3.Title", descKey: "3.Desc", bonuses: { "stats.shenfa": 5 } }, // 身法+5
    { level: 5, titleKey: "5.Title", descKey: "5.Desc" },
    { level: 7, titleKey: "7.Title", descKey: "7.Desc" },
    { level: 10, titleKey: "10.Title", descKey: "10.Desc" }
  ],
  // === 烹饪 ===
  pengren: [
    { level: 1, titleKey: "1.Title", descKey: "1.Desc" },
    { level: 3, titleKey: "3.Title", descKey: "3.Desc", bonuses: { "stats.tipo": 5 } }, // 体魄+5
    { level: 5, titleKey: "5.Title", descKey: "5.Desc", bonuses: { "combat.weaponRanks.blade.r2Bonus": 1, "combat.weaponRanks.dagger.r2Bonus": 1 } }, // 刀/匕首+1
    { level: 7, titleKey: "7.Title", descKey: "7.Desc", bonuses: { "arts.pengren.checkMod": 2 } }, // 烹饪+2
    { level: 10, titleKey: "10.Title", descKey: "10.Desc" }
  ],
  // === 医术 ===
  yishu: [
    { level: 1, titleKey: "1.Title", descKey: "1.Desc" },
    { level: 3, titleKey: "3.Title", descKey: "3.Desc" },
    { level: 5, titleKey: "5.Title", descKey: "5.Desc", bonuses: { "stats.qigan": 5 } }, // 气感+5
    { level: 7, titleKey: "7.Title", descKey: "7.Desc", bonuses: { "arts.yishu.checkMod": 2 } }, // 医术+2
    { level: 10, titleKey: "10.Title", descKey: "10.Desc", bonuses: { "arts.yishu.checkMod": 1 } } // 医术+1
  ],
  // === 毒术 ===
  dushu: [
    { level: 1, titleKey: "1.Title", descKey: "1.Desc", bonuses: { "arts.dushu.checkMod": 2 } }, // 毒术+2
    { level: 3, titleKey: "3.Title", descKey: "3.Desc" },
    { level: 5, titleKey: "5.Title", descKey: "5.Desc" },
    { level: 7, titleKey: "7.Title", descKey: "7.Desc" },
    { level: 10, titleKey: "10.Title", descKey: "10.Desc" }
  ],
  // === 茶道 ===
  chadao: [
    { level: 1, titleKey: "1.Title", descKey: "1.Desc" },
    { level: 3, titleKey: "3.Title", descKey: "3.Desc", bonuses: { "arts.chadao.checkMod": 1 } }, // 茶道+1
    { level: 5, titleKey: "5.Title", descKey: "5.Desc", bonuses: { "arts.chadao.checkMod": 2 } }, // 茶道+2
    { level: 7, titleKey: "7.Title", descKey: "7.Desc" },
    { level: 10, titleKey: "10.Title", descKey: "10.Desc" }
  ],
  // === 酒艺 ===
  jiuyi: [
    { level: 1, titleKey: "1.Title", descKey: "1.Desc" },
    { level: 3, titleKey: "3.Title", descKey: "3.Desc", bonuses: { "stats.tipo": 5 } }, // 体魄+5
    { level: 5, titleKey: "5.Title", descKey: "5.Desc", bonuses: { "resources.alcohol.bonus": 20 } }, // 酒量+20
    { level: 7, titleKey: "7.Title", descKey: "7.Desc" },
    { level: 10, titleKey: "10.Title", descKey: "10.Desc" }
  ],
  // === 书写 ===
  shuxie: [
    { level: 1, titleKey: "1.Title", descKey: "1.Desc", bonuses: { "skills.shuofu.mod": 1 } }, // 说服+1
    { level: 3, titleKey: "3.Title", descKey: "3.Desc" },
    { level: 5, titleKey: "5.Title", descKey: "5.Desc" },
    { level: 7, titleKey: "7.Title", descKey: "7.Desc" },
    { level: 10, titleKey: "10.Title", descKey: "10.Desc" }
  ],
  // === 作画 ===
  zuohua: [
    { level: 1, titleKey: "1.Title", descKey: "1.Desc" },
    { level: 3, titleKey: "3.Title", descKey: "3.Desc" }, // 易容检定暂无直接对应属性，暂不自动
    { level: 5, titleKey: "5.Title", descKey: "5.Desc" },
    { level: 7, titleKey: "7.Title", descKey: "7.Desc" },
    { level: 10, titleKey: "10.Title", descKey: "10.Desc" } // 招式伤害暂不自动
  ],
  // === 棋术 ===
  qishu: [
    { level: 1, titleKey: "1.Title", descKey: "1.Desc" },
    { level: 3, titleKey: "3.Title", descKey: "3.Desc" },
    { level: 5, titleKey: "5.Title", descKey: "5.Desc", bonuses: { "arts.qishu.checkMod": 2 } }, // 棋术+2
    { level: 7, titleKey: "7.Title", descKey: "7.Desc" },
    { level: 10, titleKey: "10.Title", descKey: "10.Desc" }
  ],
  // === 佛法 ===
  fofa: [
    { level: 1, titleKey: "1.Title", descKey: "1.Desc" },
    { level: 3, titleKey: "3.Title", descKey: "3.Desc" },
    { level: 5, titleKey: "5.Title", descKey: "5.Desc" },
    { level: 7, titleKey: "7.Title", descKey: "7.Desc" },
    { level: 10, titleKey: "10.Title", descKey: "10.Desc", bonuses: { "arts.fofa.checkMod": 1 } } // 佛法+1
  ],
  // === 道法 ===
  daofa: [
    { level: 1, titleKey: "1.Title", descKey: "1.Desc" },
    { level: 3, titleKey: "3.Title", descKey: "3.Desc", bonuses: { "arts.daofa.checkMod": 1 } }, // 道法+1
    { level: 5, titleKey: "5.Title", descKey: "5.Desc" },
    { level: 7, titleKey: "7.Title", descKey: "7.Desc" }, 
    { level: 10, titleKey: "10.Title", descKey: "10.Desc" }
  ],
  // === 表演 ===
  biaoyan: [
    { level: 1, titleKey: "1.Title", descKey: "1.Desc" },
    { level: 3, titleKey: "3.Title", descKey: "3.Desc" },
    { level: 5, titleKey: "5.Title", descKey: "5.Desc", bonuses: { "arts.biaoyan.checkMod": 2 } }, // 表演+2
    { level: 7, titleKey: "7.Title", descKey: "7.Desc" },
    { level: 10, titleKey: "10.Title", descKey: "10.Desc", bonuses: { "stats.shencai": 10 } } // 神采+10
  ],
  // === 驭兽 ===
  yushou: [
    { level: 1, titleKey: "1.Title", descKey: "1.Desc" },
    { level: 3, titleKey: "3.Title", descKey: "3.Desc" },
    { level: 5, titleKey: "5.Title", descKey: "5.Desc" },
    { level: 7, titleKey: "7.Title", descKey: "7.Desc" },
    { level: 10, titleKey: "10.Title", descKey: "10.Desc" }
  ],
  // === 农事 ===
  nongshi: [
    { level: 1, titleKey: "1.Title", descKey: "1.Desc" },
    { level: 3, titleKey: "3.Title", descKey: "3.Desc" },
    { level: 5, titleKey: "5.Title", descKey: "5.Desc", bonuses: { "arts.nongshi.checkMod": 2 } }, // 农事+2
    { level: 7, titleKey: "7.Title", descKey: "7.Desc" },
    { level: 10, titleKey: "10.Title", descKey: "10.Desc" }
  ]
};


// 17. 系统状态标志 (逻辑开关)
// 用于处理那些buff/debuff上无法通过AE修改数值来实现的效果
// 用于 Actor.prepareDerivedData 中读取，以及 AE 效果配置
XJZL.statusFlags = {
  // --- A. 检定与对抗类  ---
  // attackAdvantage: "XJZL.Status.AttackAdvantage",                 // 攻击优势 (自身攻击检定取高)
  // attackDisadvantage: "XJZL.Status.AttackDisadvantage",           // 攻击劣势 (自身攻击检定取低)

  // grantAttackAdvantage: "XJZL.Status.GrantAttackAdvantage",       // 被攻击优势 (给予攻击者优势)
  // grantAttackDisadvantage: "XJZL.Status.GrantAttackDisadvantage", // 被攻击劣势 (给予攻击者劣势)

  // === 数值型优劣势计数器 ===
  // 逻辑：正数(+)代表优势，负数(-)代表劣势，0代表正常
  // 在 AE 中请使用 Mode 2 (ADD) 进行加减

  // 1. 自身攻击修正 (Self)
  // 含义：我攻击别人时，我的状态让我 [更容易(+)/更难(-)] 命中
  attackLevel: "XJZL.Status.AttackLevel",

  // 2. 被击修正 (Grant/Target)
  // 含义：别人攻击我时，我的状态让他 [更容易(+)/更难(-)] 命中
  // 例如：在这里写 +1，代表"空门大开"，任何打我的人获得 +1 优势
  grantAttackLevel: "XJZL.Status.GrantAttackLevel",

  // feintAdvantage: "XJZL.Status.FeintAdvantage",                   // 虚招对抗优势 (使用虚招时检定取高)
  // feintDisadvantage: "XJZL.Status.FeintDisadvantage",             // 虚招对抗劣势 (使用虚招时检定取低)

  // defendFeintAdvantage: "XJZL.Status.DefendFeintAdvantage",       // 被虚招优势 (抵抗虚招时检定取高)
  // defendFeintDisadvantage: "XJZL.Status.DefendFeintDisadvantage", // 被虚招劣势 (抵抗虚招时检定取低)

  // 1. 虚招施展/抵抗修正 (Feint Level)
  // 含义：自身在虚招对抗中的能力层级
  // - 攻方: 施展虚招时，正数=优势，负数=劣势
  // - 守方: 抵抗虚招时，正数=优势，负数=劣势 (对应之前的 feintAdvantage)
  feintLevel: "XJZL.Status.FeintLevel",

  // 2. 被虚招修正 (Grant/Target Feint Level)
  // 含义：作为目标时，给对手赋予的层级
  // - 攻方: (罕见) 如果攻方有此状态，守方看破获得优势
  // - 守方: (常见) 如果守方有此状态，攻方虚招获得优势 (对应之前的 defendFeintAdvantage)
  defendFeintLevel: "XJZL.Status.DefendFeintLevel",

  // --- B. 资源封锁类  ---
  noRecoverRage: "XJZL.Status.NoRecoverRage",     // 无法获得怒气 (怒气锁定)
  noRecoverNeili: "XJZL.Status.NoRecoverNeili",   // 无法获得内力 (内力锁定)
  noRecoverHP: "XJZL.Status.NoRecoverHP",         // 无法获得气血 (禁疗)

  // --- C. 行为限制类  ---
  // 在 Item.roll() 开头检测这些 Flag
  blockShiZhao: "XJZL.Status.BlockShiZhao",       // 无法施展实招
  blockXuZhao: "XJZL.Status.BlockXuZhao",         // 无法施展虚招
  blockQiZhao: "XJZL.Status.BlockQiZhao",         // 无法施展气招
  blockCounter: "XJZL.Status.BlockCounter",       // 无法施展反击
  blockUltimate: "XJZL.Status.BlockUltimate",     // 无法施展绝招
  blockStance: "XJZL.Status.BlockStance",         // 无法开启架招/防御姿态

  forceUnarmed: "XJZL.Status.ForceUnarmed",       // 只能施展徒手招式 (缴械)
  silence: "XJZL.Status.Silence",                 // 无法施展任何招式
  stun: "XJZL.Status.Stun",                       // 无法行动 (晕眩/定身)

  // --- D. 受击触发类 (Triggers - On Hit) ---
  // 在 Apply Damage 逻辑中检测
  bleedOnHit: "XJZL.Status.BleedOnHit",           // 受伤时流失气血
  wuxueBleedOnHit: "XJZL.Status.WuxueBleedOnHit",  // 仅受到内外功伤害时流失气血
  brokenDefense: "XJZL.Status.BrokenDefense", // 破甲 (防御归零)

  // --- E. 其他类  ---
  passiveBlock: "XJZL.Status.PassiveBlock",     // 被动格挡：即使未开启架招，基础格挡值依然生效
  ignoreArmorEffects: "XJZL.Status.IgnoreArmorEffects", // 防具无效
  unstable: "XJZL.Status.Unstable",             // 下盘不稳，速度减半
  forceSpeedZero: "XJZL.Status.ForceSpeedZero", // 速度归零 (禁足/定身)
  forceDodgeZero: "XJZL.Status.ForceDodgeZero", // 闪避归零 (禁足/定身)
  bloodLossLevel: "XJZL.Status.BloodLossLevel", // 失血层数

  // --- F. 攻击穿透类 (Attacker Penetration) ---
  // 攻击者拥有此状态时，其攻击将获得对应效果
  ignoreBlock: "XJZL.Status.IgnoreBlock",       // 攻击无视格挡
  ignoreDefense: "XJZL.Status.IgnoreDefense",   // 攻击无视防御
  ignoreStance: "XJZL.Status.IgnoreStance",     // 攻击无视/不触发架招特效

  // --- G. 自动化回复/消耗 (Regen/Deplete) ---
  // 命名规则: regen + Resource + Timing
  // 值: 正数(回复), 负数(消耗)

  // 1. 回合开始 (Turn Start)
  regenHpTurnStart: "XJZL.Status.RegenHpTurnStart",
  regenMpTurnStart: "XJZL.Status.RegenMpTurnStart",
  regenRageTurnStart: "XJZL.Status.RegenRageTurnStart",

  // 2. 回合结束 (Turn End)
  regenHpTurnEnd: "XJZL.Status.RegenHpTurnEnd",
  regenMpTurnEnd: "XJZL.Status.RegenMpTurnEnd",
  regenRageTurnEnd: "XJZL.Status.RegenRageTurnEnd",

  // 3. 出招时 (On Attack) - 每次使用招式触发
  regenHpAttack: "XJZL.Status.RegenHpAttack",
  regenMpAttack: "XJZL.Status.RegenMpAttack",
  regenRageAttack: "XJZL.Status.RegenRageAttack"
};

// 18. 检定优劣势计数器 (Check Flags)
// 专门用于存储 rollAttributeTest 的修正 (key + "CheckLevel")
// 结构: { "liliangCheckLevel": "XJZL.Stats.Liliang", ... }
XJZL.checkFlags = {
  // 全局修正
  globalCheckLevel: "XJZL.Status.GlobalCheckLevel"
};

// 【自动化注入】
// 遍历属性和技能，自动生成 CheckLevel Flag
const _injectCheckFlags = (sourceObj) => {
  for (const [key, labelKey] of Object.entries(sourceObj)) {
    const flagKey = `${key}CheckLevel`;
    // 这里存 labelKey，方便 UI 显示时能翻译
    XJZL.checkFlags[flagKey] = labelKey;
  }
};

// 注入属性 (liliangCheckLevel...)
_injectCheckFlags(XJZL.attributes);
// 注入技能 (qiaoshouCheckLevel...)
_injectCheckFlags(XJZL.skills);
// 注入技艺
_injectCheckFlags(XJZL.arts);

/**
 * 通用状态效果配置
 * 这些效果会出现在 Token HUD 和 Smart Picker 中
 */
// module/config.mjs

XJZL.statusEffects = [
  // ====================================================
  // 1. 持续回合类 (Turn-based / Status)
  // ====================================================
  {
    id: "sielie",
    name: "XJZL.Status.Sielie", // 撕裂
    description: "XJZL.Status.SielieDesc", 
    img: "icons/svg/blood.svg",
    flags: { "xjzl-system": { slug: "sielie", stackable: false } },
    changes: [
      { key: "flags.xjzl-system.wuxueBleedOnHit", mode: 2, value: "10" }
    ]
  },
  {
    id: "pojia",
    name: "XJZL.Status.Pojia", // 破甲
    description: "XJZL.Status.PojiaDesc", 
    img: "icons/svg/downgrade.svg",
    flags: { "xjzl-system": { slug: "pojia", stackable: false } },
    changes: [
      // 外功防御归零 -> 使用 OVERRIDE (5)
      { key: "flags.xjzl-system.brokenDefense", mode: 5, value: "true" }
    ]
  },
  {
    id: "bunu",
    name: "XJZL.Status.Bunu", // 不怒
    description: "XJZL.Status.BunuDesc", 
    img: "icons/svg/ice-aura.svg",
    flags: { "xjzl-system": { slug: "bunu", stackable: false } },
    changes: [
      { key: "flags.xjzl-system.noRecoverRage", mode: 5, value: "true" }
    ]
  },
  {
    id: "jinxu",
    name: "XJZL.Status.Jinxu", // 禁虚
    description: "XJZL.Status.JinxuDesc", 
    img: "icons/svg/cancel.svg",
    flags: { "xjzl-system": { slug: "jinxu", stackable: false } },
    changes: [{ key: "flags.xjzl-system.blockXuZhao", mode: 5, value: "true" }]
  },
  {
    id: "jinshi",
    name: "XJZL.Status.Jinshi", // 禁实
    description: "XJZL.Status.JinshiDesc", 
    img: "icons/svg/padlock.svg",
    flags: { "xjzl-system": { slug: "jinshi", stackable: false } },
    changes: [{ key: "flags.xjzl-system.blockShiZhao", mode: 5, value: "true" }]
  },
  {
    id: "jinfan",
    name: "XJZL.Status.Jinfan", // 禁反
    description: "XJZL.Status.JinfanDesc", 
    img: "icons/svg/shield.svg",
    flags: { "xjzl-system": { slug: "jinfan", stackable: false } },
    changes: [{ key: "flags.xjzl-system.blockCounter", mode: 5, value: "true" }]
  },
  {
    id: "jinqi",
    name: "XJZL.Status.Jinqi", // 禁气
    description: "XJZL.Status.JinqiDesc", 
    img: "icons/svg/daze.svg",
    flags: { "xjzl-system": { slug: "jinqi", stackable: false } },
    changes: [{ key: "flags.xjzl-system.blockQiZhao", mode: 5, value: "true" }]
  },
  {
    id: "jinjue",
    name: "XJZL.Status.Jinjue", // 禁绝
    description: "XJZL.Status.JinjueDesc", 
    img: "icons/svg/skull.svg",
    flags: { "xjzl-system": { slug: "jinjue", stackable: false } },
    changes: [{ key: "flags.xjzl-system.blockUltimate", mode: 5, value: "true" }]
  },
  {
    id: "jinliao",
    name: "XJZL.Status.Jinliao", // 禁疗
    description: "XJZL.Status.JinliaoDesc", 
    img: "icons/svg/bones.svg",
    flags: { "xjzl-system": { slug: "jinliao", stackable: false } },
    changes: [{ key: "flags.xjzl-system.noRecoverHP", mode: 5, value: "true" }]
  },
  {
    id: "qizhi",
    name: "XJZL.Status.Qizhi", // 气滞
    description: "XJZL.Status.QizhiDesc", 
    img: "icons/svg/net.svg",
    flags: { "xjzl-system": { slug: "qizhi", stackable: false } },
    changes: [{ key: "flags.xjzl-system.noRecoverNeili", mode: 5, value: "true" }]
  },
  {
    id: "poyi",
    name: "XJZL.Status.Poyi", // 破衣
    description: "XJZL.Status.PoyiDesc", 
    img: "icons/svg/shield.svg",
    flags: { "xjzl-system": { slug: "poyi", stackable: false } },
    changes: [
      { key: "flags.xjzl-system.ignoreArmorEffects", mode: 5, value: "true" }
    ]
  },
  {
    id: "tuoli",
    name: "XJZL.Status.Tuoli", // 脱力
    description: "XJZL.Status.TuoliDesc", 
    img: "icons/svg/falling.svg",
    flags: { "xjzl-system": { slug: "tuoli", stackable: false } },
    changes: [
      { key: "system.combat.xuzhao", mode: 2, value: "-3" },
      { key: "flags.xjzl-system.feintLevel", mode: 2, value: "-1" }
    ]
  },
  {
    id: "lianji",
    name: "XJZL.Status.Lianji", // 连击
    description: "XJZL.Status.LianjiDesc", 
    img: "icons/svg/lightning.svg",
    flags: { "xjzl-system": { slug: "lianji", stackable: false } },
    changes: []
  },
  {
    id: "cuoluan",
    name: "XJZL.Status.Cuoluan", // 错乱
    description: "XJZL.Status.CuoluanDesc", 
    img: "icons/svg/hazard.svg",
    flags: { "xjzl-system": { slug: "cuoluan", stackable: false } },
    changes: []
  },
  {
    id: "jiaoxie",
    name: "XJZL.Status.Jiaoxie", // 缴械
    description: "XJZL.Status.JiaoxieDesc", 
    img: "icons/svg/sword.svg",
    flags: { "xjzl-system": { slug: "jiaoxie", stackable: false } },
    changes: [{ key: "flags.xjzl-system.forceUnarmed", mode: 5, value: "true" }]
  },

  // ====================================================
  // 2. 叠加层数类 (Stackable)
  // ====================================================
  {
    id: "yangxue",
    name: "XJZL.Status.Yangxue", // 养血
    description: "XJZL.Status.YangxueDesc", 
    img: "icons/svg/heal.svg",
    flags: { "xjzl-system": { slug: "yangxue", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "flags.xjzl-system.regenHpTurnEnd", mode: 2, value: "10" }
    ]
  },
  {
    id: "juqi",
    name: "XJZL.Status.Juqi", // 聚气
    description: "XJZL.Status.JuqiDesc", 
    img: "icons/svg/light.svg",
    flags: { "xjzl-system": { slug: "juqi", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "flags.xjzl-system.regenMpTurnEnd", mode: 2, value: "5" }
    ]
  },
  {
    id: "qixu",
    name: "XJZL.Status.Qixu", // 气虚
    description: "XJZL.Status.QixuDesc", 
    img: "icons/svg/acid.svg",
    flags: { "xjzl-system": { slug: "qixu", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "flags.xjzl-system.regenMpTurnEnd", mode: 2, value: "-5" }
    ]
  },
  {
    id: "chengfeng",
    name: "XJZL.Status.Chengfeng", // 乘风
    description: "XJZL.Status.ChengfengDesc", 
    img: "icons/svg/wing.svg",
    flags: { "xjzl-system": { slug: "chengfeng", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.combat.speed", mode: 2, value: "1" }
    ]
  },
  {
    id: "gangjin",
    name: "XJZL.Status.Gangjin", // 刚劲
    description: "XJZL.Status.GangjinDesc", 
    img: "icons/svg/explosion.svg",
    flags: { "xjzl-system": { slug: "gangjin", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.combat.damages.gang.mod", mode: 2, value: "5" }
    ]
  },
  {
    id: "mianjin",
    name: "XJZL.Status.Mianjin", // 绵劲
    description: "XJZL.Status.MianjinDesc", 
    img: "icons/svg/ice-aura.svg",
    flags: { "xjzl-system": { slug: "mianjin", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.combat.damages.rou.mod", mode: 2, value: "5" }
    ]
  },
  {
    id: "panshi",
    name: "XJZL.Status.Panshi", // 磐石
    description: "XJZL.Status.PanshiDesc", 
    img: "icons/svg/castle.svg",
    flags: { "xjzl-system": { slug: "panshi", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.combat.block", mode: 2, value: "5" }
    ]
  },
  {
    id: "hushen",
    name: "XJZL.Status.Hushen", // 护身
    description: "XJZL.Status.HushenDesc", 
    img: "icons/svg/shield.svg",
    flags: { "xjzl-system": { slug: "hushen", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.combat.def_waigong", mode: 2, value: "5" },
      { key: "system.combat.def_neigong", mode: 2, value: "5" }
    ]
  },
  {
    id: "xujin",
    name: "XJZL.Status.Xujin", // 蓄劲
    description: "XJZL.Status.XujinDesc", 
    img: "icons/svg/target.svg",
    flags: { "xjzl-system": { slug: "xujin", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.combat.crit_waigong", mode: 2, value: "-1" },
      { key: "system.combat.crit_neigong", mode: 2, value: "-1" }
    ]
  },
  {
    id: "youyu",
    name: "XJZL.Status.Youyu", // 犹豫
    description: "XJZL.Status.YouyuDesc", 
    img: "systems/xjzl-system/assets/icons/ae/犹豫.svg",
    flags: { "xjzl-system": { slug: "youyu", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.combat.crit_waigong", mode: 2, value: "1" },
      { key: "system.combat.crit_neigong", mode: 2, value: "1" }
    ]
  },
  {
    id: "yanzhan",
    name: "XJZL.Status.Yanzhan", // 延展
    description: "XJZL.Status.YanzhanDesc", 
    img: "icons/svg/direction.svg",
    flags: { "xjzl-system": { slug: "yanzhan", stackable: true, maxStacks: 0 } },
    changes: []
  },
  {
    id: "yudun",
    name: "XJZL.Status.Yudun", // 愚钝
    description: "XJZL.Status.YudunDesc", 
    img: "icons/svg/daze.svg",
    flags: { "xjzl-system": { slug: "yudun", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.combat.xuzhao", mode: 2, value: "-1" },
      { key: "system.combat.kanpo", mode: 2, value: "-1" }
    ]
  },
  {
    id: "shizhun",
    name: "XJZL.Status.Shizhun", // 失准
    description: "XJZL.Status.ShizhunDesc", 
    img: "icons/svg/blind.svg",
    flags: { "xjzl-system": { slug: "shizhun", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.combat.hit_waigong", mode: 2, value: "-5" },
      { key: "system.combat.hit_neigong", mode: 2, value: "-5" }
    ]
  },
  {
    id: "yanli",
    name: "XJZL.Status.Yanli", // 眼力
    description: "XJZL.Status.YanliDesc", 
    img: "icons/svg/eye.svg",
    flags: { "xjzl-system": { slug: "yanli", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.combat.hit_waigong", mode: 2, value: "5" },
      { key: "system.combat.hit_neigong", mode: 2, value: "5" }
    ]
  },
  {
    id: "qingling",
    name: "XJZL.Status.Qingling", // 轻灵
    description: "XJZL.Status.QinglingDesc", 
    img: "icons/svg/angel.svg",
    flags: { "xjzl-system": { slug: "qingling", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.combat.dodge", mode: 2, value: "5" }
    ]
  },
  {
    id: "benzhuo",
    name: "XJZL.Status.Benzhuo", // 笨拙
    description: "XJZL.Status.BenzhuoDesc", 
    img: "icons/svg/anchor.svg",
    flags: { "xjzl-system": { slug: "benzhuo", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.combat.dodge", mode: 2, value: "-5" }
    ]
  },
  {
    id: "jinli",
    name: "XJZL.Status.Jinli", // 劲力
    description: "XJZL.Status.JinliDesc", 
    img: "icons/svg/combat.svg",
    flags: { "xjzl-system": { slug: "jinli", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.combat.damages.skill.mod", mode: 2, value: "5" }
    ]
  },
  {
    id: "wuqishi",
    name: "XJZL.Status.Wuqishi", // 武器势
    description: "XJZL.Status.WuqishiDesc", 
    img: "icons/svg/combat.svg",
    flags: { "xjzl-system": { slug: "wuqishi", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.combat.hit_waigong", mode: 2, value: "10" },
      { key: "system.combat.hit_neigong", mode: 2, value: "10" }
    ]
  },
  {
    id: "fali",
    name: "XJZL.Status.Fali", // 乏力
    description: "XJZL.Status.FaliDesc", 
    img: "icons/svg/downgrade.svg",
    flags: { "xjzl-system": { slug: "fali", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.combat.damages.skill.mod", mode: 2, value: "-10" }
    ]
  },
  {
    id: "chanshou",
    name: "XJZL.Status.Chanshou", // 颤手
    description: "XJZL.Status.ChanshouDesc", 
    img: "icons/svg/paralysis.svg",
    flags: { "xjzl-system": { slug: "chanshou", stackable: true, maxStacks: 5 } },
    changes: []
  },
  {
    id: "yishang",
    name: "XJZL.Status.Yishang", // 易伤
    description: "XJZL.Status.YishangDesc", 
    img: "icons/svg/ruins.svg",
    flags: { "xjzl-system": { slug: "yishang", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "flags.xjzl-system.bleedOnHit", mode: 2, value: "10" }
    ]
  },
  {
    id: "jinqi_stack",
    name: "XJZL.Status.JinqiStack", // 劲气
    description: "XJZL.Status.JinqiStackDesc", 
    img: "icons/svg/aura.svg",
    flags: { "xjzl-system": { slug: "jinqi_stack", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.combat.damages.skill.mod", mode: 2, value: "10" }
    ]
  },

  // ====================================================
  // 3. 特殊命名类 (Named Special)
  // ====================================================
  {
    id: "unstable",
    name: "XJZL.Status.Unstable", // 下盘不稳
    description: "XJZL.Status.UnstableDesc", 
    img: "icons/svg/falling.svg",
    flags: { "xjzl-system": { slug: "unstable", stackable: false } },
    changes: [
      { key: "flags.xjzl-system.unstable", mode: 5, value: "true" }
    ]
  },
  {
    id: "blind",
    name: "XJZL.Status.Blind", // 目盲
    description: "XJZL.Status.BlindDesc", 
    img: "icons/svg/blind.svg",
    flags: { "xjzl-system": { slug: "blind", stackable: false } },
    changes: [
      { key: "flags.xjzl-system.attackLevel", mode: 2, value: "-1" },
      { key: "flags.xjzl-system.feintLevel", mode: 2, value: "-1" },
      { key: "flags.xjzl-system.grantAttackLevel", mode: 2, value: "1" }
    ]
  },
  {
    id: "deaf",
    name: "XJZL.Status.Deaf", // 耳鸣
    description: "XJZL.Status.DeafDesc", 
    img: "icons/svg/sound.svg",
    flags: { "xjzl-system": { slug: "deaf", stackable: false } },
    changes: [
      { key: "flags.xjzl-system.grantAttackLevel", mode: 2, value: "1" }
    ]
  },
  {
    id: "root",
    name: "XJZL.Status.Root", // 禁足
    description: "XJZL.Status.RootDesc", 
    img: "icons/svg/trap.svg",
    flags: { "xjzl-system": { slug: "root", stackable: false } },
    changes: [
      { key: "flags.xjzl-system.forceSpeedZero", mode: 5, value: "true" },
      { key: "flags.xjzl-system.forceDodgeZero", mode: 5, value: "true" }
    ]
  },
  {
    id: "cuogu",
    name: "XJZL.Status.Cuogu", // 错骨
    description: "XJZL.Status.CuoguDesc", 
    img: "icons/svg/bones.svg",
    flags: { "xjzl-system": { slug: "cuogu", stackable: false } },
    changes: [
      { key: "flags.xjzl-system.attackLevel", mode: 2, value: "-1" },
      { key: "system.combat.kanpo", mode: 2, value: "-5" },
      { key: "system.combat.resistances.global.mod", mode: 2, value: "-10" }
    ]
  },
  {
    id: "fushen",
    name: "XJZL.Status.Fushen", // 缚身
    description: "XJZL.Status.FushenDesc", 
    img: "icons/svg/net.svg",
    flags: { "xjzl-system": { slug: "fushen", stackable: false } },
    changes: []
  },
  {
    id: "chizhi",
    name: "XJZL.Status.Chizhi", // 迟滞
    description: "XJZL.Status.ChizhiDesc", 
    img: "icons/svg/downgrade.svg",
    flags: { "xjzl-system": { slug: "chizhi", stackable: false } },
    changes: []
  },
  {
    id: "fengzhao",
    name: "XJZL.Status.Fengzhao", // 封招
    description: "XJZL.Status.FengzhaoDesc", 
    img: "icons/svg/padlock.svg",
    flags: { "xjzl-system": { slug: "fengzhao", stackable: false } },
    changes: []
  },
  {
    id: "stun", // 定身
    name: "XJZL.Status.Stun",
    description: "XJZL.Status.StunDesc", 
    img: "icons/svg/stoned.svg",
    flags: { "xjzl-system": { slug: "stun", stackable: false } },
    changes: [
      { key: "flags.xjzl-system.forceSpeedZero", mode: 5, value: "true" },
      { key: "flags.xjzl-system.forceDodgeZero", mode: 5, value: "true" },
      { key: "flags.xjzl-system.stun", mode: 5, value: "true" },
      { key: "flags.xjzl-system.blockStance", mode: 5, value: "true" }
    ]
  },
  {
    id: "dianxue",
    name: "XJZL.Status.Dianxue", // 点穴
    description: "XJZL.Status.DianxueDesc", 
    img: "icons/svg/target.svg",
    flags: { "xjzl-system": { slug: "dianxue", stackable: false } },
    changes: [
      { key: "flags.xjzl-system.forceSpeedZero", mode: 5, value: "true" },
      { key: "flags.xjzl-system.forceDodgeZero", mode: 5, value: "true" },
      { key: "flags.xjzl-system.stun", mode: 5, value: "true" }
    ]
  },
  {
    id: "xuanyun",
    name: "XJZL.Status.Xuanyun", // 眩晕
    description: "XJZL.Status.XuanyunDesc", 
    img: "icons/svg/daze.svg",
    flags: { "xjzl-system": { slug: "xuanyun", stackable: false } },
    changes: [
      { key: "flags.xjzl-system.stun", mode: 5, value: "true" }
    ]
  },
  {
    id: "rage",
    name: "XJZL.Status.Rage", // 走火入魔
    description: "XJZL.Status.RageDesc", 
    img: "icons/svg/skull.svg",
    flags: { "xjzl-system": { slug: "rage", stackable: false } },
    changes: []
  },
  {
    id: "zibi",
    name: "XJZL.Status.Zibi", // 自闭
    description: "XJZL.Status.ZibiDesc", 
    img: "icons/svg/sleep.svg",
    flags: { "xjzl-system": { slug: "zibi", stackable: false } },
    changes: []
  },
  {
    id: "prone",
    name: "XJZL.Status.Prone", // 倒地
    description: "XJZL.Status.ProneDesc",
    img: "icons/svg/falling.svg",
    flags: { "xjzl-system": { slug: "prone", stackable: false } },
    changes: [
      { key: "flags.xjzl-system.grantAttackLevel", mode: 2, value: "1" },
      { key: "flags.xjzl-system.feintLevel", mode: 2, value: "-1" }
    ]
  },
  {
    id: "fatigue",
    name: "XJZL.Status.Fatigue", // 疲劳
    description: "XJZL.Status.FatigueDesc",
    img: "icons/svg/statue.svg",
    flags: { "xjzl-system": { slug: "fatigue", stackable: false } },
    changes: [
      { key: "flags.xjzl-system.attackLevel", mode: 2, value: "-1" },
      { key: "flags.xjzl-system.feintLevel", mode: 2, value: "-1" }
    ]
  },
  {
    id: "hunger",
    name: "XJZL.Status.Hunger", // 饥饿
    description: "XJZL.Status.HungerDesc",
    img: "icons/svg/acid.svg", // 如果没有，可用 acid
    flags: { "xjzl-system": { slug: "hunger", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "system.attributes.tipo.mod", mode: 2, value: "-1" }
    ]
  },
  {
    id: "bleed_stack", // 流血
    name: "XJZL.Status.BleedStack", // 流血
    description: "XJZL.Status.BleedStackDesc",
    img: "icons/svg/blood.svg",
    flags: { "xjzl-system": { slug: "bleed_stack", stackable: true, maxStacks: 0 } },
    changes: [
      // 每层回合初流失 10 气血 -> 负数回复
      { key: "flags.xjzl-system.regenHpTurnStart", mode: 2, value: "-10" }
    ]
  },
  {
    id: "pain",
    name: "XJZL.Status.Pain", // 剧痛
    description: "XJZL.Status.PainDesc",
    img: "icons/svg/lightning.svg",
    flags: { "xjzl-system": { slug: "pain", stackable: false } },
    changes: [
      { key: "flags.xjzl-system.unstable", mode: 5, value: "true" }, // 速度减半(复用下盘不稳Flag)
      { key: "flags.xjzl-system.attackLevel", mode: 2, value: "-1" },
      { key: "flags.xjzl-system.feintLevel", mode: 2, value: "-1" }
    ]
  },
  {
    id: "bloodloss",
    name: "XJZL.Status.BloodLoss", // 失血
    description: "XJZL.Status.BloodLossDesc",
    img: "icons/svg/skull.svg",
    flags: { "xjzl-system": { slug: "bloodloss", stackable: true, maxStacks: 0 } },
    changes: [
      { key: "flags.xjzl-system.bloodLossLevel", mode: 2, value: "1" }
    ]
  },
  {
    id: "unconscious",
    name: "XJZL.Status.Unconscious", // 昏迷
    description: "XJZL.Status.UnconsciousDesc",
    img: "icons/svg/unconscious.svg",
    flags: { "xjzl-system": { slug: "unconscious", stackable: false } },
    changes: [
      { key: "flags.xjzl-system.stun", mode: 5, value: "true" },
    ]
  }
];
