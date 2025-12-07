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
  HIT: "hit",               // [异步] 命中/结算后 (应用BUFF、扣血、副作用)
  DAMAGED: "damaged",   // 【新增】防御者触发：受伤时
  TURN_START: "turnStart",  // [异步] 回合开始
  TURN_END: "turnEnd",      // [异步] 回合结束
  // EQUIP: "equip",           // [异步] 装备/卸下时 (特殊逻辑)
};

// 2. 定义触发器的显示标签 (用于下拉菜单)
export const TRIGGER_CHOICES = {
  [SCRIPT_TRIGGERS.PASSIVE]: "XJZL.Triggers.Passive",
  [SCRIPT_TRIGGERS.CALC]: "XJZL.Triggers.Calc",
  [SCRIPT_TRIGGERS.ATTACK]: "XJZL.Triggers.Attack",
  [SCRIPT_TRIGGERS.HIT]: "XJZL.Triggers.Hit",
  [SCRIPT_TRIGGERS.DAMAGED]: "XJZL.Triggers.Damaged",
  [SCRIPT_TRIGGERS.TURN_START]: "XJZL.Triggers.TurnStart",
  [SCRIPT_TRIGGERS.TURN_END]: "XJZL.Triggers.TurnEnd",
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