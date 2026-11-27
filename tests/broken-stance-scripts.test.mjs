/**
 * 架招被击破时受击脚本收集与结算链路回归：
 * 在最小 Foundry mock 下加载真实 actor.mjs、macros.mjs 与 chat-manager.mjs，
 * 验证 stopStance() 先行解除架招与格挡后，破架快照仍可沿本次受击链补收原架招的
 * preDefense / preTake / dying / death / damaged 脚本，同时保留 checkStance 守卫、
 * 阶段隔离、防重入与跨端 GM 委托透传。
 *
 * 运行：node --experimental-vm-modules --test tests/broken-stance-scripts.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
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
/*  Foundry 全局 mock（须先于受测模块链接）         */
/* -------------------------------------------- */

globalThis.CONST = {
  DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 },
  CHAT_MESSAGE_STYLES: { OTHER: 0 }
};

globalThis.foundry = {
  data: { fields: {} },
  abstract: { Document: class MockDocument {} },
  utils: {
    randomID: () => `id${++sequence}`,
    getProperty,
    setProperty,
    deepClone: structuredClone,
    isEmpty: value => !value || Object.keys(value).length === 0
  },
  applications: {
    api: { DialogV2: { confirm: async () => true } },
    handlebars: { renderTemplate: async () => "<div>mock-card</div>" }
  }
};

globalThis.renderTemplate = async () => "<div>mock-card</div>";
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({
    innerHTML: "",
    querySelector: () => ({ outerHTML: "" })
  })
};
globalThis.Roll = class MockRoll {
  static fromData(data) { return data; }
};

const translations = JSON.parse(readFileSync(resolve(root, "lang/zh-cn.json"), "utf8"));
const chatMessages = [];
const notices = [];
const socketCalls = [];
const auraDismissCalls = [];
const auraCreates = [];
const addedEffects = [];
const statusCalls = [];
const registry = new Map();

const statusTemplates = {
  chengfeng: {
    name: "乘风",
    img: "icons/chengfeng.png",
    flags: { "xjzl-system": { slug: "chengfeng", stackable: true } }
  }
};

globalThis.CONFIG = {
  XJZL: {
    attributes: { dingli: "XJZL.Attributes.Dingli", liliang: "XJZL.Attributes.Liliang" },
    skills: { wuxue: "XJZL.Skills.Wuxue" },
    arts: {},
    weaponTypes: {},
    damageTypes: {
      waigong: "XJZL.Combat.DamageType.Waigong",
      neigong: "XJZL.Combat.DamageType.Neigong"
    }
  },
  statusEffects: {
    pofang: {
      id: "pofang",
      name: "XJZL.Status.Pofang",
      description: "XJZL.Status.PofangDesc",
      img: "icons/pofang.png",
      statuses: ["pofang"],
      flags: { "xjzl-system": { slug: "pofang", stackable: false } },
      duration: { value: 1, units: "rounds", expiry: "turnStart", expired: false },
      system: { changes: [{ key: "flags.xjzl-system.blockStance", type: "override", value: "true" }] }
    }
  }
};

globalThis.game = {
  user: { id: "gm-1", isGM: true, targets: new Set() },
  users: { activeGM: { isSelf: true } },
  settings: { get: () => false },
  i18n: {
    localize: key => getProperty(translations, key) ?? key,
    format: (key, values = {}) => (getProperty(translations, key) ?? key)
      .replace(/\{([^}]+)\}/g, (_, k) => values[k] ?? "")
  },
  xjzl: {
    api: {
      effects: {
        getStatus: slug => statusTemplates[slug] ? structuredClone(statusTemplates[slug]) : null,
        addEffect: async (targetActor, effData) => {
          const cloned = structuredClone(effData);
          const created = makeEffectDoc(cloned, `eff-${++sequence}`);
          targetActor.effects.push(created);
          targetActor._recomputeDerived?.();
          addedEffects.push({ actor: targetActor, effData: cloned, created });
          return created;
        }
      }
    },
    aura: {
      create: async (sourceActor, params) => {
        auraCreates.push({ sourceActor, params });
        return { id: `region-${auraCreates.length}` };
      }
    }
  }
};

globalThis.ui = {
  notifications: {
    info: msg => notices.push({ level: "info", msg }),
    warn: msg => notices.push({ level: "warn", msg }),
    error: msg => notices.push({ level: "error", msg })
  }
};

globalThis.ChatMessage = {
  getSpeaker: ({ actor }) => ({ actor: actor?.id ?? null }),
  create: async data => {
    const msg = {
      id: `chat-${chatMessages.length + 1}`,
      uuid: `ChatMessage.chat-${chatMessages.length + 1}`,
      ...data,
      content: data.content ?? '<div class="card-buttons"></div>',
      async update(updates) {
        for (const [k, v] of Object.entries(updates)) setProperty(this, k, v);
        return this;
      }
    };
    chatMessages.push(msg);
    return msg;
  }
};

globalThis.fromUuid = async uuid => registry.get(uuid) ?? null;
globalThis.Hooks = { on() {}, callAll() {}, call: () => true };

globalThis.Actor = class MockActorRoot {
  async update(changes) {
    for (const [key, value] of Object.entries(changes)) {
      setProperty(this, key, value);
      if (this._source) setProperty(this._source, key, value);
    }
    this._recomputeDerived?.();
    return { ...changes };
  }
};
globalThis.Item = class MockItem {};
globalThis.ActiveEffect = class MockActiveEffect {};

/* -------------------------------------------- */
/*  模块加载（真实 actor / macros / chat-manager）  */
/* -------------------------------------------- */

const socketStub = {
  executeAsGM: async (...args) => {
    socketCalls.push(args);
    return { ok: true, result: { finalDamage: 0, hpLost: 0, isDead: false } };
  }
};

const stubs = new Map([
  ["module/socket.mjs", { xjzlSocket: socketStub }],
  ["module/managers/active-effect-manager.mjs", { ActiveEffectManager: { addEffect: async () => null } }],
  ["module/managers/script-interaction-manager.mjs", {
    ScriptInteractionManager: {
      cancelAllForActor: () => {},
      createScriptAsk: () => async () => ({ status: "cancelled", reason: "mock" }),
      promptControllerAttributeTestConfig: async () => null
    }
  }],
  ["module/managers/combat-fx-manager.mjs", { queueHitEffect: () => {} }],
  ["module/region/xjzl-aura-manager.mjs", { AuraManager: { dismissBySource: async call => auraDismissCalls.push(call) } }],
  ["module/applications/action-tracker.mjs", { ActionTracker: { consumeAction: () => {} } }],
  ["module/managers/target-manager.mjs", { TargetManager: {} }],
  ["module/data/actor/container.mjs", { DEFAULT_CONTAINER_IMAGES: {} }],
  ["module/utils/portrait.mjs", { resolveTargetPortrait: () => "" }]
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
const { XJZLMacros } = await importModule("module/utils/macros.mjs");
const { ChatCardManager } = await importModule("module/managers/chat-manager.mjs");

globalThis.Macros = XJZLMacros;

/* -------------------------------------------- */
/*  测试夹具                                      */
/* -------------------------------------------- */

function makeEffectDoc(data, id) {
  const statuses = new Set(data.statuses ?? []);
  const flags = structuredClone(data.flags ?? {});
  const system = structuredClone(data.system ?? { changes: [] });
  const duration = structuredClone(data.duration ?? {});
  const scripts = structuredClone(flags["xjzl-system"]?.scripts ?? []);
  return Object.assign(new globalThis.ActiveEffect(), {
    id,
    name: data.name ?? id,
    origin: data.origin ?? null,
    statuses,
    flags,
    system,
    duration,
    disabled: false,
    isSuppressed: false,
    hasScript: trigger => scripts.some(s => s.trigger === trigger && s.active !== false),
    scripts,
    getFlag(scope, key) {
      return getProperty(this.flags?.[scope], key);
    },
    toObject() {
      return structuredClone({
        name: this.name,
        description: data.description ?? "",
        img: data.img ?? "",
        origin: this.origin,
        flags: this.flags,
        system: this.system,
        duration: this.duration,
        statuses: [...this.statuses]
      });
    }
  });
}

function makeWuxueItem({ id, name, moves, effects = [] }) {
  const effectDocs = effects.map((ef, idx) => makeEffectDoc(ef, `${id}-ef-${idx}`));
  effectDocs.getName = targetName => effectDocs.find(e => e.name === targetName) ?? null;
  return Object.assign(new globalThis.Item(), {
    id,
    uuid: `Item.${id}`,
    name,
    type: "wuxue",
    system: { category: "wuxue", moves },
    effects: effectDocs
  });
}

function makeActor({
  id = `actor-${++sequence}`,
  name = "受击者",
  hp = 100,
  mp = 20,
  baseDefWaigong = 0,
  stanceBlock = 15,
  kanpo = 25,
  stanceItem = null,
  stanceMoveId = "",
  stanceActive = false,
  isOwner = true,
  items = []
} = {}) {
  const allItems = stanceItem && !items.includes(stanceItem) ? [stanceItem, ...items] : [...items];
  const itemById = new Map(allItems.map(item => [item.id, item]));
  const actor = Object.assign(Object.create(XJZLActor.prototype), {
    id,
    uuid: `Actor.${id}`,
    name,
    type: "character",
    isOwner,
    token: null,
    img: "icons/actor.png",
    flags: {},
    xjzlStatuses: {},
    _resourceScriptCache: false,
    effects: [],
    items: {
      get: itemId => itemById.get(itemId) ?? null,
      filter: fn => allItems.filter(fn),
      find: fn => allItems.find(fn) ?? null
    },
    itemTypes: {
      trait: allItems.filter(i => i.type === "trait"),
      wuxue: allItems.filter(i => i.type === "wuxue")
    },
    floatyTexts: [],
    system: {
      resources: {
        hp: { value: hp, max: 100 },
        mp: { value: mp, max: 20 },
        rage: { value: 0, max: 10 },
        huti: 0,
        morale: { value: 0, max: 10 }
      },
      combat: {
        defWaigongTotal: baseDefWaigong,
        defNeigongTotal: 0,
        blockTotal: stanceActive ? stanceBlock : 0,
        stanceBlockValue: stanceActive ? stanceBlock : 0,
        kanpoTotal: kanpo,
        hitWaigongTotal: 0,
        hitNeigongTotal: 0,
        critWaigongTotal: 20,
        critNeigongTotal: 20,
        resistances: {
          global: { total: 0 }, skill: { total: 0 }, bleed: { total: 0 }, poison: { total: 0 },
          fire: { total: 0 }, mental: { total: 0 }, liushi: { total: 0 },
          neigong: { total: 0 }, waigong: { total: 0 }
        }
      },
      martial: {
        active_neigong: "",
        stance: stanceActive ? stanceMoveId : "",
        stanceItemId: stanceActive && stanceItem ? stanceItem.id : "",
        stanceActive
      }
    },
    _source: {
      system: {
        resources: {
          hp: { value: hp, max: 100 },
          mp: { value: mp, max: 20 },
          rage: { value: 0, max: 10 },
          huti: 0,
          morale: { value: 0, max: 10 }
        }
      }
    },
    _recomputeDerived() {
      const active = this.system.martial?.stanceActive === true;
      this.system.combat.stanceBlockValue = active ? stanceBlock : 0;
      this.system.combat.blockTotal = active ? stanceBlock : 0;
      const aeDefWaigong = this.effects.reduce((sum, ef) => {
        if (ef.disabled || ef.isSuppressed) return sum;
        const changes = ef.system?.changes ?? [];
        for (const c of changes) {
          if (c.key === "system.combat.def_waigong" && c.type === "add") {
            sum += Number(c.value) || 0;
          }
        }
        return sum;
      }, 0);
      this.system.combat.defWaigongTotal = baseDefWaigong + aeDefWaigong;
    },
    getFlag(scope, key) {
      return getProperty(this.flags?.[scope], key);
    },
    showFloatyText(text, style) {
      this.floatyTexts.push({ text, style });
    },
    async createEmbeddedDocuments(type, dataList) {
      if (type !== "ActiveEffect") return [];
      const created = dataList.map((d, idx) => makeEffectDoc(d, `ae-${++sequence}-${idx}`));
      this.effects.push(...created);
      return created;
    },
    async deleteEmbeddedDocuments(type, ids) {
      if (type !== "ActiveEffect") return [];
      const idSet = new Set(ids);
      const removed = this.effects.filter(e => idSet.has(e.id));
      this.effects = this.effects.filter(e => !idSet.has(e.id));
      return removed;
    },
    async toggleStatusEffect(statusId, { active } = {}) {
      statusCalls.push({ actor: this.uuid, statusId, active });
      if (active) {
        this.effects.push(makeEffectDoc({ name: statusId, statuses: [statusId] }, `status-${++sequence}`));
      }
    },
    async rollAttributeTest(attr, { bonus = 0 } = {}) {
      const base = this._nextRollTotal ?? 10;
      const val = base + bonus;
      return { total: val, data: { val: 0 }, terms: [{ total: val }], formula: "1d20" };
    }
  });
  return actor;
}

function loadWuxue(relPath, wuxueName) {
  const raw = JSON.parse(readFileSync(resolve(root, "data/wuxue", relPath), "utf8"));
  const itemData = (Array.isArray(raw) ? raw : [raw]).find(i => i.name === wuxueName);
  assert.ok(itemData, `${relPath} 应存在《${wuxueName}》`);
  const moves = (itemData.system?.moves ?? []).map((m, idx) => ({
    ...structuredClone(m),
    id: m.id || `move-${wuxueName}-${idx}`
  }));
  return makeWuxueItem({
    id: `item-${wuxueName}`,
    name: itemData.name,
    moves,
    effects: itemData.effects ?? []
  });
}

function makeAttackItem(move) {
  return makeWuxueItem({
    id: "item-atk",
    name: "测试进攻武学",
    moves: [move]
  });
}

function makeChatMessage({ id = "msg-1", flags = {}, hitResults = [], content = '<div class="card-buttons"></div>' } = {}) {
  return {
    id,
    uuid: `ChatMessage.${id}`,
    content,
    flags: { "xjzl-system": flags },
    async update(updates) {
      for (const [k, v] of Object.entries(updates)) setProperty(this, k, v);
      return this;
    },
    getFlag(scope, key) {
      if (scope === "xjzl-system" && key === "finalResolvedHit") return hitResults;
      return getProperty(this.flags?.[scope], key);
    }
  };
}

function resetMocks() {
  chatMessages.length = 0;
  notices.length = 0;
  socketCalls.length = 0;
  auraDismissCalls.length = 0;
  auraCreates.length = 0;
  addedEffects.length = 0;
  statusCalls.length = 0;
  registry.clear();
  game.user.targets = new Set();
  delete game.testLog;
}

/* -------------------------------------------- */
/*  测试用例                                      */
/* -------------------------------------------- */

test("自动结算虚招破架：stopStance 清空格挡与绑定特效后，仍按快照补收 preDefense / preTake / damaged 破架脚本并拦截 checkStance", async () => {
  resetMocks();
  const log = [];
  game.testLog = log;

  const stanceMove = {
    id: "stance-1",
    name: "测试破架架招",
    type: "stance",
    computedLevel: 3,
    scripts: [
      {
        label: "破架-preDefense增防",
        trigger: "preDefense",
        active: true,
        script: `
          game.testLog.push({ stage: "preDefense", isBroken: args.isBroken, stanceActive: S.martial.stanceActive, blockTotal: S.combat.blockTotal, moveId: move?.id, lvl: move?.computedLevel });
          if (args.isBroken) {
            S.combat.defWaigongTotal += 12;
          }
        `
      },
      {
        label: "破架-preTake减伤",
        trigger: "preTake",
        active: true,
        script: `
          game.testLog.push({ stage: "preTake", isBroken: args.isBroken, calcDamage: args.calcDamage });
          if (args.isBroken) {
            args.output.damage = 1;
          }
        `
      },
      {
        label: "破架-damaged后效",
        trigger: "damaged",
        active: true,
        script: `
          if (args.isBroken) {
            game.testLog.push({ stage: "damaged-broken", isBroken: args.isBroken, hpLost: args.hpLost, stanceMoveId: move?.id, argsMoveId: args.move?.id, stanceLevel: move?.computedLevel });
          }
        `
      },
      {
        label: "常规格挡成功守卫",
        trigger: "damaged",
        active: true,
        script: `
          if (!Macros.checkStance(actor, args)) return;
          game.testLog.push({ stage: "damaged-normal-guard" });
        `
      }
    ]
  };
  const stanceItem = makeWuxueItem({ id: "wuxue-def", name: "测试防御武学", moves: [stanceMove] });
  const traitItem = Object.assign(new globalThis.Item(), {
    id: "trait-def",
    uuid: "Item.trait-def",
    name: "测试防御特性",
    type: "trait",
    system: {
      scripts: [{
        label: "特性-验证攻击招式还原",
        trigger: "damaged",
        active: true,
        script: `game.testLog.push({ stage: "trait-damaged", atkMoveId: args.move?.id, isBroken: args.isBroken });`
      }]
    }
  });
  const targetActor = makeActor({
    id: "def-1",
    name: "防御侠",
    hp: 100,
    baseDefWaigong: 5,
    stanceBlock: 20,
    kanpo: 35,
    stanceItem,
    stanceMoveId: stanceMove.id,
    stanceActive: true,
    items: [traitItem]
  });
  // 挂载一个绑定架招的特效（应被 stopStance 移除）与一个普通 AE（应保留，且在架招脚本后读取已还原的攻击招式）
  targetActor.effects.push(
    makeEffectDoc({
      name: "架招护体",
      flags: { "xjzl-system": { slug: "stance_guard", tiedToStance: true } }
    }, "ae-tied"),
    makeEffectDoc({
      name: "常驻受击验证AE",
      flags: {
        "xjzl-system": {
          slug: "ae_verify_move_restore",
          scripts: [{
            label: "AE-验证攻击招式还原",
            trigger: "damaged",
            active: true,
            script: `game.testLog.push({ stage: "ae-damaged", atkMoveId: args.move?.id, isBroken: args.isBroken });`
          }]
        }
      }
    }, "ae-verify")
  );

  const attacker = makeActor({ id: "atk-1", name: "攻击侠" });
  const atkMove = { id: "feint-1", name: "破架虚招", type: "feint", element: "none", damageType: "waigong" };
  const atkItem = makeAttackItem(atkMove);

  const targetToken = {
    id: "tok-def-1",
    uuid: "Scene.s1.Token.tok-def-1",
    name: "防御侠",
    actor: targetActor,
    document: { uuid: "Scene.s1.Token.tok-def-1", documentName: "Token" },
    texture: { src: "icons/token.png" }
  };

  const safeKey = targetToken.uuid.replaceAll(".", "_");
  const message = makeChatMessage({
    id: "msg-auto",
    flags: {
      moveId: atkMove.id,
      damage: 40,
      damageType: "waigong",
      canCrit: true,
      feintResults: { [safeKey]: "broken" }
    },
    hitResults: [{ uuid: targetToken.uuid, isHit: true, dieUsed: 10 }]
  });

  await ChatCardManager._applyDamage(attacker, atkItem, message.flags["xjzl-system"], [targetToken], message);

  // 1. 架招已解除、格挡已清零、绑定特效已移除、破防状态已挂上、光环已清理
  assert.equal(targetActor.system.martial.stanceActive, false);
  assert.equal(targetActor.system.martial.stance, "");
  assert.equal(targetActor.system.martial.stanceItemId, "");
  assert.equal(targetActor.system.combat.blockTotal, 0);
  assert.equal(targetActor.effects.some(e => e.getFlag("xjzl-system", "slug") === "stance_guard"), false);
  assert.equal(targetActor.effects.some(e => e.getFlag("xjzl-system", "slug") === "pofang"), true);
  assert.equal(auraDismissCalls.length, 1);

  // 2. 破架三个阶段脚本均按顺序触发，preDefense 动态加防(5+12=17 -> calcDamage=40-17=23)参与了减伤，
  //    preTake 将伤害压至 1，damaged 前后（Trait / AE）的 args.move 仍为攻击招式 feint-1，仅架招段临时注入 stance-1
  assert.deepEqual(log, [
    { stage: "preDefense", isBroken: true, stanceActive: false, blockTotal: 0, moveId: "stance-1", lvl: 3 },
    { stage: "preTake", isBroken: true, calcDamage: 23 },
    { stage: "trait-damaged", atkMoveId: "feint-1", isBroken: true },
    { stage: "damaged-broken", isBroken: true, hpLost: 1, stanceMoveId: "stance-1", argsMoveId: "stance-1", stanceLevel: 3 },
    { stage: "ae-damaged", atkMoveId: "feint-1", isBroken: true }
  ]);
  assert.equal(targetActor.system.resources.hp.value, 99);
});

test("Shift 手动结算（人物与野兽）：勾选强制破架时同样走 _applyStanceBreak 并触发原架招破架脚本", async () => {
  resetMocks();
  const log = [];
  game.testLog = log;

  const makeStanceTarget = id => {
    const stanceMove = {
      id: "stance-manual",
      name: "手动破架招",
      type: "stance",
      computedLevel: 2,
      scripts: [
        {
          label: "被破记录",
          trigger: "damaged",
          active: true,
          script: `
            if (args.isBroken) game.testLog.push({ actor: actor.uuid, moveId: move?.id, lvl: move?.computedLevel });
          `
        },
        {
          label: "格挡守卫",
          trigger: "damaged",
          active: true,
          script: `
            if (!Macros.checkStance(actor, args)) return;
            game.testLog.push({ guardTriggered: true });
          `
        }
      ]
    };
    const item = makeWuxueItem({ id: `item-${id}`, name: "测试手动武学", moves: [stanceMove] });
    return makeActor({ id, name: id, hp: 50, stanceBlock: 10, stanceItem: item, stanceMoveId: stanceMove.id, stanceActive: true });
  };

  const origPrompt = ChatCardManager._promptManualConfig;
  try {
    ChatCardManager._promptManualConfig = async () => ({
      damageMod: 0,
      forceHit: true,
      isCrit: false,
      applyCritDamage: false,
      isBroken: true,
      ignoreBlock: false,
      ignoreDefense: false,
      ignoreStance: false
    });

    // A. 人物手动结算
    const targetHuman = makeStanceTarget("manual-human");
    game.user.targets = new Set([{ document: { uuid: "Scene.s1.Token.mh", name: "人目标", actor: targetHuman } }]);
    const attacker = makeActor({ id: "atk-m", name: "手动攻" });
    const atkMove = { id: "real-1", name: "实招", type: "real", element: "none" };
    const atkItem = makeAttackItem(atkMove);
    const msgHuman = makeChatMessage({
      id: "msg-mh",
      flags: { moveId: atkMove.id, damage: 15, damageType: "waigong" }
    });
    await ChatCardManager._handleManualDamage(attacker, atkItem, msgHuman.flags["xjzl-system"], msgHuman);

    assert.equal(targetHuman.system.martial.stanceActive, false);
    assert.deepEqual(log, [{ actor: "Actor.manual-human", moveId: "stance-manual", lvl: 2 }]);

    // B. 野兽手动结算（有伤害）
    log.length = 0;
    const targetBeastVictim = makeStanceTarget("manual-creature-victim");
    game.user.targets = new Set([{ document: { uuid: "Scene.s1.Token.mc", name: "兽目标", actor: targetBeastVictim } }]);
    const beast = makeActor({ id: "beast-1", name: "猛虎" });
    const msgBeast = makeChatMessage({
      id: "msg-mc",
      flags: {
        isCreatureAttack: true,
        moveId: "creature-attack",
        damage: 12,
        damageType: "waigong",
        creatureAbility: { name: "扑咬", hasDamage: true }
      }
    });
    await ChatCardManager._handleManualCreatureDamage(beast, null, msgBeast.flags["xjzl-system"], msgBeast);

    assert.equal(targetBeastVictim.system.martial.stanceActive, false);
    assert.deepEqual(log, [{ actor: "Actor.manual-creature-victim", moveId: "stance-manual", lvl: 2 }]);

    // C. 野兽手动结算（无伤害控制能力）：仍解除架招并挂破防
    const targetNoDmg = makeStanceTarget("manual-creature-nodmg");
    game.user.targets = new Set([{ document: { uuid: "Scene.s1.Token.mc2", name: "控目标", actor: targetNoDmg } }]);
    const msgBeastNoDmg = makeChatMessage({
      id: "msg-mc2",
      flags: {
        isCreatureAttack: true,
        moveId: "creature-attack",
        damage: 0,
        damageType: "waigong",
        creatureAbility: { name: "震慑", hasDamage: false }
      }
    });
    await ChatCardManager._handleManualCreatureDamage(beast, null, msgBeastNoDmg.flags["xjzl-system"], msgBeastNoDmg);
    assert.equal(targetNoDmg.system.martial.stanceActive, false);
    assert.equal(targetNoDmg.effects.some(e => e.getFlag("xjzl-system", "slug") === "pofang"), true);
  } finally {
    ChatCardManager._promptManualConfig = origPrompt;
  }
});

test("未破架对照：isBroken=false 时即使误传 brokenStance，格挡成功脚本只执行一次且不触发破架", async () => {
  resetMocks();
  const log = [];
  game.testLog = log;

  const stanceMove = {
    id: "stance-normal",
    name: "常态架招",
    type: "stance",
    computedLevel: 1,
    scripts: [
      {
        label: "preDefense探测",
        trigger: "preDefense",
        active: true,
        script: `game.testLog.push({ stage: "preDefense", isBroken: args.isBroken });`
      },
      {
        label: "破架分支",
        trigger: "damaged",
        active: true,
        script: `if (args.isBroken) game.testLog.push({ stage: "broken" });`
      },
      {
        label: "格挡分支",
        trigger: "damaged",
        active: true,
        script: `if (Macros.checkStance(actor, args)) game.testLog.push({ stage: "guarded" });`
      }
    ]
  };
  const stanceItem = makeWuxueItem({ id: "wuxue-n", name: "常态武学", moves: [stanceMove] });
  const targetActor = makeActor({
    id: "def-normal",
    name: "稳守侠",
    hp: 100,
    stanceBlock: 10,
    stanceItem,
    stanceMoveId: stanceMove.id,
    stanceActive: true
  });

  await targetActor.applyDamage({
    amount: 25,
    type: "waigong",
    isHit: true,
    isBroken: false,
    brokenStance: { itemId: stanceItem.id, moveId: stanceMove.id }
  });

  assert.equal(targetActor.system.martial.stanceActive, true);
  assert.equal(targetActor.system.resources.hp.value, 85); // 25 - 10 = 15
  assert.deepEqual(log, [
    { stage: "preDefense", isBroken: false },
    { stage: "guarded" }
  ]);
});

test("白名单隔离、未领悟校验、闪避隔离、dying/death 补收与防重入", async () => {
  resetMocks();
  const log = [];
  game.testLog = log;

  const stanceMove = {
    id: "stance-iso",
    name: "隔离测试架招",
    type: "stance",
    computedLevel: 1,
    scripts: [
      { label: "passive", trigger: "passive", active: true, script: `game.testLog.push("passive");` },
      { label: "avoided", trigger: "avoided", active: true, script: `game.testLog.push("avoided");` },
      { label: "attack", trigger: "attack", active: true, script: `game.testLog.push("attack");` },
      { label: "resourceChanged", trigger: "resourceChanged", active: true, script: `game.testLog.push("resourceChanged");` },
      { label: "dying", trigger: "dying", active: true, script: `game.testLog.push({ stage: "dying", isBroken: args.isBroken });` },
      { label: "death", trigger: "death", active: true, script: `game.testLog.push({ stage: "death", isBroken: args.isBroken });` },
      {
        label: "damaged嵌套反伤",
        trigger: "damaged",
        active: true,
        script: `
          if (args.isBroken) {
            game.testLog.push({ stage: "damaged", amount: args.finalDamage });
            // 破架脚本内部对自身发起嵌套伤害：不得再携带 brokenStance 重入触发
            if (!actor._nestedDone) {
              actor._nestedDone = true;
              await actor.applyDamage({ amount: 5, type: "waigong", isHit: true, source: "extra" });
            }
          }
        `
      }
    ]
  };
  const unlearnedMove = {
    id: "stance-unlearned",
    name: "未领悟架招",
    type: "stance",
    computedLevel: 0,
    scripts: [{ label: "damaged", trigger: "damaged", active: true, script: `game.testLog.push("unlearned");` }]
  };
  const stanceItem = makeWuxueItem({ id: "wuxue-iso", name: "隔离武学", moves: [stanceMove, unlearnedMove] });
  const target = makeActor({
    id: "def-iso",
    name: "隔离侠",
    hp: 20,
    mp: 1,
    stanceItem,
    stanceMoveId: stanceMove.id,
    stanceActive: false // 已由 stopStance() 清空
  });
  const brokenStance = { itemId: stanceItem.id, moveId: stanceMove.id };

  // 1. collectScripts 隔离：非受击破架白名单与未领悟招式均不收集
  for (const trig of [
    SCRIPT_TRIGGERS.PASSIVE,
    SCRIPT_TRIGGERS.AVOIDED,
    SCRIPT_TRIGGERS.ATTACK,
    SCRIPT_TRIGGERS.HIT,
    SCRIPT_TRIGGERS.RESOURCE_CHANGED
  ]) {
    assert.equal(target.collectScripts(trig, null, { brokenStance }).length, 0, `${trig} 不补收 brokenStance`);
  }
  assert.equal(
    target.collectScripts(SCRIPT_TRIGGERS.DAMAGED, null, {
      brokenStance: { itemId: stanceItem.id, moveId: unlearnedMove.id }
    }).length,
    0,
    "未领悟架招不补收"
  );

  // 2. 未命中（AVOIDED）即使带 isBroken + brokenStance 也不补收
  await target.applyDamage({
    amount: 30,
    type: "waigong",
    isHit: false,
    isBroken: true,
    brokenStance
  });
  assert.deepEqual(log, []);

  // 3. 致命破架伤害：触发 dying + death + 单次 damaged（内部嵌套 applyDamage 不重入）
  await target.applyDamage({
    amount: 50,
    type: "waigong",
    isHit: true,
    isBroken: true,
    brokenStance
  });

  // 4. 多段攻击第二跳：isBroken=true 但不传 brokenStance，不再触发破架脚本
  await target.applyDamage({
    amount: 10,
    type: "waigong",
    isHit: true,
    isBroken: true
  });

  assert.deepEqual(log, [
    { stage: "dying", isBroken: true },
    { stage: "death", isBroken: true },
    { stage: "damaged", amount: 50 }
  ]);

  // 5. 未破架致命伤害对照：dying 显式收到 isBroken === false；
  //    进入濒死时会触发系统自动 stopStance()，随后的 death 阶段由普通特性验证同样收到 isBroken === false
  log.length = 0;
  const deathProbeTrait = Object.assign(new globalThis.Item(), {
    id: "trait-death-probe",
    uuid: "Item.trait-death-probe",
    name: "死亡探针特性",
    type: "trait",
    system: {
      scripts: [{
        label: "death探针",
        trigger: "death",
        active: true,
        script: `game.testLog.push({ stage: "trait-death", isBroken: args.isBroken });`
      }]
    }
  });
  const nonBrokenTarget = makeActor({
    id: "def-iso-normal",
    name: "未破致死侠",
    hp: 10,
    mp: 1,
    stanceItem,
    stanceMoveId: stanceMove.id,
    stanceActive: true,
    items: [deathProbeTrait]
  });
  await nonBrokenTarget.applyDamage({
    amount: 50,
    type: "waigong",
    isHit: true,
    isBroken: false
  });
  assert.deepEqual(log, [
    { stage: "dying", isBroken: false },
    { stage: "trait-death", isBroken: false }
  ]);
});

test("跨客户端 GM 委托：非 owner 目标 applyDamage 通过 serializeResourceContext 保留 brokenStance", async () => {
  resetMocks();
  const remoteTarget = makeActor({
    id: "remote-def",
    name: "远端目标",
    isOwner: false
  });
  const attacker = makeActor({ id: "remote-atk", name: "本地攻击者" });
  const brokenStance = { itemId: "wuxue-1", moveId: "stance-9" };

  await remoteTarget.applyDamage({
    amount: 20,
    type: "waigong",
    attacker,
    isHit: true,
    isBroken: true,
    brokenStance,
    targetKanpo: 18
  });

  assert.equal(socketCalls.length, 1);
  const [action, targetUuid, payload] = socketCalls[0];
  assert.equal(action, "applyDamage");
  assert.equal(targetUuid, remoteTarget.uuid);
  assert.equal(payload.isBroken, true);
  assert.equal(payload.targetKanpo, 18);
  assert.equal(payload.attackerUuid, attacker.uuid);
  assert.deepEqual(payload.brokenStance, brokenStance);
});

test("阶段二官方武学源数据：5 个二次失效架招在破架流程中均可正确触发", async () => {

  // 1. 易水诀 - 取图奉之：破架后不再受 Macros.checkStance 拦截，成功获得“易水寒”
  {
    resetMocks();
    const yishuiItem = loadWuxue("shenfengbang.json", "易水诀");
    const stanceMove = yishuiItem.system.moves.find(m => m.name === "取图奉之");
    stanceMove.computedLevel = 1;
    const defender = makeActor({
      id: "def-yishui", name: "易水侠", hp: 100,
      stanceItem: yishuiItem, stanceMoveId: stanceMove.id, stanceActive: true
    });
    const attacker = makeActor({ id: "atk-1", name: "攻者" });
    const { brokenStance } = await ChatCardManager._applyStanceBreak(defender, attacker, makeChatMessage());
    await defender.applyDamage({ amount: 20, type: "waigong", attacker, isHit: true, isBroken: true, brokenStance });
    assert.ok(defender.effects.some(e => e.getFlag("xjzl-system", "slug") === "yishui_han"), "破架应获得易水寒");
  }

  // 2. 风云扇 - 舞风翩跹：破架清空 martial.stance 后仍正确添加 2 层乘风
  {
    resetMocks();
    const fengyunItem = loadWuxue("qimen.json", "风云扇");
    const stanceMove = fengyunItem.system.moves.find(m => m.name === "舞风翩跹");
    stanceMove.computedLevel = 1;
    const defender = makeActor({
      id: "def-fengyun", name: "风云侠", hp: 100,
      stanceItem: fengyunItem, stanceMoveId: stanceMove.id, stanceActive: true
    });
    const attacker = makeActor({ id: "atk-2", name: "攻者" });
    const { brokenStance } = await ChatCardManager._applyStanceBreak(defender, attacker, makeChatMessage());
    await defender.applyDamage({ amount: 20, type: "waigong", attacker, isHit: true, isBroken: true, brokenStance });
    const chengfengAdded = addedEffects.filter(x => x.actor === defender && x.effData.flags?.["xjzl-system"]?.slug === "chengfeng");
    assert.equal(chengfengAdded.length, 2, "舞风翩跹破架应叠加 2 次乘风");
  }

  // 3. 灵蛇毒棍 - 毒蛇入穴：从注入 move.computedLevel 读取等级，3 级破架给已有灵蛇毒的攻击者施加 5 回合奇蛇毒
  {
    resetMocks();
    const lingsheItem = loadWuxue("gunfa.json", "灵蛇毒棍");
    const stanceMove = lingsheItem.system.moves.find(m => m.name === "毒蛇入穴");
    stanceMove.computedLevel = 3;
    const defender = makeActor({
      id: "def-lingshe", name: "灵蛇侠", hp: 100,
      stanceItem: lingsheItem, stanceMoveId: stanceMove.id, stanceActive: true
    });
    const attacker = makeActor({ id: "atk-3", name: "毒中者" });
    // 无毒时先施加 1 回合灵蛇毒
    const b1 = (await ChatCardManager._applyStanceBreak(defender, attacker, makeChatMessage())).brokenStance;
    await defender.applyDamage({ amount: 10, type: "waigong", attacker, isHit: true, isBroken: true, brokenStance: b1 });
    const firstPoison = attacker.effects.find(e => e.getFlag("xjzl-system", "slug") === "lingshedu");
    assert.ok(firstPoison, "攻击者无灵蛇毒时应先挂上灵蛇毒");
    assert.equal(firstPoison.duration.value, 1);

    // 重新开启架招并再被已有灵蛇毒的攻击者破架：3 级应挂 3 + (3 - 1) = 5 回合奇蛇毒
    await defender.update({
      "system.martial.stanceActive": true,
      "system.martial.stanceItemId": lingsheItem.id,
      "system.martial.stance": stanceMove.id
    });
    const b2 = (await ChatCardManager._applyStanceBreak(defender, attacker, makeChatMessage())).brokenStance;
    await defender.applyDamage({ amount: 10, type: "waigong", attacker, isHit: true, isBroken: true, brokenStance: b2 });
    const qishedu = attacker.effects.find(e => e.getFlag("xjzl-system", "slug") === "qishedu");
    assert.ok(qishedu, "攻击者已有灵蛇毒时应追加奇蛇毒");
    assert.equal(qishedu.duration.value, 5, "奇蛇毒回合数应按 3 级毒蛇入穴算为 5 回合");
  }

  // 4. 光影刺 - 光影荏苒 & 蕴影：同一 Actor 关联两枚 Token，击破/格挡第 2 枚 Token 时遁光必须锚定第 2 枚 Token 且 payloadItemUuid 指向自身《光影刺》
  {
    resetMocks();
    const guangyingItem = loadWuxue("mingjiao.json", "光影刺");
    const stanceMove = guangyingItem.system.moves.find(m => m.name === "光影荏苒");
    stanceMove.computedLevel = 2;
    const defender = makeActor({
      id: "def-guangying", name: "光影侠", hp: 100,
      stanceItem: guangyingItem, stanceMoveId: stanceMove.id, stanceActive: true
    });
    guangyingItem.parent = defender;
    const tok1Doc = { id: "tok1", uuid: "Scene.s1.Token.tok1", documentName: "Token", actor: defender, parent: { id: "s1" } };
    const tok2Doc = { id: "tok2", uuid: "Scene.s1.Token.tok2", documentName: "Token", actor: defender, parent: { id: "s1" } };
    registry.set(tok1Doc.uuid, tok1Doc);
    registry.set(tok2Doc.uuid, tok2Doc);
    registry.set(guangyingItem.uuid, guangyingItem);
    defender.getActiveTokens = () => [{ document: tok1Doc }, { document: tok2Doc }];

    const attacker = makeActor({ id: "atk-4", name: "攻者" });
    const atkMove = { id: "atk-move", name: "敌人虚招", type: "feint" };
    const atkItem = makeAttackItem(atkMove);
    const targetToken2 = {
      id: "tok2", uuid: tok2Doc.uuid, name: "光影侠分身2",
      actor: defender, document: tok2Doc, texture: { src: "icons/token.png" }
    };
    const safeKey2 = tok2Doc.uuid.replaceAll(".", "_");
    const msg = makeChatMessage({
      id: "msg-gy-2",
      flags: { moveId: atkMove.id, damage: 15, damageType: "waigong", canCrit: false, feintResults: { [safeKey2]: "broken" } },
      hitResults: [{ uuid: tok2Doc.uuid, isHit: true, dieUsed: 10 }]
    });

    await ChatCardManager._applyDamage(attacker, atkItem, msg.flags["xjzl-system"], [targetToken2], msg);
    assert.equal(auraCreates.length, 1, "光影荏苒破架应创建 1 道遁光");
    assert.equal(auraCreates[0].sourceActor, tok2Doc, "同一 Actor 多 Token 下必须定位到实际受击的第 2 枚 Token");
    assert.equal(auraCreates[0].params.payloadItemUuid, guangyingItem.uuid, "payloadItemUuid 必须指向防御者自身的《光影刺》");
    assert.notEqual(auraCreates[0].params.payloadItemUuid, atkItem.uuid);

    // 4b. 蕴影 AE 格挡第 2 枚 Token：同样锚定 tok2Doc
    auraCreates.length = 0;
    await defender.update({
      "system.martial.stanceActive": true,
      "system.martial.stanceItemId": guangyingItem.id,
      "system.martial.stance": stanceMove.id
    });
    const yunyingTpl = guangyingItem.effects.getName("蕴影");
    yunyingTpl.uuid = `${guangyingItem.uuid}.ActiveEffect.yy`;
    yunyingTpl.parent = guangyingItem;
    registry.set(yunyingTpl.uuid, yunyingTpl);
    const yunyingData = yunyingTpl.toObject();
    yunyingData.origin = yunyingTpl.uuid;
    await game.xjzl.api.effects.addEffect(defender, yunyingData);
    await defender.applyDamage({
      amount: 10, type: "waigong", attacker, targetTokenUuid: tok2Doc.uuid,
      isHit: true, isBroken: false
    });
    assert.equal(auraCreates.length, 1, "蕴影格挡成功应创建 1 道遁光");
    assert.equal(auraCreates[0].sourceActor, tok2Doc, "蕴影也应定位到实际受击的第 2 枚 Token");

    // 4c. 显式传了 targetTokenUuid 但目标 Token 已不存在时安全跳过，不回退到第 1 枚 Token
    auraCreates.length = 0;
    await defender.applyDamage({
      amount: 10, type: "waigong", attacker, targetTokenUuid: "Scene.s1.Token.deleted",
      isHit: true, isBroken: false
    });
    assert.equal(auraCreates.length, 0, "已删除 Token 不应错误退回到首枚活动 Token");
  }

  // 5. 刺客列传 - 以衣代首：置于 preDefense 时机，破架瞬间先获得鱼肠防御加成并立即降低本次伤害
  {
    resetMocks();
    const cikeItem = loadWuxue("bishou.json", "刺客列传");
    const stanceMove = cikeItem.system.moves.find(m => m.name === "以衣代首");
    const qiMove = cikeItem.system.moves.find(m => m.name === "鱼肠藏剑");
    stanceMove.computedLevel = 1;
    qiMove.computedLevel = 3; // bonus = 5 + (3 - 1) * 5 = 15
    assert.equal(stanceMove.scripts[0].trigger, "preDefense");
    const defender = makeActor({
      id: "def-cike", name: "刺客侠", hp: 100, baseDefWaigong: 5, stanceBlock: 20,
      stanceItem: cikeItem, stanceMoveId: stanceMove.id, stanceActive: true
    });
    const attacker = makeActor({ id: "atk-5", name: "攻者" });
    const { brokenStance } = await ChatCardManager._applyStanceBreak(defender, attacker, makeChatMessage());
    const dmgRes = await defender.applyDamage({
      amount: 40, type: "waigong", attacker, isHit: true, isBroken: true, brokenStance
    });
    const yuchang = defender.effects.find(e => e.getFlag("xjzl-system", "slug") === "yuchang_buff");
    assert.ok(yuchang, "以衣代首破架应立即获得鱼肠");
    assert.equal(yuchang.getFlag("xjzl-system", "cikeBonus"), 15);
    // 破架后原有架招格挡 20 失效，但 preDefense 获得的鱼肠(防御+15)与基础防御 5 合计 20 立即生效：40 - 20 = 20
    assert.equal(dmgRes.finalDamage, 20, "鱼肠防御加成应在本次受击中即时生效");
  }
});

test("防御侧全受击阶段与延期对抗结算均保留精确的 targetTokenUuid", async () => {
  resetMocks();
  const seen = [];
  game.testLog = seen;

  const probeTrait = Object.assign(new globalThis.Item(), {
    id: "trait-tok-probe",
    uuid: "Item.trait-tok-probe",
    name: "Token探针",
    type: "trait",
    system: {
      scripts: [
        "avoided", "preDefense", "preTake", "dying", "death", "damaged"
      ].map(trig => ({
        label: `probe-${trig}`,
        trigger: trig,
        active: true,
        script: `game.testLog.push({ stage: "${trig}", targetTokenUuid: args.targetTokenUuid });`
      }))
    }
  });

  const defender = makeActor({
    id: "def-tok-probe", name: "探针侠", hp: 10, mp: 1, items: [probeTrait]
  });
  const attacker = makeActor({ id: "atk-tok-probe", name: "攻探针" });
  const tokUuid = "Scene.s1.Token.probe-2";
  const tokDoc = { id: "probe-2", uuid: tokUuid, documentName: "Token", actor: defender };
  registry.set(tokUuid, tokDoc);
  registry.set(attacker.uuid, attacker);

  // 未命中 -> avoided
  await defender.applyDamage({ amount: 20, type: "waigong", attacker, targetTokenUuid: tokUuid, isHit: false });
  // 命中致死 -> preDefense / preTake / dying / death / damaged
  await defender.applyDamage({ amount: 50, type: "waigong", attacker, targetTokenUuid: tokUuid, isHit: true });

  assert.deepEqual(seen, [
    { stage: "avoided", targetTokenUuid: tokUuid },
    { stage: "preDefense", targetTokenUuid: tokUuid },
    { stage: "preTake", targetTokenUuid: tokUuid },
    { stage: "dying", targetTokenUuid: tokUuid },
    { stage: "death", targetTokenUuid: tokUuid },
    { stage: "damaged", targetTokenUuid: tokUuid }
  ]);

  // 延期对抗结算（_executeContestAutomation）向后兼容旧卡：defenderUuid 直接为 Token UUID 时仍有效
  seen.length = 0;
  const defender2 = makeActor({ id: "def-tok-probe-2", name: "对抗目标", hp: 50, items: [probeTrait] });
  const tok2Uuid = "Scene.s1.Token.contest-2";
  const tok2Doc = { id: "contest-2", uuid: tok2Uuid, documentName: "Token", actor: defender2 };
  registry.set(tok2Uuid, tok2Doc);
  await ChatCardManager._executeContestAutomation("attacker", {
    attackerUuid: attacker.uuid,
    defenderUuid: tok2Uuid,
    config: {
      outcome: {
        win: {
          targetDamage: { value: 10, type: "waigong" }
        }
      }
    }
  }, makeChatMessage({ id: "msg-contest" }));
  assert.ok(seen.every(x => x.targetTokenUuid === tok2Uuid) && seen.length > 0, "延期对抗伤害也应保留 targetTokenUuid");
});

test("多 Token 链接角色真实发卡到结算全链路：「司空见惯」对抗卡与豁免卡均保留第 2 枚受击 Token", async () => {
  resetMocks();
  const seen = [];
  game.testLog = seen;

  const probeTrait = Object.assign(new globalThis.Item(), {
    id: "trait-deferred-probe",
    uuid: "Item.trait-deferred-probe",
    name: "延期受击探针",
    type: "trait",
    system: {
      scripts: ["preDefense", "preTake", "damaged"].map(trig => ({
        label: `deferred-${trig}`,
        trigger: trig,
        active: true,
        script: `game.testLog.push({ stage: "${trig}", targetTokenUuid: args.targetTokenUuid, moveName: args.move?.name ?? null });`
      }))
    }
  });

  // 1. 攻击者使用官方《空明掌法 - 司空见惯》（hit 调用 Macros.requestContest({ attacker: actor, defender: args.target, ... })）
  //    对同一链接角色的第 2 枚 Token 发起攻击，经历真实发卡 -> 持久化 -> 对抗结算
  const tushouItem = loadWuxue("tushou.json", "空明掌法");
  const skjgMove = tushouItem.system.moves.find(m => m.name === "司空见惯");
  assert.ok(skjgMove, "tushou.json 应存在「司空见惯」");
  skjgMove.computedLevel = 2;

  const guangyingItem = loadWuxue("mingjiao.json", "光影刺");
  const gyStance = guangyingItem.system.moves.find(m => m.name === "光影荏苒");
  gyStance.computedLevel = 1;

  const attacker = makeActor({ id: "atk-skjg", name: "太极攻者", items: [tushouItem] });
  const defender = makeActor({
    id: "def-skjg",
    name: "多Token受击者",
    hp: 100,
    stanceBlock: 30,
    stanceItem: guangyingItem,
    stanceMoveId: gyStance.id,
    stanceActive: true,
    items: [probeTrait]
  });
  guangyingItem.parent = defender;
  registry.set(guangyingItem.uuid, guangyingItem);
  const yunyingTpl = guangyingItem.effects.getName("蕴影");
  yunyingTpl.uuid = `${guangyingItem.uuid}.ActiveEffect.yy-skjg`;
  yunyingTpl.parent = guangyingItem;
  registry.set(yunyingTpl.uuid, yunyingTpl);
  const yunyingData = yunyingTpl.toObject();
  yunyingData.origin = yunyingTpl.uuid;
  await game.xjzl.api.effects.addEffect(defender, yunyingData);

  const tok1Doc = { id: "tok-1", uuid: "Scene.s1.Token.tok-1", documentName: "Token", name: "分身1", actor: defender };
  const tok2Doc = { id: "tok-2", uuid: "Scene.s1.Token.tok-2", documentName: "Token", name: "分身2", actor: defender };
  defender.getActiveTokens = () => [tok1Doc, tok2Doc];
  registry.set(attacker.uuid, attacker);
  registry.set(defender.uuid, defender);
  registry.set(tushouItem.uuid, tushouItem);
  registry.set(tok1Doc.uuid, tok1Doc);
  registry.set(tok2Doc.uuid, tok2Doc);

  const atkMsg = makeChatMessage({
    id: "msg-skjg-atk",
    flags: {
      moveId: skjgMove.id,
      damage: 25,
      damageType: "neigong",
      canCrit: false
    },
    hitResults: [{ uuid: tok2Doc.uuid, isHit: true, dieUsed: 12 }]
  });

  await ChatCardManager._applyDamage(attacker, tushouItem, atkMsg.flags["xjzl-system"], [tok2Doc], atkMsg);

  // 司空见惯 preDamage 取消默认伤害，hit 发出 1 张 contest-request 卡
  assert.equal(seen.length, 0, "司空见惯延期前不应直接触发受击脚本");
  const contestCard = chatMessages.find(m => m.flags?.["xjzl-system"]?.type === "contest-request");
  assert.ok(contestCard, "司空见惯应在 hit 阶段发出真实对抗请求卡");
  const persistedContestFlags = JSON.parse(JSON.stringify(contestCard.flags["xjzl-system"]));
  assert.equal(persistedContestFlags.defenderUuid, defender.uuid, "对抗卡仍保存 defender Actor UUID");
  assert.equal(persistedContestFlags.targetTokenUuid, tok2Doc.uuid, "对抗卡应同时保存实际受击的第 2 枚 Token UUID");

  // 结算对抗：对抗伤害应准确落到第 2 枚 Token，而非 null 或第 1 枚 Token
  await ChatCardManager._executeContestAutomation("attacker", persistedContestFlags, contestCard);
  assert.deepEqual(seen, [
    { stage: "preDefense", targetTokenUuid: tok2Doc.uuid, moveName: "司空见惯" },
    { stage: "preTake", targetTokenUuid: tok2Doc.uuid, moveName: "司空见惯" },
    { stage: "damaged", targetTokenUuid: tok2Doc.uuid, moveName: "司空见惯" }
  ]);
  // 光影刺 蕴影 格挡成功在第 2 枚 Token 周围生成遁光，而非第 1 枚
  assert.equal(auraCreates.length, 1, "对抗真实结算触发架招蕴影应创建 1 道遁光");
  assert.equal(auraCreates[0].sourceActor, tok2Doc, "蕴影应定位到实际受击的第 2 枚 Token");

  // 2. 豁免请求卡（即使脚本省略 attacker 且未显式传 targetTokenUuid，或目标为非 owner 代理）：
  //    真实 _applyDamage -> hit Macros.requestSave({ target: args.target, ... }) -> _rollSave 结算
  chatMessages.length = 0;
  seen.length = 0;
  auraCreates.length = 0;

  const saveDeferredMove = {
    id: "move-save-deferred",
    name: "测试延期豁免",
    type: "real",
    element: "none",
    damageType: "waigong",
    scripts: [
      {
        label: "拦截默认伤害",
        trigger: "preDamage",
        active: true,
        script: "args.config.skipDamage = true;"
      },
      {
        label: "发起不带attacker的豁免卡与自检定防泄漏验证",
        trigger: "hit",
        active: true,
        script: `
          await Macros.requestSave({
            target: args.target,
            type: "dingli",
            dc: 20,
            label: "延期定力豁免",
            damageOnFail: { value: 15, type: "waigong" }
          });
          // 对攻击者自身发起的检定，绝不能误挂受击目标的 tok2Uuid
          await Macros.requestSave({
            target: actor,
            type: "dingli",
            dc: 12,
            label: "出招者自检定"
          });
        `
      }
    ]
  };
  const saveAtkItem = makeAttackItem(saveDeferredMove);
  const attacker2 = makeActor({ id: "atk-save-2", name: "豁免攻者", items: [saveAtkItem] });
  const remoteDefender = makeActor({ id: "def-save-2", name: "非owner多Token目标", hp: 100, isOwner: false, items: [probeTrait] });
  remoteDefender._nextRollTotal = 5;
  const rTok1 = { id: "rtok-1", uuid: "Scene.s1.Token.rtok-1", documentName: "Token", name: "分身A", actor: remoteDefender };
  const rTok2 = { id: "rtok-2", uuid: "Scene.s1.Token.rtok-2", documentName: "Token", name: "分身B", actor: remoteDefender };
  registry.set(attacker2.uuid, attacker2);
  registry.set(remoteDefender.uuid, remoteDefender);
  registry.set(rTok1.uuid, rTok1);
  registry.set(rTok2.uuid, rTok2);

  const saveAtkMsg = makeChatMessage({
    id: "msg-save-atk",
    flags: { moveId: saveDeferredMove.id, damage: 15, damageType: "waigong", canCrit: false },
    hitResults: [{ uuid: rTok2.uuid, isHit: true, dieUsed: 10 }]
  });
  await ChatCardManager._applyDamage(attacker2, saveAtkItem, saveAtkMsg.flags["xjzl-system"], [rTok2], saveAtkMsg);

  const saveCards = chatMessages.filter(m => m.flags?.["xjzl-system"]?.type === "save-request");
  assert.equal(saveCards.length, 2);
  const targetSaveCard = saveCards[0];
  const selfSaveCard = saveCards[1];
  const persistedSaveFlags = JSON.parse(JSON.stringify(targetSaveCard.flags["xjzl-system"]));
  assert.equal(persistedSaveFlags.targetUuid, remoteDefender.uuid);
  assert.equal(persistedSaveFlags.targetTokenUuid, rTok2.uuid, "即使省略 attacker 且目标是 Proxy，豁免卡仍应保留第 2 枚受击 Token");
  assert.equal(selfSaveCard.flags["xjzl-system"].targetTokenUuid, undefined, "对攻击者自身发起的豁免不应误挂敌方受击 Token");

  // _rollSave 结算时校验 isOwner；切回 owner 模拟拥有者/GM 结算失败豁免伤害
  remoteDefender.isOwner = true;
  await ChatCardManager._rollSave(persistedSaveFlags, targetSaveCard);
  assert.deepEqual(seen, [
    { stage: "preDefense", targetTokenUuid: rTok2.uuid, moveName: null },
    { stage: "preTake", targetTokenUuid: rTok2.uuid, moveName: null },
    { stage: "damaged", targetTokenUuid: rTok2.uuid, moveName: null }
  ]);
});
