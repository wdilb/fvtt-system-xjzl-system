/**
 * 脚本交互（ask）管理器：控制者选择、本机/远端纯问答、检定配置中继、终结与清理。
 *
 * 职责边界：只发送问题并收回答案；规则写入、Roll 与后果留在规则执行端。
 * 不承担生命周期远程执行协议、不持久化问答状态；短期状态只服务当前请求
 * 与防重复弹窗，终态记录限量并按 expiresAt 过期回收。
 */

import { xjzlSocket } from "../socket.mjs";
import { openScriptInteractionDialog } from "../applications/script-interaction-dialog.mjs";
import {
  SCRIPT_INTERACTION_QUERY_NAME,
  SCRIPT_INTERACTION_CLOSE_COMMAND,
  SCRIPT_INTERACTION_PROTOCOL_VERSION,
  SCRIPT_INTERACTION_TIMEOUT_MS,
  SCRIPT_INTERACTION_TERMINAL_TTL_MS,
  SCRIPT_INTERACTION_TERMINAL_LIMIT,
  SCRIPT_INTERACTION_STATUS,
  INTERACTION_DECISION,
  resolveInteractionDecision,
  isInteractiveTrigger,
  XJZLScriptInteractionForbiddenError,
  XJZLScriptAbortError,
  getInteractionOwnership,
  isEffectiveOwner,
  resolveInteractionTarget,
  validateInteractionDeadline,
  validateInteractionSpec,
  validateInteractionAnswer,
  validateTestConfigContext,
  buildTestConfigSpec
} from "../utils/script-interaction-policy.mjs";

// 原端等待记录：requestId → { requestId, actorUuid, recipientUserId, remote, abort, cancelWith }
const outboundAsks = new Map();
// 接收端窗口登记：requestId → { requesterUserId, actorUuid, expiresAt, closeRequested, dialog }
const inboundWindows = new Map();
// 接收端终态记录：requestId → 记录到期时间；只用于防重复弹窗，过期回收。
const terminalRecords = new Map();

/* -------------------------------------------- */
/*  沙盒绑定入口（actor.mjs 调用）                */
/* -------------------------------------------- */

/**
 * 为一段脚本创建闭包绑定的 ask 函数；绑定本次宿主、触发器与脚本来源，
 * 不使用全局“当前异步脚本”变量。
 * @param {object} params
 * @param {Actor} params.actor - 宿主 Actor
 * @param {string} params.trigger - 当前触发器（SCRIPT_TRIGGERS 之一）
 * @param {string} params.label - 脚本标签，用于日志定位
 * @param {Document|null} params.source - 脚本来源（Item/AE 等，可为 null）
 * @returns {Function} ask(spec)；passive/calc 返回调用即同步抛错的桩函数
 * @throws {Error} 未知触发器在绑定时立即报错
 */
export function createScriptAsk({ actor, trigger, label, source }) {
  const decision = resolveInteractionDecision(trigger);
  if (!decision) {
    throw new Error(`XJZL | 未知触发器不能绑定脚本交互 [${actor?.name}, ${trigger}, ${label}]`);
  }
  const sourceInfo = buildSourceInfo(source);
  if (decision === INTERACTION_DECISION.FORBIDDEN) {
    const context = { actorName: actor?.name, trigger, label };
    return () => {
      // 同步脚本禁止交互：在调用入口立即同步抛错，不产生 rejected Promise。
      throw new XJZLScriptInteractionForbiddenError(
        `passive/calc 同步脚本禁止交互（ask）[${actor?.name}，${trigger}，${label}]。`
        + `请将交互迁移到 attack/hit 等异步触发器。`,
        context
      );
    };
  }
  return spec => executeAsk({ actor, trigger, label, sourceInfo, decision, spec });
}

/** 序列化脚本来源为普通 JSON；只保留身份字段，不传函数或文档实例。 */
function buildSourceInfo(source) {
  if (!source) return null;
  return {
    uuid: source.uuid ?? null,
    name: source.name ?? null
  };
}

/**
 * 检定配置中继（rollAttributeTest promptTarget: "controller" 的内部入口）：
 * 规则端已算好面板数据，控制者只回手动 bonus/level；Roll、发卡与后果留在规则端。
 * 入口保持同步：passive/calc 与未知触发器在调用入口立即抛错（不产生 rejected Promise），
 * 与沙盒 ask 的禁止交互契约一致；其余情况返回问答 Promise。
 * @param {object} params
 * @param {Actor} params.actor - 检定宿主 Actor
 * @param {string} params.trigger - 当前脚本触发器
 * @param {string} params.label - 脚本标签，用于日志定位
 * @param {Document|null} params.source - 脚本来源（Item/AE 等，可为 null）
 * @param {object} params.check - validateTestConfigContext 形状的面板数据
 * @returns {Promise<{requestId, status, action, values, reason}>}
 *   answered 且 action 为 "roll" 时 values 为 { bonus, level }。
 */
export function promptControllerAttributeTestConfig({ actor, trigger, label, source, check }) {
  const decision = resolveInteractionDecision(trigger);
  if (!decision) {
    throw new Error(`XJZL | 未知触发器不能发起检定配置问询 [${actor?.name}, ${trigger}, ${label}]`);
  }
  if (decision === INTERACTION_DECISION.FORBIDDEN) {
    // 同步脚本禁止交互：与 ask 一致，在调用入口立即同步抛错。
    throw new XJZLScriptInteractionForbiddenError(
      `passive/calc 同步脚本禁止检定交互（promptTarget: "controller"）[${actor?.name}，${trigger}，${label}]。`,
      { actorName: actor?.name, trigger, label }
    );
  }
  const checkResult = validateTestConfigContext(check);
  if (!checkResult.ok) {
    console.warn(`XJZL | 检定配置数据无效 [${actor?.name}, ${trigger}, ${label}]: ${checkResult.reason}`);
    return Promise.resolve(failedResult(null, SCRIPT_INTERACTION_STATUS.ERROR, checkResult.reason));
  }
  const spec = buildTestConfigSpec(checkResult.normalized, {
    roll: game.i18n.localize("XJZL.ScriptInteraction.TestConfig.Roll"),
    bonus: game.i18n.localize("XJZL.ScriptInteraction.TestConfig.Bonus"),
    level: game.i18n.localize("XJZL.ScriptInteraction.TestConfig.Level")
  });
  return executeAsk({
    actor,
    trigger,
    label,
    sourceInfo: buildSourceInfo(source),
    decision,
    spec
  });
}

/** 构造统一的问答结果对象；只有 answered 携带 action/values。 */
function failedResult(requestId, status, reason) {
  return { requestId, status, action: null, values: null, reason };
}

/* -------------------------------------------- */
/*  原端：发起问答                                */
/* -------------------------------------------- */

/**
 * 执行一次问答：按决策归属锁定决策人、生成本协议载荷并等待结果。
 * 当前主动操作者触发器本机决策；宿主控制者触发器按归属顺序选择。
 * 表单类型由声明派生：含 check 块为 attributeTestConfig，否则为 form。
 * @returns {Promise<{requestId, status, action, values, reason}>}
 *   宿主/来源删除时以 XJZLScriptAbortError 拒绝，交由脚本运行器透传。
 */
async function executeAsk({ actor, trigger, label, sourceInfo, decision, spec }) {
  const specCheck = validateInteractionSpec(spec);
  if (!specCheck.ok) {
    console.warn(`XJZL | 脚本交互声明无效 [${actor?.name}, ${trigger}, ${label}]: ${specCheck.reason}`);
    return failedResult(null, SCRIPT_INTERACTION_STATUS.ERROR, specCheck.reason);
  }
  const formType = specCheck.normalized.check ? "attributeTestConfig" : "form";

  const target = resolveInteractionTarget({
    decision,
    ownership: getInteractionOwnership(actor),
    actorUuid: actor.uuid,
    users: [...game.users],
    activeUserId: game.user.id,
    activeGMUserId: game.users.activeGM?.id ?? null
  });
  if (!target.userId) {
    ui.notifications.warn(game.i18n.format("XJZL.ScriptInteraction.ControllerUnavailable", {
      actor: actor.name,
      trigger
    }));
    return failedResult(null, SCRIPT_INTERACTION_STATUS.UNAVAILABLE, target.reason);
  }

  const requestId = foundry.utils.randomID();
  // 跨端截止以各自同步后的 serverTime 表达；两端均不比较对方机器的 Date.now()。
  const expiresAt = game.time.serverTime + SCRIPT_INTERACTION_TIMEOUT_MS;
  const payload = {
    version: SCRIPT_INTERACTION_PROTOCOL_VERSION,
    requestId,
    actorUuid: actor.uuid,
    actorName: actor.name,
    recipientUserId: target.userId,
    requesterUserId: game.user.id,
    trigger,
    source: sourceInfo,
    formType,
    spec: specCheck.normalized,
    expiresAt
  };

  return await new Promise((resolve, reject) => {
    let timer = null;
    let finished = false;
    const record = {
      requestId,
      actorUuid: actor.uuid,
      recipientUserId: target.userId,
      remote: !target.local,
      hostController: decision === INTERACTION_DECISION.HOST_CONTROLLER,
      sourceUuid: sourceInfo?.uuid ?? null,
      localDialog: null,
      abort: null,
      cancelWith: null
    };
    outboundAsks.set(requestId, record);

    // 终结与清理共用一条路径：计时器、窗口与待答记录全部回收；首个终结者生效。
    // 远端问答终结后按职责关闭接收端可能残留的纯 UI 视图；断线取消可抑制通知。
    const settle = (settleFn, arg) => {
      if (finished) return;
      finished = true;
      if (timer !== null) clearTimeout(timer);
      outboundAsks.delete(requestId);
      settleFn(arg);
      if (record.remote && !record.suppressCloseNotify) void notifyCloseUI(record);
    };
    const complete = result => settle(resolve, result);
    const abort = error => settle(reject, error);

    record.abort = error => {
      record.localDialog?.close("cancelled");
      abort(error);
      ui.notifications.warn(game.i18n.localize("XJZL.ScriptInteraction.Aborted"));
    };
    record.cancelWith = (result, { notify = true } = {}) => {
      record.suppressCloseNotify = !notify;
      complete(result);
    };

    // 原端独立计时：渲染器显示的剩余时间不代替真正的超时。
    timer = setTimeout(() => {
      complete(failedResult(requestId, SCRIPT_INTERACTION_STATUS.TIMED_OUT, "deadline"));
    }, Math.max(0, expiresAt - game.time.serverTime));

    void (async () => {
      let answer;
      try {
        if (!record.remote) {
          const dialog = openScriptInteractionDialog(payload, {
            getExternalCloseReason: () => (finished ? "cancelled" : null)
          });
          record.localDialog = dialog;
          answer = await dialog.promise;
        } else {
          const controllerUser = game.users.get(target.userId);
          answer = await controllerUser.query(
            SCRIPT_INTERACTION_QUERY_NAME,
            payload,
            { timeout: SCRIPT_INTERACTION_TIMEOUT_MS }
          );
        }
      } catch (err) {
        if (finished) return;
        console.error(`XJZL | 脚本交互问答失败 [${actor.name}, ${trigger}, ${label}, ${requestId}]:`, err);
        // 远端离线/断线表现为结果而不是中止：决策人不可达时明确返回 unavailable。
        const unreachable = /not active/i.test(String(err?.message ?? err));
        complete(unreachable
          ? failedResult(requestId, SCRIPT_INTERACTION_STATUS.UNAVAILABLE, "controller-unreachable")
          : failedResult(requestId, SCRIPT_INTERACTION_STATUS.ERROR, "transport"));
        return;
      }
      if (finished) return;

      // 迟到答案：截止已过则按超时结案，不重开已终结请求。
      if (game.time.serverTime > payload.expiresAt) {
        complete(failedResult(requestId, SCRIPT_INTERACTION_STATUS.TIMED_OUT, "deadline"));
        return;
      }

      // 网络边界：携带 requestId 的答案必须匹配本次请求（本机窗口答案无此字段）。
      if (answer && typeof answer === "object" && answer.requestId !== undefined && answer.requestId !== requestId) {
        console.warn(`XJZL | 脚本交互答案 requestId 不匹配 [${actor.name}, ${trigger}, ${label}, ${requestId}]`);
        complete(failedResult(requestId, SCRIPT_INTERACTION_STATUS.ERROR, "request-id-mismatch"));
        return;
      }

      const validated = validateInteractionAnswer(answer, payload.spec);
      if (!validated.ok) {
        console.warn(`XJZL | 脚本交互答案校验失败 [${actor.name}, ${trigger}, ${label}, ${requestId}]: ${validated.reason}`);
        complete(failedResult(requestId, SCRIPT_INTERACTION_STATUS.ERROR, validated.reason));
        return;
      }
      if (validated.status !== SCRIPT_INTERACTION_STATUS.ANSWERED) {
        complete({
          requestId,
          status: validated.status,
          action: null,
          values: null,
          reason: validated.reason ?? null
        });
        return;
      }

      // 消费答案前再次确认前提仍成立：宿主与来源存在（按完整文档身份判断，删除竞争在此收口），
      // 宿主控制者决策还要求决策人仍是 GM 或宿主有效 OWNER。
      const host = await fromUuid(record.actorUuid);
      if (finished) return;
      if (!host) {
        abort(new XJZLScriptAbortError(
          `XJZL | 脚本交互宿主已删除，中止余下业务 [${actor.name}, ${trigger}, ${label}, ${requestId}]`,
          { requestId, actorUuid: record.actorUuid, reason: "host-deleted" }
        ));
        return;
      }
      if (record.sourceUuid) {
        const sourceDoc = await fromUuid(record.sourceUuid);
        if (finished) return;
        if (!sourceDoc) {
          abort(new XJZLScriptAbortError(
            `XJZL | 脚本交互来源已删除，中止余下业务 [${actor.name}, ${trigger}, ${label}, ${requestId}]`,
            { requestId, actorUuid: record.actorUuid, reason: "source-deleted" }
          ));
          return;
        }
      }
      if (record.hostController) {
        const controllerUser = game.users.get(record.recipientUserId);
        if (!controllerUser?.isGM && !isEffectiveOwner(getInteractionOwnership(host), controllerUser)) {
          console.warn(`XJZL | 脚本交互决策人权限已失效 [${actor.name}, ${trigger}, ${label}, ${requestId}]`);
          complete(failedResult(requestId, SCRIPT_INTERACTION_STATUS.ERROR, "controller-unauthorized"));
          return;
        }
      }
      complete({
        requestId,
        status: SCRIPT_INTERACTION_STATUS.ANSWERED,
        action: validated.action,
        values: validated.values,
        reason: null
      });
    })().catch(err => {
      // 结账期异常兜底：按 error 结案，避免产生未处理的 Promise rejection。
      console.error(`XJZL | 脚本交互问答结账异常 [${actor.name}, ${trigger}, ${label}, ${requestId}]:`, err);
      complete(failedResult(requestId, SCRIPT_INTERACTION_STATUS.ERROR, "internal"));
    });
  });
}

/**
 * 发送纯 UI 关闭通知；只用于结束已终结请求的接收端窗口，不承载业务数据。
 * 失败仅记录：问答结果已经终结，窗口由接收端自身截止兜底关闭。
 */
async function notifyCloseUI(record) {
  if (!record.remote) return;
  try {
    await xjzlSocket.executeAsUser(SCRIPT_INTERACTION_CLOSE_COMMAND, record.recipientUserId, {
      requestId: record.requestId,
      requesterUserId: game.user.id
    });
  } catch (err) {
    console.warn(`XJZL | 关闭脚本交互窗口通知发送失败 [${record.requestId}]:`, err);
  }
}

/* -------------------------------------------- */
/*  接收端：问答处理与关闭通知                     */
/* -------------------------------------------- */

/**
 * 核心 User.query 处理入口：校验真实发送者、宿主、接收者与载荷，
 * 通过后打开本地窗口并返回答案。每段校验失败都以结构化结果拒绝，不缓存非法载荷。
 * @param {object} payload - 原端发来的普通 JSON 载荷
 * @param {{user: User}} context - 核心注入的查询上下文（真实发送者）
 * @returns {Promise<object>} 结构化答案
 */
async function handleInteractionQuery(payload, context) {
  if (!isPlainObject(payload) || payload.version !== SCRIPT_INTERACTION_PROTOCOL_VERSION) {
    return failedResult(payload?.requestId ?? null, SCRIPT_INTERACTION_STATUS.ERROR, "version-unsupported");
  }
  const requestId = typeof payload.requestId === "string" ? payload.requestId : null;
  if (!requestId) return failedResult(null, SCRIPT_INTERACTION_STATUS.ERROR, "request-id-missing");
  if (payload.recipientUserId !== game.user.id) {
    return failedResult(requestId, SCRIPT_INTERACTION_STATUS.UNAVAILABLE, "not-recipient");
  }
  // 协议校验：截止必须是有限数字且不超出允许期限；缺失或非数字会让剩余时间
  // 变成 NaN，到期条件永不成立，必须在开窗前拒绝。
  const deadlineCheck = validateInteractionDeadline(payload.expiresAt, { now: game.time.serverTime });
  if (!deadlineCheck.ok) {
    return failedResult(requestId, SCRIPT_INTERACTION_STATUS.ERROR, deadlineCheck.reason);
  }
  // 过期先按 expiresAt 拒绝（本端同步 serverTime 判断），不能因缓存淘汰重开窗口。
  if (game.time.serverTime > payload.expiresAt) {
    return failedResult(requestId, SCRIPT_INTERACTION_STATUS.TIMED_OUT, "expired");
  }
  if (!isInteractiveTrigger(payload.trigger)) {
    return failedResult(requestId, SCRIPT_INTERACTION_STATUS.UNAVAILABLE, "trigger-not-interactive");
  }
  // 表单类型白名单：form（普通问询）与 attributeTestConfig（检定配置中继）。
  // check 块只允许出现在检定配置中，普通 form 不携带面板数据。
  if (payload.formType !== "form" && payload.formType !== "attributeTestConfig") {
    return failedResult(requestId, SCRIPT_INTERACTION_STATUS.ERROR, "form-type-unsupported");
  }
  const specCheck = validateInteractionSpec(payload.spec);
  if (!specCheck.ok) {
    return failedResult(requestId, SCRIPT_INTERACTION_STATUS.ERROR, `spec-invalid:${specCheck.reason}`);
  }
  if ((payload.formType === "attributeTestConfig") !== Boolean(specCheck.normalized.check)) {
    return failedResult(requestId, SCRIPT_INTERACTION_STATUS.ERROR, "form-type-mismatch");
  }

  // 以核心传入的真实发送者授权；载荷自称的请求者只做一致性核对。
  const sender = context?.user;
  if (!sender?.id || payload.requesterUserId !== sender.id) {
    return failedResult(requestId, SCRIPT_INTERACTION_STATUS.UNAVAILABLE, "sender-mismatch");
  }
  const actor = await fromUuid(payload.actorUuid);
  if (!actor) return failedResult(requestId, SCRIPT_INTERACTION_STATUS.UNAVAILABLE, "host-missing");
  if (!sender.isGM && !isEffectiveOwner(getInteractionOwnership(actor), sender)) {
    return failedResult(requestId, SCRIPT_INTERACTION_STATUS.UNAVAILABLE, "sender-forbidden");
  }

  // 防重复弹窗：同一请求只开一个本地窗口；已终结的请求不再重开。
  // 终态缓存以“真实请求者＋requestId”为实际键：其他用户抢先写入或覆盖的
  // 记录与本次查询身份不同，不会阻断或误放行。
  if (inboundWindows.has(requestId)) {
    return failedResult(requestId, SCRIPT_INTERACTION_STATUS.CANCELLED, "window-exists");
  }
  if (terminalRecords.has(terminalKey(sender.id, requestId))) {
    return failedResult(requestId, SCRIPT_INTERACTION_STATUS.CANCELLED, "already-settled");
  }

  const record = {
    requesterUserId: sender.id,
    actorUuid: payload.actorUuid,
    expiresAt: payload.expiresAt,
    closeRequested: null,
    dialog: null
  };
  inboundWindows.set(requestId, record);
  try {
    record.dialog = openScriptInteractionDialog(payload, {
      getExternalCloseReason: () => record.closeRequested
    });
    const answer = await record.dialog.promise;
    rememberTerminal(requestId, sender.id, payload.expiresAt);
    const validated = validateInteractionAnswer(answer, specCheck.normalized);
    if (!validated.ok) {
      console.warn(`XJZL | 接收端答案校验失败 [${payload.actorName ?? ""}, ${requestId}]: ${validated.reason}`);
      return failedResult(requestId, SCRIPT_INTERACTION_STATUS.ERROR, validated.reason);
    }
    if (validated.status !== SCRIPT_INTERACTION_STATUS.ANSWERED) {
      return {
        requestId,
        status: validated.status,
        action: null,
        values: null,
        // 透传接收端记录的关闭原因（关窗/截止/断线），便于原端日志定位。
        reason: answer?.reason ?? validated.reason ?? null
      };
    }
    return {
      requestId,
      status: SCRIPT_INTERACTION_STATUS.ANSWERED,
      action: validated.action,
      values: validated.values,
      reason: null
    };
  } finally {
    inboundWindows.delete(requestId);
  }
}

/**
 * socketlib 纯 UI 关闭通知处理：以真实 socket 发送者对照原请求记录，
 * 取消先到的短期记录也按“真实请求者＋requestId”隔离。
 * socketlib 以调用方上下文执行本函数：this.socketdata.userId 即真实发送者。
 */
function handleCloseNotification(payload) {
  const senderId = this?.socketdata?.userId;
  const requestId = payload?.requestId;
  if (typeof senderId !== "string" || typeof requestId !== "string") return;
  const record = inboundWindows.get(requestId);
  if (record) {
    if (record.requesterUserId !== senderId) return;
    record.closeRequested = "cancelled";
    record.dialog?.close("cancelled");
    return;
  }
  // 竞态：关闭通知可能先于本客户端的查询处理到达；以真实发送者身份写入终态键，
  // 稍后到达的同一请求者查询会按“已终结”拒绝，其他用户不受影响也不能覆盖。
  rememberTerminal(requestId, senderId);
}

/** 终态缓存的实际键：真实发送者＋requestId，避免不同发送者互相覆盖。 */
function terminalKey(requesterUserId, requestId) {
  return `${requesterUserId}\u0000${requestId}`;
}

/** 登记接收端终态（实际键为“真实发送者＋requestId”）并回收过期记录；容量超限时淘汰最旧条目。 */
function rememberTerminal(requestId, requesterUserId, expiresAt = game.time.serverTime + SCRIPT_INTERACTION_TERMINAL_TTL_MS) {
  terminalRecords.set(terminalKey(requesterUserId, requestId), expiresAt);
  const now = game.time.serverTime;
  for (const [key, deadline] of terminalRecords) {
    if (deadline + SCRIPT_INTERACTION_TERMINAL_TTL_MS < now) terminalRecords.delete(key);
  }
  while (terminalRecords.size > SCRIPT_INTERACTION_TERMINAL_LIMIT) {
    const oldest = [...terminalRecords.entries()].sort((a, b) => a[1] - b[1])[0];
    terminalRecords.delete(oldest[0]);
  }
}

/* -------------------------------------------- */
/*  钩子：断线取消与宿主删除中止                    */
/* -------------------------------------------- */

/**
 * 注册问答生命周期钩子；在系统 init 时调用。
 */
export function initScriptInteraction() {
  // 仅按真正断线状态取消：userConnected 只在 active 真实变化时触发，
  // 光标、idle、选目标或场景切换等普通 userActivity 不会进入这里。
  Hooks.on("userConnected", (user, connected) => {
    if (connected) return;
    for (const record of [...outboundAsks.values()]) {
      if (record.recipientUserId !== user.id) continue;
      // 接收端整体离线：无需再发送关闭通知。
      record.cancelWith(
        failedResult(record.requestId, SCRIPT_INTERACTION_STATUS.CANCELLED, "recipient-disconnected"),
        { notify: false }
      );
    }
    // 请求端断线：接收端窗口立即关闭并解除等待，不拖到自身截止。
    closeInboundByRequester(user.id);
  });
  // 宿主删除按实际文档身份判断：世界 Actor 按其完整 UUID 匹配。
  Hooks.on("deleteActor", actor => {
    abortOutboundByHostUuid(actor?.uuid, "host-deleted");
  });
  // 非链接 Token 的合成宿主 UUID 携带完整 Token 前缀（Scene.Token.Actor）；
  // 删除其他关联 Token 或其他同源 Token 不会命中该前缀，不误中止当前宿主。
  Hooks.on("deleteToken", token => {
    if (!token?.uuid) return;
    abortOutboundByHostPrefix(`${token.uuid}.`, "host-token-deleted");
  });
  // 来源删除：脚本来源（Item/AE）是本次问询前提，删除即中止原端等待。
  Hooks.on("deleteItem", item => {
    abortOutboundBySourceUuid(item?.uuid, "source-deleted");
  });
  Hooks.on("deleteActiveEffect", effect => {
    abortOutboundBySourceUuid(effect?.uuid, "source-deleted");
  });
}

/** 按完整文档 UUID 中止匹配的原端等待，并同步关闭接收端可能存在的窗口。 */
function abortOutboundByHostUuid(actorUuid, reason) {
  if (!actorUuid) return;
  for (const record of [...outboundAsks.values()]) {
    if (record.actorUuid !== actorUuid) continue;
    record.abort?.(buildHostAbortError(record, reason));
  }
  // 接收端不依赖原端的关闭通知：宿主删除时直接关闭本地窗口。
  closeInboundByHost(actorUuid);
}

/** 按文档 UUID 前缀中止匹配的原端等待（非链接 Token 场景），并同步关闭接收窗口。 */
function abortOutboundByHostPrefix(prefix, reason) {
  for (const record of [...outboundAsks.values()]) {
    if (!record.actorUuid?.startsWith(prefix)) continue;
    record.abort?.(buildHostAbortError(record, reason));
  }
  closeInboundByHostPrefix(prefix);
}

/** 按来源文档 UUID 中止匹配的原端等待。 */
function abortOutboundBySourceUuid(sourceUuid, reason) {
  if (!sourceUuid) return;
  for (const record of [...outboundAsks.values()]) {
    if (record.sourceUuid !== sourceUuid) continue;
    record.abort?.(new XJZLScriptAbortError(
      `XJZL | 脚本交互来源已删除，中止余下业务 [${record.requestId}]`,
      { requestId: record.requestId, actorUuid: record.actorUuid, reason }
    ));
  }
}

/** 请求者断线：关闭其发起的、仍在本客户端等待的窗口。 */
function closeInboundByRequester(requesterUserId) {
  if (!requesterUserId) return;
  for (const record of [...inboundWindows.values()]) {
    if (record.requesterUserId !== requesterUserId) continue;
    record.closeRequested = "cancelled";
    record.dialog?.close("cancelled");
  }
}

/** 宿主删除：按完整 UUID 或 Token 前缀关闭仍等待的接收端窗口。 */
function closeInboundByHost(actorUuid) {
  if (!actorUuid) return;
  for (const record of [...inboundWindows.values()]) {
    if (record.actorUuid !== actorUuid) continue;
    record.closeRequested = "cancelled";
    record.dialog?.close("cancelled");
  }
}

function closeInboundByHostPrefix(prefix) {
  for (const record of [...inboundWindows.values()]) {
    if (!record.actorUuid?.startsWith(prefix)) continue;
    record.closeRequested = "cancelled";
    record.dialog?.close("cancelled");
  }
}

function buildHostAbortError(record, reason) {
  return new XJZLScriptAbortError(
    `XJZL | 脚本交互宿主已删除，中止余下业务 [${record.requestId}]`,
    { requestId: record.requestId, actorUuid: record.actorUuid, reason }
  );
}

/* -------------------------------------------- */
/*  导出汇总                                      */
/* -------------------------------------------- */

export const ScriptInteractionManager = {
  createScriptAsk,
  promptControllerAttributeTestConfig,
  handleInteractionQuery,
  handleCloseNotification
};

/** 是否为无原型链风险的普通对象。 */
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
