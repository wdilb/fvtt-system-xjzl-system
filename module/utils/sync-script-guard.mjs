/**
 * 同步脚本（passive / calc）写入防护。
 *
 * passive/calc 在派生数据与面板计算中同步执行，打开角色卡、刷新界面或预览伤害
 * 都会重复运行它们；此类脚本一旦写入数据库、消耗资源或删除效果，纯展示行为就会
 * 破坏存档。执行器在每段同步脚本运行前把执行来源压入本模块的栈，常用写入链路
 * 在入口同步抛错阻断——必须在任何 await 之前检查，否则同步脚本得到的不是干净的
 * 异常，而是一个被丢弃的 rejected Promise，写入也可能已经发出。
 *
 * 这是对可信源数据的常规误用防护，不是 JavaScript 安全沙盒：延迟到微任务执行的
 * 写入（未 await 的异步助手、setTimeout 回调）以及未被拦截的 Foundry 全局 API
 * （如 ChatMessage.create）不在覆盖范围内，仍由录入规范约束。
 */

/** 同步脚本尝试写入时抛出的错误；scriptContext 保留被阻断时的执行来源。 */
export class XJZLSyncScriptWriteError extends Error {
  /**
   * @param {string} message - 面向控制台的完整错误说明
   * @param {object|null} context - 被阻断时最内层同步脚本的执行来源
   */
  constructor(message, context = null) {
    super(message);
    this.name = "XJZLSyncScriptWriteError";
    this.scriptContext = context;
  }
}

// 当前同步脚本执行栈，每个元素对应一层正在执行的 passive/calc 脚本；
// passive/calc 脚本同步触发嵌套收集（如 calc 内再算其他招式面板）时按层压栈。
const executionStack = [];

// 违规通知的节流记录：key → 上次通知时间。同步脚本随渲染反复执行，
// 不节流会在每次打开面板时刷屏；控制台错误仍逐次记录。
const notifiedKeys = new Map();
const NOTIFY_THROTTLE_MS = 30000;

/**
 * 进入一段同步脚本执行，记录执行来源供报错定位。
 * @param {object} context - 执行来源：{ actorName, trigger, label }
 * @returns {Function} 精确恢复函数；必须在 finally 中调用，异常退出同样恢复。
 */
export function enterSyncScriptContext(context = {}) {
  executionStack.push(context);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    const index = executionStack.lastIndexOf(context);
    if (index !== -1) executionStack.splice(index, 1);
  };
}

/** 当前最内层同步脚本的执行来源；不在同步脚本中时为 null。 */
export function getSyncScriptContext() {
  return executionStack.length > 0 ? executionStack[executionStack.length - 1] : null;
}

/** 是否处于任一 passive/calc 同步脚本执行期间。 */
export function isInSyncScript() {
  return executionStack.length > 0;
}

/**
 * 阻断同步脚本期间的文档写入、资源消耗、效果增删和 GM 委托。
 * 只在写入方法的同步入口调用（进入任何 await 之前）：同步抛错能中断脚本本身，
 * 且不会额外产生未处理的 Promise rejection。
 * @param {string} operation - 被阻断的操作名，用于报错定位
 * @param {object} [detail] - 附加定位信息，目前支持 { document } 目标文档名
 * @returns {void} 不在同步脚本中时直接放行
 */
export function assertNoSyncScriptWrite(operation, detail = null) {
  const context = getSyncScriptContext();
  if (!context) return;
  const where = [
    context.actorName ? `角色「${context.actorName}」` : null,
    context.trigger ? `触发器 ${context.trigger}` : null,
    context.label ? `脚本「${context.label}」` : null
  ].filter(Boolean).join("，");
  const target = detail?.document ? `（目标：「${detail.document}」）` : "";
  throw new XJZLSyncScriptWriteError(
    `passive/calc 同步脚本禁止写入数据库、消耗资源或增删效果：${operation}${target} 已被阻断。`
    + `来源：${where || "未知"}。请将一次性效果迁移到 attack/hit 等异步触发器并 await。`,
    context
  );
}

/**
 * 对同步脚本的写入违规发出节流通知；同一来源在节流窗口内只通知一次，
 * 控制台错误不受此限制。非违规错误不通知。
 * @param {Error} err - 同步脚本执行器捕获到的异常
 */
export function notifySyncScriptViolation(err) {
  if (!(err instanceof XJZLSyncScriptWriteError) || !globalThis.ui?.notifications) return;
  const context = err.scriptContext || {};
  const key = `${context.actorName ?? "?"}|${context.trigger ?? "?"}|${context.label ?? "?"}`;
  const now = Date.now();
  if (now - (notifiedKeys.get(key) || 0) < NOTIFY_THROTTLE_MS) return;
  notifiedKeys.set(key, now);
  globalThis.ui.notifications.error(
    `特效脚本被阻止：${context.label ?? "未知脚本"}（${context.trigger ?? "同步"} 阶段不能写入或消耗资源，详见控制台）`
  );
}
