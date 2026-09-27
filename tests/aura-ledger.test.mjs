/**
 * 光环账本逻辑 mock 测试。
 *
 * 在 Node 中以最小 Foundry mock 驱动真实的 AuraLedger：门面 addEffect/
 * removeEffect、fromUuid、region flags、Actor effects 全部为可检内存态。
 * 覆盖光环施加、清理、幂等与失败补偿；不模拟 Foundry 文档生命周期，
 * Region 事件派发本身属于实机回归范围。
 *
 * 运行：node tests/aura-ledger.test.mjs
 */

/* -------------------------------------------- */
/*  Foundry 全局 mock（必须先于模块导入）          */
/* -------------------------------------------- */

let idSeq = 0;
globalThis.foundry = {
  utils: {
    randomID: () => `id${(++idSeq).toString(36).padStart(4, "0")}`,
    getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj)
  },
  data: {
    operators: {
      ForcedDeletion: class ForcedDeletion {}
    }
  }
};
globalThis.CONST = {TOKEN_DISPOSITIONS: {HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1}};
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
  async evaluate() { return {total: 0}; }
};
// 与门面 getSlug 的 name 分支口径近似的简化实现（测试数据用 ASCII 名）
String.prototype.slugify = function () {
  return String(this).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
};

/* -------------------------------------------- */
/*  世界状态与 mock 文档                           */
/* -------------------------------------------- */

const registry = new Map();          // uuid → 文档
const tokensByActor = new Map();     // actorUuid → [token]
let effectSeq = 0;
let facadeCalls = {add: 0, remove: 0};

function slugOf(name) {
  return name ? String(name).slugify() : "";
}

function makeEffect({name, slug, stackable = false, maxStacks = Infinity, stacks = 1}) {
  const flags = {"xjzl-system": {}};
  if (slug) flags["xjzl-system"].slug = slug;
  if (stackable) {
    flags["xjzl-system"].stackable = true;
    flags["xjzl-system"].stacks = stacks;
    if (Number.isFinite(maxStacks)) flags["xjzl-system"].maxStacks = maxStacks;
  }
  const eff = {
    id: `src${++effectSeq}`,
    uuid: `ActiveEffect.src${effectSeq}`,
    name,
    flags,
    getFlag(scope, key) { return key.split(".").reduce((o, k) => o?.[k], this.flags[scope]); },
    toObject() {
      return {name: this.name, uuid: this.uuid, flags: JSON.parse(JSON.stringify(this.flags))};
    },
    get stacks() { return this.flags["xjzl-system"].stacks; }
  };
  return eff;
}

function findEffectBySlug(actor, slug) {
  return actor.effects.find(e => {
    const eSlug = e.getFlag("xjzl-system", "slug");
    return eSlug === slug || (!eSlug && slugOf(e.name) === slug);
  });
}

function makeActor(uuid) {
  const actor = {
    uuid,
    name: uuid,
    effects: [],
    applyDamage: async () => {},
    applyHealing: async () => {},
    getRollData: () => ({}),
    getDependentTokens: () => tokensByActor.get(uuid) ?? []
  };
  registry.set(uuid, actor);
  return actor;
}

function makeToken(id, actor, disposition = 0) {
  const token = {
    id,
    uuid: `Scene.scene.Token.${id}`,
    actor,
    disposition,
    regions: []
  };
  registry.set(token.uuid, token);
  if (!tokensByActor.has(actor.uuid)) tokensByActor.set(actor.uuid, []);
  tokensByActor.get(actor.uuid).push(token);
  return token;
}

// 场景：regions 用 Set（#regionLive 以 .has 判活），grid 100px 整格
const scene = {
  id: "scene",
  uuid: "Scene.scene",
  grid: {isGridless: false, getOffset: p => ({i: Math.floor(p.y / 100), j: Math.floor(p.x / 100)})},
  regions: new Set(),
  tokens: new Set()
};

function makeRegion(id, behaviors) {
  const region = {
    id,
    uuid: `Scene.scene.Region.${id}`,
    name: id,
    hidden: false,
    parent: scene,
    shapes: [{type: "grid", offsets: [{i: 0, j: 0}, {i: 0, j: 1}, {i: 0, j: 2}, {i: 1, j: 0}, {i: 1, j: 1}, {i: 1, j: 2}, {i: 2, j: 0}, {i: 2, j: 1}, {i: 2, j: 2}]}],
    behaviors: new Map(behaviors.map(b => [b.id, b])),
    tokens: new Set(),
    flags: {},
    getFlag(scope, key) { return key.split(".").reduce((o, k) => o?.[k], this.flags[scope]); },
    update(upd) {
      if (this.failNextUpdate) {
        this.failNextUpdate = false;
        return Promise.reject(new Error("mock update failure"));
      }
      for (const [path, value] of Object.entries(upd)) {
        const parts = path.split(".");
        let obj = this;
        for (let i = 0; i < parts.length - 1; i++) obj = (obj[parts[i]] ??= {});
        const last = parts[parts.length - 1];
        if (value instanceof globalThis.foundry.data.operators.ForcedDeletion) delete obj[last];
        else obj[last] = value;
      }
      return Promise.resolve();
    }
  };
  for (const b of behaviors) b.region = region;
  registry.set(region.uuid, region);
  scene.regions.add(region.id);
  return region;
}

function makeBehavior(id, system) {
  return {id, type: "xjzlAura", disabled: false, system};
}

function makeItem(uuid, effects) {
  const item = {uuid, effects};
  registry.set(uuid, item);
  return item;
}

// 门面 mock：叠层累加受 maxStacks 钳制；非叠层覆盖（刷新）不叠层
const facade = {
  // 失败注入：下一次 removeEffect 抛出该错误（预清理中止路径测试用）
  failRemove: null,
  // 施加闸门：设置后下一次 addEffect 挂起直至 resolve（写入中途删区测试用）
  addGate: null,
  addEffect: async (actor, data, count) => {
    if (facade.addGate) {
      const gate = facade.addGate;
      facade.addGate = null;
      await gate.promise;
    }
    facadeCalls.add++;
    const slug = data.flags?.["xjzl-system"]?.slug || slugOf(data.name);
    const stackable = Boolean(data.flags?.["xjzl-system"]?.stackable);
    const maxStacks = data.flags?.["xjzl-system"]?.maxStacks ?? Infinity;
    let eff = findEffectBySlug(actor, slug);
    if (!eff) {
      eff = makeEffect({name: data.name, slug, stackable, maxStacks, stacks: stackable ? count : 1});
      actor.effects.push(eff);
    } else if (stackable) {
      eff.flags["xjzl-system"].stacks = Math.min(eff.stacks + count, maxStacks);
    }
    return eff;
  },
  removeEffect: async (actor, slug, amount) => {
    facadeCalls.remove++;
    if (facade.failRemove) {
      const err = facade.failRemove;
      facade.failRemove = null;
      throw err;
    }
    const eff = findEffectBySlug(actor, slug);
    if (!eff) return null;
    if (eff.flags["xjzl-system"].stackable && amount < 1000000) {
      eff.flags["xjzl-system"].stacks = Math.max(0, eff.stacks - amount);
      if (eff.flags["xjzl-system"].stacks <= 0) actor.effects.splice(actor.effects.indexOf(eff), 1);
    } else {
      actor.effects.splice(actor.effects.indexOf(eff), 1);
    }
    return eff;
  }
};

globalThis.game = {
  users: {activeGM: {isSelf: true}},
  combat: null,
  xjzl: {api: {effects: facade}}
};
globalThis.fromUuid = async uuid => registry.get(uuid) ?? null;

/* -------------------------------------------- */
/*  测试驱动助手                                   */
/* -------------------------------------------- */

const {AuraLedger, passesFilter} = await import("../module/region/xjzl-aura-ledger.mjs");

async function enter(region, behavior, token) {
  await AuraLedger.submitEnter({
    behaviorId: behavior.id,
    regionUuid: region.uuid,
    tokenUuid: token.uuid,
    actorUuid: token.actor.uuid
  }, null);
}

async function exitBehavior(region, behavior, token) {
  const snapshots = AuraLedger.ownEntriesOfToken(region, token.id, behavior.id);
  await AuraLedger.submitExit({
    behaviorId: behavior.id,
    regionUuid: region.uuid,
    tokenUuid: token.uuid,
    actorUuid: token.actor.uuid
  }, snapshots, null);
}

async function round(region, behavior, token, roundNo, timing = "tokenRoundStart") {
  await AuraLedger.submitRound({
    behaviorId: behavior.id,
    regionUuid: region.uuid,
    tokenUuid: token.uuid,
    actorUuid: token.actor.uuid,
    timing,
    combatId: game.combat?.id ?? null,
    round: roundNo
  }, null);
}

// 与管理器 #preDeleteCleanup 相同的删除流程：枚举账目逐条释放后移除 region
async function deleteRegion(region) {
  const pending = [];
  for (const {key, tokenId, entry} of AuraLedger.allEntriesOfRegion(region)) {
    pending.push(AuraLedger.submitExit({
      behaviorId: key,
      regionUuid: region.uuid,
      tokenUuid: entry.tokenUuid,
      actorUuid: entry.actorUuid
    }, [{key, tokenId, entry}], null));
  }
  const results = await Promise.allSettled(pending);
  const rejected = results.filter(r => r.status === 'rejected');
  if (rejected.length) {
    throw new AggregateError(rejected.map(r => r.reason), '预清理失败，中止删除（与生产 #preDeleteCleanup 同口径）');
  }
  scene.regions.delete(region.id);
  registry.delete(region.uuid);
  for (const tokens of tokensByActor.values()) {
    for (const t of tokens) t.regions = t.regions.filter(r => r !== region);
  }
}

function payloadOf(item) {
  return {payloadItemUuid: item.uuid, payloadEffectName: item.effects[0].name};
}

let passed = 0;
function ok(cond, label) {
  if (!cond) {
    console.error(`  ✗ ${label}`);
    process.exitCode = 1;
  } else {
    passed++;
    console.log(`  ✓ ${label}`);
  }
}

/* -------------------------------------------- */
/*  1. cleanupOnExit=false：施加不记账，退出不减   */
/* -------------------------------------------- */
{
  console.log("1. cleanupOnExit=false 施加不记账");
  const actor = makeActor("actor1");
  const token = makeToken("t1", actor);
  const item = makeItem("Item.a", [makeEffect({name: "Aura", slug: "aura-a", stackable: true, maxStacks: 9})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: false, enterEnabled: true, ...payloadOf(item)});
  const region = makeRegion("r1", [behavior]);
  token.regions.push(region);

  await enter(region, behavior, token);
  await enter(region, behavior, token);
  ok(findEffectBySlug(actor, "aura-a").stacks === 2, "连续两次 enter 累计两层");
  ok(Object.keys(AuraLedger.getEntriesOfToken(region, "t1")).length === 0, "不建立账目");
  await exitBehavior(region, behavior, token);
  ok(findEffectBySlug(actor, "aura-a").stacks === 2, "exit 不减少层数");
  await deleteRegion(region);
  ok(findEffectBySlug(actor, "aura-a").stacks === 2, "Region 删除也不减少");
}

/* -------------------------------------------- */
/*  2. cleanupOnExit=true：累计贡献，exit 一次移除  */
/* -------------------------------------------- */
{
  console.log("2. cleanupOnExit=true 记账与退出");
  const actor = makeActor("actor2");
  const token = makeToken("t2", actor);
  const item = makeItem("Item.b", [makeEffect({name: "Aura", slug: "aura-b", stackable: true, maxStacks: 9})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(item)});
  const region = makeRegion("r2", [behavior]);
  token.regions.push(region);

  await enter(region, behavior, token);
  await enter(region, behavior, token);
  const entry = AuraLedger.getEntry(region, "t2", "b1");
  ok(entry?.contributedStacks === 2, "贡献累计为 2");
  await exitBehavior(region, behavior, token);
  ok(!findEffectBySlug(actor, "aura-b"), "exit 一次移除全部贡献");
  ok(!AuraLedger.getEntry(region, "t2", "b1"), "账目清除");
}

/* -------------------------------------------- */
/*  3. throttlePerRound：同回合一次，次回合可再施   */
/* -------------------------------------------- */
{
  console.log("3. 节流为进入事件唯一业务门");
  const actor = makeActor("actor3");
  const token = makeToken("t3", actor);
  const item = makeItem("Item.c", [makeEffect({name: "Aura", slug: "aura-c", stackable: true, maxStacks: 9})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, throttlePerRound: true, ...payloadOf(item)});
  const region = makeRegion("r3", [behavior]);
  token.regions.push(region);

  game.combat = {id: "c1", round: 1};
  await enter(region, behavior, token);
  await enter(region, behavior, token);
  ok(findEffectBySlug(actor, "aura-c").stacks === 1, "同回合重复进入只施加一次");
  game.combat = {id: "c1", round: 2};
  await enter(region, behavior, token);
  ok(findEffectBySlug(actor, "aura-c").stacks === 2, "下一回合可再次施加");
  game.combat = null;
  await enter(region, behavior, token);
  ok(findEffectBySlug(actor, "aura-c").stacks === 3, "战斗外不节流");
  // 节流命中不建账目：战斗内首次进入前无账目（命中路径本身不创建）
  game.combat = null;
}

/* -------------------------------------------- */
/*  4. 回合挂载：可叠层逐轮 +1；非叠层每轮仍施加    */
/* -------------------------------------------- */
{
  console.log("4. 回合挂载");
  const actor = makeActor("actor4");
  const token = makeToken("t4", actor);
  const stackItem = makeItem("Item.d", [makeEffect({name: "Stacky", slug: "stacky", stackable: true, maxStacks: 9})]);
  const flatItem = makeItem("Item.e", [makeEffect({name: "Flat", slug: "flat"})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, roundEnabled: true, roundTiming: "tokenRoundStart",
    roundAction: {kind: "effect"}, ...payloadOf(stackItem)});
  const behavior2 = makeBehavior("b2", {cleanupOnExit: true, roundEnabled: true, roundTiming: "tokenRoundStart",
    roundAction: {kind: "effect"}, ...payloadOf(flatItem)});
  const region = makeRegion("r4", [behavior, behavior2]);
  token.regions.push(region);
  game.combat = {id: "c1", round: 1};

  const addBefore = facadeCalls.add;
  await round(region, behavior, token, 1);
  await round(region, behavior, token, 2);
  await round(region, behavior, token, 3);
  ok(findEffectBySlug(actor, "stacky").stacks === 3, "可叠层每轮 +1 层");
  await round(region, behavior2, token, 1);
  await round(region, behavior2, token, 2);
  await round(region, behavior2, token, 3);
  ok(facadeCalls.add - addBefore === 6, "非叠层每轮仍调用 addEffect（覆盖刷新）");
  ok((findEffectBySlug(actor, "flat")?.flags["xjzl-system"].stacks ?? 1) === 1, "非叠层不叠层");
  await exitBehavior(region, behavior, token);
  await exitBehavior(region, behavior2, token);
  ok(!findEffectBySlug(actor, "stacky") && !findEffectBySlug(actor, "flat"), "退出按贡献释放");
  game.combat = null;
}

/* -------------------------------------------- */
/*  5. 同回合重复 round 事件只执行一次              */
/* -------------------------------------------- */
{
  console.log("5. 回合事件去重");
  const actor = makeActor("actor5");
  const token = makeToken("t5", actor);
  const item = makeItem("Item.f", [makeEffect({name: "Stacky", slug: "stacky5", stackable: true, maxStacks: 9})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, roundEnabled: true, roundTiming: "tokenRoundStart",
    roundAction: {kind: "effect"}, ...payloadOf(item)});
  const region = makeRegion("r5", [behavior]);
  token.regions.push(region);
  game.combat = {id: "c1", round: 1};
  await round(region, behavior, token, 1);
  await round(region, behavior, token, 1);
  ok(findEffectBySlug(actor, "stacky5").stacks === 1, "同回合重复 round 事件只结算一次");
  game.combat = null;
}

/* -------------------------------------------- */
/*  6. 预存 1 层：光环 +1，退出恢复预存             */
/* -------------------------------------------- */
{
  console.log("6. 预存层数保留");
  const actor = makeActor("actor6");
  const token = makeToken("t6", actor);
  actor.effects.push(makeEffect({name: "Stacky", slug: "stacky6", stackable: true, maxStacks: 9, stacks: 1}));
  const item = makeItem("Item.g", [makeEffect({name: "Stacky", slug: "stacky6", stackable: true, maxStacks: 9})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(item)});
  const region = makeRegion("r6", [behavior]);
  token.regions.push(region);
  await enter(region, behavior, token);
  ok(findEffectBySlug(actor, "stacky6").stacks === 2, "进入后 2 层");
  await exitBehavior(region, behavior, token);
  ok(findEffectBySlug(actor, "stacky6").stacks === 1, "退出恢复预存 1 层");
}

/* -------------------------------------------- */
/*  7. 满层进入：贡献 0 不建账目，退出不减           */
/* -------------------------------------------- */
{
  console.log("7. 满层钳制");
  const actor = makeActor("actor7");
  const token = makeToken("t7", actor);
  actor.effects.push(makeEffect({name: "Stacky", slug: "stacky7", stackable: true, maxStacks: 3, stacks: 3}));
  const item = makeItem("Item.h", [makeEffect({name: "Stacky", slug: "stacky7", stackable: true, maxStacks: 3})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(item)});
  const region = makeRegion("r7", [behavior]);
  token.regions.push(region);
  await enter(region, behavior, token);
  ok(findEffectBySlug(actor, "stacky7").stacks === 3, "满层进入仍为 3 层");
  ok(!AuraLedger.getEntry(region, "t7", "b1"), "差值 0 不建账目");
  await exitBehavior(region, behavior, token);
  ok(findEffectBySlug(actor, "stacky7").stacks === 3, "退出不减层");
}

/* -------------------------------------------- */
/*  8. 预存不可叠层 AE：进出后仍存在                */
/* -------------------------------------------- */
{
  console.log("8. 预存非叠层 AE 保留");
  const actor = makeActor("actor8");
  const token = makeToken("t8", actor);
  actor.effects.push(makeEffect({name: "Flat", slug: "flat8"}));
  const item = makeItem("Item.i", [makeEffect({name: "Flat", slug: "flat8"})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(item)});
  const region = makeRegion("r8", [behavior]);
  token.regions.push(region);
  await enter(region, behavior, token);
  const entry = AuraLedger.getEntry(region, "t8", "b1");
  ok(entry?.existedBeforeAura === true, "接管基线记录为已存在");
  await exitBehavior(region, behavior, token);
  ok(Boolean(findEffectBySlug(actor, "flat8")), "退出后 AE 仍存在");
}

/* -------------------------------------------- */
/*  9. 首建不可叠层：最后 owner 退出后删除           */
/* -------------------------------------------- */
{
  console.log("9. 光环首建非叠层，owner 全退后删除");
  const actor = makeActor("actor9");
  const token = makeToken("t9", actor);
  const item = makeItem("Item.j", [makeEffect({name: "Flat", slug: "flat9"})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(item)});
  const region = makeRegion("r9", [behavior]);
  token.regions.push(region);
  await enter(region, behavior, token);
  ok(Boolean(findEffectBySlug(actor, "flat9")), "施加成功");
  await exitBehavior(region, behavior, token);
  ok(!findEffectBySlug(actor, "flat9"), "唯一 owner 退出后删除");
}

/* -------------------------------------------- */
/*  10. 两个 cleanup owner 共享非叠层 AE            */
/* -------------------------------------------- */
{
  console.log("10. 双 owner 共享非叠层 AE");
  const actor = makeActor("actor10");
  const tokenA = makeToken("t10a", actor);
  const tokenB = makeToken("t10b", actor);
  const item = makeItem("Item.k", [makeEffect({name: "Flat", slug: "flat10"})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(item)});
  const behavior2 = makeBehavior("b2", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(item)});
  const region = makeRegion("r10", [behavior, behavior2]);
  tokenA.regions.push(region);
  tokenB.regions.push(region);
  await enter(region, behavior, tokenA);
  await enter(region, behavior2, tokenB);
  ok(findEffectBySlug(actor, "flat10") && AuraLedger.getEntry(region, "t10b", "b2")?.existedBeforeAura === false,
    "第二 owner 入组并继承基线（组内自建非预存 → false，最后退出即删）");
  await exitBehavior(region, behavior, tokenA);
  ok(Boolean(findEffectBySlug(actor, "flat10")), "退出一个 owner 仍保留");
  await exitBehavior(region, behavior2, tokenB);
  ok(!findEffectBySlug(actor, "flat10"), "最后一个 owner 退出才删除");
}

/* -------------------------------------------- */
/*  11. existedBeforeAura=true 的多 owner 组          */
/* -------------------------------------------- */
{
  console.log("11. 预存 AE 的多 owner 组全退仍保留");
  const actor = makeActor("actor11");
  const tokenA = makeToken("t11a", actor);
  const tokenB = makeToken("t11b", actor);
  actor.effects.push(makeEffect({name: "Flat", slug: "flat11"}));
  const item = makeItem("Item.l", [makeEffect({name: "Flat", slug: "flat11"})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(item)});
  const behavior2 = makeBehavior("b2", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(item)});
  const region = makeRegion("r11", [behavior, behavior2]);
  tokenA.regions.push(region);
  tokenB.regions.push(region);
  await enter(region, behavior, tokenA);
  await enter(region, behavior2, tokenB);
  await exitBehavior(region, behavior, tokenA);
  await exitBehavior(region, behavior2, tokenB);
  ok(Boolean(findEffectBySlug(actor, "flat11")), "预存 AE 在整组退出后保留");
}

/* -------------------------------------------- */
/*  12. 关联 Actor 多 Token owner 独立、AE 共享       */
/* -------------------------------------------- */
{
  console.log("12. 关联 Actor 多 Token / 非关联互不影响");
  const actor = makeActor("actor12");
  const linkedA = makeToken("t12a", actor);
  const linkedB = makeToken("t12b", actor);
  const other = makeActor("actor-other");
  const otherToken = makeToken("t12c", other);
  const item = makeItem("Item.m", [makeEffect({name: "Flat", slug: "flat12"})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(item)});
  const region = makeRegion("r12", [behavior]);
  linkedA.regions.push(region);
  linkedB.regions.push(region);
  await enter(region, behavior, linkedA);
  await enter(region, behavior, linkedB);
  ok(findEffectBySlug(actor, "flat12") && (findEffectBySlug(actor, "flat12").flags["xjzl-system"].stacks ?? 1) === 1,
    "两个 owner 共享一条非叠层 AE");
  await enter(region, behavior, otherToken);
  await exitBehavior(region, behavior, otherToken);
  ok(!findEffectBySlug(other, "flat12"), "非关联 Token 独立施加与清理");
  await exitBehavior(region, behavior, linkedA);
  ok(Boolean(findEffectBySlug(actor, "flat12")), "一个 Token 退出 AE 保留");
  await exitBehavior(region, behavior, linkedB);
  ok(!findEffectBySlug(actor, "flat12"), "最后一个 Token 退出后删除");
}

/* -------------------------------------------- */
/*  13. includeSelf=false 按 Actor 排除              */
/* -------------------------------------------- */
{
  console.log("13. includeSelf 按 Actor UUID");
  const actor = makeActor("actor13");
  const sourceToken = makeToken("t13src", actor, 1);
  const twinToken = makeToken("t13twin", actor, 1);
  const enemyActor = makeActor("actor-enemy");
  const enemyToken = makeToken("t13e", enemyActor, -1);
  const item = makeItem("Item.n", [makeEffect({name: "Buff", slug: "buff13"})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, includeSelf: false, ...payloadOf(item)});
  ok(passesFilter(behavior.system, sourceToken, sourceToken) === false, "源 Token 被排除");
  ok(passesFilter(behavior.system, twinToken, sourceToken) === false, "同一 Actor 的另一关联 Token 视为自身");
  ok(passesFilter(behavior.system, enemyToken, sourceToken) === true, "其他 Actor 通过过滤");
}

/* -------------------------------------------- */
/*  14. 同名异 slug 不碰撞                          */
/* -------------------------------------------- */
{
  console.log("14. 同名异 slug 不碰撞");
  const actor = makeActor("actor14");
  const token = makeToken("t14", actor);
  const itemA = makeItem("Item.o", [makeEffect({name: "IronWall", slug: "ironwall-a"})]);
  const itemB = makeItem("Item.p", [makeEffect({name: "IronWall", slug: "ironwall-b"})]);
  const behaviorA = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(itemA)});
  const behaviorB = makeBehavior("b2", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(itemB)});
  const region = makeRegion("r14", [behaviorA, behaviorB]);
  token.regions.push(region);
  await enter(region, behaviorA, token);
  await enter(region, behaviorB, token);
  ok(Boolean(findEffectBySlug(actor, "ironwall-a") && findEffectBySlug(actor, "ironwall-b")),
    "两个同名效果各自施加");
  await exitBehavior(region, behaviorA, token);
  ok(!findEffectBySlug(actor, "ironwall-a") && Boolean(findEffectBySlug(actor, "ironwall-b")),
    "退出只移除各自的 slug");
  await exitBehavior(region, behaviorB, token);
  ok(!findEffectBySlug(actor, "ironwall-b"), "第二个效果正常清理");
}

/* -------------------------------------------- */
/*  15. 删区/删 Token/停用/在途删除 无残留            */
/* -------------------------------------------- */
{
  console.log("15. 各类删除路径无残留");
  // 15a：region 删除预清理
  const actorA = makeActor("actor15a");
  const tokenA = makeToken("t15a", actorA);
  const itemA = makeItem("Item.q", [makeEffect({name: "Flat", slug: "flat15a"})]);
  const behaviorA = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(itemA)});
  const regionA = makeRegion("r15a", [behaviorA]);
  tokenA.regions.push(regionA);
  await enter(regionA, behaviorA, tokenA);
  await deleteRegion(regionA);
  ok(!findEffectBySlug(actorA, "flat15a"), "region 删除预清理释放贡献");

  // 15b：Token 已删除时经账目 actorUuid 清理
  const actorB = makeActor("actor15b");
  const tokenB = makeToken("t15b", actorB);
  const itemB = makeItem("Item.r", [makeEffect({name: "Flat", slug: "flat15b"})]);
  const behaviorB = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(itemB)});
  const regionB = makeRegion("r15b", [behaviorB]);
  tokenB.regions.push(regionB);
  await enter(regionB, behaviorB, tokenB);
  // Token 删除：从注册表与 Actor 依赖表移除
  registry.delete(tokenB.uuid);
  tokensByActor.set(actorB.uuid, tokensByActor.get(actorB.uuid).filter(t => t !== tokenB));
  await deleteRegion(regionB);
  ok(!findEffectBySlug(actorB, "flat15b"), "Token 删除后经账目 actorUuid 仍完成清理");

  // 15c：行为 disabled 翻转（核心派发对称 exit）后退出释放
  const actorC = makeActor("actor15c");
  const tokenC = makeToken("t15c", actorC);
  const itemC = makeItem("Item.s", [makeEffect({name: "Flat", slug: "flat15c"})]);
  const behaviorC = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(itemC)});
  const regionC = makeRegion("r15c", [behaviorC]);
  tokenC.regions.push(regionC);
  await enter(regionC, behaviorC, tokenC);
  behaviorC.disabled = true;
  await exitBehavior(regionC, behaviorC, tokenC);
  ok(!findEffectBySlug(actorC, "flat15c"), "停用行为退出仍释放清理");

  // 15d：施加在途删除——队列 FIFO 保证 enter 先施加、预清理随后释放
  const actorD = makeActor("actor15d");
  const tokenD = makeToken("t15d", actorD);
  const itemD = makeItem("Item.t", [makeEffect({name: "Flat", slug: "flat15d"})]);
  const behaviorD = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(itemD)});
  const regionD = makeRegion("r15d", [behaviorD]);
  tokenD.regions.push(regionD);
  const enterPromise = enter(regionD, behaviorD, tokenD);
  await deleteRegion(regionD);
  await enterPromise;
  ok(!findEffectBySlug(actorD, "flat15d"), "施加在途删除不残留");
}

/* -------------------------------------------- */
/*  16. 预清理与核心重复 exit 不重复减层              */
/* -------------------------------------------- */
{
  console.log("16. 预清理与核心补发 exit 的 eid 幂等（region 不可解析 → 快照重放路径）");
  const actor = makeActor("actor16");
  const token = makeToken("t16", actor);
  const item = makeItem("Item.u", [makeEffect({name: "Stacky", slug: "stacky16", stackable: true, maxStacks: 9})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(item)});
  const region = makeRegion("r16", [behavior]);
  token.regions.push(region);
  await enter(region, behavior, token);
  await enter(region, behavior, token);
  // 预清理捕获快照后释放；核心补发的 exit 携带同一份快照再来一次
  const snapshots = AuraLedger.allEntriesOfRegion(region);
  await deleteRegion(region);
  await AuraLedger.submitExit({
    behaviorId: "b1",
    regionUuid: region.uuid,
    tokenUuid: token.uuid,
    actorUuid: actor.uuid
  }, snapshots, null);
  ok(actor.effects.length === 0, "重复 exit 不重复减层（贡献恰好释放一次）");
}

/* -------------------------------------------- */
/*  17. payload 配置变更：已有 cleanup 账目冻结旧 ref  */
/* -------------------------------------------- */
{
  console.log("17. payload 引用变更冻结至退出");
  const actor = makeActor("actor17");
  const token = makeToken("t17", actor);
  const itemA = makeItem("Item.v", [makeEffect({name: "Old", slug: "old-17"})]);
  const itemB = makeItem("Item.w", [makeEffect({name: "New", slug: "new-17"})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(itemA)});
  const region = makeRegion("r17", [behavior]);
  token.regions.push(region);
  await enter(region, behavior, token);
  behavior.system.payloadItemUuid = itemB.uuid;
  behavior.system.payloadEffectName = itemB.effects[0].name;
  await enter(region, behavior, token);
  ok(!findEffectBySlug(actor, "new-17"), "新引用不施加（账目冻结）");
  ok(Boolean(findEffectBySlug(actor, "old-17")), "旧效果持续保留");
  await exitBehavior(region, behavior, token);
  ok(!findEffectBySlug(actor, "old-17"), "退出清理旧效果");
}

/* -------------------------------------------- */
/*  18. 无自动对账：Region 事件即事实源               */
/* -------------------------------------------- */
{
  console.log("18. 不存在自动对账");
  ok(typeof AuraLedger.reconcileToken === "undefined", "reconcileToken 已删除");
  ok(typeof AuraLedger.reconcile === "undefined", "reconcile 已删除");
  ok(typeof AuraLedger.reconcileCombat === "undefined", "reconcileCombat 已删除");
}


/*  19. 预清理失败中止删除，重试后完成               */
/* -------------------------------------------- */
{
  console.log("19. 预清理失败中止删除，重试后完成");
  const actor = makeActor("actor19");
  const token = makeToken("t19", actor);
  const item = makeItem("Item.x19", [makeEffect({name: "Flat", slug: "flat19"})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(item)});
  const region = makeRegion("r19", [behavior]);
  token.regions.push(region);
  await enter(region, behavior, token);
  facade.failRemove = new Error("injected remove failure");
  let threw = null;
  try { await deleteRegion(region); } catch (err) { threw = err; }
  ok(threw instanceof AggregateError, "预清理失败抛 AggregateError");
  ok(scene.regions.has(region.id), "region 保留（不带着账目一起删）");
  ok(Boolean(findEffectBySlug(actor, "flat19")), "失败时效果仍在（可重试凭据未丢）");
  await deleteRegion(region);
  ok(!scene.regions.has(region.id), "重试后 region 删除");
  ok(!findEffectBySlug(actor, "flat19"), "重试后清理完成无残留");
}

/*  20. cleanupOnExit 开关随 owner 周期冻结           */
/* -------------------------------------------- */
{
  console.log("20. 环内 true→false 冻结至退出");
  const actor = makeActor("actor20");
  const token = makeToken("t20", actor);
  const item = makeItem("Item.x20", [makeEffect({name: "Flat", slug: "flat20"})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, roundEnabled: true,
    roundTiming: "tokenRoundStart", roundAction: {kind: "effect"}, ...payloadOf(item)});
  const region = makeRegion("r20", [behavior]);
  token.regions.push(region);
  game.combat = {id: "c20", round: 1};
  await enter(region, behavior, token);
  behavior.system.cleanupOnExit = false;
  await round(region, behavior, token, 1);
  ok(AuraLedger.getEntry(region, "t20", "b1") !== undefined, "开关关闭后回合施加仍记账（周期内冻结）");
  ok(Boolean(findEffectBySlug(actor, "flat20")), "回合继续施加非叠层 AE");
  await exitBehavior(region, behavior, token);
  ok(!findEffectBySlug(actor, "flat20"), "退出按冻结的清理账目移除（无混合残留）");
  game.combat = null;
}

/*  21. 施加写入中途删区：补偿释放                     */
/* -------------------------------------------- */
{
  console.log("21. 施加写入中途删区经补偿释放");
  const actor = makeActor("actor21");
  const token = makeToken("t21", actor);
  const item = makeItem("Item.x21", [makeEffect({name: "Flat", slug: "flat21"})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(item)});
  const region = makeRegion("r21", [behavior]);
  token.regions.push(region);
  const gate = {};
  gate.promise = new Promise(resolve => { gate.resolve = resolve; });
  facade.addGate = gate;
  const entering = enter(region, behavior, token);
  for (let i = 0; i < 100 && facade.addGate; i++) await new Promise(r => setImmediate(r));
  await deleteRegion(region);
  gate.resolve();
  await entering;
  ok(!findEffectBySlug(actor, "flat21"), "addEffect 完成后账目未及持久化，补偿释放生效");
}


/*  22. 记账写入失败回滚本次施加                      */
/* -------------------------------------------- */
{
  console.log("22. 记账写入失败回滚本次施加");
  const actor = makeActor("actor22");
  const token = makeToken("t22", actor);
  const item = makeItem("Item.x22", [makeEffect({name: "Stacky", slug: "stacky22", stackable: true, maxStacks: 9})]);
  const behavior = makeBehavior("b1", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(item)});
  const region = makeRegion("r22", [behavior]);
  token.regions.push(region);
  // 22a：既有可叠层账目——回滚只撤本次 diff，旧账目保持原值
  await enter(region, behavior, token);
  region.failNextUpdate = true;
  let rejected = null;
  try { await enter(region, behavior, token); } catch (err) { rejected = err; }
  ok(rejected?.message === "mock update failure", "22a 记账失败向调用方传播");
  ok(findEffectBySlug(actor, "stacky22").stacks === 1, "22a 既有账目：本次 diff 已回滚（层数恢复）");
  ok(AuraLedger.getEntry(region, "t22", "b1").contributedStacks === 1, "22a 旧账目贡献保持原值");
  // 22b：新建可叠层账目——回滚整条本次施加
  await exitBehavior(region, behavior, token);
  region.failNextUpdate = true;
  rejected = null;
  try { await enter(region, behavior, token); } catch (err) { rejected = err; }
  ok(rejected?.message === "mock update failure", "22b 记账失败向调用方传播");
  ok(!findEffectBySlug(actor, "stacky22"), "22b 新建可叠层：施加已回滚移除");
  ok(!AuraLedger.getEntry(region, "t22", "b1"), "22b 无残留账目");
  // 22c：新建不可叠层账目——经 owner 释放回滚（含 existedBeforeAura 语义）
  const flatItem = makeItem("Item.y22", [makeEffect({name: "Flat", slug: "flat22"})]);
  const flatBehavior = makeBehavior("b2", {cleanupOnExit: true, enterEnabled: true, ...payloadOf(flatItem)});
  const flatRegion = makeRegion("r22f", [flatBehavior]);
  token.regions.push(flatRegion);
  flatRegion.failNextUpdate = true;
  rejected = null;
  try { await enter(flatRegion, flatBehavior, token); } catch (err) { rejected = err; }
  ok(rejected?.message === "mock update failure", "22c 记账失败向调用方传播");
  ok(!findEffectBySlug(actor, "flat22"), "22c 新建非叠层：施加已按 owner 释放回滚");
  ok(!AuraLedger.getEntry(flatRegion, "t22", "b2"), "22c 无残留账目");
  // 22d：失败传播会阻止直接动作和节流继续执行
  const actionActor = makeActor("actor22action");
  let damageCalls = 0;
  actionActor.applyDamage = async () => { damageCalls++; };
  const actionToken = makeToken("t22action", actionActor);
  const actionBehavior = makeBehavior("b3", {
    cleanupOnExit: true,
    enterEnabled: true,
    throttlePerRound: true,
    enterAction: {kind: "damage", amount: 1, type: "liushi", pierce: false},
    ...payloadOf(flatItem)
  });
  const actionRegion = makeRegion("r22action", [actionBehavior]);
  actionToken.regions.push(actionRegion);
  game.combat = {id: "combat22", round: 1};
  actionRegion.failNextUpdate = true;
  rejected = null;
  try { await enter(actionRegion, actionBehavior, actionToken); } catch (err) { rejected = err; }
  ok(rejected?.message === "mock update failure", "22d 组合结算向调用方传播记账失败");
  ok(!findEffectBySlug(actionActor, "flat22"), "22d AE 已回滚");
  ok(damageCalls === 0, "22d 记账失败后不执行直接动作");
  ok(!AuraLedger.getThrottle(actionRegion, "b3|t22action"), "22d 记账失败后不写节流");
  game.combat = null;
  // 22e：回滚也失败 → AggregateError（状态不一致但保留完整错误）
  region.failNextUpdate = true;
  facade.failRemove = new Error("injected rollback failure");
  let threw = null;
  try { await enter(region, behavior, token); } catch (err) { threw = err; }
  ok(threw instanceof AggregateError, "回滚也失败时抛 AggregateError");
}

/*  23. 非活动 GM 且无 socket：必须拒绝而非假成功        */
/* -------------------------------------------- */
{
  console.log("23. 非活动 GM 无 socket 必须拒绝");
  const prevGM = game.users.activeGM;
  game.users.activeGM = {isSelf: false};
  let rejected = null;
  await AuraLedger.submitEnter({
    behaviorId: "b1", regionUuid: "Scene.scene.Region.none",
    tokenUuid: "Scene.scene.Token.none", actorUuid: "Actor.none"
  }, null).catch(err => { rejected = err; });
  ok(rejected instanceof Error && /socketlib/.test(rejected.message), "无 socket 委托路径显式拒绝");
  game.users.activeGM = prevGM;
}

/* -------------------------------------------- */
console.log(process.exitCode ? "\n存在失败断言" : `\n全部 ${passed} 项断言通过`);
