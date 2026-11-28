/**
 * Rutz's Tactics View (rutz-diorama) 兼容层回归测试。
 * 覆盖：零侵入基线、2.5D 左键空地框选补丁、1-2-2-2 预览成本同步、高差地形倍率、
 * 屏幕包围框与拾取、颜色规范化及飘字转发。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createContext, runInContext, SourceTextModule } from "node:vm";
import {
    cancelDioramaRightClickDrag,
    floatDioramaText,
    getDioramaCanvasRect,
    getDioramaTokenScreenBounds,
    getDioramaTokenScreenPoint,
    initDioramaCompat,
    installDioramaBoxSelectPatch,
    installDioramaCellClickPatch,
    installDioramaFootprintPickPatch,
    installDioramaRendererFxPatch,
    installMovementPreviewPatch,
    isDioramaModuleActive,
    isDioramaOpen,
    normalizeCssColor,
    panDioramaBy,
    pickDioramaToken,
    playDioramaHitEffect,
    resolveAuraLabelScreenPos,
    stopDioramaHitEffects,
    syncMovementPathPreviewResult
} from "../module/utils/diorama-compat.mjs";
import { TargetManager } from "../module/managers/target-manager.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

/** 备份并恢复 globalThis 上的测试桩属性。 */
function withGlobals(overrides, fn) {
    const keys = Object.keys(overrides);
    const previous = new Map();
    for (const key of keys) {
        previous.set(key, Object.prototype.hasOwnProperty.call(globalThis, key) ? globalThis[key] : undefined);
        globalThis[key] = overrides[key];
    }
    try {
        return fn();
    } finally {
        for (const key of keys) {
            const val = previous.get(key);
            if (val === undefined) delete globalThis[key];
            else globalThis[key] = val;
        }
    }
}

test("未激活 rutz-diorama 时 initDioramaCompat 零侵入且状态为关闭", () => {
    const registeredHooks = [];
    const tokenProto = {
        measureMovementPath() {
            return { distance: 1, cost: 1, segments: [{ distance: 1, cost: 1 }] };
        }
    };
    const origMethod = tokenProto.measureMovementPath;

    withGlobals({
        game: {
            modules: { get: () => ({ active: false }) },
            settings: { get: (_s, k) => k === "customDistanceRule" }
        },
        Hooks: {
            on: (name, cb) => { registeredHooks.push([name, cb]); }
        },
        CONFIG: { Token: { objectClass: { prototype: tokenProto } } }
    }, () => {
        assert.equal(isDioramaModuleActive(), false);
        assert.equal(isDioramaOpen(), false);
        initDioramaCompat();
        assert.equal(registeredHooks.length, 0, "未激活模块不应注册任何 Hook");
        assert.equal(tokenProto.measureMovementPath, origMethod, "未激活模块不应包装 Token 原型");
    });
});

test("2.5D 左键空地框选补丁：条件矩阵与幂等性", () => {
    class FakeDioramaView {
        constructor(cfg = {}) {
            this.cfg = cfg;
            this.editing = false;
            this.stamping = false;
            this.regionMode = false;
            this.wallMode = false;
            this.wallPaint = false;
            this._pickOn = false;
            this._tplOn = false;
            this._inkOn = false;
            this._tileOn = false;
            this._lightOn = false;
            this._drag = null;
        }
        _down(e) {
            this._drag = {
                button: e.button,
                pointerType: e.pointerType,
                hit: e.mockHit ?? { type: "cell", col: 0, row: 0 },
                tokenId: e.mockTokenId ?? null,
                ruler: e.mockRuler ?? null,
                box: Boolean(e.shiftKey && e.mockHit?.type !== "door" && this.cfg.onBoxSelect)
            };
        }
    }

    const view = new FakeDioramaView({ onBoxSelect: () => {} });
    assert.equal(installDioramaBoxSelectPatch(view), true);
    const wrapped = FakeDioramaView.prototype._down;
    // 重复调用保持幂等，不叠包
    assert.equal(installDioramaBoxSelectPatch(view), true);
    assert.equal(FakeDioramaView.prototype._down, wrapped);

    const run = (eventPatch = {}, viewPatch = {}) => {
        const inst = new FakeDioramaView({ onBoxSelect: () => {}, ...viewPatch.cfg });
        Object.assign(inst, viewPatch);
        inst._down({
            button: 0,
            pointerType: "mouse",
            ctrlKey: false,
            metaKey: false,
            altKey: false,
            shiftKey: false,
            ...eventPatch
        });
        return inst._drag;
    };

    // 1. 普通战术视图左键空地 -> 开启框选
    assert.equal(run().box, true);
    // 2. 左键点击不可拖拽的敌方 Token -> 开启框选
    assert.equal(run({ mockHit: { type: "token", id: "enemy" }, mockTokenId: null }).box, true);

    // 3. 下列情况全部保留原行为，不转为框选
    assert.equal(run({ mockHit: { type: "token", id: "mine" }, mockTokenId: "mine" }).box, false, "可拖拽己方 Token 不改框选");
    assert.equal(run({ mockHit: { type: "door", id: "d1" } }).box, false, "点击门不触发框选");
    assert.equal(run({ pointerType: "touch" }).box, false, "触屏不触发框选");
    assert.equal(run({ button: 2 }).box, false, "右键不触发框选");
    assert.equal(run({ button: 1 }).box, false, "中键不触发框选");
    assert.equal(run({ ctrlKey: true, mockRuler: [0, 0] }).box, false, "Ctrl 标尺不触发框选");
    assert.equal(run({ metaKey: true }).box, false, "Meta 键不触发框选");
    assert.equal(run({ altKey: true }).box, false, "Alt 键不触发框选");
    assert.equal(run({}, { cfg: { onBoxSelect: null } }).box, false, "缺少 onBoxSelect 回调不触发框选");

    for (const flag of ["editing", "stamping", "regionMode", "_pickOn", "_tplOn", "_inkOn", "_tileOn", "_lightOn"]) {
        assert.equal(run({}, { [flag]: true }).box, false, `${flag} 模式下不触发框选`);
    }
    assert.equal(run({}, { wallMode: true, wallPaint: true }).box, false, "涂墙模式下不触发框选");
});

test("syncMovementPathPreviewResult 与 measureMovementPath 2.5D 预览同步", () => {
    const makeRaw = () => {
        const rawSeg0 = { distance: 1, cost: 1 };
        const rawSeg1 = { distance: 2, cost: 2 };
        return {
            distance: 3,
            cost: 2,
            segments: [rawSeg0, rawSeg1],
            waypoints: [
                { x: 0, y: 0, distance: 0, cost: 0 },
                { x: 100, y: 100, distance: 1, cost: 1, backward: rawSeg0 },
                { x: 200, y: 200, distance: 2, cost: 2, backward: rawSeg1 }
            ]
        };
    };

    const raw = makeRaw();
    const synced = syncMovementPathPreviewResult(raw);
    assert.equal(synced, raw, "应在同一份测量结果上同步更新，保留原有引用");
    assert.equal(synced.distance, 3);
    assert.equal(synced.cost, 3);
    assert.deepEqual(synced.waypoints.map(w => w.cost), [0, 1, 3]);
    assert.deepEqual(synced.waypoints.map(w => w.distance), [0, 1, 3]);
    assert.equal(synced.waypoints[2].backward, synced.segments[1]);
    assert.equal(synced.waypoints[2].backward.cost, 2);

    // 困难地形段（首斜1 + 二斜2*2=4 -> 总5）
    const difficult = syncMovementPathPreviewResult({
        distance: 5,
        cost: 3,
        segments: [{ distance: 1, cost: 1 }, { distance: 4, cost: 4 }],
        waypoints: [{ distance: 0, cost: 0 }, { distance: 1, cost: 1 }, { distance: 3, cost: 3 }]
    });
    assert.equal(difficult.cost, 5);
    assert.deepEqual(difficult.waypoints.map(w => w.cost), [0, 1, 5]);

    const apiState = { isOpen: true, view: { paused: false } };
    const tokenProto = {
        document: { movementHistory: null },
        measureMovementPath(waypoints = []) {
            if (waypoints.length >= 2) {
                const segs = [];
                let totalDist = 0;
                let globalDiag = 0;
                const wps = [{ ...waypoints[0], distance: 0, cost: 0 }];
                for (let i = 0; i < waypoints.length - 1; i++) {
                    const p0 = waypoints[i];
                    const p1 = waypoints[i + 1];
                    const nx = Math.round(Math.abs((p1.x ?? 0) - (p0.x ?? 0)) / 100);
                    const ny = Math.round(Math.abs((p1.y ?? 0) - (p0.y ?? 0)) / 100);
                    const nz = Math.round(Math.abs((p1.elevation ?? 0) - (p0.elevation ?? 0)));
                    const diag = Math.min(nx, ny);
                    const straight = Math.abs(ny - nx);
                    let segGrid = straight + diag * 2;
                    if (globalDiag === 0 && diag > 0) segGrid -= 1;
                    globalDiag += diag;
                    const stdSteps = Math.max(nx, ny, nz);
                    const terrainDiff = Number(p1.terrain?.difficulty) || 1;
                    // 复现 Foundry V14 交互细节：若输入路点自带历史固定 cost，核心将之当成 segment.cost，系统 1-2-2-2 会误除 stdSteps 成倍放大；
                    // 并且 Foundry 会建立 wp[i+1].backward = seg 引用
                    const coreCost = typeof p1.cost === "number" ? p1.cost : stdSteps * terrainDiff;
                    const factor = stdSteps > 0 ? coreCost / stdSteps : 1;
                    const segCost = nz > 0 && nz > Math.max(nx, ny)
                        ? stdSteps * terrainDiff
                        : segGrid * factor;
                    totalDist += segCost;
                    const seg = { distance: segCost, cost: segCost };
                    segs.push(seg);
                    wps[i].forward = seg;
                    wps.push({ ...p1, distance: totalDist, cost: totalDist, backward: seg });
                }
                return { distance: totalDist, cost: totalDist, segments: segs, waypoints: wps };
            }
            return makeRaw();
        }
    };
    const docProto = {
        measureMovementPath() {
            return makeRaw();
        }
    };

    withGlobals({
        CONST: { GRID_DIAGONALS: { EQUIDISTANT: 1, APPROXIMATE: 2 } },
        canvas: { grid: { diagonals: 1 } },
        game: {
            modules: { get: id => (id === "rutz-diorama" ? { active: true, api: apiState } : null) },
            settings: { get: (_s, k) => k === "customDistanceRule" }
        }
    }, () => {
        assert.equal(installMovementPreviewPatch(tokenProto), true);
        // 幂等校验
        assert.equal(installMovementPreviewPatch(tokenProto), true);
        assert.equal(installMovementPreviewPatch(docProto, { isDocFallback: true }), true);

        // 1. 2.5D 打开 + preview: true + EQUIDISTANT -> 重写 cost
        const resOpen = tokenProto.measureMovementPath([], { preview: true });
        assert.equal(resOpen.cost, 3);
        assert.deepEqual(resOpen.waypoints.map(w => w.cost), [0, 1, 3]);

        // 1b. 2.5D 预览存在高差（elevation=0 -> 4 -> 8）与困难地形 -> 高差不拉高成本，且还原 waypoints[].elevation 与保持 backward 引用
        const elevWps = [
            { x: 0, y: 0, elevation: 0 },
            { x: 100, y: 100, elevation: 4, terrain: { difficulty: 2 } },
            { x: 200, y: 200, elevation: 8, terrain: { difficulty: 1 } }
        ];
        const resElev = tokenProto.measureMovementPath(elevWps, { preview: true });
        assert.equal(resElev.cost, 4, "2.5D 预览入口应剥离高差步数（首斜1*2 + 二斜2*1 = 4），保留平面与地形倍率");
        assert.deepEqual(resElev.waypoints.map(w => w.elevation), [0, 4, 8], "应还原返回的路点原始高程");
        assert.equal(resElev.waypoints[1].backward, resElev.segments[0]);

        // 1c. 本回合移动历史已连走 3 斜步 (w1.cost=1, w2.cost=2, w3=2 -> prior=5) 再预览第 4 斜步 -> 已走 5、总计 7（不重复套用 1-2-2-2 成 7 和 9）
        const histWps = [
            { x: 0, y: 0, cost: 0 },
            { x: 100, y: 100, cost: 1 },
            { x: 200, y: 200, cost: 2 },
            { x: 300, y: 300 },
            { x: 400, y: 400 }
        ];
        const resHist = tokenProto.measureMovementPath(histWps, { preview: true });
        assert.equal(resHist.waypoints[3].cost, 5, "前 3 个已走斜步累计成本应严格为 5（非 7）");
        assert.equal(resHist.cost, 7, "预览第 4 斜步总成本应严格为 7（非 9）");
        assert.deepEqual(resHist.segments.map(s => s.cost), [1, 2, 2, 2]);
        assert.equal(resHist.waypoints[2].backward, resHist.segments[1]);
        assert.equal(resHist.waypoints[2].backward.cost, 2);

        // 1d. 若历史某步本身跨 2 倍困难地形 (w2.cost = 4)，仍应精确保留固定成本 4 而不重复放大成 8，且 backward.cost 同为 4
        const diffHistWps = [
            { x: 0, y: 0, cost: 0 },
            { x: 100, y: 100, cost: 1 },
            { x: 200, y: 200, cost: 4 },
            { x: 300, y: 300 }
        ];
        const resDiffHist = tokenProto.measureMovementPath(diffHistWps, { preview: true });
        assert.equal(resDiffHist.cost, 7, "困难地形历史固定成本 4 应保留（1 + 4 + 2 = 7）");
        assert.equal(resDiffHist.distance, 5, "物理/网格步长距离仍应保持干净 1-2-2 合计 5");
        assert.equal(resDiffHist.segments[1].cost, 4);
        assert.equal(resDiffHist.waypoints[2].backward, resDiffHist.segments[1]);
        assert.equal(resDiffHist.waypoints[2].backward.cost, 4, "waypoints[2].backward.cost 必须与 segments[1].cost 完全一致");

        // 1e. rutz-diorama 用新起点替换最后一个历史路点而丢失其固定 cost 时，必须从 doc.movementHistory 补齐接合点成本
        tokenProto.document.movementHistory = [
            { x: 0, y: 0, cost: 0 },
            { x: 100, y: 0, cost: 2 } // 上一段困难地形直行花费 2
        ];
        const junctionWps = [
            { x: 0, y: 0, cost: 0 },
            { x: 100, y: 0 }, // rutz-diorama 新起点覆盖了 hist[1]，未带 cost
            { x: 200, y: 0 }  // 再预览普通直行一步 (cost 1)
        ];
        const resJunction = tokenProto.measureMovementPath(junctionWps, { preview: true });
        assert.equal(resJunction.waypoints[1].cost, 2, "接合点应从 movementHistory 补齐上一段固定成本 2（非普通地形重算 1）");
        assert.equal(resJunction.cost, 3, "预览直行一步总成本应为 2 + 1 = 3（非 2）");
        assert.equal(resJunction.segments[0].cost, 2);
        assert.equal(resJunction.waypoints[1].backward, resJunction.segments[0]);
        assert.equal(resJunction.waypoints[1].backward.cost, 2);
        tokenProto.document.movementHistory = null;

        // 2. preview: false（2D 正式移动提交）-> 不修改 cost，也不拉平高差
        const resCommit = tokenProto.measureMovementPath([], { preview: false });
        assert.equal(resCommit.cost, 2);
        assert.equal(tokenProto.measureMovementPath(elevWps, { preview: false }).cost, 12);

        // 3. TokenDocument 兜底路径（mod 调用时不传 options.preview）-> 重写 cost
        const resDoc = docProto.measureMovementPath([]);
        assert.equal(resDoc.cost, 3);

        // 4. 2.5D 视图关闭/暂停 -> 不修改
        apiState.isOpen = false;
        assert.equal(tokenProto.measureMovementPath([], { preview: true }).cost, 2);
        assert.equal(tokenProto.measureMovementPath(elevWps, { preview: true }).cost, 12);
        apiState.isOpen = true;
        apiState.view.paused = true;
        assert.equal(tokenProto.measureMovementPath([], { preview: true }).cost, 2);

        // 5. 非 EQUIDISTANT 对角线规则 -> 不修改
        apiState.view.paused = false;
        globalThis.canvas.grid.diagonals = 2;
        assert.equal(tokenProto.measureMovementPath([], { preview: true }).cost, 2);
    });
});

test("SquareGrid.prototype.measurePath 保留 2D 原算法：非整格中心偏差 1.25 格仍为 1 且支持地形倍率", async () => {
    const context = createContext({
        terrainDifficulty: 1,
        unitDist: 1
    });
    runInContext(`
        const hooks = [];
        globalThis.Hooks = {
            once: (event, callback) => hooks.push({ event, callback }),
            on: () => {}
        };
        globalThis.console = { log() {}, warn() {}, error(...args) { throw new Error(args.join(" ")); } };
        class Document {}
        class Actor extends Document {}
        class Item extends Document {}
        class ActiveEffect extends Document {}
        class Combat extends Document {}
        class ApplicationV2 { static DEFAULT_OPTIONS = {}; }
        class TypeDataModel {}
        class Field {}
        class SquareGrid {
            constructor() {
                this.diagonals = 1;
                this.distance = globalThis.unitDist;
            }
            measurePath(waypoints) {
                const segments = [];
                let totalDist = 0;
                let totalCost = 0;
                for (let i = 0; i < waypoints.length - 1; i++) {
                    const p0 = waypoints[i];
                    const p1 = waypoints[i + 1];
                    const dx = Math.abs(p1.x - p0.x) / 100;
                    const dy = Math.abs(p1.y - p0.y) / 100;
                    // 复现 Foundry 核心语义：distance 按像素中心欧氏距离，cost 按经过的整格步数计费
                    const dist = Math.hypot(dx, dy) * globalThis.unitDist;
                    const gridSteps = Math.max(Math.round(dx), Math.round(dy));
                    const cost = gridSteps * globalThis.unitDist * globalThis.terrainDifficulty;
                    segments.push({ distance: dist, cost });
                    totalDist += dist;
                    totalCost += cost;
                }
                return { segments, distance: totalDist, cost: totalCost };
            }
        }
        const collection = { registerSheet() {}, unregisterSheet() {} };
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
            REGION_EVENTS: {}
        };
        globalThis.foundry = {
            abstract: { Document, TypeDataModel },
            data: { fields: new Proxy({}, { get: () => Field }), regionBehaviors: { RegionBehaviorType: class {} } },
            grid: { SquareGrid },
            documents: { Combat, collections: { Actors: collection, Items: collection } },
            applications: {
                api: { ApplicationV2, HandlebarsApplicationMixin: base => base, DialogV2: class {} },
                apps: { DocumentSheetConfig: { registerSheet() {}, unregisterSheet() {} } },
                sheets: new Proxy({}, { get: () => ApplicationV2 }),
                ui: { GamePause: ApplicationV2 },
                handlebars: { renderTemplate: async () => "", loadTemplates: async () => {} }
            },
            utils: {
                getProperty: (o, k) => k.split(".").reduce((v, p) => v?.[p], o),
                isPlainObject: v => v?.constructor === Object,
                deepClone: v => JSON.parse(JSON.stringify(v)),
                randomID: () => "test", debounce: fn => fn, mergeObject: (a, b) => Object.assign(a, b)
            }
        };
        globalThis.game = {
            system: { version: "test" },
            user: { id: "u1", isGM: true, targets: new Set() },
            users: { activeGM: null }, packs: [],
            i18n: { localize: k => k, format: k => k },
            settings: {
                register() {},
                get: (_s, k) => k === "customDistanceRule"
            }
        };
        globalThis.window = { innerWidth: 1600, innerHeight: 900, addEventListener() {} };
        globalThis.document = { addEventListener() {}, getElementById: () => null };
        globalThis.ui = { notifications: { info() {}, warn() {}, error(m) { throw new Error(m); } } };
        globalThis.canvas = { dimensions: { size: 100, distance: 1 } };
        globalThis.Handlebars = { registerHelper() {}, SafeString: class {} };
        globalThis.__emitInit = async () => {
            for (const h of hooks.filter(x => x.event === "init")) await h.callback();
        };
    `, context);

    const modules = new Map();
    const load = filename => {
        if (!modules.has(filename)) {
            modules.set(filename, new SourceTextModule(readFileSync(filename, "utf8"), {
                context,
                identifier: pathToFileURL(filename).href,
                initializeImportMeta(meta) { meta.url = pathToFileURL(filename).href; }
            }));
        }
        return modules.get(filename);
    };
    const entry = load(path.join(root, "xjzl-system.mjs"));
    await entry.link((specifier, mod) => load(fileURLToPath(new URL(specifier, mod.identifier))));
    await entry.evaluate({ timeout: 10000 });
    await context.__emitInit();

    const measure = (waypoints, { unitDist = 1, terrainDifficulty = 1 } = {}) => {
        context.unitDist = unitDist;
        context.terrainDifficulty = terrainDifficulty;
        context.canvas.dimensions.distance = unitDist;
        const grid = new context.foundry.grid.SquareGrid();
        return grid.measurePath(waypoints);
    };

    // 1. 复现不同体型 Token 中心相差 1.25 格（dx=125px, dy=0）-> 2D 距离严格为 1（不再退化成 0.8）
    assert.equal(measure([{ x: 0, y: 0 }, { x: 125, y: 0 }]).distance, 1);
    // 2. 1-2-2-2 对角线 + 2 倍困难地形 -> (1 + 2) * 2 = 6
    assert.equal(
        measure([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 200 }], { terrainDifficulty: 2 }).distance,
        6
    );
    // 3. 5 英尺每格，连续两步斜走 -> (1 + 2) * 5 = 15
    assert.equal(
        measure([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 200 }], { unitDist: 5 }).distance,
        15
    );
});

test("屏幕包围框、射线拾取、颜色规范化与飘字转发", () => {
    const floated = [];
    const mockView = {
        paused: false,
        canvas: { getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }) },
        pickAt: (cx, cy) => (cx === 300 && cy === 250 ? { type: "token", id: "tokA" } : { type: "cell", col: 1, row: 1 }),
        floatText: (id, text, color) => floated.push({ id, text, color }),
        renderer: {
            cam: { pitch: 34 },
            standeeCenter: id => (id === "tokA" ? { x: 200, y: 200 } : null),
            standeeTop: id => (id === "tokA" ? [1, 2, 3] : null),
            project: () => ({ x: 200, y: 140 }),
            footprintPx: () => 80
        }
    };
    const tokenA = { id: "tokA", document: { id: "tokA" } };
    const tokenB = { id: "tokB", document: { id: "tokB" } };

    withGlobals({
        game: { modules: { get: id => (id === "rutz-diorama" ? { active: true, api: { isOpen: true, view: mockView } } : null) } }
    }, () => {
        // 1. 射线拾取
        assert.equal(pickDioramaToken(300, 250, [tokenA, tokenB]), tokenA);
        assert.equal(pickDioramaToken(10, 10, [tokenA, tokenB]), null);

        // 2. 斜视角立牌屏幕包围框
        const standeeBounds = getDioramaTokenScreenBounds(tokenA);
        assert.deepEqual(standeeBounds, {
            x: 100 + 200 - (80 * 0.85) / 2,
            y: 50 + 200 - 60,
            width: 80 * 0.85,
            height: 120
        });

        // 3. 俯视角包围框
        mockView.renderer.cam.pitch = 85;
        const topDownBounds = getDioramaTokenScreenBounds(tokenA);
        assert.deepEqual(topDownBounds, {
            x: 100 + 200 - 40,
            y: 50 + 200 - 40,
            width: 80,
            height: 80
        });

        // 4. 颜色规范化与飘字转发
        assert.equal(normalizeCssColor(0xff5a4f), "#ff5a4f");
        assert.equal(normalizeCssColor({ css: "#5be37a" }), "#5be37a");
        assert.equal(normalizeCssColor(" #abcdef "), "#abcdef");
        assert.equal(normalizeCssColor(null, "#ffffff"), "#ffffff");

        assert.equal(floatDioramaText(tokenA, "-25", { fill: 0xff5a4f }), true);
        assert.deepEqual(floated, [{ id: "tokA", text: "-25", color: "#ff5a4f" }]);

        // 5. 绝招反冲期间 view.canvas 发生 CSS 位移 (+17, -6) 时，屏幕点/包围框与容器坐标必须取未反冲的父容器 view.root
        mockView.renderer.cam.pitch = 34;
        mockView.root = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }) };
        mockView.canvas.getBoundingClientRect = () => ({ left: 117, top: 44, width: 800, height: 600 });
        assert.deepEqual(getDioramaCanvasRect(), { left: 100, top: 50, width: 800, height: 600 });
        assert.deepEqual(getDioramaTokenScreenPoint(tokenA), { x: 300, y: 250 }, "绝招收束原点不得重复计入画布反冲位移");
        assert.deepEqual(getDioramaTokenScreenBounds(tokenA), {
            x: 100 + 200 - (80 * 0.85) / 2,
            y: 50 + 200 - 60,
            width: 80 * 0.85,
            height: 120
        });
    });

        assert.equal(floatDioramaText(tokenA, "-25", { fill: "#fff" }), false);
});

/** 创建可供 Node 测试使用的离屏 Canvas 桩，完整实现绘制原语而不依赖浏览器 DOM。 */
function createFakeDocument() {
    const gradient = () => ({ addColorStop() {} });
    const makeCtx = () => ({
        save() {},
        restore() {},
        setTransform() {},
        clearRect() {},
        fillRect() {},
        translate() {},
        rotate() {},
        beginPath() {},
        closePath() {},
        arc() {},
        fill() {},
        stroke() {},
        drawImage() {},
        moveTo() {},
        lineTo() {},
        quadraticCurveTo() {},
        setLineDash() {},
        measureText: text => ({ width: String(text || "").length * 16 }),
        createRadialGradient: gradient,
        createLinearGradient: gradient
    });
    return {
        createElement(tag) {
            if (tag !== "canvas") return null;
            return {
                width: 256,
                height: 256,
                getContext: () => makeCtx()
            };
        }
    };
}

test("2.5D 左键空地点击补丁：尊重 core.leftClickRelease 与 clickMove", () => {
    let origCalls = 0;
    const origClick = () => { origCalls++; };
    const view = { cfg: { onCellClick: origClick } };

    assert.equal(installDioramaCellClickPatch(view), true);
    const wrapped = view.cfg.onCellClick;
    assert.equal(installDioramaCellClickPatch(view), true);
    assert.equal(view.cfg.onCellClick, wrapped, "重复安装应保持幂等，不叠包");

    const settings = { clickMove: "off", leftClickRelease: false };
    withGlobals({
        game: {
            settings: {
                get: (ns, key) => (ns === "rutz-diorama" && key === "clickMove" ? settings.clickMove
                    : ns === "core" && key === "leftClickRelease" ? settings.leftClickRelease
                        : undefined)
            }
        }
    }, () => {
        // 1. 默认关闭 leftClickRelease 且非左键移动 -> 拦截取消选中
        view.cfg.onCellClick(3, 4);
        assert.equal(origCalls, 0);

        // 2. 开启 leftClickRelease -> 放行透传
        settings.leftClickRelease = true;
        view.cfg.onCellClick(3, 4);
        assert.equal(origCalls, 1);

        // 3. clickMove === "left" -> 无论 leftClickRelease 是否开启均透传
        settings.leftClickRelease = false;
        settings.clickMove = "left";
        view.cfg.onCellClick(5, 6);
        assert.equal(origCalls, 2);
    });
});

test("2.5D 脚底格子拾取补丁：点击立牌下方占位格回退命中真实 Token 与矩阵边界", () => {
    class FakeRenderer {
        constructor() {
            this.cam = { pitch: 34 };
            this._layout = [];
            this._mockHit = null;
        }
        pick() {
            return this._mockHit;
        }
    }

    const renderer = new FakeRenderer();
    assert.equal(installDioramaFootprintPickPatch(renderer), true);
    const wrappedPick = FakeRenderer.prototype.pick;
    assert.equal(installDioramaFootprintPickPatch(renderer), true);
    assert.equal(FakeRenderer.prototype.pick, wrappedPick, "脚底拾取补丁应保持幂等");

    const hero = { id: "hero", w: 1, alpha: 1, stackRank: 1 };
    const boss = { id: "boss", w: 2, alpha: 1, stackRank: 0 };
    const pet = { id: "pet", w: 1, alpha: 1, stackRank: 5 };
    const ghost = { id: "hero#ghost", w: 1, alpha: 0.6 };
    const prop = { id: "tile:crate", prop: true, w: 1, alpha: 1 };
    const hiddenUnderRoof = { id: "rogue", w: 1, alpha: 1 };

    renderer._layout = [
        { t: boss, ring: [6.0, 0, 6.0], roofK: 0 }, // 占用 (5..6, 5..6) 四格
        { t: hero, ring: [2.5, 0, 3.5], roofK: 0 }, // 占用 (2, 3)
        { t: pet, ring: [2.5, 0, 3.5], roofK: 0 }, // 与 hero 同格但 stackRank 更高
        { t: ghost, ring: [8.5, 0, 8.5], roofK: 0 },
        { t: prop, ring: [9.5, 0, 9.5], roofK: 0 },
        { t: hiddenUnderRoof, ring: [10.5, 0, 10.5], roofK: 0.98 }
    ];

    // 1. 击中 (2, 3) 单元格 -> 返回 stackRank 更高的 pet
    renderer._mockHit = { type: "cell", col: 2, row: 3 };
    assert.equal(renderer.pick(100, 100)?.id, "pet");

    // 2. 2×2 大体型 Token 任意占地格均命中（如右上格 (6, 5)）
    renderer._mockHit = { type: "cell", col: 6, row: 5 };
    assert.equal(renderer.pick(100, 100)?.id, "boss");

    // 3. 忽略鬼影、道具与被屋顶完全遮挡的 Token
    renderer._mockHit = { type: "cell", col: 8, row: 8 };
    assert.equal(renderer.pick(100, 100)?.type, "cell");
    renderer._mockHit = { type: "cell", col: 9, row: 9 };
    assert.equal(renderer.pick(100, 100)?.type, "cell");
    renderer._mockHit = { type: "cell", col: 10, row: 10 };
    assert.equal(renderer.pick(100, 100)?.type, "cell");

    // 4. tokens: false / walls: true / props / pitch >= 80 / 非 cell 命中 -> 保留原返回值
    renderer._mockHit = { type: "cell", col: 6, row: 5 };
    assert.equal(renderer.pick(100, 100, { tokens: false, doors: false })?.type, "cell");
    assert.equal(renderer.pick(100, 100, { walls: true })?.type, "cell");
    assert.equal(renderer.pick(100, 100, { props: "tile:" })?.type, "cell");
    renderer.cam.pitch = 85;
    assert.equal(renderer.pick(100, 100)?.type, "cell");

    renderer.cam.pitch = 34;
    renderer._mockHit = { type: "door", id: "door1" };
    assert.deepEqual(renderer.pick(100, 100), { type: "door", id: "door1" });
});

test("3D 立牌受击动作与剪影高亮：不偏移地面圆环、不污染原对象、阴影通道不加 extra", () => {
    class FakeRenderer {
        constructor() {
            this.cols = 20;
            this.rows = 20;
            this.effects = [];
            this.ringRef = [5.5, 0, 5.5];
            this.fallenRingRef = [8.5, 0, 5.5];
            this.tokenA = { id: "tokA", w: 1, tint: [1, 1, 1] };
            this.tokenFallen = { id: "tokFallen", w: 1, tint: [1, 1, 1] };
            this.drawnBatches = [];
        }
        _standeeLayout() {
            return [
                {
                    t: this.tokenA,
                    w: 1,
                    h: 1.4,
                    hDraw: 1.4,
                    fall: 0,
                    fallDir: 1,
                    base: [5.5, 0, 5.5],
                    ring: this.ringRef
                },
                {
                    t: this.tokenFallen,
                    w: 1,
                    h: 1.4,
                    hDraw: 1.4,
                    fall: 0.85,
                    fallDir: 2,
                    base: [8.5, 0, 5.5],
                    ring: this.fallenRingRef
                }
            ];
        }
        _drawStandees(layout, _cam, _light, depthOnly) {
            this.drawnBatches.push({
                depthOnly,
                extras: layout.map(L => (L.extra ? [...L.extra] : null))
            });
        }
        needsFrame() {
            return false;
        }
        setEffects(list) {
            this.effects = list || [];
        }
    }

    const renderer = new FakeRenderer();
    const view = { paused: false, renderer, _wakeAt: 0 };
    assert.equal(installDioramaRendererFxPatch(renderer), true);
    const wrappedSet = FakeRenderer.prototype.setEffects;
    assert.equal(installDioramaRendererFxPatch(renderer), true);
    assert.equal(FakeRenderer.prototype.setEffects, wrappedSet);

    const tokenObj = { id: "tokA", document: { id: "tokA" }, center: { x: 550, y: 550 } };
    const attackerObj = { id: "att1", document: { id: "att1" }, center: { x: 350, y: 550 } };
    const origNow = performance.now;
    let fakeNow = 10000;
    performance.now = () => fakeNow;

    try {
        withGlobals({
            game: {
                modules: { get: id => (id === "rutz-diorama" ? { active: true, api: { isOpen: true, view } } : null) }
            }
        }, () => {
            assert.equal(renderer.needsFrame(), false);

            const played = playDioramaHitEffect({
                token: tokenObj,
                attackerToken: attackerObj,
                kind: "impact",
                color: 0xff3020,
                critical: true,
                scale: 1,
                surfaces: {}
            });
            assert.equal(played, true);
            assert.equal(renderer.needsFrame(), true, "受击动画期间 needsFrame 应返回 true");

            // 推进到第 80ms（处于击退/闪光主峰值段）
            fakeNow = 10080;
            const layout = renderer._standeeLayout({ right: [1, 0, 0] });
            const L = layout[0];
            const LF = layout[1];

            // 1. 沿攻击者->受击者 (+X) 击退并弹起，且地面 L.ring 完全不被修改
            assert.ok(L.base[0] > 5.5, "L.base 应向攻击反向 (+X) 击退");
            assert.ok(L.base[1] > 0, "受击瞬间应伴随轻微纵向弹跳");
            assert.deepEqual(L.ring, [5.5, 0, 5.5]);
            assert.equal(L.ring, renderer.ringRef, "不应替换或改写地面 L.ring");

            // 2. 纵横挤压与立牌微小倾倒（且已倒地立牌不被覆盖 fall）
            assert.notEqual(L.w, 1);
            assert.notEqual(L.hDraw, 1.4);
            assert.ok(L.fall > 0 && L.fall <= 0.22);
            assert.equal(LF.fall, 0.85, "已倒地立牌不应被覆盖 fall");

            // 3. 浅拷贝 L.t.tint，不污染原 token 对象
            assert.notEqual(L.t, renderer.tokenA);
            assert.deepEqual(renderer.tokenA.tint, [1, 1, 1]);
            assert.ok(L.t.tint[0] > L.t.tint[1], "受击颜色应偏红提亮");

            // 4. 模拟 Render() 在 _standeeLayout 后重算并覆写 L.extra
            L.extra = [0.05, 0.05, 0.05];
            renderer._drawStandees(layout, { right: [1, 0, 0] }, {}, true);
            renderer._drawStandees(layout, { right: [1, 0, 0] }, {}, false);
            assert.deepEqual(renderer.drawnBatches[0].extras[0], [0.05, 0.05, 0.05], "阴影深度通道不叠加受击高亮");
            assert.ok(renderer.drawnBatches[1].extras[0][0] > 0.25, "主绘制通道应累加受击 extra 高亮");

            // 5. 立即停止后清理所有状态
            stopDioramaHitEffects();
            assert.equal(renderer.needsFrame(), false);
        });
    } finally {
        stopDioramaHitEffects();
        performance.now = origNow;
    }
});

test("setEffects 3D 竖立受击特效注入与状态过滤校验", () => {
    class FakeRenderer {
        constructor() {
            this.cols = 20;
            this.rows = 20;
            this.effects = [];
            this._layout = [{ t: { id: "tok1", w: 1 }, base: [5.5, 0, 5.5] }];
        }
        setEffects(list) {
            this.effects = list || [];
        }
    }

    const renderer = new FakeRenderer();
    const view = { paused: false, renderer, _wakeAt: 0 };
    assert.equal(installDioramaRendererFxPatch(renderer), true);

    const fakeDoc = createFakeDocument();
    const origNow = performance.now;
    let fakeNow = 20000;
    performance.now = () => fakeNow;

    try {
        withGlobals({
            document: fakeDoc,
            canvas: {
                dimensions: { size: 100, sceneX: 0, sceneY: 0 },
                scene: { regions: [] }
            },
            game: {
                user: { isGM: true },
                modules: { get: id => (id === "rutz-diorama" ? { active: true, api: { isOpen: true, view } } : null) }
            }
        }, () => {
            // 1. 保留原有 Sequencer 特效且不污染输入数组（不再注入 mode: "area" 光环）
            const upstream = [{ id: "seq-1", mode: "ground" }];
            renderer.setEffects(upstream);
            assert.equal(upstream.length, 1, "不应原地修改上游数组");
            assert.equal(renderer.effects.length, 1);

            // 2. 播放非光敏受击 -> 注入 mode: "upright" 3D 受击特效；光敏模式不注入
            const tokenObj = { id: "tok1", document: { id: "tok1" }, center: { x: 550, y: 550 } };
            playDioramaHitEffect({ token: tokenObj, kind: "impact", color: 0xcc5147, scale: 1, photosafe: false, surfaces: {} });
            fakeNow = 20080;
            renderer.setEffects([]);
            const hitFx = renderer.effects.find(fx => fx.mode === "upright");
            assert.ok(hitFx, "应注入 mode: upright 3D 受击特效");
            assert.equal(hitFx.tok, "tok1");
            assert.equal(hitFx.light, true);

            // 3. 光敏模式不注入 3D 斩痕粒子特效
            stopDioramaHitEffects();
            playDioramaHitEffect({ token: tokenObj, kind: "impact", color: 0xcc5147, scale: 1, photosafe: true, surfaces: {} });
            fakeNow = 20120;
            renderer.setEffects([]);
            assert.equal(renderer.effects.length, 0, "光敏模式不应注入 3D 斩痕特效");

            // 4. 暂停让位 2D 画布时不再注入 3D 特效
            stopDioramaHitEffects();
            playDioramaHitEffect({ token: tokenObj, kind: "impact", color: 0xcc5147, scale: 1, photosafe: false, surfaces: {} });
            view.paused = true;
            renderer.setEffects([]);
            assert.equal(renderer.effects.length, 0, "视图暂停期间不应注入 3D 特效");
        });
    } finally {
        stopDioramaHitEffects();
        performance.now = origNow;
    }
});

test("setHighlights 光环高亮保留清晰铺色与边缘墙过滤：重叠模板与编辑模式保留原状", () => {
    class FakeRenderer {
        constructor() {
            this.cols = 10;
            this.rows = 10;
            this.lastHighlights = null;
            this._hlEdges = null;
        }
        setEffects() {}
        setHighlights(rgba) {
            this.lastHighlights = rgba;
            this._hlEdges = rgba
                ? [
                    { c: 1, r: 1, x0: 1, z0: 1, x1: 2, z1: 1 },
                    { c: 3, r: 2, x0: 3, z0: 2, x1: 4, z1: 2 }
                ]
                : null;
        }
    }

    const renderer = new FakeRenderer();
    const view = { paused: false, regionMode: false, stamping: false, stampFill: false, renderer };
    assert.equal(installDioramaRendererFxPatch(renderer), true);

    const auraDoc = {
        id: "auraA",
        visibility: 2,
        hidden: false,
        shapes: [{ type: "circle", origin: { x: 250, y: 250 }, radius: 150 }],
        bounds: { x: 100, y: 100, width: 300, height: 300 },
        getFlag: (ns, key) => (ns === "xjzl-system" && key === "aura" ? { params: { radius: 1, shapeKind: "circle" } } : null),
        testPoint: ({ x, y }) => (x >= 100 && x <= 400 && y >= 100 && y <= 400)
    };
    const templateDoc = {
        id: "tplB",
        visibility: 2,
        hidden: false,
        shapes: [{ type: "rectangle", x: 300, y: 200, width: 100, height: 100 }],
        bounds: { x: 300, y: 200, width: 100, height: 100 }, // 对应格子 (3, 2)，与 auraA 重叠
        getFlag: () => null,
        testPoint: ({ x, y }) => (x >= 300 && x < 400 && y >= 200 && y < 300)
    };

    const raw = new Uint8Array(10 * 10 * 4);
    const setCell = (c, r, alpha) => {
        const i = (r * 10 + c) * 4;
        raw[i] = 64; raw[i + 1] = 208; raw[i + 2] = 192; raw[i + 3] = alpha;
    };
    setCell(1, 1, 153); // 纯光环格
    setCell(2, 2, 153); // 纯光环格
    setCell(3, 2, 153); // 光环与普通模板重叠格

    const regionsLayer = { active: false };
    withGlobals({
        CONST: { REGION_VISIBILITY: { LAYER: 0, GAMEMASTER: 1, ALWAYS: 2 } },
        foundry: { utils: { Color: { from: () => 0x40d0c0 } } },
        canvas: {
            dimensions: { size: 100, sceneX: 0, sceneY: 0 },
            regions: regionsLayer,
            scene: { regions: [auraDoc, templateDoc] }
        },
        game: {
            user: { isGM: true },
            modules: { get: id => (id === "rutz-diorama" ? { active: true, api: { isOpen: true, view } } : null) }
        }
    }, () => {
        // 1. 普通战术视图：纯光环格规范为 134（清晰铺色），重叠模板格保留 153，且仅移除纯光环锯齿墙边
        renderer.setHighlights(raw, { animate: true });
        assert.notEqual(renderer.lastHighlights, raw);
        assert.equal(raw[(1 * 10 + 1) * 4 + 3], 153, "不应原地修改传入的高亮 buffer");
        assert.equal(renderer.lastHighlights[(1 * 10 + 1) * 4 + 3], 134);
        assert.equal(renderer.lastHighlights[(2 * 10 + 2) * 4 + 3], 134);
        assert.equal(renderer.lastHighlights[(2 * 10 + 3) * 4 + 3], 153, "与普通区域重叠格子不应被调整");
        assert.deepEqual(renderer._hlEdges.map(e => `${e.c},${e.r}`), ["3,2"], "应仅保留非光环模板的外围边");

        // 2. 区域编辑模式 / 区域图层激活时完整保留高亮与边缘墙
        view.regionMode = true;
        renderer.setHighlights(raw, { animate: false });
        assert.equal(renderer.lastHighlights, raw);
        assert.equal(renderer._hlEdges.length, 2);
        view.regionMode = false;
        regionsLayer.active = true;
        renderer.setHighlights(raw, { animate: false });
        assert.equal(renderer.lastHighlights, raw);
        assert.equal(renderer._hlEdges.length, 2);
    });
});

test("_drawAreaEdges 3D 真气焰冠与上浮余烬：双层四 Pass 剔除、UV 安全范围与 GL 状态还原", () => {
    const glCalls = [];
    const flameCalls = [];
    const uvHistory = [];
    let blendEnabled = false;
    let cullEnabled = false;
    let cullMode = 0x0405; // GL.BACK
    let depthMaskState = true;
    let depthFuncState = 0x0201; // GL.LESS

    const mockGl = {
        BLEND: 0x0be2,
        CULL_FACE: 0x0b44,
        FRONT: 0x0404,
        BACK: 0x0405,
        DEPTH_TEST: 0x0b71,
        LEQUAL: 0x0203,
        LESS: 0x0201,
        TEXTURE0: 0x84c0,
        TEXTURE6: 0x84c6,
        TRIANGLES: 0x0004,
        VERTEX_SHADER: 0x8b31,
        FRAGMENT_SHADER: 0x8b30,
        COMPILE_STATUS: 0x8b81,
        LINK_STATUS: 0x8b82,
        ARRAY_BUFFER: 0x8892,
        ELEMENT_ARRAY_BUFFER: 0x8893,
        STATIC_DRAW: 0x88e4,
        FLOAT: 0x1406,
        UNSIGNED_SHORT: 0x1403,
        UNSIGNED_INT: 0x1405,
        POLYGON_OFFSET_FILL: 0x8037,
        isEnabled: cap => (cap === 0x0be2 ? blendEnabled : cap === 0x0b44 ? cullEnabled : true),
        enable: cap => {
            if (cap === 0x0be2) blendEnabled = true;
            if (cap === 0x0b44) cullEnabled = true;
            glCalls.push(["enable", cap]);
        },
        disable: cap => {
            if (cap === 0x0be2) blendEnabled = false;
            if (cap === 0x0b44) cullEnabled = false;
            glCalls.push(["disable", cap]);
        },
        cullFace: mode => { cullMode = mode; },
        depthFunc: fn => { depthFuncState = fn; },
        depthMask: flag => { depthMaskState = flag; },
        polygonOffset() {},
        blendFuncSeparate: (...args) => glCalls.push(["blend", ...args]),
        createShader: type => ({ type }),
        shaderSource() {},
        compileShader() {},
        getShaderParameter: () => true,
        deleteShader() {},
        createProgram: () => ({ id: "flameProg" }),
        attachShader() {},
        linkProgram() {},
        getProgramParameter: () => true,
        deleteProgram() {},
        getUniformLocation: (_p, name) => name,
        createVertexArray: () => ({ id: "flameVao" }),
        createBuffer: () => ({}),
        bindBuffer() {},
        bufferData() {},
        enableVertexAttribArray() {},
        vertexAttribPointer() {},
        useProgram() {},
        uniformMatrix4fv() {},
        uniformMatrix2fv() {},
        bindVertexArray() {},
        activeTexture() {},
        uniform1i() {},
        uniform1f() {},
        uniform2f() {},
        uniform3f() {},
        bindTexture() {},
        uniform3fv() {},
        uniform4f(loc, a, b, c, d) {
            if (loc === "u_uv") uvHistory.push([a, b, c, d]);
        },
        drawArrays(mode, first, count) {
            glCalls.push(["drawArrays", mode, first, count]);
        },
        drawElements(mode, count, type, offset) {
            flameCalls.push({ cullMode, cullEnabled, mode, count, type, offset });
        }
    };

    let visOn = false;
    let visVal = 1;
    class FakeRenderer {
        constructor() {
            this.cols = 20;
            this.rows = 20;
            this.cam = { pitch: 34 };
            this.time = 1.5;
            this.gl = mockGl;
            this.quadVao = {};
            this.pFx = {
                p: {},
                u: { u_vp: "u_vp", u_fx: "u_fx", u_p0: "u_p0", u_ax: "u_ax", u_ay: "u_ay", u_uv: "u_uv", u_tint: "u_tint" }
            };
            this.pDecal = null;
            this.terrain = null;
            this.visTex = { id: "visTex" };
            this._texIds = new WeakMap();
            this._seq = 0;
            this._lastCam = { back: [0, 0.5, 0.86], right: [1, 0, 0] };
        }
        _fxTexFor(source) {
            if (!source) return null;
            if (!this._texIds.has(source)) this._texIds.set(source, { tex: { id: ++this._seq } });
            return this._texIds.get(source);
        }
        _setCutUniforms() {}
        groundAt() { return 0; }
        project([x, y, z]) { return { x: x * 40, y: z * 30 - y * 10 }; }
        _visActive() { return visOn; }
        visAt() { return visVal; }
        needsFrame() { return false; }
        setEffects() {}
        _drawAreaEdges() {}
    }

    const renderer = new FakeRenderer();
    const view = { paused: false, renderer };
    assert.equal(installDioramaRendererFxPatch(renderer), true);

    const auraDoc = {
        id: "aura3d",
        name: "魔气",
        color: "#40d0c0",
        visibility: 2,
        hidden: false,
        shapes: [{ type: "circle", origin: { x: 550, y: 550 }, radius: 150 }],
        bounds: { x: 400, y: 400, width: 300, height: 300 },
        behaviors: [{ type: "xjzlAura", system: { shapeKind: "circle", radius: 1 } }],
        getFlag: (ns, key) => (ns === "xjzl-system" && key === "aura" ? { params: { radius: 1, shapeKind: "circle" } } : null),
        testPoint: ({ x, y }) => Math.hypot(x - 550, y - 550) <= 155
    };

    const fakeDoc = createFakeDocument();
    let particlesEnabled = true;

    withGlobals({
        document: fakeDoc,
        CONST: { REGION_VISIBILITY: { LAYER: 0, GAMEMASTER: 1, ALWAYS: 2 } },
        foundry: { utils: { Color: { from: () => 0x40d0c0 } } },
        canvas: {
            dimensions: { size: 100, sceneX: 0, sceneY: 0 },
            scene: { regions: [auraDoc] }
        },
        game: {
            user: { isGM: true },
            modules: { get: id => (id === "rutz-diorama" ? { active: true, api: { isOpen: true, view } } : null) },
            settings: { get: (_ns, key) => (key === "auraParticles" ? particlesEnabled : false) }
        }
    }, () => {
        const countQuadDraws = () => glCalls.filter(c => c[0] === "drawArrays").length;

        // 1. 开启粒子 + 斜视角：needsFrame 为 true，绘制贴地双光环 + 4 Pass 双层真气焰冠 + 上浮余烬，并完整还原 GL 状态
        assert.equal(renderer.needsFrame(), true);
        blendEnabled = false;
        renderer._drawAreaEdges({ vp: new Float32Array(16), back: [0, 0.5, 0.86], right: [1, 0, 0] });
        assert.equal(flameCalls.length, 4, "3D 真气焰冠应绘制内外双层共 4 次 FRONT/BACK 剔除 Pass");
        assert.equal(flameCalls[0].cullMode, mockGl.FRONT);
        assert.equal(flameCalls[1].cullMode, mockGl.BACK);
        assert.equal(flameCalls[2].cullMode, mockGl.FRONT);
        assert.equal(flameCalls[3].cullMode, mockGl.BACK);
        assert.ok(countQuadDraws() > 16, "应绘制贴地双光环与上浮真气余烬粒子");
        assert.equal(cullEnabled, false, "绘制结束后必须关闭 CULL_FACE");
        assert.equal(cullMode, mockGl.BACK, "绘制结束后必须恢复默认 cullFace(BACK)");
        assert.equal(depthMaskState, true, "绘制结束后必须恢复 depthMask(true)");
        assert.equal(depthFuncState, mockGl.LESS, "绘制结束后必须恢复 depthFunc(LESS)");
        assert.equal(blendEnabled, false, "绘制结束后必须恢复原有 BLEND 开关");
        for (const [u0, v0, u1, v1] of uvHistory) {
            assert.ok(u0 >= 0 && u0 <= 1 && u1 >= 0 && u1 <= 1 && v0 >= 0 && v0 <= 1 && v1 >= 0 && v1 <= 1,
                `u_uv 必须严格在 [0, 1] 内以防 CLAMP_TO_EDGE 拉伸，实际: [${u0}, ${v0}, ${u1}, ${v1}]`);
        }

        // 2. 俯视角 (>= 80°)：不画 3D 焰冠与粒子，仅画 1 道贴地光环
        glCalls.length = 0;
        flameCalls.length = 0;
        renderer.cam.pitch = 85;
        renderer._drawAreaEdges({ vp: new Float32Array(16), back: [0, 1, 0], right: [1, 0, 0] });
        assert.equal(flameCalls.length, 0);
        assert.equal(countQuadDraws(), 1);

        // 3. 关闭粒子开关：needsFrame 恢复 false，不画 3D 焰冠与粒子，仅绘制 1 道静态贴地光环
        particlesEnabled = false;
        renderer.cam.pitch = 34;
        assert.equal(renderer.needsFrame(), false);
        glCalls.length = 0;
        flameCalls.length = 0;
        renderer._drawAreaEdges({ vp: new Float32Array(16), back: [0, 0.5, 0.86], right: [1, 0, 0] });
        assert.equal(flameCalls.length, 0);
        assert.equal(countQuadDraws(), 1, "关闭光环特效后应退回单一 3D 贴地静态光环");

        // 4. 迷雾过滤与 pDecal 地面路径：
        // 4a. 降级路径下 visAt === 0 不画地面圆环；光环名称在 visAt === 0 时返回 null
        visOn = true;
        visVal = 0;
        glCalls.length = 0;
        flameCalls.length = 0;
        renderer._drawAreaEdges({ vp: new Float32Array(16), back: [0, 0.5, 0.86], right: [1, 0, 0] });
        assert.equal(countQuadDraws(), 0, "不可见迷雾中降级地面圆环不得绘制");
        const parsedAura = {
            id: "aura3d",
            name: "魔气",
            region: auraDoc,
            center: { x: 550, y: 550 },
            visual: { radius: 1, rPx: 150, tint: 0x40d0c0, shapeKind: "circle" }
        };
        assert.equal(resolveAuraLabelScreenPos(parsedAura, renderer, { ox: 0, oy: 0, size: 100 }, true), null, "不可见迷雾中不得显示光环名称");
        visVal = 1;
        assert.ok(resolveAuraLabelScreenPos(parsedAura, renderer, { ox: 0, oy: 0, size: 100 }, true)?.alpha === 1);

        // 4b. 存在上游 pDecal 与 terrain 时，地面圆环沿用 pDecal (UNSIGNED_INT) 采样 u_vis 绘制，不再走 pFx
        renderer.pDecal = {
            p: { id: "decalProg" },
            u: {
                u_vp: "u_vp", u_lightVP: "u_lightVP", u_vis: "u_vis", u_visOn: "u_visOn",
                u_mapSize: "u_mapSize", u_fx: "u_fx", u_dp0: "u_dp0", u_dinv: "u_dinv", u_duv: "u_duv", u_tint: "u_tint"
            }
        };
        renderer.terrain = { vao: { id: "terrainVao" }, count: 36 };
        glCalls.length = 0;
        flameCalls.length = 0;
        renderer._drawAreaEdges({ vp: new Float32Array(16), back: [0, 0.5, 0.86], right: [1, 0, 0] });
        assert.equal(countQuadDraws(), 0, "存在 pDecal 时地面圆环不应回退走 pFx drawArrays");
        assert.equal(flameCalls.length, 1);
        assert.equal(flameCalls[0].count, 36);
        assert.equal(flameCalls[0].type, mockGl.UNSIGNED_INT);
    });
});

test("默认进入 2.5D 时序兼容：先注册钩子并延后到本轮 ready 挂载 API 后自动完成补丁安装", async () => {
    const context = createContext({ Promise, queueMicrotask, setTimeout, console, Symbol, Map, Set, WeakMap, Math, Number, String, Array, Object, Boolean, Error, Float32Array, Int32Array, Uint8Array, Uint16Array, performance });
    const dioramaMod = { active: true, api: null };
    const hooks = new Map();
    const canvasEl = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
    const view = {
        paused: false,
        canvas: canvasEl,
        root: { clientWidth: 800, clientHeight: 600, contains: () => true, appendChild() {} },
        cfg: {
            onBoxSelect() {},
            onCellClick() {}
        },
        renderer: {
            cols: 10, rows: 10, cam: { pitch: 34 },
            pick: () => ({ type: "cell", col: 1, row: 1 }),
            _standeeLayout: () => [],
            _drawStandees() {},
            setHighlights() {},
            _drawAreaEdges() {},
            needsFrame: () => false,
            setEffects() {}
        }
    };
    class FakeDioramaView {
        _down() {}
    }
    Object.setPrototypeOf(view, FakeDioramaView.prototype);

    runInContext(`
        globalThis.window = globalThis;
        globalThis.document = { createElement: () => ({ className: "", style: {}, setAttribute() {}, remove() {}, getContext: () => ({ setTransform() {}, clearRect() {} }) }) };
        globalThis.CONST = { GRID_DIAGONALS: { EQUIDISTANT: 1 } };
        globalThis.CONFIG = {};
        globalThis.canvas = { scene: { regions: [] }, dimensions: { size: 100, sceneX: 0, sceneY: 0 } };
    `, context);
    context.Hooks = {
        on(name, fn) {
            if (!hooks.has(name)) hooks.set(name, []);
            hooks.get(name).push(fn);
        }
    };
    context.game = {
        modules: { get: id => (id === "rutz-diorama" ? dioramaMod : null) },
        settings: { get: (_s, k) => k === "customDistanceRule" }
    };

    const modules = new Map();
    const load = filename => {
        if (!modules.has(filename)) {
            modules.set(filename, new SourceTextModule(readFileSync(filename, "utf8"), {
                context,
                identifier: pathToFileURL(filename).href,
                initializeImportMeta(meta) { meta.url = pathToFileURL(filename).href; }
            }));
        }
        return modules.get(filename);
    };
    const compatMod = load(path.join(root, "module/utils/diorama-compat.mjs"));
    await compatMod.link((specifier, mod) => load(fileURLToPath(new URL(specifier, mod.identifier))));
    await compatMod.evaluate({ timeout: 10000 });

    const origDown = FakeDioramaView.prototype._down;
    const origCellClick = view.cfg.onCellClick;
    const origPick = view.renderer.pick;
    const origSetEffects = view.renderer.setEffects;

    // 模拟系统 ready 回调先执行，此时 rutz-diorama 尚未挂载 mod.api
    compatMod.namespace.initDioramaCompat();
    assert.equal(FakeDioramaView.prototype._down, origDown);
    assert.ok(hooks.has("rutzTurnMarkerPause") && hooks.has("canvasReady"), "应先完整注册所有钩子");

    // 同一轮 ready 中，rutz-diorama 随后暴露 API 且视图已开启
    dioramaMod.api = { isOpen: true, view };
    await new Promise(resolve => queueMicrotask(resolve));

    assert.notEqual(FakeDioramaView.prototype._down, origDown, "延迟探测后应自动安装左键框选补丁");
    assert.notEqual(view.cfg.onCellClick, origCellClick, "延迟探测后应自动安装左键空地补丁");
    assert.notEqual(view.renderer.pick, origPick, "延迟探测后应自动安装脚底拾取补丁");
    assert.notEqual(view.renderer.setEffects, origSetEffects, "延迟探测后应自动安装渲染器补丁");
});

test("TargetManager 目标选择中右键单击空地立即拦截 pointerup，保留右键拖拽平移视角", async () => {
    const viewCanvas = { closest: () => null };
    const boardCanvas = { id: "board", closest: () => null };
    const view = {
        paused: false,
        canvas: viewCanvas,
        root: { contains: el => el === viewCanvas },
        _drag: { button: 2, moved: false },
        _pingTimer: null,
        _userPanned: 0,
        _wakeAt: 0,
        renderer: {
            panArgs: [],
            panBy(dx, dy) {
                this.panArgs.push([dx, dy]);
            }
        }
    };
    const resolved = [];
    let dioramaOpen = true;
    const makeState = () => ({
        settled: false,
        frame: null,
        hookHandlers: [],
        candidates: [],
        selected: [],
        rightPointer: null,
        rightDragMoved: false,
        resolve: val => resolved.push(val)
    });
    const makeEvent = (extra = {}) => {
        const flags = { prevented: false, stopped: false };
        return {
            button: 2,
            buttons: 2,
            clientX: 400,
            clientY: 300,
            target: viewCanvas,
            preventDefault() { flags.prevented = true; },
            stopImmediatePropagation() { flags.stopped = true; },
            stopPropagation() {},
            flags,
            ...extra
        };
    };

    try {
        await withGlobals({
            Hooks: { off() {} },
            game: {
                modules: { get: id => (id === "rutz-diorama" ? { active: true, api: { isOpen: dioramaOpen, view } } : null) }
            }
        }, async () => {
            // 1. 2.5D 未拖动直接右键松开空地：在 pointerup 阶段截断事件阻止 DioramaView._up 移动角色，同时清理 _drag 并结束选择
            const state1 = makeState();
            TargetManager._activeSelection = state1;
            TargetManager._onPointerDown(makeEvent());
            assert.deepEqual(state1.rightPointer, { x: 400, y: 300, moved: false });

            const upEv = makeEvent({ buttons: 0 });
            TargetManager._onSelectionPointerUp(upEv);
            assert.equal(upEv.flags.prevented, true);
            assert.equal(upEv.flags.stopped, true, "必须拦截未拖动的右键 pointerup 防止触发 2.5D onCellContext");
            assert.equal(view._drag, null, "必须清理 2.5D 视图待处理拖拽态以防后续误移视角");
            assert.equal(state1.settled, true);
            assert.equal(TargetManager._activeSelection, null);
            assert.deepEqual(resolved, [null]);

            // 紧随其后的 contextmenu 被静默吞掉
            const ctxEv = makeEvent();
            TargetManager._onSelectionContextMenu(ctxEv);
            assert.equal(ctxEv.flags.stopped, true);

            // 2. 2.5D 右键按下并拖动超过 5px 后松开：放行 pointerup 给 2.5D 视图结束平移，且不终止选择会话
            view._drag = { button: 2, moved: true };
            const state2 = makeState();
            TargetManager._activeSelection = state2;
            TargetManager._onPointerDown(makeEvent());
            TargetManager._onSelectionPointerMove(makeEvent({ clientX: 420, clientY: 315 }));
            assert.equal(state2.rightPointer.moved, true);

            const dragUpEv = makeEvent({ clientX: 420, clientY: 315, buttons: 0 });
            TargetManager._onSelectionPointerUp(dragUpEv);
            assert.equal(dragUpEv.flags.stopped, false, "发生右拖时必须放行 pointerup 以完成相机平移收尾");
            assert.equal(state2.rightDragMoved, true);
            assert.equal(state2.settled, false, "右拖结束后仍应保留目标选择会话");

            const dragCtxEv = makeEvent({ clientX: 420, clientY: 315 });
            TargetManager._onSelectionContextMenu(dragCtxEv);
            assert.equal(dragCtxEv.flags.stopped, true);
            assert.equal(state2.settled, false);

            // 3. 2.5D 边缘滚屏 panDioramaBy 必须更新 view._userPanned 与 _wakeAt，防止跟随选中 Token 把镜头拉回
            assert.equal(panDioramaBy(12, -8), true);
            assert.deepEqual(view.renderer.panArgs, [[-12, 8]]);
            assert.ok(view._userPanned > 0, "边缘滚屏后必须记录 _userPanned 以暂缓跟随拉回");
            assert.ok(view._wakeAt > 0, "边缘滚屏后应唤醒渲染器");

            // 4. 2D 模式或非 2.5D 画布下：pointerup 必须放行给 Foundry 鼠标管理器收尾，且无 pointermove 时不按坐标差误判拖动
            dioramaOpen = false;
            const state3 = makeState();
            TargetManager._activeSelection = state3;
            TargetManager._onPointerDown(makeEvent({ target: boardCanvas }));
            const up2d = makeEvent({ target: boardCanvas, clientX: 412, clientY: 312, buttons: 0 });
            TargetManager._onSelectionPointerUp(up2d);
            assert.equal(up2d.flags.prevented, false, "2D 下不得吞掉 pointerup，防止 Foundry 鼠标管理器卡死拖动");
            assert.equal(up2d.flags.stopped, false);
            assert.equal(state3.rightDragMoved, false, "2D 下未经过 pointermove 不得把松开位移误判为右拖");
            assert.equal(state3.settled, false, "2D 下仍等待 contextmenu 再取消会话");

            const ctx2d = makeEvent({ target: boardCanvas, clientX: 412, clientY: 312 });
            TargetManager._onSelectionContextMenu(ctx2d);
            assert.equal(ctx2d.flags.prevented, true);
            assert.equal(ctx2d.flags.stopped, true);
            assert.equal(state3.settled, true);
            assert.equal(TargetManager._activeSelection, null);
        });
    } finally {
        TargetManager._activeSelection = null;
        TargetManager._suppressContextMenuUntil = 0;
        TargetManager._suppressClickUntil = 0;
    }
});
