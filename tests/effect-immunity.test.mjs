/**
 * 免疫边界回归：在最小 Foundry mock 下运行真实文档、管理器和 UI 方法。
 * VM 只替换无关依赖，避免启动整个 Foundry；不模拟数据库/Socket 时序或页面渲染。
 * 运行：node --experimental-vm-modules tests/effect-immunity.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { SourceTextModule, SyntheticModule } from "node:vm";

const root = fileURLToPath(new URL("../", import.meta.url));
const messages = [];
const notifications = [];
const cards = [];
const registry = new Map();
let sequence = 0;

function getProperty(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setProperty(object, path, value) {
  const keys = path.split(".");
  let parent = object;
  for (const key of keys.slice(0, -1)) parent = parent[key] ??= {};
  parent[keys.at(-1)] = value;
}

class MockActor {
  prepareDerivedData() {}
}
class MockItem {}
class MockEffect {
  constructor(data, { parent } = {}) {
    Object.assign(this, structuredClone(data));
    this.parent = parent;
    this.id ??= `effect${++sequence}`;
    this.documentName = "ActiveEffect";
    this.system ??= { changes: [] };
    this.flags ??= {};
  }
  async _preCreate(data, options) { return options?.cancel ? false : undefined; }
  updateSource(updates) {
    for (const [key, value] of Object.entries(updates)) setProperty(this, key, value);
  }
  getFlag(scope, key) { return getProperty(this.flags[scope], key); }
  toObject() {
    return structuredClone({
      name: this.name, flags: this.flags, system: this.system,
      duration: this.duration, statuses: this.statuses
    });
  }
  async update(updates) { this.updateSource(updates); return this; }
  async delete() { this.parent.effects = this.parent.effects.filter(effect => effect !== this); }
}

globalThis.Actor = MockActor;
globalThis.Item = MockItem;
globalThis.ActiveEffect = MockEffect;
String.prototype.slugify = function () { return String(this).toLowerCase(); };
globalThis.foundry = {
  data: { fields: {} },
  applications: {
    api: { ApplicationV2: class {}, HandlebarsApplicationMixin: base => base },
    handlebars: { renderTemplate: async (path, data) => { cards.push(data); return "card"; } }
  },
  utils: {
    getProperty, setProperty,
    deepClone: structuredClone,
    randomID: () => `id${++sequence}`,
    isPlainObject: value => value?.constructor === Object,
    isEmpty: value => Object.keys(value).length === 0,
    mergeObject: (base, patch) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value?.constructor === Object && base[key]?.constructor === Object) {
          foundry.utils.mergeObject(base[key], value);
        } else base[key] = structuredClone(value);
      }
      return base;
    }
  }
};
const translations = JSON.parse(readFileSync(resolve(root, "lang/zh-cn.json"), "utf8"));
globalThis.game = {
  user: { id: "user" },
  settings: { get: () => false },
  i18n: {
    localize: key => getProperty(translations, key) ?? key,
    format: (key, values) => game.i18n.localize(key).replace(/\{([^}]+)\}/g, (_, name) => values[name])
  },
  xjzl: { api: {} }
};
globalThis.ui = { notifications: {
  info: message => notifications.push(message),
  warn: message => notifications.push(message),
  error: message => { throw new Error(message); }
} };
globalThis.ChatMessage = {
  getSpeaker: ({ actor }) => ({ actor: actor.uuid }),
  create: async message => { messages.push(message); }
};
globalThis.fromUuid = async uuid => registry.get(uuid);

// 仅隔离未参与本测试的服务，受测模块按原始 ESM 源码链接，不复制业务实现。
const stubs = new Map([
  ["module/utils/macros.mjs", { XJZLMacros: {} }],
  ["module/socket.mjs", { xjzlSocket: {} }],
  ["module/managers/combat-fx-manager.mjs", { queueHitEffect: () => {} }],
  ["module/region/xjzl-aura-manager.mjs", { AuraManager: {} }],
  ["module/applications/action-tracker.mjs", { ActionTracker: {} }],
  ["module/data/actor/container.mjs", { DEFAULT_CONTAINER_IMAGES: {} }],
  ["module/utils/portrait.mjs", { resolveTargetPortrait: () => "" }]
].map(([path, exports]) => [resolve(root, path), exports]));
const modules = new Map();

/** 载入真实模块，外部服务边界使用显式 mock；链接和执行失败直接传播。 */
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

const { XJZL } = await importModule("module/config.mjs");
globalThis.CONFIG = { XJZL, statusEffects: Object.fromEntries(XJZL.statusEffects.map(effect => [effect.id, effect])) };
const { XJZLActiveEffect } = await importModule("module/documents/active-effect.mjs");
const { ActiveEffectManager } = await importModule("module/managers/active-effect-manager.mjs");
const { XJZLActor } = await importModule("module/documents/actor.mjs");
const { XJZLItem } = await importModule("module/documents/item.mjs");
const { EffectSelectionDialog } = await importModule("module/applications/effect-selection-dialog.mjs");
const { prepareEffects } = await importModule("module/sheets/behaviors/effect-interactions.mjs");
game.xjzl.api.effects = ActiveEffectManager;

function makeActor() {
  const actor = Object.assign(Object.create(XJZLActor.prototype), {
    uuid: `Actor.${++sequence}`, name: "目标", type: "character", isOwner: true,
    effects: [], items: [],
    system: { resources: {}, skills: {}, recalculate: () => {} },
    getFlag: () => undefined,
    runScripts: () => {},
    showFloatyText: text => notifications.push(text),
    get appliedEffects() { return this.effects; }
  });
  Object.defineProperty(actor, "appliedEffects", { get: () => actor.effects });
  actor.createEmbeddedDocuments = async (type, data, options) => {
    const created = [];
    for (const source of data) {
      const effect = new XJZLActiveEffect(source, { parent: actor });
      if (await effect._preCreate(source, options) === false) continue;
      actor.effects.push(effect);
      created.push(effect);
    }
    return created;
  };
  actor.deleteEmbeddedDocuments = async (type, ids) => {
    actor.effects = actor.effects.filter(effect => !ids.includes(effect.id));
  };
  actor.updateEmbeddedDocuments = async () => {};
  return actor;
}

function hasSlug(actor, slug) {
  return actor.effects.some(effect => effect.getFlag("xjzl-system", "slug") === slug);
}

function makeConsumable(actor, effects, autoReplace = true) {
  const item = Object.assign(Object.create(XJZLItem.prototype), {
    actor, uuid: "Item.medicine", name: "药剂",
    system: { quantity: 2, type: "medicine", autoReplace },
    effects: effects.map(source => new XJZLActiveEffect(source))
  });
  item.update = async updates => {
    for (const [key, value] of Object.entries(updates)) setProperty(item, key, value);
  };
  return item;
}

function oldMedicine(actor) {
  const effect = new XJZLActiveEffect({
    name: "旧药效", flags: { "xjzl-system": { slug: "old_medicine", consumableType: "medicine" } }
  }, { parent: actor });
  actor.effects.push(effect);
  return effect;
}

const pain = { ...ActiveEffectManager.getStatus("pain"), duration: { value: 1, units: "rounds" } };
const blind = ActiveEffectManager.getStatus("blind");
let passed = 0;
function pass(label) { console.log(`  ✓ ${++passed}. ${label}`); }

// 通用状态和物品模板两种入口均须正确区分直接施加与未直接施加。
for (const cause of ["immune", "endurance", "chanshou", "xinhuo"]) {
  for (const entry of ["status", "item", "consumable"]) {
    const actor = makeActor();
    let source = structuredClone(pain);
    if (cause === "immune") actor.registerEffectImmunities(["pain"]);
    if (cause === "endurance") actor.system.skills.rennai = { total: 1 };
    if (cause === "chanshou" || cause === "xinhuo") {
      const slug = cause === "chanshou" ? "chanshou" : "wuxue_mingjiao_xinhuo";
      source = {
        name: slug, flags: { "xjzl-system": { slug, stackable: true, stacks: cause === "chanshou" ? 4 : 2 } },
        system: { changes: [] }
      };
      actor.effects.push(new XJZLActiveEffect(source, { parent: actor }));
    }
    const notificationStart = notifications.length;
    const cardStart = cards.length;
    if (entry === "consumable") {
      await makeConsumable(actor, [source])._useConsumable(actor);
      const result = cards[cardStart].resultText;
      assert.match(result, /未直接施加状态/);
      assert.doesNotMatch(result, /免疫状态/);
    } else {
      const dialog = Object.create(EffectSelectionDialog.prototype);
      dialog._getTargetActors = () => [actor];
      dialog._rememberStatus = async () => {};
      dialog._rememberSceneEffect = async () => {};
      dialog.render = () => {};
      if (entry === "status") {
        const slug = source.flags["xjzl-system"].slug;
        const original = CONFIG.statusEffects[slug];
        CONFIG.statusEffects[slug] = { ...source, id: slug };
        try {
          await dialog._onApplyStatus(null, { dataset: { slug } });
        } finally {
          if (original) CONFIG.statusEffects[slug] = original;
          else delete CONFIG.statusEffects[slug];
        }
      } else {
        registry.set("Effect.source", { ...new XJZLActiveEffect(source), parent: { uuid: "Item.source" } });
        const effect = registry.get("Effect.source");
        effect.toObject = () => structuredClone(source);
        await dialog._onApplyItemEffect(null, { dataset: { uuid: "Effect.source" } });
      }
      assert.ok(notifications.slice(notificationStart).some(text => text.includes("1 个目标未直接获得")));
      assert.ok(notifications.slice(notificationStart).every(text => !text.includes("1 个目标免疫")));
    }
    if (cause === "chanshou") assert.ok(hasSlug(actor, "jiaoxie"));
    if (cause === "xinhuo") assert.ok(hasSlug(actor, "rage"));
  }
  pass(`${cause}：三种结果汇总入口均不误报免疫，转化结果保留`);
}

for (const kind of ["all", "partial", "disabled", "none"]) {
  const actor = makeActor();
  actor.registerEffectImmunities(kind === "all" ? ["pain", "blind"] : kind === "none" ? [] : ["pain"]);
  const old = oldMedicine(actor);
  const item = makeConsumable(actor, [pain, blind], kind !== "disabled");
  await item._useConsumable(actor);
  assert.equal(actor.effects.includes(old), kind === "all" || kind === "disabled");
  assert.equal(hasSlug(actor, "pain"), kind === "none");
  assert.equal(hasSlug(actor, "blind"), kind !== "all");
  assert.equal(item.system.quantity, 1);
  pass(`药效替换 ${kind}：旧药效、实际新 AE 和数量扣减符合约定`);
}

const immuneTarget = makeActor();
const normalTarget = makeActor();
immuneTarget.registerEffectImmunities(["blind"]);
const dialog = Object.create(EffectSelectionDialog.prototype);
dialog._getTargetActors = () => [immuneTarget, normalTarget];
dialog._rememberStatus = async () => {};
dialog.render = () => {};
const notificationStart = notifications.length;
await dialog._onApplyStatus(null, { dataset: { slug: "blind" } });
const summary = notifications.slice(notificationStart);
assert.ok(summary.includes("已对 1 个目标应用 [目盲]"));
assert.ok(summary.includes("1 个目标未直接获得 [目盲]"));
assert.equal(hasSlug(immuneTarget, "blind"), false);
assert.equal(hasSlug(normalTarget, "blind"), true);
pass("混合目标准确统计两类结果，本地化替换实际数量和状态名");

const actor = makeActor();
const source = new XJZLActiveEffect({
  name: "免疫来源", flags: { "xjzl-system": { immunities: ["unknown_slug", "unknown_slug", "blind"] } }
}, { parent: actor });
actor.effects.push(source);
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => warnings.push(args);
try {
  actor.prepareDerivedData();
  actor.prepareDerivedData();
  actor.prepareDerivedData();
} finally {
  console.warn = originalWarn;
}
assert.equal(warnings.length, 1);
assert.equal(actor.hasEffectImmunity("unknown_slug"), false);
assert.equal(actor.hasEffectImmunity("blind"), true);
actor.effects = [];
actor.prepareDerivedData();
assert.equal(actor.hasEffectImmunity("blind"), false);
pass("重复派生数据只告警一次，合法免疫随来源移除失效");

actor.registerEffectImmunities(["blind"], { name: "来源一" });
actor.registerEffectImmunities(["blind"], { name: "来源二" });
const context = {};
prepareEffects({ actor }, context);
assert.equal(context.effectImmunities[0].sourcesLabel, "来源一、来源二");
assert.deepEqual(actor.getEffectImmunitySources("blind"), ["来源一", "来源二"]);
pass("免疫来源按中文分隔符展示，原始来源数组保留");

const originalGetStatusSlug = XJZLActiveEffect.getSystemStatusSlug;
let lookups = 0;
XJZLActiveEffect.getSystemStatusSlug = function (data) {
  lookups += 1;
  return originalGetStatusSlug.call(this, data);
};
try {
  const template = new XJZLActiveEffect(blind, { parent: new MockItem() });
  assert.notEqual(await template._preCreate(blind, {}), false);
  assert.equal(lookups, 0);
  const direct = new XJZLActiveEffect(blind, { parent: actor });
  assert.equal(await direct._preCreate(blind, {}), false);
  assert.equal(lookups, 1);
  assert.equal(await direct._preCreate(blind, { cancel: true }), false);
  assert.equal(lookups, 1);
} finally {
  XJZLActiveEffect.getSystemStatusSlug = originalGetStatusSlug;
}
pass("Item 模板跳过免疫解析，Actor 原生创建仍拦截且保留父类取消");

console.log(`\n全部 ${passed} 组断言通过。`);
