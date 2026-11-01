/**
 * AE 构造期时长回归：父类 mock 保留 V14 在构造返回前调用派生方法的顺序，
 * 时长计算使用真实 XJZLActiveEffect；时间制准备仅记录交给核心的参数。
 * 不模拟核心的异常捕获层，确保构造期错误直接使回归失败。
 * 运行：node tests/effect-duration.test.mjs
 */
import assert from "node:assert/strict";

const timePreparations = [];
globalThis.ActiveEffect = class {
  constructor(source) {
    this._source = structuredClone(source);
    this.start = this._source.start;
    this.duration = this._prepareCombatBasedDuration({ ...this._source.duration });
  }
  _prepareTimeBasedDuration(duration) {
    timePreparations.push(duration);
    return duration;
  }
};
globalThis.foundry = { data: { fields: {} } };
globalThis.CONFIG = { time: { roundTime: 2 } };
let mode = "initiative";
globalThis.game = {
  _documentsReady: true,
  combats: new Map(),
  combat: null,
  settings: { get: () => mode },
  i18n: {
    localize: key => key,
    pluralRules: new Intl.PluralRules("zh-CN"),
    format: (key, values) => `${key}:${JSON.stringify(values)}`
  }
};

const { XJZLActiveEffect } = await import("../module/documents/active-effect.mjs");
let passed = 0;
const pass = label => console.log(`  ✓ ${++passed}. ${label}`);

for (const [units, expectedSeconds] of [["rounds", 6], ["turns", 3]]) {
  const effect = new XJZLActiveEffect({ duration: { value: 3, units } });
  assert.equal(effect.duration.units, "seconds");
  assert.equal(effect.duration.value, expectedSeconds);
  assert.equal(timePreparations.at(-1), effect.duration);
  pass(`战斗外 ${units}：首次构造即完成换算并交给核心`);
}

// 初始世界加载阶段不得提前进入依赖完整游戏状态的时间制准备。
game._documentsReady = false;
const preparationCount = timePreparations.length;
const loadingEffect = new XJZLActiveEffect({ duration: { value: 3, units: "rounds" } });
assert.equal(loadingEffect.duration.remaining, Infinity);
assert.equal(timePreparations.length, preparationCount);
game._documentsReady = true;
pass("世界加载期间首次构造保留无限剩余显示，不提前调用核心时间制准备");

const combatant = { id: "c1", roundJoined: 2, turnNumber: 0 };
const combat = {
  id: "combat", started: true, round: 3, turn: 1,
  combatants: new Map([[combatant.id, combatant]]),
  turns: [combatant, { id: "c2" }, { id: "c3" }],
  getFlag: () => 5
};
game.combats.set(combat.id, combat);
const start = { combat: combat.id, combatant: combatant.id, round: 2, turn: 0, initiative: 10 };
for (const [units, expectedRemaining] of [["rounds", 4], ["turns", 1]]) {
  const effect = new XJZLActiveEffect({ start, duration: { value: 5, units, expiry: "turnStart" } });
  assert.equal(effect.duration.units, units);
  assert.equal(effect.duration.remaining, expectedRemaining);
  pass(`战斗内 ${units}：首次构造即派生正确剩余量，覆盖两层时长助手调用`);
}

mode = "combatant";
const countedEffect = new XJZLActiveEffect({
  start, duration: { value: 5, units: "rounds", expiry: "turnStart" },
  flags: { "xjzl-system": { effectTurnStart: { combatId: combat.id, combatantId: combatant.id, count: 2 } } }
});
assert.equal(countedEffect.duration.remaining, 2);
const context = { combat, round: 3, turn: 0, combatantId: combatant.id, effectTurnCounts: { c1: 4 } };
assert.equal(countedEffect._prepareCombatBasedDuration({ ...countedEffect._source.duration }, context).remaining, 3);
assert.equal(countedEffect.isExpiryEvent("turnStart", context), false);
assert.equal(countedEffect.isExpiryEvent("turnStart", { ...context, effectTurnCounts: { c1: 7 } }), true);
assert.equal(countedEffect.isExpiryEvent("turnStart", { ...context, combatantId: "c2", effectTurnCounts: { c1: 7 } }), false);
pass("角色计数模式保留事件快照、来源身份与到期判断");

console.log(`\n全部 ${passed} 组断言通过。`);
