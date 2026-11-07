/**
 * 在隔离的最小 Foundry 宿主中比较源码与发布入口；执行真实依赖图和生命周期。
 * 这里只替换框架边界，不模拟浏览器布局、数据库或多人 Socket，不能替代 Foundry 验收。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createContext, runInContext, SourceTextModule } from "node:vm";

/** 建立独立宿主；缺少的框架接口会直接报错，不用通用 Proxy 掩盖初始化异常。 */
function createHost(isGM, customDistanceRule) {
  const context = createContext({ isGM, customDistanceRule });
  runInContext(`
    const trace = { sheets: [], settings: [], templates: [], helpers: [], socket: [], listeners: [] };
    const hooks = [];
    const addHook = (kind, event, callback) => { hooks.push({ kind, event, callback }); return hooks.length; };
    globalThis.Hooks = {
      once: (event, callback) => addHook("once", event, callback),
      on: (event, callback) => addHook("on", event, callback)
    };
    globalThis.console = {
      log() {}, warn() {},
      error(...args) { throw new Error(args.map(String).join(" ")); }
    };
    class Document { constructor(data = {}) { Object.assign(this, data); } }
    class Actor extends Document {}
    class Item extends Document {}
    class ActiveEffect extends Document {}
    class Combat extends Document {}
    class ApplicationV2 { static DEFAULT_OPTIONS = {}; }
    class TypeDataModel {}
    class Field { constructor(...args) { this.args = args; } }
    class SquareGrid {
      measurePath() { return { segments: [{ distance: 4, cost: 4 }], distance: 4, cost: 4 }; }
    }
    const registerSheet = (...args) => {
      const sheet = args.find(value => typeof value === "function");
      trace.sheets.push(sheet.name);
      for (const [action, callback] of Object.entries(sheet.DEFAULT_OPTIONS?.actions ?? {})) {
        if (typeof callback !== "function") throw new Error(sheet.name + " 无效 action：" + action);
      }
    };
    const collection = { registerSheet, unregisterSheet() {} };
    const getProperty = (object, key) => key.split(".").reduce((value, part) => value?.[part], object);
    globalThis.Actor = Actor;
    globalThis.Item = Item;
    globalThis.ActiveEffect = ActiveEffect;
    globalThis.CONFIG = {
      Actor: {}, Item: {}, ActiveEffect: {}, Combat: {}, ui: {}, time: {}, queries: {},
      Region: { objectClass: class Region {} }, Canvas: {},
      RegionBehavior: { dataModels: {}, typeIcons: {}, typeHints: {} },
      statusEffects: [], specialStatusEffects: { BLIND: "blind" }
    };
    globalThis.CONST = {
      GRID_DIAGONALS: { EQUIDISTANT: 1 },
      DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 },
      REGION_EVENTS: Object.fromEntries([
        "TOKEN_ENTER", "TOKEN_EXIT", "TOKEN_MOVE_WITHIN", "TOKEN_TURN_START", "TOKEN_TURN_END",
        "TOKEN_ROUND_START", "TOKEN_ROUND_END"
      ].map(name => [name, name]))
    };
    globalThis.foundry = {
      abstract: { Document, TypeDataModel },
      data: {
        fields: Object.fromEntries(["StringField", "NumberField", "BooleanField", "SchemaField", "ArrayField", "HTMLField", "ObjectField", "SetField"].map(name => [name, Field])),
        regionBehaviors: { RegionBehaviorType: class {} }
      },
      grid: { SquareGrid },
      documents: { Combat, collections: { Actors: collection, Items: collection } },
      applications: {
        api: { ApplicationV2, HandlebarsApplicationMixin: base => base, DialogV2: class {} },
        apps: { DocumentSheetConfig: { registerSheet, unregisterSheet() {} } },
        sheets: Object.fromEntries(["ActorSheet", "ItemSheet", "ActorSheetV2", "ItemSheetV2", "ActiveEffectConfig", "RegionBehaviorConfig"].map(name => [name, ApplicationV2])),
        ui: { GamePause: ApplicationV2 },
        handlebars: {
          renderTemplate: async () => "",
          loadTemplates: async files => { trace.templates.push(...files); }
        }
      },
      utils: {
        getProperty, isPlainObject: value => value?.constructor === Object,
        deepClone: value => JSON.parse(JSON.stringify(value)),
        randomID: () => "release-check", debounce: callback => callback,
        mergeObject: (target, source) => Object.assign(target, source)
      }
    };
    const settingValues = new Map();
    globalThis.game = {
      system: { version: "release-check" },
      user: { id: "release-user", isGM, targets: new Set() }, users: { activeGM: null }, packs: [],
      i18n: { localize: key => key, format: key => key },
      settings: {
        register(scope, key, spec) { trace.settings.push([scope, key, spec.type?.name, spec.default]); settingValues.set(key, spec.default); },
        get(scope, key) {
          if (key === "customDistanceRule") return customDistanceRule;
          if (["enableActionTracker", "enableToneTracker", "enableCombatStats"].includes(key)) return false;
          return settingValues.get(key);
        }
      }
    };
    const listen = (event) => trace.listeners.push(event);
    globalThis.window = { innerWidth: 1600, innerHeight: 900, addEventListener: listen };
    globalThis.document = { addEventListener: listen, getElementById: () => null };
    globalThis.ui = { notifications: { info() {}, warn() {}, error(message) { throw new Error(message); } } };
    globalThis.canvas = { dimensions: { size: 100, distance: 1 } };
    globalThis.Handlebars = { registerHelper: name => trace.helpers.push(name), SafeString: class {} };
    globalThis.socketlib = {
      registerSystem: () => ({
        register: name => trace.socket.push(name), executeAsGM() {}, executeForEveryone() {}
      })
    };
    globalThis.__emit = async event => {
      for (const hook of [...hooks].filter(hook => hook.event === event)) await hook.callback();
    };
    globalThis.__snapshot = () => ({
      ...trace,
      hooks: hooks.map(({ kind, event }) => [kind, event]),
      documents: [CONFIG.Actor, CONFIG.Item, CONFIG.ActiveEffect, CONFIG.Combat].map(entry => entry.documentClass?.name),
      actorModels: Object.entries(CONFIG.Actor.dataModels).map(([key, value]) => [key, value.name]),
      itemModels: Object.entries(CONFIG.Item.dataModels).map(([key, value]) => [key, value.name]),
      regionModel: CONFIG.RegionBehavior.dataModels.xjzlAura.name,
      statuses: Object.keys(CONFIG.statusEffects),
      api: Object.keys(game.xjzl).sort(),
      macros: Object.getOwnPropertyNames(game.xjzl.Macros).sort()
    });
    globalThis.__scriptCheck = async () => {
      const actor = new CONFIG.Actor.documentClass({ name: "发布校验", uuid: "Actor.release", system: { resources: { hp: { value: 7 } } } });
      const sandbox = { actor, args: { value: 0 }, trigger: "calc", Macros: game.xjzl.Macros };
      actor._runScriptsSync([{ label: "sync", script: "args.value += S.resources.hp.value; args.macro = typeof Macros.requestSave; args.actorClass = actor.constructor.name;" }], sandbox);
      sandbox.trigger = "hit";
      await actor._runScriptsAsync([{ label: "async", script: "await Promise.resolve(); args.value += 3; args.ask = typeof ask; args.socket = typeof game.xjzl.socket.executeAsGM;" }], sandbox);
      return sandbox.args;
    };
  `, context);
  return context;
}

/** 使用原生 ESM 链接真实源码，缓存模块以保留循环依赖及 live binding 语义。 */
async function evaluateEntry(root, entry, context) {
  const modules = new Map();
  const load = filename => {
    if (!modules.has(filename)) {
      modules.set(filename, new SourceTextModule(readFileSync(filename, "utf8"), {
        context, identifier: pathToFileURL(filename).href,
        initializeImportMeta(meta) { meta.url = pathToFileURL(filename).href; }
      }));
    }
    return modules.get(filename);
  };
  const main = load(path.join(root, entry));
  await main.link((specifier, module) => {
    if (!specifier.startsWith(".")) throw new Error(`初始化校验不接受外部依赖：${specifier}`);
    return load(fileURLToPath(new URL(specifier, module.identifier)));
  });
  await main.evaluate({ timeout: 10000 });
  for (const event of ["init", "setup", "socketlib.ready", "ready"]) await context.__emit(event);
  return {
    snapshot: JSON.parse(JSON.stringify(context.__snapshot())),
    scripts: JSON.parse(JSON.stringify(await context.__scriptCheck()))
  };
}

/** 比较 GM/玩家启动及同步/异步动态脚本，捕获合并后的初始化顺序和名称变化。 */
export async function verifyBootstrap(sourceRoot, releaseRoot) {
  for (const isGM of [false, true]) {
    const original = await evaluateEntry(sourceRoot, "xjzl-system.mjs", createHost(isGM, isGM));
    const compiled = await evaluateEntry(releaseRoot, "xjzl-system.mjs", createHost(isGM, isGM));
    assert.deepEqual(compiled, original, `发布入口与源码初始化不一致（isGM=${isGM}）`);
    assert.deepEqual(compiled.scripts, {
      value: 10, macro: "function", actorClass: "XJZLActor", ask: "function", socket: "function"
    });
    assert.ok(compiled.snapshot.sheets.length >= 10, "主要 Sheet 未注册");
    assert.ok(compiled.snapshot.socket.length >= 10, "Socket 方法未注册");
  }
}
