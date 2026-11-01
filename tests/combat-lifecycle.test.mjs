/**
 * 战斗流转三时机（combatStart/turnStart/turnEnd）第三步回归：
 * 活动 GM 本地等待执行、事件 round/turn 快照、事件 Combat/Combatant 上下文、
 * ask 战斗作用域绑定与战斗删除取消、迁移后官方脚本编译与关键行为抽查。
 *
 * 只替换网络（socketlib）、UI（DialogV2）与 Foundry 全局边界；脚本运行器、
 * 交互管理器与迁移后 data/ 脚本全部走真实实现。
 *
 * 运行：node --experimental-vm-modules tests/combat-lifecycle.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join as joinPath } from "node:path";
import { SourceTextModule, SyntheticModule } from "node:vm";

const root = fileURLToPath(new URL("../", import.meta.url));
let sequence = 0;

const getProperty = (object, path) => {
  if (!object || !path) return undefined;
  if (path in object) return object[path];
  return path.split(".").reduce((value, key) => value?.[key], object);
};
const setProperty = (object, path, value) => {
  const keys = path.split(".");
  let parent = object;
  for (const key of keys.slice(0, -1)) parent = parent[key] ??= {};
  parent[keys.at(-1)] = value;
};

/* -------------------------------------------- */
/*  Foundry 全局 mock（必须先于模块导入）          */
/* -------------------------------------------- */

globalThis.CONST = {
  DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 },
  TOKEN_DISPOSITIONS: { HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1, SECRET: -2 }
};

globalThis.foundry = {
  data: { fields: {} },
  abstract: { Document: class MockDocument { } },
  documents: { Actor: class MockActorBase { }, ActiveEffect: class MockEffectBase { } },
  utils: {
    randomID: () => `id${++sequence}`,
    getProperty,
    setProperty,
    deepClone: structuredClone,
    isEmpty: value => !value || Object.keys(value).length === 0,
    mergeObject: (base, patch) => {
      const out = structuredClone(base);
      for (const [key, value] of Object.entries(patch)) out[key] = value;
      return out;
    }
  },
  applications: {
    api: { DialogV2: {} },
    handlebars: { renderTemplate: async () => "mock-template" }
  }
};

const rollCalls = [];
globalThis.Roll = class MockRoll {
  constructor(formula, data) {
    this.formula = formula;
    this.data = data;
    rollCalls.push(this);
  }
  async evaluate() { this.total = globalThis.__rollTotal ?? 15; return this; }
  async toMessage() { return {}; }
  async roll() { this.total = globalThis.__rollTotal ?? 15; return this; }
};

globalThis.CONFIG = { XJZL: {}, statusEffects: {} };

const chatMessages = [];
globalThis.ChatMessage = {
  getSpeaker: ({ actor }) => ({ actor: actor?.name ?? null }),
  create: async data => { chatMessages.push(data); return data; }
};

const notices = [];
globalThis.ui = { notifications: {
  info: message => notices.push(message),
  warn: message => notices.push(message),
  error: message => notices.push(message)
} };

// 画布探针：任何迁移后脚本触碰当前画布即测试失败（事件上下文不应读取画布）。
let canvasTouched = null;
globalThis.canvas = {
  get scene() { canvasTouched = "scene"; return { tokens: [wrongToken] }; },
  get tokens() { canvasTouched = "tokens"; return { placeables: [wrongToken] }; },
  get ready() { canvasTouched = "ready"; return true; }
};
const wrongToken = { name: "画布上的无关Token", disposition: 1, actor: { name: "画布无关", uuid: "Actor.wrong" }, document: { disposition: 1, hidden: false } };

globalThis.document = { getElementById: () => null };
globalThis.Item = class MockItem { };
globalThis.ActiveEffect = class MockActiveEffect { };
globalThis.Actor = class MockActorRoot { };

const registry = new Map(); // uuid → 文档（fromUuid 边界）
globalThis.fromUuid = async uuid => registry.get(uuid) ?? null;

const hookHandlers = new Map();
globalThis.Hooks = {
  on(name, fn) {
    if (!hookHandlers.has(name)) hookHandlers.set(name, []);
    hookHandlers.get(name).push(fn);
  },
  callAll(name, ...args) { for (const fn of hookHandlers.get(name) ?? []) fn(...args); },
  call: (name, ...args) => (hookHandlers.get(name) ?? []).every(fn => fn(...args) !== false)
};

const statusTemplates = {
  chengfeng: { name: "乘风", img: "icons/svg/wind.svg" }
};
const addedEffects = [];
const auraCalls = { create: [], query: [], exists: [], dismiss: [] };
const socketCalls = [];

let serverTime = 1_000_000_000_000;

// 当前查看的战斗：与事件 Combat 故意不同，证明脚本走事件上下文。
const viewedCombat = { id: "combat-viewed", uuid: "Combat.combat-viewed", round: 99, turn: 8, combatants: [] };

const gameMock = {
  user: null,
  users: [],
  combats: new Map(),
  get combat() { return viewedCombat; },
  time: { get serverTime() { return serverTime; }, worldTime: 0 },
  settings: { get: () => false },
  i18n: {
    localize: key => key,
    format: (key, values) => `${key}:${JSON.stringify(values ?? {})}`
  },
  xjzl: {
    socket: {
      executeAsGM: async (...args) => { socketCalls.push(args); return gameMock.__huaguEntries ?? []; }
    },
    api: {
      effects: {
        getStatus: slug => statusTemplates[slug] ? structuredClone(statusTemplates[slug]) : undefined,
        addEffect: async (actor, data, count = 1) => {
          addedEffects.push({ actor: actor?.name ?? null, name: data?.name ?? data?.id ?? null, data, count });
          return { id: `added-${addedEffects.length}` };
        },
        removeEffect: async (actor, slug, amount = 1) => {
          const effect = (actor.effects ?? []).find(e => e.getFlag("xjzl-system", "slug") === slug);
          if (!effect) return undefined;
          (actor.effects ?? []).splice((actor.effects ?? []).indexOf(effect), 1);
          return effect;
        }
      }
    },
    aura: {
      create: async (source, params) => { auraCalls.create.push({ source, params }); return { id: `region-${auraCalls.create.length}` }; },
      query: (label, options) => { auraCalls.query.push({ label, options }); return auraQueries.shift() ?? []; },
      exists: (label, source, options) => { auraCalls.exists.push({ label, source, options }); return auraExists.shift() ?? false; },
      dismiss: async (label, options) => { auraCalls.dismiss.push({ label, options }); return 1; }
    }
  }
};
globalThis.game = gameMock;

const auraQueries = [];
const auraExists = [];

const socketStub = {
  executeAsUser: async (...args) => { socketCalls.push(args); },
  executeAsGM: async (...args) => { socketCalls.push(args); return null; }
};

/* -------------------------------------------- */
/*  模块加载                                      */
/* -------------------------------------------- */

const stubs = new Map([
  ["module/socket.mjs", { xjzlSocket: socketStub }],
  ["module/utils/macros.mjs", { XJZLMacros: {} }],
  ["module/managers/combat-fx-manager.mjs", { queueHitEffect: () => {} }],
  ["module/region/xjzl-aura-manager.mjs", { AuraManager: {} }],
  ["module/applications/action-tracker.mjs", { ActionTracker: {} }],
  ["module/data/actor/container.mjs", { DEFAULT_CONTAINER_IMAGES: {} }]
].map(([path, exports]) => [resolve(root, path), exports]));
const modules = new Map();

function loadModule(path) {
  if (modules.has(path)) return modules.get(path);
  const exports = stubs.get(path);
  const module = exports
    ? new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { identifier: path })
    : new SourceTextModule(readFileSync(path, "utf8"), { identifier: path });
  modules.set(path, module);
  return module;
}

async function importModule(path) {
  const module = loadModule(resolve(root, path));
  if (module.status === "unlinked") {
    await module.link((specifier, parent) => loadModule(resolve(dirname(parent.identifier), specifier)));
  }
  await module.evaluate();
  return module.namespace;
}

const { SCRIPT_TRIGGERS } = await importModule("module/data/common.mjs");
const { XJZLActor } = await importModule("module/documents/actor.mjs");
const { runCombatLifecycleScripts, isCombatEventLive } = await importModule("module/utils/combat-lifecycle.mjs");
const manager = await importModule("module/managers/script-interaction-manager.mjs");
await importModule("module/applications/script-interaction-dialog.mjs");
const { createScriptAsk, initScriptInteraction } = manager;
const { SCRIPT_INTERACTION_STATUS, XJZLScriptAbortError } =
  await importModule("module/utils/script-interaction-policy.mjs");

/* -------------------------------------------- */
/*  测试工具                                      */
/* -------------------------------------------- */

let passed = 0;
function pass(label) { console.log(`  ✓ ${++passed}. ${label}`); }

function makeUser(id, { isGM = false, active = true } = {}) {
  return {
    id, name: id, isGM, active, character: null, queryCalls: [],
    async query(name, data, options) {
      this.queryCalls.push({ name, data, options });
      if (this.pendingQuery) return this.pendingQuery.promise;
      return this.nextQueryResult ?? { requestId: data.requestId, status: "cancelled", reason: "mock-default" };
    }
  };
}

function setClient(activeUser, users, activeGMId = null) {
  gameMock.user = activeUser;
  const collection = [...users];
  collection.get = id => collection.find(user => user.id === id) ?? null;
  collection.activeGM = users.find(user => user.id === activeGMId) ?? null;
  gameMock.users = collection;
}

/** 构造 XJZLActor 原型实例；collectScripts 由用例注入，资源与效果 API 记录调用。 */
function makeLifecycleActor(uuid, name, { ownership = null, hp = 50, mp = 10 } = {}) {
  const actor = Object.assign(Object.create(XJZLActor.prototype), {
    uuid, name, type: "character", isToken: false, token: null,
    ownership: ownership ?? { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    isOwner: true,
    system: {
      resources: {
        hp: { value: hp, max: 100 },
        mp: { value: mp, max: 10 },
        rage: { value: 0, max: 10 },
        morale: { value: 0, max: 100 }
      },
      martial: {}
    },
    _source: { system: { resources: {} } },
    xjzlStatuses: {},
    _resourceScriptCache: false,
    effects: [],
    items: { get: () => null, find: () => null, some: () => false, filter: () => [] },
    healCalls: [],
    regenCalls: [],
    collectedByTrigger: new Map(),
    testUserPermission(user, permission) {
      // 与核心口径一致的简化判定：GM 恒为 OWNER，其余按 ownership 表；权限串转数值。
      const level = typeof permission === "string" ? CONST.DOCUMENT_OWNERSHIP_LEVELS[permission] : permission;
      return Boolean(user.isGM || ((this.ownership?.[user.id] ?? this.ownership?.default ?? 0) >= level));
    }
  });
  actor.applyHealing = async data => {
    actor.healCalls.push(data);
    return { actualHeal: data.amount ?? 0, type: data.type };
  };
  actor.damageCalls = [];
  actor.applyDamage = async data => { actor.damageCalls.push(data); return { finalDamage: data.amount ?? 0, hpLost: data.amount ?? 0 }; };
  actor.processRegen = async timing => { actor.regenCalls.push(timing); };
  actor.showFloatyText = async () => {};
  return actor;
}

/** 真实收集注入：按 trigger 返回脚本条目（entry.source 为 Item/AE 模拟对象）。 */
function stubCollectScripts(actor, entriesByTrigger) {
  actor.collectScripts = function (trigger) {
    actor.collectedByTrigger.set(trigger, (actor.collectedByTrigger.get(trigger) ?? 0) + 1);
    return entriesByTrigger[trigger] ?? [];
  };
}

/** 事件 Combat/Combatant mock；placedRound/turn 表示活文档可继续变化。 */
function makeCombat({ id = `combat-${++sequence}`, round = 1, turn = 0, sceneTokens = [], combatantTokens = [] } = {}) {
  const combat = {
    id,
    uuid: `Combat.${id}`,
    round,
    turn,
    scene: { tokens: sceneTokens },
    combatants: [],
    getFlag: () => []
  };
  // 真实 Combat.combatants 为 Collection：runner 在自动回复后按 id 复核参战者身份。
  combat.combatants.get = combatantId => combat.combatants.find(c => c.id === combatantId) ?? null;
  combat.getFlag = (scope, key) => (key === "huaguAdded" ? combat.huaguAdded ?? [] : []);
  for (const token of combatantTokens) {
    const combatant = {
      id: `combatant-${token.name}`,
      name: token.name,
      token,
      actor: token.actor
    };
    combat.combatants.push(combatant);
  }
  gameMock.combats.set(id, combat);
  return combat;
}

/** 以真实 runScripts 执行一段官方脚本文本，返回脚本可见的沙盒副作用。 */
async function runOneScript(actor, trigger, script, context = {}, entrySource = null) {
  stubCollectScripts(actor, { [trigger]: [{ script, label: "回归脚本", source: entrySource }] });
  await actor.runScripts(trigger, context);
}

/* -------------------------------------------- */
/*  A. 活动 GM 本地执行契约                        */
/* -------------------------------------------- */

console.log("A. 活动 GM 本地执行契约");

{
  const combat = makeCombat({ round: 3, turn: 2 });
  const actor = makeLifecycleActor("Actor.a2", "甲");
  gameMock.__log = [];
  stubCollectScripts(actor, {
    turnStart: [{ script: "game.__log.push({round, turn, combatId: combat.id, argsRound: args.round, argsTurn: args.turn, selfCombatant: combatant.actor === actor});", label: "s", source: null }]
  });
  const combatant = { id: "c1", actor, token: { name: "甲Token" } };
  combat.combatants.push(combatant);
  await runCombatLifecycleScripts({ combat, combatants: combatant, trigger: "turnStart", round: 3, turn: 2 });
  assert.deepEqual(actor.regenCalls, ["TurnStart"], "turnStart 先执行 processRegen(TurnStart)");
  assert.deepEqual(gameMock.__log, [{ round: 3, turn: 2, combatId: combat.id, argsRound: 3, argsTurn: 2, selfCombatant: true }],
    "脚本读取事件 round/turn 快照与 args.combat/combatant");
}
pass("turnStart：先 processRegen 再脚本；注入事件 Combat/Combatant 与 round/turn 快照");

{
  const combat = makeCombat({ round: 3, turn: 2 });
  const actor = makeLifecycleActor("Actor.a3", "甲");
  gameMock.__log = [];
  stubCollectScripts(actor, { turnEnd: [{ script: "game.__log.push('script:' + round + ':' + turn);", label: "s", source: null }] });
  const combatant = { id: "c1", actor };
  combat.combatants.push(combatant);
  await runCombatLifecycleScripts({ combat, combatants: combatant, trigger: "turnEnd", round: 2, turn: 5 });
  assert.deepEqual(actor.regenCalls, ["TurnEnd"], "turnEnd 执行 processRegen(TurnEnd)");
  assert.deepEqual(gameMock.__log, ["script:2:5"], "脚本在回复后执行，并使用上一回合 round/turn 快照");
}
pass("turnEnd：processRegen(TurnEnd) 与上一回合快照由调用方传入，脚本确实随后执行");

{
  const combat = makeCombat({ round: 1, turn: 0 });
  const actors = [makeLifecycleActor("Actor.b1", "乙1"), makeLifecycleActor("Actor.b2", "乙2")];
  gameMock.__log = [];
  for (const actor of actors) {
    stubCollectScripts(actor, {
      combatStart: [{ script: "game.__log.push({name: actor.name, round, turn, argsCombatant: combatant.actor.name});", label: "s", source: null }]
    });
  }
  const combatants = actors.map(actor => ({ id: `c-${actor.name}`, actor }));
  combat.combatants.push(...combatants);
  await runCombatLifecycleScripts({ combat, combatants, trigger: "combatStart", round: 1, turn: 0, parallel: true });
  assert.deepEqual(gameMock.__log, [
    { name: "乙1", round: 1, turn: 0, argsCombatant: "乙1" },
    { name: "乙2", round: 1, turn: 0, argsCombatant: "乙2" }
  ], "每个 Combatant 收到自己的 combatant 引用与同一事件快照");
  assert.deepEqual(actors.map(a => a.regenCalls), [[], []], "combatStart 无 processRegen");
}
pass("combatStart：并行执行且每个 Combatant 获得自身引用");

{
  const combat = makeCombat({ round: 2, turn: 1 });
  const okActor = makeLifecycleActor("Actor.c1", "正常者");
  const badActor = makeLifecycleActor("Actor.c2", "出错者");
  gameMock.__log = [];
  stubCollectScripts(okActor, { turnStart: [{ script: "game.__log.push(round);", label: "s", source: null }] });
  stubCollectScripts(badActor, { turnStart: [{ script: "throw new Error('脚本内部错误');", label: "s", source: null }] });
  const cBad = { id: "c1", actor: badActor };
  const cOk = { id: "c2", actor: okActor };
  combat.combatants.push(cBad, cOk);
  await runCombatLifecycleScripts({
    combat, combatants: [cBad, cOk],
    trigger: "turnStart", round: 2, turn: 1
  });
  assert.deepEqual(gameMock.__log, [2], "一个宿主的脚本错误不影响其他宿主继续执行");
}
pass("单宿主脚本错误保持隔离，其他宿主继续");

{
  const combat = makeCombat({ round: 2, turn: 1 });
  const actor = makeLifecycleActor("Actor.d1", "等待者");
  gameMock.__log = [];
  stubCollectScripts(actor, { turnStart: [{ script: "game.__log.push(round);", label: "s", source: null }] });
  gameMock.combats.delete(combat.id); // 战斗在排队/等待期间被删除
  await runCombatLifecycleScripts({ combat, combatants: { id: "c1", actor }, trigger: "turnStart", round: 2, turn: 1 });
  assert.deepEqual(gameMock.__log, [], "战斗删除后过期事件的脚本不再执行");
  assert.equal(isCombatEventLive(combat), false);
  const live = makeCombat({ round: 1 });
  assert.equal(isCombatEventLive(live), true);
}
pass("事件作用域复核：战斗删除后跳过执行；isCombatEventLive 判定准确");

{
  // 自动回复内部可能等待（资源事件/濒死结算）；等待后事件作用域失效则不再进入脚本。
  const combat = makeCombat({ round: 2, turn: 1 });
  const actor = makeLifecycleActor("Actor.d2", "回复中失效者");
  gameMock.__log = [];
  stubCollectScripts(actor, { turnStart: [{ script: "game.__log.push(round);", label: "s", source: null }] });
  actor.processRegen = async timing => {
    actor.regenCalls.push(timing);
    gameMock.combats.delete(combat.id); // 模拟回复等待期间战斗被删除
  };
  await runCombatLifecycleScripts({ combat, combatants: { id: "c1", actor }, trigger: "turnStart", round: 2, turn: 1 });
  assert.deepEqual(actor.regenCalls, ["TurnStart"], "自动回复仍执行");
  assert.deepEqual(gameMock.__log, [], "回复结束后战斗已删除，不再执行回合脚本");
}
pass("自动回复等待后复核事件作用域，失效则跳过脚本");

{
  // 参战者在自动回复等待期间被移出战斗：后续脚本不再以其为事件对象执行。
  const combat = makeCombat({ round: 2, turn: 1 });
  const actor = makeLifecycleActor("Actor.d3", "被移出者");
  gameMock.__log = [];
  stubCollectScripts(actor, { turnStart: [{ script: "game.__log.push(round);", label: "s", source: null }] });
  const combatant = { id: "c1", actor };
  combat.combatants.push(combatant);
  actor.processRegen = async timing => {
    actor.regenCalls.push(timing);
    combat.combatants.splice(combat.combatants.indexOf(combatant), 1); // 等待期间参战者被移除
  };
  await runCombatLifecycleScripts({ combat, combatants: combatant, trigger: "turnStart", round: 2, turn: 1 });
  assert.deepEqual(actor.regenCalls, ["TurnStart"]);
  assert.deepEqual(gameMock.__log, [], "参战者已不在事件战斗中，跳过其回合脚本");
}
pass("自动回复等待后复核参战者身份，被移出则跳过脚本");

{
  // 排队期间活 Combat 继续变化：注入快照不受影响。
  const combat = makeCombat({ round: 4, turn: 0 });
  const actor = makeLifecycleActor("Actor.e1", "快照者");
  gameMock.__log = [];
  stubCollectScripts(actor, { turnStart: [{ script: "game.__log.push([round, args.round, combat.round]);", label: "s", source: null }] });
  const snapshotCombatant = { id: "c1", actor };
  combat.combatants.push(snapshotCombatant);
  const pending = runCombatLifecycleScripts({ combat, combatants: snapshotCombatant, trigger: "turnStart", round: 4, turn: 0 });
  combat.round = 5; // 队列等待期间战斗推进
  await pending;
  assert.deepEqual(gameMock.__log, [[4, 4, 5]], "脚本读取捕获的 round=4，活文档 round=5 仅经 args.combat 可见");
}
pass("事件快照与活文档分离：等待期间 round 变化不覆盖注入值");

/* -------------------------------------------- */
/*  B. ask 战斗作用域绑定与战斗删除取消              */
/* -------------------------------------------- */

console.log("B. ask 战斗作用域绑定与战斗删除取消");

initScriptInteraction();
setClient(makeUser("gm1", { isGM: true, active: true }), [makeUser("gm1", { isGM: true, active: true }), makeUser("p1", { active: true })], "gm1");

{
  // 真实 _bindScriptAsk：生命周期触发器绑定 args.combat，普通触发器不绑定。
  const combat = makeCombat({ round: 1 });
  const actor = makeLifecycleActor("Actor.f1", "宿主");
  const sandbox = { trigger: "turnStart", args: { combat } };
  const restore = actor._bindScriptAsk(sandbox, { label: "回归", source: null });
  assert.equal(typeof sandbox.ask, "function");
  restore();
  assert.equal(Object.prototype.hasOwnProperty.call(sandbox, "ask"), false);

  const plainSandbox = { trigger: "damaged", args: {} };
  actor._bindScriptAsk(plainSandbox, { label: "受击", source: null });
  // 发起一次问询并记录：普通触发器无 combatId。
  const spec = { title: "t", buttons: [{ action: "a", label: "a" }] };
  const pending = plainSandbox.ask(spec);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(!socketCalls.some(call => JSON.stringify(call).includes("combatUuid")), "普通受击问询不携带战斗作用域");
}
pass("真实 _bindScriptAsk：仅生命周期触发器绑定事件 Combat，普通触发器不绑定");

{
  const combat = makeCombat({ round: 1 });
  const actor = makeLifecycleActor("Actor.f2", "进战宿主");
  const sandbox = { trigger: "combatStart", args: { combat } };
  actor._bindScriptAsk(sandbox, { label: "进战问询", source: null });
  const player = gameMock.users.get("p1");
  let delivered = null;
  player.query = async (name, data) => {
    player.queryCalls.push({ name, data });
    delivered = data;
    if (data.combatUuid) player.resolveCombatScope = true;
    return new Promise(() => { }); // 保持等待，等战斗删除取消
  };
  const pending = sandbox.ask({ title: "进战抉择", buttons: [{ action: "a", label: "a" }] });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(delivered?.combatUuid, combat.uuid, "生命周期问询载荷携带事件战斗 combatUuid");

  Hooks.callAll("deleteCombat", combat);
  const answer = await pending;
  assert.equal(answer.status, SCRIPT_INTERACTION_STATUS.CANCELLED);
  assert.equal(answer.reason, "combat-ended");
  assert.equal(player.resolveCombatScope, true);
}
pass("战斗删除：绑定作用域的问询按取消结算并通知接收端，脚本走默认分支");

{
  const combat = makeCombat({ round: 1 });
  const actor = makeLifecycleActor("Actor.f3", "不受牵连");
  const otherCombat = makeCombat({ round: 1 });
  const sandbox = { trigger: "turnEnd", args: { combat } };
  actor._bindScriptAsk(sandbox, { label: "回合末问询", source: null });
  const player = gameMock.users.get("p1");
  player.query = async (name, data) => new Promise(() => { });
  const pending = sandbox.ask({ title: "抉择", buttons: [{ action: "a", label: "a" }] });
  await new Promise(resolve => setTimeout(resolve, 0));
  Hooks.callAll("deleteCombat", otherCombat); // 删除无关战斗
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(settled, false, "删除其他战斗不影响本次问询");
  Hooks.callAll("deleteCombat", combat);
  const answer = await pending;
  assert.equal(answer.reason, "combat-ended");
}
pass("战斗作用域隔离：删除其他战斗不取消本次问询");

{
  // 删除先于 ask 发起：不发出请求，直接按取消结算。
  const combat = makeCombat({ round: 1 });
  const actor = makeLifecycleActor("Actor.f4", "迟来者");
  const sandbox = { trigger: "turnStart", args: { combat } };
  actor._bindScriptAsk(sandbox, { label: "迟来问询", source: null });
  const player = gameMock.users.get("p1");
  const queryCallsBefore = player.queryCalls.length;
  gameMock.combats.delete(combat.id);
  const answer = await sandbox.ask({ title: "不应发出", buttons: [{ action: "a", label: "a" }] });
  assert.equal(answer.status, SCRIPT_INTERACTION_STATUS.CANCELLED);
  assert.equal(answer.reason, "combat-ended");
  assert.equal(player.queryCalls.length, queryCallsBefore, "战斗已删除时不发出问询请求");
}
pass("删除后发起的绑定问询直接按取消结算，不再接受 answered");

{
  // 消费答案前复核作用域：战斗删除后到达的 answered 被丢弃。
  const combat = makeCombat({ round: 1 });
  const actor = makeLifecycleActor("Actor.f5", "迟到应答者");
  registry.set(actor.uuid, actor);
  const sandbox = { trigger: "turnEnd", args: { combat } };
  actor._bindScriptAsk(sandbox, { label: "迟到应答问询", source: null });
  const player = gameMock.users.get("p1");
  player.query = async (name, data) => {
    await new Promise(resolve => setTimeout(resolve, 5)); // 应答前留出删除窗口
    return { requestId: data.requestId, status: "answered", action: "confirm", values: {} };
  };
  const pending = sandbox.ask({ title: "抉择", buttons: [{ action: "confirm", label: "确认" }] });
  gameMock.combats.delete(combat.id); // 应答返回前战斗被删除
  const answer = await pending;
  registry.delete(actor.uuid);
  assert.equal(answer.status, SCRIPT_INTERACTION_STATUS.CANCELLED);
  assert.equal(answer.reason, "combat-ended");
}
pass("消费答案前复核事件作用域：删除后的迟到答案按取消丢弃");

{
  // 战斗回退到战前状态（round → 0）与删除同样取消绑定问询。
  const combat = makeCombat({ round: 2 });
  const actor = makeLifecycleActor("Actor.f6", "回退受累者");
  const sandbox = { trigger: "combatStart", args: { combat } };
  actor._bindScriptAsk(sandbox, { label: "回退问询", source: null });
  const player = gameMock.users.get("p1");
  player.query = async (name, data) => new Promise(() => { });
  const pending = sandbox.ask({ title: "抉择", buttons: [{ action: "a", label: "a" }] });
  await new Promise(resolve => setTimeout(resolve, 0));
  Hooks.callAll("updateCombat", combat, { round: 0 });
  const answer = await pending;
  assert.equal(answer.status, SCRIPT_INTERACTION_STATUS.CANCELLED);
  assert.equal(answer.reason, "combat-ended");
  // 正常轮次推进（round ≥ 1）不影响未决问询。
  const combat2 = makeCombat({ round: 2 });
  const actor2 = makeLifecycleActor("Actor.f7", "正常推进者");
  const sandbox2 = { trigger: "turnStart", args: { combat: combat2 } };
  actor2._bindScriptAsk(sandbox2, { label: "推进问询", source: null });
  player.query = async (name, data) => new Promise(() => { });
  const pending2 = sandbox2.ask({ title: "抉择", buttons: [{ action: "a", label: "a" }] });
  await new Promise(resolve => setTimeout(resolve, 0));
  Hooks.callAll("updateCombat", combat2, { round: 3 });
  let settled = false;
  pending2.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(settled, false, "正常轮次推进不取消未决问询");
  // 用例收尾：删除战斗让 pending2 立即终结，不把 60 秒真实超时留给测试进程。
  Hooks.callAll("deleteCombat", combat2);
  const answer2 = await pending2;
  assert.equal(answer2.reason, "combat-ended");
}
pass("战斗回退到第 0 轮取消绑定问询；正常轮次推进不受影响");

{
  // 回退后文档实际处于 round=0：此后发起的绑定问询与排队旧事件都必须跳过
  //（不经取消钩子，直接依据共享作用域判断）。
  const combat = makeCombat({ round: 2 });
  combat.round = 0; // 真实回退到战前状态
  const actor = makeLifecycleActor("Actor.f8", "回退后发起者");
  const sandbox = { trigger: "turnStart", args: { combat } };
  actor._bindScriptAsk(sandbox, { label: "回退后问询", source: null });
  const player = gameMock.users.get("p1");
  const queryCallsBefore = player.queryCalls.length;
  const answer = await sandbox.ask({ title: "不应发出", buttons: [{ action: "a", label: "a" }] });
  assert.equal(answer.status, SCRIPT_INTERACTION_STATUS.CANCELLED);
  assert.equal(answer.reason, "combat-ended");
  assert.equal(player.queryCalls.length, queryCallsBefore, "round=0 时发起的绑定问询不发出请求");

  const actor2 = makeLifecycleActor("Actor.f9", "回退后排队者");
  gameMock.__log = [];
  stubCollectScripts(actor2, { turnStart: [{ script: "game.__log.push(round);", label: "s", source: null }] });
  const queued = { id: "c1", actor: actor2 };
  combat.combatants.push(queued);
  await runCombatLifecycleScripts({ combat, combatants: queued, trigger: "turnStart", round: 2, turn: 1 });
  assert.deepEqual(actor2.regenCalls, [], "round=0 的过期排队事件不执行自动回复");
  assert.deepEqual(gameMock.__log, [], "round=0 的过期排队事件不执行脚本");
}
pass("round=0 的过期作用域：新问询不发出，排队事件不执行");

/* -------------------------------------------- */
/*  C. 迁移后官方脚本：真实沙盒参数编译             */
/* -------------------------------------------- */

console.log("C. 迁移后官方脚本编译（全部生命周期脚本 × 注入参数）");

{
  // 与 _createScriptSandbox + runCombatLifecycleScripts 上下文一致的参数集；
  // 顶层 const round/combat/combatant/turn 之类声明会在此处抛 SyntaxError。
  const paramNames = ["combat", "combatant", "round", "turn", "args", "actor", "system", "S",
    "console", "game", "ui", "trigger", "Macros", "ask", "thisItem", "thisEffect", "move", "item"];
  const AsyncFunctionCtor = Object.getPrototypeOf(async function () { }).constructor;
  const TRIGGERS = new Set(["combatStart", "turnStart", "turnEnd"]);
  let compiled = 0;
  const failures = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = joinPath(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith(".json")) continue;
      let data;
      try { data = JSON.parse(readFileSync(full, "utf8")); } catch { continue; }
      if (!Array.isArray(data)) continue;
      for (const item of data) {
        const scriptLists = [
          ...(item.system?.scripts ?? []),
          ...["stage1", "stage2", "stage3"].flatMap(stage => item.system?.config?.[stage]?.scripts ?? []),
          ...(item.system?.moves ?? []).flatMap(move => move.scripts ?? []),
          ...(item.effects ?? []).flatMap(effect => effect.flags?.["xjzl-system"]?.scripts ?? [])
        ];
        for (const script of scriptLists) {
          if (!TRIGGERS.has(script.trigger)) continue;
          compiled += 1;
          try {
            new AsyncFunctionCtor(...paramNames, script.script);
          } catch (err) {
            failures.push(`${entry.name} [${script.label}] ${script.trigger}: ${err.message}`);
          }
        }
      }
    }
  };
  walk(resolve(root, "data"));
  assert.equal(compiled, 290, `生命周期脚本数量应为 290（实际 ${compiled}）`);
  assert.deepEqual(failures, [], `编译失败：\n${failures.join("\n")}`);
}
pass("290 段生命周期脚本全部按新注入参数编译通过（含天衍事件轮次重命名）");

/* -------------------------------------------- */
/*  D. 迁移后官方脚本关键行为抽查                   */
/* -------------------------------------------- */

console.log("D. 迁移后官方脚本关键行为抽查");

const loadScript = (file, itemIndex, locator, trigger, label) => {
  const data = JSON.parse(readFileSync(resolve(root, "data", file), "utf8"));
  const item = data[itemIndex];
  const scripts = [
    ...(item.system?.scripts ?? []),
    ...["stage1", "stage2", "stage3"].flatMap(stage => item.system?.config?.[stage]?.scripts ?? []),
    ...(item.system?.moves ?? []).flatMap(move => move.scripts ?? []),
    ...(item.effects ?? []).flatMap(effect => effect.flags?.["xjzl-system"]?.scripts ?? [])
  ];
  const found = scripts.filter(s => s.trigger === trigger && s.label.includes(label));
  if (locator !== undefined) return found[locator];
  assert.equal(found.length, 1, `${file} ${trigger}/${label} 应唯一`);
  return found[0];
};

{
  // 五符经：读事件轮次；GM 当前查看的是另一场战斗（round=99）。
  const actor = makeLifecycleActor("Actor.g1", "五符侠");
  actor.system.martial.active_neigong = "item-wufu";
  const item = Object.assign(new Item(), { id: "item-wufu", name: "五符经" });
  actor.items = { get: id => (id === item.id ? item : null) };
  const evenRound = loadScript("neigong/emeipai.json", 2, 0, "turnStart", "五符经-护体");
  await runOneScript(actor, "turnStart", evenRound.script, { combat: makeCombat({ round: 2 }).id ? { id: "combat-even", round: 2, turn: 0 } : null, round: 2, turn: 0 });
  assert.deepEqual(actor.healCalls, [], "偶数轮（事件 round=2）不回血");
  const oddRound = loadScript("neigong/emeipai.json", 2, 1, "turnStart", "五符经-护体");
  await runOneScript(actor, "turnStart", oddRound.script, { combat: { id: "combat-odd", round: 1, turn: 0 }, round: 1, turn: 0 });
  assert.equal(actor.healCalls.length, 1, "奇数轮（事件 round=1）按事件轮次回血");
  assert.equal(actor.healCalls[0].amount, 20);
}
pass("五符经：轮次判定读事件 round，不受 GM 当前查看战斗（round=99）影响");

{
  // 天衍：顶层轮次变量改为 eventRound，读取事件 round。
  const actor = makeLifecycleActor("Actor.g2", "天衍侠");
  const item = Object.assign(new Item(), {
    name: "大道化一诀",
    uuid: "Item.tianyan",
    effects: { getName: name => name === "天衍" ? { toObject: () => ({ name: "天衍", flags: {} }) } : null }
  });
  const stage1 = loadScript("neigong/jianghushili4.json", 12, 0, "turnStart", "天衍-回合开始");
  await runOneScript(actor, "turnStart", stage1.script,
    { combat: { id: "combat-t1", round: 2, turn: 3 }, round: 2, turn: 3 }, item);
  assert.equal(addedEffects.length, 2, "事件 round=2 → 施加 2 层（cap 3）");
  addedEffects.length = 0;
  const stage3 = loadScript("neigong/jianghushili4.json", 12, 2, "turnStart", "天衍-回合开始");
  await runOneScript(actor, "turnStart", stage3.script,
    { combat: { id: "combat-t2", round: 20, turn: 0 }, round: 20, turn: 0 }, item);
  assert.equal(addedEffects.length, 9, "事件 round=20 → 圆满按 cap 9 层");
  addedEffects.length = 0;
}
pass("天衍：按事件 round 决定层数并遵守境界上限，无顶层 round 冲突");

{
  // 法禁：参战者与阵营取事件 Combat 与 Combatant Token；GM 查看的战斗不影响。
  const sceneTokens = [
    { name: "敌A", disposition: -1, actor: { name: "敌A", uuid: "Actor.enemyA" } },
    { name: "友B", disposition: 1, actor: { name: "友B", uuid: "Actor.allyB" } }
  ];
  const combat = makeCombat({ round: 1, sceneTokens });
  combat.combatants.length = 0;
  const selfActor = makeLifecycleActor("Actor.fa1", "法禁侠");
  const selfToken = { name: "法禁Token", disposition: 1, actor: selfActor };
  const enemyCombatant = { id: "ce", actor: sceneTokens[0].actor, token: sceneTokens[0] };
  const allyCombatant = { id: "ca", actor: sceneTokens[1].actor, token: sceneTokens[1] };
  combat.combatants.push(enemyCombatant, allyCombatant, { id: "cs", actor: selfActor, token: selfToken });
  const item = Object.assign(new Item(), {
    name: "法禁",
    uuid: "Item.fajin",
    effects: { getName: name => (name === "刑（领悟）" ? { toObject: () => ({ name, flags: {} }) } : null) }
  });
  addedEffects.length = 0;
  const script = loadScript("neigong/zhengqizong.json", 11, 0, "combatStart", "法禁-刑(领悟)");
  await runOneScript(selfActor, "combatStart", script.script,
    { combat, combatant: combat.combatants[2], round: 1, turn: 0 }, item);
  assert.deepEqual(addedEffects.map(e => e.actor), ["敌A"], "只对事件战斗中异阵营参战者施加刑");
  addedEffects.length = 0;
}
pass("法禁：阵营与参战者取事件 Combat/Combatant Token，不读原型 Token 或查看中的战斗");

{
  // 照胆剑：参战友方按事件战斗判定（原 t.inCombat 读 game.combat）。
  const allyToken = { id: "tok-zd-ally", name: "参战友军", disposition: 1, hidden: false, actor: { name: "参战友军", uuid: "Actor.zd-ally" } };
  const idleToken = { id: "tok-zd-idle", name: "未参战友军", disposition: 1, hidden: false, actor: { name: "未参战友军", uuid: "Actor.zd-idle" } };
  const hiddenToken = { id: "tok-zd-hidden", name: "隐身友军", disposition: 1, hidden: true, actor: { name: "隐身友军", uuid: "Actor.zd-hidden" } };
  const combat = makeCombat({ round: 1 });
  combat.combatants.length = 0;
  const selfActor = makeLifecycleActor("Actor.zd", "照胆侠");
  const selfToken = { id: "tok-zd-self", name: "照胆Token", disposition: 1, hidden: false, actor: selfActor };
  combat.combatants.push(
    { id: "zd-ally", tokenId: "tok-zd-ally", actor: allyToken.actor, token: allyToken },
    { id: "zd-self", tokenId: "tok-zd-self", actor: selfActor, token: selfToken }
  );
  combat.scene = { tokens: [allyToken, idleToken, hiddenToken, selfToken] };
  for (const token of combat.scene.tokens) token.parent = combat.scene;
  const item = Object.assign(new Item(), { name: "照胆剑" });
  await runOneScript(selfActor, "combatStart", loadScript("weapons/sword.json", 55, undefined, "combatStart", "照胆-聚众护体").script,
    { combat, combatant: combat.combatants[1], round: 1, turn: 0 }, item);
  assert.equal(selfActor.healCalls.length, 1);
  assert.equal(selfActor.healCalls[0].amount, 20, "仅 1 名参战非隐藏友方 → 20 护体（未参战/隐身/自身不计）");
}
pass("照胆剑：参战判定按事件 Combat 的 Combatant，跨查看战斗与隐藏/未参战过滤保持原规则");

{
  // 马头琴：事件场景友方（含自身）施加乘风；画布探针不得被触碰。
  const allyToken = { name: "友军", disposition: 1, actor: { name: "友军", uuid: "Actor.mt-ally" } };
  const enemyToken = { name: "敌军", disposition: -1, actor: { name: "敌军", uuid: "Actor.mt-enemy" } };
  const combat = makeCombat({ round: 1 });
  const selfActor = makeLifecycleActor("Actor.mt", "马头琴手");
  const selfToken = { name: "琴手Token", disposition: 1, actor: selfActor };
  combat.scene = { tokens: [allyToken, enemyToken, selfToken] };
  for (const token of combat.scene.tokens) token.parent = combat.scene;
  addedEffects.length = 0;
  const item = Object.assign(new Item(), { name: "马头琴" });
  canvasTouched = null;
  await runOneScript(selfActor, "combatStart", loadScript("weapons/instrument.json", 22, undefined, "combatStart", "马头琴 - 战歌").script,
    { combat, combatant: { id: "mt", actor: selfActor, token: selfToken }, round: 1, turn: 0 }, item);
  assert.equal(canvasTouched, null, "迁移后脚本不读当前画布");
  assert.deepEqual(addedEffects.map(e => e.actor), ["友军", "马头琴手"], "场景友方（含自身）获得乘风，敌方不计");
  addedEffects.length = 0;
}
pass("马头琴：事件场景 TokenDocument 取代画布 placeables，友方过滤原样保留");

{
  // 花鼓：共享数组按事件 Combat 读取；其他花鼓按事件战斗参战者清理。
  const actor = makeLifecycleActor("Actor.huagu", "花鼓侠");
  const otherActor = makeLifecycleActor("Actor.huagu-other", "中花鼓者");
  otherActor.effects.push({ getFlag: (scope, key) => (key === "slug" ? "fengyang_huagu" : null) });
  const combat = makeCombat({ round: 3, turn: 2 });
  combat.huaguAdded = [{ count: 4 }];
  combat.combatants.length = 0;
  const otherToken = { name: "中花鼓Token", actor: otherActor };
  combat.combatants.push(
    { id: "hg-other", actor: otherActor, token: otherToken },
    { id: "hg-self", actor, token: { name: "花鼓Token", actor } }
  );
  const effectSource = Object.assign(new ActiveEffect(), {
    getFlag: (scope, key) => (key === "stacks" ? 1 : null)
  });
  socketCalls.length = 0;
  gameMock.__huaguEntries = [{ count: 4 }];
  await runOneScript(actor, "turnStart", loadScript("wuxue/yueqi.json", 8, undefined, "turnStart", "回合初倒计时").script,
    { combat, combatant: combat.combatants[1], round: 3, turn: 2 }, effectSource);
  gameMock.__huaguEntries = null;
  assert.ok(socketCalls.some(call => call[0] === "updateDocumentAtomic" && call[1] === combat.uuid),
    "共享数组读取使用事件 Combat 的 uuid（而非查看中的战斗）");
  assert.deepEqual(actor.damageCalls.map(call => call.amount), [40],
    "归零后按事件战斗累计层数（4×10）对自身结算伤害");
}
pass("花鼓：共享账目与参战者清理绑定事件 Combat");

{
  // 光环脚本：query/exists/dismiss/create 收到显式事件场景与来源 Token。
  const actor = makeLifecycleActor("Actor.aura", "光环侠");
  const srcToken = { name: "光环Token", actor, disposition: 1 };
  srcToken.parent = { tokens: new Map([[srcToken.name, srcToken]]) };
  const auraHeals = [];
  const region = {
    tokens: [{
      actor: {
        name: "范围友", uuid: "Actor.in-aura",
        applyHealing: async data => { auraHeals.push(data); return { actualHeal: data.amount ?? 0 }; }
      },
      disposition: 1
    }]
  };
  auraQueries.push([region]);
  auraExists.push(false);
  const item = Object.assign(new Item(), { name: "清辉华盖伞", uuid: "Item.qinghui" });
  actor.system.combat = {};
  await runOneScript(actor, "turnStart", loadScript("weapons/special.json", 48, undefined, "turnStart", "清辉回护").script,
    { combat: { id: "combat-aura", round: 1, turn: 0 }, combatant: { id: "au", actor, token: srcToken }, round: 1, turn: 0 }, item);
  const query = auraCalls.query.at(-1);
  assert.equal(query.label, "weapon-qinghui-" + actor.id);
  assert.equal(query.options.source, srcToken, "query 以事件 Combatant 的 Token 为来源过滤");
  assert.equal(query.options.scene, srcToken.parent, "query 显式传事件场景，不落当前画布");
  assert.equal(auraHeals.length, 1, "范围内友方获得回护");
  assert.deepEqual(auraHeals[0].type, "huti");
}
pass("清辉回护：query 显式携带事件场景与来源 Token，主人阵营不再解析画布 Token");

{
  // 铜铃补挂：exists 带场景，create 以事件 Token 为来源并携带事件 combatId。
  const actor = makeLifecycleActor("Actor.tl", "铜铃侠");
  const srcToken = { name: "铜铃Token", actor, disposition: 1 };
  srcToken.parent = { tokens: new Map() };
  const combat = makeCombat({ round: 2 });
  auraExists.push(false);
  const item = Object.assign(new Item(), { name: "铜铃猫项圈", uuid: "Item.tongling" });
  await runOneScript(actor, "turnStart", loadScript("armor/necklace.json", 0, undefined, "turnStart", "铜铃预警补挂").script,
    { combat, combatant: { id: "tl", actor, token: srcToken }, round: 2, turn: 1 }, item);
  assert.deepEqual(auraCalls.exists.at(-1), {
    label: "armor-tongling-" + actor.id, source: srcToken, options: { scene: srcToken.parent }
  }, "exists 按现有第三参数传事件场景");
  const create = auraCalls.create.at(-1);
  assert.equal(create.source, srcToken, "create 以事件 Token 为光环来源（不再解析 Actor 的画布 Token）");
  assert.equal(create.params.combatId, combat.id, "combatId 使用事件战斗");
  assert.equal(create.params.sourceItemUuid, item.uuid);
}
pass("铜铃预警补挂：exists/create 显式事件场景、来源 Token 与事件 combatId");

{
  // 雷电真龙：来源按施加光环的 sourceTokenUuid（宿主 Token 区域账本反查），
  // 账本条目 ref.item 必须与本效果 origin 链上的来源物品一致。
  const ownerActor = makeLifecycleActor("Actor.lei-owner", "雷龙主");
  ownerActor.id = "actor-lei-owner";
  const carrierActor = makeLifecycleActor("Actor.lei-self", "引雷者");
  carrierActor.id = "actor-lei-self";
  const ownerItem = { uuid: "Item.lei-owner", name: "神雷九刀", parent: ownerActor };
  const ownerTokenDoc = { id: "tok-lei-owner", name: "雷龙主Token", actor: ownerActor, disposition: -1 };
  const selfToken = { id: "tok-lei-self", name: "引雷者Token", actor: carrierActor, disposition: 1 };
  const combat = makeCombat({ round: 1 });
  combat.combatants.length = 0;
  combat.combatants.push(
    { id: "lei-owner", actor: ownerActor, token: ownerTokenDoc },
    { id: "lei-self", actor: carrierActor, token: selfToken }
  );
  const aeSource = Object.assign(new ActiveEffect(), {
    uuid: "ActiveEffect.lei",
    origin: "Item.lei-owner.ActiveEffect.tpl",
    getFlag: (scope, key) => (key === "slug" ? "leidianzhenlong-jianting" : null)
  });
  // fromUuid(origin) → 模板 AE → 来源物品（uuid 参与 ref.item 匹配）→ 主人 Actor
  registry.set(aeSource.origin, { parent: ownerItem });

  // 单一来源：宿主 Token 所在区域的账本条目 actorUuid/slug/ref.item 全部匹配。
  selfToken.regions = [{
    getFlag: (scope, key) => {
      if (key === "aura") return { sourceTokenUuid: "Scene.s.Token.owner" };
      if (key === "ledger") return {
        [selfToken.id]: { beh: { actorUuid: carrierActor.uuid, slug: "leidianzhenlong-jianting", ref: { item: ownerItem.uuid } } }
      };
      return null;
    }
  }];
  registry.set("Scene.s.Token.owner", ownerTokenDoc);
  globalThis.__rollTotal = 1; // 1D6=1：敌对表流失分支
  await runOneScript(carrierActor, "turnStart", loadScript("wuxue/daofa.json", 21, 0, "turnStart", "雷电真龙·随机表").script,
    { combat, combatant: combat.combatants[1], round: 1, turn: 0 }, aeSource);
  assert.equal(canvasTouched, null, "阵营判定不读当前画布");
  assert.deepEqual(carrierActor.healCalls.at(-1)?.type, "hp", "敌对表分支按来源 Token 阵营成立（流失 100 气血）");
  assert.equal(carrierActor.healCalls.at(-1).amount, -100);

  // 两名施法者的同类光环重叠：先遍历到友方 A 的区域，AE origin 指向敌方 B；
  // ref.item 区分归属，必须选中 B 并按敌对表结算。
  carrierActor.healCalls.length = 0;
  const casterB = makeLifecycleActor("Actor.lei-B", "敌方雷龙主B");
  casterB.id = "actor-lei-B";
  const itemB = { uuid: "Item.lei-B", name: "神雷九刀B", parent: casterB };
  const tokenA = { id: "tok-lei-A", name: "友方雷龙主AToken", disposition: 1 };
  const tokenB = { id: "tok-lei-B", name: "雷龙主BToken", actor: casterB, disposition: -1 };
  const regionA = {
    getFlag: (scope, key) => {
      if (key === "aura") return { sourceTokenUuid: "Scene.s.Token.a" };
      if (key === "ledger") return {
        [selfToken.id]: { beh: { actorUuid: carrierActor.uuid, slug: "leidianzhenlong-jianting", ref: { item: "Item.lei-A" } } }
      };
      return null;
    }
  };
  const regionB = {
    getFlag: (scope, key) => {
      if (key === "aura") return { sourceTokenUuid: "Scene.s.Token.b" };
      if (key === "ledger") return {
        [selfToken.id]: { beh: { actorUuid: carrierActor.uuid, slug: "leidianzhenlong-jianting", ref: { item: itemB.uuid } } }
      };
      return null;
    }
  };
  selfToken.regions = [regionA, regionB]; // A 在前：不得按遍历顺序取第一个
  registry.set("Scene.s.Token.a", tokenA);
  registry.set("Scene.s.Token.b", tokenB);
  registry.set("Item.lei-A.ActiveEffect.tpl", { parent: { uuid: "Item.lei-A", parent: ownerActor } });
  registry.set("Item.lei-B.ActiveEffect.tpl", { parent: itemB });
  const leiB = Object.assign(new ActiveEffect(), {
    uuid: "ActiveEffect.lei-B",
    origin: "Item.lei-B.ActiveEffect.tpl",
    getFlag: (scope, key) => (key === "slug" ? "leidianzhenlong-jianting" : null)
  });
  await runOneScript(carrierActor, "turnStart", loadScript("wuxue/daofa.json", 21, 0, "turnStart", "雷电真龙·随机表").script,
    { combat, combatant: combat.combatants[1], round: 1, turn: 0 }, leiB);
  assert.deepEqual(carrierActor.healCalls.at(-1), { amount: -100, type: "hp", healer: casterB },
    "origin 指向 B 时按 B 的阵营走敌表，healer 为 B");

  // 命中不唯一（两个区域都登记同一来源物品）：停止结算，不取第一个猜测。
  carrierActor.healCalls.length = 0;
  regionA.getFlag = (scope, key) => {
    if (key === "aura") return { sourceTokenUuid: "Scene.s.Token.a" };
    if (key === "ledger") return {
      [selfToken.id]: { beh: { actorUuid: carrierActor.uuid, slug: "leidianzhenlong-jianting", ref: { item: itemB.uuid } } }
    };
    return null;
  };
  await runOneScript(carrierActor, "turnStart", loadScript("wuxue/daofa.json", 21, 0, "turnStart", "雷电真龙·随机表").script,
    { combat, combatant: combat.combatants[1], round: 1, turn: 0 }, leiB);
  assert.deepEqual(carrierActor.healCalls, [], "候选来源不唯一时停止，不猜测");

  // 同源多 Token/来源缺失：无账本可查时明确停止，不按基础 Actor ID 猜测。
  selfToken.regions = []; // 账本不可查：无法确定来源
  await runOneScript(carrierActor, "turnStart", loadScript("wuxue/daofa.json", 21, 0, "turnStart", "雷电真龙·随机表").script,
    { combat, combatant: combat.combatants[1], round: 1, turn: 0 }, aeSource);
  assert.deepEqual(carrierActor.healCalls, [], "来源不可查时停止结算，不猜测同源 Token 阵营");
  delete globalThis.__rollTotal;
  registry.clear();
}
pass("雷电真龙：来源按账本 sourceTokenUuid + 来源物品精确定位，重叠/缺失/不唯一均不猜测");

{
  // 六气回复：主人阵营读事件 Combatant Token 的 disposition，两个区域独立结算。
  const actor = makeLifecycleActor("Actor.liuqi", "六气侠");
  const heals = [];
  const memberIn = name => ({
    actor: {
      name, uuid: `Actor.${name}`,
      applyHealing: async data => { heals.push({ name, amount: data.amount, type: data.type }); return { actualHeal: data.amount }; }
    },
    disposition: 1
  });
  const enemyIn = name => ({
    actor: {
      name, uuid: `Actor.${name}`,
      applyHealing: async data => { heals.push({ name, amount: data.amount, type: data.type }); return { actualHeal: data.amount }; }
    },
    disposition: -1
  });
  const ljRegion = { tokens: [memberIn("六甲友"), enemyIn("六甲敌")], getFlag: () => null };
  const lqRegion = {
    tokens: [memberIn("风木友"), enemyIn("风木敌")],
    getFlag: (scope, key) => (key === "aura" ? { params: { payloadEffectName: "厥阴风木" } } : null)
  };
  auraQueries.push([ljRegion], [lqRegion]);
  const selfToken = { name: "六气Token", actor, disposition: 1 };
  await runOneScript(actor, "turnEnd", loadScript("wuxue/tushou.json", 49, undefined, "turnEnd", "六气回复").script,
    { combat: { id: "combat-lq", round: 1, turn: 0 }, combatant: { id: "lq", actor, token: selfToken }, round: 1, turn: 0 },
    Object.assign(new Item(), { name: "连山六气掌" }));
  assert.deepEqual(heals.map(h => `${h.name}:${h.amount}`), ["六甲友:40", "风木友:20"],
    "两个区域各按主人阵营回复（六甲 40 + 风木 20），敌方与异阵营全部被过滤");
}
pass("六气回复：TokenDocument 阵营读取正确，双区域独立结算");

{
  // 断舌诀：限时 AE 显式锚定事件战斗（核心默认会锚到 GM 查看的战斗）。
  const actor = makeLifecycleActor("Actor.duan", "断舌者");
  const item = Object.assign(new Item(), {
    name: "断舌诀",
    uuid: "Item.duan",
    effects: { getName: name => name === "断舌诀-阴冷" ? { toObject: () => ({ name, flags: {} }) } : null }
  });
  actor.system.skills = { qiman: { total: 4 } };
  const combat = makeCombat({ round: 2, turn: 3 });
  globalThis.__rollTotal = 20; // 1d20+4 ≥ DC 17：检定成功才施加阴冷
  await runOneScript(actor, "turnStart", loadScript("neigong/gongchuang2026.json", 0, 0, "turnStart", "欺瞒判定与阴冷状态").script,
    { combat, combatant: { id: "duan", actor, token: { name: "断舌Token", actor } }, round: 2, turn: 3 }, item);
  delete globalThis.__rollTotal;
  const applied = addedEffects.at(-1);
  assert.deepEqual(applied.data.start, {
    combat: combat.id, combatant: "duan", initiative: null, round: 2, turn: 3
  }, "阴冷 AE 的 start 锚定事件战斗/参战者/事件轮次位置");
  addedEffects.length = 0;
}
pass("断舌诀：限时 AE 显式绑定事件战斗锚点，跨战斗不锚错");

{
  // 玩家操作提醒：迁移后以带 Actor speaker 的聊天卡 whisper 给控制者与 GM。
  const actor = makeLifecycleActor("Actor.remind", "残心侠");
  actor.effects.push({ getFlag: (scope, key) => (key === "slug" ? "shoudao" : null) });
  chatMessages.length = 0;
  notices.length = 0;
  await runOneScript(actor, "turnEnd", loadScript("wuxue/dongyingxiyang.json", 2, undefined, "turnEnd", "回合末提示").script,
    { combat: { id: "combat-r", round: 1, turn: 0 }, round: 1, turn: 0 }, Object.assign(new ActiveEffect(), { name: "残心" }));
  assert.equal(chatMessages.length, 1, "残心提醒发出聊天卡");
  assert.deepEqual(chatMessages[0].speaker, { actor: "残心侠" }, "聊天卡带 Actor speaker");
  assert.ok(chatMessages[0].content.includes("手动消耗一层残心"), "提醒内容保留操作指引");
  assert.equal(notices.length, 0, "不再只以 GM toast 提示");
  assert.deepEqual(chatMessages[0].whisper?.sort(), ["gm1", "p1"], "按原信息范围 whisper 给在线控制者与 GM，不公开全桌");
}
pass("残心：玩家操作提醒迁移为 whisper 控制者与 GM 的聊天卡");

{
  const actor = makeLifecycleActor("Actor.yannl", "溺者");
  chatMessages.length = 0;
  await runOneScript(actor, "turnEnd", loadScript("wuxue/jianfa.json", 38, undefined, "turnEnd", "淹溺结算").script,
    { combat: { id: "combat-y", round: 1, turn: 0 }, round: 1, turn: 0 }, Object.assign(new ActiveEffect(), { name: "淹溺" }));
  assert.equal(chatMessages.length, 1);
  assert.ok(chatMessages[0].content.includes("韧性检定（DC 20）"), "淹溺的手动韧性检定指引保留");
  assert.ok(Array.isArray(chatMessages[0].whisper) && chatMessages[0].whisper.length > 0, "淹溺提醒为私密聊天，不公开");
}
pass("淹溺：手动韧性检定提醒对控制者与 GM 可见且不公开");

/* -------------------------------------------- */
/*  E. 交互窗口边界（检定配置中继沿用事件作用域）      */
/* -------------------------------------------- */

console.log("E. 检定配置中继的战斗作用域");

{
  const combat = makeCombat({ round: 1 });
  const actor = makeLifecycleActor("Actor.gj", "古今侠");
  registry.set(actor.uuid, actor); // 消费答案前的宿主存在性复核经 fromUuid
  // 共享脚本栈上压入携带无关战斗的交错条目：中继必须使用显式传入的事件战斗。
  const decoyCombat = makeCombat({ round: 7 });
  (actor._scriptContextStack ??= []).push({ item: null, effect: null, label: "交错条目", eventCombat: decoyCombat });
  const specSeen = [];
  const player = gameMock.users.get("p1");
  player.query = async (name, data) => {
    specSeen.push(data);
    return { requestId: data.requestId, status: "answered", action: "roll", values: { bonus: 0, level: 0 } };
  };
  const answer = await actor._promptAttributeTestConfigViaController(
    { label: "进战定韵", baseVal: 40, sysBonus: 2, sysLevel: 0 },
    { interactionTrigger: "combatStart", interactionSource: null, interactionCombat: combat }
  );
  (actor._scriptContextStack ?? []).pop();
  registry.delete(actor.uuid);
  assert.deepEqual(answer, { bonus: 0, level: 0 });
  assert.equal(specSeen[0]?.combatUuid, combat.uuid, "中继携带脚本显式传入的事件战斗，而非共享栈顶条目");
}
pass("检定配置中继：显式 interactionCombat 绑定作用域，不读共享异步脚本栈");

console.log(`\n共 ${passed} 组断言通过。`);
if (canvasTouched) {
  console.error(`XJZL | 回归失败：迁移后脚本触碰了当前画布（${canvasTouched}）`);
  process.exitCode = 1;
}
