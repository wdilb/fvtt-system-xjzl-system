/**
 * 形状生成器边界断言（Node 直跑，无测试框架）
 * 运行：node tests/aura-shapes.test.mjs
 * 覆盖：1-2-2-2 计费口径（直邻/斜邻/二斜等距）、若干半径的期望格子集合、
 *       矩形与 90° 吸附旋转、排序去重与入参校验。
 */
import assert from "node:assert/strict";
import {
    gridStepDistance,
    generateCircleOffsets,
    generateRectangleOffsets,
    rotateOffsets90,
    snapDirectionToQuarterTurns
} from "../module/utils/aura-shapes.mjs";

let passed = 0;

/** 单个断言组的简报输出 */
function group(name) {
    passed += 1;
    console.log(`  ✓ ${name}`);
}

/* -------------------------------------------- */
/*  1-2-2-2 计费口径                              */
/* -------------------------------------------- */

assert.equal(gridStepDistance(0, 0), 0);
assert.equal(gridStepDistance(1, 0), 1, "直邻 = 1");
assert.equal(gridStepDistance(0, 1), 1);
assert.equal(gridStepDistance(1, 1), 1, "斜邻（首斜）= 1，1-2-2-2 特征");
assert.equal(gridStepDistance(2, 2), 3, "二斜 = 3（1+2）");
assert.equal(gridStepDistance(3, 3), 5, "三斜 = 5（1+2+2）");
assert.equal(gridStepDistance(2, 2), gridStepDistance(3, 0), "二斜等距：两斜与三直同为 3");
assert.equal(gridStepDistance(1, 1), gridStepDistance(1, 0), "斜邻与直邻同为 1");
assert.equal(gridStepDistance(2, 1), 2, "(2,1) 混合步 = 2");
assert.equal(gridStepDistance(2, 0), 2);
assert.equal(gridStepDistance(3, 1), 3);
assert.equal(gridStepDistance(10, 1), 10);
assert.equal(gridStepDistance(-2, 3), 4, "象限对称");
group("1-2-2-2 计费：直邻/斜邻/二斜等距/混合步/象限对称");

/* -------------------------------------------- */
/*  圆形：半径 0～3 期望格子集合                    */
/* -------------------------------------------- */

const key = o => `${o.i}.${o.j}`;
const keySet = offsets => new Set(offsets.map(key));
const makeBox = r => {
    const set = new Set();
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) set.add(`${i}.${j}`);
    return set;
};

// r=0：仅中心格
assert.deepEqual(generateCircleOffsets(0), [{i: 0, j: 0}]);
group("半径 0：仅中心格");

// r=1：首斜计 1，中心周围 3×3 均在范围内。
const r1 = generateCircleOffsets(1);
assert.equal(r1.length, 9);
assert.deepEqual(keySet(r1), makeBox(1));
group("半径 1：3×3 全覆盖（首斜计 1）共 9 格");

// r=2：5×5 减四个 (±2,±2) 角（cost=3）= 21 格
const r2 = generateCircleOffsets(2);
assert.equal(r2.length, 21);
const expected2 = makeBox(2);
for (const [i, j] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) expected2.delete(`${i}.${j}`);
assert.deepEqual(keySet(r2), expected2, "半径 2 = 5×5 减四个角格");
assert.ok(keySet(r2).has("2.1") && keySet(r2).has("-2.1") && keySet(r2).has("1.2"), "(2,1) 型计 2 应在内");
group("半径 2：21 格，(±2,±2) 角格排除、(2,1) 型保留");

// r=3：手算 37 格；边界样例：(2,2)=3 入、(3,1)=3 入、(3,2)=4 出、(3,3)=5 出
const r3 = generateCircleOffsets(3);
assert.equal(r3.length, 37);
for (const cell of ["2.2", "3.0", "3.1", "1.3", "0.3"]) {
    assert.ok(keySet(r3).has(cell), `半径 3 应含 ${cell}`);
}
for (const cell of ["3.2", "2.3", "-3.2", "3.3", "-3.-3"]) {
    assert.ok(!keySet(r3).has(cell), `半径 3 不应含 ${cell}`);
}
group("半径 3：37 格，含 (2,2)/(3,1) 排除 (3,2)/(3,3)");

// 半径只接受非负整数，避免小数边界出现两种覆盖口径。
for (const bad of [0.9, 1.5, 2.5, 2.95, -1, NaN, Infinity]) {
    assert.throws(() => generateCircleOffsets(bad), `非整数/非法半径 ${bad} 应被拒绝`);
}
assert.doesNotThrow(() => generateCircleOffsets(0));
group("小数/非法半径按整数契约显式拒绝");

/* -------------------------------------------- */
/*  圆形：r=20 万剑归宗规模                       */
/* -------------------------------------------- */

const r20 = generateCircleOffsets(20);
assert.equal(r20.length, 921, "半径 20 应覆盖 921 格");
// 完备性：[-20..20]² 内每个 cost ≤ 20 的格子必须在集合内，反之集合内无多余额
const expected20 = new Set();
for (let j = -20; j <= 20; j++) {
    for (let i = -20; i <= 20; i++) {
        if (gridStepDistance(i, j) <= 20) expected20.add(`${i}.${j}`);
    }
}
assert.equal(r20.length, expected20.size);
assert.deepEqual(keySet(r20), expected20);
group(`半径 20：${r20.length} 格，与包围盒逐格判定一致`);

/* -------------------------------------------- */
/*  排序与去重                                    */
/* -------------------------------------------- */

const sorted = generateCircleOffsets(5);
for (let k = 1; k < sorted.length; k++) {
    const prev = sorted[k - 1], cur = sorted[k];
    assert.ok((cur.j > prev.j) || (cur.j === prev.j && cur.i > prev.i), "行优先排序");
}
assert.equal(new Set(sorted.map(key)).size, sorted.length, "无重复格");
group("输出按行优先排序且无重复");

/* -------------------------------------------- */
/*  矩形                                         */
/* -------------------------------------------- */

assert.deepEqual(generateRectangleOffsets({width: 3, height: 1}), [{i: 0, j: 0}, {i: 1, j: 0}, {i: 2, j: 0}], "3×1 默认锚角向东南展开");
assert.deepEqual(generateRectangleOffsets({width: 3, height: 3, anchorX: 1, anchorY: 1}),
    [{i: -1, j: -1}, {i: 0, j: -1}, {i: 1, j: -1}, {i: -1, j: 0}, {i: 0, j: 0}, {i: 1, j: 0}, {i: -1, j: 1}, {i: 0, j: 1}, {i: 1, j: 1}],
    "3×3 居中锚");
assert.equal(generateRectangleOffsets({width: 3, height: 3, anchorX: 0, anchorY: 0}).length, 9, "3×3 角锚共 9 格");
assert.deepEqual(generateRectangleOffsets({width: 1, height: 1}), [{i: 0, j: 0}], "1×1 即锚格");
assert.throws(() => generateRectangleOffsets({width: 0, height: 1}));
assert.throws(() => generateRectangleOffsets({width: 3, height: 1, anchorX: 3}));
assert.throws(() => generateRectangleOffsets({width: 3.5, height: 1}));
group("矩形：3×1 角锚、3×3 居中/角锚、1×1 与入参校验");

/* -------------------------------------------- */
/*  90° 吸附旋转                                  */
/* -------------------------------------------- */

const east = generateRectangleOffsets({width: 3, height: 1});
assert.deepEqual(rotateOffsets90(east, 1), [{i: 0, j: 0}, {i: 0, j: 1}, {i: 0, j: 2}], "3×1 东向顺旋 1 次变南向");
assert.deepEqual(rotateOffsets90(east, 2), [{i: -2, j: 0}, {i: -1, j: 0}, {i: 0, j: 0}], "顺旋 2 次变西向（行优先排序）");
assert.deepEqual(rotateOffsets90(east, 3), [{i: 0, j: -2}, {i: 0, j: -1}, {i: 0, j: 0}], "顺旋 3 次变北向（行优先排序）");
assert.deepEqual(rotateOffsets90(east, 0), east, "0 转原样");
assert.deepEqual(rotateOffsets90(east, 4), east, "4 转归一化为原样");
assert.deepEqual(rotateOffsets90(east, -1), rotateOffsets90(east, 3), "负数=逆时针");
assert.deepEqual(rotateOffsets90(east, 5), rotateOffsets90(east, 1), "超圈归一化");

// 锚格旋转后仍在 (0,0)；旋转不改格数；整数格保持整数
const centered3x3 = generateRectangleOffsets({width: 3, height: 3, anchorX: 1, anchorY: 1});
const rotated3x3 = rotateOffsets90(centered3x3, 1);
assert.equal(rotated3x3.filter(o => o.i === 0 && o.j === 0).length, 1, "锚格 (0,0) 旋转不动");
assert.deepEqual(keySet(rotated3x3), keySet(centered3x3), "3×3 居中旋转自对称");
assert.ok(rotated3x3.every(o => Number.isInteger(o.i) && Number.isInteger(o.j)), "旋转后仍为整数格（90° 吸附）");
assert.equal(rotateOffsets90(centered3x3, 2).length, 9);
assert.deepEqual(keySet(rotateOffsets90(centered3x3, 2)), keySet(centered3x3));

// 旋转不修改入参
const before = JSON.stringify(east);
rotateOffsets90(east, 1);
assert.equal(JSON.stringify(east), before, "入参不被修改");
group("90° 旋转：东南西北四向、归一化、锚格不动、整数吸附");

/* -------------------------------------------- */
/*  朝向吸附                                      */
/* -------------------------------------------- */

assert.equal(snapDirectionToQuarterTurns(0), 0);
assert.equal(snapDirectionToQuarterTurns(90), 1);
assert.equal(snapDirectionToQuarterTurns(180), 2);
assert.equal(snapDirectionToQuarterTurns(270), 3);
assert.equal(snapDirectionToQuarterTurns(-90), 3, "负角度归一化");
assert.equal(snapDirectionToQuarterTurns(360), 0);
assert.equal(snapDirectionToQuarterTurns(359), 0, "接近整圈回绕");
assert.equal(snapDirectionToQuarterTurns(45), 1, "45° 边界按四舍五入进位");
assert.equal(snapDirectionToQuarterTurns(44), 0);
assert.equal(snapDirectionToQuarterTurns(720 + 90), 1, "超一圈角度");
group("朝向 90° 吸附：整角/负角/回绕/边界");

console.log(`\n全部 ${passed} 组断言通过。`);
