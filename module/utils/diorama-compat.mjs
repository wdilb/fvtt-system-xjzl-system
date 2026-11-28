/**
 * Rutz's Tactics View (`rutz-diorama`) 兼容适配层。
 *
 * 设计约束：
 * - 未安装或未激活 `rutz-diorama` 时，初始化直接返回，不注册任何钩子、不修改原型、不创建叠加层。
 * - 处于 2D 视图或 `rutz-diorama` 暂让 2D 画布期间，所有查询均返回 null/false，系统走原生 2D 逻辑。
 * - 所有对第三方模块内部 API 的调用均做判空与异常隔离，外部模块升级变动时自动降级。
 */
import { isParticlesEnabled, mixColor, readAuraVisual } from "../region/xjzl-aura-fx.mjs";

const MOD_ID = "rutz-diorama";
const PATCHED_BOX_SELECT = Symbol("xjzlDioramaBoxSelectPatched");
const PATCHED_CELL_CLICK = Symbol("xjzlDioramaCellClickPatched");
const PATCHED_FOOTPRINT_PICK = Symbol("xjzlDioramaFootprintPickPatched");
const PATCHED_RENDERER_FX = Symbol("xjzlDioramaRendererFxPatched");
const PATCHED_MEASURE_MOVEMENT = Symbol("xjzlDioramaMeasureMovementPatched");

const OVERLAY_CLASS = "xjzl-diorama-overlay";
const MAX_TINTED_SURFACES = 96;
const MAX_ACTIVE_HIT_FX = 36;
const MAX_HIT_CANVAS_POOL = 24;
const AURA_TEX_SIZE = 512;
const HIT_TEX_SIZE = 256;
const AURA_HIGHLIGHT_ALPHA = 134;
const CROWN_LON_SEGS = 64;
const CROWN_LAT_SEGS = 14;
const TAU = Math.PI * 2;

let initialized = false;
let overlayCanvas = null;
let overlayCtx = null;
let overlayResizeObserver = null;
let overlayHostView = null;
let rafId = 0;
let lastFrameAt = 0;
let placementPreview = null;
let hitEffectSeq = 0;
let warnedAuraRenderFailure = false;
let warnedFlameProgramFailure = false;

// 2.5D 立体真气焰冠光环与 3D 受击状态存储
const auraCellCache = new Map();
const nonAuraCellCache = new Map();
const aura3DParticleStates = new Map();
const flameGpuByGl = new WeakMap();
const aura3DTextures = {
    groundRing: null,
    qiOrb: null,
    qiStreak: null
};
const activeStandeeReactions = new Map();
const activeHitEffects = [];
const hitCanvasPool = [];
const tintedSurfaces = new Map();

/* -------------------------------------------- */
/*  状态探测                                      */
/* -------------------------------------------- */

/** 检查第三方模块 `rutz-diorama` 是否已激活。 */
export function isDioramaModuleActive() {
    return Boolean(globalThis.game?.modules?.get?.(MOD_ID)?.active);
}

/** 获取 `rutz-diorama` 公开 API；未激活时返回 null。 */
export function getDioramaApi() {
    if (!isDioramaModuleActive()) return null;
    return globalThis.game.modules.get(MOD_ID)?.api ?? null;
}

/**
 * 获取当前处于可见激活态的 2.5D 视图实例。
 * 视图未开启、已暂停（如让位给 2D 模板放置）或宿主被隐藏时返回 null。
 * @returns {object|null}
 */
export function getDioramaView() {
    const api = getDioramaApi();
    if (!api?.isOpen || !api.view) return null;
    const view = api.view;
    if (view.paused) return null;
    const host = view.host ?? view.root?.parentElement ?? null;
    if (host?.style?.display === "none") return null;
    return view;
}

/** 当前是否正在使用可见的 2.5D 战术视图。 */
export function isDioramaOpen() {
    return Boolean(getDioramaView());
}

/* -------------------------------------------- */
/*  初始化与生命周期                                */
/* -------------------------------------------- */

/**
 * 在 ready 阶段初始化 2.5D 兼容层。
 * 模块未启用时直接返回，保持系统零侵入与零额外开销。
 */
export function initDioramaCompat() {
    if (initialized || !isDioramaModuleActive()) return;
    initialized = true;

    installMovementPreviewPatch();

    const probeOpen = () => {
        if (initialized && isDioramaOpen()) onDioramaOpen();
    };

    if (typeof globalThis.Hooks?.on === "function") {
        globalThis.Hooks.on("rutzTurnMarkerPause", (key, paused) => {
            if (key !== MOD_ID) return;
            if (paused) onDioramaOpen();
            else onDioramaClose();
        });
        for (const hookName of ["createRegion", "updateRegion", "deleteRegion"]) {
            globalThis.Hooks.on(hookName, doc => {
                if (hookName === "deleteRegion") clearAuraCaches(doc?.id);
                else if (doc?.id) {
                    auraCellCache.delete(doc.id);
                    nonAuraCellCache.delete(doc.id);
                }
                if (isDioramaOpen()) syncOverlayLoop();
            });
        }
        globalThis.Hooks.on("canvasReady", () => {
            clearAuraCaches();
            if (isDioramaOpen()) onDioramaOpen();
        });
        globalThis.Hooks.on("xjzl.auraFxSettingChanged", () => {
            aura3DParticleStates.clear();
            if (isDioramaOpen()) syncOverlayLoop();
        });
        globalThis.Hooks.on("canvasTearDown", () => {
            stopDioramaHitEffects();
            placementPreview = null;
            clearAuraCaches();
            onDioramaClose();
        });
    }

    // rutz-diorama 可能在更晚执行的 ready 回调中才暴露 mod.api，或在 canvasReady 时自动开图；
    // 先完成全部钩子注册，并将探测延后到本轮 ready 回调及异步微/宏任务收尾之后。
    probeOpen();
    if (typeof globalThis.queueMicrotask === "function") {
        globalThis.queueMicrotask(probeOpen);
    } else {
        Promise.resolve().then(probeOpen);
    }
    if (typeof globalThis.setTimeout === "function") {
        globalThis.setTimeout(probeOpen, 0);
    }
}

function clearAuraCaches(regionId = null) {
    if (regionId) {
        auraCellCache.delete(regionId);
        nonAuraCellCache.delete(regionId);
        aura3DParticleStates.delete(regionId);
        return;
    }
    auraCellCache.clear();
    nonAuraCellCache.clear();
    aura3DParticleStates.clear();
}

function onDioramaOpen() {
    const view = getDioramaView();
    if (!view) return;
    installDioramaBoxSelectPatch(view);
    installDioramaCellClickPatch(view);
    if (view.renderer) {
        installDioramaFootprintPickPatch(view.renderer);
        installDioramaRendererFxPatch(view.renderer);
    }
    ensureOverlayCanvas(view);
    syncOverlayLoop();
}

function onDioramaClose() {
    stopOverlayLoop();
    stopDioramaHitEffects();
    placementPreview = null;
    clearAuraCaches();
    destroyOverlayCanvas();
}

/* -------------------------------------------- */
/*  坐标投影、拾取、相机与飘字适配                  */
/* -------------------------------------------- */

/** 获取未施加临时反冲位移的 2.5D 容器视口矩形；优先读取父容器以避免重复叠加 CSS translate。 */
function getDioramaContainerRect(view = getDioramaView()) {
    return view?.root?.getBoundingClientRect?.()
        ?? view?.canvas?.parentElement?.getBoundingClientRect?.()
        ?? view?.canvas?.getBoundingClientRect?.()
        ?? null;
}

/** 获取 2.5D 主画布的视口矩形。 */
export function getDioramaCanvasRect() {
    return getDioramaContainerRect();
}

/** 判断 DOM 事件目标是否落在 2.5D 棋盘画布内（排除 Mod 自带面板与帮助气泡）。 */
export function isDioramaCanvasTarget(target) {
    const view = getDioramaView();
    if (!view || !target) return false;
    if (target === view.canvas) return true;
    return Boolean(view.root?.contains?.(target) && !target.closest?.(".rdio-panel, .rdio-help"));
}

/**
 * 通过 2.5D 射线拾取命中客户端坐标下的候选 Token。
 * @param {number} clientX - 指针视口 X
 * @param {number} clientY - 指针视口 Y
 * @param {object[]} candidates - 可选 Token 列表
 * @returns {object|null}
 */
export function pickDioramaToken(clientX, clientY, candidates) {
    const view = getDioramaView();
    if (!view || typeof view.pickAt !== "function") return null;
    let hit = null;
    try {
        hit = view.pickAt(clientX, clientY);
    } catch {
        return null;
    }
    if (hit?.type !== "token" || hit.id == null) return null;
    const hitId = String(hit.id);
    for (const token of candidates ?? []) {
        if (String(token?.id) === hitId || String(token?.document?.id) === hitId) return token;
    }
    return null;
}

/**
 * 计算 Token 在 2.5D 视角下的屏幕矩形包围盒（CSS 视口坐标）。
 * @param {object} token - Canvas Token
 * @returns {{x: number, y: number, width: number, height: number}|null}
 */
export function getDioramaTokenScreenBounds(token) {
    const view = getDioramaView();
    const renderer = view?.renderer;
    const rect = getDioramaContainerRect(view);
    const id = token?.document?.id ?? token?.id;
    if (!renderer || !rect || !id) return null;

    let center = null;
    try {
        center = renderer.standeeCenter?.(id);
    } catch {
        return null;
    }
    if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;

    let foot = 48;
    try {
        foot = Number(renderer.footprintPx?.(id)) || 48;
    } catch {
        foot = 48;
    }

    const pitch = Number(renderer.cam?.pitch ?? 34);
    if (pitch >= 80) {
        const size = Math.max(28, foot);
        return {
            x: rect.left + center.x - size / 2,
            y: rect.top + center.y - size / 2,
            width: size,
            height: size
        };
    }

    let top = null;
    try {
        const top3d = renderer.standeeTop?.(id);
        if (top3d) top = renderer.project?.(top3d) ?? null;
    } catch {
        top = null;
    }
    const halfH = top && Number.isFinite(top.y) && center.y > top.y
        ? Math.max(foot * 0.45, center.y - top.y)
        : Math.max(foot * 0.65, 24);
    const width = Math.max(28, foot * 0.85);
    const height = Math.max(28, halfH * 2);
    return {
        x: rect.left + center.x - width / 2,
        y: rect.top + center.y - height / 2,
        width,
        height
    };
}

/** 获取 2.5D 立牌中心的视口坐标（用于绝招收束原点定位，基于未反冲父容器坐标）。 */
export function getDioramaTokenScreenPoint(token) {
    const view = getDioramaView();
    const renderer = view?.renderer;
    const rect = getDioramaContainerRect(view);
    const id = token?.document?.id ?? token?.id;
    if (!renderer || !rect || !id) return null;
    let center = null;
    try {
        center = renderer.standeeCenter?.(id);
    } catch {
        return null;
    }
    if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;
    return { x: rect.left + center.x, y: rect.top + center.y };
}

/** 获取绝招反冲动画应震动的 2.5D 画布元素。 */
export function getDioramaRecoilElement() {
    return getDioramaView()?.canvas ?? null;
}

/** 按屏幕滚屏向量推动 2.5D 相机；正值向右/向下滚动，并同步手动平移时间戳避免跟随开关拉回镜头。 */
export function panDioramaBy(dx, dy) {
    const view = getDioramaView();
    const renderer = view?.renderer;
    if (!renderer || typeof renderer.panBy !== "function") return false;
    if (!dx && !dy) return true;
    try {
        renderer.panBy(-dx, -dy);
        const now = performance.now();
        view._userPanned = now;
        view._wakeAt = now;
        return true;
    } catch {
        return false;
    }
}

/** 目标选择等外部交互拦截了 2.5D 未拖动的右键松开时，复位待处理右键拖拽以免后续移动误触发平移。 */
export function cancelDioramaRightClickDrag() {
    const view = getDioramaView();
    if (!view) return false;
    if (view._drag?.button === 2 && !view._drag.moved) {
        view._drag = null;
        if (view._pingTimer) clearTimeout(view._pingTimer);
        return true;
    }
    return false;
}

/** 将数字/Foundry Color/CSS 色值统一转换为 CSS 颜色字符串。 */
export function normalizeCssColor(color, fallback = "#ffffff") {
    if (color === null || color === undefined || color === "") return fallback;
    if (typeof color === "number" && Number.isFinite(color)) {
        return `#${(Math.trunc(color) & 0xffffff).toString(16).padStart(6, "0")}`;
    }
    if (typeof color === "object") {
        if (typeof color.css === "string" && color.css.trim()) return color.css.trim();
        if (typeof color.valueOf === "function") {
            const val = color.valueOf();
            if (typeof val === "number" && Number.isFinite(val)) {
                return `#${(Math.trunc(val) & 0xffffff).toString(16).padStart(6, "0")}`;
            }
        }
        return fallback;
    }
    if (typeof color === "string") {
        const trimmed = color.trim();
        return trimmed || fallback;
    }
    return fallback;
}

function colorToInt(color, fallback = 0x40d0c0) {
    if (typeof color === "number" && Number.isFinite(color)) {
        return Math.trunc(color) & 0xffffff;
    }
    const css = normalizeCssColor(color, "");
    const match = /^#?([0-9a-f]{6})$/i.exec(css);
    if (match) return parseInt(match[1], 16) & 0xffffff;
    if (typeof color === "object" && typeof color?.valueOf === "function") {
        const val = color.valueOf();
        if (typeof val === "number" && Number.isFinite(val)) return Math.trunc(val) & 0xffffff;
    }
    return fallback & 0xffffff;
}

function intToRgb01(num) {
    const c = Math.trunc(Number(num) || 0) & 0xffffff;
    return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}

/** 在 2.5D 立牌头顶显示系统飘字；未开启或接口不可用时返回 false。 */
export function floatDioramaText(token, text, settings = {}) {
    const view = getDioramaView();
    const id = token?.document?.id ?? token?.id;
    if (!view || typeof view.floatText !== "function" || !id) return false;
    const color = normalizeCssColor(settings?.fill, "#ffffff");
    try {
        view.floatText(id, String(text ?? ""), color);
        return true;
    } catch {
        return false;
    }
}

/* -------------------------------------------- */
/*  自定义 1-2-2-2 距离预览同步补丁 (#5)           */
/* -------------------------------------------- */

/**
 * 依据已被 `SquareGrid.prototype.measurePath` 改写好的段结果，
 * 在同一份测量结果上同步更新段成本、`backward.cost`、总 `cost/distance` 与 `waypoints[].cost/distance`，
 * 完整保留 Foundry 原有的路点与段对象引用。
 * 若传入与路点对齐的 `fixedStepCosts`（如本回合移动历史固定消耗），历史段保留原固定成本，仅对新路段使用重算成本。
 * @param {object} result - measureMovementPath 的原始返回对象
 * @param {Array<number|null>|null} [fixedStepCosts=null] - 各目标路点预设的固定单步成本
 * @returns {object}
 */
export function syncMovementPathPreviewResult(result, fixedStepCosts = null) {
    if (!result || !Array.isArray(result.segments) || result.segments.length === 0) return result;
    const waypoints = Array.isArray(result.waypoints) ? result.waypoints : null;
    const hasWaypoints = Boolean(waypoints && waypoints.length === result.segments.length + 1);
    const useFixedCosts = Array.isArray(fixedStepCosts) && fixedStepCosts.length === result.segments.length + 1;
    let runningDist = hasWaypoints && Number.isFinite(waypoints[0]?.distance)
        ? Number(waypoints[0].distance)
        : 0;
    let runningCost = hasWaypoints && Number.isFinite(waypoints[0]?.cost)
        ? Number(waypoints[0].cost)
        : 0;

    for (let i = 0; i < result.segments.length; i++) {
        const seg = result.segments[i];
        const segDist = Number(seg?.distance) || 0;
        const fixedCost = useFixedCosts ? fixedStepCosts[i + 1] : null;
        const hasFixed = typeof fixedCost === "number" && Number.isFinite(fixedCost);
        const segCost = hasFixed ? fixedCost : (typeof seg?.cost === "number" ? seg.cost : segDist);
        if (seg && typeof seg === "object" && hasFixed) {
            seg.cost = segCost;
        }
        runningDist += segDist;
        runningCost += segCost;
        if (hasWaypoints) {
            const wp = waypoints[i + 1];
            if (wp && typeof wp === "object") {
                wp.distance = runningDist;
                wp.cost = runningCost;
                if (hasFixed && wp.backward && typeof wp.backward === "object" && wp.backward !== seg) {
                    wp.backward.cost = segCost;
                }
            }
        }
    }

    result.distance = runningDist;
    result.cost = runningCost;
    return result;
}

function resolveFixedStepCosts(waypoints, doc) {
    const len = waypoints.length;
    const fixed = new Array(len).fill(null);
    let hasFixed = false;

    for (let i = 1; i < len; i++) {
        const cost = waypoints[i]?.cost;
        if (typeof cost === "number" && Number.isFinite(cost)) {
            fixed[i] = cost;
            hasFixed = true;
        }
    }

    let hist = null;
    try {
        hist = doc?.movementHistory;
    } catch {
        hist = null;
    }
    // rutz-diorama 会用新路径起点替换 movementHistory 最后一个路点而丢失其固定 cost；
    // 当传入路点前缀与 doc.movementHistory 坐标逐点吻合时，按历史记录补齐接合点（及历史前缀）成本。
    if (Array.isArray(hist) && hist.length >= 2 && hist.length <= len) {
        let prefixMatches = true;
        for (let i = 0; i < hist.length; i++) {
            const h = hist[i];
            const wp = waypoints[i];
            if (
                !h || !wp
                || !Number.isFinite(h.x) || !Number.isFinite(h.y)
                || !Number.isFinite(wp.x) || !Number.isFinite(wp.y)
                || Math.abs(wp.x - h.x) > 1
                || Math.abs(wp.y - h.y) > 1
            ) {
                prefixMatches = false;
                break;
            }
        }
        if (prefixMatches) {
            for (let i = 1; i < hist.length; i++) {
                if (fixed[i] === null) {
                    const hCost = hist[i]?.cost;
                    if (typeof hCost === "number" && Number.isFinite(hCost)) {
                        fixed[i] = hCost;
                        hasFixed = true;
                    }
                }
            }
        }
    }

    return hasFixed ? fixed : null;
}

function prepareWaypointsForDioramaMeasure(waypoints, doc = null) {
    if (!Array.isArray(waypoints) || waypoints.length < 2) return null;
    const firstElev = typeof waypoints[0]?.elevation === "number" && Number.isFinite(waypoints[0].elevation)
        ? waypoints[0].elevation
        : 0;
    let hasElevationDiff = false;
    let hasInputCosts = false;
    for (let i = 1; i < waypoints.length; i++) {
        const wp = waypoints[i];
        if (!hasElevationDiff) {
            const elev = typeof wp?.elevation === "number" && Number.isFinite(wp.elevation) ? wp.elevation : firstElev;
            if (Math.abs(elev - firstElev) > 1e-4) hasElevationDiff = true;
        }
        if (!hasInputCosts && typeof wp?.cost === "number" && Number.isFinite(wp.cost)) {
            hasInputCosts = true;
        }
        if (hasElevationDiff && hasInputCosts) break;
    }

    const fixedStepCosts = resolveFixedStepCosts(waypoints, doc);
    if (!hasElevationDiff && !hasInputCosts && !fixedStepCosts) return null;

    const origElevations = hasElevationDiff ? waypoints.map(wp => wp?.elevation) : null;
    const preparedWaypoints = (hasElevationDiff || hasInputCosts)
        ? waypoints.map((wp, idx) => {
            if (!wp || typeof wp !== "object") return wp;
            const copy = { ...wp };
            if (hasElevationDiff && typeof copy.elevation === "number") {
                copy.elevation = firstElev;
            }
            if (hasInputCosts && idx >= 1 && typeof copy.cost === "number") {
                delete copy.cost;
            }
            return copy;
        })
        : waypoints;
    return { origElevations, fixedStepCosts, preparedWaypoints };
}

/**
 * 仅在 `rutz-diorama` 开启拖拽预览路径计算时剥离 2.5D 高差与历史固定成本的倍率误判，并同步 1-2-2-2 成本；
 * 2D 画布及正式移动提交均保持原始语义不变。
 * @param {object|null} [targetProto] - 显式原型（主要供单元测试注入）
 * @param {{isDocFallback?: boolean}} [opts]
 * @returns {boolean} 是否完成包装
 */
export function installMovementPreviewPatch(targetProto = null, { isDocFallback = false } = {}) {
    let customEnabled = false;
    try {
        customEnabled = Boolean(globalThis.game?.settings?.get?.("xjzl-system", "customDistanceRule"));
    } catch {
        customEnabled = false;
    }
    if (!customEnabled) return false;

    let proto = targetProto;
    let docFallback = isDocFallback;
    if (!proto) {
        const tokenProto = globalThis.CONFIG?.Token?.objectClass?.prototype;
        const docProto = globalThis.CONFIG?.Token?.documentClass?.prototype;
        if (typeof tokenProto?.measureMovementPath === "function") {
            proto = tokenProto;
            docFallback = false;
        } else if (typeof docProto?.measureMovementPath === "function") {
            proto = docProto;
            docFallback = true;
        }
    }
    if (!proto || typeof proto.measureMovementPath !== "function") return false;
    if (proto[PATCHED_MEASURE_MOVEMENT]) return true;

    const origMeasureMovementPath = proto.measureMovementPath;
    proto[PATCHED_MEASURE_MOVEMENT] = true;
    proto.measureMovementPath = function xjzlDioramaMeasureMovementPath(waypoints, options = {}, ...rest) {
        const shouldSync = Boolean(
            isDioramaOpen()
            && (docFallback || options?.preview === true)
            && globalThis.canvas?.grid?.diagonals === globalThis.CONST?.GRID_DIAGONALS?.EQUIDISTANT
        );
        const doc = this?.document ?? this;
        const prepared = shouldSync ? prepareWaypointsForDioramaMeasure(waypoints, doc) : null;
        const res = origMeasureMovementPath.call(
            this,
            prepared ? prepared.preparedWaypoints : waypoints,
            options,
            ...rest
        );
        const finalize = resolved => {
            if (!shouldSync) return resolved;
            const synced = syncMovementPathPreviewResult(resolved, prepared?.fixedStepCosts ?? null);
            if (prepared?.origElevations && Array.isArray(synced?.waypoints) && synced.waypoints.length === prepared.origElevations.length) {
                for (let idx = 0; idx < synced.waypoints.length; idx++) {
                    const origElev = prepared.origElevations[idx];
                    const wp = synced.waypoints[idx];
                    if (origElev !== undefined && wp && typeof wp === "object") {
                        wp.elevation = origElev;
                    }
                }
            }
            return synced;
        };
        if (res && typeof res.then === "function") {
            return res.then(finalize);
        }
        return finalize(res);
    };
    return true;
}

/* -------------------------------------------- */
/*  2.5D 左键交互与拾取语义对齐 (2D 一致性)         */
/* -------------------------------------------- */

/**
 * 临时兼容补丁：rutz-diorama 当前将普通视图下的左键空地拖拽与右键拖拽都映射为平移，
 * 导致 2.5D 视角下无法直接框选多个己方 Token。
 * 已有社区反馈给上游作者；待 rutz-diorama 后续更新原生支持左键空地框选后，可直接移除本补丁及调用。
 *
 * @param {object} view - DioramaView 实例
 * @returns {boolean} 是否成功安装或已安装
 */
export function installDioramaBoxSelectPatch(view) {
    const proto = view ? Object.getPrototypeOf(view) : null;
    if (!proto || typeof proto._down !== "function") return false;
    if (proto[PATCHED_BOX_SELECT]) return true;

    const origDown = proto._down;
    proto[PATCHED_BOX_SELECT] = true;
    proto._down = function xjzlBoxSelectDown(e, ...rest) {
        const result = origDown.call(this, e, ...rest);
        try {
            const d = this._drag;
            const inNormalView = !this.editing && !this.stamping && !this.regionMode
                && !(this.wallMode && this.wallPaint)
                && !this._pickOn && !this._tplOn && !this._inkOn && !this._tileOn && !this._lightOn;
            if (
                d && !d.box && !d.tokenId && !d.ruler
                && inNormalView
                && e?.button === 0 && e.pointerType !== "touch"
                && !e.ctrlKey && !e.metaKey && !e.altKey
                && d.hit?.type !== "door"
                && typeof this.cfg?.onBoxSelect === "function"
            ) {
                d.box = true;
            }
        } catch (err) {
            console.warn("XJZL | 2.5D 左键框选补丁执行异常，已保持默认拖拽行为：", err);
        }
        return result;
    };
    return true;
}

/**
 * 使 2.5D 视图下左键点击空白地面尊重 Foundry 核心设置 `core.leftClickRelease`：
 * 默认未开启“左键点空地取消选中”且未使用 mod 自身的左键点击移动时，不再强行清空当前选中 Token。
 *
 * @param {object} view - DioramaView 实例
 * @returns {boolean} 是否成功安装或已安装
 */
export function installDioramaCellClickPatch(view) {
    const cfg = view?.cfg;
    const origOnCellClick = cfg?.onCellClick;
    if (!cfg || typeof origOnCellClick !== "function") return false;
    if (origOnCellClick[PATCHED_CELL_CLICK]) return true;

    const wrapped = function xjzlDioramaOnCellClick(col, row, ...rest) {
        let clickMove = "off";
        try {
            clickMove = String(globalThis.game?.settings?.get?.(MOD_ID, "clickMove") ?? "off");
        } catch {
            clickMove = "off";
        }
        if (clickMove === "left") {
            return origOnCellClick.call(this, col, row, ...rest);
        }
        let releaseOnLeftClick = false;
        try {
            releaseOnLeftClick = Boolean(globalThis.game?.settings?.get?.("core", "leftClickRelease"));
        } catch {
            releaseOnLeftClick = false;
        }
        if (!releaseOnLeftClick) return undefined;
        return origOnCellClick.call(this, col, row, ...rest);
    };
    wrapped[PATCHED_CELL_CLICK] = true;
    cfg.onCellClick = wrapped;
    return true;
}

/**
 * 扩展 `DioramaRenderer.prototype.pick`：在斜视 2.5D 视角下点击 Token 脚底所占格子时，
 * 即使指针未落到上方立牌纸片，也回退命中站在该格内的真实可见 Token（覆盖点选、拖拽与目标选择）。
 *
 * @param {object} renderer - DioramaRenderer 实例或原型
 * @returns {boolean} 是否成功安装或已安装
 */
export function installDioramaFootprintPickPatch(renderer) {
    const proto = renderer
        ? (typeof renderer.pick === "function" && Object.prototype.hasOwnProperty.call(renderer, "pick")
            ? renderer
            : Object.getPrototypeOf(renderer))
        : null;
    if (!proto || typeof proto.pick !== "function") return false;
    if (proto[PATCHED_FOOTPRINT_PICK]) return true;

    const origPick = proto.pick;
    proto[PATCHED_FOOTPRINT_PICK] = true;
    proto.pick = function xjzlDioramaPick(px, py, opts, ...rest) {
        const hit = origPick.call(this, px, py, opts, ...rest);
        if (
            hit?.type !== "cell"
            || opts?.tokens === false
            || opts?.props
            || opts?.walls
            || Number(this.cam?.pitch ?? 34) >= 80
            || !Array.isArray(this._layout)
            || this._layout.length === 0
        ) {
            return hit;
        }

        const cx = hit.col + 0.5;
        const cz = hit.row + 0.5;
        let best = null;
        let bestRank = -Infinity;

        for (let i = 0; i < this._layout.length; i++) {
            const L = this._layout[i];
            const t = L?.t;
            if (!t || t.ghost || t.prop) continue;
            const idStr = String(t.id ?? "");
            if (!idStr || idStr.endsWith("#start") || idStr.endsWith("#ghost")) continue;
            if ((t.alpha ?? 1) <= 0.01 || (L.roofK ?? 0) > 0.95) continue;
            if (!Array.isArray(L.ring) || L.ring.length < 3) continue;

            const hw = Math.max(0.5, (Number(t.w) || 1) / 2);
            if (Math.abs(cx - L.ring[0]) > hw + 1e-4 || Math.abs(cz - L.ring[2]) > hw + 1e-4) continue;

            const rank = Number(t.stackRank) || 0;
            if (!best || rank > bestRank || (rank === bestRank && i > best.index)) {
                best = { L, index: i };
                bestRank = rank;
            }
        }

        return best ? { type: "token", id: best.L.t.id, token: best.L.t } : hit;
    };
    return true;
}

/* -------------------------------------------- */
/*  WebGL 3D 渲染器增强 (立牌受击动作 + 3D 特效)    */
/* -------------------------------------------- */

const STANDEE_REACTION_FRAMES = [
    { time: 0, offset: 0, squash: 0, flash: 0 },
    { time: 0.07, offset: 0.5, squash: 0.9, flash: 1 },
    { time: 0.18, offset: 1, squash: 1, flash: 0.92 },
    { time: 0.32, offset: -0.62, squash: -0.6, flash: 0.58 },
    { time: 0.48, offset: 0.34, squash: 0.34, flash: 0.28 },
    { time: 0.65, offset: -0.16, squash: -0.16, flash: 0.08 },
    { time: 0.82, offset: 0.05, squash: 0, flash: 0 },
    { time: 1, offset: 0, squash: 0, flash: 0 }
];

function sampleStandeeReaction(progress) {
    const p = clamp(progress, 0, 1);
    const end = STANDEE_REACTION_FRAMES.findIndex(f => f.time >= p);
    if (end <= 0) return STANDEE_REACTION_FRAMES[end === 0 ? 0 : STANDEE_REACTION_FRAMES.length - 1];
    const from = STANDEE_REACTION_FRAMES[end - 1];
    const to = STANDEE_REACTION_FRAMES[end];
    const q = (p - from.time) / Math.max(1e-5, to.time - from.time);
    const eased = q * q * (3 - 2 * q);
    return {
        offset: from.offset + (to.offset - from.offset) * eased,
        squash: from.squash + (to.squash - from.squash) * eased,
        flash: from.flash + (to.flash - from.flash) * eased
    };
}

function pruneExpiredStandeeReactions(now = performance.now()) {
    let activeCount = 0;
    for (const [id, r] of activeStandeeReactions) {
        if (now - r.startedAt >= r.duration || r.token?.destroyed) {
            activeStandeeReactions.delete(id);
        } else {
            activeCount++;
        }
    }
    return activeCount > 0;
}

/**
 * 包装 `DioramaRenderer` 原型以注入真 3D 效果：
 * - `_standeeLayout`：在不触碰地面圆环 `L.ring` 的前提下驱动立牌击退位移、纵横挤压与轻微倾倒；
 * - `_drawStandees`：在非阴影主通道叠加 `L.extra` 受击高亮（`render()` 会在两方法之间覆写 `L.extra`）；
 * - `setHighlights`：将纯系统光环覆格的块状高亮柔化为原生细边轮廓，为 3D 立体气幕结界让出视觉舞台；
 * - `_drawAreaEdges`：在真实 3D 深度缓冲下渲染 4 层立体气幕光环（贴地圆环/波纹、圆柱气幕、悬浮细环与螺旋气丝）；
 * - `setEffects`：注入 3D 竖立受击斩痕 (`mode: "upright"`)；
 * - `needsFrame`：在立牌受击反应或开启粒子效果的 3D 光环运转期间维持平滑帧率。
 *
 * @param {object} renderer - DioramaRenderer 实例或原型
 * @returns {boolean} 是否成功安装或已安装
 */
export function installDioramaRendererFxPatch(renderer) {
    const proto = renderer
        ? (typeof renderer.setEffects === "function" && Object.prototype.hasOwnProperty.call(renderer, "setEffects")
            ? renderer
            : Object.getPrototypeOf(renderer))
        : null;
    if (!proto || typeof proto.setEffects !== "function") return false;
    if (proto[PATCHED_RENDERER_FX]) return true;
    proto[PATCHED_RENDERER_FX] = true;

    if (typeof proto._standeeLayout === "function") {
        const origStandeeLayout = proto._standeeLayout;
        proto._standeeLayout = function xjzlDioramaStandeeLayout(cam, ...rest) {
            const layout = origStandeeLayout.call(this, cam, ...rest);
            if (!Array.isArray(layout) || activeStandeeReactions.size === 0) return layout;

            const now = performance.now();
            const camRight = cam?.right ?? [1, 0, 0];
            for (const L of layout) {
                const t = L?.t;
                if (!t || t.prop) continue;
                const id = String(t.id ?? "");
                if (!id || id.endsWith("#ghost") || id.endsWith("#start")) continue;
                const r = activeStandeeReactions.get(id);
                if (!r) continue;

                const elapsed = now - r.startedAt;
                if (elapsed >= r.duration || r.token?.destroyed) {
                    activeStandeeReactions.delete(id);
                    continue;
                }

                const progress = elapsed / r.duration;
                const frame = sampleStandeeReaction(progress);
                const dirX = r.hasWorldDir ? r.dirX : camRight[0];
                const dirZ = r.hasWorldDir ? r.dirZ : camRight[2];

                // 1. 击退位移与轻微受击弹起：只偏移 L.base，地面 L.ring 保持锚定
                if (!r.photosafe && Array.isArray(L.base) && L.base.length >= 3) {
                    const move = frame.offset * r.ampCells;
                    const lift = Math.max(0, frame.offset) * r.popCells;
                    L.base = [
                        L.base[0] + dirX * move,
                        L.base[1] + lift,
                        L.base[2] + dirZ * move
                    ];
                }

                // 2. 纵横挤压拉伸
                if (!r.photosafe && r.squashAmt > 0) {
                    const sq = frame.squash * r.squashAmt;
                    if (Number.isFinite(L.w)) L.w = L.w * (1 + sq);
                    const baseH = L.hDraw ?? L.h;
                    if (Number.isFinite(baseH)) L.hDraw = baseH * (1 - sq * 0.72);
                }

                // 3. 纸片立牌受击微小倾倒（已倒地/死亡立牌保持躺姿；倾斜上限 <= 0.22 避免影响阴影通道）
                if (!r.photosafe && (L.fall ?? 0) < 0.25 && r.tiltAmt > 0) {
                    const tilt = Math.min(0.22, Math.abs(frame.offset) * r.tiltAmt);
                    if (tilt > 1e-4) {
                        const dot = dirX * camRight[0] + dirZ * camRight[2];
                        const hitSide = dot >= 0 ? 1 : -1;
                        L.fall = tilt;
                        L.fallDir = frame.offset >= 0 ? hitSide : -hitSide;
                    }
                }

                // 4. 像素精准剪影染色（浅拷贝 L.t，不污染原 token 对象）
                const strength = r.photosafe
                    ? Math.sin(progress * Math.PI) * 0.42
                    : frame.flash * (r.critical ? 0.94 : r.gentle ? 0.56 : 0.86);
                const [fr, fg, fb] = r.flashRgb;
                const baseTint = Array.isArray(t.tint) && t.tint.length >= 3 ? t.tint : [1, 1, 1];
                const tintBlend = clamp(strength, 0, 1);
                const targetTint = [
                    Math.min(1.85, fr * 1.48 + 0.16),
                    Math.min(1.85, fg * 1.48 + 0.16),
                    Math.min(1.85, fb * 1.48 + 0.16)
                ];
                L.t = {
                    ...t,
                    tint: [
                        baseTint[0] + (targetTint[0] - baseTint[0]) * tintBlend,
                        baseTint[1] + (targetTint[1] - baseTint[1]) * tintBlend,
                        baseTint[2] + (targetTint[2] - baseTint[2]) * tintBlend
                    ]
                };

                // 5. 暂存本帧附加受击光，待 _drawStandees 主通道再叠加到 L.extra
                const extraGain = r.photosafe
                    ? Math.sin(progress * Math.PI) * 0.28
                    : frame.flash * (r.critical ? 0.95 : r.gentle ? 0.44 : 0.72);
                L._xjzlHitExtra = [fr * extraGain, fg * extraGain, fb * extraGain];
            }
            return layout;
        };
    }

    if (typeof proto._drawStandees === "function") {
        const origDrawStandees = proto._drawStandees;
        proto._drawStandees = function xjzlDioramaDrawStandees(layout, cam, light, depthOnly, ...rest) {
            if (!depthOnly && Array.isArray(layout)) {
                for (const L of layout) {
                    const boost = L?._xjzlHitExtra;
                    if (!Array.isArray(boost)) continue;
                    const baseExtra = Array.isArray(L.extra) ? L.extra : [0, 0, 0];
                    L.extra = [
                        baseExtra[0] + boost[0],
                        baseExtra[1] + boost[1],
                        baseExtra[2] + boost[2]
                    ];
                    delete L._xjzlHitExtra;
                }
            }
            return origDrawStandees.call(this, layout, cam, light, depthOnly, ...rest);
        };
    }

    if (typeof proto.setHighlights === "function") {
        const origSetHighlights = proto.setHighlights;
        proto.setHighlights = function xjzlDioramaSetHighlights(rgba, opts, ...rest) {
            if (!(rgba instanceof Uint8Array) || !isDioramaOpen()) {
                return origSetHighlights.call(this, rgba, opts, ...rest);
            }
            const view = getDioramaView();
            const isEditingRegions = Boolean(
                view?.regionMode
                || (view?.stamping && view?.stampFill)
                || globalThis.canvas?.regions?.active
            );
            if (isEditingRegions) {
                return origSetHighlights.call(this, rgba, opts, ...rest);
            }
            const metrics = getGridMetrics();
            const nextRgba = softenAuraHighlightsRgba(rgba, this, metrics);
            const res = origSetHighlights.call(this, nextRgba, opts, ...rest);
            if (Array.isArray(this._hlEdges) && this._hlEdges.length > 0 && metrics && this.cols > 0) {
                const pureAuraCells = collectPureAuraCellSet(this, metrics);
                if (pureAuraCells.size > 0) {
                    this._hlEdges = this._hlEdges.filter(e => !pureAuraCells.has(e.r * this.cols + e.c));
                }
            }
            return res;
        };
    }

    if (typeof proto._drawAreaEdges === "function") {
        const origDrawAreaEdges = proto._drawAreaEdges;
        proto._drawAreaEdges = function xjzlDioramaDrawAreaEdges(cam, ...rest) {
            const res = origDrawAreaEdges.call(this, cam, ...rest);
            if (isDioramaOpen() && cam?.vp) {
                try {
                    drawDiorama3DAuras(this, cam);
                } catch (err) {
                    if (!warnedAuraRenderFailure) {
                        warnedAuraRenderFailure = true;
                        console.warn("XJZL | 2.5D 立体光环渲染失败，已回退基础显示：", err);
                    }
                }
            }
            return res;
        };
    }

    if (typeof proto.needsFrame === "function") {
        const origNeedsFrame = proto.needsFrame;
        proto.needsFrame = function xjzlDioramaNeedsFrame(...rest) {
            return Boolean(origNeedsFrame.call(this, ...rest))
                || pruneExpiredStandeeReactions()
                || hasAnimated3DAuras();
        };
    }

    const origSetEffects = proto.setEffects;
    proto.setEffects = function xjzlDioramaSetEffects(list, ...rest) {
        if (!isDioramaOpen()) {
            return origSetEffects.call(this, list, ...rest);
        }
        const now = performance.now();
        const view = getDioramaView();
        if (view && (pruneExpiredStandeeReactions(now) || activeHitEffects.length > 0)) {
            view._wakeAt = now;
        }
        const extras = buildInjected3DEffects(this, now);
        if (extras.length === 0) {
            return origSetEffects.call(this, list, ...rest);
        }
        const base = Array.isArray(list) ? list : [];
        return origSetEffects.call(this, [...base, ...extras], ...rest);
    };
    return true;
}

/* -------------------------------------------- */
/*  共享 2.5D 叠加层画布 (立体光环标签/粒子 + 预览) */
/* -------------------------------------------- */

function ensureOverlayCanvas(view) {
    const root = view?.root;
    if (!root || typeof globalThis.document?.createElement !== "function") return null;
    if (overlayCanvas && overlayCanvas.parentElement === root && overlayHostView === view) {
        resizeOverlayCanvas(view);
        return overlayCanvas;
    }
    destroyOverlayCanvas();

    const canvasEl = document.createElement("canvas");
    canvasEl.className = OVERLAY_CLASS;
    canvasEl.setAttribute("aria-hidden", "true");
    Object.assign(canvasEl.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: "2"
    });
    root.appendChild(canvasEl);

    const ctx = canvasEl.getContext("2d");
    if (!ctx) {
        canvasEl.remove();
        return null;
    }
    overlayCanvas = canvasEl;
    overlayCtx = ctx;
    overlayHostView = view;
    resizeOverlayCanvas(view);

    if (typeof globalThis.ResizeObserver === "function") {
        overlayResizeObserver = new ResizeObserver(() => resizeOverlayCanvas(view));
        overlayResizeObserver.observe(root);
    }
    return overlayCanvas;
}

function resizeOverlayCanvas(view = overlayHostView) {
    if (!overlayCanvas || !view?.root) return null;
    const width = Math.max(1, Math.round(view.root.clientWidth || view.canvas?.clientWidth || 1));
    const height = Math.max(1, Math.round(view.root.clientHeight || view.canvas?.clientHeight || 1));
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 1.5);
    const targetW = Math.max(1, Math.round(width * dpr));
    const targetH = Math.max(1, Math.round(height * dpr));
    if (overlayCanvas.width !== targetW || overlayCanvas.height !== targetH) {
        overlayCanvas.width = targetW;
        overlayCanvas.height = targetH;
    }
    return { width, height, dpr };
}

function destroyOverlayCanvas() {
    overlayResizeObserver?.disconnect?.();
    overlayResizeObserver = null;
    overlayCanvas?.remove?.();
    overlayCanvas = null;
    overlayCtx = null;
    overlayHostView = null;
}

function stopOverlayLoop() {
    if (rafId && typeof globalThis.cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
    }
    rafId = 0;
    lastFrameAt = 0;
    if (overlayCtx && overlayCanvas) {
        overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
}

function syncOverlayLoop() {
    const view = getDioramaView();
    if (!view) {
        stopOverlayLoop();
        return;
    }
    const auras = getVisibleAuras();
    const needLoop = auras.length > 0 || placementPreview !== null;
    if (!needLoop) {
        stopOverlayLoop();
        return;
    }
    ensureOverlayCanvas(view);
    if (!rafId && typeof globalThis.requestAnimationFrame === "function") {
        lastFrameAt = performance.now();
        rafId = requestAnimationFrame(tickOverlay);
    }
}

function tickOverlay(now) {
    rafId = 0;
    const view = getDioramaView();
    if (!view) {
        stopOverlayLoop();
        return;
    }
    const dt = Math.min(80, Math.max(0, now - (lastFrameAt || now)));
    lastFrameAt = now;

    const auras = getVisibleAuras();
    if (auras.length === 0 && placementPreview === null) {
        stopOverlayLoop();
        return;
    }

    const canvasEl = ensureOverlayCanvas(view);
    const sizeInfo = canvasEl ? resizeOverlayCanvas(view) : null;
    if (overlayCtx && sizeInfo) {
        const { width, height, dpr } = sizeInfo;
        overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        overlayCtx.clearRect(0, 0, width, height);

        const metrics = getGridMetrics();
        const renderer = view.renderer;
        if (renderer && metrics) {
            renderAuras25DOverlay(overlayCtx, renderer, metrics, auras, dt, dpr);
            renderPlacementPreview25D(overlayCtx, renderer, metrics, dpr);
        }
    }

    if (auras.length > 0 || placementPreview !== null) {
        rafId = requestAnimationFrame(tickOverlay);
    }
}

/* -------------------------------------------- */
/*  仿射投影与离屏染色缓存                         */
/* -------------------------------------------- */

function getGridMetrics() {
    const d = globalThis.canvas?.dimensions;
    const size = Number(d?.size) || 0;
    if (!(size > 0)) return null;
    const ox = Math.floor((Number(d.sceneX) || 0) / size + 1e-6) * size;
    const oy = Math.floor((Number(d.sceneY) || 0) / size + 1e-6) * size;
    return { ox, oy, size };
}

function projectGroundCircle(renderer, xPx, yPx, rPx, metrics) {
    if (!renderer?.project || !(rPx > 0) || !metrics) return null;
    const cxCell = (xPx - metrics.ox) / metrics.size;
    const czCell = (yPx - metrics.oy) / metrics.size;
    const rCell = rPx / metrics.size;
    let groundY = 0;
    try {
        groundY = (typeof renderer.groundAt === "function" ? Number(renderer.groundAt(cxCell, czCell, 1)) || 0 : 0) + 0.03;
    } catch {
        groundY = 0.03;
    }
    let pO = null;
    let pU = null;
    let pV = null;
    try {
        pO = renderer.project([cxCell, groundY, czCell]);
        pU = renderer.project([cxCell + rCell, groundY, czCell]);
        pV = renderer.project([cxCell, groundY, czCell + rCell]);
    } catch {
        return null;
    }
    if (!pO || !pU || !pV) return null;
    if (![pO.x, pO.y, pU.x, pU.y, pV.x, pV.y].every(Number.isFinite)) return null;
    return {
        pO,
        pU,
        pV,
        ux: (pU.x - pO.x) / rPx,
        uy: (pU.y - pO.y) / rPx,
        vx: (pV.x - pO.x) / rPx,
        vy: (pV.y - pO.y) / rPx
    };
}

function getTintedSurface(key, baseCanvas, tintNum) {
    if (!baseCanvas || typeof globalThis.document?.createElement !== "function") return null;
    const tint = (Math.trunc(Number(tintNum) || 0) & 0xffffff);
    const cacheKey = `${key}|${tint}`;
    if (tintedSurfaces.has(cacheKey)) return tintedSurfaces.get(cacheKey);

    const surface = document.createElement("canvas");
    surface.width = baseCanvas.width;
    surface.height = baseCanvas.height;
    const ctx = surface.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(baseCanvas, 0, 0);
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = `#${tint.toString(16).padStart(6, "0")}`;
    ctx.fillRect(0, 0, surface.width, surface.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(baseCanvas, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    if (tintedSurfaces.size >= MAX_TINTED_SURFACES) {
        tintedSurfaces.delete(tintedSurfaces.keys().next().value);
    }
    tintedSurfaces.set(cacheKey, surface);
    return surface;
}

/* -------------------------------------------- */
/*  #2 光环 2.5D 立体结界气幕渲染 + 高亮让位       */
/* -------------------------------------------- */

function isRegionVisibleInScene(region) {
    if (!region?.shapes?.length) return false;
    const isGM = Boolean(globalThis.game?.user?.isGM);
    if (region.hidden && !isGM) return false;
    const VIS = globalThis.CONST?.REGION_VISIBILITY ?? { LAYER: 0, GAMEMASTER: 1, ALWAYS: 2 };
    const vis = region.visibility ?? VIS.LAYER;
    const observer = VIS.OBSERVER !== undefined && vis === VIS.OBSERVER
        && (isGM || (region.testUserPermission?.(game.user, "OBSERVER") ?? true));
    const onLayer = Boolean(globalThis.canvas?.regions?.active) && (isGM || region.isOwner);
    if (!onLayer && !(vis === VIS.ALWAYS || (isGM && vis === VIS.GAMEMASTER) || observer)) return false;

    const levelId = globalThis.canvas?.level?.id;
    const lv = region.levels;
    const lvSize = lv?.size ?? lv?.length ?? 0;
    if (levelId && lvSize && !(lv.has ? lv.has(levelId) : lv.includes?.(levelId))) return false;
    return true;
}

function resolveRegionCenter(region) {
    const bounds = region?.object?.bounds ?? region?.bounds;
    if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
        && Number.isFinite(bounds.width) && Number.isFinite(bounds.height)) {
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    }
    const origin = region?.shapes?.[0]?.origin;
    if (origin && Number.isFinite(origin.x) && Number.isFinite(origin.y)) {
        return { x: origin.x, y: origin.y };
    }
    return null;
}

function getVisibleAuras() {
    const regions = globalThis.canvas?.scene?.regions;
    if (!regions) return [];
    const list = [];
    for (const region of regions) {
        if (!isRegionVisibleInScene(region)) continue;
        const meta = region.getFlag?.("xjzl-system", "aura");
        const circleVisual = readAuraVisual(region.object ?? region);
        if (!circleVisual && !meta) continue;
        const center = resolveRegionCenter(region);
        if (!center) continue;

        const visual = circleVisual
            ? { ...circleVisual, shapeKind: "circle" }
            : {
                radius: Math.max(0, Math.trunc(meta?.params?.radius ?? 0)),
                rPx: 0,
                tint: colorToInt(region.color, 0x40d0c0),
                shapeKind: "rect"
            };
        list.push({
            id: region.id,
            name: String(region.name || ""),
            region,
            center,
            visual
        });
    }
    return list;
}

function getVisibleNonAuraRegions() {
    const regions = globalThis.canvas?.scene?.regions;
    if (!regions) return [];
    const list = [];
    for (const region of regions) {
        if (!isRegionVisibleInScene(region)) continue;
        if (region.getFlag?.("xjzl-system", "aura") || readAuraVisual(region.object ?? region)) continue;
        list.push(region);
    }
    return list;
}

function regionCoverageSignature(region, cols, rows, metrics, extra = "") {
    const b = region?.bounds ?? region?.object?.bounds;
    const bSig = b ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}` : "";
    const shapes = region?.shapes ?? [];
    const sSig = shapes.map(s => (
        `${s?.type ?? ""}:${Math.round(s?.x ?? s?.origin?.x ?? 0)},${Math.round(s?.y ?? s?.origin?.y ?? 0)},${Math.round(s?.radius ?? s?.width ?? 0)}`
    )).join(";");
    const elev = `${region?.elevation?.bottom ?? ""},${region?.elevation?.top ?? ""}`;
    return `${cols}x${rows}|${metrics.ox},${metrics.oy},${metrics.size}|${region?.highlightMode ?? ""}|${bSig}|${sSig}|${elev}|${extra}`;
}

function collectRegionCellData(region, center, rPx, renderer, metrics, cacheMap, cacheKeyExtra = "") {
    const cols = Math.max(0, Number(renderer?.cols) || 0);
    const rows = Math.max(0, Number(renderer?.rows) || 0);
    if (!cols || !rows || !metrics || !region) return null;

    const id = region.id ?? "";
    const sig = regionCoverageSignature(region, cols, rows, metrics, cacheKeyExtra);
    const cached = id ? cacheMap.get(id) : null;
    if (cached && cached.sig === sig) return cached;

    const idxSet = new Set();
    const placeable = region?.object;
    const grid = globalThis.canvas?.grid;

    const collectOffsets = offsets => {
        if (!Array.isArray(offsets) || typeof grid?.getTopLeftPoint !== "function") return false;
        for (const o of offsets) {
            const p = grid.getTopLeftPoint(o);
            if (!p) continue;
            const c = Math.round((p.x - metrics.ox) / metrics.size);
            const r = Math.round((p.y - metrics.oy) / metrics.size);
            if (c >= 0 && r >= 0 && c < cols && r < rows) idxSet.add(r * cols + c);
        }
        return idxSet.size > 0;
    };

    try {
        if (region?.highlightMode === "coverage" && typeof placeable?._getCoveredGridSpaceOffsets === "function") {
            collectOffsets(placeable._getCoveredGridSpaceOffsets());
        }
    } catch {
        idxSet.clear();
    }

    if (idxSet.size === 0) {
        try {
            const cov = typeof region?.getCoverage === "function" ? region.getCoverage() : null;
            if (cov?.covered) collectOffsets(cov.covered);
        } catch {
            idxSet.clear();
        }
    }

    if (idxSet.size === 0) {
        const b = region?.bounds ?? placeable?.bounds;
        let c0 = 0;
        let r0 = 0;
        let c1 = cols - 1;
        let r1 = rows - 1;
        if (b && Number.isFinite(b.x) && b.width > 0) {
            c0 = Math.max(0, Math.floor((b.x - metrics.ox) / metrics.size) - 1);
            r0 = Math.max(0, Math.floor((b.y - metrics.oy) / metrics.size) - 1);
            c1 = Math.min(cols - 1, Math.ceil((b.x + b.width - metrics.ox) / metrics.size) + 1);
            r1 = Math.min(rows - 1, Math.ceil((b.y + b.height - metrics.oy) / metrics.size) + 1);
        } else if (rPx > 0 && center) {
            c0 = Math.max(0, Math.floor((center.x - rPx - metrics.ox) / metrics.size) - 1);
            r0 = Math.max(0, Math.floor((center.y - rPx - metrics.oy) / metrics.size) - 1);
            c1 = Math.min(cols - 1, Math.ceil((center.x + rPx - metrics.ox) / metrics.size) + 1);
            r1 = Math.min(rows - 1, Math.ceil((center.y + rPx - metrics.oy) / metrics.size) + 1);
        }

        const hasTestPoint = typeof region?.testPoint === "function";
        const hasTree = typeof region?.polygonTree?.testPoint === "function";
        const testElev = Number.isFinite(region?.elevation?.bottom) ? region.elevation.bottom : 0;
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                const px = metrics.ox + (c + 0.5) * metrics.size;
                const py = metrics.oy + (r + 0.5) * metrics.size;
                let inside = false;
                if (hasTestPoint) {
                    try {
                        inside = Boolean(region.testPoint({ x: px, y: py, elevation: testElev }));
                    } catch {
                        inside = false;
                    }
                } else if (hasTree) {
                    try {
                        inside = Boolean(region.polygonTree.testPoint({ x: px, y: py }));
                    } catch {
                        inside = false;
                    }
                } else if (rPx > 0 && center) {
                    inside = Math.hypot(px - center.x, py - center.y) <= rPx + metrics.size * 0.15;
                }
                if (inside) idxSet.add(r * cols + c);
            }
        }
    }

    if (idxSet.size === 0) {
        if (id) cacheMap.delete(id);
        return null;
    }

    const sorted = Array.from(idxSet).sort((a, b) => a - b);
    const cells = Int32Array.from(sorted);
    let c0 = Infinity;
    let r0 = Infinity;
    let c1 = -1;
    let r1 = -1;
    const cellCoords = new Array(sorted.length);
    for (let i = 0; i < sorted.length; i++) {
        const idx = sorted[i];
        const c = idx % cols;
        const r = (idx - c) / cols;
        if (c < c0) c0 = c;
        if (c > c1) c1 = c;
        if (r < r0) r0 = r;
        if (r > r1) r1 = r;
        cellCoords[i] = [c, r];
    }

    const result = { sig, cells, idxSet, c0, r0, c1, r1, cellCoords };
    if (id) cacheMap.set(id, result);
    return result;
}

function getAuraCoveredCells(aura, renderer, metrics) {
    return collectRegionCellData(
        aura.region,
        aura.center,
        aura.visual.rPx,
        renderer,
        metrics,
        auraCellCache,
        `${aura.visual.shapeKind}:${aura.visual.radius}`
    );
}

function collectPureAuraCellSet(renderer, metrics = getGridMetrics()) {
    const pureCells = new Set();
    if (!metrics || !renderer) return pureCells;
    const auras = getVisibleAuras();
    if (auras.length === 0) return pureCells;

    for (const aura of auras) {
        const cellData = getAuraCoveredCells(aura, renderer, metrics);
        if (!cellData) continue;
        for (const idx of cellData.idxSet) pureCells.add(idx);
    }
    if (pureCells.size === 0) return pureCells;

    const nonAuraRegions = getVisibleNonAuraRegions();
    const liveNonAuraIds = new Set(nonAuraRegions.map(r => r.id));
    for (const key of nonAuraCellCache.keys()) {
        if (!liveNonAuraIds.has(key)) nonAuraCellCache.delete(key);
    }

    for (const region of nonAuraRegions) {
        const center = resolveRegionCenter(region);
        const cellData = collectRegionCellData(region, center, 0, renderer, metrics, nonAuraCellCache, "non-aura");
        if (!cellData) continue;
        for (const idx of cellData.idxSet) pureCells.delete(idx);
    }
    return pureCells;
}

/**
 * 保留系统光环清晰的生效格铺色高亮（规范化至 `AURA_HIGHLIGHT_ALPHA = 134`），
 * 并在 `setHighlights` 后移除纯粹属于光环的锯齿外围竖墙边，为 3D 半透明护罩穹顶让出边界。
 * 与非光环 Region / 普通法术模板重叠的格子保留原本高亮。
 *
 * @param {Uint8Array} rgba - 原始场景格子高亮缓冲区（不会被原地修改）
 * @param {object} renderer - DioramaRenderer 实例
 * @param {object|null} [metrics=getGridMetrics()] - 网格坐标参数
 * @returns {Uint8Array}
 */
export function softenAuraHighlightsRgba(rgba, renderer, metrics = getGridMetrics()) {
    if (!(rgba instanceof Uint8Array) || !metrics || !renderer) return rgba;
    const pureAuraCells = collectPureAuraCellSet(renderer, metrics);
    if (pureAuraCells.size === 0) return rgba;

    let next = null;
    for (const idx of pureAuraCells) {
        const alphaOffset = idx * 4 + 3;
        if (alphaOffset >= rgba.length || rgba[alphaOffset] < 128) continue;
        if (rgba[alphaOffset] === AURA_HIGHLIGHT_ALPHA) continue;
        if (!next) next = new Uint8Array(rgba);
        next[alphaOffset] = AURA_HIGHLIGHT_ALPHA;
    }
    return next ?? rgba;
}

function hasAnimated3DAuras() {
    return isDioramaOpen() && getVisibleAuras().length > 0 && isParticlesEnabled();
}

function makeCanvasSurface(width, height, paint) {
    if (typeof globalThis.document?.createElement !== "function") return null;
    const canvasEl = document.createElement("canvas");
    if (!canvasEl) return null;
    canvasEl.width = width;
    canvasEl.height = height;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return null;
    paint(ctx, width, height);
    return canvasEl;
}

function paintGroundRingTexture(ctx, size) {
    const mid = size / 2;
    const outerR = mid * 0.962;
    const innerR = mid * 0.875;

    // 贴近外圈与细内环之间的柔和光晕带，圆心中心完全留白以突显生效格子高亮
    const glow = ctx.createRadialGradient(mid, mid, innerR * 0.92, mid, mid, mid * 0.995);
    glow.addColorStop(0, "rgba(255,255,255,0)");
    glow.addColorStop(0.28, "rgba(255,255,255,0.08)");
    glow.addColorStop(0.72, "rgba(255,255,255,0.22)");
    glow.addColorStop(0.86, "rgba(255,255,255,0.34)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(mid, mid, mid * 0.995, 0, TAU);
    ctx.fill();

    // 细内陪衬光环：与外主环拉开双环层次感
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.arc(mid, mid, innerR, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.68)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(mid, mid, innerR, 0, TAU);
    ctx.stroke();

    // 外主贴地亮环：柔和外光带 + 清晰高亮环芯
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 8.4;
    ctx.beginPath();
    ctx.arc(mid, mid, outerR, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.98)";
    ctx.lineWidth = 3.1;
    ctx.beginPath();
    ctx.arc(mid, mid, outerR, 0, TAU);
    ctx.stroke();
}

function paintQiOrbTexture(ctx, size) {
    const mid = size / 2;
    const rad = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    rad.addColorStop(0, "rgba(255,255,255,1)");
    rad.addColorStop(0.16, "rgba(255,255,255,0.82)");
    rad.addColorStop(0.42, "rgba(255,255,255,0.24)");
    rad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, size, size);
}

function paintQiStreakTexture(ctx, w, h) {
    const midX = w / 2;
    const midY = h / 2;
    const vGrad = ctx.createLinearGradient(0, 0, 0, h);
    vGrad.addColorStop(0, "rgba(255,255,255,0)");
    vGrad.addColorStop(0.24, "rgba(255,255,255,0.68)");
    vGrad.addColorStop(0.5, "rgba(255,255,255,1)");
    vGrad.addColorStop(0.76, "rgba(255,255,255,0.42)");
    vGrad.addColorStop(1, "rgba(255,255,255,0)");

    ctx.fillStyle = vGrad;
    ctx.beginPath();
    ctx.moveTo(midX, 4);
    ctx.quadraticCurveTo(midX + w * 0.22, midY, midX, h - 4);
    ctx.quadraticCurveTo(midX - w * 0.22, midY, midX, 4);
    ctx.fill();

    const rad = ctx.createRadialGradient(midX, midY, 0, midX, midY, w * 0.44);
    rad.addColorStop(0, "rgba(255,255,255,0.45)");
    rad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, w, h);
}

function getAura3DTextures(needAnimated) {
    if (!aura3DTextures.groundRing) {
        aura3DTextures.groundRing = makeCanvasSurface(AURA_TEX_SIZE, AURA_TEX_SIZE, paintGroundRingTexture);
    }
    if (!needAnimated) return aura3DTextures;
    if (!aura3DTextures.qiOrb) {
        aura3DTextures.qiOrb = makeCanvasSurface(64, 64, paintQiOrbTexture);
    }
    if (!aura3DTextures.qiStreak) {
        aura3DTextures.qiStreak = makeCanvasSurface(64, 128, paintQiStreakTexture);
    }
    return aura3DTextures;
}

const AURA_FLAME_VS = `#version 300 es
layout(location=0) in vec3 a_cyl;
uniform mat4 u_vp;
uniform vec3 u_center;
uniform vec3 u_scale;
uniform float u_flare;
uniform float u_time;
uniform float u_seed;
uniform vec4 u_rect;
uniform float u_layer;
out vec3 v_dir;
out vec3 v_world;
out vec3 v_nrm;
out float v_h;
void main() {
  float h = clamp(a_cyl.y, 0.0, 1.0);
  float c = a_cyl.x;
  float s = a_cyl.z;
  vec2 radDir = vec2(c, s);
  if (u_rect.x > 0.5) {
    float ac = abs(c);
    float as = abs(s);
    float lp = pow(ac * ac * ac * ac * ac * ac + as * as * as * as * as * as, 1.0 / 6.0);
    radDir = vec2(c, s) / max(lp, 1e-4);
  }
  float sway = sin(u_time * 1.45 + c * 3.1 - s * 2.4 + h * 4.2 + u_seed)
             * 0.028 * h * pow(max(h, 1e-4), 0.35) * (0.65 + 0.35 * u_layer);
  float flare = 1.0 + u_flare * h * pow(max(h, 1e-4), 0.35) + sway;
  vec3 pos = vec3(
    u_center.x + radDir.x * u_scale.x * flare,
    u_center.y + h * u_scale.y,
    u_center.z + radDir.y * u_scale.z * flare
  );
  v_dir = vec3(c, h, s);
  v_world = pos;
  v_nrm = normalize(vec3(
    radDir.x / max(u_scale.x, 1e-4),
    -u_flare * 0.45 / max(u_scale.y, 1e-4),
    radDir.y / max(u_scale.z, 1e-4)
  ));
  v_h = h;
  gl_Position = u_vp * vec4(pos, 1.0);
}`;

const AURA_FLAME_FS = `#version 300 es
precision highp float;
in vec3 v_dir;
in vec3 v_world;
in vec3 v_nrm;
in float v_h;
uniform vec3 u_camDir;
uniform vec3 u_col;
uniform vec3 u_coreCol;
uniform float u_time;
uniform float u_seed;
uniform float u_alpha;
uniform float u_layer;
uniform sampler2D u_vis;
uniform float u_visOn;
uniform vec2 u_mapSize;
out vec4 o;

float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.52;
  for (int i = 0; i < 4; i++) {
    v += a * noise3(p);
    p = p * 2.04 + vec3(13.7, -7.3, 5.1);
    a *= 0.5;
  }
  return v;
}

void main() {
  float h = clamp(v_h, 0.0, 1.0);
  float c = v_dir.x;
  float s = v_dir.z;

  // 沿环面缓慢盘旋上升（内外层逆向微调以形成丝绸交织层次）
  float swirl = u_time * (u_layer > 0.5 ? 0.18 : -0.14)
              - h * (1.32 + 0.34 * sin(c * 2.0 + s * 2.0 + u_seed));
  float cs = cos(swirl);
  float ss = sin(swirl);
  vec2 pRot = vec2(c * cs - s * ss, c * ss + s * cs);

  float tongueMask = fbm3(vec3(pRot * 2.1, u_time * 0.15 + u_seed));
  float q = fbm3(vec3(pRot * 3.0, h * 1.45 - u_time * 0.46 + u_seed * 1.7));
  vec3 flowPos = vec3(pRot * (3.5 + 1.1 * u_layer), h * 2.35 - u_time * (0.72 + 0.18 * u_layer))
               + vec3(q * 1.65, (tongueMask - 0.5) * 1.25, -q * 1.15);
  float f = fbm3(flowPos);
  float f2 = fbm3(flowPos * 1.85 + vec3(4.2, -3.1, u_time * 0.52));

  // 丝绸状细脉与飘逸真气薄纱
  float ridge = pow(clamp(1.0 - abs(f * 2.0 - 1.0), 1e-4, 1.0), 2.3);
  float fineSilk = pow(clamp(1.0 - abs(f2 * 2.0 - 1.0), 1e-4, 1.0), 3.1);
  float veil = smoothstep(0.24, 0.78, f * 0.68 + q * 0.32);

  vec2 camXZ = length(u_camDir.xz) > 0.01 ? normalize(u_camDir.xz) : vec2(0.0, 1.0);
  vec2 outXZ = length(vec2(c, s)) > 0.01 ? normalize(vec2(c, s)) : vec2(0.0, 1.0);
  float viewDot = dot(outXZ, camXZ);
  float frontDot = clamp(viewDot, 0.0, 1.0);
  float rearDot = clamp(-viewDot, 0.0, 1.0);

  // 前缘适度低伏透明以让出立牌面容与状态标，后缘铭牌处略微避让以成双翼夹抱之势
  float frontFade = smoothstep(0.22, 0.90, frontDot);
  float rearFrame = smoothstep(0.70, 0.98, rearDot);
  float arcEnv = mix(1.0, 0.48, frontFade) * mix(1.0, 0.68, rearFrame);

  float crownReach = clamp(0.30 + tongueMask * 0.78 + q * 0.20, 0.20, 1.0);
  float maxH = mix(0.42, 1.0, crownReach) * arcEnv;
  float topSafe = 1.0 - smoothstep(0.84, 1.0, h);
  float flameMask = smoothstep(maxH + 0.05, maxH - 0.34, h + (1.0 - veil) * 0.24) * topSafe;

  float rg = clamp(1.0 - h / 0.16, 0.0, 1.0);
  float rootGlow = rg * rg;
  float baseEntry = smoothstep(0.0, 0.035, h);

  float ndotv = abs(dot(normalize(v_nrm), normalize(u_camDir)));
  float rimFactor = 0.56 + 0.54 * pow(clamp(1.0 - ndotv, 1e-4, 1.0), 1.35);
  float frontAlphaDamp = mix(1.0, 0.44, frontFade);

  float body = u_layer < 0.5
    ? (veil * 0.34 + ridge * 0.52 + rootGlow * 0.58)
    : (veil * 0.20 + ridge * 0.76 + fineSilk * 0.62 + rootGlow * 0.36);

  float intensity = (body * flameMask + rootGlow * 0.32 * mix(1.0, 0.62, frontFade)) * (0.28 + 0.72 * baseEntry);
  float a = clamp(intensity * rimFactor * frontAlphaDamp * u_alpha, 0.0, 0.94);
  if (u_visOn > 0.5) a *= texture(u_vis, v_world.xz / u_mapSize).r;
  if (a < 0.004) discard;

  float coreMix = clamp(ridge * 0.65 + fineSilk * 0.52 + rootGlow * 0.75, 0.0, 1.0);
  vec3 col = mix(u_col, u_coreCol, coreMix);
  col *= 1.0 + 0.55 * ridge + 0.38 * fineSilk + 0.52 * rootGlow;
  o = vec4(col * a, a);
}`;

function buildFlaredCrownGeometry(lonSegs = CROWN_LON_SEGS, hSegs = CROWN_LAT_SEGS) {
    const cols = lonSegs + 1;
    const rows = hSegs + 1;
    const verts = new Float32Array(cols * rows * 3);
    for (let j = 0; j < rows; j++) {
        const h = j / hSegs;
        for (let i = 0; i < cols; i++) {
            const lon = (i / lonSegs) * TAU;
            const k = (j * cols + i) * 3;
            verts[k] = Math.cos(lon);
            verts[k + 1] = h;
            verts[k + 2] = Math.sin(lon);
        }
    }
    const indices = new Uint16Array(lonSegs * hSegs * 6);
    let ptr = 0;
    for (let j = 0; j < hSegs; j++) {
        for (let i = 0; i < lonSegs; i++) {
            const a = j * cols + i;
            const b = a + 1;
            const c = a + cols;
            const d = c + 1;
            // 外法线 CCW 绕序: (c - a) × (b - a) 严格指向焰冠环体外侧
            indices[ptr++] = a;
            indices[ptr++] = c;
            indices[ptr++] = b;
            indices[ptr++] = b;
            indices[ptr++] = c;
            indices[ptr++] = d;
        }
    }
    return { verts, indices, indexCount: indices.length };
}

function getAuraFlameProgram(gl) {
    if (!gl) return null;
    if (flameGpuByGl.has(gl)) return flameGpuByGl.get(gl);

    const fail = reason => {
        flameGpuByGl.set(gl, null);
        if (!warnedFlameProgramFailure) {
            warnedFlameProgramFailure = true;
            console.warn("XJZL | 2.5D 真气焰冠着色器初始化失败，已降级基础显示：", reason);
        }
        return null;
    };

    if (
        typeof gl.createShader !== "function"
        || typeof gl.createProgram !== "function"
        || typeof gl.createVertexArray !== "function"
        || typeof gl.createBuffer !== "function"
    ) {
        return fail("WebGL2 shader/buffer API unavailable");
    }

    const compileShader = (type, src) => {
        const sh = gl.createShader(type);
        if (!sh) return null;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (typeof gl.getShaderParameter === "function" && !gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            const log = typeof gl.getShaderInfoLog === "function" ? gl.getShaderInfoLog(sh) : "compile error";
            gl.deleteShader?.(sh);
            throw new Error(log || "shader compile failed");
        }
        return sh;
    };

    let vs = null;
    let fs = null;
    let prog = null;
    try {
        vs = compileShader(gl.VERTEX_SHADER, AURA_FLAME_VS);
        fs = compileShader(gl.FRAGMENT_SHADER, AURA_FLAME_FS);
        if (!vs || !fs) {
            gl.deleteShader?.(vs);
            gl.deleteShader?.(fs);
            return fail("failed to allocate shader");
        }
        prog = gl.createProgram();
        if (!prog) {
            gl.deleteShader?.(vs);
            gl.deleteShader?.(fs);
            return fail("failed to allocate program");
        }
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (typeof gl.getProgramParameter === "function" && !gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            const log = typeof gl.getProgramInfoLog === "function" ? gl.getProgramInfoLog(prog) : "link error";
            throw new Error(log || "program link failed");
        }
        gl.deleteShader?.(vs);
        gl.deleteShader?.(fs);

        const geo = buildFlaredCrownGeometry();
        const vao = gl.createVertexArray();
        const vbo = gl.createBuffer();
        const ibo = gl.createBuffer();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, geo.verts, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);
        gl.bindVertexArray(null);

        const record = {
            p: prog,
            vao,
            indexCount: geo.indexCount,
            u: {
                u_vp: gl.getUniformLocation(prog, "u_vp"),
                u_center: gl.getUniformLocation(prog, "u_center"),
                u_scale: gl.getUniformLocation(prog, "u_scale"),
                u_flare: gl.getUniformLocation(prog, "u_flare"),
                u_time: gl.getUniformLocation(prog, "u_time"),
                u_seed: gl.getUniformLocation(prog, "u_seed"),
                u_rect: gl.getUniformLocation(prog, "u_rect"),
                u_camDir: gl.getUniformLocation(prog, "u_camDir"),
                u_col: gl.getUniformLocation(prog, "u_col"),
                u_coreCol: gl.getUniformLocation(prog, "u_coreCol"),
                u_alpha: gl.getUniformLocation(prog, "u_alpha"),
                u_layer: gl.getUniformLocation(prog, "u_layer"),
                u_vis: gl.getUniformLocation(prog, "u_vis"),
                u_visOn: gl.getUniformLocation(prog, "u_visOn"),
                u_mapSize: gl.getUniformLocation(prog, "u_mapSize")
            }
        };
        flameGpuByGl.set(gl, record);
        return record;
    } catch (err) {
        gl.deleteShader?.(vs);
        gl.deleteShader?.(fs);
        gl.deleteProgram?.(prog);
        return fail(err);
    }
}

function hashString(str) {
    let h = 2166136261;
    const text = String(str ?? "");
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 1000) / 1000;
}

function safeGroundAt(renderer, x, z) {
    try {
        return typeof renderer?.groundAt === "function" ? Number(renderer.groundAt(x, z, 1)) || 0 : 0;
    } catch {
        return 0;
    }
}

function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / Math.max(1e-5, edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

function ensureAuraRisingEmbers(aura, cellData, rx, rz, isCircle, seed) {
    const sig = cellData ? cellData.sig : `${isCircle}:${rx.toFixed(2)}x${rz.toFixed(2)}`;
    const existing = aura3DParticleStates.get(aura.id);
    if (existing && existing.sig === sig) return existing;

    const span = Math.max(rx, rz);
    const count = clamp(Math.round(16 + span * 2.5), 16, 24);
    const coords = cellData?.cellCoords ?? [];
    const items = Array.from({ length: count }, (_, idx) => {
        const onPerimeter = idx % 5 !== 4 || coords.length === 0;
        const cell = coords.length ? coords[idx % coords.length] : null;
        return {
            onPerimeter,
            isStreak: idx % 3 === 0,
            lon0: (idx / count) * TAU + seed * TAU,
            omega: (0.14 + ((idx * 31) % 7) * 0.025) * (idx % 2 === 0 ? 1 : -1),
            rJitter: 0.96 + ((idx * 19) % 7) * 0.014,
            cellX: cell ? cell[0] + 0.2 + ((idx * 23) % 10) * 0.06 : 0,
            cellZ: cell ? cell[1] + 0.2 + ((idx * 41) % 10) * 0.06 : 0,
            period: 2.3 + ((idx * 17) % 9) * 0.24,
            phase: ((idx * 0.381966 + seed) % 1),
            alpha: 0.56 + ((idx * 29) % 5) * 0.09,
            size: 0.06 + ((idx * 11) % 6) * 0.01,
            streakLen: 0.14 + ((idx * 13) % 5) * 0.02
        };
    });

    const state = { sig, items };
    aura3DParticleStates.set(aura.id, state);
    return state;
}

function resolveAura3DGeometry(aura, renderer, metrics) {
    const cellData = getAuraCoveredCells(aura, renderer, metrics);
    if (aura.visual.shapeKind === "circle" && aura.visual.rPx > 0) {
        const cx = (aura.center.x - metrics.ox) / metrics.size;
        const cz = (aura.center.y - metrics.oy) / metrics.size;
        const R = Math.max(0.5, aura.visual.rPx / metrics.size);
        return {
            isCircle: true,
            cx,
            cz,
            rx: R,
            rz: R,
            R,
            baseY: safeGroundAt(renderer, cx, cz),
            cellData
        };
    }
    if (!cellData) return null;
    const x0 = cellData.c0;
    const x1 = cellData.c1 + 1;
    const z0 = cellData.r0;
    const z1 = cellData.r1 + 1;
    const cx = (x0 + x1) * 0.5;
    const cz = (z0 + z1) * 0.5;
    const rx = Math.max(0.5, (x1 - x0) * 0.5);
    const rz = Math.max(0.5, (z1 - z0) * 0.5);
    return {
        isCircle: false,
        cx,
        cz,
        rx,
        rz,
        R: Math.max(rx, rz),
        rect: [x0, z0, x1, z1],
        baseY: safeGroundAt(renderer, cx, cz),
        cellData
    };
}

function drawFxQuad(gl, F, tex, p0, ax, ay, uv, tint, alpha) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform3fv(F.u.u_p0, p0);
    gl.uniform3fv(F.u.u_ax, ax);
    gl.uniform3fv(F.u.u_ay, ay);
    gl.uniform4f(F.u.u_uv, uv[0], uv[1], uv[2], uv[3]);
    gl.uniform4f(F.u.u_tint, tint[0], tint[1], tint[2], alpha);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function drawGroundAuraLayer(ctx3d, geom, colRgb, fxEnabled) {
    if (!geom.isCircle) return;
    const { gl, F, renderer, textures, visActive, setBlend } = ctx3d;
    const ringRec = textures.groundRing ? renderer._fxTexFor(textures.groundRing, false) : null;
    if (!ringRec?.tex) return;

    const { cx, cz, R, baseY } = geom;
    const visK = !visActive || typeof renderer.visAt !== "function"
        ? 1
        : smoothstep(0.15, 0.6, Number(renderer.visAt(cx, cz)) || 0);
    if (visK <= 0.02) return;

    setBlend(false);
    drawFxQuad(
        gl,
        F,
        ringRec.tex,
        [cx - R, baseY + 0.035, cz - R],
        [2 * R, 0, 0],
        [0, 0, 2 * R],
        [0, 0, 1, 1],
        colRgb,
        (fxEnabled ? 0.92 : 0.82) * visK
    );
}

function drawGroundAuraDecals(ctx3d, auras, geoms, cam, fxEnabled) {
    const { gl, renderer, textures, visActive, setBlend } = ctx3d;
    const Dc = renderer?.pDecal;
    const terrain = renderer?.terrain;
    if (!Dc?.p || !Dc?.u || !terrain?.vao || !(terrain.count > 0) || typeof renderer._setCutUniforms !== "function") {
        return false;
    }
    if (!geoms.some(g => g?.isCircle)) return true;
    const ringRec = textures.groundRing ? renderer._fxTexFor(textures.groundRing, false) : null;
    if (!ringRec?.tex) return true;

    const canSampleVis = Boolean(visActive && renderer.visTex);
    gl.useProgram(Dc.p);
    gl.uniformMatrix4fv(Dc.u.u_vp, false, cam.vp);
    if (Dc.u.u_lightVP) gl.uniformMatrix4fv(Dc.u.u_lightVP, false, renderer._lastLight?.vp ?? cam.vp);
    renderer._setCutUniforms(Dc, false);
    gl.enable?.(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset?.(-1, -2);
    gl.bindVertexArray(terrain.vao);
    gl.activeTexture?.(gl.TEXTURE6);
    if (canSampleVis) gl.bindTexture(gl.TEXTURE_2D, renderer.visTex);
    gl.uniform1i(Dc.u.u_vis, 6);
    gl.uniform1f(Dc.u.u_visOn, canSampleVis ? 1 : 0);
    gl.uniform2f(Dc.u.u_mapSize, Number(renderer.cols) || 1, Number(renderer.rows) || 1);
    gl.activeTexture?.(gl.TEXTURE0);
    gl.uniform1i(Dc.u.u_fx, 0);

    try {
        setBlend(false);
        gl.bindTexture(gl.TEXTURE_2D, ringRec.tex);
        for (let i = 0; i < auras.length; i++) {
            const aura = auras[i];
            const geom = geoms[i];
            if (!geom?.isCircle) continue;
            const colRgb = intToRgb01(mixColor(aura.visual.tint, 0xFFFDF5, 0.28));
            const invSpan = 1 / Math.max(1e-4, 2 * geom.R);
            gl.uniform2f(Dc.u.u_dp0, geom.cx - geom.R, geom.cz - geom.R);
            gl.uniformMatrix2fv(Dc.u.u_dinv, false, new Float32Array([invSpan, 0, 0, invSpan]));
            gl.uniform4f(Dc.u.u_duv, 0, 0, 1, 1);
            gl.uniform4f(Dc.u.u_tint, colRgb[0], colRgb[1], colRgb[2], fxEnabled ? 0.92 : 0.82);
            gl.drawElements(gl.TRIANGLES, terrain.count, gl.UNSIGNED_INT, 0);
        }
    } finally {
        gl.disable?.(gl.POLYGON_OFFSET_FILL);
        gl.bindVertexArray?.(null);
    }
    return true;
}

function drawAuraFlameCrown(ctx3d, auras, geoms, cam, sec) {
    const { gl, renderer, visActive, setBlend } = ctx3d;
    const flameGpu = getAuraFlameProgram(gl);
    if (!flameGpu) return;

    const back = cam.back ?? [0, 0.5, 0.86];
    const bLen = Math.hypot(back[0], back[1], back[2]) || 1;
    const camDirX = back[0] / bLen;
    const camDirY = back[1] / bLen;
    const camDirZ = back[2] / bLen;

    const canSampleVis = Boolean(visActive && renderer.visTex);
    gl.useProgram(flameGpu.p);
    gl.uniformMatrix4fv(flameGpu.u.u_vp, false, cam.vp);
    gl.uniform3f(flameGpu.u.u_camDir, camDirX, camDirY, camDirZ);
    gl.uniform1f(flameGpu.u.u_visOn, canSampleVis ? 1 : 0);
    gl.uniform2f(flameGpu.u.u_mapSize, Number(renderer.cols) || 1, Number(renderer.rows) || 1);
    if (canSampleVis) {
        gl.activeTexture?.(gl.TEXTURE6);
        gl.bindTexture(gl.TEXTURE_2D, renderer.visTex);
        gl.uniform1i(flameGpu.u.u_vis, 6);
    }

    setBlend(false);
    gl.bindVertexArray(flameGpu.vao);
    gl.enable?.(gl.CULL_FACE);

    const layers = [
        { layer: 0, rMul: 0.99, hMul: 0.68, flare: 0.04, backAlpha: 0.42, frontAlpha: 0.88 },
        { layer: 1, rMul: 1.01, hMul: 1.0, flare: 0.16, backAlpha: 0.46, frontAlpha: 0.92 }
    ];

    try {
        for (let i = 0; i < auras.length; i++) {
            const aura = auras[i];
            const geom = geoms[i];
            if (!geom) continue;
            const H = clamp(1.35 + geom.R * 0.22, 1.55, 2.35);
            const colRgb = intToRgb01(mixColor(aura.visual.tint, 0xFFFFFF, 0.08));
            const coreRgb = intToRgb01(mixColor(aura.visual.tint, 0xFFF7E0, 0.72));
            const seed = hashString(aura.id) * 6.283;

            gl.uniform3f(flameGpu.u.u_center, geom.cx, geom.baseY + 0.02, geom.cz);
            gl.uniform3f(flameGpu.u.u_col, colRgb[0], colRgb[1], colRgb[2]);
            gl.uniform3f(flameGpu.u.u_coreCol, coreRgb[0], coreRgb[1], coreRgb[2]);
            gl.uniform1f(flameGpu.u.u_time, sec);
            gl.uniform1f(flameGpu.u.u_seed, seed);
            gl.uniform4f(flameGpu.u.u_rect, geom.isCircle ? 0 : 1, geom.rx, geom.rz, 0);

            for (const cfg of layers) {
                gl.uniform3f(flameGpu.u.u_scale, geom.rx * cfg.rMul, H * cfg.hMul, geom.rz * cfg.rMul);
                gl.uniform1f(flameGpu.u.u_flare, cfg.flare);
                gl.uniform1f(flameGpu.u.u_layer, cfg.layer);

                // Pass 1：内背焰壁（位于立牌后方）
                gl.cullFace?.(gl.FRONT);
                gl.uniform1f(flameGpu.u.u_alpha, cfg.backAlpha);
                gl.drawElements(gl.TRIANGLES, flameGpu.indexCount, gl.UNSIGNED_SHORT, 0);

                // Pass 2：外前焰壁（正对前缘处由 Shader 自动低伏半透以突出立牌与状态）
                gl.cullFace?.(gl.BACK);
                gl.uniform1f(flameGpu.u.u_alpha, cfg.frontAlpha);
                gl.drawElements(gl.TRIANGLES, flameGpu.indexCount, gl.UNSIGNED_SHORT, 0);
            }
        }
    } finally {
        gl.disable?.(gl.CULL_FACE);
        gl.cullFace?.(gl.BACK);
        gl.activeTexture?.(gl.TEXTURE0);
    }
}

function drawAuraRisingEmbersLayer(ctx3d, aura, geom, coreRgb, H, sec, seed) {
    const { gl, F, renderer, textures, camRight, camBack, visActive, setBlend } = ctx3d;
    const orbRec = textures.qiOrb ? renderer._fxTexFor(textures.qiOrb, false) : null;
    const streakRec = textures.qiStreak ? renderer._fxTexFor(textures.qiStreak, false) : null;
    if (!orbRec?.tex && !streakRec?.tex) return;

    const state = ensureAuraRisingEmbers(aura, geom.cellData, geom.rx, geom.rz, geom.isCircle, seed);
    const rxCam = camRight[0];
    const rzCam = camRight[2];
    const rn = Math.hypot(rxCam, rzCam) || 1;
    const rightX = rxCam / rn;
    const rightZ = rzCam / rn;

    const cLen = Math.hypot(camBack[0], camBack[2]) || 1;
    const camDirX = camBack[0] / cLen;
    const camDirZ = camBack[2] / cLen;

    setBlend(true);
    for (const p of state.items) {
        const t = ((sec / p.period + p.phase) % 1 + 1) % 1;
        const lifeAlpha = Math.sin(t * Math.PI) * p.alpha;
        if (lifeAlpha <= 0.01) continue;

        let wx = 0;
        let wy = 0;
        let wz = 0;
        let dirX = 0;
        let dirY = 1;
        let dirZ = 0;
        let frontFade = 0;

        if (p.onPerimeter) {
            const lon = p.lon0 + sec * p.omega + t * 0.42;
            const cosLon = Math.cos(lon);
            const sinLon = Math.sin(lon);
            let radX = cosLon;
            let radZ = sinLon;
            if (!geom.isCircle) {
                const lp = Math.pow(Math.pow(Math.abs(cosLon), 6) + Math.pow(Math.abs(sinLon), 6), 1 / 6) || 1;
                radX = cosLon / lp;
                radZ = sinLon / lp;
            }
            const viewDot = cosLon * camDirX + sinLon * camDirZ;
            frontFade = smoothstep(0.22, 0.9, Math.max(0, viewDot));
            const maxRise = H * (1.08 - 0.5 * frontFade);
            const riseY = 0.08 + 0.06 * (1 - frontFade) + Math.pow(t, 0.88) * maxRise;
            const flareK = p.rJitter * (1.0 + 0.16 * Math.pow(t, 1.35));

            wx = geom.cx + geom.rx * radX * flareK;
            wy = geom.baseY + riseY;
            wz = geom.cz + geom.rz * radZ * flareK;

            const dFlare = (p.rJitter * 0.216 * Math.pow(Math.max(t, 0.04), 0.35)) / p.period;
            const dLon = p.omega + 0.42 / p.period;
            dirX = geom.rx * (dFlare * radX - flareK * sinLon * dLon);
            dirY = (0.88 * maxRise) / (Math.pow(Math.max(t, 0.08), 0.12) * p.period);
            dirZ = geom.rz * (dFlare * radZ + flareK * cosLon * dLon);
        } else {
            wx = p.cellX + Math.sin(sec * 0.85 + p.phase * TAU) * 0.07;
            wz = p.cellZ + Math.cos(sec * 0.78 + p.phase * TAU) * 0.07;
            wy = safeGroundAt(renderer, wx, wz) + 0.08 + t * (H * 0.52);
        }

        const visK = !visActive || typeof renderer.visAt !== "function"
            ? 1
            : smoothstep(0.15, 0.6, Number(renderer.visAt(wx, wz)) || 0);
        const finalA = lifeAlpha * (1 - 0.35 * frontFade) * visK;
        if (finalA <= 0.01) continue;

        if (p.isStreak && streakRec?.tex) {
            const vLen = Math.hypot(dirX, dirY, dirZ) || 1;
            const uyX = dirX / vLen;
            const uyY = dirY / vLen;
            const uyZ = dirZ / vLen;
            let sx = uyY * camBack[2] - uyZ * camBack[1];
            let sy = uyZ * camBack[0] - uyX * camBack[2];
            let sz = uyX * camBack[1] - uyY * camBack[0];
            const sLen = Math.hypot(sx, sy, sz);
            if (sLen > 1e-4) {
                sx /= sLen; sy /= sLen; sz /= sLen;
            } else {
                sx = rightX; sy = 0; sz = rightZ;
            }
            const sw = p.size * 0.82;
            const sh = p.streakLen * (0.75 + 0.35 * Math.sin(t * Math.PI));
            drawFxQuad(
                gl,
                F,
                streakRec.tex,
                [wx - sx * sw * 0.5 - uyX * sh * 0.5, wy - sy * sw * 0.5 - uyY * sh * 0.5, wz - sz * sw * 0.5 - uyZ * sh * 0.5],
                [sx * sw, sy * sw, sz * sw],
                [uyX * sh, uyY * sh, uyZ * sh],
                [0, 1, 1, 0],
                coreRgb,
                finalA
            );
            continue;
        }

        const rec = orbRec ?? streakRec;
        if (!rec?.tex) continue;
        const s = p.size * (0.75 + 0.45 * Math.sin(t * Math.PI));
        drawFxQuad(
            gl,
            F,
            rec.tex,
            [wx - rightX * s * 0.5, wy, wz - rightZ * s * 0.5],
            [rightX * s, 0, rightZ * s],
            [0, s, 0],
            [0, 1, 1, 0],
            coreRgb,
            finalA
        );
    }
}

function drawDiorama3DAuras(renderer, cam) {
    const gl = renderer?.gl;
    const F = renderer?.pFx;
    const metrics = getGridMetrics();
    if (!gl || !F?.p || !F?.u || !renderer.quadVao || !metrics || typeof renderer._fxTexFor !== "function") return;

    const auras = getVisibleAuras();
    const liveIds = new Set(auras.map(a => a.id));
    for (const key of auraCellCache.keys()) {
        if (!liveIds.has(key)) auraCellCache.delete(key);
    }
    for (const key of aura3DParticleStates.keys()) {
        if (!liveIds.has(key)) aura3DParticleStates.delete(key);
    }
    if (auras.length === 0) return;

    const fxEnabled = isParticlesEnabled();
    const topDown = Number(renderer.cam?.pitch ?? 34) >= 80;
    const now = performance.now();
    const sec = Number.isFinite(renderer.time) ? Number(renderer.time) : now / 1000;
    const textures = getAura3DTextures(fxEnabled && !topDown);
    if (!textures.groundRing) return;

    const back = cam.back ?? [0, 0.5, 0.86];
    const bLen = Math.hypot(back[0], back[2]) || 1;
    const backH = [back[0] / bLen, 0, back[2] / bLen];
    const camRight = cam.right ?? [1, 0, 0];
    const visActive = Boolean(renderer._visActive?.());

    const geoms = auras.map(aura => resolveAura3DGeometry(aura, renderer, metrics));

    const prevBlend = typeof gl.isEnabled === "function" ? Boolean(gl.isEnabled(gl.BLEND)) : false;
    const setBlend = additive => {
        if (typeof renderer._fxBlend === "function") {
            renderer._fxBlend(additive);
            return;
        }
        gl.enable?.(gl.BLEND);
        if (additive) gl.blendFuncSeparate?.(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        else gl.blendFuncSeparate?.(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    };

    const ctx3d = { gl, F, renderer, textures, backH, camRight, camBack: back, visActive, setBlend };

    gl.enable?.(gl.DEPTH_TEST);
    gl.depthFunc?.(gl.LEQUAL);
    gl.depthMask?.(false);
    gl.enable?.(gl.BLEND);

    try {
        // 1. 贴地明锐双光环底座：优先走上游带视野遮罩与高台贴合的 pDecal 路径，无 pDecal 时按 visAt 降级回退
        if (!drawGroundAuraDecals(ctx3d, auras, geoms, cam, fxEnabled)) {
            gl.useProgram(F.p);
            gl.uniformMatrix4fv(F.u.u_vp, false, cam.vp);
            gl.bindVertexArray(renderer.quadVao);
            gl.activeTexture?.(gl.TEXTURE0);
            gl.uniform1i(F.u.u_fx, 0);

            for (let i = 0; i < auras.length; i++) {
                const aura = auras[i];
                const geom = geoms[i];
                if (!geom) continue;
                const colRgb = intToRgb01(mixColor(aura.visual.tint, 0xFFFDF5, 0.28));
                drawGroundAuraLayer(ctx3d, geom, colRgb, fxEnabled);
            }
        }

        if (!fxEnabled || topDown) return;

        // 2. 3D 升腾真气焰冠（内外双层 × FRONT/BACK 四 Pass）
        drawAuraFlameCrown(ctx3d, auras, geoms, cam, sec);

        // 3. 沿焰舌外周上浮飘散的细腻余烬光点
        gl.useProgram(F.p);
        gl.uniformMatrix4fv(F.u.u_vp, false, cam.vp);
        gl.bindVertexArray(renderer.quadVao);
        gl.activeTexture?.(gl.TEXTURE0);
        gl.uniform1i(F.u.u_fx, 0);

        for (let i = 0; i < auras.length; i++) {
            const aura = auras[i];
            const geom = geoms[i];
            if (!geom) continue;
            const seed = hashString(aura.id);
            const H = clamp(1.35 + geom.R * 0.22, 1.55, 2.35);
            const coreRgb = intToRgb01(mixColor(aura.visual.tint, 0xFFF8E6, 0.68));
            drawAuraRisingEmbersLayer(ctx3d, aura, geom, coreRgb, H, sec, seed);
        }
    } finally {
        gl.disable?.(gl.POLYGON_OFFSET_FILL);
        gl.disable?.(gl.CULL_FACE);
        gl.cullFace?.(gl.BACK);
        gl.bindVertexArray?.(null);
        gl.depthFunc?.(gl.LESS);
        gl.depthMask?.(true);
        gl.activeTexture?.(gl.TEXTURE0);
        if (!prevBlend) gl.disable?.(gl.BLEND);
    }
}

/** 计算光环名称在 2.5D 视图中的屏幕投影点；处于战争迷雾不可见区域时返回 null。 */
export function resolveAuraLabelScreenPos(aura, renderer, metrics, fxEnabled) {
    if (!renderer?.project) return null;
    const geom = resolveAura3DGeometry(aura, renderer, metrics);
    if (!geom) return null;

    const topDown = Number(renderer.cam?.pitch ?? 34) >= 80;
    const liftY = fxEnabled && !topDown ? 0.42 : 0.28;

    const back = renderer._lastCam?.back ?? [0, 0.5, 0.86];
    const bLen = Math.hypot(back[0], back[2]) || 1;
    const upX = -back[0] / bLen;
    const upZ = -back[2] / bLen;
    const offsetR = geom.isCircle ? geom.R * 0.82 : Math.max(0.35, geom.R * 0.72);

    const lx = geom.cx + upX * offsetR;
    const lz = geom.cz + upZ * offsetR;

    let alpha = 1;
    if (renderer._visActive?.() && typeof renderer.visAt === "function") {
        const vis = Number(renderer.visAt(lx, lz)) || 0;
        alpha = smoothstep(0.15, 0.6, vis);
        if (alpha <= 0.02) return null;
    }

    try {
        const p = renderer.project([lx, geom.baseY + liftY, lz]);
        return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { ...p, alpha } : null;
    } catch {
        return null;
    }
}

function drawAuraLabelAt(ctx, screenPos, name, tintNum, dpr) {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (Number.isFinite(screenPos.alpha)) ctx.globalAlpha *= clamp(screenPos.alpha, 0, 1);
    ctx.font = 'bold 17px "STKaiti", "KaiTi", "FangSong", "Songti SC", "SimSun", serif';
    const textWidth = Number(ctx.measureText?.(name)?.width) || name.length * 17;
    const cx = screenPos.x;
    const cy = screenPos.y - 6;
    const bannerW = Math.max(66, textWidth + 44);
    const bannerH = 26;
    const x0 = cx - bannerW * 0.5;
    const y0 = cy - bannerH * 0.5;

    // 1. 横向左右渐隐水墨底痕，消除现代弹窗铭牌感
    const inkGrad = ctx.createLinearGradient(x0, cy, x0 + bannerW, cy);
    inkGrad.addColorStop(0, "rgba(10,16,20,0)");
    inkGrad.addColorStop(0.24, "rgba(10,16,20,0.62)");
    inkGrad.addColorStop(0.5, "rgba(10,16,20,0.72)");
    inkGrad.addColorStop(0.76, "rgba(10,16,20,0.62)");
    inkGrad.addColorStop(1, "rgba(10,16,20,0)");
    ctx.fillStyle = inkGrad;
    ctx.fillRect(x0, y0, bannerW, bannerH);

    // 2. 上下极纤细的光环本色气韵丝线
    const trim = mixColor(tintNum, 0xFFF7E2, 0.45);
    const r = (trim >> 16) & 255;
    const g = (trim >> 8) & 255;
    const b = trim & 255;
    const lineGrad = ctx.createLinearGradient(x0, cy, x0 + bannerW, cy);
    lineGrad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    lineGrad.addColorStop(0.5, `rgba(${r},${g},${b},0.65)`);
    lineGrad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = lineGrad;
    ctx.fillRect(x0 + 6, y0 + 1, bannerW - 12, 1.2);
    ctx.fillRect(x0 + 6, y0 + bannerH - 2.2, bannerW - 12, 1.2);

    // 3. 宣纸暖白墨边楷体名称
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = "rgba(6,10,14,0.92)";
    ctx.strokeText(name, cx, cy);
    ctx.fillStyle = "#FFF9EB";
    ctx.fillText(name, cx, cy);
    ctx.restore();
}

function renderAuras25DOverlay(ctx, renderer, metrics, auras, _dt, dpr) {
    const fxEnabled = isParticlesEnabled();
    for (const aura of auras) {
        if (!aura.name) continue;
        const labelPos = resolveAuraLabelScreenPos(aura, renderer, metrics, fxEnabled);
        if (labelPos) drawAuraLabelAt(ctx, labelPos, aura.name, aura.visual.tint, dpr);
    }
}

function sampleFadeAlpha(elapsed, lifetime, fadeIn, fadeOut) {
    const t = clamp(elapsed / lifetime, 0, 1);
    const aIn = fadeIn > 0 ? clamp(t / fadeIn, 0, 1) : 1;
    const aOut = fadeOut > 0 ? clamp((1 - t) / fadeOut, 0, 1) : 1;
    return Math.min(aIn, aOut);
}

function sampleCurve(t, keyframes) {
    if (t <= keyframes[0].time) return keyframes[0].value;
    for (let i = 1; i < keyframes.length; i++) {
        if (t <= keyframes[i].time) {
            const a = keyframes[i - 1];
            const b = keyframes[i];
            const q = (t - a.time) / Math.max(1e-5, b.time - a.time);
            return a.value + (b.value - a.value) * q;
        }
    }
    return keyframes[keyframes.length - 1].value;
}

/* -------------------------------------------- */
/*  #7 固定光环选点 2.5D 预览                      */
/* -------------------------------------------- */

/** 设置或清除 2.5D 视角下的固定光环选点预览圆。 */
export function setDioramaPlacementPreview(preview) {
    if (!preview || !isDioramaOpen()) {
        placementPreview = null;
        syncOverlayLoop();
        return;
    }
    placementPreview = {
        x: Number(preview.x) || 0,
        y: Number(preview.y) || 0,
        radiusPx: Math.max(4, Number(preview.radiusPx) || 4),
        color: normalizeCssColor(preview.color, "#40d0c0")
    };
    syncOverlayLoop();
}

function renderPlacementPreview25D(ctx, renderer, metrics, dpr) {
    if (!placementPreview) return;
    const { x, y, radiusPx, color } = placementPreview;
    const proj = projectGroundCircle(renderer, x, y, radiusPx, metrics);
    if (!proj) return;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.transform(proj.ux, proj.uy, proj.vx, proj.vy, proj.pO.x, proj.pO.y);

    ctx.globalAlpha = 0.18;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, radiusPx, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(proj.pO.x - 8, proj.pO.y);
    ctx.lineTo(proj.pO.x + 8, proj.pO.y);
    ctx.moveTo(proj.pO.x, proj.pO.y - 8);
    ctx.lineTo(proj.pO.x, proj.pO.y + 8);
    ctx.stroke();
    ctx.restore();
}

/* -------------------------------------------- */
/*  #3 受击特效 2.5D 立牌动画 + 3D 竖立刀光/火花   */
/* -------------------------------------------- */

function acquireHitCanvas() {
    if (typeof globalThis.document?.createElement !== "function") return null;
    while (hitCanvasPool.length > 0) {
        const entry = hitCanvasPool.pop();
        if (entry?.canvas && entry?.ctx) {
            entry.ctx.setTransform(1, 0, 0, 1, 0, 0);
            entry.ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
            return entry;
        }
    }
    const canvasEl = document.createElement("canvas");
    canvasEl.width = HIT_TEX_SIZE;
    canvasEl.height = HIT_TEX_SIZE;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return null;
    return { canvas: canvasEl, ctx };
}

function releaseHitCanvas(fx) {
    if (!fx?.canvasEntry) return;
    const entry = fx.canvasEntry;
    fx.canvasEntry = null;
    if (hitCanvasPool.length < MAX_HIT_CANVAS_POOL) {
        entry.ctx.setTransform(1, 0, 0, 1, 0, 0);
        entry.ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
        hitCanvasPool.push(entry);
    }
}

/**
 * 在 2.5D 视角下播放受击反馈：
 * - 驱动 WebGL 立牌本体沿攻击反向击退、挤压拉伸、纸牌倾倒与像素精准闪光（底环保持静止）；
 * - 非光敏模式下同步在立牌 3D 胸口处注入 `mode: "upright"` 竖立斩痕/火星/暴击锋芒并投射地形瞬间反光。
 * @param {object} spec - combat-fx-manager 传入的受击参数与离屏笔触画布
 * @returns {boolean} 是否在 2.5D 模式下已接管播放
 */
export function playDioramaHitEffect(spec) {
    if (!isDioramaOpen() || !spec?.token) return false;
    const token = spec.token;
    const tokenId = String(token.document?.id ?? token.id ?? "");
    if (!tokenId) return false;

    const {
        attackerToken = null,
        kind = "impact",
        color = 0xCC5147,
        criticalColor = 0xEBC387,
        accentColor = 0xF4DDB7,
        scale = 1,
        critical = false,
        source = "extra",
        style = "slash",
        attackAngle = -0.18,
        photosafe = false,
        surfaces = {}
    } = spec;

    const gentle = source === "dot";
    const sharp = style === "slash" || style === "bleed";
    const tint = critical ? criticalColor : accentColor;
    const duration = photosafe ? 700 : critical ? 780 : kind === "shield" ? 660 : 600;
    const flashColor = critical
        ? mixColor(criticalColor, 0xFFF4D6, 0.38)
        : mixColor(color, 0xFFFFFF, kind === "shield" ? 0.16 : 0.12);

    // 1. 计算真实击退世界方向（从攻击者指向受击者）
    let dirX = Math.cos(attackAngle);
    let dirZ = Math.sin(attackAngle);
    let hasWorldDir = false;
    if (attackerToken && attackerToken !== token && token.center && attackerToken.center) {
        const vx = Number(token.center.x) - Number(attackerToken.center.x);
        const vz = Number(token.center.y) - Number(attackerToken.center.y);
        const len = Math.hypot(vx, vz);
        if (len > 1e-4) {
            dirX = vx / len;
            dirZ = vz / len;
            hasWorldDir = true;
        }
    }

    // 2. 启动 3D 立牌本体反应（光敏模式保留低强度染色脉动，不移动摇晃）
    const now = performance.now();
    const scaleClamp = clamp(Number(scale) || 1, 0.72, 1.5);
    const reactionDur = photosafe ? 720 : gentle ? 320 : critical ? 560 : kind === "shield" ? 380 : 440;
    activeStandeeReactions.set(tokenId, {
        token,
        startedAt: now,
        duration: reactionDur,
        dirX,
        dirZ,
        hasWorldDir,
        ampCells: photosafe ? 0 : (gentle ? 0.065 : critical ? 0.28 : kind === "shield" ? 0.12 : 0.19) * scaleClamp,
        popCells: photosafe ? 0 : (gentle ? 0.015 : critical ? 0.11 : kind === "shield" ? 0.03 : 0.06) * scaleClamp,
        squashAmt: photosafe ? 0 : (gentle ? 0.04 : critical ? 0.15 : kind === "shield" ? 0.06 : 0.105),
        tiltAmt: photosafe ? 0 : (gentle ? 0.04 : critical ? 0.16 : kind === "shield" ? 0.06 : 0.11),
        flashRgb: intToRgb01(flashColor),
        critical,
        gentle,
        photosafe
    });

    const view = getDioramaView();
    if (view) view._wakeAt = now;

    // 3. 光敏模式不创建刺眼刀光闪烁，仅立牌轻柔呼吸变色
    if (photosafe) return true;

    const canvasEntry = acquireHitCanvas();
    if (!canvasEntry) return true;

    if (activeHitEffects.length >= MAX_ACTIVE_HIT_FX) {
        releaseHitCanvas(activeHitEffects.shift());
    }

    const rings = [];
    const sparks = [];
    const stars = [];

    const ringCount = critical ? 2 : 1;
    for (let i = 0; i < ringCount; i++) {
        rings.push({
            delay: i * 45,
            lifetime: (critical ? 620 : kind === "shield" ? 520 : 460) + Math.random() * 60,
            scale: critical ? 0.8 + Math.random() * 0.12 : kind === "shield" ? 0.7 + Math.random() * 0.1 : 0.65 + Math.random() * 0.1,
            angle: sharp
                ? (i === 1 ? -attackAngle : attackAngle) + (Math.random() - 0.5) * (Math.PI / 10)
                : Math.random() * TAU,
            spin: sharp ? (Math.random() - 0.5) * 0.2 : (kind === "shield" ? (Math.random() - 0.5) * 0.6 : 0.4 + Math.random() * 0.3)
        });
    }

    const sparkCount = gentle ? 6 : critical ? 22 : kind === "shield" ? 11 : 14;
    for (let i = 0; i < sparkCount; i++) {
        const angle = sharp
            ? attackAngle + (Math.random() - 0.5) * ((Math.PI * 2) / 3)
            : Math.random() * TAU;
        const speedMin = gentle ? 70 : critical ? 185 : 135;
        const speedMax = gentle ? 115 : critical ? 290 : 215;
        sparks.push({
            useMote: Math.random() < 0.35,
            lifetime: (gentle ? 260 : critical ? 380 : 320) + Math.random() * (gentle ? 120 : critical ? 240 : 200),
            angle,
            speed: speedMin + Math.random() * (speedMax - speedMin),
            radius0: Math.random() * (critical ? 8 : 5),
            scale: 0.24 + Math.random() * ((critical ? 0.46 : 0.36) - 0.24),
            alpha: 0.74 + Math.random() * 0.26
        });
    }

    if (critical) {
        for (let i = 0; i < 2; i++) {
            stars.push({
                delay: i * 35,
                lifetime: 240 + Math.random() * 160,
                offsetX: (Math.random() - 0.5) * 16,
                offsetY: (Math.random() - 0.5) * 16,
                angle: attackAngle + (Math.random() - 0.5) * (Math.PI / 8),
                scale: 1.25 + Math.random() * 0.35
            });
        }
    }

    activeHitEffects.push({
        effectId: `xjzl-hit-${++hitEffectSeq}`,
        token,
        tokenId,
        canvasEntry,
        startedAt: now,
        duration,
        kind,
        sharp,
        gentle,
        critical,
        scale: scaleClamp,
        tint,
        flashColor,
        criticalColor,
        style,
        attackAngle,
        surfaces,
        rings,
        sparks,
        stars
    });
    return true;
}

/** 立即停止并清理 2.5D 视图中的全部立牌受击动作与 3D 斩痕特效。 */
export function stopDioramaHitEffects() {
    activeStandeeReactions.clear();
    for (const fx of activeHitEffects) releaseHitCanvas(fx);
    activeHitEffects.length = 0;
}

const RING_CURVE_SHARP = [{ time: 0, value: 0.42 }, { time: 0.1, value: 1.08 }, { time: 0.3, value: 1 }, { time: 1, value: 0.94 }];
const RING_CURVE_SHIELD = [{ time: 0, value: 0.8 }, { time: 0.14, value: 1.05 }, { time: 0.42, value: 0.92 }, { time: 1, value: 1.08 }];
const RING_CURVE_INNER = [{ time: 0, value: 0.52 }, { time: 0.18, value: 0.96 }, { time: 1, value: 1.15 }];
const SPARK_SCALE_CURVE = [{ time: 0, value: 0.62 }, { time: 0.14, value: 1 }, { time: 0.72, value: 0.54 }, { time: 1, value: 0.18 }];

function paintHitEffectToCanvas(fx, elapsed) {
    const entry = fx.canvasEntry;
    if (!entry) return null;
    const { canvas, ctx } = entry;
    const size = HIT_TEX_SIZE;
    const mid = size / 2;
    const drawScale = fx.critical ? 1.02 : 0.92;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // 1. 极短促的锐利击中十字芯（替代原先笨重的大圆模糊光球）
    if (elapsed < 120) {
        const k = 1 - elapsed / 120;
        const r = (fx.flashColor >> 16) & 255;
        const g = (fx.flashColor >> 8) & 255;
        const b = fx.flashColor & 255;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.translate(mid, mid);
        ctx.rotate(fx.attackAngle);
        const streakLen = (fx.critical ? 72 : 54) * (0.45 + 0.55 * (1 - k));
        const grad = ctx.createLinearGradient(-streakLen, 0, streakLen, 0);
        grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
        grad.addColorStop(0.5, `rgba(255,252,240,${k * 0.92})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(-streakLen, -2.5 * k - 0.8, streakLen * 2, 5 * k + 1.6);
        ctx.restore();
    }

    // 2. 笔锋斩痕 / 护体罡气 / 内劲波纹
    const ringSurf = getTintedSurface(`hit-ring-${fx.style}`, fx.surfaces?.ring, fx.tint);
    if (ringSurf) {
        const curve = fx.sharp ? RING_CURVE_SHARP : fx.kind === "shield" ? RING_CURVE_SHIELD : RING_CURVE_INNER;
        for (const ring of fx.rings) {
            const age = elapsed - ring.delay;
            if (age < 0 || age >= ring.lifetime) continue;
            const t = age / ring.lifetime;
            const fade = sampleFadeAlpha(age, ring.lifetime, 12 / ring.lifetime, (fx.critical ? 240 : 190) / ring.lifetime);
            const drawSize = ringSurf.width * ring.scale * drawScale * sampleCurve(t, curve);
            ctx.save();
            ctx.globalAlpha = clamp(fade * 0.95, 0, 1);
            ctx.translate(mid, mid);
            ctx.rotate(ring.angle + ring.spin * t);
            ctx.drawImage(ringSurf, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
            ctx.restore();
        }
    }

    // 3. 火星碎光 / 游丝
    const sparkSurf = getTintedSurface(`hit-spark-${fx.style}`, fx.surfaces?.spark, fx.tint);
    const moteSurf = getTintedSurface(`hit-mote-${fx.style}`, fx.surfaces?.mote, fx.tint);
    for (const sp of fx.sparks) {
        if (elapsed >= sp.lifetime) continue;
        const surf = sp.useMote ? (moteSurf ?? sparkSurf) : (sparkSurf ?? moteSurf);
        if (!surf) continue;
        const t = elapsed / sp.lifetime;
        const travel = sp.speed * (elapsed / 1000) * (1 - 0.45 * t);
        const dist = (sp.radius0 + travel * 0.92) * drawScale;
        const px = mid + Math.cos(sp.angle) * dist;
        const py = mid + Math.sin(sp.angle) * dist;
        const alpha = sp.alpha * sampleFadeAlpha(elapsed, sp.lifetime, 12 / sp.lifetime, 160 / sp.lifetime);
        const drawSize = surf.width * sp.scale * drawScale * sampleCurve(t, SPARK_SCALE_CURVE);
        if (alpha <= 0.01 || drawSize <= 0.5) continue;

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = clamp(alpha, 0, 1);
        ctx.translate(px, py);
        ctx.rotate(sp.angle + Math.PI / 2);
        ctx.drawImage(surf, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        ctx.restore();
    }

    // 4. 暴击古金锋芒
    if (fx.critical) {
        const starSurf = getTintedSurface("hit-star", fx.surfaces?.star, fx.criticalColor);
        if (starSurf) {
            for (const st of fx.stars) {
                const age = elapsed - st.delay;
                if (age < 0 || age >= st.lifetime) continue;
                const t = age / st.lifetime;
                const fade = sampleFadeAlpha(age, st.lifetime, 8 / st.lifetime, 150 / st.lifetime);
                const grow = 0.45 + 0.63 * Math.min(1, t / 0.18);
                const drawSize = starSurf.width * st.scale * drawScale * grow;
                ctx.save();
                ctx.globalCompositeOperation = "lighter";
                ctx.globalAlpha = clamp(fade * 0.96, 0, 1);
                ctx.translate(mid + st.offsetX * drawScale, mid + st.offsetY * drawScale);
                ctx.rotate(st.angle);
                ctx.drawImage(starSurf, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
                ctx.restore();
            }
        }
    }

    return canvas;
}

function buildDiorama3DHitEffects(renderer, metrics, now) {
    if (activeHitEffects.length === 0) return [];
    const out = [];
    for (let i = activeHitEffects.length - 1; i >= 0; i--) {
        const fx = activeHitEffects[i];
        const elapsed = now - fx.startedAt;
        if (elapsed >= fx.duration || fx.token?.destroyed) {
            releaseHitCanvas(fx);
            activeHitEffects.splice(i, 1);
            continue;
        }
        const source = paintHitEffectToCanvas(fx, elapsed);
        if (!source) continue;

        const tokLayout = renderer?._layout?.find?.(L => String(L?.t?.id ?? "") === fx.tokenId);
        let cx = 0;
        let cz = 0;
        if (Array.isArray(tokLayout?.base) && tokLayout.base.length >= 3) {
            cx = tokLayout.base[0];
            cz = tokLayout.base[2];
        } else if (fx.token?.center && metrics) {
            cx = (fx.token.center.x - metrics.ox) / metrics.size;
            cz = (fx.token.center.y - metrics.oy) / metrics.size;
        }
        const tokW = Math.max(1, Number(tokLayout?.t?.w ?? fx.token?.document?.width ?? 1) || 1);
        const halfSpan = Math.max(1.05, tokW * 0.98) * fx.scale;

        out.push({
            id: fx.effectId,
            source,
            dynamic: true,
            p0: [cx - halfSpan, cz - halfSpan],
            px: [cx + halfSpan, cz - halfSpan],
            py: [cx - halfSpan, cz + halfSpan],
            mode: "upright",
            tok: fx.tokenId,
            attach: true,
            alpha: 1,
            tint: [1, 1, 1],
            additive: false,
            light: true
        });
    }
    return out;
}

function buildInjected3DEffects(renderer, now) {
    const metrics = getGridMetrics();
    if (!metrics || !(Number(renderer?.cols) > 0) || !(Number(renderer?.rows) > 0)) {
        return [];
    }
    return buildDiorama3DHitEffects(renderer, metrics, now);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
