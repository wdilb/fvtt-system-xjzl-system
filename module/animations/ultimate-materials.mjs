/** 绝招共用的程序材质。小尺寸纹理只生成一次，避免每帧噪声采样、模糊和渐变分配。 */
let materials;
const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => {const t = clamp(value);return t * t * (3 - 2 * t);};

/** 平滑值噪声；固定整数散列使纹理与客户端随机数无关。 */
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const hash = (a, b) => {
    let n = Math.imul(a, 374761393) + Math.imul(b, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** 分配小纹理；失败明确抛出，由演出管理器隔离，不能以空画布冒充成功。 */
function texture(width, height, paint) {
  const surface = document.createElement("canvas");
  surface.width = width;surface.height = height;
  const context = surface.getContext("2d");
  if (!context) throw new Error("无法创建绝招材质画布。");
  paint(context, width, height);
  return surface;
}

/** 噪声决定体积密度与纸纤维边缘，而非把圆形光斑当作烟气。 */
function densityTexture(kind, color) {
  return texture(kind === "brush" ? 768 : 256, kind === "brush" ? 192 : 128, (ctx, width, height) => {
    const pixels = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = x / width, v = y / height;
      const n = noise(u * 7.5, v * 5.5) * .56 + noise(u * 17, v * 13) * .28 + noise(u * 41, v * 29) * .16;
      let density;
      if (kind === "brush") {
        // 浓墨区域保留整块密度，枯笔在边缘断开；全幅等宽平行纤维会像拉丝金属。
        const warped = v + .11 * noise(u * 6, v * 4) + .05 * Math.sin(u * 14) - .06;
        const edge = Math.sin(u * Math.PI) ** .7;
        const distance = Math.abs(warped - .5);
        const body = clamp((.42 + (n - .5) * .22 - distance) * 12);
        const wet = smooth((noise(u * 7, warped * 9) - .24) * 2.4);
        const fiber = clamp(noise(u * 13, warped * 95) * 1.65 - .42);
        const center = smooth((.27 - distance) * 9);
        density = edge * body * (center * (.52 + wet * .48) + (1 - center) * fiber * wet);
      } else {
        const center = .5 + Math.sin(u * 9 + noise(u * 4, v * 3) * 2) * .1;
        const envelope = Math.exp(-((v - center) ** 2) * (kind === "plume" ? 32 : 13));
        density = Math.sin(u * Math.PI) ** 1.5 * envelope * clamp(n * 1.7 - .28);
        density *= .5 + .5 * Math.sin(u * 27 + v * 8 + n * 11) ** 2;
      }
      const offset = (y * width + x) * 4;
      pixels.data[offset] = color[0];pixels.data[offset + 1] = color[1];pixels.data[offset + 2] = color[2];
      pixels.data[offset + 3] = Math.round(clamp(density) * 255);
    }
    ctx.putImageData(pixels, 0, 0);
  });
}

/** 灵剑只保留透光刃面、光脊和气化剑格；无不透明金属或实体握柄。 */
function sword() {
  return texture(256, 64, ctx => {
    ctx.translate(128, 32);
    const aura = ctx.createLinearGradient(0, -22, 0, 22);
    aura.addColorStop(0, "rgba(126,174,255,0)");aura.addColorStop(.4, "rgba(157,211,255,.08)");
    aura.addColorStop(.5, "rgba(223,249,255,.4)");aura.addColorStop(.6, "rgba(157,211,255,.08)");
    aura.addColorStop(1, "rgba(126,174,255,0)");
    ctx.fillStyle = aura;ctx.beginPath();ctx.moveTo(-120, 0);ctx.quadraticCurveTo(-15, -26, 120, 0);
    ctx.quadraticCurveTo(-15, 26, -120, 0);ctx.fill();
    const blade = ctx.createLinearGradient(-66, 0, 120, 0);
    blade.addColorStop(0, "rgba(153,217,255,.02)");blade.addColorStop(.35, "rgba(174,226,255,.12)");
    blade.addColorStop(.8, "rgba(232,252,255,.28)");blade.addColorStop(1, "rgba(255,255,255,.75)");
    ctx.fillStyle = blade;ctx.beginPath();ctx.moveTo(-66, -6);ctx.lineTo(74, -4);
    ctx.lineTo(120, 0);ctx.lineTo(74, 4);ctx.lineTo(-66, 6);ctx.closePath();ctx.fill();
    ctx.strokeStyle = "rgba(211,245,255,.5)";ctx.lineWidth = .75;ctx.stroke();
    const spine = ctx.createLinearGradient(-115, 0, 120, 0);
    spine.addColorStop(0, "rgba(164,217,255,0)");spine.addColorStop(.5, "rgba(222,247,255,.5)");
    spine.addColorStop(1, "rgba(255,255,255,.95)");
    ctx.strokeStyle = spine;ctx.lineWidth = 1.1;ctx.beginPath();ctx.moveTo(-115, 0);ctx.lineTo(119, 0);ctx.stroke();
    ctx.strokeStyle = "rgba(170,226,255,.32)";ctx.lineWidth = 1;
    ctx.beginPath();ctx.moveTo(-80, -14);ctx.quadraticCurveTo(-69, 0, -58, 2);
    ctx.moveTo(-80, 14);ctx.quadraticCurveTo(-69, 0, -58, -2);ctx.stroke();
  });
}

/** 带明暗面、叶脉与缺口的花瓣；前景散焦版本预先烘焙，远近层不共享同一剪影。 */
function petal(index, blurred = false) {
  return texture(96, 96, ctx => {
    ctx.translate(48, 48);
    if (blurred) ctx.filter = "blur(3px)";
    const fill = ctx.createLinearGradient(-22, -32, 22, 32);
    fill.addColorStop(0, "#fff3e7");fill.addColorStop(.42, "#f5c6d1");fill.addColorStop(.8, "#d977a3");fill.addColorStop(1, "#b85688");
    ctx.fillStyle = fill;
    ctx.beginPath();ctx.moveTo(0, 30);
    ctx.bezierCurveTo(-38 + index * 3, 2, -26, -33, -5, -28);
    ctx.quadraticCurveTo(0, -23, 4, -30);
    ctx.bezierCurveTo(29, -31, 29 - index * 4, 1, 0, 30);ctx.fill();
    ctx.strokeStyle = "rgba(255,238,225,.52)";ctx.lineWidth = .8;
    ctx.beginPath();ctx.moveTo(0, 27);ctx.quadraticCurveTo(8 - index * 3, 0, 0, -22);ctx.stroke();
    ctx.strokeStyle = "rgba(172,68,117,.2)";
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();ctx.moveTo(1, 17 - i * 9);ctx.quadraticCurveTo(-5, 5 - i * 7, -13, -i * 6);ctx.stroke();
    }
  });
}

/** 光晕使用连续指数衰减，中心与边缘不会出现硬圆圈或方形边界。 */
function glow(color, star = false) {
  return texture(128, 128, ctx => {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,250,228,1)");gradient.addColorStop(.035, "rgba(255,249,234,.96)");
    gradient.addColorStop(.12, "rgba(" + color + ",.6)");gradient.addColorStop(.35, "rgba(" + color + ",.16)");
    gradient.addColorStop(1, "rgba(" + color + ",0)");
    ctx.fillStyle = gradient;ctx.fillRect(0, 0, 128, 128);
    if (star) {
      ctx.translate(64, 64);ctx.fillStyle = "rgba(255,244,214,.8)";
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const angle = i * TAU / 8, r = i % 2 ? 1.4 : (i % 4 ? 13 : 24);
        const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
        if (i) ctx.lineTo(x, y);else ctx.moveTo(x, y);
      }
      ctx.closePath();ctx.fill();
    }
  });
}

/** 返回所有主题共用的有限纹理集，尺寸固定；它们没有 RAF、监听或文档引用。 */
export function getUltimateMaterials() {
  if (materials) return materials;
  materials = {
    sword: sword(),
    rose: densityTexture("plume", [236, 158, 187]),
    ink: densityTexture("cloud", [4, 12, 18]),
    brush: densityTexture("brush", [3, 10, 15]),
    thunder: densityTexture("plume", [140, 187, 240]),
    stars: densityTexture("cloud", [90, 134, 205]),
    glow: {
      qi: glow("194,217,243"), sakura: glow("244,176,194"), ink: glow("219,191,130"),
      thunder: glow("132,186,255"), stars: glow("128,180,255")
    },
    star: glow("228,206,154", true),
    petals: [petal(0), petal(1), petal(2), petal(1, true)]
  };
  return materials;
}
