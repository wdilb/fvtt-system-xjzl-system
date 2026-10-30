/**
 * 脚本交互（ask）的决策归属与纯数据校验。
 *
 * 该模块保持无 Foundry 运行时依赖（CONST 除外），可在 Node 回归中直接加载：
 * 控制者解析、spec/答案校验只操作注入的普通对象，不读取 game/ui/canvas。
 * 网络边界与窗口生命周期在 script-interaction-manager 中处理。
 */

/** 核心问答通道名；载荷限普通 JSON。 */
export const SCRIPT_INTERACTION_QUERY_NAME = "xjzl.scriptInteraction";
/** socketlib 纯 UI 关闭通知的处理名。 */
export const SCRIPT_INTERACTION_CLOSE_COMMAND = "scriptInteractionCloseUI";
/** 协议版本；载荷结构变化时递增，接收端拒绝不认识的版本。 */
export const SCRIPT_INTERACTION_PROTOCOL_VERSION = 1;
/** 问答统一截止时间（毫秒）；本机与远端路径共用，按两端各自同步的 serverTime 判断。 */
export const SCRIPT_INTERACTION_TIMEOUT_MS = 60000;
/** 接收端终态记录的保留窗口（毫秒）；只用于防重复弹窗，过期即回收。 */
export const SCRIPT_INTERACTION_TERMINAL_TTL_MS = 10000;
/** 接收端终态记录的容量上限；超出时优先回收已过期条目，再淘汰最旧的记录。 */
export const SCRIPT_INTERACTION_TERMINAL_LIMIT = 64;

/** ask 的终态枚举；只有 answered 的 action/values 可消费。 */
export const SCRIPT_INTERACTION_STATUS = Object.freeze({
  ANSWERED: "answered",
  CANCELLED: "cancelled",
  TIMED_OUT: "timedOut",
  UNAVAILABLE: "unavailable",
  ERROR: "error"
});

/** 决策归属类别。 */
export const INTERACTION_DECISION = Object.freeze({
  /** passive/calc：禁止交互，ask 调用入口立即同步抛错。 */
  FORBIDDEN: "forbidden",
  /** 当前主动操作者（攻击/出招侧触发器）。 */
  ACTIVE_OPERATOR: "activeOperator",
  /** 宿主控制者（防御侧、资源变动与战斗流转触发器）。 */
  HOST_CONTROLLER: "hostController"
});

// 交互归属映射：覆盖 module/data/common.mjs#SCRIPT_TRIGGERS 的全部触发器。
// combatStart/turnStart/turnEnd 的规则执行端在第三步改为活动 GM，决策归属不变。
const DECISION_BY_TRIGGER = Object.freeze({
  passive: INTERACTION_DECISION.FORBIDDEN,
  calc: INTERACTION_DECISION.FORBIDDEN,
  preAttack: INTERACTION_DECISION.ACTIVE_OPERATOR,
  attack: INTERACTION_DECISION.ACTIVE_OPERATOR,
  check: INTERACTION_DECISION.ACTIVE_OPERATOR,
  preDamage: INTERACTION_DECISION.ACTIVE_OPERATOR,
  hit: INTERACTION_DECISION.ACTIVE_OPERATOR,
  hit_once: INTERACTION_DECISION.ACTIVE_OPERATOR,
  avoided: INTERACTION_DECISION.HOST_CONTROLLER,
  preDefense: INTERACTION_DECISION.HOST_CONTROLLER,
  preTake: INTERACTION_DECISION.HOST_CONTROLLER,
  dying: INTERACTION_DECISION.HOST_CONTROLLER,
  death: INTERACTION_DECISION.HOST_CONTROLLER,
  damaged: INTERACTION_DECISION.HOST_CONTROLLER,
  resourceChanged: INTERACTION_DECISION.HOST_CONTROLLER,
  combatStart: INTERACTION_DECISION.HOST_CONTROLLER,
  turnStart: INTERACTION_DECISION.HOST_CONTROLLER,
  turnEnd: INTERACTION_DECISION.HOST_CONTROLLER
});

/**
 * 解析触发器的决策归属；未知触发器返回 null，由内部绑定时报错，不做兜底猜测。
 * @param {string} trigger - SCRIPT_TRIGGERS 中的触发器名
 * @returns {string|null} INTERACTION_DECISION 之一，未知触发器为 null
 */
export function resolveInteractionDecision(trigger) {
  return Object.prototype.hasOwnProperty.call(DECISION_BY_TRIGGER, trigger)
    ? DECISION_BY_TRIGGER[trigger]
    : null;
}

/** 是否为允许交互（可等待 ask）的触发器；passive/calc 与未知触发器均不允许。 */
export function isInteractiveTrigger(trigger) {
  const decision = resolveInteractionDecision(trigger);
  return decision === INTERACTION_DECISION.ACTIVE_OPERATOR
    || decision === INTERACTION_DECISION.HOST_CONTROLLER;
}

/**
 * 同步脚本交互禁止错误：passive/calc 调用 ask 时在入口同步抛出，
 * 不产生 rejected Promise；由同步脚本执行器按普通脚本错误隔离并记录。
 */
export class XJZLScriptInteractionForbiddenError extends Error {
  constructor(message, context = null) {
    super(message);
    this.name = "XJZLScriptInteractionForbiddenError";
    this.scriptContext = context;
  }
}

/**
 * 宿主删除等不可恢复场景的中止错误：经脚本运行器向上透传并停止该宿主余下业务，
 * 与可被脚本正常消费的 cancelled/timedOut 结果明确区分。
 */
export class XJZLScriptAbortError extends Error {
  /**
   * @param {string} message - 面向控制台的完整错误说明
   * @param {object} [detail] - { requestId, actorUuid, reason } 定位信息
   */
  constructor(message, { requestId = null, actorUuid = null, reason = null } = {}) {
    super(message);
    this.name = "XJZLScriptAbortError";
    this.requestId = requestId;
    this.actorUuid = actorUuid;
    this.abortReason = reason;
  }
}

/**
 * 判断错误是否携带可识别的脚本中止身份。
 * 中止可能被伤害入口包装为 XJZLResourceCommitError（附带真实提交状态），
 * 因此除错误名外还接受包装上保留的原始中止错误（scriptAbort）；
 * 不能只判断最外层错误名称，否则嵌套调用的中止会被当成普通脚本错误隔离。
 * @param {unknown} err - 待识别的错误
 * @returns {boolean}
 */
export function isScriptAbortError(err) {
  if (!err || typeof err !== "object") return false;
  return err.name === "XJZLScriptAbortError" || (err.scriptAbort != null && err.scriptAbort.name === "XJZLScriptAbortError");
}

/**
 * 读取交互归属判断使用的有效所有权表：非链接 Token 使用其独立 ownership，
 * 与 Actor#getFirstOwnerId 的口径一致，避免合成 Actor 回落到基础 Actor 的权限。
 * @param {Actor} actor - 宿主 Actor（可为非链接 Token 的合成 Actor）
 * @returns {object} Foundry ownership 表（含可能的 default 条目）
 */
export function getInteractionOwnership(actor) {
  if (actor?.isToken && actor.token && actor.token.actorLink === false && actor.token.ownership) {
    return actor.token.ownership;
  }
  return actor?.ownership ?? {};
}

/**
 * 判断用户对给定所有权表是否具有有效 OWNER 权限（含 default OWNER）；GM 视为 OWNER。
 * @param {object} ownership - getInteractionOwnership 的返回值
 * @param {{id: string, isGM: boolean}} user - 核心 User 或同形测试对象
 * @returns {boolean}
 */
export function isEffectiveOwner(ownership, user) {
  if (!user) return false;
  if (user.isGM) return true;
  const level = ownership?.[user.id] ?? ownership?.default ?? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
  return level >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
}

/**
 * 解析本次 ask 的决策目标；一次请求锁定决策人，发出后不换人或重问。
 * 当前主动操作者触发器：决策人即当前执行端操作者，本机决策不走网络。
 * 宿主控制者触发器顺序：当前在线非 GM 有效 OWNER（本机决策）→ 指定角色
 * （user.character 与宿主一致）匹配的在线 OWNER → 按稳定 user ID 排序的其他
 * 在线 OWNER → 活动 GM → 无可用决策人。
 * @param {object} params
 * @param {string} params.decision - resolveInteractionDecision 的归属类别
 * @param {object} params.ownership - getInteractionOwnership(actor) 的所有权表
 * @param {string} [params.actorUuid] - 宿主完整 UUID，用于 user.character 匹配
 * @param {Array<{id: string, isGM: boolean, active: boolean, character?: {uuid: string}|null}>} params.users
 * @param {string|null} params.activeUserId - 当前执行客户端的用户 ID
 * @param {string|null} params.activeGMUserId - 当前活动 GM 的用户 ID
 * @returns {{userId: string|null, local: boolean, reason: string|null}}
 *   userId 为 null 时 reason 说明不可用原因；local 表示决策人与当前客户端相同，不走网络。
 */
export function resolveInteractionTarget({ decision, ownership, actorUuid, users, activeUserId, activeGMUserId }) {
  // 当前主动操作者：攻击/出招侧触发器的决策人就是正在执行本次动作的操作者。
  if (decision === INTERACTION_DECISION.ACTIVE_OPERATOR) {
    return { userId: activeUserId ?? null, local: true, reason: activeUserId ? null : "no-active-user" };
  }

  const byStableId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const candidates = (users ?? [])
    .filter(user => user.active && !user.isGM && isEffectiveOwner(ownership, user))
    .sort(byStableId);

  // 当前操作用户自己就是在线非 GM 有效 OWNER：本机决策，不走网络。
  const self = candidates.find(user => user.id === activeUserId);
  if (self) return { userId: self.id, local: true, reason: null };

  // 指定角色匹配的在线 OWNER：user.character 绑定宿主时优先询问该玩家，
  // 避免多 OWNER / default OWNER 场景把问题发给无关玩家。
  const designated = candidates.filter(user => user.character?.uuid === actorUuid);
  if (designated.length > 0) return { userId: designated[0].id, local: false, reason: null };

  if (candidates.length > 0) return { userId: candidates[0].id, local: false, reason: null };

  if (activeGMUserId) return { userId: activeGMUserId, local: activeGMUserId === activeUserId, reason: null };
  return { userId: null, local: false, reason: "no-available-controller" };
}

/**
 * 校验问答载荷的截止时间：必须是有限数字，且不超出协议允许的等待期限。
 * 缺失、非数字或明显超期的截止都按协议违规拒绝，不能让 NaN 进入剩余时间计算。
 * @param {unknown} expiresAt - 载荷声称的截止时间（同步 serverTime 毫秒）
 * @param {object} params
 * @param {number} params.now - 本端当前同步 serverTime
 * @param {number} [params.maxWindowMs] - 允许的最长等待窗口，默认统一截止时间
 * @param {number} [params.graceMs] - 生成与接收间的传输宽容量，默认 10 秒
 * @returns {{ok: boolean, reason: string|null}}
 */
export function validateInteractionDeadline(expiresAt, { now, maxWindowMs = SCRIPT_INTERACTION_TIMEOUT_MS, graceMs = 10000 } = {}) {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    return { ok: false, reason: "deadline-not-number" };
  }
  if (expiresAt > now + maxWindowMs + graceMs) {
    return { ok: false, reason: "deadline-too-far" };
  }
  return { ok: true, reason: null };
}

/**
 * 校验 ask 的表单声明并产出只含已知字段的规范化副本。
 * 第一步只支持 integer 字段；select 与检定配置在后续步骤开放。
 * @param {object} spec - 脚本传入的声明 { title, content?, buttons, fields? }
 * @param {object} [options]
 * @param {string[]} [options.allowedFieldTypes=["integer"]] - 当前开放的字段类型
 * @returns {{ok: boolean, reason: string|null, normalized: object|null}}
 */
export function validateInteractionSpec(spec, { allowedFieldTypes = ["integer"] } = {}) {
  if (!isPlainObject(spec)) return invalid("spec-not-object");
  const title = spec.title;
  if (typeof title !== "string" || !title.trim()) return invalid("title-required");
  if (spec.content !== undefined && typeof spec.content !== "string") return invalid("content-type");

  const buttonsInput = spec.buttons;
  if (!Array.isArray(buttonsInput) || buttonsInput.length === 0) return invalid("buttons-required");
  const buttons = [];
  const actions = new Set();
  let defaultCount = 0;
  for (const button of buttonsInput) {
    if (!isPlainObject(button)) return invalid("button-not-object");
    const { action, label, icon, default: isDefault } = button;
    if (typeof action !== "string" || !action.trim()) return invalid("button-action-required");
    if (typeof label !== "string" || !label.trim()) return invalid("button-label-required");
    if (icon !== undefined && typeof icon !== "string") return invalid("button-icon-type");
    if (actions.has(action)) return invalid("button-action-duplicate");
    actions.add(action);
    if (isDefault !== undefined && typeof isDefault !== "boolean") return invalid("button-default-type");
    if (isDefault) defaultCount += 1;
    buttons.push({ action, label, ...(icon !== undefined ? { icon } : {}), ...(isDefault ? { default: true } : {}) });
  }
  if (defaultCount > 1) return invalid("button-default-duplicate");

  const fieldsInput = spec.fields ?? [];
  if (!Array.isArray(fieldsInput)) return invalid("fields-type");
  const fields = [];
  const names = new Set();
  for (const field of fieldsInput) {
    if (!isPlainObject(field)) return invalid("field-not-object");
    const { name, label, type, value, min, max, hint } = field;
    if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return invalid("field-name-invalid");
    if (names.has(name)) return invalid("field-name-duplicate");
    names.add(name);
    if (typeof label !== "string" || !label.trim()) return invalid("field-label-required");
    if (!allowedFieldTypes.includes(type)) return invalid("field-type-unsupported");
    if (hint !== undefined && typeof hint !== "string") return invalid("field-hint-type");

    const numbers = { value, min, max };
    for (const [key, raw] of Object.entries(numbers)) {
      if (raw === undefined) continue;
      if (!Number.isInteger(raw)) return invalid(`field-${key}-not-integer`);
    }
    const resolvedMin = min ?? null;
    const resolvedMax = max ?? null;
    if (resolvedMin !== null && resolvedMax !== null && resolvedMin > resolvedMax) return invalid("field-range-invalid");
    const resolvedValue = value ?? 0;
    if (resolvedMin !== null && resolvedValue < resolvedMin) return invalid("field-value-below-min");
    if (resolvedMax !== null && resolvedValue > resolvedMax) return invalid("field-value-above-max");

    fields.push({
      name,
      label,
      type,
      value: resolvedValue,
      ...(resolvedMin !== null ? { min: resolvedMin } : {}),
      ...(resolvedMax !== null ? { max: resolvedMax } : {}),
      ...(hint !== undefined ? { hint } : {})
    });
  }

  return {
    ok: true,
    reason: null,
    normalized: {
      title,
      ...(spec.content !== undefined ? { content: spec.content } : {}),
      buttons,
      fields
    }
  };

  function invalid(reason) {
    return { ok: false, reason, normalized: null };
  }
}

/**
 * 按同一声明校验问答结果；原端与接收端共用，网络边界外不消费任何越界值。
 * 零值合法；NaN、Infinity、空值、未知字段与越界值一律无效。
 * @param {object} answer - 接收端返回的 { requestId?, status, action?, values? }
 * @param {object} spec - validateInteractionSpec 产出的规范化声明
 * @returns {{ok: boolean, reason: string|null, status: string|null, action: string|null, values: object|null}}
 */
export function validateInteractionAnswer(answer, spec) {
  if (!isPlainObject(answer)) return invalid("answer-not-object", null, null, null);
  const { status, action, values } = answer;
  const knownStatuses = Object.values(SCRIPT_INTERACTION_STATUS);
  if (!knownStatuses.includes(status)) return invalid("status-unknown", null, null, null);
  if (status !== SCRIPT_INTERACTION_STATUS.ANSWERED) {
    return { ok: true, reason: null, status, action: null, values: null };
  }

  const buttons = Array.isArray(spec?.buttons) ? spec.buttons : [];
  if (!buttons.some(button => button.action === action)) return invalid("action-not-allowed", status, null, null);

  const fields = Array.isArray(spec?.fields) ? spec.fields : [];
  if (!isPlainObject(values)) return invalid("values-not-object", status, action, null);
  const declared = new Set(fields.map(field => field.name));
  for (const key of Object.keys(values)) {
    if (!declared.has(key)) return invalid("values-unknown-field", status, action, null);
  }
  const checked = {};
  for (const field of fields) {
    const raw = values[field.name];
    if (field.type === "integer") {
      if (!Number.isInteger(raw)) return invalid("value-not-integer", status, action, null);
      if (field.min !== undefined && raw < field.min) return invalid("value-below-min", status, action, null);
      if (field.max !== undefined && raw > field.max) return invalid("value-above-max", status, action, null);
      checked[field.name] = raw;
    } else {
      return invalid("field-type-unsupported", status, action, null);
    }
  }
  return { ok: true, reason: null, status, action, values: checked };

  function invalid(reason, errStatus, errAction, errValues) {
    return { ok: false, reason, status: errStatus, action: errAction, values: errValues };
  }
}

/** 是否为无原型链污染风险的普通对象。 */
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
