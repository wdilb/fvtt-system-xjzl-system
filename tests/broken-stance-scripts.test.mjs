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
globalThis.document = { getElementById: () => null };
globalThis.Roll = class MockRoll {
  static fromData(data) { return data; }
};

const translations = JSON.parse(readFileSync(resolve(root, "lang/zh-cn.json"), "utf8"));
const chatMessages = [];
const notices = [];
const socketCalls = [];
const auraDismissCalls = [];
const statusCalls = [];

globalThis.CONFIG = {
  XJZL: {
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
  xjzl: { api: { effects: {} } }
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
  create: async data => { chatMessages.push(data); return data; }
};

globalThis.fromUuid = async () => null;
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
  const scripts = structuredClone(flags["xjzl-system"]?.scripts ?? []);
  return {
    id,
    name: data.name ?? id,
    origin: data.origin ?? null,
    statuses,
    flags,
    disabled: false,
    isSuppressed: false,
    hasScript: trigger => scripts.some(s => s.trigger === trigger && s.active !== false),
    scripts,
    getFlag(scope, key) {
      return getProperty(this.flags?.[scope], key);
    }
  };
}

function makeWuxueItem({ id, name, moves }) {
  return Object.assign(new globalThis.Item(), {
    id,
    uuid: `Item.${id}`,
    name,
    type: "wuxue",
    system: { category: "wuxue", moves }
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
    }
  });
  return actor;
}

function makeAttackItem(move) {
  return makeWuxueItem({
    id: "item-atk",
    name: "测试进攻武学",
    moves: [move]
  });
}

function makeChatMessage({ id = "msg-1", flags = {}, hitResults = [] } = {}) {
  return {
    id,
    uuid: `ChatMessage.${id}`,
    flags: { "xjzl-system": flags },
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
  statusCalls.length = 0;
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
