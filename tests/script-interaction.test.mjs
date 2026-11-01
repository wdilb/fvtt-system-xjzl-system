/**
 * 脚本交互（ask）回归：真实 policy/manager/dialog 模块 + 真实迁移后官方脚本。
 * 只替换网络（User.query/socketlib）、UI（DialogV2）与 Foundry 全局边界；
 * 控制流、校验、终结与清理全部走真实实现。DialogV2 的 button.form 契约
 * 按核实的 V14 源码行为模拟（回调自 button.form.elements 取值）。
 *
 * 运行：node --experimental-vm-modules tests/script-interaction.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { SourceTextModule, SyntheticModule } from "node:vm";

const root = fileURLToPath(new URL("../", import.meta.url));
let sequence = 0;

const getProperty = (object, path) => {
  if (!object || !path) return undefined;
  // V14 契约：扁平整键（如 {"system.resources.mp.value": 4}）优先于点号逐层展开
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

globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };

// 两端共用的同步 serverTime（毫秒）；本机 Date.now 的偏差不参与截止判断。
let serverTime = 1_000_000_000_000;
const advanceServerTime = ms => { serverTime += ms; };

globalThis.foundry = {
  data: { fields: {} },
  abstract: { Document: class MockDocument { } },
  utils: {
    randomID: () => `id${++sequence}`,
    getProperty,
    setProperty,
    deepClone: structuredClone,
    isEmpty: value => !value || Object.keys(value).length === 0
  },
  applications: {
    api: { DialogV2: {} },
    handlebars: { renderTemplate: async () => "mock-template" }
  }
};

// rollAttributeTest 与检定配置渲染依赖的 Foundry 全局；本回归只断言结果。
const renderTemplateCalls = [];
globalThis.renderTemplate = async (path, data) => {
  renderTemplateCalls.push({ path, data });
  return `<div data-template="${path}"></div>`;
};
const rollCalls = [];
globalThis.Roll = class MockRoll {
  constructor(formula, data) {
    this.formula = formula;
    this.data = data;
    rollCalls.push(this);
  }
  async evaluate() {
    this.total = 10 + (this.data?.val ?? 0) + (this.data?.extra ?? 0) + (this.data?.bonus ?? 0);
    return this;
  }
  async toMessage() { return {}; }
};
globalThis.CONFIG = {
  XJZL: {
    attributes: {},
    skills: { shuxie: "XJZL.Skills.Shuxie", yanzou: "XJZL.Skills.Yanzou" },
    arts: {},
    weaponTypes: {}
  }
};
globalThis.document = { getElementById: () => null };
const chatMessages = [];
globalThis.ChatMessage = {
  getSpeaker: ({ actor }) => ({ actor: actor?.name ?? null }),
  create: async data => { chatMessages.push(data); }
};

// XJZLActor 的基类：super.update 可被用例接管以模拟核心更新取消。
globalThis.Actor = class MockActorRoot {
  async update(changes) {
    if (this._cancelNextUpdate) { this._cancelNextUpdate = false; return null; }
    for (const [key, value] of Object.entries(changes)) {
      // 变更键为文档级路径（system.resources...）：派生视图直接应用到文档，
      // _source 源视图同步应用，保证派生读取与事务快照一致。
      setProperty(this, key, value);
      setProperty(this._source, key, value);
    }
    return { ...changes };
  }
};
// 仅为满足 extends 与 instanceof 的最小文档类 mock；本回归不加载文档生命周期。
globalThis.Item = class MockItem { };
globalThis.ActiveEffect = class MockActiveEffect { };

const registry = new Map();          // uuid → 文档（fromUuid 边界）
globalThis.fromUuid = async uuid => registry.get(uuid) ?? null;

const notices = [];
globalThis.ui = { notifications: {
  info: message => notices.push(message),
  warn: message => notices.push(message),
  error: message => notices.push(message)
} };

const statusTemplates = {
  prone: { name: "倒地", img: "icons/svg/fallen.svg" },
  shizhun: { name: "失准", img: "icons/svg/downgrade.svg" },
  unstable: { name: "下盘不稳", img: "icons/svg/trap.svg" },
  cuogu: { name: "错骨", img: "icons/svg/bone.svg" }
};
const addedEffects = [];
const removedEffects = [];
const MacrosMock = {
  stanceActive: true,
  checkStance: () => MacrosMock.stanceActive
};
globalThis.Macros = MacrosMock;

const mockCombat = { id: "combat-mock", uuid: "Combat.combat-mock", round: 1 }; // 作用域判断要求同一实例且 round>0
globalThis.game = {
  user: null,
  users: [],
  combats: { get: id => (id === mockCombat.id ? mockCombat : null) }, // 第三步作用域复核用
  settings: { get: () => false },
  time: { get serverTime() { return serverTime; } },
  i18n: {
    localize: key => key,
    format: (key, values) => `${key}:${JSON.stringify(values ?? {})}`
  },
  xjzl: {
    api: {
      effects: {
        getStatus: slug => statusTemplates[slug] ? structuredClone(statusTemplates[slug]) : undefined,
        addEffect: async (actor, data, count = 1) => {
          addedEffects.push({
            actor: actor?.name ?? null,
            slug: data?.flags?.["xjzl-system"]?.slug ?? data?.name,
            count
          });
          return { id: `added-${addedEffects.length}` };
        },
        removeEffect: async (actor, slug, amount = 1) => {
          const effect = actor.effects.find(e => e.getFlag("xjzl-system", "slug") === slug);
          if (!effect) return undefined;
          // 模拟真实叠层契约：可叠层且移除量小于当前层数时只减层（返回 undefined），
          // 否则整条删除（返回被删效果）。原地操作，保留 effects 数组身份与 get 辅助方法。
          const currentStacks = effect.getFlag("xjzl-system", "stacks") || 1;
          if (effect.getFlag("xjzl-system", "stackable") && amount < currentStacks) {
            effect._stacks = currentStacks - amount;
            removedEffects.push({ actor: actor?.name ?? null, slug, amount, effect, stacked: true });
            return undefined;
          }
          actor.effects.splice(actor.effects.indexOf(effect), 1);
          removedEffects.push({ actor: actor?.name ?? null, slug, amount, effect });
          return effect;
        },
        toggleStatus: async (actor, slug, active) => {
          addedEffects.push({ actor: actor?.name ?? null, slug, toggle: active });
          return { id: `toggled-${addedEffects.length}` };
        }
      }
    }
  }
};

const hookHandlers = new Map();
globalThis.Hooks = {
  on(name, fn) {
    if (!hookHandlers.has(name)) hookHandlers.set(name, []);
    hookHandlers.get(name).push(fn);
  },
  callAll(name, ...args) { for (const fn of hookHandlers.get(name) ?? []) fn(...args); }
};

/** 设置当前客户端身份：users 为全部用户数组，activeGMId 指定活动 GM。 */
function setClient(activeUser, users, activeGMId = null) {
  game.user = activeUser;
  const collection = [...users];
  collection.get = id => collection.find(user => user.id === id) ?? null;
  collection.activeGM = users.find(user => user.id === activeGMId) ?? null;
  game.users = collection;
}

/* -------------------------------------------- */
/*  DialogV2 mock：真实契约的最小窗口类            */
/* -------------------------------------------- */

let scriptedResponses = [];
let dialogImpl = null;
let dialogConfigs = [];
const dialogInstances = [];
// DialogV2.wait（本机检定配置回退路径）的可控返回值；null 表示取消。
let dialogWaitResult = null;
// 模拟模板加载缓慢/失败：render 推迟执行或直接拒绝，渲染回归使用。
let deferRender = false;
let renderFailure = null;
const deferredRenders = [];
// 剩余时间节点的可配置查询结果：null 或伪节点（触发 i18n 更新路径）。
let appQuerySelectorResult = null;

function flushDeferredRenders() {
  while (deferredRenders.length > 0) {
    const pending = deferredRenders.shift()();
    // 渲染拒绝由受测模块处理；此处兜底避免调试时的未处理拒绝噪音。
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  }
}

foundry.applications.api.DialogV2 = class MockDialogV2 {
  // 本机 _promptAttributeTestConfig 使用 DialogV2.wait；回归只覆盖取消与配置返回。
  static async wait() { return dialogWaitResult; }

  constructor(config) {
    dialogConfigs.push(config);
    dialogInstances.push(this);
    this.config = config;
    this.element = { querySelector: () => appQuerySelectorResult };
    this.rendered = false;
    this.closed = false;
    this._closeHandlers = [];
  }

  addEventListener(name, handler) {
    if (name === "close") this._closeHandlers.push(handler);
  }

  async render(options = {}) {
    if (deferRender) {
      // 模板加载未完成：真实 Promise 保持挂起，flush 后才结算（成功或拒绝）。
      return new Promise((resolve, reject) => {
        deferredRenders.push(() => this.#doRender().then(resolve, reject));
      });
    }
    return await this.#doRender();
  }

  async #doRender() {
    if (renderFailure) throw renderFailure;
    this.rendered = true;
    // V14 语义：渲染完成后窗口继续等待玩家；应答驱动不阻塞渲染完成。
    void this.#runScripted().catch(err => { this.mockError = err; });
    return this;
  }

  /** 渲染完成后驱动脚本化应答；dialogImpl 完全接管时由其自行驱动 submit/close。 */
  async #runScripted() {
    if (dialogImpl) {
      await dialogImpl(this.config, this);
      return;
    }
    const response = scriptedResponses.shift();
    if (response instanceof Error) throw response;
    if (response == null) { await this.close(); return; }
    const button = this.config.buttons.find(candidate => candidate.action === response.action);
    if (!button) throw new Error(`mock: 未知按钮 ${response.action}`);
    // 按真实契约构造 buttonElement：回调必须从 button.form.elements[name] 取值。
    const elements = {};
    for (const [name, value] of Object.entries(response.values ?? {})) elements[name] = { value: String(value) };
    const result = await button.callback(null, { form: { elements } });
    // 核心语义：submit 携带回调结果；closeOnSubmit 默认随后关窗（close 事件不再改变结果）。
    this.config.submit?.(result, this);
    await this.close();
  }

  async close() {
    if (this.closed) return this;
    this.closed = true;
    const handlers = this._closeHandlers;
    this._closeHandlers = [];
    try { this.config.close?.(null, this); } finally { for (const handler of handlers) handler({}); }
    return this;
  }
};

/** 每个用例配置对话框应答或完全接管实现，结束后自动还原；窗口计数由用例自行重置。 */
async function withDialog(scripted, impl, run) {
  const previous = { scripted: scriptedResponses, impl: dialogImpl, deferRender };
  scriptedResponses = scripted;
  dialogImpl = impl;
  try {
    return await run();
  } finally {
    scriptedResponses = previous.scripted;
    dialogImpl = previous.impl;
    deferRender = previous.deferRender;
  }
}

/* -------------------------------------------- */
/*  socketlib 边界 stub                           */
/* -------------------------------------------- */

const closeCommands = [];
const socketStub = {
  executeAsUser: async (...args) => { closeCommands.push(args); }
};

/* -------------------------------------------- */
/*  模块加载（真实实现；socket 边界显式 stub）      */
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

const policy = await importModule("module/utils/script-interaction-policy.mjs");
const manager = await importModule("module/managers/script-interaction-manager.mjs");
await importModule("module/applications/script-interaction-dialog.mjs");
const { SCRIPT_TRIGGERS } = await importModule("module/data/common.mjs");
const { XJZLActor } = await importModule("module/documents/actor.mjs");

const {
  SCRIPT_INTERACTION_STATUS, INTERACTION_DECISION, SCRIPT_INTERACTION_TIMEOUT_MS,
  resolveInteractionDecision, isInteractiveTrigger,
  XJZLScriptInteractionForbiddenError, XJZLScriptAbortError, isScriptAbortError,
  getInteractionOwnership, isEffectiveOwner, resolveInteractionTarget,
  validateInteractionDeadline, validateInteractionSpec, validateInteractionAnswer
} = policy;
const { ScriptInteractionManager, createScriptAsk, initScriptInteraction } = manager;
const resourceCommitError = await importModule("module/utils/resource-commit-error.mjs");
const {
  XJZLResourceCommitError,
  toResourceCommitErrorEnvelope, wrapResourceSocketError, unwrapResourceSocketResult
} = resourceCommitError;

/* -------------------------------------------- */
/*  测试工具                                      */
/* -------------------------------------------- */

let passed = 0;
function pass(label) { console.log(`  ✓ ${++passed}. ${label}`); }

function makeUser(id, { isGM = false, active = true, character = null } = {}) {
  return {
    id, name: id, isGM, active, character, queryCalls: [],
    async query(name, data, options) {
      this.queryCalls.push({ name, data, options });
      if (this.pendingQuery) return this.pendingQuery.promise;
      const result = typeof this.nextQueryResult === "function"
        ? this.nextQueryResult(data)
        : this.nextQueryResult;
      return result ?? { requestId: data.requestId, status: "cancelled", reason: "mock-default" };
    }
  };
}

/** 世界 Actor；ownership 为 Foundry ownership 表。 */
function makeActor(uuid, name, ownership) {
  const actor = {
    uuid, name, type: "character", isToken: false, token: null, ownership,
    system: {
      resources: {
        hp: { value: 20, max: 100 },
        mp: { value: 9, max: 10 },
        rage: { value: 0, max: 10 }
      }
    },
    healCalls: [],
    floatyCalls: [],
    async applyHealing(data) {
      this.healCalls.push(data);
      if (this.nextHealResult) return this.nextHealResult;
      if (data.type === "mp") {
        const resource = this.system.resources.mp;
        const newVal = Math.max(0, resource.value + data.amount);
        const actualHeal = newVal - resource.value;
        resource.value = newVal;
        return { actualHeal, type: data.type };
      }
      return { actualHeal: data.amount, type: data.type };
    },
    showFloatyText(content, style) { this.floatyCalls.push({ content, style }); }
  };
  registry.set(uuid, actor);
  return actor;
}

const baseSpec = {
  title: "测试问询",
  content: "<p>说明</p>",
  buttons: [{ action: "confirm", label: "确认", default: true }],
  fields: [{ name: "mpCost", label: "消耗内力", type: "integer", value: 3, min: 0, max: 5 }]
};

/* -------------------------------------------- */
/*  A. 交互归属映射与 ask 绑定                     */
/* -------------------------------------------- */

console.log("A. 交互归属映射与 ask 绑定");

for (const [trigger, expected] of Object.entries({
  passive: INTERACTION_DECISION.FORBIDDEN,
  calc: INTERACTION_DECISION.FORBIDDEN,
  preAttack: INTERACTION_DECISION.ACTIVE_OPERATOR,
  attack: INTERACTION_DECISION.ACTIVE_OPERATOR,
  check: INTERACTION_DECISION.ACTIVE_OPERATOR,
  preDamage: INTERACTION_DECISION.ACTIVE_OPERATOR,
  hit: INTERACTION_DECISION.ACTIVE_OPERATOR,
  hit_once: INTERACTION_DECISION.ACTIVE_OPERATOR,
  avoided: INTERACTION_DECISION.HOST_CONTROLLER,
  preDefense: INTERACTION_DECISION.HOST_CONTROLLER,
  preTake: INTERACTION_DECISION.HOST_CONTROLLER,
  dying: INTERACTION_DECISION.HOST_CONTROLLER,
  death: INTERACTION_DECISION.HOST_CONTROLLER,
  damaged: INTERACTION_DECISION.HOST_CONTROLLER,
  resourceChanged: INTERACTION_DECISION.HOST_CONTROLLER,
  combatStart: INTERACTION_DECISION.HOST_CONTROLLER,
  turnStart: INTERACTION_DECISION.HOST_CONTROLLER,
  turnEnd: INTERACTION_DECISION.HOST_CONTROLLER
})) {
  assert.equal(resolveInteractionDecision(trigger), expected, trigger);
}
pass("SCRIPT_TRIGGERS 全部触发器的决策归属符合计划映射");

for (const trigger of Object.values(SCRIPT_TRIGGERS)) {
  assert.notEqual(resolveInteractionDecision(trigger), null, `未知归属: ${trigger}`);
  if (!["passive", "calc"].includes(trigger)) assert.equal(isInteractiveTrigger(trigger), true, trigger);
}
assert.equal(isInteractiveTrigger("passive"), false);
assert.equal(isInteractiveTrigger("not_a_trigger"), false);
pass("归属映射覆盖全部已注册触发器；passive/calc 与未知触发器不允许交互");

{
  const ask = createScriptAsk({ actor: { name: "甲" }, trigger: "passive", label: "被动", source: null });
  assert.throws(() => ask(baseSpec), error => error instanceof XJZLScriptInteractionForbiddenError);
  let threw = false;
  try { ask(baseSpec); } catch { threw = true; }
  assert.equal(threw, true, "必须同步抛错而非 rejected Promise");
}
pass("passive/calc 的 ask 调用入口立即同步抛错");

assert.throws(
  () => createScriptAsk({ actor: { name: "甲" }, trigger: "unknown_trigger", label: "坏", source: null }),
  /未知触发器/
);
pass("未知触发器在内部绑定时即报错");

/* -------------------------------------------- */
/*  B. spec 与答案校验                             */
/* -------------------------------------------- */

console.log("B. spec 与答案校验");

{
  const check = validateInteractionSpec(baseSpec);
  assert.equal(check.ok, true);
  assert.deepEqual(check.normalized.buttons, [{ action: "confirm", label: "确认", default: true }]);
  assert.deepEqual(check.normalized.fields, [{ name: "mpCost", label: "消耗内力", type: "integer", value: 3, min: 0, max: 5 }]);
  assert.equal(check.normalized.title, "测试问询");
}
pass("合法 spec 产出只含已知字段的规范化副本");

for (const [label, spec] of Object.entries({
  "缺少标题": { ...baseSpec, title: "  " },
  "缺少按钮": { ...baseSpec, buttons: [] },
  "重复按钮 action": { ...baseSpec, buttons: [{ action: "a", label: "1" }, { action: "a", label: "2" }] },
  "多个默认按钮": { ...baseSpec, buttons: [{ action: "a", label: "1", default: true }, { action: "b", label: "2", default: true }] },
  "非法字段名": { ...baseSpec, fields: [{ name: "1bad", label: "x", type: "integer" }] },
  "未知字段类型": { ...baseSpec, fields: [{ name: "pick", label: "x", type: "richText" }] },
  "上下限倒置": { ...baseSpec, fields: [{ name: "n", label: "x", type: "integer", min: 5, max: 1 }] },
  "默认值越界": { ...baseSpec, fields: [{ name: "n", label: "x", type: "integer", value: 9, min: 0, max: 5 }] },
  "非整数值": { ...baseSpec, fields: [{ name: "n", label: "x", type: "integer", value: 1.5 }] },
  "select 缺少选项": { ...baseSpec, fields: [{ name: "pick", label: "x", type: "select", options: [] }] },
  "select 选项缺标签": { ...baseSpec, fields: [{ name: "pick", label: "x", type: "select", options: [{ value: "a", label: "" }] }] },
  "select 选项重复": { ...baseSpec, fields: [{ name: "pick", label: "x", type: "select", options: [{ value: "a", label: "1" }, { value: "a", label: "2" }] }] },
  "select 默认值不在枚举": { ...baseSpec, fields: [{ name: "pick", label: "x", type: "select", value: "z", options: [{ value: "a", label: "1" }] }] }
})) {
  assert.equal(validateInteractionSpec(spec).ok, false, label);
}
pass("非法 spec 全部被拒绝（含 select 选项白名单约束）");

{
  // select 字段：合法声明规范化，默认值缺省取第一项
  const check = validateInteractionSpec({
    title: "选择",
    buttons: [{ action: "confirm", label: "确认" }],
    fields: [{ name: "element", label: "属性", type: "select", options: [{ value: "yin", label: "阴" }, { value: "yang", label: "阳" }] }]
  });
  assert.equal(check.ok, true);
  assert.deepEqual(check.normalized.fields[0], {
    name: "element", label: "属性", type: "select", value: "yin",
    options: [{ value: "yin", label: "阴" }, { value: "yang", label: "阳" }]
  });
  const spec = check.normalized;
  const valid = validateInteractionAnswer(
    { status: "answered", action: "confirm", values: { element: "yang" } }, spec);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.values, { element: "yang" });
  for (const [label, answer] of Object.entries({
    "非字符串": { status: "answered", action: "confirm", values: { element: 1 } },
    "未知枚举": { status: "answered", action: "confirm", values: { element: "gang" } },
    "空值": { status: "answered", action: "confirm", values: { element: null } }
  })) {
    assert.equal(validateInteractionAnswer(answer, spec).ok, false, label);
  }
}
pass("select 字段按选项白名单校验答案：枚举内合法，非字符串与未知枚举无效");

{
  const spec = validateInteractionSpec(baseSpec).normalized;
  const valid = validateInteractionAnswer(
    { requestId: "r1", status: "answered", action: "confirm", values: { mpCost: 0 } }, spec);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.values, { mpCost: 0 });
  assert.equal(validateInteractionAnswer({ requestId: "r1", status: "cancelled" }, spec).ok, true);
}
pass("零值答案合法；非 answered 终态直接透传");

for (const [label, answer] of Object.entries({
  "未知按钮": { status: "answered", action: "other", values: { mpCost: 1 } },
  "多余字段": { status: "answered", action: "confirm", values: { mpCost: 1, extra: 2 } },
  "缺少字段": { status: "answered", action: "confirm", values: {} },
  "NaN": { status: "answered", action: "confirm", values: { mpCost: NaN } },
  "Infinity": { status: "answered", action: "confirm", values: { mpCost: Infinity } },
  "非整数": { status: "answered", action: "confirm", values: { mpCost: 2.5 } },
  "越界": { status: "answered", action: "confirm", values: { mpCost: 6 } },
  "未知状态": { status: "whatever", action: "confirm", values: {} },
  "非对象": null
})) {
  const spec = validateInteractionSpec(baseSpec).normalized;
  assert.equal(validateInteractionAnswer(answer, spec).ok, false, label);
}
pass("按钮白名单、字段集合与整数上下限校验拒绝全部非法答案");

/* -------------------------------------------- */
/*  C. 决策目标解析                                */
/* -------------------------------------------- */

console.log("C. 决策目标解析");

{
  const ownership = { "player-a": 3, "player-b": 3, "gm1": 3 };
  const gm = { id: "gm1", isGM: true, active: true };
  const a = { id: "player-a", isGM: false, active: true };
  const b = { id: "player-b", isGM: false, active: true };
  const offline = { id: "player-c", isGM: false, active: false };
  const base = { ownership, users: [gm, a, b], activeGMUserId: "gm1" };

  // 当前主动操作者：攻击/出招侧触发器始终本机决策，即使宿主另有在线 OWNER
  assert.deepEqual(
    resolveInteractionTarget({ decision: INTERACTION_DECISION.ACTIVE_OPERATOR, ...base, actorUuid: "Actor.x", activeUserId: "gm1" }),
    { userId: "gm1", local: true, reason: null });
  assert.deepEqual(
    resolveInteractionTarget({ decision: INTERACTION_DECISION.ACTIVE_OPERATOR, ...base, actorUuid: "Actor.x", activeUserId: "player-a" }),
    { userId: "player-a", local: true, reason: null });

  // 宿主控制者：本机 OWNER 决策优先
  assert.deepEqual(
    resolveInteractionTarget({ decision: INTERACTION_DECISION.HOST_CONTROLLER, ...base, actorUuid: "Actor.x", activeUserId: "player-a" }),
    { userId: "player-a", local: true, reason: null });
  // 宿主控制者：无本机 OWNER 时询问在线 OWNER
  assert.deepEqual(
    resolveInteractionTarget({ decision: INTERACTION_DECISION.HOST_CONTROLLER, ...base, actorUuid: "Actor.x", activeUserId: "gm1" }),
    { userId: "player-a", local: false, reason: null });
  // 指定角色匹配（user.character）优先于其他在线 OWNER，即使对方 ID 更小
  const designatedOwner = { id: "player-z", isGM: false, active: true, character: { uuid: "Actor.x" } };
  assert.deepEqual(
    resolveInteractionTarget({
      decision: INTERACTION_DECISION.HOST_CONTROLLER,
      ownership: { "player-a": 3, "player-z": 3 },
      actorUuid: "Actor.x",
      users: [gm, a, designatedOwner],
      activeUserId: "gm1",
      activeGMUserId: "gm1"
    }),
    { userId: "player-z", local: false, reason: null });
  // character 不匹配宿主时回退到稳定 ID 排序
  assert.deepEqual(
    resolveInteractionTarget({
      decision: INTERACTION_DECISION.HOST_CONTROLLER,
      ownership: { "player-a": 3, "player-z": 3 },
      actorUuid: "Actor.other",
      users: [gm, a, designatedOwner],
      activeUserId: "gm1",
      activeGMUserId: "gm1"
    }),
    { userId: "player-a", local: false, reason: null });
  // 无在线 OWNER：GM 兜底；活动 GM 是自己时本机
  assert.deepEqual(
    resolveInteractionTarget({ decision: INTERACTION_DECISION.HOST_CONTROLLER, ownership, users: [gm], actorUuid: "Actor.x", activeUserId: "player-x", activeGMUserId: "gm1" }),
    { userId: "gm1", local: false, reason: null });
  assert.deepEqual(
    resolveInteractionTarget({ decision: INTERACTION_DECISION.HOST_CONTROLLER, ownership: {}, users: [a, b], actorUuid: "Actor.x", activeUserId: "gm1", activeGMUserId: "gm1" }),
    { userId: "gm1", local: true, reason: null });
  // 离线 OWNER 跳过；无人可用返回 unavailable
  assert.deepEqual(
    resolveInteractionTarget({ decision: INTERACTION_DECISION.HOST_CONTROLLER, ownership: { "player-c": 3 }, users: [offline], actorUuid: "Actor.x", activeUserId: "gm1", activeGMUserId: "gm1" }),
    { userId: "gm1", local: true, reason: null });
  assert.deepEqual(
    resolveInteractionTarget({ decision: INTERACTION_DECISION.HOST_CONTROLLER, ownership: {}, users: [a, b], actorUuid: "Actor.x", activeUserId: "player-a", activeGMUserId: null }),
    { userId: null, local: false, reason: "no-available-controller" });
}
pass("主动操作者本机决策；宿主控制者按 本机 OWNER → user.character 匹配 → 稳定 ID → 活动 GM 解析");

{
  // default OWNER 与非链接 Token 独立 ownership
  const defaultOwner = { id: "p1", isGM: false, active: true };
  assert.equal(isEffectiveOwner({ default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }, defaultOwner), true);
  assert.equal(isEffectiveOwner({ default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }, defaultOwner), false);
  assert.equal(isEffectiveOwner({}, { id: "g", isGM: true, active: true }), true);

  const tokenOwnership = { "p1": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
  const tokenActor = { isToken: true, token: { actorLink: false, ownership: tokenOwnership }, ownership: { default: 0 } };
  assert.deepEqual(getInteractionOwnership(tokenActor), tokenOwnership);
  const linkedActor = { isToken: true, token: { actorLink: true, ownership: tokenOwnership }, ownership: { default: 0 } };
  assert.deepEqual(getInteractionOwnership(linkedActor), { default: 0 });
}
pass("有效 OWNER 判定包含 default OWNER；非链接 Token 使用其独立 ownership");

{
  // 截止时间协议校验：缺失/非数字/超期窗口全部拒绝
  const now = serverTime;
  assert.equal(validateInteractionDeadline(now + SCRIPT_INTERACTION_TIMEOUT_MS, { now }).ok, true);
  assert.equal(validateInteractionDeadline(undefined, { now }).ok, false);
  assert.equal(validateInteractionDeadline(`${now + 1000}`, { now }).reason, "deadline-not-number");
  assert.equal(validateInteractionDeadline(NaN, { now }).reason, "deadline-not-number");
  assert.equal(validateInteractionDeadline(now + SCRIPT_INTERACTION_TIMEOUT_MS + 60_000, { now }).reason, "deadline-too-far");
  // 已过期的截止属于合法形态，由过期检查按 timedOut 处理
  assert.equal(validateInteractionDeadline(now - 1000, { now }).ok, true);
}
pass("expiresAt 协议校验：必须是有限数字且不超出允许期限");

/* -------------------------------------------- */
/*  D. 本机问答链路（零 RPC）                      */
/* -------------------------------------------- */

console.log("D. 本机问答链路（零 RPC）");

const localPlayer = makeUser("p1");
const otherGM = makeUser("gm-other", { isGM: true });
const hostActor = makeActor("Actor.host", "伏气者", { "p1": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
setClient(localPlayer, [localPlayer, otherGM], "gm-other");
initScriptInteraction();

{
  dialogConfigs = [];
  closeCommands.length = 0;
  const ask = createScriptAsk({ actor: hostActor, trigger: "preTake", label: "伏气护体", source: null });
  const result = await withDialog([{ action: "confirm", values: { mpCost: 3 } }], null, () => ask(baseSpec));
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ANSWERED);
  assert.equal(result.action, "confirm");
  assert.deepEqual(result.values, { mpCost: 3 });
  assert.equal(dialogConfigs.length, 1, "同一请求只开一个本地窗口");
  assert.equal(closeCommands.length, 0, "本机决策不发任何 RPC");
}
pass("本机 ask：本地窗口收答，零 RPC，答案可直接消费");

{
  closeCommands.length = 0;
  const ask = createScriptAsk({ actor: hostActor, trigger: "preTake", label: "伏气护体", source: { uuid: "Item.fq", name: "伏气功" } });
  const result = await withDialog([null], null, () => ask(baseSpec));
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.CANCELLED);
  assert.equal(result.action, null);
  assert.equal(result.values, null);
  assert.equal(closeCommands.length, 0);
}
pass("玩家关窗：cancelled 结果且不携带 action/values");

{
  const ask = createScriptAsk({ actor: hostActor, trigger: "preTake", label: "伏气护体", source: null });
  const result = await withDialog([{ action: "confirm", values: { mpCost: "" } }], null, () => ask(baseSpec));
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ERROR);
  assert.equal(result.values, null);
}
pass("空输入经同一声明校验按 error 处理，不折算成 0");

{
  dialogConfigs = [];
  const badAsk = createScriptAsk({ actor: hostActor, trigger: "preTake", label: "坏声明", source: null });
  const result = await badAsk({ title: "x", buttons: [], fields: [] });
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ERROR);
  assert.equal(dialogConfigs.length, 0);
}
pass("非法 spec 直接返回 error，不开窗");

{
  dialogConfigs = [];
  setClient(localPlayer, [localPlayer, otherGM], null); // 无活动 GM
  const lonely = makeActor("Actor.lonely", "无人管", {});
  const ask = createScriptAsk({ actor: lonely, trigger: "preTake", label: "问询", source: null });
  const result = await withDialog([], null, () => ask(baseSpec));
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.UNAVAILABLE);
  assert.equal(dialogConfigs.length, 0);
  assert.ok(notices.some(message => message.includes("ControllerUnavailable")));
  setClient(localPlayer, [localPlayer, otherGM], "gm-other");
}
pass("没有可用决策人时明确返回 unavailable 并提示原端");

/* -------------------------------------------- */
/*  E. 远端问答链路                                */
/* -------------------------------------------- */

console.log("E. 远端问答链路");

const remoteGM = makeUser("gm1", { isGM: true });
const remotePlayer = makeUser("p2");
setClient(remoteGM, [remoteGM, remotePlayer], "gm1");
// 归 p2 所有的宿主：GM 结算端向在线玩家 OWNER 发起远端问答
const remoteHost = makeActor("Actor.remote-host", "远端宿主", { "p2": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });

{
  dialogConfigs = [];
  closeCommands.length = 0;
  remotePlayer.nextQueryResult = data => ({
    requestId: data.requestId, status: "answered", action: "confirm", values: { mpCost: 2 }
  });
  const ask = createScriptAsk({ actor: remoteHost, trigger: "preTake", label: "伏气护体", source: null });
  const result = await withDialog([], null, () => ask(baseSpec));
  const call = remotePlayer.queryCalls.at(-1);
  assert.equal(call.name, "xjzl.scriptInteraction");
  assert.equal(call.options.timeout, SCRIPT_INTERACTION_TIMEOUT_MS);
  const payload = JSON.parse(JSON.stringify(call.data));
  assert.equal(payload.version, 1);
  assert.equal(payload.recipientUserId, "p2");
  assert.equal(payload.requesterUserId, "gm1");
  assert.equal(payload.trigger, "preTake");
  assert.equal(payload.actorUuid, "Actor.remote-host");
  assert.equal(payload.formType, "form");
  assert.equal(payload.expiresAt, serverTime + SCRIPT_INTERACTION_TIMEOUT_MS);
  assert.deepEqual(payload.spec.buttons.map(button => button.action), ["confirm"]);
  assert.equal(dialogConfigs.length, 0, "原端不打开窗口");
  assert.equal(closeCommands.length, 1, "收到结果后发送纯 UI 关闭通知");
  assert.deepEqual(closeCommands[0], ["scriptInteractionCloseUI", "p2", { requestId: payload.requestId, requesterUserId: "gm1" }]);
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ANSWERED);
  assert.deepEqual(result.values, { mpCost: 2 });
}
pass("远端 ask：核心 User.query 携带纯 JSON 载荷与统一 timeout；结果消费后发送关闭通知");

{
  remotePlayer.nextQueryResult = data => ({
    requestId: data.requestId, status: "answered", action: "hijack", values: { mpCost: 5 }
  });
  const ask = createScriptAsk({ actor: remoteHost, trigger: "preTake", label: "伏气护体", source: null });
  const result = await withDialog([], null, () => ask(baseSpec));
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ERROR);
  assert.equal(result.values, null);
}
pass("伪造按钮的远端答案被同一声明校验拒绝");

{
  remotePlayer.nextQueryResult = () => ({
    requestId: "other-request", status: "answered", action: "confirm", values: { mpCost: 5 }
  });
  const ask = createScriptAsk({ actor: remoteHost, trigger: "preTake", label: "伏气护体", source: null });
  const result = await withDialog([], null, () => ask(baseSpec));
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ERROR);
}
pass("requestId 不匹配的答案不消费");

{
  dialogConfigs = [];
  // 迟到答案：截止已过则按超时结案，不重开窗口
  remotePlayer.pendingQuery = { promise: null };
  let releaseQuery;
  remotePlayer.pendingQuery.promise = new Promise(resolve => { releaseQuery = resolve; });
  const ask = createScriptAsk({ actor: remoteHost, trigger: "preTake", label: "伏气护体", source: null });
  const pending = withDialog([], null, () => ask(baseSpec));
  await new Promise(resolve => setImmediate(resolve));
  advanceServerTime(SCRIPT_INTERACTION_TIMEOUT_MS + 1000);
  releaseQuery({ requestId: "late", status: "answered", action: "confirm", values: { mpCost: 1 } });
  const result = await pending;
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.TIMED_OUT);
  assert.equal(dialogConfigs.length, 0);
}
pass("迟到答案不重开已终结请求：按同步 serverTime 判断截止并返回 timedOut");

{
  // 断线取消：仅按真正断线状态（userConnected false）取消，答案不再被消费
  remotePlayer.pendingQuery = { promise: null };
  let releaseQuery;
  remotePlayer.pendingQuery.promise = new Promise(resolve => { releaseQuery = resolve; });
  const ask = createScriptAsk({ actor: remoteHost, trigger: "preTake", label: "伏气护体", source: null });
  const pending = withDialog([], null, () => ask(baseSpec));
  await new Promise(resolve => setImmediate(resolve));
  Hooks.callAll("userConnected", remotePlayer, true); // 普通上线事件不进入取消路径
  advanceServerTime(1000);
  Hooks.callAll("userConnected", remotePlayer, false);
  const result = await pending;
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.CANCELLED);
  releaseQuery({ requestId: "late", status: "answered", action: "confirm", values: { mpCost: 1 } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(remotePlayer.queryCalls.at(-1).data.requestId, result.requestId);
}
pass("接收端断线按 userConnected 真实状态取消；普通活动事件不误判");

/* -------------------------------------------- */
/*  F. 宿主删除中止                                */
/* -------------------------------------------- */

console.log("F. 宿主删除中止");

setClient(localPlayer, [localPlayer, otherGM], "gm-other");

{
  closeCommands.length = 0;
  let closeDialog = null;
  const ask = createScriptAsk({ actor: hostActor, trigger: "preTake", label: "伏气护体", source: null });
  const pending = withDialog([], (config, dialog) => {
    closeDialog = () => { void dialog.close(); };
  }, () => ask(baseSpec));
  await new Promise(resolve => setImmediate(resolve));
  Hooks.callAll("deleteActor", hostActor);
  await assert.rejects(pending, error => error instanceof XJZLScriptAbortError);
  closeDialog();
  assert.ok(notices.some(message => message.includes("Aborted")));
  assert.equal(closeCommands.length, 0, "本机路径无需远端关闭通知");
}
pass("世界宿主删除：ask 以可识别中止错误拒绝并关闭本地窗口");

{
  // 非链接 Token：完整 UUID 携带 Token 前缀；删除该 Token 中止，删除其他 Token 不中止
  const tokenActor = makeActor("Scene.s1.Token.t1.Actor.a1", "链接体", { "p1": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
  let release;
  const ask = createScriptAsk({ actor: tokenActor, trigger: "preTake", label: "问询", source: null });
  const pending = withDialog([], (config, dialog) => {
    release = answer => { dialog.config.submit?.(answer, dialog); void dialog.close(); };
  }, () => ask(baseSpec));
  await new Promise(resolve => setImmediate(resolve));
  Hooks.callAll("deleteToken", { uuid: "Scene.s1.Token.t9" });
  await new Promise(resolve => setImmediate(resolve));
  release({ status: "answered", action: "confirm", values: { mpCost: 1 } });
  const result = await pending;
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ANSWERED, "删除无关 Token 不得误中止当前宿主");

  const tokenActor2 = makeActor("Scene.s1.Token.t2.Actor.a2", "链接体二", { "p1": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
  let closeDialog2 = null;
  const ask2 = createScriptAsk({ actor: tokenActor2, trigger: "preTake", label: "问询", source: null });
  const pending2 = withDialog([], (config, dialog) => {
    closeDialog2 = () => { void dialog.close(); };
  }, () => ask2(baseSpec));
  await new Promise(resolve => setImmediate(resolve));
  Hooks.callAll("deleteToken", { uuid: "Scene.s1.Token.t2" });
  await assert.rejects(pending2, error => error instanceof XJZLScriptAbortError);
  closeDialog2();
}
pass("非链接 Token 按具体 Token UUID 判断删除；删除其他同源 Token 不误中止");

{
  // 消费答案前再次确认宿主仍存在：答案在途中宿主被删 → 中止
  let release;
  const ask = createScriptAsk({ actor: hostActor, trigger: "preTake", label: "伏气护体", source: null });
  const pending = withDialog([], (config, dialog) => {
    release = answer => { dialog.config.submit?.(answer, dialog); void dialog.close(); };
  }, () => ask(baseSpec));
  await new Promise(resolve => setImmediate(resolve));
  registry.delete("Actor.host");
  release({ status: "answered", action: "confirm", values: { mpCost: 1 } });
  await assert.rejects(pending, error => error instanceof XJZLScriptAbortError);
  registry.set("Actor.host", hostActor);
}
pass("消费答案前复核宿主存在；等待期间被删除按中止处理");

/* -------------------------------------------- */
/*  G. 接收端校验、防重复弹窗与关闭通知              */
/* -------------------------------------------- */

console.log("G. 接收端校验、防重复弹窗与关闭通知");

function buildPayload({ requestId = `req-${++sequence}`, expiresAt, formType = "form",
  spec = validateInteractionSpec(baseSpec).normalized,
  recipientUserId = "p2", requesterUserId = "gm1", trigger = "preTake",
  actorUuid = "Actor.host", version = 1 } = {}) {
  return {
    version, requestId, actorUuid, actorName: "伏气者",
    recipientUserId, requesterUserId, trigger,
    source: { uuid: "Item.fq", name: "伏气功" },
    formType, spec,
    expiresAt: expiresAt ?? serverTime + SCRIPT_INTERACTION_TIMEOUT_MS
  };
}

setClient(remotePlayer, [remoteGM, remotePlayer], "gm1");

  dialogConfigs = [];
{
  const result = await withDialog([], null, () =>
    ScriptInteractionManager.handleInteractionQuery(buildPayload(), { user: remoteGM }));
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.CANCELLED);
  assert.equal(dialogConfigs.length, 1);
}
pass("接收端打开本地窗口；关窗返回 cancelled");

{
  // 渲染完成但尚未回答：窗口进入正常等待（剩余时间提示已启动），不被应答驱动绑死
  setClient(remotePlayer, [remoteGM, remotePlayer], "gm1");
  dialogConfigs = [];
  dialogInstances.length = 0;
  appQuerySelectorResult = { textContent: "" };
  let formatCalls = 0;
  const originalFormat = game.i18n.format;
  game.i18n.format = (key, values) => {
    if (key === "XJZL.ScriptInteraction.RemainingTime") formatCalls += 1;
    return originalFormat(key, values);
  };
  try {
    let release = null;
    const pending = withDialog([], (config, dialog) => {
      release = answer => { dialog.config.submit?.(answer, dialog); void dialog.close(); };
    }, () => ScriptInteractionManager.handleInteractionQuery(buildPayload({ requestId: "idle-1" }), { user: remoteGM }));
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    const dialog = dialogInstances.at(-1);
    assert.equal(dialog.rendered, true, "窗口已完成渲染");
    assert.ok(formatCalls >= 1, "渲染后处理已启动（剩余时间提示已计算）");
    let settledFlag = false;
    void pending.then(() => { settledFlag = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settledFlag, false, "未回答时问询保持等待");
    release({ status: "answered", action: "confirm", values: { mpCost: 2 } });
    const result = await pending;
    assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ANSWERED);
    assert.deepEqual(result.values, { mpCost: 2 });
  } finally {
    game.i18n.format = originalFormat;
    appQuerySelectorResult = null;
  }
}
pass("渲染完成但未回答：窗口正常等待（剩余时间提示运行），应答后正常结案");

for (const [label, payload, context, expectedStatus, expectedReason] of [
  ["版本不支持", buildPayload({ version: 99 }), { user: remoteGM }, SCRIPT_INTERACTION_STATUS.ERROR, null],
  ["非接收者", buildPayload({ recipientUserId: "other" }), { user: remoteGM }, SCRIPT_INTERACTION_STATUS.UNAVAILABLE, "not-recipient"],
  ["已过期", buildPayload({ expiresAt: serverTime - 1 }), { user: remoteGM }, SCRIPT_INTERACTION_STATUS.TIMED_OUT, "expired"],
  ["触发器不允许交互", buildPayload({ trigger: "passive" }), { user: remoteGM }, SCRIPT_INTERACTION_STATUS.UNAVAILABLE, "trigger-not-interactive"],
  ["未知表单类型", buildPayload({ formType: "richText" }), { user: remoteGM }, SCRIPT_INTERACTION_STATUS.ERROR, "form-type-unsupported"],
  ["普通 form 携带 check 块", buildPayload({ formType: "form", spec: validateInteractionSpec({ ...baseSpec, check: { label: "体魄", baseVal: 5, sysBonus: 0, sysLevel: 0 } }).normalized }), { user: remoteGM }, SCRIPT_INTERACTION_STATUS.ERROR, "form-type-mismatch"],
  ["检定配置缺少 check 块", buildPayload({ formType: "attributeTestConfig" }), { user: remoteGM }, SCRIPT_INTERACTION_STATUS.ERROR, "form-type-mismatch"],
  ["伪装发送者", buildPayload(), { user: makeUser("mallory") }, SCRIPT_INTERACTION_STATUS.UNAVAILABLE, "sender-mismatch"],
  ["宿主缺失", buildPayload({ actorUuid: "Actor.missing" }), { user: remoteGM }, SCRIPT_INTERACTION_STATUS.UNAVAILABLE, "host-missing"],
  ["非 OWNER 发送者", buildPayload({ requesterUserId: "p2" }), { user: remotePlayer }, SCRIPT_INTERACTION_STATUS.UNAVAILABLE, "sender-forbidden"]
]) {
  dialogConfigs = [];
  const result = await withDialog([], null, () =>
    ScriptInteractionManager.handleInteractionQuery(payload, context));
  assert.equal(result.status, expectedStatus, label);
  if (expectedReason) assert.equal(result.reason, expectedReason, label);
  assert.equal(dialogConfigs.length, 0, `${label} 不应开窗`);
}
pass("载荷、版本、过期、触发器、表单类型、发送者与宿主校验全部拒绝且不开窗");

{
  // 宿主有效 OWNER 玩家可作为真实发送者通过校验
  dialogConfigs = [];
  const ownership = registry.get("Actor.host").ownership;
  ownership["p2"] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  const result = await withDialog([], null, () =>
    ScriptInteractionManager.handleInteractionQuery(buildPayload({ requesterUserId: "p2" }), { user: remotePlayer }));
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.CANCELLED);
  assert.equal(dialogConfigs.length, 1);
  delete ownership["p2"];
}
pass("宿主有效 OWNER 玩家可作为真实发送者通过校验并开窗");

{
  dialogConfigs = [];
  // 同一请求只开一个本地窗口；终态记录防止重复弹窗
  let pendingClose = null;
  const first = withDialog([], (config, dialog) => {
    pendingClose = () => { void dialog.close(); };
  }, () => ScriptInteractionManager.handleInteractionQuery(buildPayload({ requestId: "dup" }), { user: remoteGM }));
  await new Promise(resolve => setImmediate(resolve));
  const second = await withDialog([], null, () =>
    ScriptInteractionManager.handleInteractionQuery(buildPayload({ requestId: "dup" }), { user: remoteGM }));
  assert.equal(second.status, SCRIPT_INTERACTION_STATUS.CANCELLED);
  assert.equal(second.reason, "window-exists");
  assert.equal(dialogConfigs.length, 1, "重复查询不开第二个窗口（仅首个窗口）");
  pendingClose();
  const firstResult = await first;
  assert.equal(firstResult.status, SCRIPT_INTERACTION_STATUS.CANCELLED);
  const third = await withDialog([], null, () =>
    ScriptInteractionManager.handleInteractionQuery(buildPayload({ requestId: "dup" }), { user: remoteGM }));
  assert.equal(third.reason, "already-settled");
}
pass("同一请求只开一个窗口；窗口存续与终态记录都阻止重复弹窗");

{
  dialogConfigs = [];
  // 关闭通知：真实发送者对照；取消先到的短期记录按“真实请求者＋requestId”隔离
  let pendingClose = null;
  let settled = false;
  const pending = withDialog([], (config, dialog) => {
    pendingClose = () => { void dialog.close(); };
  }, () => ScriptInteractionManager.handleInteractionQuery(buildPayload({ requestId: "close-1" }), { user: remoteGM })
    .then(result => { settled = true; return result; }));
  await new Promise(resolve => setImmediate(resolve));
  // 错误发送者的关闭通知被忽略，窗口保持
  ScriptInteractionManager.handleCloseNotification.call(
    { socketdata: { userId: "mallory" } }, { requestId: "close-1", requesterUserId: "gm1" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, "不匹配发送者的关闭通知不关闭窗口");
  // 正确请求者的关闭通知结束纯 UI
  ScriptInteractionManager.handleCloseNotification.call(
    { socketdata: { userId: "gm1" } }, { requestId: "close-1", requesterUserId: "gm1" });
  const result = await pending;
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.CANCELLED);
}
pass("关闭通知以真实 socket 发送者对照请求记录，只结束匹配的窗口");

{
  dialogConfigs = [];
  // 竞态：关闭通知先于查询处理到达 → 记录短期终态，查询到达后不再开窗
  ScriptInteractionManager.handleCloseNotification.call(
    { socketdata: { userId: "gm1" } }, { requestId: "close-race", requesterUserId: "gm1" });
  const result = await withDialog([], null, () =>
    ScriptInteractionManager.handleInteractionQuery(buildPayload({ requestId: "close-race" }), { user: remoteGM }));
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.CANCELLED);
  assert.equal(dialogConfigs.length, 0);
}
pass("关闭通知先到的竞态按已终结处理，不重开窗口");

/* -------------------------------------------- */
/*  H. applyHealing 事实值契约（真实 actor.mjs）    */
/* -------------------------------------------- */

console.log("H. applyHealing 事实值契约");

function makeResourceActor() {
  return Object.assign(Object.create(XJZLActor.prototype), {
    uuid: `Actor.res${++sequence}`, name: "内力者", type: "character", isOwner: true,
    system: {
      resources: {
        hp: { value: 50, max: 100 },
        mp: { value: 5, max: 10 },
        rage: { value: 0, max: 10 }
      }
    },
    _source: {
      system: { resources: { hp: { value: 50, max: 100 }, mp: { value: 5, max: 10 }, rage: { value: 0, max: 10 } } }
    },
    xjzlStatuses: {},
    _resourceScriptCache: false
  });
}

{
  const actor = makeResourceActor();
  const result = await actor.applyHealing({ amount: -3, type: "mp", healer: actor, showScrolling: false });
  assert.equal(result.actualHeal, -3);
  assert.equal(actor.system.resources.mp.value, 2);
}
pass("足额流失：actualHeal 反映真实提交的差值");

{
  const actor = makeResourceActor();
  const result = await actor.applyHealing({ amount: -8, type: "mp", healer: actor, showScrolling: false });
  assert.equal(result.actualHeal, -5);
  assert.equal(actor.system.resources.mp.value, 0);
  assert.equal(result.overflow, -3);
}
pass("余额不足：按真实下限裁剪，actualHeal 与实际变化一致");

{
  const actor = makeResourceActor();
  actor._cancelNextUpdate = true; // 模拟 preUpdate 拦截取消主更新
  const result = await actor.applyHealing({ amount: -3, type: "mp", healer: actor, showScrolling: false });
  assert.equal(result.actualHeal, 0, "更新被取消时不得报告消耗");
  assert.equal(actor.system.resources.mp.value, 5);
}
pass("更新被取消：事实值修正为 0，不冒充已提交的消耗");

/* -------------------------------------------- */
/*  I. 真实迁移脚本：伏气护体全链                   */
/* -------------------------------------------- */

console.log("I. 真实迁移脚本：伏气护体全链");

const fuqiSource = JSON.parse(readFileSync(resolve(root, "data/neigong/wanshoushanzhuang.json"), "utf8"));
const fuqiEntry = fuqiSource[2].system.config.stage3.scripts[1];
assert.equal(fuqiEntry.label, "伏气护体");
assert.equal(fuqiEntry.trigger, "preTake");
const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
const fuqiFn = new AsyncFunction("ask", "actor", "S", "args", "thisItem", fuqiEntry.script);

// 运功来源 mock：脚本等待后按 active_neigong + system.stage + 当前阶段脚本复核资格。
const fuqiItem = {
  id: "item-fuqi", name: "《伏气功》",
  system: {
    stage: 3,
    current: { scripts: [{ label: "伏气护体", trigger: "preTake", active: true }] }
  }
};

function makeFuqiActor() {
  const actor = makeActor(`Actor.fuqi${++sequence}`, "伏气侠客", { "p1": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
  actor.system.martial = { active_neigong: fuqiItem.id };
  actor.items = { get: id => (id === fuqiItem.id ? fuqiItem : null) };
  return actor;
}

/** 直接以 mock ask 执行真实脚本文本，检查脚本分支本身。duringAsk 可改状态并返回消耗覆盖值。 */
async function runFuqiScript({ damage = 25, hpValue = 20, mpValue = 9, duringAsk = null, healResult = null }) {
  const actor = makeFuqiActor();
  actor.system.resources.hp.value = hpValue;
  actor.system.resources.mp.value = mpValue;
  if (healResult) actor.nextHealResult = healResult;
  const args = { type: "waigong", output: { damage } };
  const specs = [];
  const ask = async spec => {
    specs.push(spec);
    const override = duringAsk ? duringAsk(actor) : undefined;
    const cost = override !== undefined ? override : spec.fields[0].max;
    return { requestId: "r", status: "answered", action: "confirm", values: { mpCost: cost } };
  };
  await fuqiFn(ask, actor, actor.system, args, fuqiItem);
  return { actor, args, specs };
}

{
  const { specs } = await runFuqiScript({ hpValue: 50 });
  assert.equal(specs.length, 0);
}
pass("血量健康时不触发问询（入口条件不变）");

{
  const { actor, args, specs } = await runFuqiScript({ damage: 25, mpValue: 9 });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].fields[0].max, 8, "上限 = min(内力, ceil((伤害-1)/3))");
  assert.equal(specs[0].fields[0].min, 0);
  assert.deepEqual(actor.healCalls, [{ healer: actor, amount: -8, type: "mp", showScrolling: false }]);
  assert.equal(actor.system.resources.mp.value, 1);
  assert.equal(args.output.damage, 25 - 24, "按实际负向 actualHeal 3:1 抵伤");
  assert.equal(actor.floatyCalls.length, 1);
}
pass("足额消耗：先扣内力再按 actualHeal×3 抵伤");

{
  const { args } = await runFuqiScript({ damage: 25, healResult: { actualHeal: -2 } });
  assert.equal(args.output.damage, 25 - 6, "实际扣 2 点内力只抵 6 点伤害");
}
pass("消耗被裁剪：以实际负向 actualHeal 兑现，不按请求数量抵伤");

{
  const { args, actor } = await runFuqiScript({ damage: 25, healResult: { actualHeal: 0 } });
  assert.equal(args.output.damage, 25, "消耗未提交时不得免费抵伤");
  assert.equal(actor.floatyCalls.length, 0);
}
pass("applyHealing 返回 0（提交被取消）：无免费收益，伤害不变");

{
  const { args, actor } = await runFuqiScript({ damage: 25, duringAsk: () => 0 });
  assert.equal(args.output.damage, 25);
  assert.equal(actor.healCalls.length, 0, "零值答案不产生消耗");
}
pass("零值答案合法且走默认分支：放弃可选护体");

{
  const actor = makeFuqiActor();
  actor.system.resources.hp.value = 20;
  const args = { type: "waigong", output: { damage: 25 } };
  let asked = 0;
  const ask = async () => { asked += 1; return { requestId: "r", status: "cancelled" }; };
  await fuqiFn(ask, actor, actor.system, args, fuqiItem);
  assert.equal(asked, 1);
  assert.equal(args.output.damage, 25);
  assert.equal(actor.healCalls.length, 0);
}
pass("取消：放弃可选部分，不改变伤害也不消耗");

{
  // 等待期间切换运功：来源不再是本内功时放弃可选护体，不消耗旧内功对应的内力
  const { args, actor } = await runFuqiScript({
    damage: 25,
    duringAsk: actor0 => {
      actor0.system.martial.active_neigong = "item-other";
      return 8;
    }
  });
  assert.equal(args.output.damage, 25, "运功来源已切换：不沿用 await 前的资格");
  assert.equal(actor.healCalls.length, 0);
}
pass("等待后复核运功来源与阶段资格：切换内功时放弃消耗");

{
  const { args, actor } = await runFuqiScript({
    damage: 25,
    duringAsk: actor0 => { actor0.system.resources.hp.value = 80; return 8; }
  });
  assert.equal(args.output.damage, 25, "等待后血量已脱离阈值：不沿用 await 前的状态");
  assert.equal(actor.healCalls.length, 0);
}
pass("等待后复核低血门槛：条件不再成立时放弃消耗");

{
  const { args, actor } = await runFuqiScript({
    damage: 25,
    duringAsk: actor0 => { actor0.system.resources.mp.value = 0; return 8; }
  });
  assert.equal(args.output.damage, 25);
  assert.equal(actor.healCalls.length, 0, "等待后内力已空：不发起无意义的流失");
}
pass("等待后复核内力门槛：内力为空时放弃");

{
  const { args } = await runFuqiScript({ damage: 4, mpValue: 9 });
  assert.equal(args.output.damage, 1, "保底 1 点伤害语义保留");
}
pass("最低 1 点伤害保底保留");

{
  // 全链：真实脚本 → 真实 manager → 真实 dialog mock → 真实校验 → 回到脚本
  closeCommands.length = 0;
  setClient(localPlayer, [localPlayer, otherGM], "gm-other");
  const actor = makeFuqiActor();
  actor.system.resources.hp.value = 20;
  actor.system.resources.mp.value = 9;
  const args = { type: "waigong", output: { damage: 25 } };
  const ask = createScriptAsk({ actor, trigger: "preTake", label: "伏气护体", source: null });
  await withDialog([{ action: "confirm", values: { mpCost: 3 } }], null,
    () => fuqiFn(ask, actor, actor.system, args, fuqiItem));
  assert.deepEqual(actor.healCalls, [{ healer: actor, amount: -3, type: "mp", showScrolling: false }]);
  assert.equal(actor.system.resources.mp.value, 6);
  assert.equal(args.output.damage, 25 - 9);
  assert.equal(closeCommands.length, 0, "宿主 OWNER 本机决策：全链零 RPC");
}
pass("全链（脚本→manager→表单→校验→脚本）：本机决策零 RPC 且抵伤正确");

/* -------------------------------------------- */
/*  J. 审阅修复回归                                */
/* -------------------------------------------- */

console.log("J. 审阅修复回归");

/** 可跑完整 _applyDamage 链的最小人物 Actor（防御数值全零，无脚本来源）。 */
function makeDamageActor() {
  return Object.assign(Object.create(XJZLActor.prototype), {
    uuid: `Actor.dmg${++sequence}`, name: "受击者", type: "character", isOwner: true,
    system: {
      resources: {
        hp: { value: 50, max: 100 }, mp: { value: 10, max: 10 },
        rage: { value: 0, max: 10 }, huti: 0, morale: { value: 0, max: 10 }
      },
      combat: {
        defWaigongTotal: 0, defNeigongTotal: 0, blockTotal: 0, stanceBlockValue: 0,
        resistances: {
          global: { total: 0 }, skill: { total: 0 }, bleed: { total: 0 }, poison: { total: 0 },
          fire: { total: 0 }, mental: { total: 0 }, liushi: { total: 0 },
          neigong: { total: 0 }, waigong: { total: 0 }
        }
      },
      martial: null
    },
    _source: {
      system: {
        resources: {
          hp: { value: 50, max: 100 }, mp: { value: 10, max: 10 },
          rage: { value: 0, max: 10 }, huti: 0, morale: { value: 0, max: 10 }
        }
      }
    },
    xjzlStatuses: {},
    _resourceScriptCache: false,
    effects: [],
    showFloatyText() {},
    async toggleStatusEffect() {},
    async stopStance() {},
    token: null
  });
}

{
  // 主动操作者分支端到端：GM 执行 attack 时问询本机打开，不发给玩家 OWNER
  dialogConfigs = [];
  closeCommands.length = 0;
  remotePlayer.queryCalls.length = 0;
  setClient(remoteGM, [remoteGM, remotePlayer], "gm1");
  const ask = createScriptAsk({ actor: remoteHost, trigger: "attack", label: "出招选择", source: null });
  const result = await withDialog([{ action: "confirm", values: { mpCost: 1 } }], null, () => ask(baseSpec));
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ANSWERED);
  assert.equal(dialogConfigs.length, 1, "问询在本机（操作者）打开");
  assert.equal(remotePlayer.queryCalls.length, 0, "不询问宿主 OWNER");
}
pass("attack 触发器按当前主动操作者本机决策，即使宿主另有在线 OWNER");

{
  // 指定角色匹配端到端：user.character 绑定宿主的 OWNER 优先于 ID 更小的其他 OWNER
  dialogConfigs = [];
  const playerA = makeUser("player-a");
  const playerZ = makeUser("player-z", { character: { uuid: "Actor.designated" } });
  setClient(remoteGM, [remoteGM, playerA, playerZ], "gm1");
  const designatedHost = makeActor("Actor.designated", "指定角色", {
    "player-a": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
    "player-z": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
  });
  playerZ.nextQueryResult = data => ({ requestId: data.requestId, status: "answered", action: "confirm", values: { mpCost: 1 } });
  const ask = createScriptAsk({ actor: designatedHost, trigger: "preTake", label: "问询", source: null });
  const result = await withDialog([], null, () => ask(baseSpec));
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ANSWERED);
  assert.equal(playerZ.queryCalls.length, 1);
  assert.equal(playerA.queryCalls.length, 0, "不询问未绑定宿主的其他 OWNER");
}
pass("宿主控制者优先询问 user.character 匹配的在线 OWNER");

{
  // 消费前权限复核：决策人 OWNER 权限被撤销后答案不消费
  setClient(remoteGM, [remoteGM, remotePlayer], "gm1");
  remotePlayer.pendingQuery = { promise: null };
  let releaseQuery;
  remotePlayer.pendingQuery.promise = new Promise(resolve => { releaseQuery = resolve; });
  const ask = createScriptAsk({ actor: remoteHost, trigger: "preTake", label: "伏气护体", source: null });
  const pending = withDialog([], null, () => ask(baseSpec));
  await new Promise(resolve => setImmediate(resolve));
  const requestId = remotePlayer.queryCalls.at(-1).data.requestId;
  delete remoteHost.ownership["p2"];
  releaseQuery({ requestId, status: "answered", action: "confirm", values: { mpCost: 3 } });
  const result = await pending;
  remoteHost.ownership["p2"] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  remotePlayer.pendingQuery = null;
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ERROR);
  assert.equal(result.reason, "controller-unauthorized");
  assert.equal(result.values, null);
}
pass("等待期间撤销决策人权限：旧答案按 error 返回，不再消费");

{
  // 来源删除监听：脚本来源（Item）删除即中止原端等待
  registry.set("Item.src", { uuid: "Item.src", name: "来源内功" });
  let closeDialog = null;
  const ask = createScriptAsk({
    actor: hostActor, trigger: "preTake", label: "伏气护体",
    source: { uuid: "Item.src", name: "来源内功" }
  });
  const pending = withDialog([], (config, dialog) => {
    closeDialog = () => { void dialog.close(); };
  }, () => ask(baseSpec));
  await new Promise(resolve => setImmediate(resolve));
  Hooks.callAll("deleteItem", registry.get("Item.src"));
  await assert.rejects(pending, error => error instanceof XJZLScriptAbortError);
  closeDialog();
  registry.delete("Item.src");
}
pass("来源 Item 删除：ask 以中止错误结束");

{
  // 消费前来源复核：答案在途中来源已被删除 → 中止
  registry.set("Item.src2", { uuid: "Item.src2", name: "来源内功" });
  let release;
  const ask = createScriptAsk({
    actor: hostActor, trigger: "preTake", label: "伏气护体",
    source: { uuid: "Item.src2", name: "来源内功" }
  });
  const pending = withDialog([], (config, dialog) => {
    release = answer => { dialog.config.submit?.(answer, dialog); void dialog.close(); };
  }, () => ask(baseSpec));
  await new Promise(resolve => setImmediate(resolve));
  registry.delete("Item.src2");
  release({ status: "answered", action: "confirm", values: { mpCost: 1 } });
  await assert.rejects(pending, error => error instanceof XJZLScriptAbortError && error.abortReason === "source-deleted");
}
pass("消费答案前复核来源有效性：来源已删除按中止处理");

{
  // 终态按“真实发送者＋requestId”隔离：其他用户抢先的关闭通知不能阻断合法查询
  setClient(remotePlayer, [remoteGM, remotePlayer], "gm1");
  dialogConfigs = [];
  ScriptInteractionManager.handleCloseNotification.call(
    { socketdata: { userId: "mallory" } }, { requestId: "iso-1", requesterUserId: "gm1" });
  const result = await withDialog([], null, () =>
    ScriptInteractionManager.handleInteractionQuery(buildPayload({ requestId: "iso-1" }), { user: remoteGM }));
  assert.equal(result.reason, "dismissed", "mallory 写入的终态不作用于 GM 的查询");
  // 真实请求者自己的关闭通知先到 → 其后查询按已终结拒绝
  ScriptInteractionManager.handleCloseNotification.call(
    { socketdata: { userId: "gm1" } }, { requestId: "iso-2", requesterUserId: "gm1" });
  const result2 = await withDialog([], null, () =>
    ScriptInteractionManager.handleInteractionQuery(buildPayload({ requestId: "iso-2" }), { user: remoteGM }));
  assert.equal(result2.reason, "already-settled");
}
pass("提前关闭通知与终态缓存按真实发送者隔离");

{
  // 请求端断线：接收端窗口立即关闭并解除等待，不拖到自身截止
  let pendingClose = null;
  const pending = withDialog([], (config, dialog) => {
    pendingClose = () => { void dialog.close(); };
  }, () => ScriptInteractionManager.handleInteractionQuery(buildPayload({ requestId: "req-lost" }), { user: remoteGM }));
  await new Promise(resolve => setImmediate(resolve));
  Hooks.callAll("userConnected", remoteGM, false);
  const result = await Promise.race([
    pending,
    new Promise((_, reject) => setTimeout(() => reject(new Error("请求端断线后窗口未解除等待")), 250))
  ]);
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.CANCELLED);
}
pass("请求端断线：接收端按 requesterUserId 关闭窗口并解除等待");

{
  // 宿主删除：接收端窗口同步关闭，不完全依赖原端关闭通知
  let pendingClose = null;
  const pending = withDialog([], (config, dialog) => {
    pendingClose = () => { void dialog.close(); };
  }, () => ScriptInteractionManager.handleInteractionQuery(buildPayload({ requestId: "host-lost" }), { user: remoteGM }));
  await new Promise(resolve => setImmediate(resolve));
  Hooks.callAll("deleteActor", registry.get("Actor.host"));
  const result = await Promise.race([
    pending,
    new Promise((_, reject) => setTimeout(() => reject(new Error("宿主删除后接收窗口未解除等待")), 250))
  ]);
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.CANCELLED);
}
pass("宿主删除：接收端窗口按宿主身份同步关闭");

{
  // 渲染期间取消：终结独立于渲染完成
  deferRender = true;
  dialogConfigs = [];
  try {
    const pending = withDialog([], null, () => ScriptInteractionManager.handleInteractionQuery(buildPayload({ requestId: "render-1" }), { user: remoteGM }));
    await new Promise(resolve => setImmediate(resolve));
    ScriptInteractionManager.handleCloseNotification.call(
      { socketdata: { userId: "gm1" } }, { requestId: "render-1", requesterUserId: "gm1" });
    const result = await Promise.race([
      pending,
      new Promise((_, reject) => setTimeout(() => reject(new Error("渲染未完成时等待未独立结束")), 250))
    ]);
    assert.equal(result.status, SCRIPT_INTERACTION_STATUS.CANCELLED);
    flushDeferredRenders(); // 迟到的渲染完成：按 pendingClose 补关闭窗口
  } finally {
    deferRender = false;
  }
}
pass("渲染完成前的取消：等待独立终结，窗口稍后补关闭");

{
  // 渲染失败：直接观察 render 的 Promise，立即以确定的 error 结案并清理窗口
  deferRender = true;
  renderFailure = new Error("模板渲染失败");
  try {
    const pending = withDialog([], null, () =>
      ScriptInteractionManager.handleInteractionQuery(buildPayload({ requestId: "render-fail" }), { user: remoteGM }));
    await new Promise(resolve => setImmediate(resolve));
    flushDeferredRenders();
    const result = await Promise.race([
      pending,
      new Promise((_, reject) => setTimeout(() => reject(new Error("渲染失败后等待未结案")), 250))
    ]);
    assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ERROR);
    assert.equal(result.reason, "render-failed");
    assert.equal(dialogInstances.at(-1).closed, true, "失败后窗口已清理");
  } finally {
    deferRender = false;
    renderFailure = null;
  }
}
pass("渲染失败：立即返回确定的 error 结果并清理，不产生挂起或 unhandledRejection");
pass("渲染失败：等待可经外部关闭解除，不永久保留登记");

{
  // expiresAt 协议校验：缺失/非数字/超期窗口在开窗前拒绝
  const missing = buildPayload({ requestId: "dl-1" });
  delete missing.expiresAt;
  const cases = [
    ["缺失截止", missing],
    ["非数字截止", buildPayload({ requestId: "dl-2", expiresAt: "abc" })],
    ["超出协议期限", buildPayload({ requestId: "dl-3", expiresAt: serverTime + SCRIPT_INTERACTION_TIMEOUT_MS + 60_000 })]
  ];
  for (const [label, payload] of cases) {
    dialogConfigs = [];
    const result = await withDialog([], null, () =>
      ScriptInteractionManager.handleInteractionQuery(payload, { user: remoteGM }));
    assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ERROR, label);
    assert.equal(result.reason.startsWith("deadline-"), true, label);
    assert.equal(dialogConfigs.length, 0, `${label} 不开窗`);
  }
}
pass("缺失或非法的 expiresAt 按协议违规拒绝，不让 NaN 进入剩余时间计算");

{
  // 输入不做截断：1.9 非整数拒绝；1e1 完整转换为 10 后超上限拒绝；空白容忍
  dialogConfigs = [];
  const reject = await withDialog([{ action: "confirm", values: { mpCost: "1.9" } }], null, () =>
    ScriptInteractionManager.handleInteractionQuery(buildPayload({ requestId: "pi-1" }), { user: remoteGM }));
  assert.equal(reject.status, SCRIPT_INTERACTION_STATUS.ERROR);
  assert.equal(reject.reason, "value-not-integer");

  dialogConfigs = [];
  const exponent = await withDialog([{ action: "confirm", values: { mpCost: "1e1" } }], null, () =>
    ScriptInteractionManager.handleInteractionQuery(buildPayload({ requestId: "pi-2" }), { user: remoteGM }));
  assert.equal(exponent.status, SCRIPT_INTERACTION_STATUS.ERROR);
  assert.equal(exponent.reason, "value-above-max");

  dialogConfigs = [];
  const padded = await withDialog([{ action: "confirm", values: { mpCost: " 2 " } }], null, () =>
    ScriptInteractionManager.handleInteractionQuery(buildPayload({ requestId: "pi-3" }), { user: remoteGM }));
  assert.equal(padded.status, SCRIPT_INTERACTION_STATUS.ANSWERED);
  assert.deepEqual(padded.values, { mpCost: 2 });
}
pass("完整数值转换：1.9 与 1e1 不再被 parseInt 截断成另一个合法答案");

{
  // 真实链：资源提交 → resourceChanged 问询 → 宿主删除中止。
  // 不手工构造中止错误：提交、脚本收集、执行、ask、中止与状态增强全部走真实实现，
  // 错误携带真实提交状态与实际变化，资源保持已提交。
  setClient(localPlayer, [localPlayer, otherGM], "gm-other");
  const actor = makeResourceActor();
  actor._resourceScriptCache = undefined; // 让真实提交路径收集 resourceChanged 脚本
  actor.ownership = { "p1": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
  registry.set(actor.uuid, actor);
  actor.collectScripts = trigger => trigger === "resourceChanged"
    ? [{ script: 'await ask({ title: "资源问询", buttons: [{ action: "confirm", label: "确认", default: true }], fields: [] });', label: "rc-ask", source: null }]
    : [];
  const pending = withDialog([], () => {}, () =>
    actor.changeResources({ "system.resources.mp.value": 4 }, { cause: "script" }));
  await new Promise(resolve => setImmediate(resolve));
  Hooks.callAll("deleteActor", actor);
  let err = null;
  try { await pending; } catch (e) { err = e; }
  assert.ok(err instanceof XJZLScriptAbortError, "changeResources 以中止错误拒绝");
  assert.equal(err.committed, true);
  assert.equal(err.phase, "resourceChangedDispatch");
  assert.deepEqual(err.resourceChanges, [
    { resource: "mp", path: "system.resources.mp.value", oldValue: 5, newValue: 4, delta: -1 }
  ]);
  assert.equal(actor.system.resources.mp.value, 4, "主资源更新已真实提交");
  registry.delete(actor.uuid);
}
pass("resourceChanged 真实链：提交→问询→宿主删除中止，错误携带真实提交状态且资源已提交");

{
  // 普通脚本错误仍隔离：只提示不抛出
  const isolated = makeResourceActor();
  isolated.runScripts = async () => { throw new Error("脚本错误"); };
  await isolated._dispatchResourceChanges(
    [{ resource: "mp", path: "system.resources.mp.value", oldValue: 5, newValue: 3, delta: -2 }], {});
  assert.ok(notices.some(message => message.includes("ResourceDispatchFailed")));
}
pass("resourceChanged：普通脚本错误保持隔离");

{
  // 伤害链 committed 按真实提交结果标记
  const committed = makeDamageActor();
  committed.runScripts = async trigger => {
    if (trigger === "damaged") throw new XJZLScriptAbortError("宿主删除");
  };
  await assert.rejects(
    committed.applyDamage({ amount: 10, type: "waigong", isHit: true }),
    err => err instanceof XJZLResourceCommitError
      && err.committed === true
      && err.phase === "scriptAbort:damaged"
  );
  assert.equal(committed.system.resources.hp.value, 40);

  // 主更新被取消（HP 仍为 50）：damaged 中止必须按未提交标记
  const cancelled = makeDamageActor();
  cancelled.runScripts = async trigger => {
    if (trigger === "damaged") throw new XJZLScriptAbortError("宿主删除");
  };
  cancelled._cancelNextUpdate = true;
  await assert.rejects(
    cancelled.applyDamage({ amount: 10, type: "waigong", isHit: true }),
    err => err instanceof XJZLResourceCommitError && err.committed === false
  );
  assert.equal(cancelled.system.resources.hp.value, 50);

  // 锁内采样：排队期间其他持锁操作改动的资源不记入本笔提交判定
  const raced = makeDamageActor();
  raced.runScripts = async trigger => {
    if (trigger === "damaged") throw new XJZLScriptAbortError("宿主删除");
  };
  raced._cancelNextUpdate = true;
  const queued = raced._withResourceCommitLock(async () => {
    raced.system.resources.mp.value = 6; // 更早排队的持锁操作：内力 10→6
    await new Promise(resolve => setImmediate(resolve));
  });
  await assert.rejects(
    raced.applyDamage({ amount: 10, type: "waigong", isHit: true }),
    err => err instanceof XJZLResourceCommitError && err.committed === false,
    "锁外余额差不能证明本笔提交"
  );
  await queued;
  assert.equal(raced.system.resources.mp.value, 6, "其他操作的改动保留");
  assert.equal(raced.system.resources.hp.value, 50);
}
pass("伤害链 committed 反映真实提交：更新被取消时不再硬编码为 true");

/* -------------------------------------------- */
/*  K. 中止穿透与 socket 边界回归                   */
/* -------------------------------------------- */

console.log("K. 中止穿透与 socket 边界回归");

{
  // 嵌套伤害的中止穿透（真实运行器链）：preTake 第一段发起嵌套伤害，
  // 内层 damaged 问询期间删除宿主，中止穿过内层包装与外层运行器，
  // 外层第二段脚本不得执行。只 stub collectScripts 提供脚本文本，其余全走真实实现。
  setClient(localPlayer, [localPlayer, otherGM], "gm-other");
  const actor = makeDamageActor();
  actor.ownership = { "p1": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
  registry.set(actor.uuid, actor);
  actor.collectScripts = function (trigger) {
    if (trigger === "preTake") {
      // 递归护栏：嵌套伤害期间不再收集外层 preTake 脚本（反伤类脚本的现实写法）
      return actor.nested ? [] : [
        { script: 'actor.nested = true; await actor.applyDamage({ amount: 3, type: "waigong", isHit: true, source: "extra" });', label: "外层-嵌套伤害", source: null },
        { script: 'actor.marker = "second-ran";', label: "外层-第二段", source: null }
      ];
    }
    if (trigger === "damaged") {
      return actor.nested
        ? [{ script: 'await ask({ title: "内层问询", buttons: [{ action: "confirm", label: "确认", default: true }], fields: [] });', label: "内层问询", source: null }]
        : [];
    }
    return [];
  };
  const pending = withDialog([], () => {}, () =>
    actor.applyDamage({ amount: 10, type: "waigong", isHit: true }));
  await new Promise(resolve => setImmediate(resolve));
  Hooks.callAll("deleteActor", actor);
  // 中止发生在外层 preTake（主伤害未提交）：applyDamage 以 committed:false 拒绝
  await assert.rejects(pending, err => err instanceof XJZLResourceCommitError
    && isScriptAbortError(err)
    && err.actorUuid === actor.uuid
    && err.committed === false);
  assert.equal(actor.marker, undefined, "外层第二段脚本不得执行");
  registry.delete(actor.uuid);
}
pass("嵌套伤害：同一宿主的中止穿过内层包装与外层运行器，停止余下脚本");

{
  // 其他宿主的中止不误停当前宿主：嵌套伤害目标 Y 删除时，X 的余下脚本继续
  setClient(localPlayer, [localPlayer, otherGM], "gm-other");
  const attacker = makeDamageActor();
  attacker.ownership = { "p1": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
  registry.set(attacker.uuid, attacker);
  const victim = makeDamageActor();
  victim.ownership = {};
  registry.set(victim.uuid, victim);
  game.testVictim = victim; // 沙盒可见的目标引用
  attacker.collectScripts = trigger => {
    if (trigger === "preTake") return [
      { script: 'await game.testVictim.applyDamage({ amount: 3, type: "waigong", isHit: true, source: "extra" });', label: "对 Y 嵌套伤害", source: null },
      { script: 'actor.marker = "second-ran";', label: "外层-第二段", source: null }
    ];
    return [];
  };
  victim.collectScripts = trigger => {
    if (trigger === "preTake") return [
      { script: 'await ask({ title: "Y 的问询", buttons: [{ action: "confirm", label: "确认", default: true }], fields: [] });', label: "Y 的问询", source: null }
    ];
    return [];
  };
  const pending = withDialog([], () => {}, () =>
    attacker.applyDamage({ amount: 10, type: "waigong", isHit: true }));
  await new Promise(resolve => setImmediate(resolve));
  Hooks.callAll("deleteActor", victim);
  await pending; // 不拒绝：Y 的中止按普通脚本错误隔离，X 的业务继续
  assert.equal(attacker.marker, "second-ran", "其他宿主的中止不误停当前宿主");
  delete game.testVictim;
  registry.delete(attacker.uuid);
  registry.delete(victim.uuid);
}
pass("嵌套伤害：其他宿主的中止按普通脚本错误隔离，不误停当前宿主");

{
  // 纯中止错误（携带提交事实）跨 socket：信封保留 abortError 与 committed
  const abort = new XJZLScriptAbortError("宿主删除", { requestId: "r1", actorUuid: "Actor.x", reason: "host-deleted" });
  abort.committed = true;
  abort.phase = "resourceChangedDispatch";
  abort.resourceChanges = [{ resource: "mp", path: "system.resources.mp.value", oldValue: 5, newValue: 4, delta: -1 }];
  const envelope = toResourceCommitErrorEnvelope(abort);
  assert.equal(envelope.committed, true);
  assert.equal(envelope.phase, "resourceChangedDispatch");
  assert.deepEqual(envelope.abortError, { requestId: "r1", abortReason: "host-deleted" });
  const wrapped = wrapResourceSocketError(abort); // 不再原样抛出走通用异常通道
  assert.equal(wrapped.ok, false);
  let rebuilt = null;
  try { unwrapResourceSocketResult(wrapped); } catch (err) { rebuilt = err; }
  assert.equal(rebuilt instanceof XJZLResourceCommitError, true);
  assert.equal(isScriptAbortError(rebuilt), true, "解包后仍可按中止识别");
  assert.equal(rebuilt.scriptAbort.name, "XJZLScriptAbortError");
  assert.equal(rebuilt.scriptAbort.requestId, "r1");
  assert.equal(rebuilt.committed, true);
  assert.equal(rebuilt.actorUuid, "Actor.x");
  assert.deepEqual(rebuilt.resourceChanges, abort.resourceChanges);
}
pass("socket 边界：纯中止错误的信封与解包保留中止身份和提交状态");

{
  // 伤害入口包装（XJZLResourceCommitError + scriptAbort）跨 socket 保留中止身份
  const inner = new XJZLScriptAbortError("宿主删除", { requestId: "r2", actorUuid: "Actor.y", reason: "host-deleted" });
  const wrapper = new XJZLResourceCommitError("伤害流程中止", {
    committed: true, phase: "scriptAbort:damaged", actorUuid: "Actor.y", resourceChanges: [], originalError: inner
  });
  wrapper.scriptAbort = inner;
  const envelope = toResourceCommitErrorEnvelope(wrapper);
  assert.deepEqual(envelope.abortError, { requestId: "r2", abortReason: "host-deleted" });
  let rebuilt = null;
  try { unwrapResourceSocketResult(wrapResourceSocketError(wrapper)); } catch (err) { rebuilt = err; }
  assert.equal(rebuilt instanceof XJZLResourceCommitError, true);
  assert.equal(isScriptAbortError(rebuilt), true);
  assert.equal(rebuilt.scriptAbort.actorUuid, "Actor.y");
  assert.equal(rebuilt.phase, "scriptAbort:damaged");
}
pass("socket 边界：伤害入口包装的中止跨客户端仍可识别");

{
  // 普通提交错误保持既有契约：无 abortError，解包不携带中止身份；无关错误原样抛出
  const plain = new XJZLResourceCommitError("数据库失败", { committed: true, phase: "database", actorUuid: "Actor.z" });
  const envelope = toResourceCommitErrorEnvelope(plain);
  assert.equal(envelope.abortError, null);
  let rebuilt = null;
  try { unwrapResourceSocketResult(wrapResourceSocketError(plain)); } catch (err) { rebuilt = err; }
  assert.equal(rebuilt instanceof XJZLResourceCommitError, true);
  assert.equal(isScriptAbortError(rebuilt), false);
  assert.equal(rebuilt.committed, true);
  assert.throws(() => wrapResourceSocketError(new Error("无关错误")), /无关错误/);
}
pass("socket 边界：普通提交错误与无关错误行为不变");

{
  // 终态缓存复合键：合法请求者的提前取消先到后，其他用户同 requestId 的关闭通知不能覆盖
  setClient(remotePlayer, [remoteGM, remotePlayer], "gm1");
  dialogConfigs = [];
  ScriptInteractionManager.handleCloseNotification.call(
    { socketdata: { userId: "gm1" } }, { requestId: "ov-1", requesterUserId: "gm1" });
  ScriptInteractionManager.handleCloseNotification.call(
    { socketdata: { userId: "mallory" } }, { requestId: "ov-1", requesterUserId: "gm1" });
  const result = await withDialog([], null, () =>
    ScriptInteractionManager.handleInteractionQuery(buildPayload({ requestId: "ov-1" }), { user: remoteGM }));
  assert.equal(result.reason, "already-settled", "其他用户的写入不能使合法查询重开窗口");
  assert.equal(dialogConfigs.length, 0);
}
pass("终态缓存以真实发送者＋requestId 为实际键：不同发送者不能互相覆盖");

/* -------------------------------------------- */
/*  L. 检定配置声明（attributeTestConfig）          */
/* -------------------------------------------- */

console.log("L. 检定配置声明（attributeTestConfig）");

const {
  validateTestConfigContext, buildTestConfigSpec, SCRIPT_INTERACTION_TEST_CONFIG_LIMITS
} = policy;

{
  const check = validateTestConfigContext({ label: "演奏", baseVal: 30, sysBonus: 2, sysLevel: -1 });
  assert.equal(check.ok, true);
  assert.deepEqual(check.normalized, { label: "演奏", baseVal: 30, sysBonus: 2, sysLevel: -1, defaultBonus: 0, defaultLevel: 0 });
  const withDefaults = validateTestConfigContext({ label: "书写", baseVal: 1, sysBonus: 0, sysLevel: 0, defaultBonus: 2, defaultLevel: 3 });
  assert.deepEqual(withDefaults.normalized, { label: "书写", baseVal: 1, sysBonus: 0, sysLevel: 0, defaultBonus: 2, defaultLevel: 3 });
}
pass("检定配置上下文规范化：缺失的默认 bonus/level 补 0");

for (const [label, check] of Object.entries({
  "缺少标签": { baseVal: 1, sysBonus: 0, sysLevel: 0 },
  "非数值面板": { label: "x", baseVal: "a", sysBonus: 0, sysLevel: 0 },
  "非数值默认加值": { label: "x", baseVal: 1, sysBonus: 0, sysLevel: 0, defaultBonus: "b" }
})) {
  assert.equal(validateTestConfigContext(check).ok, false, label);
}
pass("检定配置上下文拒绝缺失标签与非数值字段");

{
  const normalized = validateTestConfigContext({ label: "演奏", baseVal: 30, sysBonus: 0, sysLevel: 0, defaultBonus: 2, defaultLevel: 1 }).normalized;
  const spec = validateInteractionSpec(buildTestConfigSpec(normalized, { roll: "投掷", bonus: "加值", level: "层级" }));
  assert.equal(spec.ok, true);
  assert.equal(spec.normalized.title, "演奏 检定配置");
  assert.deepEqual(spec.normalized.buttons.map(button => button.action), ["roll"]);
  assert.deepEqual(spec.normalized.check, normalized);
  const bonusField = spec.normalized.fields.find(field => field.name === "bonus");
  const levelField = spec.normalized.fields.find(field => field.name === "level");
  assert.deepEqual(
    { bonus: [bonusField.min, bonusField.max], level: [levelField.min, levelField.max] },
    { bonus: [SCRIPT_INTERACTION_TEST_CONFIG_LIMITS.bonus.min, SCRIPT_INTERACTION_TEST_CONFIG_LIMITS.bonus.max], level: [SCRIPT_INTERACTION_TEST_CONFIG_LIMITS.level.min, SCRIPT_INTERACTION_TEST_CONFIG_LIMITS.level.max] }
  );
  const answered = validateInteractionAnswer(
    { status: "answered", action: "roll", values: { bonus: -2, level: 1 } }, spec.normalized);
  assert.equal(answered.ok, true);
  assert.deepEqual(answered.values, { bonus: -2, level: 1 });
  assert.equal(validateInteractionAnswer({ status: "answered", action: "roll", values: { bonus: 99999, level: 0 } }, spec.normalized).reason, "value-above-max");
  assert.equal(validateInteractionAnswer({ status: "answered", action: "roll", values: { bonus: 0 } }, spec.normalized).ok, false);
}
pass("检定配置声明组装 bonus/level 整数字段，答案按同一声明校验上下限");

/* -------------------------------------------- */
/*  M. 检定配置中继（manager + 接收端）              */
/* -------------------------------------------- */

console.log("M. 检定配置中继（manager + 接收端）");

{
  const ask = () => ScriptInteractionManager.promptControllerAttributeTestConfig({
    actor: { name: "甲" }, trigger: "passive", label: "被动检定", source: null,
    check: { label: "体魄", baseVal: 1, sysBonus: 0, sysLevel: 0 }
  });
  assert.throws(() => ask(), error => error instanceof XJZLScriptInteractionForbiddenError);
  let threw = false;
  try { ask(); } catch { threw = true; }
  assert.equal(threw, true, "必须同步抛错而非 rejected Promise");
  assert.throws(
    () => ScriptInteractionManager.promptControllerAttributeTestConfig({
      actor: { name: "甲" }, trigger: "not_a_trigger", label: "坏", source: null,
      check: { label: "体魄", baseVal: 1, sysBonus: 0, sysLevel: 0 }
    }),
    /未知触发器/
  );
}
pass("passive/calc 的检定配置中继同步抛错；未知触发器在入口报错");

{
  const result = await ScriptInteractionManager.promptControllerAttributeTestConfig({
    actor: hostActor, trigger: "preTake", label: "检定", source: null,
    check: { baseVal: 1, sysBonus: 0, sysLevel: 0 }
  });
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ERROR);
  assert.equal(result.reason, "check-label-required");
}
pass("检定配置数据无效时返回 error，不发起问询");

{
  setClient(localPlayer, [localPlayer, otherGM], "gm-other");
  dialogConfigs = [];
  closeCommands.length = 0;
  renderTemplateCalls.length = 0;
  const result = await withDialog([{ action: "roll", values: { bonus: 2, level: -1 } }], null, () =>
    ScriptInteractionManager.promptControllerAttributeTestConfig({
      actor: hostActor, trigger: "preTake", label: "护体检定", source: null,
      check: { label: "体魄", baseVal: 16, sysBonus: 1, sysLevel: 0, defaultBonus: 0, defaultLevel: 0 }
    }));
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ANSWERED);
  assert.equal(result.action, "roll");
  assert.deepEqual(result.values, { bonus: 2, level: -1 });
  assert.equal(dialogConfigs.length, 1);
  assert.equal(renderTemplateCalls.length, 1, "检定配置窗口复用系统模板");
  assert.equal(renderTemplateCalls[0].path, "systems/xjzl-system/templates/apps/attribute-test-config.hbs");
  assert.equal(renderTemplateCalls[0].data.label, "体魄");
  assert.equal(renderTemplateCalls[0].data.baseVal, 16);
  assert.equal(typeof renderTemplateCalls[0].data.formId, "string");
  assert.equal(closeCommands.length, 0);
}
pass("本机检定配置中继：模板窗口收 bonus/level，零 RPC");

{
  setClient(remoteGM, [remoteGM, remotePlayer], "gm1");
  dialogConfigs = [];
  remotePlayer.nextQueryResult = data => ({
    requestId: data.requestId, status: "answered", action: "roll", values: { bonus: 1, level: 2 }
  });
  const result = await withDialog([], null, () =>
    ScriptInteractionManager.promptControllerAttributeTestConfig({
      actor: remoteHost, trigger: "damaged", label: "反击检定", source: null,
      check: { label: "棋术", baseVal: 8, sysBonus: 0, sysLevel: 0 }
    }));
  const call = remotePlayer.queryCalls.at(-1);
  assert.equal(call.name, "xjzl.scriptInteraction");
  const payload = JSON.parse(JSON.stringify(call.data));
  assert.equal(payload.formType, "attributeTestConfig");
  assert.deepEqual(payload.spec.check, { label: "棋术", baseVal: 8, sysBonus: 0, sysLevel: 0, defaultBonus: 0, defaultLevel: 0 });
  assert.deepEqual(payload.spec.fields.map(field => field.name), ["bonus", "level"]);
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ANSWERED);
  assert.deepEqual(result.values, { bonus: 1, level: 2 });
}
pass("远端检定配置中继：载荷只携带面板数据与 bonus/level 声明");

{
  // 接收端处理 attributeTestConfig 载荷：开窗 → 回答 → 原端收到经同一声明校验的答案
  setClient(remotePlayer, [remoteGM, remotePlayer], "gm1");
  dialogConfigs = [];
  const configSpec = validateInteractionSpec(buildTestConfigSpec(
    validateTestConfigContext({ label: "演奏", baseVal: 8, sysBonus: 0, sysLevel: 0 }).normalized,
    { roll: "投掷", bonus: "加值", level: "层级" }
  )).normalized;
  const result = await withDialog([{ action: "roll", values: { bonus: 3, level: 0 } }], null, () =>
    ScriptInteractionManager.handleInteractionQuery(
      buildPayload({ requestId: "cfg-1", formType: "attributeTestConfig", spec: configSpec }),
      { user: remoteGM }));
  assert.equal(result.status, SCRIPT_INTERACTION_STATUS.ANSWERED);
  assert.equal(result.action, "roll");
  assert.deepEqual(result.values, { bonus: 3, level: 0 });
  assert.equal(dialogConfigs.length, 1);
}
pass("接收端按同一声明处理检定配置载荷并回传 bonus/level");

/* -------------------------------------------- */
/*  N. rollAttributeTest 的 promptTarget（真实 actor.mjs） */
/* -------------------------------------------- */

console.log("N. rollAttributeTest 的 promptTarget（真实 actor.mjs）");

const skillHost = Object.assign(Object.create(XJZLActor.prototype), {
  uuid: "Actor.skill-host", name: "技能宿主", type: "character", isOwner: true,
  ownership: { "p2": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
  system: {
    resources: { hp: { value: 20, max: 100 }, mp: { value: 9, max: 10 }, rage: { value: 0, max: 10 } },
    skills: { yanzou: { total: 30, checkMod: 0 }, shuxie: { total: 25, checkMod: 0 } }
  },
  _source: { system: { resources: { hp: { value: 20, max: 100 }, mp: { value: 9, max: 10 }, rage: { value: 0, max: 10 } } } },
  xjzlStatuses: {},
  effects: [],
  _resourceScriptCache: false,
  collectScripts: () => []
});
registry.set(skillHost.uuid, skillHost);
// 来源必须以 Item 实例进入显式绑定选项，才能随问询做存在性复核。
const scriptSourceItem = Object.assign(new Item(), { uuid: "Item.gujin", name: "古今秘谱" });
registry.set("Item.gujin", scriptSourceItem);

{
  // caller 默认：无 promptTarget 时保持本机弹窗（DialogV2.wait），不发起任何问询 RPC
  setClient(localPlayer, [localPlayer, otherGM], "gm-other");
  remotePlayer.queryCalls.length = 0;
  dialogWaitResult = { bonus: 3, level: -1 };
  const roll = await skillHost.rollAttributeTest("yanzou", { bonus: 1 });
  assert.equal(roll.total, 10 + 30 + 3, "本地弹窗返回值覆盖传入的默认加值后照常掷骰");
  assert.equal(roll.formula, "2d20kl + @val + @bonus", "层级 -1 表达为劣势骰");
  assert.equal(remotePlayer.queryCalls.length, 0);
}
pass("普通 caller 检定保持本机弹窗体验，零 RPC");

{
  // controller：本机 OWNER 决策 → 本地配置窗口 → 回答只取 bonus/level，Roll 留在本端
  setClient(remotePlayer, [remoteGM, remotePlayer], "gm1");
  dialogConfigs = [];
  remotePlayer.queryCalls.length = 0;
  renderTemplateCalls.length = 0;
  const roll = await withDialog([{ action: "roll", values: { bonus: 2, level: 0 } }], null, () =>
    skillHost.rollAttributeTest("yanzou", {
      promptTarget: "controller",
      interactionTrigger: "preTake",
      interactionSource: scriptSourceItem,
      interactionLabel: "古谱检定"
    }));
  assert.equal(roll.total, 10 + 30 + 2);
  assert.equal(roll.formula, "1d20 + @val + @bonus");
  assert.equal(dialogConfigs.length, 1, "本机决策开本地窗口");
  assert.equal(renderTemplateCalls.length, 1);
  assert.equal(remotePlayer.queryCalls.length, 0);
}
pass("controller 检定在本机 OWNER 客户端开配置窗口，掷骰与卡片仍在本端");

{
  // controller：宿主 OWNER 在远端 → 配置中继经 User.query，答案只回 bonus/level
  setClient(remoteGM, [remoteGM, remotePlayer], "gm1");
  remotePlayer.queryCalls.length = 0;
  rollCalls.length = 0;
  remotePlayer.nextQueryResult = data => ({
    requestId: data.requestId, status: "answered", action: "roll", values: { bonus: 2, level: 1 }
  });
  const roll = await withDialog([], null, () =>
    skillHost.rollAttributeTest("yanzou", {
      promptTarget: "controller",
      interactionTrigger: "damaged",
      interactionSource: scriptSourceItem,
      interactionLabel: "格挡反击",
      flavor: "反击检定"
    }));
  const payload = JSON.parse(JSON.stringify(remotePlayer.queryCalls.at(-1).data));
  assert.equal(payload.formType, "attributeTestConfig");
  assert.equal(payload.trigger, "damaged", "触发器来自脚本显式绑定");
  assert.equal(payload.spec.check.baseVal, 30);
  assert.equal(payload.source.uuid, scriptSourceItem.uuid, "来源随显式绑定传输");
  assert.deepEqual(payload.spec.fields.map(field => field.name), ["bonus", "level"]);
  assert.equal(roll.total, 10 + 30 + 2, "远端答案回本端后才掷骰");
  assert.equal(roll.formula, "2d20kh + @val + @bonus", "层级 +1 表达为优势骰");
}
pass("controller 检定经远端中继收集配置，Roll/发卡留在规则执行端");

{
  // controller：取消配置 → rollAttributeTest 返回 null（与本地取消契约一致）
  setClient(remoteGM, [remoteGM, remotePlayer], "gm1");
  rollCalls.length = 0;
  remotePlayer.nextQueryResult = data => ({ requestId: data.requestId, status: "cancelled" });
  const roll = await withDialog([], null, () =>
    skillHost.rollAttributeTest("yanzou", { promptTarget: "controller", interactionTrigger: "damaged" }));
  assert.equal(roll, null);
  assert.equal(rollCalls.length, 0, "取消后不产生掷骰");
}
pass("controller 检定取消时返回 null，不掷骰");

{
  // controller：passive 触发器必须在调用语句本身同步抛错（同步脚本不能 await，
  // rejected Promise 只会变成未处理拒绝），后续语句不得执行。
  let reached = false;
  const throwsSync = () => {
    skillHost.rollAttributeTest("yanzou", { promptTarget: "controller", interactionTrigger: "passive" });
    reached = true;
  };
  assert.throws(throwsSync, error => error instanceof XJZLScriptInteractionForbiddenError);
  assert.equal(reached, false, "同步抛错发生在调用语句，未继续执行后续语句");

  // 真实同步运行器验证：同步脚本（Function 编译，无 await）调用后语句不执行。
  const syncScript = "actor.rollAttributeTest('yanzou', { promptTarget: 'controller', interactionTrigger: trigger });\nactor.marker = 'after-throw';";
  const syncRunner = new Function("actor", "trigger", syncScript);
  assert.throws(() => syncRunner(skillHost, "calc"), error => error instanceof XJZLScriptInteractionForbiddenError);
  assert.equal(skillHost.marker, undefined, "同步运行器内调用即抛出，错误之后的语句未执行");

  // 未知触发器与缺失绑定同样同步抛错：绑定上下文是 controller 中继的必要条件，
  // 静默回退本机弹窗会把问询留在执行端，重新引入迁移要解决的问题。
  assert.throws(
    () => skillHost.rollAttributeTest("yanzou", { promptTarget: "controller", interactionTrigger: "not_a_trigger" }),
    /未知触发器/
  );
  assert.throws(
    () => skillHost.rollAttributeTest("yanzou", { promptTarget: "controller" }),
    /未知触发器/
  );
}
pass("controller 检定在同步入口立即抛错（passive/未知/未绑定）；真实同步运行器中错误后语句不执行");

{
  // skipDialog 保持零交互契约：不受 promptTarget 影响，无需交互参数即照常投骰
  setClient(localPlayer, [localPlayer, otherGM], "gm-other");
  remotePlayer.queryCalls.length = 0;
  dialogConfigs = [];
  rollCalls.length = 0;
  const roll = await skillHost.rollAttributeTest("yanzou", { promptTarget: "controller", skipDialog: true });
  assert.equal(roll.total, 10 + 30, "无手动修正时按面板等级投骰");
  assert.equal(roll.formula, "1d20 + @val");
  assert.equal(rollCalls.length, 1);
  assert.equal(remotePlayer.queryCalls.length, 0);
  assert.equal(dialogConfigs.length, 0);
}
pass("skipDialog 不受 promptTarget 影响：无需交互参数即可零交互投骰");

/* -------------------------------------------- */
/*  O. 真实迁移脚本：官方交互全链                     */
/* -------------------------------------------- */

console.log("O. 真实迁移脚本：官方交互全链");

const loadEntry = (file, index, path) =>
  path.split(".").reduce((value, key) => value?.[key], JSON.parse(readFileSync(resolve(root, file), "utf8"))[index]);

/**
 * 构造可跑真实 changeResources 的脚本宿主：isOwner、_source 资源齐备，
 * effects 数组带 get(id)，资源脚本收集置空（resourceChanged 派发为空操作）。
 */
function makeScriptActor(name, { mp = 10, morale = null, rage = 0, flags = {}, effects = [] } = {}) {
  const resources = {
    hp: { value: 50, max: 100 },
    mp: { value: mp, max: 200 },
    rage: { value: rage, max: 10 }
  };
  const sourceResources = {
    hp: { value: 50, max: 100 },
    mp: { value: mp, max: 200 },
    rage: { value: rage, max: 10 }
  };
  if (morale !== null) {
    resources.morale = { value: morale, max: 10 };
    sourceResources.morale = { value: morale, max: 10 };
  }
  const actor = Object.assign(Object.create(XJZLActor.prototype), {
    uuid: `Actor.script-${++sequence}`, name, type: "character", isOwner: true,
    ownership: {},
    system: { resources, martial: { stance: "yinshen", stanceActive: true }, skills: {} },
    _source: { system: { resources: sourceResources } },
    xjzlStatuses: {},
    _resourceScriptCache: false,
    collectScripts: () => [],
    effects,
    _flags: flags,
    getFlag(scope, key) { return this._flags[key]; },
    showFloatyText(content) { this.floatyTexts = this.floatyTexts ?? []; this.floatyTexts.push(content); },
    async applyHealing(data) {
      this.healCalls = this.healCalls ?? [];
      this.healCalls.push(data);
      const resource = data.type === "mp" ? this.system.resources.mp : this.system.resources.hp;
      const before = resource.value;
      resource.value = Math.max(0, Math.min(resource.max, before + data.amount));
      return { actualHeal: resource.value - before, type: data.type };
    },
    async stopStance() {
      this.system.martial.stanceActive = false;
      this.stanceStopped = true;
    }
  });
  actor.effects.get = id => actor.effects.find(effect => effect.id === id) ?? null;
  return actor;
}

function makeEffect(id, slug, stacks = null) {
  return {
    id,
    name: slug,
    _stacks: stacks,
    // 真实 XJZLActiveEffect 暴露 stacks getter，官方脚本会直接读该属性
    get stacks() { return this._stacks; },
    getFlag(scope, key) {
      if (key === "slug") return slug;
      if (key === "stacks") return this._stacks;
      // stacks 为 null 表示不可叠层的单条效果
      if (key === "stackable") return this._stacks !== null;
      return undefined;
    }
  };
}

/** 以 mock ask 执行迁移后脚本；askImpl(spec) 返回结构化答案。 */
async function runScript(entry, actor, { askImpl, thisItem = null, args = null, trigger = "preTake" } = {}) {
  const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
  const fn = new AsyncFunction("ask", "actor", "S", "args", "thisItem", "move", "item", "trigger", "Macros", "game", "ui", "ChatMessage", "canvas", "foundry", "combat", entry.script);
  const sandboxArgs = args ?? {};
  await fn(
    askImpl, actor, actor.system, sandboxArgs,
    thisItem ?? { id: "item-src", name: "来源", system: { moves: [] }, effects: { getName: () => ({ toObject: () => ({ name: "模板", flags: { "xjzl-system": {} } }) }) } },
    undefined, null, trigger, MacrosMock, game, ui, ChatMessage, undefined, foundry,
    mockCombat // 第三步：进战/回合脚本显式引用事件 combat（与 combats mock 同一实例）
  );
  return sandboxArgs;
}

/**
 * 绑定运功来源与阶段：模拟 DataModel 派生的 item.system.stage / current.scripts，
 * 供金刚、紫眸等脚本在等待后复核运功资格。thisItem 的 id 需与 itemId 一致。
 */
function bindNeigong(actor, itemId, stage, scriptLabel) {
  actor.system.martial.active_neigong = itemId;
  actor.items = {
    get: id => id === itemId
      ? { id: itemId, system: { stage, current: { scripts: [{ label: scriptLabel, trigger: "preTake", active: true }] } } }
      : null
  };
}

const jinGangEntry = loadEntry("data/neigong/wanfosi.json", 5, "system.config.stage2.scripts.0");

{
  // 金刚护体(1:2)：足额消耗按真实扣减兑现抵伤（运功来源与阶段资格复核通过）
  const actor = makeScriptActor("金刚侠", { mp: 105 });
  bindNeigong(actor, "item-src", 2, "金刚护体(1:2)");
  const args = await runScript(jinGangEntry, actor, {
    args: { type: "waigong", output: { damage: 10 } },
    askImpl: async () => ({ status: "answered", action: "confirm", values: { spendCount: 3 } })
  });
  assert.equal(actor.system.resources.mp.value, 102);
  assert.equal(args.output.damage, 4, "3 内力 × 2 比率 = 抵 6 点");
}
pass("金刚护体：足额消耗按真实扣减 1:2 抵伤");

{
  // 金刚护体：等待后内力跌破规则门槛（>100）时复核不通过，不扣费也不减伤
  const actor = makeScriptActor("金刚侠", { mp: 105 });
  bindNeigong(actor, "item-src", 2, "金刚护体(1:2)");
  const args = await runScript(jinGangEntry, actor, {
    args: { type: "waigong", output: { damage: 10 } },
    askImpl: async () => {
      actor.system.resources.mp.value = 2;
      actor._source.system.resources.mp.value = 2;
      return { status: "answered", action: "confirm", values: { spendCount: 3 } };
    }
  });
  assert.equal(actor.system.resources.mp.value, 2, "门槛复核失败不扣费");
  assert.equal(args.output.damage, 10, "门槛复核失败无免费减伤");
}
pass("金刚护体：等待后内力不满足门槛时放弃消耗与抵伤");

{
  // 金刚护体：等待期间切换运功（来源/阶段资格失效）时放弃消耗与抵伤
  const actor = makeScriptActor("金刚侠", { mp: 105 });
  bindNeigong(actor, "item-src", 2, "金刚护体(1:2)");
  const args = await runScript(jinGangEntry, actor, {
    args: { type: "waigong", output: { damage: 10 } },
    askImpl: async () => {
      actor.system.martial.active_neigong = "item-other";
      return { status: "answered", action: "confirm", values: { spendCount: 3 } };
    }
  });
  assert.equal(actor.system.resources.mp.value, 105, "运功来源已切换：不扣费");
  assert.equal(args.output.damage, 10, "运功来源已切换：无免费减伤");
}
pass("金刚护体：等待后运功资格复核失败时放弃消耗与抵伤");

{
  // 金刚护体：取消与零值答案均不消耗、不减伤
  for (const answer of [
    { status: "cancelled" },
    { status: "answered", action: "confirm", values: { spendCount: 0 } },
    { status: "timedOut" }
  ]) {
    const actor = makeScriptActor("金刚侠", { mp: 105 });
    bindNeigong(actor, "item-src", 2, "金刚护体(1:2)");
    const args = await runScript(jinGangEntry, actor, {
      args: { type: "waigong", output: { damage: 10 } },
      askImpl: async () => answer
    });
    assert.equal(actor.system.resources.mp.value, 105, `${answer.status} 不扣内力`);
    assert.equal(args.output.damage, 10, `${answer.status} 不减伤`);
  }
}
pass("金刚护体：取消/超时/零值走默认分支，保留全额伤害");

{
  // 金刚护体：全链（真实 manager 与声明校验）下越界答案按 error 拒绝，不消耗不抵伤
  setClient(localPlayer, [localPlayer, otherGM], "gm-other");
  const actor = makeScriptActor("金刚侠", { mp: 105 });
  actor.ownership["p1"] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  registry.set(actor.uuid, actor);
  const args = { type: "waigong", output: { damage: 10 } };
  const ask = createScriptAsk({ actor, trigger: "preTake", label: "金刚护体(1:2)", source: null });
  await withDialog([{ action: "confirm", values: { spendCount: 6 } }], null, () =>
    runScript(jinGangEntry, actor, { args, askImpl: ask }));
  assert.equal(actor.system.resources.mp.value, 105, "越界答案不扣内力");
  assert.equal(args.output.damage, 10, "越界答案不抵伤");
  registry.delete(actor.uuid);
}
pass("金刚护体：越界答案经真实声明校验拒绝，无免费收益");

const ziMouEntry = loadEntry("data/neigong/jianghushili1.json", 69, "system.config.stage2.scripts.0");

{
  // 紫眸·护体：足额扣 10 内力才减 30；取消、扣费失败、内力不足、运功失效均无减伤
  const paid = makeScriptActor("紫眸侠", { mp: 50 });
  bindNeigong(paid, "item-src", 2, "紫眸·护体");
  const paidArgs = await runScript(ziMouEntry, paid, {
    args: { isCrit: true, type: "waigong", output: { damage: 45 } },
    askImpl: async () => ({ status: "answered", action: "confirm" })
  });
  assert.equal(paid.system.resources.mp.value, 40);
  assert.equal(paidArgs.output.damage, 15);

  const cancelled = makeScriptActor("紫眸侠", { mp: 50 });
  bindNeigong(cancelled, "item-src", 2, "紫眸·护体");
  const cancelledArgs = await runScript(ziMouEntry, cancelled, {
    args: { isCrit: true, output: { damage: 45 } },
    askImpl: async () => ({ status: "cancelled" })
  });
  assert.equal(cancelled.system.resources.mp.value, 50);
  assert.equal(cancelledArgs.output.damage, 45);

  const failedPay = makeScriptActor("紫眸侠", { mp: 50 });
  bindNeigong(failedPay, "item-src", 2, "紫眸·护体");
  failedPay._cancelNextUpdate = true; // 提交被取消：凭证为空
  const failedArgs = await runScript(ziMouEntry, failedPay, {
    args: { isCrit: true, output: { damage: 45 } },
    askImpl: async () => ({ status: "answered", action: "confirm" })
  });
  assert.equal(failedPay.system.resources.mp.value, 50);
  assert.equal(failedArgs.output.damage, 45, "扣费未提交时不得免费减伤");

  const emptyAfterWait = makeScriptActor("紫眸侠", { mp: 50 });
  bindNeigong(emptyAfterWait, "item-src", 2, "紫眸·护体");
  const emptyArgs = await runScript(ziMouEntry, emptyAfterWait, {
    args: { isCrit: true, output: { damage: 45 } },
    askImpl: async () => {
      emptyAfterWait.system.resources.mp.value = 5;
      emptyAfterWait._source.system.resources.mp.value = 5;
      return { status: "answered", action: "confirm" };
    }
  });
  assert.equal(emptyArgs.output.damage, 45, "等待后内力不足：不扣费也不减伤");

  const switched = makeScriptActor("紫眸侠", { mp: 50 });
  bindNeigong(switched, "item-src", 2, "紫眸·护体");
  const switchedArgs = await runScript(ziMouEntry, switched, {
    args: { isCrit: true, output: { damage: 45 } },
    askImpl: async () => {
      switched.system.martial.active_neigong = "item-other";
      return { status: "answered", action: "confirm" };
    }
  });
  assert.equal(switched.system.resources.mp.value, 50, "运功来源已切换：不扣费");
  assert.equal(switchedArgs.output.damage, 45, "运功来源已切换：无免费减伤");
}
pass("紫眸·护体：先核实运功资格与扣费再减伤；取消/失败/不足/失效无免费收益");

const yingYueEntry = loadEntry("data/wuxue/yuepu.json", 23, "effects.0.flags.xjzl-system.scripts.0");

{
  // 映月：实际移除 [映月] 才减免 40；来源缺失或移除失败不减免。
  // yingyueRageBonus 由 AE 的 changes 派生：移除效果时随 Actor 重置消失。
  const withDerivedRage = actor => {
    const originalRemove = game.xjzl.api.effects.removeEffect;
    game.xjzl.api.effects.removeEffect = async (target, slug, amount) => {
      const result = await originalRemove(target, slug, amount);
      if (target === actor && slug === "yingyue" && result) delete actor._flags.yingyueRageBonus;
      return result;
    };
    return originalRemove;
  };

  const actor = makeScriptActor("映月侠", { rage: 3, flags: { yingyueRageBonus: 2 } });
  actor.effects.push(makeEffect("yy1", "yingyue"));
  const restoreRemove = withDerivedRage(actor);
  let args;
  try {
    args = await runScript(yingYueEntry, actor, {
      args: { type: "waigong", isCrit: true, output: { damage: 60 } },
      askImpl: async () => ({ status: "answered", action: "confirm" })
    });
  } finally {
    game.xjzl.api.effects.removeEffect = restoreRemove;
  }
  assert.equal(args.output.damage, 20);
  assert.equal(actor.effects.length, 0, "[映月] 已实际移除");
  assert.equal(actor._flags.yingyueRageBonus, undefined, "移除后派生加成已消失");
  assert.equal(actor.system.resources.rage.value, 5, "天籁怒气按移除前读取的加成发放");

  const missing = makeScriptActor("映月侠", { flags: {} });
  const missingArgs = await runScript(yingYueEntry, missing, {
    args: { type: "waigong", isCrit: true, output: { damage: 60 } },
    askImpl: async () => ({ status: "answered", action: "confirm" })
  });
  assert.equal(missingArgs.output.damage, 60, "来源缺失时不减免");

  const failed = makeScriptActor("映月侠", { flags: {} });
  failed.effects.push(makeEffect("yy2", "yingyue"));
  const originalRemove = game.xjzl.api.effects.removeEffect;
  game.xjzl.api.effects.removeEffect = async (target, slug, amount) => {
    if (target === failed && slug === "yingyue") return undefined;
    return originalRemove(target, slug, amount);
  };
  try {
    const failedArgs = await runScript(yingYueEntry, failed, {
      args: { type: "waigong", isCrit: true, output: { damage: 60 } },
      askImpl: async () => ({ status: "answered", action: "confirm" })
    });
    assert.equal(failedArgs.output.damage, 60, "移除失败不产生免费减伤");
    assert.equal(failed.effects.length, 1);
  } finally {
    game.xjzl.api.effects.removeEffect = originalRemove;
  }

  const declined = makeScriptActor("映月侠", { flags: {} });
  declined.effects.push(makeEffect("yy3", "yingyue"));
  const declinedArgs = await runScript(yingYueEntry, declined, {
    args: { type: "waigong", isCrit: true, output: { damage: 60 } },
    askImpl: async () => ({ status: "cancelled" })
  });
  assert.equal(declinedArgs.output.damage, 60);
  assert.equal(declined.effects.length, 1, "保留 [映月]");
}
pass("映月：怒气按移除前读取的派生加成兑现；来源缺失/移除失败/取消无免费收益");

const xiaoAoEntry = loadEntry("data/wuxue/yuepu.json", 31, "effects.0.flags.xjzl-system.scripts.0");

{
  // 笑傲：实际移除 [笑傲] 才抵挡 30；非内外功类型不问询
  const actor = makeScriptActor("笑傲侠");
  actor.effects.push(makeEffect("xa1", "xiaoao"));
  const args = await runScript(xiaoAoEntry, actor, {
    args: { type: "waigong", output: { damage: 50 } },
    askImpl: async () => ({ status: "answered", action: "confirm" })
  });
  assert.equal(args.output.damage, 20);
  assert.equal(actor.effects.length, 0);

  const mental = makeScriptActor("笑傲侠");
  mental.effects.push(makeEffect("xa2", "xiaoao"));
  let asked = 0;
  const mentalArgs = await runScript(xiaoAoEntry, mental, {
    args: { type: "mental", output: { damage: 50 } },
    askImpl: async () => { asked += 1; return { status: "answered", action: "confirm" }; }
  });
  assert.equal(asked, 0, "精神伤害不触发问询");
  assert.equal(mentalArgs.output.damage, 50);
}
pass("笑傲：实际移除 [笑傲] 才抵挡；类型门槛保持不变");

const fanKeEntry = loadEntry("data/wuxue/fenghuayuan.json", 1, "system.moves.1.scripts.0");

{
  // 反客为主：默认一层失准不可跳过；气刃核实消耗后才加到两层
  const noQiren = makeScriptActor("花雨侠");
  await runScript(fanKeEntry, noQiren, {
    args: { attacker: { name: "敌" } },
    askImpl: async () => { throw new Error("无气刃不应问询"); }
  });
  assert.equal(addedEffects.at(-1).count, 1, "无气刃仍施加默认一层失准");

  const cancelled = makeScriptActor("花雨侠");
  cancelled.effects.push(makeEffect("qr1", "qiren", 2));
  await runScript(fanKeEntry, cancelled, {
    args: { attacker: { name: "敌" } },
    askImpl: async () => ({ status: "cancelled" })
  });
  assert.equal(addedEffects.at(-1).count, 1, "取消时保留默认一层");
  assert.equal(cancelled.effects.length, 1, "气刃保留");

  const consumed = makeScriptActor("花雨侠");
  consumed.effects.push(makeEffect("qr2", "qiren", 2));
  await runScript(fanKeEntry, consumed, {
    args: { attacker: { name: "敌" } },
    askImpl: async () => ({ status: "answered", action: "confirm" })
  });
  assert.equal(addedEffects.at(-1).count, 2, "核实层数减少后施加两层");
  assert.equal(consumed.effects.length, 1, "气刃 2→1 层");

  const vanished = makeScriptActor("花雨侠");
  vanished.effects.push(makeEffect("qr3", "qiren", 2));
  await runScript(fanKeEntry, vanished, {
    args: { attacker: { name: "敌" } },
    askImpl: async () => {
      vanished.effects.splice(0); // 等待期间气刃消失
      return { status: "answered", action: "confirm" };
    }
  });
  assert.equal(addedEffects.at(-1).count, 1, "来源已消失时回落到默认一层");

  // 消耗抛出普通异常：不得吞掉默认一层失准
  const throwing = makeScriptActor("花雨侠");
  throwing.effects.push(makeEffect("qr4", "qiren", 2));
  const originalRemove = game.xjzl.api.effects.removeEffect;
  game.xjzl.api.effects.removeEffect = async (target, slug, amount) => {
    if (target === throwing && slug === "qiren") throw new Error("数据库失败");
    return originalRemove(target, slug, amount);
  };
  try {
    await runScript(fanKeEntry, throwing, {
      args: { attacker: { name: "敌" } },
      askImpl: async () => ({ status: "answered", action: "confirm" })
    });
    assert.equal(addedEffects.at(-1).count, 1, "普通消耗异常后仍施加默认一层失准");
  } finally {
    game.xjzl.api.effects.removeEffect = originalRemove;
  }

  // 宿主删除等中止错误（含资源提交包装）必须向上透传，不能被默认分支吞掉
  const aborting = makeScriptActor("花雨侠");
  aborting.effects.push(makeEffect("qr5", "qiren", 2));
  const abortError = new Error("宿主已删除");
  abortError.name = "XJZLScriptAbortError";
  game.xjzl.api.effects.removeEffect = async () => { throw abortError; };
  try {
    await assert.rejects(
      () => runScript(fanKeEntry, aborting, {
        args: { attacker: { name: "敌" } },
        askImpl: async () => ({ status: "answered", action: "confirm" })
      }),
      error => error === abortError, "中止错误原样透传"
    );
  } finally {
    game.xjzl.api.effects.removeEffect = originalRemove;
  }
}
pass("反客为主：默认一层失准不可跳过；消耗异常保留默认后果且中止错误透传");

const juXianEntry = loadEntry("data/wuxue/gunfa.json", 19, "system.moves.2.scripts.0");

{
  // 据险坚守：解除架招与延迟 AE 都成功才免除本次伤害
  const actor = makeScriptActor("棍法侠");
  const args = await runScript(juXianEntry, actor, {
    args: { output: { damage: 40 } },
    askImpl: async () => ({ status: "answered", action: "confirm" })
  });
  assert.equal(actor.stanceStopped, true);
  assert.equal(args.output.damage, 0);
  assert.equal(addedEffects.at(-1).slug.startsWith("delayed_pain_"), true, "延迟 AE 独立成条");

  // 等待期间架招已被解除：复核不通过，正常承受
  const droppedStance = makeScriptActor("棍法侠");
  const droppedArgs = await runScript(juXianEntry, droppedStance, {
    args: { output: { damage: 40 } },
    askImpl: async () => {
      MacrosMock.stanceActive = false;
      return { status: "answered", action: "confirm" };
    }
  });
  assert.equal(droppedArgs.output.damage, 40, "原架招已不在：不免除本次伤害");
  assert.equal(droppedStance.stanceStopped, undefined);
  MacrosMock.stanceActive = true;

  // 解除架招被取消（stance 仍激活）：不得创建延期 AE，否则本次照常承受、
  // 下一回合又结算一次延期伤害，造成重复承伤。
  const failedStop = makeScriptActor("棍法侠");
  failedStop.stopStance = async () => { /* 更新被取消：架招保持激活 */ };
  const beforeDelayed = addedEffects.filter(e => String(e.slug).startsWith("delayed_pain_")).length;
  const failedStopArgs = await runScript(juXianEntry, failedStop, {
    args: { output: { damage: 40 } },
    askImpl: async () => ({ status: "answered", action: "confirm" })
  });
  const afterDelayed = addedEffects.filter(e => String(e.slug).startsWith("delayed_pain_")).length;
  assert.equal(failedStopArgs.output.damage, 40, "解除未完成：本次伤害照常结算");
  assert.equal(afterDelayed, beforeDelayed, "解除未完成：不得创建延期伤害 AE");

  // 延迟 AE 创建失败：不免除本次伤害，如实报告
  const failedCreate = makeScriptActor("棍法侠");
  const originalAdd = game.xjzl.api.effects.addEffect;
  game.xjzl.api.effects.addEffect = async (target, data) => {
    if (target === failedCreate && data?.flags?.["xjzl-system"]?.slug?.startsWith("delayed_pain_")) return null;
    return originalAdd(target, data);
  };
  try {
    const failedArgs = await runScript(juXianEntry, failedCreate, {
      args: { output: { damage: 40 } },
      askImpl: async () => ({ status: "answered", action: "confirm" })
    });
    assert.equal(failedArgs.output.damage, 40, "延期 AE 失败不能留下已免除的伤害");
  } finally {
    game.xjzl.api.effects.addEffect = originalAdd;
  }

  // 取消：正常承受
  const declined = makeScriptActor("棍法侠");
  const declinedArgs = await runScript(juXianEntry, declined, {
    args: { output: { damage: 40 } },
    askImpl: async () => ({ status: "declined" })
  });
  assert.equal(declinedArgs.output.damage, 40);
}
pass("据险坚守：确认后复核原架招，解除与延期都成功才免除伤害；部分失败如实报告");

const chongFengEntry = loadEntry("data/wuxue/jiangjunying.json", 17, "effects.1.flags.xjzl-system.scripts.0");
const juZhongEntry = loadEntry("data/wuxue/jiangjunying.json", 17, "effects.6.flags.xjzl-system.scripts.0");

{
  // 全军冲锋：扣费核实后保留增益；取消/士气不足/扣费失败按默认后果解除状态
  const kept = makeScriptActor("号令侠", { morale: 8 });
  kept.effects.push(makeEffect("hl1", "haoling_2"));
  await runScript(chongFengEntry, kept, {
    askImpl: async () => ({ status: "answered", action: "confirm" })
  });
  assert.equal(kept.system.resources.morale.value, 3);
  assert.equal(kept.effects.length, 1, "扣费成功保留 [全军冲锋]");

  const declined = makeScriptActor("号令侠", { morale: 8 });
  declined.effects.push(makeEffect("hl2", "haoling_2"));
  await runScript(chongFengEntry, declined, {
    askImpl: async () => ({ status: "cancelled" })
  });
  assert.equal(declined.system.resources.morale.value, 8);
  assert.equal(declined.effects.length, 0, "不消耗时按默认后果解除状态");

  const insufficient = makeScriptActor("号令侠", { morale: 3 });
  insufficient.effects.push(makeEffect("hl3", "haoling_2"));
  await runScript(chongFengEntry, insufficient, {
    askImpl: async () => { throw new Error("士气不足不应问询"); }
  });
  assert.equal(insufficient.effects.length, 0);

  const droppedMorale = makeScriptActor("号令侠", { morale: 8 });
  droppedMorale.effects.push(makeEffect("hl4", "haoling_2"));
  await runScript(chongFengEntry, droppedMorale, {
    askImpl: async () => {
      droppedMorale.system.resources.morale.value = 2;
      droppedMorale._source.system.resources.morale.value = 2;
      return { status: "answered", action: "confirm" };
    }
  });
  assert.equal(droppedMorale.system.resources.morale.value, 2, "等待后士气不足不扣费");
  assert.equal(droppedMorale.effects.length, 0, "来源复核失败解除状态");

  // 扣费抛错与扣费不足同责：普通异常进入解除增益分支，不保留增益也不吞日志
  const thrown = makeScriptActor("号令侠", { morale: 8 });
  thrown.effects.push(makeEffect("hl5", "haoling_2"));
  thrown.changeResources = async () => { throw new Error("数据库失败"); };
  await runScript(chongFengEntry, thrown, {
    askImpl: async () => ({ status: "answered", action: "confirm" })
  });
  assert.equal(thrown.system.resources.morale.value, 8, "扣费抛错：士气不变");
  assert.equal(thrown.effects.length, 0, "扣费抛错：按默认后果解除增益");

  // 宿主删除等中止错误继续透传，不进入解除分支
  const aborting = makeScriptActor("号令侠", { morale: 8 });
  aborting.effects.push(makeEffect("hl6", "haoling_2"));
  const abortError = new Error("宿主已删除");
  abortError.name = "XJZLScriptAbortError";
  aborting.changeResources = async () => { throw abortError; };
  await assert.rejects(
    () => runScript(chongFengEntry, aborting, { askImpl: async () => ({ status: "answered", action: "confirm" }) }),
    error => error === abortError, "中止错误原样透传"
  );
}
pass("号令·全军冲锋：扣费核实后才保留增益；取消/不足/抛错/失败按默认后果解除且中止透传");

{
  // 合军聚众：扣费核实后才回复；取消不消耗也不回复
  const healed = makeScriptActor("号令侠", { morale: 6 });
  await runScript(juZhongEntry, healed, {
    askImpl: async () => ({ status: "answered", action: "confirm" })
  });
  assert.equal(healed.system.resources.morale.value, 1);
  assert.deepEqual(healed.healCalls, [{ healer: healed, amount: 5, type: "hp", showScrolling: true }]);

  const declined = makeScriptActor("号令侠", { morale: 6 });
  await runScript(juZhongEntry, declined, {
    askImpl: async () => ({ status: "cancelled" })
  });
  assert.equal(declined.system.resources.morale.value, 6);
  assert.equal(declined.healCalls, undefined);
}
pass("号令·合军聚众：扣费核实后才回复，取消不消耗");

const huangQuanEntry = loadEntry("data/neigong/jianghushili2.json", 4, "system.config.stage2.scripts.0");

{
  // 九死黄泉功：按具体文档核实层数减少后才回复；来源消失时不回复
  const actor = makeScriptActor("黄泉侠");
  const hq = makeEffect("hq1", "huangquanqi", 3);
  actor.effects.push(hq);
  await runScript(huangQuanEntry, actor, {
    askImpl: async () => ({ status: "answered", action: "hp" })
  });
  assert.equal(actor.effects.length, 1, "黄泉气 3→2 层");
  assert.deepEqual(actor.healCalls, [{ healer: actor, amount: 10, type: "hp", showScrolling: true }]);

  const vanished = makeScriptActor("黄泉侠");
  const hq2 = makeEffect("hq2", "huangquanqi", 3);
  vanished.effects.push(hq2);
  await runScript(huangQuanEntry, vanished, {
    askImpl: async () => {
      vanished.effects.splice(0); // 等待期间黄泉气消失（原地清空，保留 effects.get）
      return { status: "answered", action: "hp" };
    }
  });
  assert.equal(vanished.healCalls, undefined, "来源已消失不回复");

  const declined = makeScriptActor("黄泉侠");
  declined.effects.push(makeEffect("hq3", "huangquanqi", 1));
  await runScript(huangQuanEntry, declined, {
    askImpl: async () => ({ status: "answered", action: "decline" })
  });
  assert.equal(declined.healCalls, undefined);
  assert.equal(declined.effects.length, 1, "不消耗保留黄泉气");
}
pass("九死黄泉功：按实际层数消耗兑现回复；来源消失与拒绝时不回复");

const guJinEntry = loadEntry("data/neigong/jianghushili1.json", 6, "system.config.stage2.scripts.0");

{
  // 古今秘谱：ask 选择 + controller 检定（脚本显式绑定 trigger/来源），检定完成后覆盖书音值
  const actor = makeScriptActor("古谱侠");
  actor.ownership["p1"] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  registry.set(actor.uuid, actor);
  actor.system.skills.shuxie = { total: 25, checkMod: 0 };
  setClient(localPlayer, [localPlayer, otherGM], "gm-other");
  const setFlags = [];
  actor.setFlag = async (scope, key, value) => { setFlags.push(value); };
  await withDialog([{ action: "roll", values: { bonus: 0, level: 0 } }], null, () =>
    runScript(guJinEntry, actor, { askImpl: async () => ({ status: "answered", action: "shuxie" }), trigger: "combatStart" }));
  assert.deepEqual(setFlags, [10 + 25], "检定完成后覆盖书音值");
  registry.delete(actor.uuid);
}
pass("古今秘谱：选择后 controller 检定并覆盖书音值");

{
  // 古今秘谱：检定取消（roll 为 null）时不覆盖书音值
  const actor = makeScriptActor("古谱侠二");
  actor.ownership["p1"] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  registry.set(actor.uuid, actor);
  actor.system.skills.yanzou = { total: 25, checkMod: 0 };
  setClient(localPlayer, [localPlayer, otherGM], "gm-other");
  const setFlags = [];
  actor.setFlag = async (scope, key, value) => { setFlags.push(value); };
  await withDialog([], null, () =>
    runScript(guJinEntry, actor, { askImpl: async () => ({ status: "answered", action: "yanzou" }), trigger: "combatStart" }));
  assert.deepEqual(setFlags, [], "检定取消时不覆盖书音值");
  registry.delete(actor.uuid);
}
pass("古今秘谱：检定被取消时保留默认，不写书音值");

const saiMaEntry = loadEntry("data/wuxue/yueqi.json", 9, "system.moves.2.scripts.0");

{
  // 赛马曲：controller 检定成功拉人倒地；取消时放弃反击
  const actor = makeScriptActor("赛马侠");
  actor.system.skills.yanzou = { total: 30, checkMod: 0 };
  actor.ownership["p1"] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  registry.set(actor.uuid, actor);
  setClient(localPlayer, [localPlayer, otherGM], "gm-other");
  const attacker = { name: "骑手" };
  await withDialog([{ action: "roll", values: { bonus: 0, level: 0 } }], null, () =>
    runScript(saiMaEntry, actor, { args: { attacker }, trigger: "damaged" }));
  assert.equal(addedEffects.at(-1).slug, "prone", "检定成功（30 ≥ 15）对攻击者施加倒地");
  assert.equal(chatMessages.at(-1).speaker.actor, "赛马侠");
  registry.delete(actor.uuid);

  // 取消检定：放弃反击，不施加新状态
  const before = addedEffects.length;
  const cancelled = makeScriptActor("赛马侠");
  cancelled.system.skills.yanzou = { total: 30, checkMod: 0 };
  registry.set(cancelled.uuid, cancelled);
  await withDialog([], null, () =>
    runScript(saiMaEntry, cancelled, { args: { attacker: { name: "骑手" } }, trigger: "damaged" }));
  assert.equal(addedEffects.length, before, "取消检定不触发新的倒地施加");
  registry.delete(cancelled.uuid);
}
pass("赛马曲：controller 检定判空——取消时放弃反击且不误施状态");

/* -------------------------------------------- */
/*  P. 迁移数据断言：confirm 类弹窗默认按钮为否定项   */
/* -------------------------------------------- */

console.log("P. 迁移数据断言：confirm 类弹窗默认按钮为否定项");

{
  // 原 DialogV2.confirm 在 V14 中默认聚焦 no；迁移后 Enter 必须仍落在"保留/不消耗"侧，
  // 不得把默认选择变成支付资源或触发效果。金刚/方圆源自 DialogV2.prompt（确认默认），不在清单内。
  const confirmOrigin = [
    ["data/neigong/jianghushili1.json", 69, "system.config.stage2.scripts.0"],
    ["data/neigong/jianghushili1.json", 69, "system.config.stage3.scripts.0"],
    ["data/wuxue/yuepu.json", 23, "effects.0.flags.xjzl-system.scripts.0"],
    ["data/wuxue/yuepu.json", 23, "effects.1.flags.xjzl-system.scripts.0"],
    ["data/wuxue/yuepu.json", 31, "effects.0.flags.xjzl-system.scripts.0"],
    ["data/wuxue/yuepu.json", 31, "effects.1.flags.xjzl-system.scripts.1"],
    ["data/wuxue/yuepu.json", 32, "effects.0.flags.xjzl-system.scripts.0"],
    ["data/wuxue/yuepu.json", 32, "effects.1.flags.xjzl-system.scripts.1"],
    ["data/wuxue/fenghuayuan.json", 1, "system.moves.1.scripts.0"],
    ["data/wuxue/gunfa.json", 19, "system.moves.2.scripts.0"],
    ["data/wuxue/jianfa.json", 0, "system.moves.2.scripts.0"],
    ["data/wuxue/tushou.json", 7, "system.moves.0.scripts.0"],
    ["data/wuxue/tushou.json", 8, "system.moves.0.scripts.0"],
    ["data/wuxue/tushou.json", 29, "system.moves.2.scripts.0"],
    ["data/wuxue/tushou.json", 53, "effects.0.flags.xjzl-system.scripts.3"],
    ["data/neigong/jianghushili2.json", 4, "system.config.stage1.scripts.0"],
    ["data/wuxue/jiangjunying.json", 17, "effects.1.flags.xjzl-system.scripts.0"],
    ["data/wuxue/jiangjunying.json", 17, "effects.6.flags.xjzl-system.scripts.0"],
    ["data/wuxue/jiangjunying.json", 17, "effects.7.flags.xjzl-system.scripts.0"]
  ];
  for (const [file, index, path] of confirmOrigin) {
    const node = path.split(".").reduce((value, key) => value?.[key], JSON.parse(readFileSync(resolve(root, file), "utf8"))[index]);
    const defaults = (node.script.match(/action:\s*["']([a-zA-Z_]+)["'][^}]*?default:\s*true/gs) ?? [])
      .map(match => match.match(/action:\s*["']([a-zA-Z_]+)["']/)[1]);
    assert.deepEqual(defaults, ["decline"], `${file} ${path} 的默认按钮应为 decline（保留/不消耗）`);
  }
}
pass("confirm 类弹窗默认按钮保留否定项：Enter 不再默认支付资源");

/* -------------------------------------------- */

console.log(`\n共 ${passed} 项断言组通过。`);
