/**
 * 受击视觉管理器：在结算结果已经确定后播放 Token 动作、变色与命中粒子。
 * 特效只改变客户端画布，不参与伤害事务；事件由伤害结算端广播给所有客户端。
 */

const TEXTURE_SIZE = 256;
const MAX_ACTIVE_GENERATORS = 72;
const textureCache = new Map();
const activeGenerators = new Set();
const activeReactions = new Map();
const seenEventIds = new Set();

// 各阶段是一次顿挫、反向震动和衰减回弹，避免均匀抖动显得像漂浮。
const REACTION_FRAMES = [
  {time: 0, offset: 0, squash: 0, flash: 0},
  {time: 0.07, offset: 0.5, squash: 0.9, flash: 1},
  {time: 0.18, offset: 1, squash: 1, flash: 0.92},
  {time: 0.32, offset: -0.62, squash: -0.6, flash: 0.58},
  {time: 0.48, offset: 0.34, squash: 0.34, flash: 0.28},
  {time: 0.65, offset: -0.16, squash: -0.16, flash: 0.08},
  {time: 0.82, offset: 0.05, squash: 0, flash: 0},
  {time: 1, offset: 0, squash: 0, flash: 0}
];

const COLORS = Object.freeze({
  impact: 0xCC5147,
  blade: 0xF4DDB7,
  inner: 0x68CBAA,
  shield: 0x65C5AA,
  crit: 0xEBC387,
  fire: 0xED863C,
  poison: 0x64C35F,
  mental: 0xAB73DA,
  bleed: 0xB83343
});

/**
 * 读取已提交的伤害结果并异步广播视觉事件，不修改入参、返回值或 Actor 数据。
 * @param {Actor} actor - 实际承受伤害的 Actor
 * @param {object} data - 原有伤害入参；targetTokenUuid 仅作内部视觉定位
 * @param {object} losses - 已提交的实际损失
 * @param {object|null} socket - 现有 socketlib 系统连接；尚未初始化时跳过
 * @param {object} [criticalConfig=data] - 最终暴击配置；仅在视觉隔离边界内读取
 */
export function queueHitEffect(actor, data, losses, socket, criticalConfig = data) {
  try {
    const hutiLost = Number(losses?.hutiLost) || 0;
    const hpLost = Number(losses?.hpLost) || 0;
    const mpLost = Number(losses?.mpLost) || 0;
    const tiliLost = Number(losses?.tiliLost) || 0;
    if (hutiLost + hpLost + mpLost + tiliLost <= 0 || !socket?.executeForEveryone) return;

    const kind = hutiLost > 0 && hpLost <= 0 && mpLost <= 0 && tiliLost <= 0 ? "shield" : "impact";
    const sourceScale = data?.source === "dot" ? 0.72 : data?.source === "extra" ? 0.84 : 1;
    const eventId = globalThis.foundry?.utils?.randomID?.()
      ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = {
      eventId,
      actorUuid: actor.uuid,
      tokenUuid: data?.targetTokenUuid || actor.token?.uuid || null,
      attackerUuid: data?.attacker?.uuid || null,
      kind,
      damageType: data?.type || "none",
      source: data?.source || "extra",
      isCrit: Boolean(criticalConfig?.isCrit),
      scale: Math.min(1.45, (1 + Math.log10(Math.max(1, losses?.finalDamage || 1)) * 0.12) * sourceScale)
    };

    // 不等待视觉 RPC；同步抛错和异步拒绝均在此隔离，不能改变伤害函数的结果。
    Promise.resolve(socket.executeForEveryone("playHitEffect", payload)).catch(error => {
      console.error("XJZL | 广播受击特效失败。", error);
    });
  } catch (error) {
    console.error("XJZL | 准备受击特效失败，已跳过视觉反馈。", error);
  }
}

/**
 * 注册每位玩家独立的受击特效开关；关闭时立即停止粒子并恢复 Token 外观。
 */
export function registerCombatFxSetting() {
  game.settings.register("xjzl-system", "enableHitEffects", {
    name: game.i18n.localize("XJZL.Settings.HitEffects.Name"),
    hint: game.i18n.localize("XJZL.Settings.HitEffects.Hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
    onChange: enabled => {
      if (enabled === false) stopAllHitEffects();
    }
  });
  Hooks.on("canvasTearDown", stopAllHitEffects);
  Hooks.on("destroyToken", token => stopTokenReaction(activeReactions.get(token)));
}

/** 停止本客户端所有受击动作与粒子，并恢复未被核心或其他模块改写的外观。 */
export function stopAllHitEffects() {
  for (const reaction of activeReactions.values()) stopTokenReaction(reaction);
  for (const generator of activeGenerators) {
    try {
      generator.stop({hard: true});
    } catch (error) {
      console.error("XJZL | 停止受击特效失败。", error);
    }
  }
  activeGenerators.clear();
}

/**
 * Socket 接收端的渲染入口。
 * @param {object} payload - {actorUuid, tokenUuid, attackerUuid, kind, damageType, source, isCrit, scale, eventId}
 */
export async function renderHitEffect(payload = {}) {
  if (!isEnabled() || !globalThis.canvas?.ready) return;
  const scene = canvas.scene;
  if (payload.eventId) {
    if (seenEventIds.has(payload.eventId)) return;
    seenEventIds.add(payload.eventId);
    if (seenEventIds.size > 512) seenEventIds.delete(seenEventIds.values().next().value);
  }

  const token = await resolveToken(payload);
  if (!token?.renderable || (!token.visible && !globalThis.game?.user?.isGM)) return;

  const kind = payload.kind === "shield" ? "shield" : "impact";
  const color = colorFor(payload.damageType, kind);
  const scale = clamp(Number(payload.scale) || 1, 0.75, 1.45);
  const critical = Boolean(payload.isCrit);
  const criticalColor = criticalColorFor(color);
  const attackerToken = payload.attackerUuid ? await resolveToken({actorUuid: payload.attackerUuid}) : null;
  // UUID 解析期间可能切换场景或关闭选项；晚到的事件不能重新启动特效。
  if (!isEnabled() || !globalThis.canvas?.ready || canvas.scene !== scene || !token.renderable || token.destroyed
    || (!token.visible && !globalThis.game?.user?.isGM)) return;
  try {
    startTokenReaction(token, {kind, color, criticalColor, scale, critical, source: payload.source, attackerToken});
  } catch (error) {
    stopTokenReaction(activeReactions.get(token));
    console.error("XJZL | 创建 Token 受击动作失败，已恢复外观。", error);
  }

  // 光敏模式只保留缓慢、低强度的变色；AOE 上限只抑制粒子，不丢弃 Token 动作。
  if (canvas.photosensitiveMode || activeGenerators.size + (critical ? 3 : 2) > MAX_ACTIVE_GENERATORS) return;
  const particleScale = scale * clamp(Math.max(token.w, token.h) / 100 || 1, 0.5, 4);
  const style = effectStyle(kind, payload.damageType);
  const accentColor = style === "slash" ? COLORS.blade : color;
  const attackAngle = attackerToken && attackerToken !== token
    ? Math.atan2(token.center.y - attackerToken.center.y, token.center.x - attackerToken.center.x)
    : -0.18;
  const generators = [];

  try {
    generators.push(createRingGenerator(token, critical ? criticalColor : accentColor,
      kind, particleScale, critical, style, attackAngle));
    generators.push(createSparkGenerator(token, critical ? criticalColor : accentColor, kind, particleScale, critical,
      payload.damageType, payload.source, attackAngle));
    if (critical) generators.push(createStarGenerator(token, particleScale, attackAngle, criticalColor));

    for (const generator of generators) {
      activeGenerators.add(generator);
      generator.start({spawn: generator._xjzlSpawnCount});
      promoteHitParticles(generator, token);
      delete generator._xjzlSpawnCount;
    }

    const duration = critical ? 780 : kind === "shield" ? 660 : 600;
    globalThis.setTimeout(() => {
      for (const generator of generators) {
        try {
          generator.stop({hard: true});
        } catch (error) {
          console.error("XJZL | 清理受击特效失败。", error);
        }
        activeGenerators.delete(generator);
      }
    }, duration);
  } catch (error) {
    stopGenerators(generators);
    for (const generator of generators) activeGenerators.delete(generator);
    console.error("XJZL | 创建受击特效失败，已跳过视觉反馈。", error);
  }
}

/**
 * 将命中粒子置于 Token 排序层之上，避免默认场景层把弧光和斩痕压到 Token 图像下面。
 * 仍留在 Primary 组内，因此不会脱离场景变换、遮罩和高度排序。
 * @param {foundry.canvas.animation.ParticleGenerator} generator - 已启动的粒子生成器
 * @param {Token} token - 粒子所附着的 Token
 */
function promoteHitParticles(generator, token) {
  const particles = generator.particlesContainer;
  if (!particles) return;
  const tokenLayer = foundry.canvas.groups?.PrimaryCanvasGroup?.SORT_LAYERS?.TOKENS ?? 700;
  particles.sortLayer = tokenLayer + 1;
  particles.elevation = Number(token.document?.elevation ?? token.mesh?.elevation ?? 0) || 0;
  particles.sort = Number(token.document?.sort ?? token.mesh?.sort ?? 0) || 0;
  particles.zIndex = Number.isFinite(token.mesh?.zIndex) ? token.mesh.zIndex + 1 : Infinity;
  if (particles.parent) particles.parent.sortDirty = true;
}

function isEnabled() {
  try {
    return game.settings.get("xjzl-system", "enableHitEffects") !== false;
  } catch (error) {
    console.warn("XJZL | 受击特效设置不可读，本次按关闭处理。", error);
    return false;
  }
}

async function resolveToken({actorUuid, tokenUuid} = {}) {
  if (tokenUuid) {
    const document = await fromUuid(tokenUuid).catch(() => null);
    // 明确指定的 Token 被删或不在当前场景时不能改播到同 Actor 的另一个 Token。
    if (document?.parent && document.parent !== canvas.scene) return null;
    return document?.object ?? null;
  }
  const actor = actorUuid ? await fromUuid(actorUuid).catch(() => null) : null;
  return actor?.getActiveTokens?.(false)?.find(token => token?.renderable
    && (token.visible || globalThis.game?.user?.isGM)) ?? null;
}

/**
 * 用 V14 CanvasAnimation 驱动 Token 纹理的受击动作，不更新 TokenDocument 或感知范围。
 * 同一 Token 的连击替换上一动作；每帧在核心刷新前撤销偏移，刷新后再叠加，兼容移动与变色。
 */
function startTokenReaction(token, {kind, color, criticalColor, scale, critical, source, attackerToken}) {
  stopTokenReaction(activeReactions.get(token));
  const mesh = token.mesh;
  if (!mesh || mesh.destroyed) return;
  const animation = foundry.canvas.animation.CanvasAnimation;
  const ticker = canvas.app.ticker;
  const gentle = source === "dot";
  const shield = kind === "shield";
  const reduced = canvas.photosensitiveMode === true;
  const size = clamp(Math.min(token.w, token.h) || 100, 40, 240);
  const amplitude = reduced ? 0 : Math.min(26, size * (gentle ? 0.037 : critical ? 0.17 : shield ? 0.065 : 0.115) * scale);
  const flashColor = critical ? mixColor(criticalColor, 0xFFF4D6, 0.38)
    : mixColor(color, 0xFFFFFF, shield ? 0.16 : 0.12);
  const direction = attackerToken && attackerToken !== token
    ? {x: token.center.x - attackerToken.center.x, y: token.center.y - attackerToken.center.y}
    : {x: 1, y: -0.18};
  const length = Math.hypot(direction.x, direction.y) || 1;
  const reaction = {
    token, mesh, animation, ticker, name: Symbol("XJZL.HitReaction"), progress: 0,
    baseline: null, applied: null,
    restore: () => restoreTokenAppearance(reaction)
  };
  activeReactions.set(token, reaction);
  // 高于核心 OBJECTS 刷新；绝不让上一帧的临时坐标或缩放成为核心移动的基准。
  ticker.add(reaction.restore, reaction, PIXI.UPDATE_PRIORITY.HIGH + 1);
  animation.animate([{parent: reaction, attribute: "progress", from: 0, to: 1}], {
    name: reaction.name,
    duration: reduced ? 800 : gentle ? 300 : critical ? 560 : shield ? 380 : 440,
    priority: PIXI.UPDATE_PRIORITY.OBJECTS - 1,
    ontick: () => {
      restoreTokenAppearance(reaction);
      if (token.destroyed || mesh.destroyed || token.mesh !== mesh || !token.renderable
        || (!token.visible && !game.user.isGM) || !isEnabled() || !canvas.ready) return stopTokenReaction(reaction);
      const frame = sampleReaction(reaction.progress);
      const squash = reduced ? 0 : frame.squash * (gentle ? 0.023 : critical ? 0.11 : shield ? 0.04 : 0.075);
      const offset = frame.offset * amplitude;
      const baseline = readTokenAppearance(mesh);
      reaction.baseline = baseline;
      mesh.x += direction.x / length * offset;
      mesh.y += direction.y / length * offset;
      mesh.scale.x *= 1 - squash;
      mesh.scale.y *= 1 + squash * 0.65;
      mesh.angle += reduced ? 0 : frame.offset * (gentle ? 0.55 : critical ? 4.2 : shield ? 1.1 : 2.4);
      const strength = reduced ? Math.sin(Math.PI * reaction.progress) * 0.22
        : frame.flash * (gentle ? 0.58 : critical ? 1 : shield ? 0.86 : 0.94);
      mesh.tint = mixColor(baseline.tint, flashColor, strength);
      reaction.applied = readTokenAppearance(mesh);
    }
  }).finally(() => stopTokenReaction(reaction)).catch(error => {
    console.error("XJZL | Token 受击动作清理失败。", error);
  });
}

/** 终止一次 Token 动作；旧动画的异步完成回调不能终止后来替换的新动作。 */
function stopTokenReaction(reaction) {
  if (!reaction || activeReactions.get(reaction.token) !== reaction) return;
  activeReactions.delete(reaction.token);
  reaction.animation.terminateAnimation(reaction.name);
  reaction.ticker.remove(reaction.restore, reaction);
  restoreTokenAppearance(reaction);
}

/** 只撤销本动作仍然拥有的数值，保留在帧间由移动、缩放或外部模块写入的新外观。 */
function restoreTokenAppearance(reaction) {
  const {mesh, baseline, applied} = reaction;
  if (!applied || mesh.destroyed) return;
  if (mesh.x === applied.x) mesh.x = baseline.x;
  if (mesh.y === applied.y) mesh.y = baseline.y;
  if (mesh.scale.x === applied.scaleX) mesh.scale.x = baseline.scaleX;
  if (mesh.scale.y === applied.scaleY) mesh.scale.y = baseline.scaleY;
  if (mesh.angle === applied.angle) mesh.angle = baseline.angle;
  if (mesh.tint === applied.tint) mesh.tint = baseline.tint;
  reaction.applied = null;
}

function readTokenAppearance(mesh) {
  return {x: mesh.x, y: mesh.y, scaleX: mesh.scale.x, scaleY: mesh.scale.y, angle: mesh.angle, tint: mesh.tint};
}

/** 按 0–1 的动画进度平滑插值动作；每帧只创建一份采样结果，避免连击时的临时数组。 */
function sampleReaction(progress) {
  const end = REACTION_FRAMES.findIndex(frame => frame.time >= progress);
  if (end <= 0) return REACTION_FRAMES[end === 0 ? 0 : REACTION_FRAMES.length - 1];
  const from = REACTION_FRAMES[end - 1];
  const to = REACTION_FRAMES[end];
  const time = (progress - from.time) / (to.time - from.time);
  const eased = time * time * (3 - 2 * time);
  return {
    offset: from.offset + (to.offset - from.offset) * eased,
    squash: from.squash + (to.squash - from.squash) * eased,
    flash: from.flash + (to.flash - from.flash) * eased
  };
}

/** 分别混合 RGB 通道再重新打包，避免把十六进制颜色当单个数插值而产生串色。 */
function mixColor(from, to, strength) {
  const mix = clamp(strength, 0, 1);
  let color = 0;
  for (const shift of [16, 8, 0]) {
    const a = (from >> shift) & 0xFF;
    const b = (to >> shift) & 0xFF;
    color |= Math.round(a + (b - a) * mix) << shift;
  }
  return color;
}

function colorFor(damageType, kind) {
  if (kind === "shield") return COLORS.shield;
  return {
    fire: COLORS.fire,
    poison: COLORS.poison,
    mental: COLORS.mental,
    bleed: COLORS.bleed,
    liushi: COLORS.bleed,
    neigong: COLORS.inner
  }[damageType] ?? COLORS.impact;
}

/** 暴击保留伤害类型的底色，只叠加一层古金高光，避免所有暴击看起来完全相同。 */
function criticalColorFor(baseColor) {
  return mixColor(baseColor, COLORS.crit, 0.36);
}

/** 只返回有限的纹理样式，避免未知伤害类型生成无界缓存。 */
function effectStyle(kind, damageType) {
  if (kind === "shield") return "shield";
  return {
    neigong: "inner", fire: "flame", poison: "droplet", mental: "mental", bleed: "bleed", liushi: "bleed"
  }[damageType] ?? "slash";
}

/** 斩痕迅速落笔，护体先承压再回弹，内劲缓缓散开；style 仅取 effectStyle 的有限样式。 */
function createRingGenerator(token, color, kind, scale, critical, style, attackAngle) {
  const duration = critical ? 620 : kind === "shield" ? 520 : 460;
  const sharp = style === "slash" || style === "bleed";
  const generator = new foundry.canvas.animation.ParticleGenerator({
    mode: "effect",
    manual: true,
    anchor: token,
    anchorPoint: "center",
    particleAnchor: {x: 0.5, y: 0.5},
    area: {x: 0, y: 0},
    textures: [ringTexture(style)],
    lifetime: [duration, duration + 60],
    fade: {in: 12, out: critical ? 240 : 190},
    alpha: [0.86, 1],
    scale: {
      min: (critical ? 0.76 : kind === "shield" ? 0.66 : 0.6) * scale,
      max: (critical ? 0.88 : kind === "shield" ? 0.76 : 0.7) * scale,
      curve: sharp
        ? [{time: 0, value: 0.42}, {time: 0.1, value: 1.08}, {time: 0.3, value: 1}, {time: 1, value: 0.94}]
        : kind === "shield"
          ? [{time: 0, value: 0.8}, {time: 0.14, value: 1.05}, {time: 0.42, value: 0.92}, {time: 1, value: 1.08}]
          : [{time: 0, value: 0.52}, {time: 0.18, value: 0.96}, {time: 1, value: 1.15}]
    },
    rotation: sharp
      ? {initial: attackAngle, spread: Math.PI / 10, speed: [-6, 6]}
      : {spread: Math.PI, speed: kind === "shield" ? [-18, 18] : [18, 38]},
    tint: color,
    blend: PIXI.BLEND_MODES.NORMAL
  });
  generator._xjzlSpawnCount = critical ? 2 : 1;
  return generator;
}

/** 外功锋屑沿受力方向散出，其余伤害化作游丝；每次仍为有限数量的手动发射。 */
function createSparkGenerator(token, color, kind, scale, critical, damageType, source, attackAngle) {
  const gentle = source === "dot";
  const style = effectStyle(kind, damageType);
  const sharp = style === "slash" || style === "bleed";
  // 每次受击只发射一批短生命周期碎光，连续命中的总开销由全局发射器上限约束。
  const count = gentle ? 6 : critical ? 22 : kind === "shield" ? 11 : 14;
  const generator = new foundry.canvas.animation.ParticleGenerator({
    mode: "effect",
    manual: true,
    anchor: token,
    anchorPoint: "center",
    particleAnchor: {x: 0.5, y: 0.5},
    area: {x: 0, y: 0, radius: (critical ? 10 : 6) * scale},
    textures: [sparkTexture(kind, damageType), moteTexture(style)],
    lifetime: gentle ? [260, 380] : critical ? [380, 620] : [320, 520],
    fade: {in: 12, out: 160},
    velocity: {
      speed: {
        min: (gentle ? 80 : critical ? 200 : 150) * scale,
        max: (gentle ? 120 : critical ? 320 : 240) * scale,
        curve: [{time: 0, value: 1.15}, {time: 0.35, value: 0.65}, {time: 1, value: 0.12}]
      },
      angle: sharp ? [(attackAngle - Math.PI / 3) * 180 / Math.PI, (attackAngle + Math.PI / 3) * 180 / Math.PI] : [0, 360]
    },
    // 笔锋主轴朝上；沿速度方向摆放，锋屑与游丝才能读成冲击而非随机飘点。
    rotation: {
      alignVelocity: true,
      initial: Math.PI / 2,
      spread: 0,
      speed: sharp ? [-35, 35] : [-80, 80]
    },
    alpha: [0.68, 0.98],
    scale: {
      min: 0.21 * scale,
      max: (critical ? 0.44 : 0.34) * scale,
      curve: [{time: 0, value: 0.62}, {time: 0.14, value: 1}, {time: 0.72, value: 0.54}, {time: 1, value: 0.18}]
    },
    tint: color,
    blend: PIXI.BLEND_MODES.NORMAL
  });
  generator._xjzlSpawnCount = count;
  return generator;
}

/** 暴击叠加两道带有伤害类型色的古金锋芒，短促闪现；不增加持续发射器或滤镜。 */
function createStarGenerator(token, scale, attackAngle, color) {
  const generator = new foundry.canvas.animation.ParticleGenerator({
    mode: "effect",
    manual: true,
    anchor: token,
    anchorPoint: "center",
    particleAnchor: {x: 0.5, y: 0.5},
    area: {x: 0, y: 0, radius: 14 * scale},
    textures: [starTexture()],
    lifetime: [240, 400],
    fade: {in: 8, out: 150},
    alpha: [0.9, 1],
    scale: {
      min: 1.2 * scale, max: 1.55 * scale,
      curve: [{time: 0, value: 0.45}, {time: 0.12, value: 1}, {time: 1, value: 1.08}]
    },
    rotation: {initial: attackAngle, spread: Math.PI / 8, speed: [-8, 8]},
    tint: color,
    blend: PIXI.BLEND_MODES.NORMAL
  });
  generator._xjzlSpawnCount = 2;
  return generator;
}

/** 将不同伤害画成斩痕、罡气与游丝；笔锋和飞白只在首次生成纹理时绘制。 */
function ringTexture(style) {
  return cachedTexture(`ring-${style}`, TEXTURE_SIZE, TEXTURE_SIZE, (context, size) => {
    const center = size / 2;
    switch (style) {
      case "shield":
        paintBrushArc(context, center, size * 0.36, -Math.PI * 0.2, Math.PI * 1.1, 11);
        paintBrushArc(context, center, size * 0.36, Math.PI * 0.92, Math.PI * 0.76, 8);
        paintBrushArc(context, center, size * 0.29, -Math.PI * 0.12, Math.PI * 0.68, 3);
        break;
      case "inner":
        paintBrushArc(context, center, size * 0.34, -Math.PI * 0.8, Math.PI * 1.18, 13);
        paintBrushArc(context, center, size * 0.24, Math.PI * 0.1, Math.PI * 0.8, 7);
        paintBrushArc(context, center, size * 0.43, Math.PI * 0.46, Math.PI * 0.5, 3);
        break;
      case "flame":
        paintBrushCut(context, 90, 195, 80, 36, 22, 12);
        paintBrushCut(context, 127, 196, 159, 32, -38, 18);
        paintBrushCut(context, 165, 186, 213, 76, -18, 8);
        break;
      case "droplet":
        paintBrushArc(context, center, size * 0.27, Math.PI * 0.75, Math.PI * 1.4, 14);
        paintBrushArc(context, center, size * 0.36, -Math.PI * 0.35, Math.PI * 0.74, 6);
        paintBrushCut(context, 109, 169, 146, 65, 24, 4);
        break;
      case "mental":
        paintBrushArc(context, center, size * 0.39, -Math.PI * 0.72, Math.PI * 0.5, 9);
        paintBrushArc(context, center, size * 0.3, Math.PI * 0.25, Math.PI * 0.65, 8);
        paintBrushCut(context, 67, 165, 204, 54, -22, 3);
        break;
      case "bleed":
        paintBrushCut(context, 92, 175, 131, 31, 9, 8);
        paintBrushCut(context, 124, 192, 160, 69, 5, 6);
        paintBrushCut(context, 61, 179, 96, 95, -3, 4);
        break;
      default:
        paintBrushCut(context, 20, 166, 237, 83, -24, 16);
        paintBrushCut(context, 48, 192, 219, 110, -17, 6);
        paintBrushCut(context, 47, 130, 165, 59, -10, 3);
    }
  });
}

/** 小粒子沿用同一套笔触，颜色交由 tint；不把火毒和气劲画成独立图标。 */
function sparkTexture(kind, damageType) {
  const shape = effectStyle(kind, damageType);
  return cachedTexture(`spark-${shape}`, 64, 64, (context, size) => {
    const center = size / 2;
    const gradient = context.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, "rgba(255,255,255,0.14)");
    gradient.addColorStop(0.4, "rgba(255,255,255,0.05)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    switch (shape) {
      case "shield":
        paintBrushArc(context, center, 19, -Math.PI * 0.8, Math.PI * 0.92, 5);
        paintBrushArc(context, center, 14, Math.PI * 0.2, Math.PI * 0.6, 2);
        break;
      case "inner":
        paintBrushCut(context, 32, 60, 36, 4, 12, 7);
        paintBrushCut(context, 27, 50, 27, 15, -6, 2);
        break;
      case "flame":
        paintBrushCut(context, 30, 60, 35, 4, -10, 9);
        paintBrushCut(context, 34, 48, 45, 13, 8, 3);
        break;
      case "droplet":
        paintBrushCut(context, 29, 57, 37, 5, 15, 10);
        paintBrushCut(context, 24, 48, 29, 20, -7, 3);
        break;
      case "mental":
        paintBrushCut(context, 25, 58, 39, 6, 10, 4);
        paintBrushCut(context, 45, 54, 22, 14, -9, 2.5);
        break;
      case "bleed":
        paintBrushCut(context, 30, 60, 33, 5, 3, 4);
        context.fillStyle = "rgba(255,255,255,0.8)";
        context.beginPath();
        context.arc(29, 45, 3, 0, Math.PI * 2);
        context.fill();
        break;
      default:
        paintBrushCut(context, 30, 60, 34, 4, 3, 5.5);
    }
  });
}

/**
 * 墨点与气泡形态的微粒：不抢主笔锋，只在爆发边缘留下几枚轻小余韵。
 * 纹理按样式缓存，颜色仍由粒子 tint 统一控制。
 */
function moteTexture(style) {
  return cachedTexture(`mote-${style}`, 48, 48, (context, size) => {
    const center = size / 2;
    const gradient = context.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, "rgba(255,255,255,0.62)");
    gradient.addColorStop(0.3, "rgba(255,255,255,0.18)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    switch (style) {
      case "shield":
        paintBrushArc(context, center, 13, -Math.PI * 0.8, Math.PI * 1.25, 4);
        break;
      case "inner":
      case "mental":
        paintBrushArc(context, center, 11, -Math.PI * 0.6, Math.PI * 1.3, 3);
        break;
      case "flame":
        paintBrushCut(context, 23, 43, 26, 7, -4, 5);
        break;
      case "droplet":
        paintBrushCut(context, 21, 43, 27, 7, 4, 5);
        break;
      case "bleed":
        context.fillStyle = "rgba(255,255,255,0.92)";
        context.beginPath();
        context.arc(center, center + 2, 5, 0, Math.PI * 2);
        context.fill();
        break;
      default:
        paintBrushCut(context, 15, 38, 34, 10, 3, 4);
    }
  });
}

/** 古金锋芒用交错的长短笔锋表达穿透感，避免星形徽记遮住受击动作。 */
function starTexture() {
  return cachedTexture("critical-blade", 64, 64, context => {
    paintBrushCut(context, 4, 58, 58, 5, -2, 6);
    paintBrushCut(context, 9, 15, 51, 48, 2, 3);
    paintBrushCut(context, 16, 59, 58, 18, -4, 1.5);
  });
}

/** 圆弧只作为笔锋的中轴；变宽、收尖和飞白由 paintBrushRibbon 处理。 */
function paintBrushArc(context, center, radius, start, sweep, width) {
  const points = [];
  for (let i = 0; i <= 28; i++) {
    const angle = start + sweep * i / 28;
    points.push({x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius});
  }
  paintBrushRibbon(context, points, width);
}

/** 弯曲的斩痕以二次曲线采样；bend 是相对中轴的弯曲像素，width 为最宽处像素。 */
function paintBrushCut(context, x1, y1, x2, y2, bend, width) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const cx = (x1 + x2) / 2 - dy / length * bend;
  const cy = (y1 + y2) / 2 + dx / length * bend;
  const points = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    const u = 1 - t;
    points.push({x: u * u * x1 + 2 * u * t * cx + t * t * x2, y: u * u * y1 + 2 * u * t * cy + t * t * y2});
  }
  paintBrushRibbon(context, points, width);
}

/**
 * 将至少两个中轴采样点画成两端收尖的毛笔笔触；仅用于缓存纹理，不在动画帧中计算。
 * 固定的边缘起伏和细痕模拟飞白，细暗边兼顾浅色地图，不使用运行时模糊滤镜。
 */
function paintBrushRibbon(context, points, width) {
  const edges = points.map((point, index) => {
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    const t = index / (points.length - 1);
    const halfWidth = width * 0.5 * Math.pow(Math.sin(Math.PI * t), 0.7)
      * (1 + Math.sin(index * 2.7) * 0.1 + Math.sin(index * 0.8) * 0.07);
    return {point, nx: -dy / length, ny: dx / length, halfWidth};
  });
  context.save();
  context.beginPath();
  for (let side = 1; side >= -1; side -= 2) {
    const ordered = side === 1 ? edges : [...edges].reverse();
    for (let i = 0; i < ordered.length; i++) {
      const {point, nx, ny, halfWidth} = ordered[i];
      const x = point.x + nx * halfWidth * side;
      const y = point.y + ny * halfWidth * side;
      if (side === 1 && i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
  }
  context.closePath();
  context.strokeStyle = "rgba(35,35,30,0.4)";
  context.lineWidth = 1.5;
  context.stroke();
  // 柔光仅烘入小纹理一次；播放时仍是普通粒子贴图。
  context.shadowColor = "rgba(255,255,255,0.24)";
  context.shadowBlur = 4;
  context.fillStyle = "rgba(255,255,255,0.97)";
  context.fill();
  context.shadowBlur = 0;
  context.globalCompositeOperation = "destination-out";
  context.strokeStyle = "rgba(0,0,0,0.26)";
  context.lineWidth = Math.min(1.1, width * 0.12);
  context.setLineDash([3, 2, 7, 2]);
  for (const offset of [-0.35, 0.2]) {
    context.beginPath();
    for (let i = 4; i < edges.length - 4; i++) {
      const {point, nx, ny, halfWidth} = edges[i];
      const x = point.x + nx * halfWidth * offset;
      const y = point.y + ny * halfWidth * offset;
      if (i === 4) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
  context.restore();
}

function cachedTexture(key, width, height, paint) {
  if (textureCache.has(key)) return textureCache.get(key);
  const surface = document.createElement("canvas");
  surface.width = width;
  surface.height = height;
  const context = surface.getContext("2d");
  if (!context) throw new Error("无法创建受击特效纹理画布。");
  paint(context, width, height);
  const texture = PIXI.Texture.from(surface);
  textureCache.set(key, texture);
  return texture;
}

function stopGenerators(generators) {
  for (const generator of generators) {
    try {
      generator.stop({hard: true});
    } catch (error) {
      console.error("XJZL | 受击特效清理失败。", error);
    }
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
