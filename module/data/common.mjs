/**
 * 模块：module/data/common.mjs
 * 职责：定义通用的数据字段 (Schema) 和常量
 */

const fields = foundry.data.fields;

// 1. 定义触发时机常量 (方便代码中引用，防止拼写错误)
export const SCRIPT_TRIGGERS = {
  PASSIVE: "passive",       // [同步] 被动常驻 (prepareDerivedData)
  CALC: "calc",             // [同步] 伤害计算修正 (calculateMoveDamage)
  ATTACK: "attack",         // [异步] 出招/掷骰前 (决定优势、资源、是否允许出招)
  CHECK: "check",           // [同步] 检定修正（仅用于那些需要目标又在命中前生效的特效）
  HIT: "hit",               // [异步] 命中/结算后 (应用BUFF、扣血、副作用)
  HIT_ONCE: "hit_once",     // [异步] 命中/结算后 和上面的唯一区别是这个只执行一次，不管几个目标
  PRE_DAMAGE: "preDamage",  // [异步] 伤害结算前：命中/暴击已定，防御计算前，存在这种时点才能实现的脚本，比如我们亲爱的晓哥的关山里的命中之后转换为火焰伤害的武学
  DAMAGED: "damaged",       // [异步] 防御者触发：受伤时
  DYING: "dying",           // [异步] 气血归零，进入濒死状态时触发
  DEATH: "death",           // [异步] 内力归零，角色彻底死亡时触发
  TURN_START: "turnStart",  // [异步] 回合开始
  TURN_END: "turnEnd",      // [异步] 回合结束
  COMBAT_START: "combatStart", // [异步] 战斗开始
  // EQUIP: "equip",           // [异步] 装备/卸下时 (特殊逻辑)
};

// 2. 定义触发器的显示标签 (用于下拉菜单)
export const TRIGGER_CHOICES = {
  [SCRIPT_TRIGGERS.PASSIVE]: "XJZL.Triggers.Passive",
  [SCRIPT_TRIGGERS.CALC]: "XJZL.Triggers.Calc",
  [SCRIPT_TRIGGERS.ATTACK]: "XJZL.Triggers.Attack",
  [SCRIPT_TRIGGERS.CHECK]: "XJZL.Triggers.Check",
  [SCRIPT_TRIGGERS.HIT]: "XJZL.Triggers.Hit",
  [SCRIPT_TRIGGERS.HIT_ONCE]: "XJZL.Triggers.HitOnce",
  [SCRIPT_TRIGGERS.PRE_DAMAGE]: "XJZL.Triggers.PreDamage",
  [SCRIPT_TRIGGERS.DAMAGED]: "XJZL.Triggers.Damaged",
  [SCRIPT_TRIGGERS.DYING]: "XJZL.Triggers.Dying",
  [SCRIPT_TRIGGERS.DEATH]: "XJZL.Triggers.Death",
  [SCRIPT_TRIGGERS.TURN_START]: "XJZL.Triggers.TurnStart",
  [SCRIPT_TRIGGERS.TURN_END]: "XJZL.Triggers.TurnEnd",
  [SCRIPT_TRIGGERS.COMBAT_START]: "XJZL.Triggers.CombatStart",
  // [SCRIPT_TRIGGERS.EQUIP]: "XJZL.Triggers.Equip"
};

/**
 * 3. 脚本特效数据结构 (Schema)
 * 这是一个 SchemaField，不是 DataModel，可以直接嵌套在其他模型里
 */
export const makeScriptEffectSchema = () => new fields.SchemaField({
  // 特效名称 (方便 GM 管理，如 "寒冰真气-减速")
  label: new fields.StringField({ required: true, initial: "新特效" }),
  
  // 触发时机 (下拉菜单选择)
  trigger: new fields.StringField({ 
    required: true, 
    initial: SCRIPT_TRIGGERS.PASSIVE, 
    // choices 在 Sheet 层渲染，这里仅作存储校验
    choices: Object.keys(TRIGGER_CHOICES), // 限制只能选定义好的类型
    label: "XJZL.Effect.Trigger" 
  }),

  // 脚本内容 (多行文本)
  script: new fields.StringField({ 
    required: true, 
    initial: "", 
    widget: "textarea", // 让 FVTT 自动渲染成大文本框
    label: "XJZL.Effect.Script" 
  }),

  // 开关 (方便临时禁用某个逻辑)
  active: new fields.BooleanField({ initial: true, label: "XJZL.Effect.Active" })
});