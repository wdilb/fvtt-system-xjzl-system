/**
 * 绝招演出管理：发起端选择样式并广播，各客户端独立排队、显示和关闭。
 * 只接收已经通过出招检查的视觉请求，不等待演出，也不参与资源和伤害事务。
 */
import { ULTIMATE_PRESETS, UltimatePresentation } from "../animations/ultimate-presentation.mjs";

const SETTING = "enableUltimateEffects";
const MAX_PENDING = 3;
const seenEvents = new Set();
const pending = [];
let active = null;
let draining = false;
let generation = 0;
let previewDialog = null;

/** 四套演出的统一白名单；旧宏/在途广播的 qi 请求兼容合并后的星流飞剑。 */
function presetFor(id) {
  return ULTIMATE_PRESETS.find(preset => preset.id === (id === "qi" ? "stars" : id));
}

/** 注册本客户端的持久开关、Token 工具栏按钮和画布生命周期清理。 */
export function registerUltimateFxSetting() {
  game.settings.register("xjzl-system", SETTING, {
    name: "XJZL.Settings.UltimateEffects.Name",
    hint: "XJZL.Settings.UltimateEffects.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
    onChange: enabled => {
      if (enabled === false) stopAllUltimateEffects();
      if (ui.controls?.rendered) {
        Promise.resolve(ui.controls.render({reset: true})).catch(error => {
          console.error("XJZL | 刷新绝招演出按钮失败。", error);
        });
      }
    }
  });
  Hooks.on("getSceneControlButtons", controls => {
    const tools = controls.tokens?.tools;
    if (!tools || tools["ultimate-effects"]) return;
    tools["ultimate-effects"] = {
      name: "ultimate-effects",
      title: "XJZL.Settings.UltimateEffects.Name",
      icon: "fa-solid fa-wand-sparkles",
      order: Object.keys(tools).length,
      visible: true,
      toggle: true,
      active: isEnabled(),
      onChange: (_event, enabled) => {
        Promise.resolve(game.settings.set("xjzl-system", SETTING, enabled)).catch(error => {
          console.error("XJZL | 切换绝招演出失败。", error);
        });
      }
    };
  });
  Hooks.on("canvasTearDown", stopAllUltimateEffects);
  Hooks.on("destroyToken", token => {
    if (active?.token === token) stopAllUltimateEffects();
  });
}

/**
 * 出招端广播一次绝招请求；本客户端关闭演出仍允许其他玩家观看。
 * @param {Actor} actor - 施术者，必须在当前画布上有 Token
 * @param {object} move - 本次出招副本；isUltimate 必须为 true
 * @param {object} socket - 已初始化的 socketlib 系统连接
 */
export function queueUltimateEffect(actor, move, socket) {
  try {
    if (!move?.isUltimate || actor?.type === "container" || !canvas?.ready || !socket?.executeForEveryone) return;
    const candidates = actor.isToken ? [actor.token?.object] : actor.getActiveTokens?.() || [];
    const token = candidates.find(t => t?.controlled && t.document?.parent === canvas.scene)
      ?? candidates.find(t => t?.renderable && t.document?.parent === canvas.scene);
    if (!token) return;
    const payload = {
      eventId: foundry.utils.randomID(),
      actorUuid: actor.uuid,
      tokenUuid: token.document.uuid,
      sceneId: canvas.scene.id,
      moveName: String(move.name || "").slice(0, 96),
      preset: ULTIMATE_PRESETS[Math.floor(Math.random() * ULTIMATE_PRESETS.length)].id,
      seed: Math.floor(Math.random() * 0x100000000),
      startedAt: game.time.serverTime
    };
    // 与受击广播一样隔离同步抛错和 RPC 拒绝，不能使已完成的出招变成失败。
    Promise.resolve(socket.executeForEveryone("playUltimateEffect", payload)).catch(error => {
      console.error("XJZL | 广播绝招演出失败。", error);
    });
  } catch (error) {
    console.error("XJZL | 准备绝招演出失败，已跳过视觉反馈。", error);
  }
}

/**
 * Socket 接收入口；同场景事件去重后进入有界队列，隐藏 Token 不显示。
 * @param {object} payload - {eventId, actorUuid, tokenUuid, sceneId, moveName, preset, seed, startedAt}
 */
export function renderUltimateEffect(payload = {}) {
  if (!isEnabled() || !globalThis.canvas?.ready || !isValidPayload(payload)) return;
  if (payload.sceneId !== canvas.scene.id || seenEvents.has(payload.eventId)) return;
  seenEvents.add(payload.eventId);
  if (seenEvents.size > 512) seenEvents.delete(seenEvents.values().next().value);
  if (pending.length >= MAX_PENDING) pending.shift();
  pending.push({...payload, preset: presetFor(payload.preset).id, queued: Boolean(active || draining || pending.length)});
  startNext();
}

/** 关闭当前演出和待播队列；递增代次以阻止 UUID 解析中的晚到请求重新打开。 */
export function stopAllUltimateEffects() {
  generation++;
  pending.length = 0;
  const previous = active;
  active = null;
  previous?.stop();
}

/**
 * 宏的视觉预览入口，不执行 Item.roll、脚本或资源结算。
 * tokenUuid 必须是当前场景中可见且有操作权限的角色 Token；broadcast 默认为仅本机，qi 兼容 stars。
 * @returns {Promise<boolean>} 请求通过校验并发出时返回 true；关闭设置或无效来源返回 false。
 */
export async function playUltimatePreview({tokenUuid, presetId = "stars", moveName, broadcast = false} = {}) {
  try {
    if (!isEnabled()) {
      ui.notifications.warn(game.i18n.localize("XJZL.UltimateEffects.Preview.Disabled"));return false;
    }
    const preset = presetFor(presetId);
    if (!canvas?.ready || !preset || typeof tokenUuid !== "string") return false;
    // 点播直接替换上一场；解析期间再次点播或关闭时，旧请求不能晚到重开。
    stopAllUltimateEffects();
    const epoch = generation;
    const scene = canvas.scene, source = await fromUuid(tokenUuid), token = source?.object;
    if (epoch !== generation || !isEnabled()) return false;
    if (!canvas.ready || canvas.scene !== scene || source?.parent !== scene || !token?.renderable || token.destroyed
      || !token.actor || token.actor.type === "container" || (!token.visible && !game.user.isGM)
      || (!game.user.isGM && !token.actor.isOwner)) {
      ui.notifications.warn(game.i18n.localize("XJZL.UltimateEffects.Preview.NoToken"));return false;
    }
    const payload = {
      eventId: foundry.utils.randomID(), tokenUuid, actorUuid: token.actor.uuid, sceneId: scene.id,
      moveName: String(moveName || game.i18n.localize("XJZL.UltimateEffects.Preview.DefaultMove")).trim().slice(0, 96),
      preset: preset.id, seed: Math.floor(Math.random() * 0x100000000), startedAt: game.time.serverTime
    };
    if (!payload.moveName) return false;
    if (broadcast) {
      if (!game.xjzl?.socket?.executeForEveryone) throw new Error("绝招演出 Socket 尚未就绪。");
      await game.xjzl.socket.executeForEveryone("playUltimateEffect", payload);
    } else renderUltimateEffect(payload);
    return true;
  } catch (error) {
    console.error("XJZL | 预览绝招演出失败。", error);
    ui.notifications.error(game.i18n.localize("XJZL.UltimateEffects.Preview.Failed"));return false;
  }
}

/** 打开可反复点播四种样式的 V14 对话框；默认本机预览，广播须显式勾选。 */
export async function openUltimatePreview() {
  if (!canvas?.ready) return ui.notifications.warn(game.i18n.localize("XJZL.UltimateEffects.Preview.NoToken"));
  const tokens = canvas.tokens.placeables.filter(token => token.actor && token.actor.type !== "container"
    && token.renderable && !token.destroyed && (token.visible || game.user.isGM) && (token.actor.isOwner || game.user.isGM));
  if (!tokens.length) return ui.notifications.warn(game.i18n.localize("XJZL.UltimateEffects.Preview.NoToken"));
  const source = tokens.find(token => token.controlled) || tokens[0];
  const ultimate = Array.from(source.actor.items || []).flatMap(item => item.system?.moves || []).find(move => move.isUltimate);
  if (previewDialog) await previewDialog.close();
  const localize = key => game.i18n.localize("XJZL.UltimateEffects.Preview." + key);
  // DOM 序列化会转义任意 Token/招式名称，避免把角色文本插入对话框 HTML。
  const content = document.createElement("div"), hint = document.createElement("p");
  hint.className = "xjzl-preview-hint";hint.textContent = localize("Hint");content.append(hint);
  const field = (label, control) => {
    const row = document.createElement("div");row.className = "form-group";
    const title = document.createElement("label");title.textContent = label;title.append(control);row.append(title);content.append(row);
  };
  const select = document.createElement("select");select.name = "tokenUuid";
  for (const token of tokens) {
    const option = document.createElement("option");option.value = token.document.uuid;option.textContent = token.name || token.actor.name;
    if (token === source) option.setAttribute("selected", "");select.append(option);
  }
  field(localize("Source"), select);
  const name = document.createElement("input");name.type = "text";name.name = "moveName";
  name.setAttribute("maxlength", "96");name.setAttribute("value", ultimate?.name || localize("DefaultMove"));field(localize("MoveName"), name);
  const broadcast = document.createElement("input");broadcast.type = "checkbox";broadcast.name = "broadcast";field(localize("Broadcast"), broadcast);
  const play = presetId => async (_event, _button, dialog) => playUltimatePreview({
    tokenUuid: dialog.element.querySelector("[name=tokenUuid]").value,
    moveName: dialog.element.querySelector("[name=moveName]").value,
    broadcast: dialog.element.querySelector("[name=broadcast]").checked,
    presetId: presetId || ULTIMATE_PRESETS[Math.floor(Math.random() * ULTIMATE_PRESETS.length)].id
  });
  previewDialog = new foundry.applications.api.DialogV2({
    id: "xjzl-ultimate-preview", classes: ["xjzl-ultimate-preview"],
    window: {title: "XJZL.UltimateEffects.Preview.Title", icon: "fa-solid fa-wand-sparkles"},
    position: {width: 360, left: Math.max(0, window.innerWidth - 380), top: 130},
    form: {closeOnSubmit: false}, content,
    buttons: [
      ...ULTIMATE_PRESETS.map(preset => ({action: preset.id, label: "XJZL.UltimateEffects.Presets." + preset.id, callback: play(preset.id)})),
      {action: "random", label: "XJZL.UltimateEffects.Preview.Random", callback: play()},
      {action: "stop", label: "XJZL.UltimateEffects.Preview.Stop", callback: stopAllUltimateEffects}
    ]
  });
  await previewDialog.render({force: true});return previewDialog;
}

/** 校验网络字段和样式白名单，不把任意输入写进 CSS 或插入 HTML。 */
function isValidPayload(payload) {
  return payload && ["eventId", "actorUuid", "tokenUuid", "sceneId", "moveName"].every(key =>
    typeof payload[key] === "string" && payload[key].length > 0 && payload[key].length <= 256)
    && payload.moveName.length <= 96
    && Boolean(presetFor(payload.preset))
    && Number.isInteger(payload.seed) && payload.seed >= 0 && payload.seed < 0x100000000
    && Number.isFinite(payload.startedAt);
}

/** 设置不可读时按关闭处理；失败属于视觉层，不向业务调用方抛出。 */
function isEnabled() {
  try {
    return game.settings.get("xjzl-system", SETTING) !== false;
  } catch (error) {
    console.warn("XJZL | 绝招演出设置不可读，本次按关闭处理。", error);
    return false;
  }
}

/** 串行解析与播放；场景切换、关闭或 Token 删除期间不会重建已取消的演出。 */
function startNext() {
  if (draining || active || !pending.length || !isEnabled()) return;
  void drainQueue().catch(error => {
    console.error("XJZL | 播放绝招演出失败。", error);
    stopAllUltimateEffects();
  });
}

/** 逐个校验来源 Token；每次异步解析后复核取消代次和当前场景。 */
async function drainQueue() {
  draining = true;
  const epoch = generation;
  try {
    while (pending.length && !active && isEnabled()) {
      const payload = pending.shift();
      const scene = canvas.scene;
      if (!canvas.ready || payload.sceneId !== scene?.id) continue;
      const document = await fromUuid(payload.tokenUuid);
      if (epoch !== generation || !isEnabled() || !canvas.ready || canvas.scene !== scene) return;
      const token = document?.object;
      if (document?.parent !== scene || !token?.renderable || token.destroyed
        || (!token.visible && !game.user.isGM) || token.actor?.uuid !== payload.actorUuid) continue;
      const preset = presetFor(payload.preset);
      // 网络迟到只微调第一场的时间，排队的演出从头播放，避免连续绝招互相叠加。
      const offset = payload.queued ? 0 : Math.max(0, Math.min(700, game.time.serverTime - payload.startedAt));
      const presentation = new UltimatePresentation({
        token, moveName: payload.moveName, preset, seed: payload.seed,
        reduced: canvas.photosensitiveMode === true || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
        onClose: stopAllUltimateEffects,
        onFinish: () => {
          if (active !== presentation) return;
          active = null;
          startNext();
        }
      });
      active = presentation;
      presentation.start(offset);
    }
  } finally {
    draining = false;
    if (!active && pending.length) startNext();
  }
}
