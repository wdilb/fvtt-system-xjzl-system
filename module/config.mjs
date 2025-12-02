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