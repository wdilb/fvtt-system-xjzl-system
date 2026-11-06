import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateAttributePoints,
  allocateMoveStages,
  calculateWuxingContribution,
  countLearnedHealing,
  deriveMoveProgress,
  evaluateMoveCompatibility,
  maxMoveStage,
  moveStageChoices,
  normalizeGenerationConfig,
  solveMeridians
} from "../module/utils/character-generation.mjs";
import { XJZLCharacterGenerationManager, evaluateGenerationDraft, loadGenerationCandidates } from "../module/managers/character-generation-manager.mjs";

function wuxueFixture() {
  return {
    _id: "wuxue-1",
    uuid: "Item.wuxue-1",
    name: "测试套路",
    type: "wuxue",
    system: {
      category: "wuxue",
      tier: 1,
      moves: [
        { id: "real", name: "实招", type: "real", progression: { mappedStage: 0 }, scalings: [{ prop: "liliang", ratio: 1 }] },
        { id: "feint", name: "虚招", type: "feint", progression: { mappedStage: 0 } },
        { id: "operation", name: "纳刀", type: "utility", progression: { mappedStage: 5 } }
      ]
    }
  };
}

function neigongFixture(id, name, tier, element, stage = 3) {
  return {
    _id: id,
    uuid: `Item.${id}`,
    name,
    type: "neigong",
    system: { tier, element, stage, config: {} }
  };
}

test("三种招式境界分配保留单招锁定并排除 mappedStage=5", () => {
  const fixture = wuxueFixture();
  const uniform = allocateMoveStages(fixture, { targetStage: 3, strategy: "uniform", locked: { real: 1 }, rng: () => 0 });
  assert.equal(uniform.item.system.moves.find(move => move.id === "real").effectiveStage, 1);
  assert.equal(uniform.item.system.moves.find(move => move.id === "feint").effectiveStage, 3);
  assert.equal(uniform.item.system.moves.find(move => move.id === "operation").effectiveStage, 0);
  assert.equal(maxMoveStage(fixture, fixture.system.moves[0]), 3);
  assert.deepEqual(moveStageChoices(fixture, fixture.system.moves[0]), [1, 2, 3]);
  assert.deepEqual(moveStageChoices(fixture, { ...fixture.system.moves[0], progression: { mappedStage: 3 } }), [3]);

  const core = allocateMoveStages(fixture, { targetStage: 3, strategy: "core", rng: () => 0.99 });
  const independent = allocateMoveStages(fixture, { targetStage: 3, strategy: "independent", rng: () => 0.99 });
  assert.ok(core.item.system.moves.some(move => move.effectiveStage >= 3));
  assert.ok(independent.item.system.moves.some(move => move.effectiveStage >= 3));

  const samePriority = {
    ...fixture,
    system: {
      ...fixture.system,
      moves: [
        { id: "core-a", type: "real", progression: { mappedStage: 0 } },
        { id: "core-b", type: "real", progression: { mappedStage: 0 } }
      ]
    }
  };
  let coreRolls = 0;
  const stableCore = allocateMoveStages(samePriority, {
    targetStage: 3,
    strategy: "core",
    rng: () => (coreRolls++ === 0 ? 0 : 0.99)
  });
  assert.equal(stableCore.core.id, "core-a");

  const conflict = allocateMoveStages(fixture, { targetStage: 2, strategy: "uniform", locked: { real: 3 }, rng: () => 0 });
  assert.ok(conflict.conflicts.some(entry => entry.field === "moves.real"));
});

test("治疗门数按实际已学正式招式统计", () => {
  const items = [
    { name: "未学治疗", system: { category: "wuxue", moves: [{ id: "a", type: "qi", actionType: "heal", computedLevel: 0, progression: { mappedStage: 0 } }] } },
    { name: "辅助治疗", system: { category: "wuxue", moves: [{ id: "b", type: "qi", actionType: "heal", computedLevel: 1, progression: { mappedStage: 5 } }] } },
    { name: "已学治疗", system: { category: "wuxue", moves: [{ id: "c", type: "qi", actionType: "heal", computedLevel: 1, progression: { mappedStage: 0 } }] } }
  ];
  const result = countLearnedHealing(items);
  assert.equal(result.count, 1);
  assert.equal(result.items[0].item.name, "已学治疗");
});

test("悟性按实际境界逐招计算，轻功阵法排除且人地封顶", () => {
  const humanMoves = Array.from({ length: 12 }, (_, index) => ({
    id: `h-${index}`, computedLevel: 1, effectiveStage: 3, progression: { mappedStage: 0 }
  }));
  const result = calculateWuxingContribution([
    { _id: "human", type: "wuxue", system: { category: "wuxue", tier: 1, moves: humanMoves } },
    { _id: "earth", type: "sanshou", system: { category: "sanshou", tier: 2, moves: [{ id: "e", computedLevel: 1, effectiveStage: 3, progression: { mappedStage: 0 } }] } },
    { _id: "heaven", type: "wuxue", system: { category: "wuxue", tier: 3, moves: [{ id: "t", computedLevel: 1, effectiveStage: 4, progression: { mappedStage: 0 } }] } },
    { _id: "ignored", type: "wuxue", system: { category: "qinggong", tier: 1, moves: [{ id: "q", computedLevel: 1, effectiveStage: 4, progression: { mappedStage: 0 } }] } }
  ]);
  assert.equal(result.human, 10);
  assert.equal(result.earth, 1);
  assert.equal(result.heaven, 2);
  assert.equal(result.total, 13);
});

test("经脉资格精确分配到不重复来源并遵守前置", () => {
  const sources = [1, 2, 3].flatMap(tier => [
    { id: `yin-${tier}`, tier, element: "yin" },
    { id: `yin2-${tier}`, tier, element: "yin" },
    { id: `yang-${tier}`, tier, element: "yang" },
    { id: `yang2-${tier}`, tier, element: "yang" }
  ]);
  const full = solveMeridians({
    sources,
    target: { mode: "target", total: 12, yin: 6, yang: 6 },
    rng: () => 0
  });
  assert.equal(full.feasible, true);
  assert.equal(full.selected.length, 12);
  for (const tier of [1, 2, 3]) assert.equal(Object.keys(full.assignments[tier]).length, 4);
  assert.equal(new Set(Object.values(full.assignments).flatMap(group => Object.values(group).map(entry => entry.sourceId))).size, 12);

  const shortage = solveMeridians({
    sources: sources.filter(source => source.id !== "yang2-3"),
    target: { mode: "target", total: 12, yin: 6, yang: 6 }
  });
  assert.equal(shortage.feasible, false);
});

test("相性与属性适配使用三档门槛，未知项显式未评价", () => {
  const run = { system: { element: "yin" } };
  const move = { element: "yin", calculation: { scalings: [{ prop: "liliang", ratio: 2 }, { prop: "shenfa", ratio: 1 }] } };
  const match = evaluateMoveCompatibility(run, move, { matchStandard: "standard", actorStats: { liliang: 2, shenfa: 1 } });
  assert.equal(match.status, "match");
  const strict = evaluateMoveCompatibility({ system: { element: "taiji" } }, { element: "yin", calculation: move.calculation }, { matchStandard: "strict", actorStats: { liliang: 2, shenfa: 1 } });
  assert.equal(strict.status, "mismatch");
  assert.equal(evaluateMoveCompatibility(
    { system: { element: "yin" } }, { element: "yang" }, { matchStandard: "standard" }
  ).status, "mismatch");
  assert.equal(evaluateMoveCompatibility(
    { system: { element: "yin" } }, { element: "yin" }, { matchStandard: "standard" }
  ).status, "unevaluated");
  assert.equal(evaluateMoveCompatibility(run, { element: "none" }).status, "mismatch");
  const noElement = evaluateMoveCompatibility(
    { system: { element: "none" } }, { element: "taiji" }, { matchStandard: "standard" }
  );
  assert.equal(noElement.compatibility, 0);
  assert.equal(noElement.status, "mismatch");
});

test("属性适配分母使用完整直接输出属性集合", () => {
  const result = evaluateMoveCompatibility(
    { system: { element: "yin" } },
    { element: "yin", calculation: { scalings: [{ prop: "neixi", ratio: 1 }] } },
    { matchStandard: "strict", actorStats: { liliang: 70, neixi: 50 } }
  );
  assert.equal(result.scaling, 50 / 70);
  assert.equal(result.status, "mismatch");
});

test("映射境界和零投入招式不能绕过套路目标或单招锁定", () => {
  const item = {
    _id: "mapped-zero",
    type: "wuxue",
    system: {
      tier: 1,
      moves: [{ id: "mapped", type: "real", progression: { mode: "custom", customThresholds: [0, 0, 0], mappedStage: 3 } }]
    }
  };
  const targetConflict = allocateMoveStages(item, { targetStage: 1, strategy: "independent", rng: () => 0 });
  assert.ok(targetConflict.conflicts.some(conflict => conflict.field === "wuxue.mainStage"));
  const lockConflict = allocateMoveStages(item, { targetStage: 1, strategy: "independent", locked: { mapped: 2 }, rng: () => 0 });
  assert.ok(lockConflict.conflicts.some(conflict => conflict.field === "moves.mapped"));
});

test("属性分配总量不超过装备/经脉评估后的实际点池", () => {
  const assigned = allocateAttributePoints({ points: 17, strategy: "balanced" });
  assert.equal(Object.values(assigned).reduce((sum, value) => sum + value, 0), 17);
  const config = normalizeGenerationConfig({
    equipment: { weaponPool: { query: "刀" } },
    wuxue: { fixed: { sanshou: ["Item.sanshou"] } }
  });
  assert.equal(config.equipment.weaponPool.query, "刀");
  assert.deepEqual(config.wuxue.fixed.sanshou, ["Item.sanshou"]);
});

test("均衡属性分配不因自动识别输出属性而偏向单一属性", () => {
  const assigned = allocateAttributePoints({ points: 12, strategy: "balanced", preferred: ["liliang"] });
  assert.deepEqual(assigned, {
    liliang: 2, shenfa: 2, neixi: 2, qigan: 2, shencai: 2, tipo: 2
  });
  const matched = allocateAttributePoints({ points: 3, strategy: "match", preferred: ["liliang"] });
  assert.equal(matched.liliang, 3);
});

test("随机属性分配逐点随机且总量准确", () => {
  const assigned = allocateAttributePoints({ points: 60, strategy: "random", rng: () => 0 });
  assert.equal(Object.values(assigned).reduce((sum, value) => sum + value, 0), 60);
  assert.equal(assigned.liliang, 60);
  assert.equal(Object.values(assigned).filter(value => value > 0).length, 1);
});

test("运行内功与其他已修内功的品阶留空时按随机候选处理", () => {
  const config = normalizeGenerationConfig({
    neigong: {
      runTier: "",
      additionalGroups: [{ count: 2, tier: "", stage: "" }]
    }
  });
  assert.equal(config.neigong.runTier, null);
  assert.equal(config.neigong.additionalGroups[0].tier, null);
  assert.equal(config.neigong.additionalGroups[0].stage, null);
  assert.equal(config.neigong.additionalCount, 2);
  const randomCount = normalizeGenerationConfig({ neigong: { additionalCount: "", additionalGroups: [] } });
  assert.equal(randomCount.neigong.additionalCount, 0);
  assert.equal(randomCount.neigong.additionalRandomMin, 0);
  assert.equal(randomCount.neigong.additionalRandomMax, 3);
  const noAdditional = normalizeGenerationConfig({ neigong: { additionalCount: 0, additionalGroups: [{ count: 1 }] } });
  assert.equal(noAdditional.neigong.additionalCount, 0);
});

test("其他已修内功按总数生成独立指定槽位，零数量不生成", () => {
  const pool = Array.from({ length: 5 }, (_, index) => ({
    _id: `ng-${index}`,
    uuid: `Item.ng-${index}`,
    name: `内功${index}`,
    type: "neigong",
    system: { tier: 1, element: "yin", config: {} }
  }));
  const manager = new XJZLCharacterGenerationManager();
  const base = { pools: { neigong: pool }, conflicts: [] };
  const fixed = normalizeGenerationConfig({ neigong: { runTier: 1, additionalCount: 2, additionalGroups: [{ count: 1 }, { count: 1 }] } });
  assert.equal(manager._selectNeigongs(base, fixed, () => 0).selected.length, 3);
  const fixedWithOneSlot = normalizeGenerationConfig({ neigong: { runTier: 1, additionalCount: 2, additionalGroups: [{ count: 1 }] } });
  assert.equal(manager._selectNeigongs(base, fixedWithOneSlot, () => 0).selected.length, 3);

  const none = normalizeGenerationConfig({ neigong: { runTier: 1, additionalCount: 0, additionalGroups: [{ count: 1 }] } });
  assert.equal(manager._selectNeigongs(base, none, () => 0).selected.length, 1);

  const random = normalizeGenerationConfig({ neigong: { runTier: 1, additionalCount: null } });
  assert.equal(manager._selectNeigongs(base, random, () => 0.99).selected.length, 4);
});

test("内功与其他武学的随机上限分别生效，不被同名表单字段覆盖", () => {
  const neigongPool = Array.from({ length: 10 }, (_, index) => ({
    _id: `random-ng-${index}`,
    uuid: `Item.random-ng-${index}`,
    name: `随机内功${index}`,
    type: "neigong",
    system: { tier: 1, element: "yin", config: {} }
  }));
  const wuxuePool = Array.from({ length: 10 }, (_, index) => ({
    _id: `random-wuxue-${index}`,
    uuid: `Item.random-wuxue-${index}`,
    name: `随机武学${index}`,
    type: "wuxue",
    system: { category: "wuxue", tier: 1, moves: [{ id: `move-${index}`, progression: { mappedStage: 0 } }] }
  }));
  const manager = new XJZLCharacterGenerationManager();
  const neigongConfig = normalizeGenerationConfig({
    neigong: { runTier: 1, additionalCount: 0, additionalRandomMin: 8, additionalRandomMax: 8 }
  });
  const wuxueConfig = normalizeGenerationConfig({
    wuxue: { primary: { tier: 1 }, additionalRandomMin: 8, additionalRandomMax: 8 }
  });
  assert.equal(manager._selectNeigongs({ pools: { neigong: neigongPool }, conflicts: [] }, neigongConfig, () => 0).selected.length, 9);
  assert.equal(manager._selectWuxue({ pools: { wuxue: wuxuePool } }, wuxueConfig, () => 0).selected.length, 9);
});

test("运行内功随机选择不会抢占后续指定的附修内功", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    neigong: { additionalCount: 1, additionalGroups: [{ count: 1, uuids: ["Item.A"] }] }
  });
  const result = manager._selectNeigongs({
    pools: { neigong: [neigongFixture("A", "A", 1, "yin"), neigongFixture("B", "B", 1, "yang")] }, conflicts: []
  }, config, () => 0);
  assert.deepEqual(result.selected.map(item => item.name), ["B", "A"]);
  assert.equal(result.conflicts.length, 0);
});

test("随机运行内功会为后续稀缺品阶槽位保留唯一候选", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    synergyProbability: 0,
    neigong: { additionalCount: 1, additionalGroups: [{ count: 1, tier: 3 }] }
  });
  const result = manager._selectNeigongs({
    pools: {
      neigong: [
        neigongFixture("human-run", "人级运行", 1, "yin"),
        neigongFixture("heaven-only", "唯一天级", 3, "yang")
      ]
    },
    conflicts: []
  }, config, () => 0);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.run.name, "人级运行");
  assert.deepEqual(result.selected.map(item => item.name), ["人级运行", "唯一天级"]);
});

test("运行内功完全自动且配套命中时协调到最终已修功法的最高层次", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    synergyProbability: 100,
    neigong: { additionalCount: 1, additionalGroups: [{ count: 1 }] }
  });
  const decisionRolls = new Map();
  const selection = manager._selectNeigongs({
    pools: {
      neigong: [
        neigongFixture("human-run", "人级运行", 1, "yin"),
        neigongFixture("heaven-run", "天级圆满", 3, "yang")
      ]
    },
    conflicts: []
  }, config, () => 0, decisionRolls);
  const result = manager._coordinateRunNeigong(selection, config, () => 0, decisionRolls);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.run.name, "天级圆满");
  assert.equal(result.selected.find(item => item.name === "天级圆满").system.active, true);
  assert.equal(decisionRolls.has("neigong:run:growth"), true);
});

test("成长协调不会把已经最高层的运行内功降级", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    synergyProbability: 100,
    neigong: { additionalCount: 1, additionalGroups: [{ count: 1 }] }
  });
  const selection = manager._selectNeigongs({
    pools: { neigong: [
      neigongFixture("heaven", "天级运行", 3, "yin"),
      neigongFixture("human", "人级附修", 1, "yang")
    ] }, conflicts: []
  }, config, () => 0, new Map());
  const result = manager._coordinateRunNeigong(selection, config, () => 0, new Map([["neigong:run:growth", 0]]));
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.run.name, "天级运行");
});

test("成长协调不会把指定附修内功改成运行内功", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    synergyProbability: 100,
    neigong: {
      additionalCount: 1,
      additionalGroups: [{ count: 1, tier: 3, stage: 3, uuids: ["Item.heaven"] }]
    }
  });
  const selection = manager._selectNeigongs({
    pools: { neigong: [
      neigongFixture("human", "人级运行", 1, "yin"),
      neigongFixture("heaven", "指定天级附修", 3, "yang")
    ] }, conflicts: []
  }, config, () => 0, new Map());
  const result = manager._coordinateRunNeigong(selection, config, () => 0, new Map());
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.run.name, "人级运行");
  assert.equal(result.selected.find(item => item.name === "指定天级附修").system.active, false);
});

test("成长协调在经脉补功后可以选择新增的最高层运行内功", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    synergyProbability: 100,
    jingmai: { mode: "target", fixed: ["hand_taiyin"], autoSupplement: true },
    neigong: { supplementForJingmai: true }
  });
  const candidates = [
    neigongFixture("human", "人级运行", 1, "yin"),
    neigongFixture("earth", "地级补功", 2, "yin"),
    neigongFixture("heaven", "天级补功", 3, "yin")
  ];
  const selection = manager._selectNeigongs({ pools: { neigong: candidates }, conflicts: [] }, config, () => 0, new Map());
  const meridians = manager._solveMeridians(selection.selected, candidates, config, () => 0);
  assert.deepEqual(meridians.selected.map(item => item.name), ["人级运行", "地级补功", "天级补功"]);
  const result = manager._coordinateRunNeigong(selection, config, () => 0, new Map([["neigong:run:growth", 0]]));
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.run.name, "天级补功");
});

test("同品阶多个附修槽位会共同保护候选，不被随机运行内功抢占", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    synergyProbability: 0,
    neigong: {
      additionalCount: 2,
      additionalGroups: [{ count: 1, tier: 3 }, { count: 1, tier: 3 }]
    }
  });
  const result = manager._selectNeigongs({
    pools: { neigong: [
      neigongFixture("human", "人级运行", 1, "yin"),
      neigongFixture("heaven-1", "天级附修一", 3, "yang"),
      neigongFixture("heaven-2", "天级附修二", 3, "yin")
    ] }, conflicts: []
  }, config, () => 0.99);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.run.name, "人级运行");
  assert.deepEqual(result.selected.map(item => item.name).sort(), ["人级运行", "天级附修一", "天级附修二"].sort());
});

test("指定运行内功时，前面的随机附修槽位也会避让后续品阶槽位", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    neigong: {
      runUuid: "Item.run",
      additionalCount: 2,
      additionalGroups: [{ count: 1 }, { count: 1, tier: 3 }]
    }
  });
  const result = manager._selectNeigongs({
    pools: { neigong: [
      neigongFixture("run", "指定运行", 1, "yin"),
      neigongFixture("human-extra", "人级随机附修", 1, "yang"),
      neigongFixture("heaven", "天级限定附修", 3, "yin")
    ] }, conflicts: []
  }, config, () => 0);
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.selected.map(item => item.name), ["指定运行", "人级随机附修", "天级限定附修"]);
});

test("运行属性限定时不会预留掉唯一可运行的同品阶功法", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    neigong: {
      runElement: "yin",
      additionalCount: 1,
      additionalGroups: [{ count: 1, tier: 1 }]
    }
  });
  const result = manager._selectNeigongs({
    pools: { neigong: [
      neigongFixture("A", "阴人内运行", 1, "yin"),
      neigongFixture("B", "阳人内附修", 1, "yang")
    ] }, conflicts: []
  }, config, () => 0.99);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.run.name, "阴人内运行");
  assert.equal(result.selected.some(item => item.name === "阳人内附修"), true);
});

test("运行未指定 UUID 时不会让指定附修同时占用另一品阶槽位保障", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    neigong: {
      additionalCount: 2,
      additionalGroups: [{ count: 1, uuids: ["Item.A"] }, { count: 1, tier: 1 }]
    }
  });
  const result = manager._selectNeigongs({
    pools: { neigong: [
      neigongFixture("A", "指定人级附修", 1, "yin"),
      neigongFixture("B", "随机人级附修", 1, "yang"),
      neigongFixture("C", "随机地级运行", 2, "taiji")
    ] }, conflicts: []
  }, config, () => 0.99);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.run.name, "随机地级运行");
  assert.deepEqual(result.selected.map(item => item.name), ["随机地级运行", "指定人级附修", "随机人级附修"]);
});

test("运行品阶限定但未指定 UUID 时仍会避让指定同品阶附修", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    neigong: {
      runTier: 1,
      additionalCount: 2,
      additionalGroups: [{ count: 1, uuids: ["Item.A"] }, { count: 1, tier: 1 }]
    }
  });
  const result = manager._selectNeigongs({
    pools: { neigong: [
      neigongFixture("A", "指定人级附修", 1, "yin"),
      neigongFixture("B", "人级运行候选", 1, "yang"),
      neigongFixture("C", "人级附修候选", 1, "taiji")
    ] }, conflicts: []
  }, config, () => 0);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.run.name, "人级运行候选");
  assert.deepEqual(result.selected.map(item => item.name), ["人级运行候选", "指定人级附修", "人级附修候选"]);
});

test("受限附修填满后会释放预留资源给后续通配附修", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    neigong: {
      additionalCount: 2,
      additionalGroups: [{ count: 1, tier: 1 }, { count: 1 }]
    }
  });
  const result = manager._selectNeigongs({
    pools: { neigong: [
      neigongFixture("A", "人级候选一", 1, "yin"),
      neigongFixture("B", "人级候选二", 1, "yang"),
      neigongFixture("C", "地级运行", 2, "taiji")
    ] }, conflicts: []
  }, config, () => 0.99);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.run.name, "地级运行");
  assert.deepEqual(result.selected.map(item => item.name), ["地级运行", "人级候选二", "人级候选一"]);
});

test("经脉补功优先选择能满足缺额的最少新增内功", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    jingmai: { mode: "target", total: 1, yang: 1, autoSupplement: true },
    neigong: { supplementForJingmai: true }
  });
  const existing = neigongFixture("existing", "已有未圆满内功", 3, "yin", 1);
  const candidates = [
    neigongFixture("heaven", "天级无关功法", 3, "yang"),
    neigongFixture("earth", "地级无关功法", 2, "yang"),
    neigongFixture("human", "人级合格功法", 1, "yang")
  ];
  const result = manager._solveMeridians([existing], candidates, config, () => 0);
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.selected.map(item => item.name), ["已有未圆满内功", "人级合格功法"]);
  assert.deepEqual(result.adjustments.map(adjustment => adjustment.type), ["supplement"]);
});

test("经脉补功先补低关前置，再补固定高关节点所需的高关内功", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    jingmai: { mode: "target", fixed: ["hand_taiyin"], autoSupplement: true },
    neigong: { supplementForJingmai: true }
  });
  const existing = neigongFixture("human", "已有一关内功", 1, "yin");
  const result = manager._solveMeridians([
    existing
  ], [
    neigongFixture("heaven-1", "天级候选一", 3, "yin"),
    neigongFixture("earth", "地级前置", 2, "yin"),
    neigongFixture("heaven-2", "天级候选二", 3, "yin")
  ], config, () => 0);
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.adjustments.map(adjustment => adjustment.name), ["地级前置", "天级候选一"]);
});

test("经脉固定高关目标不被多余低阶内功抢占，按最少新增补齐前置", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    jingmai: { mode: "target", fixed: ["hand_taiyin"], autoSupplement: true },
    neigong: { supplementForJingmai: true }
  });
  const result = manager._solveMeridians([
    neigongFixture("human", "已有一关内功", 1, "yin")
  ], [
    neigongFixture("human-extra-1", "多余人级一", 1, "yin"),
    neigongFixture("human-extra-2", "多余人级二", 1, "yin"),
    neigongFixture("earth", "地级前置", 2, "yin"),
    neigongFixture("heaven", "天级目标", 3, "yin")
  ], config, () => 0);
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.adjustments.map(adjustment => adjustment.name), ["地级前置", "天级目标"]);
});

test("指定治疗资源会先分配到不同武学配额，不把两套都计入同一固定槽位", () => {
  const manager = new XJZLCharacterGenerationManager();
  const healing = (id, tier) => ({
    _id: id,
    uuid: `Item.${id}`,
    name: id,
    type: "wuxue",
    system: {
      category: "wuxue", tier,
      moves: [{ id: "heal", type: "qi", actionType: "heal", progression: { mappedStage: 0 } }]
    }
  });
  const primary = wuxueFixture();
  primary._id = "primary";
  primary.uuid = "Item.primary";
  primary.name = "主修";
  primary.system.tier = 1;
  const config = normalizeGenerationConfig({
    wuxue: {
      primary: { tier: 1 },
      additionalTierCounts: { 1: 0, 2: 1, 3: 0 },
      additionalRandomMin: 1,
      additionalRandomMax: 1,
      healingUuids: ["Item.heal-earth-1", "Item.heal-earth-2"]
    }
  });
  const result = manager._selectWuxue({ pools: { wuxue: [primary, healing("heal-earth-1", 2), healing("heal-earth-2", 2)] } }, config, () => 0);
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.selected.map(item => item.uuid).filter(uuid => uuid?.includes("heal-earth")), [
    "Item.heal-earth-1", "Item.heal-earth-2"
  ]);
});

test("附修内功支持指定数量与随机范围叠加，旧武学配置仍兼容三档配额", () => {
  const random = normalizeGenerationConfig({ neigong: { additionalCountMode: "random", additionalRandomMin: 1, additionalRandomMax: 5 } });
  assert.equal(random.neigong.additionalCount, 0);
  assert.equal(random.neigong.additionalRandomMin, 1);
  assert.equal(random.neigong.additionalRandomMax, 5);
  const fixed = normalizeGenerationConfig({ neigong: { additionalCount: 2, additionalRandomMin: 1, additionalRandomMax: 4 } });
  assert.equal(fixed.neigong.additionalCount, 2);
  assert.equal(fixed.neigong.additionalRandomMin, 1);
  assert.equal(fixed.neigong.additionalRandomMax, 4);

  const pool = [1, 2, 3].flatMap(tier => Array.from({ length: 4 }, (_, index) => ({
    _id: `wuxue-${tier}-${index}`,
    uuid: `Item.wuxue-${tier}-${index}`,
    name: `${tier}级武学${index}`,
    type: "wuxue",
    system: { category: "wuxue", tier, moves: [{ id: `move-${tier}-${index}`, progression: { mappedStage: 0 } }] }
  })));
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({ wuxue: { mainTierCounts: { 1: 3, 2: 2, 3: 1 }, mainRandomMin: 1, mainRandomMax: 1 } });
  const result = manager._selectWuxue({ pools: { wuxue: pool } }, config, () => 0);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.selected.length, 7);
  assert.deepEqual(
    Object.fromEntries([1, 2, 3].map(tier => [tier, result.selected.filter(item => item.system.tier === tier).length])),
    { 1: 4, 2: 2, 3: 1 }
  );

  const specifiedRandomSlot = normalizeGenerationConfig({
    wuxue: {
      mainTierCounts: { 1: 0, 2: 0, 3: 0 },
      mainRandomMin: 1,
      mainRandomMax: 1,
      fixed: { wuxue: ["Item.wuxue-1-0"] }
    }
  });
  const specifiedResult = manager._selectWuxue({ pools: { wuxue: pool } }, specifiedRandomSlot, () => 0.99);
  assert.equal(specifiedResult.conflicts.length, 0);
  assert.deepEqual(specifiedResult.selected.map(item => item.uuid), ["Item.wuxue-1-0"]);
});

test("装备品质筛选候选并保留来源品质、数值与效果", () => {
  const armorPool = ["head", "top", "bottom", "ring", "ring-2", "accessory", "accessory-2"].map((type, index) => ({
    _id: `armor-${index}`,
    uuid: `Item.armor-${index}`,
    name: `防具${index}`,
    type: "armor",
    system: {
      type: type.startsWith("ring") ? "ring" : type.startsWith("accessory") ? "accessory" : type,
      quality: 3,
      armor: { defense: index + 1 }
    }
  }));
  armorPool.push({
    _id: "armor-low-quality",
    uuid: "Item.armor-low-quality",
    name: "低品质防具",
    type: "armor",
    system: { type: "top", quality: 0, armor: { defense: 99 } }
  });
  const manager = new XJZLCharacterGenerationManager();
  const snapshot = { pools: { weapon: [], armor: armorPool } };
  const baseDraft = () => ({ wuxue: [], items: [], equipment: {} });
  const minimumConfig = normalizeGenerationConfig({
    wuxue: { weaponType: "none" },
    equipment: { armorMinCount: 2, armorTypes: ["head"], armorFillMode: "minimum", armorQuality: 3 }
  });
  const minimumDraft = baseDraft();
  assert.deepEqual(manager._selectEquipment(snapshot, minimumConfig, minimumDraft, () => 0), []);
  assert.equal(minimumConfig.equipment.armorMinCount, 2);
  assert.equal(minimumDraft.items.filter(item => item.type === "armor").length, 2);
  assert.equal(minimumDraft.items.every(item => item.system.quality === 3 && item.system.equipped), true);
  assert.equal(minimumDraft.items.some(item => item.uuid === "Item.armor-low-quality"), false);
  assert.equal(minimumDraft.items.find(item => item.uuid === "Item.armor-0").system.armor.defense, 1);
  assert.equal(minimumDraft.items.some(item => item.system.type === "head"), true);

  const accessoryConfig = normalizeGenerationConfig({
    wuxue: { weaponType: "none" },
    equipment: { armorMinCount: 1, armorTypes: ["accessory"], armorTypeCounts: { accessory: 2 }, armorFillMode: "minimum", armorQuality: 3 }
  });
  const accessoryDraft = baseDraft();
  assert.deepEqual(manager._selectEquipment(snapshot, accessoryConfig, accessoryDraft, () => 0), []);
  assert.equal(accessoryDraft.items.filter(item => item.type === "armor").length, 2);
  assert.equal(accessoryConfig.equipment.armorMinCount, 2);

  const mismatchDraft = baseDraft();
  const mismatchConfig = normalizeGenerationConfig({
    wuxue: { weaponType: "none" },
    equipment: { armorUuids: ["Item.armor-low-quality"], armorQuality: 3 }
  });
  const mismatchConflicts = manager._selectEquipment(snapshot, mismatchConfig, mismatchDraft, () => 0);
  assert.ok(mismatchConflicts.some(conflict => conflict.field === "equipment.armorQuality"));
  assert.equal(mismatchDraft.items.length, 0);

  const randomDraft = baseDraft();
  const randomConfig = normalizeGenerationConfig({
    wuxue: { weaponType: "none" },
    equipment: { armorMinCount: 1, armorFillMode: "random", armorRandomExtraMax: 1, armorQuality: 3 }
  });
  assert.deepEqual(manager._selectEquipment(snapshot, randomConfig, randomDraft, () => 0.99), []);
  assert.ok(randomDraft.items.filter(item => item.type === "armor").length >= 1);
  assert.ok(randomDraft.items.filter(item => item.type === "armor").length <= 2);

  const noneDraft = baseDraft();
  const noneConfig = normalizeGenerationConfig({ wuxue: { weaponType: "none" }, equipment: { armorFillMode: "minimum" } });
  assert.deepEqual(manager._selectEquipment(snapshot, noneConfig, noneDraft, () => 0), []);
  assert.equal(noneDraft.items.filter(item => item.type === "armor").length, 0);
});

test("固定主修境界先按招式可达上限筛选，不把可达套路误判为境界冲突", () => {
  const pool = Array.from({ length: 6 }, (_, index) => ({
    _id: `heaven-${index}`,
    uuid: `Item.heaven-${index}`,
    name: `天级套路${index}`,
    type: "wuxue",
    system: {
      category: "wuxue",
      tier: 3,
      moves: [{ id: `real-${index}`, name: "实招", type: "real", progression: { mappedStage: 0 } }]
    }
  }));
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({ wuxue: { mainCount: 5, mainTier: 3, mainStage: 4 } });
  const result = manager._selectWuxue({ pools: { wuxue: pool } }, config, () => 0);
  assert.equal(result.selected.length, 5);
  assert.equal(result.conflicts.some(conflict => conflict.field === "wuxue.mainStage"), false);
  assert.equal(result.selected.every(item => item._generationTargetStage === 4), true);

  const auxiliary = {
    _id: "sanshou-1",
    uuid: "Item.sanshou-1",
    name: "只能精通的散手",
    type: "wuxue",
    system: {
      category: "sanshou",
      tier: 3,
      moves: [{ id: "sanshou-real", name: "散手实招", type: "real", progression: { mappedStage: 3 } }]
    }
  };
  const withAuxiliary = normalizeGenerationConfig({
    wuxue: { mainCount: 5, mainTier: 3, mainStage: 4, sanshouCount: 1, auxiliaryTier: 3 }
  });
  const auxiliaryResult = manager._selectWuxue({ pools: { wuxue: [...pool, auxiliary] } }, withAuxiliary, () => 0);
  assert.equal(auxiliaryResult.selected.length, 6);
  assert.equal(auxiliaryResult.conflicts.length, 0);
  assert.equal(auxiliaryResult.selected.find(item => item.system.category === "sanshou")._generationTargetStage, 3);

  const shortage = manager._selectWuxue({ pools: { wuxue: pool.slice(0, 4) } }, config, () => 0);
  const stageConflict = shortage.conflicts.find(conflict => conflict.field === "wuxue.mainStage");
  assert.equal(stageConflict?.expected, 5);
  assert.equal(stageConflict?.actual, 4);
  assert.match(stageConflict?.reason, /当前范围共有 4 套，只有 4 套可达到目标境界/);
});

test("新模型将主修独立为一套，其他武学品阶配额不受主修境界约束", () => {
  const pool = [1, 2, 3].flatMap(tier => Array.from({ length: tier === 1 ? 3 : tier === 2 ? 2 : 1 }, (_, index) => ({
    _id: `new-${tier}-${index}`,
    uuid: `Item.new-${tier}-${index}`,
    name: `${tier}级武学${index}`,
    type: "wuxue",
    system: {
      category: "wuxue",
      tier,
      moves: [{ id: `move-${tier}-${index}`, name: "正式招式", type: "real", progression: { mappedStage: 0 } }]
    }
  })));
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    wuxue: {
      primary: { tier: 3, stage: 4 },
      additionalTierCounts: { 1: 3, 2: 2, 3: 0 },
      additionalRandomMin: 0,
      additionalRandomMax: 0
    }
  });
  const locked = normalizeGenerationConfig({
    wuxue: { primary: { uuid: "Item.primary" }, fixed: { moves: { "Item.primary": { real: 2 } } } }
  });
  assert.deepEqual(locked.wuxue.fixed.moves["Item.primary"], { real: 2 });
  const result = manager._selectWuxue({ pools: { wuxue: pool } }, config, () => 0);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.selected.length, 6);
  assert.equal(result.primary?.system.tier, 3);
  assert.equal(result.primary?._generationTargetStage, 4);
  assert.deepEqual(
    Object.fromEntries([1, 2, 3].map(tier => [tier, result.selected.filter(item => item.system.tier === tier).length])),
    { 1: 3, 2: 2, 3: 1 }
  );
});

test("指定治疗武学可以占用随机武学槽位，不会被零固定配额提前拒绝", () => {
  const manager = new XJZLCharacterGenerationManager();
  const makeWuxue = (id, healing = false) => ({
    _id: id,
    uuid: `Item.${id}`,
    name: id,
    type: "wuxue",
    system: {
      category: "wuxue",
      tier: 1,
      moves: [{ id: `${id}-move`, type: healing ? "qi" : "real", actionType: healing ? "heal" : "attack", progression: { mappedStage: 0 } }]
    }
  });
  const config = normalizeGenerationConfig({
    wuxue: {
      primary: { tier: 1 },
      additionalTierCounts: { 1: 0, 2: 0, 3: 0 },
      additionalRandomMin: 1,
      additionalRandomMax: 1,
      healingRequired: true,
      healingCount: 1,
      healingUuids: ["Item.healing"]
    }
  });
  const result = manager._selectWuxue({
    pools: { wuxue: [makeWuxue("primary"), makeWuxue("healing", true)] }
  }, config, () => 0);
  assert.equal(result.conflicts.some(conflict => conflict.field?.startsWith("wuxue.additionalTierCounts.")), false);
  assert.deepEqual(result.selected.map(item => item.name), ["primary", "healing"]);
  assert.equal(result.conflicts.length, 0);
});

test("必须带治疗且没有其他确定槽位时，主修槽位优先承接治疗", () => {
  const manager = new XJZLCharacterGenerationManager();
  const makeWuxue = (id, healing) => ({
    _id: id,
    uuid: `Item.${id}`,
    name: id,
    type: "wuxue",
    system: {
      category: "wuxue",
      tier: 1,
      moves: [{
        id: `${id}-move`,
        type: healing ? "qi" : "real",
        actionType: healing ? "heal" : "attack",
        progression: { mappedStage: 0 }
      }]
    }
  });
  const config = normalizeGenerationConfig({
    wuxue: {
      primary: { tier: 1 },
      healingRequired: true,
      healingCount: 1
    }
  });
  const result = manager._selectWuxue({
    pools: { wuxue: [makeWuxue("attack", false), makeWuxue("healing", true)] }
  }, config, () => 0);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.primary.name, "healing");
  assert.equal(countLearnedHealing(result.selected).count, 1);
});

test("主修治疗安排按后续分类候选能力判断，不被无治疗轻功槽位误导", () => {
  const manager = new XJZLCharacterGenerationManager();
  const makeWuxue = (id, category, healing = false) => ({
    _id: id,
    uuid: `Item.${id}`,
    name: id,
    type: "wuxue",
    system: {
      category,
      tier: 1,
      moves: [{
        id: `${id}-move`,
        type: healing ? "qi" : "real",
        actionType: healing ? "heal" : "attack",
        progression: { mappedStage: 0 }
      }]
    }
  });
  const config = normalizeGenerationConfig({
    wuxue: { primary: { tier: 1 }, qinggongCount: 1, healingRequired: true, healingCount: 1 }
  });
  const result = manager._selectWuxue({
    pools: { wuxue: [makeWuxue("attack-primary", "wuxue"), makeWuxue("healing-primary", "wuxue", true), makeWuxue("light", "qinggong")] }
  }, config, () => 0);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.primary.name, "healing-primary");
  assert.equal(countLearnedHealing(result.selected).count, 1);
});

test("治疗容量估算会扣除已指定的非治疗辅助资源", () => {
  const manager = new XJZLCharacterGenerationManager();
  const makeWuxue = (id, category, healing = false) => ({
    _id: id,
    uuid: `Item.${id}`,
    name: id,
    type: "wuxue",
    system: {
      category,
      tier: 1,
      moves: [{
        id: `${id}-move`,
        type: healing ? "qi" : "real",
        actionType: healing ? "heal" : "attack",
        progression: { mappedStage: 0 }
      }]
    }
  });
  const config = normalizeGenerationConfig({
    wuxue: {
      primary: { tier: 1 },
      zhenfaCount: 1,
      fixed: { zhenfa: ["Item.fixed-zhenfa"] },
      healingRequired: true,
      healingCount: 1
    }
  });
  const result = manager._selectWuxue({
    pools: { wuxue: [
      makeWuxue("attack-primary", "wuxue"),
      makeWuxue("healing-primary", "wuxue", true),
      makeWuxue("fixed-zhenfa", "zhenfa"),
      makeWuxue("other-healing-zhenfa", "zhenfa", true)
    ] }
  }, config, () => 0);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.primary.name, "healing-primary");
  assert.equal(result.selected.some(item => item.uuid === "Item.fixed-zhenfa"), true);
  assert.equal(countLearnedHealing(result.selected).count, 1);
});

test("治疗候选按其他武学目标境界成长，不被锁在最低境界", () => {
  const manager = new XJZLCharacterGenerationManager();
  const primary = wuxueFixture();
  primary._id = "primary-target";
  primary.uuid = "Item.primary-target";
  primary.name = "罗汉拳";
  const healing = {
    _id: "healing-sanshou",
    uuid: "Item.healing-sanshou",
    name: "提气再战",
    type: "wuxue",
    system: {
      category: "sanshou",
      tier: 1,
      moves: [{ id: "heal", type: "qi", actionType: "heal", progression: { mappedStage: 0 } }]
    }
  };
  const config = normalizeGenerationConfig({
    wuxue: {
      primary: { tier: 1, stage: 2 },
      sanshouCount: 1,
      healingRequired: true,
      healingCount: 1,
      allocation: "independent"
    }
  });
  const result = manager._selectWuxue({ pools: { wuxue: [primary, healing] } }, config, () => 0.99);
  assert.equal(result.conflicts.length, 0);
  const healingItem = result.selected.find(item => item.uuid === "Item.healing-sanshou");
  const healingMove = healingItem.system.moves.find(move => move.id === "heal");
  assert.equal(countLearnedHealing(result.selected).count, 1);
  assert.ok(healingMove.effectiveStage >= 2);
  assert.equal(healingMove.effectiveStage, healingItem._generationTargetStage);
});

test("治疗硬条件只锁定最低可学境界，不把整套治疗武学强制升满", () => {
  const manager = new XJZLCharacterGenerationManager();
  const healing = {
    _id: "healing-stage",
    uuid: "Item.healing-stage",
    name: "治疗套路",
    type: "wuxue",
    system: {
      category: "wuxue",
      tier: 1,
      moves: [
        { id: "heal", type: "qi", actionType: "heal", progression: { mappedStage: 0 } },
        { id: "heal-real", type: "real", actionType: "attack", progression: { mappedStage: 0 } }
      ]
    }
  };
  const attack = wuxueFixture();
  attack._id = "attack-stage";
  attack.uuid = "Item.attack-stage";
  attack.name = "攻击套路";
  const config = normalizeGenerationConfig({
    wuxue: {
      primary: { tier: 1, stage: 2 },
      additionalTierCounts: { 1: 1, 2: 0, 3: 0 },
      healingRequired: true,
      healingCount: 1,
      wuxingLimit: 0,
      allocation: "independent"
    }
  });
  const result = manager._selectWuxue({ pools: { wuxue: [attack, healing] } }, config, () => 0);
  assert.equal(result.conflicts.length, 0);
  assert.equal(countLearnedHealing(result.selected).count, 1);
  assert.equal(calculateWuxingContribution(result.selected).total, 0);
});

test("附修随机槽位会为后续指定内功保留资源", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    neigong: {
      additionalCount: 2,
      additionalGroups: [{ count: 1 }, { count: 1, uuids: ["Item.A"] }]
    }
  });
  const result = manager._selectNeigongs({
    pools: {
      neigong: [
        neigongFixture("A", "A", 1, "yin"),
        neigongFixture("B", "B", 1, "yang"),
        neigongFixture("C", "C", 1, "taiji")
      ]
    },
    conflicts: []
  }, config, () => 0);
  assert.deepEqual(result.selected.map(item => item.name), ["B", "C", "A"]);
  assert.equal(result.conflicts.length, 0);
});

test("指定辅助武学失效时报告冲突，自动武器只匹配独立主修套", () => {
  const makeWuxue = (id, category, weaponType) => ({
    _id: id,
    uuid: `Item.${id}`,
    name: id,
    type: "wuxue",
    system: {
      category,
      tier: 1,
      moves: [{ id: "move", type: "real", weaponType, progression: { mappedStage: 0 } }]
    }
  });
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    wuxue: { primary: { tier: 1 }, sanshouCount: 1, fixed: { sanshou: ["Item.missing"] } }
  });
  const selected = manager._selectWuxue({
    pools: { wuxue: [makeWuxue("primary", "wuxue", "sword"), makeWuxue("auxiliary", "sanshou", "knife")] }
  }, config, () => 0);
  assert.ok(selected.conflicts.some(conflict => conflict.field === "wuxue.sanshouCount"));

  const draft = {
    primary: { coreMove: { weaponType: "sword" } },
    wuxue: [],
    items: [],
    equipment: {}
  };
  const equipmentConfig = normalizeGenerationConfig({
    wuxue: { primary: { tier: 1 }, weaponType: "auto" },
    equipment: { weaponQuality: 2 }
  });
  const conflicts = manager._selectEquipment({
    pools: {
      weapon: [
        { _id: "knife", uuid: "Item.knife", name: "刀", type: "weapon", system: { type: "knife", quality: 0, damage: 99 } },
        { _id: "sword", uuid: "Item.sword", name: "剑", type: "weapon", system: { type: "sword", quality: 2, damage: 12 } }
      ],
      armor: []
    }
  }, equipmentConfig, draft, () => 0);
  assert.equal(conflicts.length, 0);
  assert.equal(draft.equipment.weapon.name, "剑");
  assert.equal(draft.items.find(item => item.type === "weapon").system.quality, 2);
  assert.equal(draft.items.find(item => item.type === "weapon").system.damage, 12);

  const specifiedMismatchDraft = {
    primary: { coreMove: { weaponType: "sword" } },
    wuxue: [],
    items: [],
    equipment: {}
  };
  const specifiedMismatchConfig = normalizeGenerationConfig({
    wuxue: { primary: { tier: 1 }, weaponType: "auto" },
    equipment: { weaponQuality: 2, weaponUuid: "Item.knife" }
  });
  const specifiedMismatchConflicts = manager._selectEquipment({
    pools: {
      weapon: [
        { _id: "knife", uuid: "Item.knife", name: "刀", type: "weapon", system: { type: "knife", quality: 0 } },
        { _id: "sword", uuid: "Item.sword", name: "剑", type: "weapon", system: { type: "sword", quality: 2 } }
      ],
      armor: []
    }
  }, specifiedMismatchConfig, specifiedMismatchDraft, () => 0);
  assert.ok(specifiedMismatchConflicts.some(conflict => conflict.field === "equipment.weaponQuality"));
  assert.equal(specifiedMismatchDraft.items.some(item => item.type === "weapon"), false);
});

test("配套命中时指定武器仍需符合主修核心武器关系", () => {
  const manager = new XJZLCharacterGenerationManager();
  const config = normalizeGenerationConfig({
    synergyProbability: 100,
    wuxue: { primary: { tier: 1 }, weaponType: "auto" },
    equipment: { weaponQuality: 0, weaponUuid: "Item.sword" }
  });
  const draft = {
    primary: { coreMove: { weaponType: "blade" } },
    wuxue: [],
    items: [],
    equipment: {}
  };
  const conflicts = manager._selectEquipment({
    pools: {
      weapon: [{ _id: "sword", uuid: "Item.sword", name: "剑", type: "weapon", system: { type: "sword", quality: 0 } }],
      armor: []
    }
  }, config, draft, () => 0);
  assert.ok(conflicts.some(conflict => conflict.field === "equipment.weaponCompatibility"));
});

test("生成快照提示非有限输入并保留字段级冲突", async () => {
  const manager = new XJZLCharacterGenerationManager();
  const snapshot = await manager.snapshot({ quantity: "Infinity", stats: { freePoints: "NaN" } });
  assert.ok(snapshot.conflicts.some(conflict => conflict.field === "quantity"));
  assert.ok(snapshot.conflicts.some(conflict => conflict.field === "stats.freePoints"));
});

test("新武学模型只报告一次随机区间错误，不重复报告兼容别名", async () => {
  const manager = new XJZLCharacterGenerationManager();
  const snapshot = await manager.snapshot({
    wuxue: { primary: {}, additionalRandomMin: 4, additionalRandomMax: 2 }
  });
  assert.equal(snapshot.conflicts.filter(conflict => conflict.field === "wuxue.additionalRandomMin").length, 1);
  assert.equal(snapshot.conflicts.some(conflict => conflict.field === "wuxue.mainRandomMin"), false);
});

test("随机境界造成悟性超限时使用回溯预算，下一次合法结果可以通过", async () => {
  const manager = new XJZLCharacterGenerationManager();
  let buildCount = 0;
  manager._buildDraft = () => {
    buildCount += 1;
    return {
      draftId: "retry-" + buildCount,
      conflicts: buildCount === 1 ? [{
        type: "condition", field: "wuxue.wuxingLimit", reason: "随机境界超出悟性上限"
      }] : [],
      decisions: [],
      evaluation: null,
      status: "conflict"
    };
  };
  manager._evaluateDraft = async draft => {
    draft.evaluation = { valid: true };
    draft.status = "ready";
    return draft;
  };
  const result = await manager.generate({
    config: { quantity: 1, requestId: "retry-request", matchStandard: "standard" }
  }, { attempts: 8, rng: () => 0 });
  assert.equal(buildCount, 2);
  assert.equal(result.valid, true);
  assert.equal(result.drafts[0].draftId, "retry-2");
});

test("随机主修引起的武器匹配冲突会使用现有回溯预算", async () => {
  const manager = new XJZLCharacterGenerationManager();
  let buildCount = 0;
  manager._buildDraft = () => {
    buildCount += 1;
    return {
      draftId: `weapon-retry-${buildCount}`,
      conflicts: buildCount === 1 ? [{
        type: "condition", field: "equipment.weaponCompatibility", reason: "随机主修与指定武器不匹配"
      }] : [],
      decisions: [],
      evaluation: null,
      status: buildCount === 1 ? "conflict" : "ready"
    };
  };
  manager._evaluateDraft = async draft => {
    draft.evaluation = { valid: true };
    draft.status = "ready";
    return draft;
  };
  const config = normalizeGenerationConfig({
    quantity: 1,
    wuxue: { primary: { tier: 1 }, weaponType: "auto" },
    equipment: { weaponUuid: "Item.sword" }
  });
  const result = await manager.generate({ config }, { attempts: 2, rng: () => 0 });
  assert.equal(buildCount, 2);
  assert.equal(result.valid, true);
  assert.equal(result.drafts[0].draftId, "weapon-retry-2");
});

test("候选资源按合集包批量读取，避免逐条 fromUuid", async () => {
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  let requestCount = 0;
  const documents = [1, 2].map(index => ({
    id: `item-${index}`,
    uuid: `Compendium.xjzl-system.neigong.item-${index}`,
    type: "neigong",
    name: `内功${index}`,
    system: { tier: 1, element: "yin", config: {} }
  }));
  globalThis.game = {
    packs: {
      get(collection) {
        assert.equal(collection, "xjzl-system.neigong");
        return {
          collection,
          async getDocuments(query) {
            requestCount += 1;
            assert.deepEqual(query, { _id__in: requestCount === 1 ? ["item-1", "item-2"] : ["item-2"] });
            return documents.filter(document => query._id__in.includes(document.id));
          }
        };
      }
    }
  };
  globalThis.fromUuid = async () => { throw new Error("不应逐条读取"); };
  try {
    const browser = {
      getResourceRangeSnapshot() {
        return documents.map(document => ({ uuid: document.uuid, packCollection: "xjzl-system.neigong" }));
      }
    };
    const result = await loadGenerationCandidates(browser, "neigong", {});
    assert.equal(requestCount, 1);
    assert.deepEqual(result.map(item => item.name), ["内功1", "内功2"]);
    const filtered = await loadGenerationCandidates(browser, "neigong", {}, new Map(), entry => entry.uuid.endsWith("item-2"));
    assert.equal(requestCount, 2);
    assert.deepEqual(filtered.map(item => item.name), ["内功2"]);
  } finally {
    globalThis.game = previousGame;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("V14 准备异常即使被 safePrepareData 吞掉也会阻止草案", async () => {
  const previousHooks = globalThis.Hooks;
  const previousConfig = globalThis.CONFIG;
  const callbacks = new Map();
  globalThis.Hooks = {
    on(name, callback) {
      callbacks.set(name, callback);
      return callback;
    },
    off(name, callback) {
      if (callbacks.get(name) === callback) callbacks.delete(name);
    }
  };
  class FakeActor {
    constructor(data) {
      this.id = data._id;
      this.uuid = `Actor.${data._id}`;
      this.system = data.system;
      this.items = (data.items || []).map(item => ({ ...item, id: item._id, toObject: () => item }));
      callbacks.get("error")?.("ClientDocumentMixin#_initialize", new Error("嵌入 Item 准备失败"), { uuid: `${this.uuid}.Item.bad` });
    }

    prepareData() {}
  }
  globalThis.CONFIG = { Actor: { documentClass: FakeActor } };
  const draft = {
    draftId: "draft-1",
    evaluationId: "eval-1",
    requestId: "request-1",
    configVersion: 1,
    name: "失败案例",
    actorType: "npc",
    runNeigongId: "ng-1",
    config: { wuxue: { healingRequired: false, healingCount: 1, wuxingLimit: null } },
    system: { stats: {}, resources: {} },
    items: [{ _id: "ng-1", id: "ng-1", type: "neigong", system: {} }]
  };
  try {
    const result = await evaluateGenerationDraft(draft);
    assert.equal(result.prepared, false);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /准备失败/);
    assert.equal(result.constraints.finite, true);
  } finally {
    globalThis.Hooks = previousHooks;
    globalThis.CONFIG = previousConfig;
  }
});

test("角色评估读取准备后的招式派生字段而不是 toObject 来源快照", async () => {
  const previousGame = globalThis.game;
  const previousConfig = globalThis.CONFIG;
  class FakeActor {
    constructor(data) {
      this.id = data._id;
      this.uuid = `Actor.${data._id}`;
      this.system = data.system;
      this.items = (data.items || []).map(source => {
        const item = {
          ...source,
          id: source._id,
          system: {
            ...source.system,
            moves: (source.system?.moves || []).map(move => ({ ...move, computedLevel: 1, effectiveStage: 3 }))
          },
          toObject: () => source
        };
        return item;
      });
      this.itemTypes = { wuxue: this.items.filter(item => item.type === "wuxue") };
    }

    prepareData() {}
  }
  globalThis.game = { _documentsReady: true };
  globalThis.CONFIG = { Actor: { documentClass: FakeActor } };
  const draft = {
    draftId: "derived-1",
    evaluationId: "derived-eval-1",
    requestId: "derived-request-1",
    configVersion: 1,
    name: "派生字段案例",
    actorType: "npc",
    runNeigongId: "run-1",
    config: { wuxue: { healingRequired: true, healingCount: 1, wuxingLimit: 0 } },
    system: { stats: {}, resources: {} },
    items: [
      { _id: "run-1", type: "neigong", system: {} },
      { _id: "wuxue-1", type: "wuxue", system: { category: "wuxue", tier: 1, moves: [{ id: "heal", type: "qi", actionType: "heal", progression: { mappedStage: 0 } }] } }
    ]
  };
  try {
    const result = await evaluateGenerationDraft(draft);
    assert.equal(result.prepared, true);
    assert.equal(result.constraints.healing, true);
    assert.equal(result.constraints.wuxing, false);
    assert.equal(result.derived.wuxingContribution.total, 1);
  } finally {
    globalThis.game = previousGame;
    globalThis.CONFIG = previousConfig;
  }
});

test("固定武学不能抬高悟性上限，配套使用运行内功加成并识别 calculation.scalings", async () => {
  const previousGame = globalThis.game;
  const previousConfig = globalThis.CONFIG;
  class FakeActor {
    constructor(data) {
      this.id = data._id;
      this.uuid = `Actor.${data._id}`;
      this.system = data.system;
      this.system.stats.freePoints ??= {};
      this.system.stats.freePoints.total = 12;
      this.items = (data.items || []).map(source => ({
        ...source,
        id: source._id,
        system: {
          ...source.system,
          current: source.type === "neigong"
            ? { stats: { liliang: 2, shenfa: 0, tipo: 0, neixi: 0, qigan: 0, shencai: 0 } }
            : source.system?.current,
          moves: (source.system?.moves || []).map(move => ({ ...move, computedLevel: 1, effectiveStage: 3 }))
        },
        toObject: () => source
      }));
      this.itemTypes = { wuxue: this.items.filter(item => item.type === "wuxue") };
    }

    prepareData() {}
  }
  globalThis.game = { _documentsReady: true };
  globalThis.CONFIG = { Actor: { documentClass: FakeActor } };
  const manager = new XJZLCharacterGenerationManager();
  const draft = {
    draftId: "fixed-wuxing",
    evaluationId: "fixed-wuxing-eval",
    requestId: "fixed-wuxing-request",
    configVersion: 1,
    name: "固定贡献案例",
    actorType: "npc",
    runNeigongId: "run-1",
    config: {
      synergyProbability: 0,
      matchStandard: "strict",
      stats: { strategy: "output", freePoints: 0 },
      wuxue: {
        healingRequired: false,
        healingCount: 1,
        wuxingLimit: 0,
        primary: { uuid: "Item.fixed", stage: 3 },
        fixed: { wuxue: ["Item.fixed"] }
      }
    },
    system: { stats: { freePoints: { value: 0 } }, resources: {} },
    items: [
      { _id: "run-1", type: "neigong", system: { element: "yin" } },
      { _id: "fixed-1", uuid: "Item.fixed", type: "wuxue", system: {
        category: "wuxue", tier: 1,
        moves: [{ id: "move-1", type: "real", element: "yin", calculation: { scalings: [{ prop: "neixi", ratio: 1 }] } }]
      } }
    ],
    wuxue: [{ itemId: "fixed-1", slotKey: "wuxue:0", coreMove: {
      element: "yin", calculation: { scalings: [{ prop: "neixi", ratio: 1 }] }
    } }],
    neigong: [],
    jingmai: { selected: [] },
    stats: { assigned: {}, freePoints: 0 },
    conflicts: [],
    decisions: [{ slot: "fixed-1", slotKey: "wuxue:wuxue:0:compatibility", relation: "compatibility" }]
  };
  try {
    const evaluation = await evaluateGenerationDraft(draft);
    assert.equal(evaluation.constraints.wuxing, false);
    assert.equal(evaluation.derived.wuxingLimit, 0);
    assert.equal(evaluation.derived.fixedWuxingContribution.total, 1);

    const randomStageDraft = structuredClone(draft);
    randomStageDraft.config.wuxue.primary.stage = null;
    const randomStageEvaluation = await evaluateGenerationDraft(randomStageDraft);
    assert.equal(randomStageEvaluation.derived.fixedWuxingContribution.total, 0);
    assert.equal(randomStageEvaluation.constraints.wuxing, false);

    const result = await manager._evaluateDraft(draft, () => 0.9);
    assert.equal(result.decisions[0].result, "mismatch");
    assert.equal(result.stats.assigned.neixi, 12);
    assert.equal(result.conflicts.some(conflict => conflict.field?.endsWith(".compatibility")), false);
  } finally {
    globalThis.game = previousGame;
    globalThis.CONFIG = previousConfig;
  }
});

test("配套概率按稳定槽位复用同一次投骰", async () => {
  const previousGame = globalThis.game;
  const previousConfig = globalThis.CONFIG;
  class FakeActor {
    constructor(data) {
      this.id = data._id;
      this.uuid = `Actor.${data._id}`;
      this.system = data.system;
      this.items = (data.items || []).map(source => ({
        ...source,
        id: source._id,
        toObject: () => source
      }));
      this.itemTypes = { wuxue: this.items.filter(item => item.type === "wuxue") };
    }

    prepareData() {}
  }
  globalThis.game = { _documentsReady: true };
  globalThis.CONFIG = { Actor: { documentClass: FakeActor } };
  const makeDraft = () => ({
    draftId: "roll-draft",
    evaluationId: "roll-eval",
    requestId: "roll-request",
    configVersion: 1,
    name: "稳定投骰案例",
    actorType: "npc",
    runNeigongId: "run-1",
    runNeigong: { name: "阴功" },
    config: {
      synergyProbability: 50,
      matchStandard: "standard",
      stats: { strategy: "balanced", freePoints: 0 },
      wuxue: { healingRequired: false, healingCount: 1, wuxingLimit: null }
    },
    system: { stats: { liliang: { total: 1 } }, resources: {} },
    items: [
      { _id: "run-1", type: "neigong", system: { element: "yin" } },
      { _id: "wuxue-1", type: "wuxue", system: { category: "wuxue", tier: 1, moves: [] } }
    ],
    wuxue: [{ itemId: "wuxue-1", slotKey: "wuxue:0", coreMove: {
      element: "yang", calculation: { scalings: [{ prop: "liliang", ratio: 1 }] }
    } }],
    neigong: [],
    jingmai: { selected: [] },
    stats: { assigned: {}, freePoints: 0 },
    conflicts: [],
    decisions: [{
      slot: "wuxue-1",
      slotKey: "wuxue:wuxue:0:compatibility",
      relation: "compatibility",
      evaluated: false,
      result: "unevaluated"
    }]
  });
  const manager = new XJZLCharacterGenerationManager();
  const decisionRolls = new Map();
  try {
    const first = await manager._evaluateDraft(makeDraft(), () => 0.9, decisionRolls);
    const second = await manager._evaluateDraft(makeDraft(), () => 0, decisionRolls);
    assert.equal(first.conflicts.some(conflict => conflict.field?.endsWith(".compatibility")), false);
    assert.equal(second.conflicts.some(conflict => conflict.field?.endsWith(".compatibility")), false);
    assert.equal(decisionRolls.size, 2);
  } finally {
    globalThis.game = previousGame;
    globalThis.CONFIG = previousConfig;
  }
});

test("相性和属性适配按稳定槽位的关系类型分别投骰", async () => {
  const previousGame = globalThis.game;
  const previousConfig = globalThis.CONFIG;
  class FakeActor {
    constructor(data) {
      this.id = data._id;
      this.uuid = `Actor.${data._id}`;
      this.system = data.system;
      this.system.stats.freePoints ??= {};
      this.system.stats.freePoints.total = 0;
      this.items = (data.items || []).map(source => ({
        ...source,
        id: source._id,
        system: {
          ...source.system,
          current: source.type === "neigong"
            ? { stats: { liliang: 1, shenfa: 0, neixi: 0, qigan: 0, shencai: 0 } }
            : source.system?.current
        },
        toObject: () => source
      }));
      this.itemTypes = { wuxue: this.items.filter(item => item.type === "wuxue") };
    }

    prepareData() {}
  }
  globalThis.game = { _documentsReady: true };
  globalThis.CONFIG = { Actor: { documentClass: FakeActor } };
  const manager = new XJZLCharacterGenerationManager();
  const draft = {
    draftId: "relation-rolls",
    evaluationId: "relation-rolls-eval",
    requestId: "relation-rolls-request",
    configVersion: 1,
    name: "关系投骰案例",
    actorType: "npc",
    runNeigongId: "run-1",
    config: {
      synergyProbability: 50,
      matchStandard: "strict",
      stats: { strategy: "balanced", freePoints: 0 },
      wuxue: { healingRequired: false, healingCount: 1, wuxingLimit: null }
    },
    system: { stats: { freePoints: { value: 0 } }, resources: {} },
    items: [
      { _id: "run-1", type: "neigong", system: { element: "yin" } },
      { _id: "wuxue-1", type: "wuxue", system: { category: "wuxue", tier: 1, moves: [] } }
    ],
    wuxue: [{ itemId: "wuxue-1", slotKey: "wuxue:0", coreMove: {
      element: "yang", calculation: { scalings: [{ prop: "liliang", ratio: 1 }] }
    } }],
    neigong: [],
    jingmai: { selected: [] },
    stats: { assigned: {}, freePoints: 0 },
    conflicts: [],
    decisions: [{ slot: "wuxue-1", slotKey: "wuxue:wuxue:0:compatibility", relation: "compatibility" }]
  };
  const decisionRolls = new Map([
    ["wuxue:wuxue:0:compatibility", 0.1],
    ["wuxue:wuxue:0:scaling", 0.9]
  ]);
  try {
    const result = await manager._evaluateDraft(draft, () => 0.5, decisionRolls);
    assert.equal(decisionRolls.size, 2);
    assert.equal(result.conflicts.some(conflict => conflict.field?.endsWith(".compatibility")), true);
    assert.equal(result.conflicts.some(conflict => conflict.field?.endsWith(".scaling")), false);
  } finally {
    globalThis.game = previousGame;
    globalThis.CONFIG = previousConfig;
  }
});

test("跟随配套属性分配受独立概率判定控制", async () => {
  const previousGame = globalThis.game;
  const previousConfig = globalThis.CONFIG;
  class FakeActor {
    constructor(data) {
      this.id = data._id;
      this.uuid = `Actor.${data._id}`;
      this.system = data.system;
      this.system.stats.freePoints ??= {};
      this.system.stats.freePoints.total = 6;
      this.items = (data.items || []).map(source => ({ ...source, id: source._id, toObject: () => source }));
      this.itemTypes = { wuxue: this.items.filter(item => item.type === "wuxue") };
    }

    prepareData() {}
  }
  globalThis.game = { _documentsReady: true };
  globalThis.CONFIG = { Actor: { documentClass: FakeActor } };
  const manager = new XJZLCharacterGenerationManager();
  const makeDraft = () => ({
    draftId: "stats-rolls",
    evaluationId: "stats-rolls-eval",
    requestId: "stats-rolls-request",
    configVersion: 1,
    name: "属性投骰案例",
    actorType: "npc",
    runNeigongId: "run-1",
    config: {
      synergyProbability: 50,
      matchStandard: "standard",
      stats: { strategy: "match", freePoints: 0 },
      wuxue: { healingRequired: false, healingCount: 1, wuxingLimit: null }
    },
    system: { stats: { freePoints: { value: 0 } }, resources: {} },
    items: [
      { _id: "run-1", type: "neigong", system: {} },
      { _id: "wuxue-1", type: "wuxue", system: { category: "wuxue", moves: [{ calculation: { scalings: [{ prop: "liliang", ratio: 1 }] } }] } }
    ],
    wuxue: [],
    neigong: [],
    jingmai: { selected: [] },
    stats: { assigned: {}, freePoints: 0 },
    conflicts: [],
    decisions: []
  });
  try {
    const balanced = await manager._evaluateDraft(makeDraft(), () => 0, new Map([["stats:allocation:match", 0.9]]));
    const matched = await manager._evaluateDraft(makeDraft(), () => 0, new Map([["stats:allocation:match", 0.1]]));
    assert.equal(balanced.stats.assigned.liliang, 1);
    assert.equal(matched.stats.assigned.liliang, 6);
  } finally {
    globalThis.game = previousGame;
    globalThis.CONFIG = previousConfig;
  }
});

test("批量创建为本次生成建立 Actor 文件夹并把文件夹写入 Actor", async () => {
  const previousGame = globalThis.game;
  const previousConfig = globalThis.CONFIG;
  let folderPayload;
  let actorPayload;
  const fakeActor = payload => ({
    id: "actor-1",
    uuid: "Actor.actor-1",
    system: {
      resources: { hp: { value: 10, max: 10 }, mp: { value: 0, max: 0 }, rage: { value: 0, max: 10 } },
      stats: { freePoints: { total: 0 } }
    },
    items: (payload.items || []).map(item => ({ ...item, id: item._id, toObject: () => item })),
    itemTypes: { wuxue: [] },
    async update() {},
    prepareData() {}
  });
  globalThis.game = { user: { isGM: true } };
  globalThis.CONFIG = {
    Folder: { documentClass: { async create(data) { folderPayload = data; return { id: "folder-1" }; } } },
    Actor: { documentClass: { async create(data) { actorPayload = data; return fakeActor(data); } } }
  };
  const manager = new XJZLCharacterGenerationManager();
  const draft = {
    draftId: "draft-create-1",
    evaluation: { valid: true },
    name: "批量测试",
    actorType: "npc",
    evaluationId: "evaluation-1",
    system: { resources: {}, stats: {} },
    items: [
      { _id: "run-1", type: "neigong", system: {} },
      { _id: "wuxue-1", uuid: "Compendium.xjzl-system.wuxue.fixed", type: "wuxue", system: { category: "wuxue", moves: [] } }
    ],
    runNeigongId: "run-1",
    stats: { assigned: {}, availableFreePoints: 0 },
    config: { namePrefix: "批量测试", wuxue: { healingRequired: false, healingCount: 1, wuxingLimit: null } }
  };
  try {
    const results = await manager.createAll([draft]);
    assert.equal(results[0].status, "success");
    assert.equal(folderPayload.type, "Actor");
    assert.match(folderPayload.name, /批量测试/);
    assert.equal(actorPayload.folder, "folder-1");
    assert.equal(actorPayload.items.find(item => item._id === "wuxue-1")._stats.compendiumSource, "Compendium.xjzl-system.wuxue.fixed");
  } finally {
    globalThis.game = previousGame;
    globalThis.CONFIG = previousConfig;
  }
});

test("生成器保留原始表单数值交给管理器校验，而不是提前截断", async () => {
  const previousFoundry = globalThis.foundry;
  globalThis.foundry = {
    applications: {
      api: {
        ApplicationV2: class {},
        HandlebarsApplicationMixin: Base => Base
      }
    }
  };
  try {
    const { XJZLCharacterGeneratorApp } = await import("../module/applications/character-generator.mjs?raw-form-test");
    const app = Object.create(XJZLCharacterGeneratorApp.prototype);
    app.config = normalizeGenerationConfig({
      quantity: 1,
      wuxue: { primary: {}, additionalRandomMin: 0, additionalRandomMax: 0 },
      equipment: { armorMinCount: 0 }
    });
    const values = {
      quantity: { value: "1.5" },
      synergyProbability: { value: "100" },
      matchStandard: { value: "standard" },
      matchAllRandomWuxue: { checked: true },
      runTier: { value: "" },
      runStage: { value: "" },
      runElement: { value: "auto" },
      additionalCount: { value: "0" },
      neigongAdditionalRandomMin: { value: "0" },
      neigongAdditionalRandomMax: { value: "0" },
      jingmaiMode: { value: "none" },
      jingmaiTotal: { value: "" },
      jingmaiYin: { value: "0" },
      jingmaiYang: { value: "0" },
      primaryTier: { value: "" },
      primaryStage: { value: "" },
      wuxueAdditionalRandomMin: { value: "4" },
      wuxueAdditionalRandomMax: { value: "2" },
      allocation: { value: "independent" },
      sanshouCount: { value: "0" },
      qinggongCount: { value: "0" },
      zhenfaCount: { value: "0" },
      healingCount: { value: "1" },
      healingUuids: { value: "" },
      wuxingLimit: { value: "" },
      statsStrategy: { value: "balanced" },
      freePoints: { value: "0" },
      weaponType: { value: "auto" },
      weaponQuality: { value: "0" },
      armorQuality: { value: "0" },
      armorMinCount: { value: "1.5" },
      armorFillMode: { value: "minimum" },
      armorRandomExtraMax: { value: "0" },
      armorUuids: { value: "" }
    };
    app.element = {
      elements: values,
      querySelectorAll: () => [],
      querySelector: () => null
    };
    const raw = app._readForm();
    const normalized = app._readNormalizedForm();
    assert.equal(raw.quantity, "1.5");
    assert.equal(raw.wuxue.additionalRandomMin, "4");
    assert.equal(raw.wuxue.additionalRandomMax, "2");
    assert.equal(normalized.quantity, 1);
    assert.equal(normalized.matchAllRandomWuxue, true);
    assert.equal(normalized.wuxue.additionalRandomMin, 4);
    assert.equal(normalized.wuxue.additionalRandomMax, 4);
    assert.equal(app._lastRawForm.quantity, "1.5");
    assert.equal(app._lastRawForm.wuxue.additionalRandomMin, "4");
    assert.equal(app._lastRawForm.wuxue.additionalRandomMax, "2");
    assert.equal(app._lastRawForm.equipment.armorMinCount, "1.5");
  } finally {
    globalThis.foundry = previousFoundry;
  }
});

test("生成期间资源选择入口拒绝修改，避免旧草案重新获得创建资格", async () => {
  const previousFoundry = globalThis.foundry;
  const previousUi = globalThis.ui;
  globalThis.foundry = {
    applications: {
      api: {
        ApplicationV2: class {},
        HandlebarsApplicationMixin: Base => Base
      }
    }
  };
  let warning = "";
  globalThis.ui = { notifications: { warn(message) { warning = message; } } };
  try {
    const { XJZLCharacterGeneratorApp } = await import("../module/applications/character-generator.mjs?busy-browser-test");
    const app = Object.create(XJZLCharacterGeneratorApp.prototype);
    app.busy = true;
    let prevented = false;
    await app._onOpenBrowser({ preventDefault() { prevented = true; } }, { dataset: { kind: "neigongRange", type: "neigong" } });
    assert.equal(prevented, true);
    assert.match(warning, /生成资源/);

    app.busy = false;
    app.config = normalizeGenerationConfig({
      wuxue: { primary: {}, fixed: { sanshou: ["Item.sanshou"], qinggong: ["Item.qinggong"] } },
      equipment: { armorUuids: ["Item.armor"] }
    });
    app.result = { valid: true };
    app.dirty = false;
    app.element = {
      elements: {
        quantity: { value: "5" },
        statsStrategy: { value: "balanced" },
        freePoints: { value: "12" }
      },
      querySelectorAll: () => [],
      querySelector: () => null
    };
    let renderCount = 0;
    app.render = () => { renderCount += 1; };
    app._onClearResource({ preventDefault() {} }, { dataset: { kind: "sanshou" } });
    app._onClearResource({ preventDefault() {} }, { dataset: { kind: "armor" } });
    assert.deepEqual(app.config.wuxue.fixed.sanshou, []);
    assert.deepEqual(app.config.equipment.armorUuids, []);
    assert.deepEqual(app.config.wuxue.fixed.qinggong, ["Item.qinggong"]);
    assert.equal(app.config.quantity, 5);
    assert.equal(app.config.stats.freePoints, 12);
    assert.equal(app.result, null);
    assert.equal(app.dirty, true);
    assert.equal(renderCount, 2);
  } finally {
    globalThis.foundry = previousFoundry;
    globalThis.ui = previousUi;
  }
});
