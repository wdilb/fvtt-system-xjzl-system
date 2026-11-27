/**
 * 延期请求卡来源招式快照回归：真实 requestSave/requestContest，
 * 断言随卡保存的 sourceMove 保留原招式的武器大类与子类型
 * （覆盖非空子类型、显式空串与旧数据缺字段三种形状）。
 * 子类型缺省归一为空串后，结算端经 applyDamage/applyHealing 把 sourceMove
 * 透传为受击脚本的 args.move，脚本按空串沿用无子类型行为。
 *
 * 运行：node --experimental-vm-modules tests/request-source-move.test.mjs
 */

import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Foundry 全局 mock（macros.mjs 只触达这些边界）  */
/* -------------------------------------------- */

globalThis.foundry = {
  applications: { handlebars: { renderTemplate: async () => "mock-template" } }
};
globalThis.CONFIG = {
  XJZL: {
    attributes: { liliang: "XJZL.Attributes.Liliang" },
    skills: {},
    arts: {},
    weaponTypes: { jian: "XJZL.WeaponTypes.Jian" }
  }
};
globalThis.game = {
  user: { id: "user-mock" },
  i18n: { localize: key => key }
};
globalThis.ui = { notifications: { error: () => {} } };

const chatMessages = [];
globalThis.ChatMessage = {
  getSpeaker: ({ actor }) => ({ actor: actor?.name ?? null }),
  create: async data => chatMessages.push(data)
};

const { XJZLMacros } = await import("../module/utils/macros.mjs");

/* -------------------------------------------- */
/*  测试工具                                      */
/* -------------------------------------------- */

let passed = 0;
function pass(label) { console.log(`  ✓ ${++passed}. ${label}`); }

const makeActor = name => ({ name, uuid: `Actor.${name}` });

/** 构造带完整来源招式的延期请求参数。 */
function makeSourceMove(weaponSubtype) {
  return {
    id: "move-1",
    name: "测试招式",
    type: "jingong",
    element: "none",
    damageType: "waigong",
    weaponType: "jian",
    weaponSubtype,
    currentCost: { mp: 2, rage: 0, hp: 0 }
  };
}

/** 读取最近一张卡的系统 flags，并按聊天卡持久化做一次 JSON 往返。 */
function readLastFlags() {
  const flags = chatMessages.at(-1).flags["xjzl-system"];
  return { flags, persisted: JSON.parse(JSON.stringify(flags)) };
}

/* -------------------------------------------- */
/*  用例                                          */
/* -------------------------------------------- */

// 1. requestSave：非空子类型随卡保留，且经持久化往返后仍在
await XJZLMacros.requestSave({
  target: makeActor("target-a"),
  type: "liliang",
  dc: 15,
  attacker: makeActor("attacker-a"),
  item: "Actor.attacker-a.Item.src",
  move: makeSourceMove("软剑"),
  source: "move"
});
{
  const { flags, persisted } = readLastFlags();
  assert.equal(flags.sourceMove.weaponType, "jian");
  assert.equal(flags.sourceMove.weaponSubtype, "软剑");
  assert.equal(persisted.sourceMove.weaponType, "jian", "持久化后武器大类仍在");
  assert.equal(persisted.sourceMove.weaponSubtype, "软剑", "持久化后武器子类型仍在");
  // 结算端读取 flags.sourceMove 后按 ...(sourceMove ? { move: sourceMove } : {}) 透传给
  // applyDamage，受击脚本读到的 args.move 与随卡快照一致
  const settlementMove = persisted.sourceMove ? { move: persisted.sourceMove } : {};
  assert.equal(settlementMove.move?.weaponSubtype, "软剑", "结算透传的 move 保留子类型");
}
pass("requestSave：非空子类型随卡保留并透传到结算端");

// 2. requestSave：显式空串保持空串；旧数据缺字段归一为空串
await XJZLMacros.requestSave({
  target: makeActor("target-b"),
  type: "liliang",
  dc: 15,
  move: makeSourceMove("")
});
{
  const { flags, persisted } = readLastFlags();
  assert.equal(flags.sourceMove.weaponSubtype, "", "显式空串保持空串");
  assert.equal(persisted.sourceMove.weaponSubtype, "", "持久化后仍为空串");
}
await XJZLMacros.requestSave({
  target: makeActor("target-c"),
  type: "liliang",
  dc: 15,
  move: { id: "move-2", name: "旧招式", type: "jingong", weaponType: "quan" }
});
{
  const { flags } = readLastFlags();
  assert.equal(flags.sourceMove.weaponSubtype, "", "旧数据缺字段归一为空串");
}
pass("requestSave：显式空串与缺字段均归一为空串");

// 3. requestContest：非空子类型与显式空串随卡保留
await XJZLMacros.requestContest({
  attacker: makeActor("attacker-c"),
  defender: makeActor("defender-c"),
  type: "neixi",
  item: "Actor.attacker-c.Item.src",
  move: makeSourceMove("重剑")
});
{
  const { flags, persisted } = readLastFlags();
  assert.equal(flags.sourceMove.weaponType, "jian");
  assert.equal(flags.sourceMove.weaponSubtype, "重剑");
  assert.equal(persisted.sourceMove.weaponSubtype, "重剑", "持久化后武器子类型仍在");
}
await XJZLMacros.requestContest({
  attacker: makeActor("attacker-d"),
  defender: makeActor("defender-d"),
  type: "neixi",
  move: makeSourceMove("")
});
{
  const { flags } = readLastFlags();
  assert.equal(flags.sourceMove.weaponSubtype, "", "显式空串保持空串");
}
pass("requestContest：非空子类型与显式空串随卡保留");

// 4. Token / TokenDocument 与显式 targetTokenUuid 持久化保留
const tokDefender = {
  id: "tok-d2",
  uuid: "Scene.s1.Token.tok-d2",
  documentName: "Token",
  name: "目标Token2",
  texture: { src: "icons/tok.png" },
  actor: makeActor("defender-tok")
};
await XJZLMacros.requestSave({
  target: tokDefender,
  type: "liliang",
  dc: 14,
  attacker: makeActor("attacker-e")
});
{
  const { flags, persisted } = readLastFlags();
  assert.equal(persisted.targetUuid, "Actor.defender-tok", "targetUuid 保持 Actor UUID");
  assert.equal(flags.targetTokenUuid, tokDefender.uuid, "传入 TokenDocument 时同步保留 targetTokenUuid");
  assert.equal(persisted.targetTokenUuid, tokDefender.uuid, "持久化往返后 targetTokenUuid 仍在");
}
await XJZLMacros.requestContest({
  attacker: makeActor("attacker-e"),
  defender: makeActor("defender-e"),
  targetTokenUuid: "Scene.s1.Token.explicit-2",
  type: "neixi"
});
{
  const { persisted } = readLastFlags();
  assert.equal(persisted.defenderUuid, "Actor.defender-e");
  assert.equal(persisted.targetTokenUuid, "Scene.s1.Token.explicit-2", "显式传入 targetTokenUuid 应随对抗卡持久化");
}
pass("requestSave / requestContest：TokenDocument 与显式 targetTokenUuid 随卡保留");

console.log(`\n共 ${passed} 组断言通过。`);
