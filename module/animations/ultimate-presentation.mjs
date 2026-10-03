/**
 * 绝招的客户端演出层：程序材质、透视流场、分层光照和完整图片画幅。
 * 拥有自己的 Canvas/DOM/RAF 与可取消的屏幕反冲，不修改 Foundry 相机、Token 或业务文档。
 */
import { getUltimateMaterials } from "./ultimate-materials.mjs";

export const ULTIMATE_PRESETS = Object.freeze([
  Object.freeze({id: "stars", color: "159,194,247", accent: "#e7d5aa", duration: 6800}),
  Object.freeze({id: "sakura", color: "243,179,200", accent: "#f5ced8", duration: 6800}),
  Object.freeze({id: "ink", color: "216,191,138", accent: "#dac397", duration: 6800}),
  Object.freeze({id: "thunder", color: "143,194,249", accent: "#c8e3f8", duration: 6800})
]);

const IMPACT = 4160;
const TAU = Math.PI * 2;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const phase = (time, start, end) => clamp((time - start) / (end - start));
const smooth = value => value * value * (3 - 2 * value);
const ease = value => 1 - (1 - value) ** 3;
const mix = (a, b, progress) => a + (b - a) * progress;
const pulse = (time, a, b, c, d) => smooth(phase(time, a, b)) * (1 - smooth(phase(time, c, d)));
const INK_CUTS = [1100, 1690, 2310, 2860, 3420];
const THUNDER_FALLS = [540, 1110, 1770, 2380, 2990];
const sakuraBlackout = time => pulse(time, 3780, 4020, IMPACT + 530, IMPACT + 1390);

/** 每个视觉动作只有一次有方向的反冲；小幅预击与主爆发分开，避免全程均匀抖动。 */
function recoilBeats(preset) {
  const beats = [{time: preset === "sakura" ? IMPACT + 85 : IMPACT,
    force: preset === "thunder" ? 25 : preset === "stars" ? 21 : 17, duration: 520, angle: -.3}];
  if (preset === "ink") {
    beats.push(...INK_CUTS.map((time, i) => ({time, force: 5 + i * 1.4, duration: 190, angle: i % 2 ? .8 : -.55})));
  }
  if (preset === "thunder") beats.push(...THUNDER_FALLS.map((time, i) => ({time: time + 55, force: 11 + i * 2,
    duration: 300, angle: Math.PI / 2 + (i % 2 ? -.2 : .2)})), {time: IMPACT + 660, force: 13, duration: 400, angle: .3});
  return beats;
}

/** 带衰减的定向位移，单位为 CSS 像素；只供演出自己的 Web Animation 采样。 */
function recoilOffset(beats, time, unit) {
  let x = 0, y = 0;
  for (const beat of beats) {
    const q = phase(time, beat.time, beat.time + beat.duration);
    if (q <= 0 || q >= 1) continue;
    const force = beat.force * unit * (1 - q) ** 2;
    const kick = Math.sin(q * Math.PI * 8), cross = Math.sin(q * Math.PI * 13) * .35;
    x += force * (Math.cos(beat.angle) * kick - Math.sin(beat.angle) * cross);
    y += force * (Math.sin(beat.angle) * kick + Math.cos(beat.angle) * cross);
  }
  return {x, y};
}

/** uint32 种子产生可重复序列；所有随机参数在构造时确定，不逐帧闪烁。 */
function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {value = (Math.imul(value, 1664525) + 1013904223) >>> 0;return value / 4294967296;};
}

/** 一次演出。token 必须属于活动画布；start/stop 不更新任何文档。 */
export class UltimatePresentation {
  constructor({token, moveName, preset, seed, reduced = false, onClose, onFinish}) {
    this.token = token;this.moveName = moveName;this.preset = preset;
    this.reduced = Boolean(reduced);this.onFinish = onFinish;this.abort = new AbortController();
    const random = seededRandom(seed);
    this.particles = Array.from({length: this.reduced ? 60 : 640}, () => ({
      u: random(), v: random(), angle: random() * TAU, radius: .12 + random() * .7,
      depth: random(), speed: .3 + random() * .7, size: .5 + random() * 1.5, phase: random() * TAU
    }));
    // 中点细分生成电弧骨架，再从主干分叉。固定骨架比逐帧随机折线更有连续性。
    this.bolts = Array.from({length: 7}, () => {
      let points = [{q: 0, d: 0}, {q: 1, d: 0}];
      for (let level = 0; level < 6; level++) {
        const subdivided = [points[0]];
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1], b = points[i];
          subdivided.push({q: (a.q + b.q) / 2, d: (a.d + b.d) / 2 + (random() - .5) * .26 * .61 ** level}, b);
        }
        points = subdivided;
      }
      return points;
    });
    this.forks = this.bolts.map(() => Array.from({length: 10}, () => ({
      index: 8 + Math.floor(random() * 46), reach: .08 + random() * .18, side: random() > .5 ? 1 : -1,
      skeleton: Math.floor(random() * 7)
    })));
    this.beats = recoilBeats(preset.id);
    this.root = document.createElement("div");this.root.className = "xjzl-ultimate-effects";
    this.root.dataset.preset = preset.id;this.root.style.setProperty("--ultimate-accent", preset.accent);
    this.surface = document.createElement("canvas");this.surface.className = "xjzl-ultimate-field";
    this.surface.setAttribute("aria-hidden", "true");
    this.shade = document.createElement("div");this.shade.className = "xjzl-ultimate-shade";
    this.identity = document.createElement("div");this.identity.className = "xjzl-ultimate-identity";
    this.portrait = document.createElement("div");this.portrait.className = "xjzl-ultimate-portrait";
    const copy = document.createElement("div");copy.className = "xjzl-ultimate-copy";
    const label = document.createElement("div");label.className = "xjzl-ultimate-label";
    label.textContent = game.i18n.localize("XJZL.UltimateEffects.Label");
    this.name = document.createElement("div");this.name.className = "xjzl-ultimate-name";this.name.textContent = moveName;
    const actorName = document.createElement("div");actorName.className = "xjzl-ultimate-actor";
    actorName.textContent = token.actor?.name || token.name || "";
    copy.append(label, this.name, actorName);this.identity.append(this.portrait, copy);
    this.close = document.createElement("button");this.close.type = "button";this.close.className = "xjzl-ultimate-close";
    this.close.textContent = game.i18n.localize("XJZL.UltimateEffects.Close");
    this.close.addEventListener("click", onClose, {signal: this.abort.signal});
    this.root.append(this.shade, this.surface, this.identity, this.close);
    const image = token.actor?.img;
    if (image) {
      const backdrop = document.createElement("img");backdrop.className = "xjzl-ultimate-portrait-backdrop";
      backdrop.alt = "";backdrop.setAttribute("aria-hidden", "true");backdrop.src = image;
      const foreground = document.createElement("img");foreground.className = "xjzl-ultimate-portrait-image";
      foreground.alt = token.actor?.name || "";
      foreground.addEventListener("error", () => this.identity.classList.add("no-portrait"), {once: true, signal: this.abort.signal});
      foreground.src = image;this.portrait.append(backdrop, foreground);
    } else this.identity.classList.add("no-portrait");
  }

  /** offset 只补偿网络延迟；材质按需创建，随后共享，不持有 Actor/Token 引用。 */
  start(offset = 0) {
    this.board = canvas.app?.view;
    if (!this.board?.getBoundingClientRect) throw new Error("画布视图不可用。");
    document.body.append(this.root);this.context = this.surface.getContext("2d");
    if (!this.context) throw new Error("无法创建绝招演出画布。");
    this.materials = getUltimateMaterials();this.resize();
    this.startRecoil();
    this.resizeObserver = new ResizeObserver(() => this.resize());this.resizeObserver.observe(this.board);
    const sidebar = document.getElementById("sidebar");if (sidebar) this.resizeObserver.observe(sidebar);
    window.addEventListener("resize", () => this.resize(), {signal: this.abort.signal});
    this.startedAt = performance.now() - clamp(offset, 0, this.preset.duration);
    this.frame = requestAnimationFrame(now => this.tick(now));
  }

  /** 资源清理幂等；结束回调只执行一次，缓存材质没有活动监听或时间轴。 */
  stop() {
    if (this.stopped) return;
    this.stopped = true;cancelAnimationFrame(this.frame);this.resizeObserver?.disconnect();this.abort.abort();
    for (const motion of this.recoil || []) motion.cancel();
    for (const image of this.portrait.querySelectorAll("img")) image.removeAttribute("src");
    this.root.remove();this.onFinish?.();
  }

  /** 保持最多约两百万像素；身份画幅随侧栏宽度变化，不修改核心定位。 */
  resize() {
    if (this.stopped) return;
    // 读布局时暂时撤销本演出的 CSS 位移，防止窗口缩放把屏幕反冲累计进布局原点。
    const motion = this.recoil?.[0], at = motion?.currentTime;
    if (motion) motion.currentTime = 0;
    const rect = this.board.getBoundingClientRect();
    if (motion) motion.currentTime = at;
    this.width = Math.max(1, rect.width);this.height = Math.max(1, rect.height);this.span = Math.hypot(this.width, this.height);
    this.unit = clamp(Math.min(this.width / 1600, this.height / 900), .4, 1.5);
    this.ratio = Math.min(globalThis.devicePixelRatio || 1, 1.5, 1920 / this.width, 1080 / this.height);
    Object.assign(this.root.style, {left: rect.left + "px", top: rect.top + "px", width: this.width + "px", height: this.height + "px"});
    this.surface.width = Math.round(this.width * this.ratio);this.surface.height = Math.round(this.height * this.ratio);
    let available = this.width;
    const sidebar = document.getElementById("sidebar");
    if (sidebar) {
      const bounds = sidebar.getBoundingClientRect();
      if (bounds.width > 120 && bounds.left > rect.left + this.width * .45) available = Math.min(available, bounds.left - rect.left);
    }
    this.available = available;this.identityX = available / 2;
    this.root.style.setProperty("--ultimate-center", this.identityX + "px");
    const frameWidth = Math.max(200, Math.min(1020, available - 160));
    this.root.style.setProperty("--ultimate-width", frameWidth + "px");
    this.root.style.setProperty("--ultimate-unit", String(this.unit));
    const chars = Array.from(this.moveName), split = chars.length > 8, mid = Math.ceil(chars.length / 2);
    this.name.textContent = split ? chars.slice(0, mid).join("") + "\n" + chars.slice(mid).join("") : chars.join("");
    const textWidth = frameWidth - clamp(this.width * .18, 100, 220) - 110;
    this.name.style.fontSize = Math.max(16, Math.min(split ? 88 : 146, textWidth / Math.max(4, split ? mid : chars.length) * .9)) + "px";
  }

  /** 隐藏标签页仍按真实时间结束；失效 Token、切场景或绘制失败均立即清理。 */
  tick(now) {
    if (this.stopped) return;
    const time = now - this.startedAt;
    if (!canvas.ready || this.token.destroyed || this.token.document?.parent !== canvas.scene
      || (!this.token.visible && !game.user.isGM) || time >= this.preset.duration) return this.stop();
    try {
      if (!document.hidden) this.draw(time);
      this.frame = requestAnimationFrame(next => this.tick(next));
    } catch (error) {
      console.error("XJZL | 绘制绝招演出失败，已清理演出图层。", error);this.stop();
    }
  }

  /** 前段居中展示，收束前移向实时 Token 投影；释放原点不钳制到屏幕内或侧栏边缘。 */
  draw(time) {
    const point = canvas.stage.worldTransform.apply(this.token.center), screen = canvas.app.renderer.screen;
    this.targetX = point.x * this.width / screen.width;this.targetY = point.y * this.height / screen.height;
    const binding = this.reduced ? 0 : smooth(phase(time, 2650, 3900));
    this.cx = mix(this.identityX, this.targetX, binding);this.cy = mix(this.height * .48, this.targetY, binding);
    for (const motion of this.recoil || []) motion.currentTime = time;
    const ctx = this.context;ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);ctx.clearRect(0, 0, this.width, this.height);
    this.root.style.opacity = String(pulse(time, 0, 320, 6300, 6800));
    this.shade.style.opacity = String(this.reduced ? pulse(time, 0, 850, 5200, 6500) * .18
      : clamp(pulse(time, 0, 850, 5200, 6500) * .62 + pulse(time, 3550, 3960, 4170, 4450) * .37));
    this.root.style.setProperty("--ultimate-bars", String(this.reduced ? 0 : pulse(time, 80, 700, 5150, 6500)));
    const entered = ease(phase(time, 980, 1500)), exited = smooth(phase(time, 3050, 3520));
    this.identity.style.opacity = String(pulse(time, 980, 1500, 3050, 3520));
    this.identity.style.transform = "translate(-50%,-50%) translateX(" + (this.reduced ? 0 : (1 - entered) * 54 - exited * 18) + "px)";
    this.identity.style.setProperty("--ultimate-reveal", String(this.reduced ? 1 : entered));
    this.identity.style.setProperty("--ultimate-exit", String(exited));
    if (this.reduced) return this.drawReduced(time);
    const age = time - IMPACT;
    this.drawCinematic(time, age);
    if (this.preset.id === "sakura") this.drawSakura(time, age);
    else if (this.preset.id === "ink") this.drawInk(time, age);
    else if (this.preset.id === "thunder") this.drawThunder(time, age);
    else this.drawStars(time, age);
    this.drawMotes(time, age);
  }


  /** 用可取消的叠加动画同时移动战场画布与特效；不写核心 transform 或相机状态。 */
  startRecoil() {
    if (this.reduced) return;
    if (typeof this.board.animate !== "function") {
      console.warn("XJZL | 当前浏览器不支持屏幕反冲动画，保留粒子与光影演出。");return;
    }
    const keyframes = [];
    for (let time = 0; time <= this.preset.duration; time += 20) {
      const {x, y} = recoilOffset(this.beats, time, this.unit);
      keyframes.push({offset: time / this.preset.duration, translate: x.toFixed(3) + "px " + y.toFixed(3) + "px"});
    }
    this.recoil = [];
    // 独立 translate 可与核心定位及其他动画合成；cancel 会自动撤销，不需要回写旧样式。
    for (const element of [this.board, this.surface]) {
      const motion = element.animate(keyframes, {duration: this.preset.duration, composite: "add", fill: "none", id: "xjzl-ultimate-recoil"});
      this.recoil.push(motion);motion.pause();motion.currentTime = 0;
    }
  }

  /** 樱花使用黑场，其他主题保持静默、曝光与余光；光敏模式不进入此分支。 */
  drawCinematic(time, age) {
    const ctx = this.context, tint = this.preset.id === "ink" ? "240,229,206" : this.preset.color;
    if (this.preset.id === "sakura") {
      ctx.save();ctx.fillStyle = this.rgba(sakuraBlackout(time), "1,0,5");
      ctx.fillRect(0, 0, this.width, this.height);ctx.restore();return;
    }
    const tension = pulse(time, 3650, 3980, IMPACT, IMPACT + 70);
    ctx.save();ctx.fillStyle = this.rgba(tension * .48, this.preset.id === "sakura" ? "33,5,29" : "2,5,13");
    ctx.fillRect(0, 0, this.width, this.height);
    let exposure = age >= 0 ? Math.exp(-age / 180) * smooth(phase(age, 0, 38)) * .46 : 0;
    if (this.preset.id === "ink") {
      for (const cut of INK_CUTS) if (time >= cut && time < cut + 210) exposure += Math.exp(-(time - cut) / 70) * .32;
    }
    if (this.preset.id === "thunder") {
      for (const fall of THUNDER_FALLS) {
        const elapsed = time - fall - 55;
        if (elapsed >= 0 && elapsed < 320) exposure += Math.exp(-elapsed / 110) * .35;
      }
      if (age >= 660) exposure += Math.exp(-(age - 660) / 160) * .3;
    }
    ctx.fillStyle = this.rgba(Math.min(.58, exposure), tint);ctx.fillRect(0, 0, this.width, this.height);
    if (age >= 0 && age < 1300) {
      const envelope = (1 - smooth(phase(age, 280, 1300))) * smooth(phase(age, 0, 50));
      this.halo(this.cx, this.cy, (190 + age * .15) * this.unit, envelope * .35, .6);
    }
    ctx.restore();
  }

  rgba(alpha, color = this.preset.color) {return "rgba(" + color + "," + clamp(alpha) + ")";}

  /** 预烘焙纹理缩放与合成；亮部、体积层和前景散焦分别控制，不做全屏白闪。 */
  sprite(image, x, y, width, height, rotation, alpha, blend = "source-over") {
    if (alpha <= 0) return;
    const ctx = this.context;ctx.save();ctx.globalAlpha = clamp(alpha);ctx.globalCompositeOperation = blend;
    ctx.translate(x, y);ctx.rotate(rotation);ctx.drawImage(image, -width / 2, -height / 2, width, height);ctx.restore();
  }

  /** 半透明气团与高亮核心分别绘制；光晕只覆盖局部，保留战场和标题的对比。 */
  halo(x, y, radius, alpha, stretch = 1) {
    this.sprite(this.materials.glow[this.preset.id], x, y, radius * 2, radius * 2 * stretch, 0, alpha, "lighter");
  }

  /** 沿曲线建立有厚度和尖端的带状网格，不能用恒宽圆弧替代主气流。 */
  ribbon(points, width, alpha, color = this.preset.color, bright = false) {
    if (alpha <= 0 || points.length < 3) return;
    const ctx = this.context, left = [], right = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
      const taper = Math.sin(i / (points.length - 1) * Math.PI) ** .8;
      const half = width * taper * (.38 + .12 * Math.sin(i * .23)) / 2;
      left.push({x: points[i].x - dy / length * half, y: points[i].y + dx / length * half});
      right.push({x: points[i].x + dy / length * half, y: points[i].y - dx / length * half});
    }
    ctx.save();ctx.globalCompositeOperation = bright ? "lighter" : "source-over";
    const light = ctx.createLinearGradient(points[0].x, points[0].y, points.at(-1).x, points.at(-1).y);
    light.addColorStop(0, this.rgba(0, color));light.addColorStop(.35, this.rgba(alpha * .35, color));
    light.addColorStop(.75, this.rgba(alpha, color));light.addColorStop(1, this.rgba(0, color));ctx.fillStyle = light;
    ctx.beginPath();ctx.moveTo(left[0].x, left[0].y);
    for (const p of left) ctx.lineTo(p.x, p.y);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.moveTo(left[0].x, left[0].y);for (const p of left) ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = this.rgba(alpha * .6, bright ? "239,247,223" : color);ctx.lineWidth = .75 * this.unit;ctx.stroke();ctx.restore();
  }

  /** 各主题的碎片先围绕中央流动，再收至实时 Token；临界静默时半径必须为零。 */
  windPoint(p, time, offset = 0) {
    const gather = smooth(phase(time, 2820, 4060)), age = Math.max(0, time - IMPACT);
    const angle = p.angle + Math.min(time, 3980) * .00024 * p.speed + gather * 2.7 + offset;
    const radius = p.radius * this.span * .66 * (1 - gather) + age * (.5 + p.v * 1.2);
    return {x: this.cx + Math.cos(angle) * radius, y: this.cy + Math.sin(angle) * radius * (.46 + p.depth * .27), angle, radius};
  }


  /** 余波从施术 Token 向外穿过战场，亮沿与宽光壁分开，不影响相机与文档。 */
  shockwave(age, alpha, color = this.preset.color) {
    if (age < 0 || alpha <= 0) return;
    const r = (20 + (1 - Math.exp(-age / 480)) * this.span * .75) * this.unit;
    const points = [];
    for (let i = 0; i <= 100; i++) {
      const a = i / 100 * TAU;
      points.push({x: this.cx + Math.cos(a) * r, y: this.cy + Math.sin(a) * r * .58});
    }
    this.ribbon(points, 48 * this.unit, alpha * .24, color, true);
    this.ribbon(points, 3 * this.unit, alpha * .85, color, true);
  }

  /** 花雨归拢到 Token 后转为近景飞散；黑场中的斩击落在整个画面，不形成定向花瓣喷流。 */
  drawSakura(time, age) {
    const gather = smooth(phase(time, 2800, 4060)), blackout = sakuraBlackout(time);
    const strength = pulse(time, 0, 700, 5500, 6700);
    if (age < 0) for (let i = 0; i < 5; i++) {
      const p = this.particles[i], angle = p.angle + Math.min(time, 3990) * .00017;
      this.sprite(this.materials.rose, this.cx + Math.cos(angle) * this.width * .25 * (1 - gather), this.cy + Math.sin(angle) * this.height * .25 * (1 - gather),
        this.span * .65, this.height * .25, angle - .6, strength * .17 * (1 - gather), "lighter");
    }
    const clock = age < 0 ? Math.min(time, 3980) : time;
    for (let layer = 0; layer < 3; layer++) for (const [index, p] of this.particles.entries()) {
      if (Math.floor(p.depth * 3) !== layer) continue;
      const fallTime = Math.min(time, 2800), speed = .028 + p.depth * .065;
      const fx = (p.u * (this.width + 180) + fallTime * speed * .65 + Math.sin(clock * .0005 + p.phase) * 40) % (this.width + 180) - 90;
      const fy = (p.v * (this.height + 160) + fallTime * speed) % (this.height + 160) - 80;
      const angle = Math.atan2(fy - this.cy, fx - this.cx) + gather * (2.5 + p.depth);
      const radius = Math.hypot(fx - this.cx, fy - this.cy) * (1 - gather);
      let x = mix(fx, this.cx + Math.cos(angle) * radius, gather), y = mix(fy, this.cy + Math.sin(angle) * radius * .7, gather);
      const launch = Math.max(0, age - 70 - p.u * 130);
      if (age >= 0) {
        // 深度展开把花瓣送到镜头前；各方位都保留，避免收招变成一束水平喷射。
        const a = p.angle + launch * .0008 * (p.v - .5), r = launch * (.55 + p.depth * 1.65) * this.unit;
        x = this.cx + Math.cos(a) * r;y = this.cy + Math.sin(a) * r * .78;
      }
      const size = (6 + p.depth ** 3 * 45) * p.size * this.unit
        * (age < 0 ? 1 - gather * .86 : .16 + 1.6 * ease(phase(launch, 0, 360)));
      const flip = .2 + Math.abs(Math.sin(clock * .0011 * p.speed + p.phase)) * .8;
      const image = layer === 2 && index % 4 === 0 ? this.materials.petals[3] : this.materials.petals[index % 3];
      const alpha = age < 0 ? (1 - gather * .68) * (1 - blackout * .96) : pulse(age, 70, 180, 920, 1750);
      this.sprite(image, x, y, size, size * flip, p.phase + clock * .00045 * p.speed,
        strength * (.42 + p.depth * .5) * alpha);
    }
    if (age < 0) this.halo(this.cx, this.cy, (80 + gather * 120) * this.unit,
      gather * strength * .55 * (1 - blackout * .99), .55);
    else this.screenSlash(age);
  }

  /** 黑场后的一次屏幕斩击：刃光快速描过全画幅，粉色宽余光与细白刃口分别衰减。 */
  screenSlash(age) {
    const sweep = ease(phase(age, 75, 215)), alpha = 1 - smooth(phase(age, 320, 1190));
    if (sweep <= 0 || alpha <= 0) return;
    const points = [];
    for (let j = 0; j <= 80; j++) {
      const q = j / 80 * sweep, x = (q - .5) * this.available * 1.48;
      points.push({x: this.identityX + x, y: this.height * .48 - x * .45 + Math.sin(q * Math.PI) * this.height * .055});
    }
    this.ribbon(points, 66 * this.unit, alpha * .22, "229,111,172", true);
    this.ribbon(points, 12 * this.unit, alpha * .8, "255,218,232", true);
    this.ribbon(points, 2.1 * this.unit, alpha, "255,253,248", true);
    // 刃口抵达的位置才出现闪光，不能在施术者身上叠加一个被击中的光爆。
    const head = points.at(-1), glint = alpha * (1 - smooth(phase(age, 190, 440)));
    this.halo(head.x, head.y, 155 * this.unit, glint * .6, .1);
  }

  /** 墨痕有迅速落笔、停留和枯笔边缘，逐道触发反冲；中心就是传入的施术投影。 */
  inkStrike(index, x, y, elapsed, alpha, scale = 1) {
    if (elapsed < 0 || alpha <= 0) return;
    const angles = [-.55, .4, -1.12, .73, -.18], a = angles[index % 5];
    const length = this.span * .83 * ease(phase(elapsed, 0, 120)) * scale, width = (110 + index % 3 * 40) * this.unit;
    this.sprite(this.materials.brush, x, y, length * 2, width * 1.9, a, alpha);
    const points = [];
    for (let j = 0; j <= 64; j++) {
      const q = j / 64, along = (q - .5) * length * 2;
      const edge = Math.sin(q * Math.PI) * (Math.sin(j * .71 + index) * 8 + Math.sin(j * .23 + index) * 15) * this.unit;
      points.push({x: x + Math.cos(a) * along - Math.sin(a) * edge, y: y + Math.sin(a) * along + Math.cos(a) * edge});
    }
    this.ribbon(points, width * .8, alpha * .76, "1,5,10");
    this.ribbon(points.slice(18, 49), 1.3 * this.unit, alpha * .3, "209,181,119", true);
    for (let i = 0; i < 18; i++) {
      const p = this.particles[index * 23 + i], along = (p.u - .5) * length * 1.85;
      this.sprite(this.materials.ink, x + Math.cos(a) * along - Math.sin(a) * width * (p.v - .5),
        y + Math.sin(a) * along + Math.cos(a) * width * (p.v - .5), (70 + p.depth * 140) * this.unit, width * .9,
        a + (p.v - .5) * .8, alpha * .55);
    }
  }

  /** 五道枯笔逐次落下，薄墨雾与笔屑归拢后爆开；释放阶段不再交叉落笔。 */
  drawInk(time, age) {
    const gather = smooth(phase(time, 2940, 4060)), strength = pulse(time, 0, 700, 5700, 6750);
    if (age < 0) {
      for (let i = 0; i < INK_CUTS.length; i++) {
        const x = this.cx + (i % 2 ? -.14 : .12) * this.width * (1 - gather);
        const y = this.cy + (i - 2) * this.height * .095 * (1 - gather);
        this.inkStrike(i, x, y, time - INK_CUTS[i], strength * (1 - gather), 1 - gather);
      }
    } else this.inkBurst(age);
    for (let i = 0; i < 260; i++) {
      const p = this.particles[i], point = this.windPoint(p, time);
      const scale = this.unit * (age < 0 ? 1 - gather * .94 : .6 + .4 * ease(phase(age, 0, 220)));
      const alpha = strength * (age < 0 ? 1 - gather * .7 : 1 - smooth(phase(age, 550, 1550)));
      // 大片薄雾与极细枯笔分开：碎片读作书写材料，不出现悬浮黑色石块。
      if (i < 54) this.sprite(this.materials.ink, point.x, point.y, (160 + p.depth * 210) * scale,
        (40 + p.depth * 70) * scale, point.angle + p.phase * .12, alpha * .23);
      else this.sprite(this.materials.brush, point.x, point.y, (18 + p.depth * 56) * scale,
        (2 + p.depth * 3) * scale, point.angle + .2 * Math.sin(p.phase + time * .0008), alpha * .48);
    }
  }

  /** 一次由内向外的墨雾浪头，留出中央空隙；纸白余光用于衬出黑墨而非新增斩线。 */
  inkBurst(age) {
    const alpha = smooth(phase(age, 0, 75)) * (1 - smooth(phase(age, 500, 1550)));
    if (alpha <= 0) return;
    const radius = (1 - Math.exp(-age / 470)) * this.span * .72;
    this.halo(this.cx, this.cy, (180 + age * .28) * this.unit, alpha * .58, .65);
    for (let i = 0; i < 32; i++) {
      const p = this.particles[i], angle = i / 32 * TAU + p.phase * .09;
      const r = radius * (.82 + p.u * .24), size = (100 + p.depth * 240) * this.unit * ease(phase(age, 0, 160));
      this.sprite(this.materials.ink, this.cx + Math.cos(angle) * r, this.cy + Math.sin(angle) * r * .65,
        size * 1.8, size * (.45 + p.v * .35), angle + Math.PI / 2, alpha * .85);
      if (i % 4 === 0) this.sprite(this.materials.brush, this.cx + Math.cos(angle) * r * 1.12,
        this.cy + Math.sin(angle) * r * .73, size * 1.3, size * .055, angle, alpha * .65);
    }
    this.shockwave(age - 80, alpha * .25, "227,207,160");
  }

  /** 光核和软辉光沿固定分形路径绘制；支脉从真实主干节点生长，并再分出细枝。 */
  lightning(index, from, to, alpha, growth = 1, width = 1) {
    if (alpha <= 0 || growth <= 0) return;
    const ctx = this.context, skeleton = this.bolts[index % 7], dx = to.x - from.x, dy = to.y - from.y;
    const points = skeleton.filter(p => p.q <= growth).map(p => ({x: from.x + dx * p.q - dy * p.d, y: from.y + dy * p.q + dx * p.d}));
    if (points.length < 2) return;
    const stroke = (line, thickness, intensity) => {
      for (const layer of [{scale: 6, alpha: .065}, {scale: 2.2, alpha: .22}, {scale: 1, alpha: .95}]) {
        ctx.strokeStyle = this.rgba(intensity * layer.alpha, layer.scale === 1 ? "242,247,255" : "137,172,255");
        ctx.lineWidth = thickness * layer.scale * this.unit;ctx.beginPath();ctx.moveTo(line[0].x, line[0].y);
        for (let j = 1; j < line.length; j++) ctx.lineTo(line[j].x, line[j].y);ctx.stroke();
      }
    };
    ctx.save();ctx.globalCompositeOperation = "lighter";ctx.lineJoin = "round";ctx.lineCap = "round";
    stroke(points, 2.1 * width, alpha);
    for (const fork of this.forks[index % 7]) {
      const root = skeleton[fork.index];if (root.q > growth) continue;
      const x = from.x + dx * root.q - dy * root.d, y = from.y + dy * root.q + dx * root.d;
      const bx = dx * fork.reach + dy * fork.reach * fork.side * .82;
      const by = dy * fork.reach - dx * fork.reach * fork.side * .82;
      const branch = this.bolts[fork.skeleton].filter(p => p.q <= clamp((growth - root.q) * 5)).map(p => ({
        x: x + bx * p.q - by * p.d, y: y + by * p.q + bx * p.d
      }));
      if (branch.length < 2) continue;
      stroke(branch, .78 * width, alpha * .55);
      if (branch.length > 26) {
        const joint = branch[22], twig = [];
        for (let j = 0; j < 12; j++) {
          const q = j / 11, bend = this.bolts[(fork.skeleton + 2) % 7][j * 5].d;
          twig.push({x: joint.x + bx * q * .36 + by * q * .24 + by * bend * .6,
            y: joint.y + by * q * .36 - bx * q * .24 - dx * bend * .12});
        }
        stroke(twig, .35 * width, alpha * .35);
      }
    }
    ctx.restore();
  }

  /** 落雷由屏幕上沿逐道击下，与曝光/反冲共用击点；后段保留 Token 白热回击。 */
  drawThunder(time, age) {
    const gather = smooth(phase(time, 2840, 4060)), energy = pulse(time, 0, 900, 5750, 6700);
    for (let i = 0; i < 9; i++) {
      const p = this.particles[i], a = p.angle + Math.min(time, 3990) * .00012;
      this.sprite(this.materials.thunder, this.cx + Math.cos(a) * this.width * .3 * (1 - gather),
        this.cy + Math.sin(a) * this.height * .24 * (1 - gather), this.width * .65, this.height * .32, a, energy * .18, "lighter");
    }
    if (age < 0) {
      // 落雷熄灭后仍保留电荷微光，让临界静默中的收束点清晰落在施术者身上。
      for (let i = 0; i < 160; i++) {
        const p = this.particles[i], point = this.windPoint(p, time), size = (4 + p.depth * 8) * this.unit * (1 - gather * .75);
        this.sprite(this.materials.glow.thunder, point.x, point.y, size, size, 0, energy * (.18 + p.depth * .3), "lighter");
      }
      for (const [i, fall] of THUNDER_FALLS.entries()) {
        const elapsed = time - fall;if (elapsed < 0 || elapsed >= 540) continue;
        const p = this.particles[i], x = this.width * (.12 + p.u * .7), y = this.height * (.42 + p.depth * .38);
        const strike = smooth(phase(elapsed, 40, 70)) * (1 - smooth(phase(elapsed, 160, 540)));
        const leader = .2 * (1 - smooth(phase(elapsed, 45, 90)));
        this.lightning(i, {x: x + (p.v - .5) * this.width * .2, y: -this.height * .12}, {x, y},
          energy * (leader + strike), ease(phase(elapsed, 0, 55)), .65 + strike * 2.6);
        this.halo(x, y, (90 + elapsed * .2) * this.unit, strike * .6, .2);
        this.sprite(this.materials.thunder, x, y, this.width * .4, 90 * this.unit, -.15, strike * .35, "lighter");
      }
      this.halo(this.cx, this.cy, 170 * this.unit, gather * .75, .65);
      return;
    }
    const returnStroke = smooth(phase(age, 20, 60)) * (1 - smooth(phase(age, 380, 1100)));
    const echo = age >= 660 ? smooth(phase(age, 660, 700)) * (1 - smooth(phase(age, 880, 1550))) : 0;
    const alpha = Math.max(returnStroke, echo * .7), from = {x: this.cx - this.width * .11, y: Math.min(-80, this.cy - this.height * .95)};
    const leader = .22 * (1 - smooth(phase(age, 50, 220)));
    this.lightning(1, from, {x: this.cx, y: this.cy}, leader + alpha * .8, ease(phase(age, 0, 48)), 1 + alpha * 2.8);
    this.lightning(3, {x: this.cx + this.width * .25, y: Math.min(-30, this.cy - this.height * .8)},
      {x: this.cx, y: this.cy}, alpha * .78, ease(phase(age, 50, 150)), 1.3);
    for (let i = 0; i < 5; i++) {
      const p = this.particles[i + 9], a = p.angle;
      this.lightning(i + 2, {x: this.cx, y: this.cy}, {x: this.cx + Math.cos(a) * this.width * .55, y: this.cy + Math.sin(a) * this.height * .45},
        alpha * .66, ease(phase(age, 70 + i * 12, 250 + i * 12)), .7);
    }
    this.halo(this.cx, this.cy, 480 * this.unit, alpha * .82, .55);
    this.halo(this.cx, this.cy, 200 * this.unit, alpha, .12);
    this.shockwave(age - 90, alpha * .6, "154,186,255");
    for (let i = 0; i < 90; i++) {
      const p = this.particles[i], point = this.windPoint(p, time);
      this.sprite(this.materials.star, point.x, point.y, (10 + p.depth * 18) * this.unit, (10 + p.depth * 18) * this.unit,
        p.angle, energy * alpha * .6, "lighter");
    }
  }

  /** 三维倾斜轨道保持远近关系；收束半径归零，历史尾迹始终使用本帧的实时 Token 原点。 */
  starPoint(p, time, index) {
    const gather = smooth(phase(time, 2830, 4060)), age = Math.max(0, time - IMPACT);
    const a = p.angle + Math.min(time, 3990) * .00016 * p.speed, tilt = (index % 3 - 1) * .76;
    const r = (.1 + p.radius * .56) * this.span * (1 - gather) + age * (.85 + p.depth * 2.1);
    const x = Math.cos(a) * r, y = Math.sin(a) * r, z = y * Math.sin(tilt), perspective = 1100 / (1100 + Math.abs(z) * .35);
    return {x: this.cx + x * perspective, y: this.cy + y * Math.cos(tilt) * .62 * perspective, depth: .5 + Math.sin(a) * .5};
  }

  /** 独立灵剑在全画幅交错穿行；gather 为当前帧的 0..1 收束系数，尾迹随原点一起归零。 */
  starSwordPoint(p, time, gather) {
    const a = p.angle + time * .00155 * (.7 + p.speed), turn = gather * .8;
    const rx = this.available * (.36 + p.u * .21), ry = this.height * (.23 + p.v * .18);
    const x = Math.cos(a) * rx + Math.sin(a * 1.6 + p.phase) * this.available * .08;
    const y = Math.sin(a * 1.19 + p.phase) * ry;
    const dx = -Math.sin(a) * rx + Math.cos(a * 1.6 + p.phase) * this.available * .128;
    const dy = Math.cos(a * 1.19 + p.phase) * ry * 1.19, scale = 1 - gather;
    return {x: this.cx + (x * Math.cos(turn) - y * Math.sin(turn)) * scale,
      y: this.cy + (x * Math.sin(turn) + y * Math.cos(turn)) * scale, angle: Math.atan2(dy, dx) + turn};
  }

  /** 多层灵剑使用原有透光剑形；只保留短暂运动尾迹，不绘制持久阵纹或圆圈。 */
  drawStarSwords(time, gather, strength) {
    const alpha = strength * (1 - smooth(phase(gather, .15, .98)));
    if (alpha <= 0) return;
    const scale = 1 - gather;
    for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 64; i++) {
      const p = this.particles[i];if (Math.floor(p.depth * 3) !== layer) continue;
      const head = this.starSwordPoint(p, time, gather), length = (95 + p.depth * 140) * this.unit * scale;
      const light = alpha * (.35 + p.depth * .45);
      if (i % 2 === 0) {
        // 尾迹只采样最近 80ms；剑群增加时也不会积累成全屏几何图案。
        const tail = [];
        for (let j = 0; j <= 8; j++) tail.push(this.starSwordPoint(p, time - (8 - j) * 10, gather));
        this.ribbon(tail, 1.6 * this.unit, light * .2, "176,207,246", true);
      }
      this.sprite(this.materials.sword, head.x - Math.cos(head.angle) * length * .3, head.y - Math.sin(head.angle) * length * .3,
        length, length * .24, head.angle, light, "lighter");
      if (i % 4 === 0) this.sprite(this.materials.star, head.x, head.y, 24 * this.unit, 24 * this.unit, -.2, light * .5, "lighter");
    }
    for (let stream = 0; stream < 2; stream++) {
      const line = [];
      for (let j = 0; j <= 56; j++) {
        const q = j / 56, x = (q - .5) * this.available * 1.3;
        const y = Math.sin(q * 5.2 + time * .00035 + stream * .9) * this.height * .14 - this.height * (.2 + stream * .1);
        line.push({x: this.cx + x * scale, y: this.cy + y * scale});
      }
      this.ribbon(line, (stream ? 5 : 18) * this.unit, alpha * (stream ? .25 : .1), stream ? "235,212,161" : "137,182,239", true);
    }
  }

  /** 星流与灵剑沉入 Token 星核后，双层光壁和长流星从施术者向外穿过战场。 */
  drawStars(time, age) {
    const gather = smooth(phase(time, 2830, 4060)), strength = pulse(time, 0, 900, 5700, 6750);
    for (let i = 0; i < 8; i++) {
      const p = this.particles[i], a = p.angle + Math.min(time, 3990) * .00008;
      this.sprite(this.materials.stars, this.cx + Math.cos(a) * this.width * .25 * (1 - gather),
        this.cy + Math.sin(a) * this.height * .22 * (1 - gather), this.width * .7, this.height * .44, a, strength * .32, "lighter");
    }
    if (age < 0) this.drawStarSwords(time, gather, strength);
    for (let i = 0; i < 480; i++) {
      const p = this.particles[i], head = this.starPoint(p, time, i);
      const size = (2.6 + head.depth * 6 + p.depth ** 3 * 11) * this.unit * (age < 0 ? 1 - gather * .87 : 1);
      this.sprite(i % 6 ? this.materials.glow.stars : this.materials.star, head.x, head.y, size * 2, size * 2, p.angle,
        strength * (.28 + head.depth * .65) * (age < 0 ? 1 - gather * .65 : 1), "lighter");
      if ((age >= 0 && age > 25) || (age < 0 && i % 11 === 0 && gather < .94)) {
        const points = [];
        for (let j = 0; j < 12; j++) points.push(this.starPoint(p, time - (11 - j) * (age >= 0 ? 18 : 8), i));
        this.ribbon(points, (age >= 0 ? 3 + p.depth ** 3 * 12 : 2) * this.unit, strength * (age >= 0 ? .8 : .3),
          i % 5 ? "166,199,255" : "240,211,153", true);
      }
    }
    this.halo(this.cx, this.cy, (80 + gather * 190) * this.unit,
      gather * strength * .75 * (age < 0 ? 1 : 1 - smooth(phase(age, 0, 220))), .55);
    if (age >= 0) {
      const alpha = 1 - smooth(phase(age, 380, 1450));
      this.shockwave(age, alpha * .9, "195,215,255");this.shockwave(age - 150, alpha * .4, "234,208,151");
      this.halo(this.cx, this.cy, 550 * this.unit, alpha * .5, .07);
      this.halo(this.cx, this.cy, 300 * this.unit, alpha * .22, .55);
      this.sprite(this.materials.star, this.cx, this.cy, 160 * this.unit, 160 * this.unit, -.2, alpha, "lighter");
    }
  }

  /** 极少量前景尘光把主体与战场连起来；近景大小有差异，不均匀铺满画面。 */
  drawMotes(time, age) {
    const alpha = pulse(time, 300, 1000, 5700, 6650) * (this.preset.id === "sakura" ? 1 - sakuraBlackout(time) : 1), ctx = this.context;
    for (let i = this.particles.length - 70; i < this.particles.length; i++) {
      const p = this.particles[i], blast = Math.max(0, age) * .08;
      const x = (p.u * this.width + Math.sin(time * .00025 + p.phase) * 18 + blast) % this.width;
      const y = (p.v * this.height - time * .005 * p.speed + this.height) % this.height;
      if (i % 5 === 0) this.sprite(this.materials.glow[this.preset.id], x, y, (7 + p.depth * 16) * this.unit, (7 + p.depth * 16) * this.unit, 0, alpha * .22, "lighter");
      else {ctx.fillStyle = this.rgba(alpha * (.2 + p.u * .3));ctx.beginPath();ctx.arc(x, y, (.3 + p.depth * .7) * this.unit, 0, TAU);ctx.fill();}
    }
  }

  /** 光敏/减少动态模式保留缓慢微光和身份，不进入任何落雷、剑光或爆发分支。 */
  drawReduced(time) {
    const ctx = this.context, alpha = pulse(time, 0, 900, 5700, 6700) * .25;
    for (const p of this.particles) {
      ctx.fillStyle = this.rgba(alpha);ctx.beginPath();
      ctx.arc(p.u * this.width + Math.sin(time * .0002 + p.phase) * 8, p.v * this.height, p.size * this.unit, 0, TAU);ctx.fill();
    }
  }
}
