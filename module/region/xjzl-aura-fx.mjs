/**
 * 光环视觉：常驻的圆形边界，以及可关闭的轻量内力水纹与微光。
 * 只读取圆形光环元数据；真实覆盖与结算仍由 Region 的格子形状负责。
 * 纹理全局复用，静态层只在半径/颜色改变时重建；动态层复用 V14 ParticleGenerator。
 */

const DEFAULT_COLOR = "#40d0c0";
const FIELD_SIZE = 512;
const RIPPLE_SIZE = 512;
const textures = new Map();

/** 白色纹理只烘焙一次，由 Sprite tint 上色；不为每个光环创建滤镜或离屏画布。 */
function textureFor(key, width, height, paint) {
    if (textures.has(key)) return textures.get(key);
    const surface = document.createElement("canvas");
    surface.width = width;
    surface.height = height;
    const context = surface.getContext("2d");
    if (!context) throw new Error("无法创建光环纹理画布。");
    paint(context, width, height);
    const texture = PIXI.Texture.from(surface);
    textures.set(key, texture);
    return texture;
}

/**
 * 可选的渐变底幕中心通透、边缘收墨；透明度刻意压低，避免盖住地图与实际格子范围。
 * 底幕只在开启“光环特效”时创建，关闭时不改变常驻圆形边界。
 */
function fieldTexture(halo = false) {
    return textureFor(halo ? "halo" : "field", FIELD_SIZE, FIELD_SIZE, (ctx, w, h) => {
        const radius = w / 2;
        const gradient = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
        const stops = halo
            ? [[0, 0], [0.84, 0], [0.90, 0.012], [0.94, 0.045], [0.965, 0.12], [0.98, 0.04], [1, 0]]
            : [[0, 0.008], [0.32, 0.016], [0.65, 0.045], [0.85, 0.078], [0.96, 0.12], [1, 0]];
        for (const [position, alpha] of stops) gradient.addColorStop(position, `rgba(255,255,255,${alpha})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
    });
}

/** 烘焙水面般的同心涟漪：宽而淡的波面托住短促亮边，避免随机气流线抢主体。 */
function rippleTexture(variant = 0) {
    return textureFor(`ripple-${variant}`, RIPPLE_SIZE, RIPPLE_SIZE, (ctx, w, h) => {
        const center = w / 2;
        ctx.lineCap = "round";
        const offset = variant ? Math.PI * 0.28 : 0;
        // 每张纹理只保留两道主波面，避免多枚精灵叠加成密集同心圈。
        for (const [radius, width, alpha] of [[116, 12, 0.09], [172, 1.6, 0.42]]) {
            ctx.lineWidth = width;
            ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
            ctx.beginPath();
            // 两个错开的缺口让波纹有水面呼吸感，同时保持近似完整的圆形读法。
            ctx.arc(center, center, radius, -Math.PI * 0.86 + offset, Math.PI * 0.82 + offset);
            ctx.stroke();
        }
    });
}

/** 少量暖白水光点，沿涟漪边缘缓慢漂移；纹理共享，不使用每粒滤镜。 */
function moteTexture() {
    return textureFor("mote", 64, 64, (ctx, w, h) => {
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        for (const [position, alpha] of [[0, 1], [0.09, 1], [0.22, 0.48], [0.5, 0.11], [1, 0]]) {
            gradient.addColorStop(position, `rgba(255,255,255,${alpha})`);
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
        // 低对比四点星芒只用于偶发的水面反光，避免成为抢眼的星空粒子。
        ctx.strokeStyle = "rgba(255,248,220,0.32)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(32, 19); ctx.lineTo(32, 45);
        ctx.moveTo(19, 32); ctx.lineTo(45, 32);
        ctx.stroke();
    });
}

/** 点状星光：短暂闪现后淡出，不沿轨迹移动，也不会拉出线性光痕。 */
function starTexture() {
    return textureFor("star", 48, 48, (ctx, w, h) => {
        const center = w / 2;
        const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
        for (const [position, alpha] of [[0, 1], [0.1, 0.82], [0.28, 0.2], [0.62, 0.025], [1, 0]]) {
            gradient.addColorStop(position, `rgba(255,255,255,${alpha})`);
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = "rgba(255,250,226,0.58)";
        ctx.lineWidth = 1;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(center, 7); ctx.lineTo(center, 41);
        ctx.moveTo(7, center); ctx.lineTo(41, center);
        ctx.stroke();
    });
}

/** 在 RGB 空间混合颜色；ratio 为 0~1，用于保持自定义光环色相。 */
function mixColor(from, to, ratio) {
    const mix = shift => Math.round(((from >> shift) & 255) * (1 - ratio) + ((to >> shift) & 255) * ratio);
    return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/**
 * 仅解析带 aura 标记的圆形 Region；优先读取当前 xjzlAura 行为，
 * 旧数据没有行为实例时才回退到创建时的 flags 快照。
 * 圆仅为视觉指示，不参与格子包含判定。
 */
function readAuraVisual(object) {
    const doc = object?.document;
    const meta = doc?.getFlag("xjzl-system", "aura");
    const size = canvas.dimensions?.size ?? 0;
    if (!meta || !(size > 0)) return null;
    const behavior = doc.behaviors?.find?.(entry => entry.type === "xjzlAura");
    const params = behavior?.system ?? meta.params ?? {};
    if (params.shapeKind === "rect") return null;
    const radius = Math.max(0, Math.trunc(params.radius ?? meta.params?.radius ?? 0));
    return {
        radius,
        // 沿用外轮廓口径，抵达轴向最外格边缘；实际覆盖仍以阶梯状格子为准。
        rPx: (radius + 0.5) * size,
        tint: Number(foundry.utils.Color.from(doc.color ?? DEFAULT_COLOR))
    };
}

/** 圆半径也包含网格像素大小，场景网格重设后不能继续使用旧尺寸纹理。 */
function visualKey(visual) {
    return `${visual.rPx}|${visual.tint}`;
}

/**
 * 真实阶梯格子始终保留；开启特效时叠加低对比圆形底幕，编辑/悬停时提高格子提示。
 * 不修改 Region 的几何与命中区域。
 * V14 把 RegionMesh 放在独立 _highlights 容器；通过公开的 mesh.region 找回本实例。
 */
function syncCoverageHighlight(object, enabled = true, effectsEnabled = isParticlesEnabled()) {
    let mesh = object._auraCoverageMesh;
    if (!mesh || mesh.destroyed) {
        mesh = object.layer?._highlights?.children.find(child => child.region === object);
        object._auraCoverageMesh = mesh;
    }
    if (!mesh) return;
    const editing = object.layer.active && (object.controlled || object.hover || object.isPreview || object.layer.highlightObjects);
    // 真实格子是功能提示：特效关闭时恢复高对比度，开启时也只略微让位给水纹，不能牺牲可读性。
    mesh.alpha = enabled
        ? (effectsEnabled ? (editing ? 0.34 : 0.22) : (editing ? 0.58 : 0.48))
        : 0.5;
}

/** 移除可关闭的内部底幕；常驻圆形边界与真实覆盖格子不受影响。 */
function removeAuraBackdrop(object) {
    const backdrop = object?._auraBackdrop;
    if (backdrop && !backdrop.destroyed) backdrop.destroy({children: true});
    if (object) object._auraBackdrop = null;
}

/** 创建可关闭的低对比底幕与边缘柔光；它是圆形边界的子层，移动时无需逐帧重绘。 */
function addAuraBackdrop(object, visual) {
    const root = object?._auraCircle;
    if (!root || !visual) return;
    removeAuraBackdrop(object);
    const {rPx: r, tint} = visual;
    const backdrop = new PIXI.Container();
    backdrop.eventMode = "none";
    backdrop.zIndex = 0;

    const field = backdrop.addChild(new PIXI.Sprite(fieldTexture()));
    field.anchor.set(0.5);
    field.width = field.height = r * 2;
    field.tint = mixColor(tint, 0x071B20, 0.9);

    const halo = backdrop.addChild(new PIXI.Sprite(fieldTexture(true)));
    halo.anchor.set(0.5);
    halo.width = halo.height = r * 2 / 0.965;
    halo.tint = mixColor(tint, 0xFFFFFF, 0.12);
    halo.blendMode = PIXI.BLEND_MODES.SCREEN;

    root.addChildAt(backdrop, 0);
    object._auraBackdrop = backdrop;
}

/** 跟随光环移动时只平移裁剪圆；路径固定在局部原点，避免刷新时反复重建几何。 */
function syncAuraParticleMask(object, cx, cy) {
    const mask = object?._auraParticleMask;
    if (!mask || mask.destroyed) return;
    mask.position.set(cx, cy);
}

/** 创建常驻圆形边界；可选底幕与动态层由开关控制，关闭时仍保留单一外圈和真实格子范围。 */
export function drawAuraCircle(object, {effectsEnabled = isParticlesEnabled()} = {}) {
    stopAuraParticles(object);
    removeAuraBackdrop(object);
    object._auraCircle?.destroy({children: true});
    object._auraCircle = null;
    const visual = readAuraVisual(object);
    if (!visual) {
        if (object._auraCircleKey) syncCoverageHighlight(object, false);
        object._auraCircleKey = "";
        return null;
    }
    const {rPx: r, tint} = visual;
    const bounds = object.bounds;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const root = new PIXI.Container();
    root.eventMode = "none";
    root.zIndex = 1;
    root.position.set(cx, cy);

    const lines = root.addChild(new PIXI.Graphics());
    const weight = Math.max(1.05, Math.min(1.8, r / 360));
    lines.lineStyle(weight, mixColor(tint, 0xFFF7DF, 0.58), 0.66);
    lines.drawCircle(0, 0, r);

    object.addChild(root);
    object._auraCircle = root;
    object._auraCircleKey = visualKey(visual);
    object._auraCenter = {x: cx, y: cy};
    if (effectsEnabled) {
        try {
            addAuraBackdrop(object, visual);
        } catch (err) {
            // 底幕是可选装饰，纹理/画布失败时保留外圈与核心格子。
            console.warn("XJZL | 光环底幕创建失败，已跳过可选视觉层。", err);
            removeAuraBackdrop(object);
        }
    }
    syncCoverageHighlight(object, true, effectsEnabled);
    return {...visual, cx, cy};
}

/** 客户端粒子偏好；初始化异常时保留静态圆并记录原因。 */
export function isParticlesEnabled() {
    try {
        return game.settings.get("xjzl-system", "auraParticles") !== false;
    } catch (err) {
        console.warn("XJZL | 光环粒子设置不可读，本次按关闭处理。", err);
        return false;
    }
}

/**
 * 启动水面般的内力涟漪：适度交叠同心波、稀疏水光与点状星光，总计至多 13 粒。
 * 原生生成器负责精灵池、生命周期与 ticker；圆形 mask 只裁动态层，真实格子高亮仍独立保留。
 * 不使用独立计时器、逐帧路径重建、全屏滤镜。失败时完整释放已启动的生成器，保留静态圆。
 * @param {object} object - Region placeable
 * @param {object|null} circle - drawAuraCircle 返回的圆参数；半径 0 不创建动态层
 * @returns {Promise<void>}
 */
export async function startAuraParticles(object, circle) {
    stopAuraParticles(object);
    if (!circle || circle.radius < 1 || object.destroyed) return;
    const {rPx: r, tint} = circle;
    const anchor = () => object._auraCenter ?? {x: circle.cx, y: circle.cy};
    const spin = Math.random() < 0.5 ? 1 : -1;
    const generators = object._auraParticles = [];
    // 错开初始年龄，初次展示即有完整波面，随后不会成批消失/重生。
    const stagger = p => { p.elapsedTime = p.lifetime * (0.16 + Math.random() * 0.52); };
    try {
        // mask 与生成器都属于可选层，必须放在 try 内，失败时不能阻断 Region 核心绘制。
        const mask = new PIXI.Graphics();
        mask.beginFill(0xFFFFFF, 1);
        mask.drawCircle(0, 0, r * 0.985);
        mask.endFill();
        mask.position.set(circle.cx, circle.cy);
        mask.renderable = false;
        mask.eventMode = "none";
        object.addChild(mask);
        object._auraParticleMask = mask;
        const create = config => {
            const gen = new foundry.canvas.animation.ParticleGenerator({
                mode: "effect", initial: 0, anchor, particleAnchor: {x: 0.5, y: 0.5},
                container: object, onSpawn: stagger, mask, ...config
            });
            // 先登记再启动，后续纹理/生成器异常也能清理已经挂上的 ticker。
            generators.push(gen);
            gen.start({spawn: config.count});
            gen.particlesContainer.eventMode = "none";
            gen.particlesContainer.zIndex = 2;
            return gen;
        };
        const count = Math.min(2, Math.max(1, Math.round(r / 360)));
        const rippleScale = r / 176;
        create({
            // 保持较疏的波面；约 5 秒补入一轮，缩短完全消失后的空档但不堆叠过密。
            count, spawnRate: count / 5,
            // 有 anchor 时，普通对象坐标按相对锚点解析；(0,0) 才是圆心。
            area: {x: 0, y: 0},
            textures: [rippleTexture(0), rippleTexture(1)],
            tint: mixColor(tint, 0xF4F8EA, 0.58), blend: PIXI.BLEND_MODES.SCREEN,
            lifetime: [6500, 9000], fade: {in: 0.1, out: 0.2},
            alpha: {min: 0.42, max: 0.7, curve: [
                {time: 0, value: 0.08}, {time: 0.12, value: 0.96}, {time: 0.72, value: 0.7}, {time: 1, value: 0}
            ]},
            scale: {min: rippleScale * 0.72, max: rippleScale * 0.9, curve: [
                {time: 0, value: 0.34}, {time: 0.82, value: 1}, {time: 1, value: 1.03}
            ]},
            // 波纹只通过 scale 曲线向外扩散，不做角向旋转，避免出现绕圈光带。
            rotation: {speed: 0},
            // 跟随光环移动时保留每道波纹相对圆心的位置，不把旧粒子留在原地。
            behavior: "follow",
            follow: {stiffness: 1}
        });

        const motes = Math.min(7, Math.max(5, Math.round(r / 96)));
        create({
            count: motes, spawnRate: motes / 7,
            area: {radius: [r * 0.3, r * 0.95]},
            behavior: "orbit", orbit: {angularSpeed: [1, 3], direction: spin, rotation: "none"},
            textures: [moteTexture()], tint: 0xFFF1CE, blend: PIXI.BLEND_MODES.SCREEN,
            lifetime: [8000, 13000], fade: {in: 0.2, out: 0.34},
            alpha: [0.35, 0.62], scale: [0.09, 0.16]
        });

        // 外缘使用点状星光：随机闪现后淡出，不沿圆周移动，不制造长亮痕。
        const stars = 5;
        create({
            count: stars, spawnRate: stars / 3,
            area: {radius: [r * 0.55, r * 0.9]},
            textures: [starTexture()], tint: mixColor(tint, 0xFFF9DF, 0.72), blend: PIXI.BLEND_MODES.SCREEN,
            lifetime: [2400, 4000], fade: {in: 0.2, out: 0.55},
            alpha: [0.42, 0.82], scale: [0.11, 0.2],
            // 星光随光环整体移动，避免移动后被新位置 mask 裁掉。
            behavior: "follow",
            follow: {stiffness: 1},
            onSpawn: p => {
                p.rotation = Math.random() * Math.PI * 2;
                p.elapsedTime = p.lifetime * (0.08 + Math.random() * 0.55);
            }
        });

    } catch (err) {
        stopAuraParticles(object);
        console.error("XJZL | 光环粒子创建失败，已回退到静态圆。", err);
    }
}

/** 停止所有生成器；默认立即解绑 ticker、销毁精灵，保留跨光环共享纹理与常驻圆。 */
export function stopAuraParticles(object, {hard = true} = {}) {
    const generators = object?._auraParticles;
    object._auraParticles = null;
    for (const gen of generators ?? []) {
        try {
            gen.stop({hard});
        } catch (err) {
            console.error("XJZL | 光环粒子停止失败。", err);
        }
    }
    object?._auraParticleMask?.destroy({children: true});
    if (object) object._auraParticleMask = null;
}

/** init 时注册客户端偏好；开关只作用于内部水纹/微光，不关闭外圈或真实格子范围。 */
export function registerAuraFxSetting() {
    game.settings.register("xjzl-system", "auraParticles", {
        name: game.i18n.localize("XJZL.Settings.AuraParticles.Name"),
        hint: game.i18n.localize("XJZL.Settings.AuraParticles.Hint"),
        scope: "client", config: true, type: Boolean, default: true, requiresReload: false,
        onChange: enabled => setAuraParticlesForScene(enabled !== false)
    });
}

/** 渲染状态刷新时同步中心和格子提示；半径/颜色变化才重建视觉，不参与每帧结算。 */
export function refreshAuraFx(object) {
    try {
        const visual = readAuraVisual(object);
        const effectsEnabled = isParticlesEnabled();
        if (!visual) {
            // 允许矩形↔圆形切换：没有旧圆时无需反复重绘普通 Region。
            if (object?._auraCircleKey || object?._auraCircle) drawAuraCircle(object, {effectsEnabled});
            return;
        }
        if (visualKey(visual) !== object._auraCircleKey) {
            const circle = drawAuraCircle(object, {effectsEnabled});
            if (effectsEnabled) startAuraParticles(object, circle);
            return;
        }
        const bounds = object.bounds;
        const cx = bounds.x + bounds.width / 2;
        const cy = bounds.y + bounds.height / 2;
        object._auraCircle.position.set(cx, cy);
        object._auraCenter = {x: cx, y: cy};
        syncAuraParticleMask(object, cx, cy);
        syncCoverageHighlight(object, true, effectsEnabled);
    } catch (err) {
        // 视觉增强失败时清理自身，Region 的网格形状与结算仍由核心继续负责。
        stopAuraParticles(object);
        removeAuraBackdrop(object);
        console.warn("XJZL | 光环视觉刷新失败，已保留核心 Region。", err);
    }
}

/** 即时切换当前场景动态层与底幕，保持静态外圈和格子实例不变，避免不必要的重绘。 */
function setAuraParticlesForScene(enabled) {
    for (const region of canvas.scene?.regions ?? []) {
        const object = region.object;
        if (!object?._auraCircleKey) continue;
        stopAuraParticles(object);
        const visual = readAuraVisual(object);
        if (!visual) continue;
        if (enabled) {
            try {
                addAuraBackdrop(object, visual);
                startAuraParticles(object, {...visual, cx: object._auraCenter.x, cy: object._auraCenter.y});
            } catch (err) {
                removeAuraBackdrop(object);
                console.warn("XJZL | 光环动态层切换失败，已保留静态显示。", err);
            }
        } else {
            removeAuraBackdrop(object);
        }
        syncCoverageHighlight(object, true, enabled);
    }
}
