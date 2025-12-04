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