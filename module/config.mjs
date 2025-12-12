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
  counter: "XJZL.Wuxue.Type.counter",
  ultimate: "XJZL.Wuxue.Type.ultimate"
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
  special: "XJZL.Combat.Rank.Special"
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
  liushi: "XJZL.Damage.Liushi"    // 流失 (真实伤害)
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

// 15. 系统状态标志 (逻辑开关)
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
  bleedOnHit: "XJZL.Status.BleedOnHit",           // 受伤时流失气血 (通用易伤/撕裂)
  wuxueBleedOnHit: "XJZL.Status.WuxueBleedOnHit",  // 仅受到内外功伤害时流失气血 (内伤/旧疾)

  // --- E. 其他类  ---
  passiveBlock: "XJZL.Status.PassiveBlock",     // 被动格挡：即使未开启架招，基础格挡值依然生效

  // --- F. 攻击穿透类 (Attacker Penetration) ---
  // 攻击者拥有此状态时，其攻击将获得对应效果
  ignoreBlock: "XJZL.Status.IgnoreBlock",       // 攻击无视格挡
  ignoreDefense: "XJZL.Status.IgnoreDefense",   // 攻击无视防御
  ignoreStance: "XJZL.Status.IgnoreStance",     // 攻击无视/不触发架招特效
};

// 16. 检定优劣势计数器 (Check Flags)
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
