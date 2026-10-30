/**
 * 资源事务提交错误及其 socket 序列化辅助。
 * socketlib 无法跨客户端传递自定义 Error 字段，因此 GM 端捕获专用错误后
 * 返回可序列化的结果信封，调用端再重建等价的错误对象。
 *
 * 脚本中止错误（XJZLScriptAbortError，含被伤害入口包装为
 * XJZLResourceCommitError 且保留原始中止的场景）与资源提交错误共用同一套
 * 信封/解包/识别契约：信封携带 abortError 标记，解包端重建可被
 * isScriptAbortError 识别的错误，跨客户端不丢失中止身份和提交状态。
 */

import { isScriptAbortError, XJZLScriptAbortError } from "./script-interaction-policy.mjs";

export const RESOURCE_SOCKET_RESULT = "__xjzlResourceSocketResult";

/**
 * 资源事务提交异常：区分“数据库是否已提交”以及失败阶段。
 * committed 为 true 表示数据库已提交，false 表示已确认未提交，unknown 表示无法确认。
 */
export class XJZLResourceCommitError extends Error {
  constructor(message, { committed, phase, cause, actorUuid, resourceChanges, originalError } = {}) {
    super(message);
    this.name = "XJZLResourceCommitError";
    this.committed = committed;
    this.phase = phase;
    this.cause = cause;
    this.actorUuid = actorUuid;
    this.resourceChanges = resourceChanges;
    this.originalError = originalError;
  }
}

/**
 * 将 XJZLResourceCommitError 或脚本中止错误转为可序列化对象；其他错误返回 null。
 * 中止信息以 abortError 标记随信封传输，提交状态（committed 等字段）原样保留。
 */
export function toResourceCommitErrorEnvelope(err) {
  if (err instanceof XJZLResourceCommitError) {
    const abortSource = isScriptAbortError(err) ? err.scriptAbort : null;
    return {
      message: err.message,
      committed: err.committed,
      phase: err.phase,
      cause: err.cause,
      actorUuid: err.actorUuid,
      resourceChanges: err.resourceChanges,
      originalErrorMessage: err.originalError?.message ?? null,
      abortError: abortSource
        ? { requestId: abortSource.requestId ?? null, abortReason: abortSource.abortReason ?? null }
        : null
    };
  }
  if (isScriptAbortError(err)) {
    return {
      message: err.message,
      committed: err.committed,
      phase: err.phase,
      cause: err.cause,
      actorUuid: err.actorUuid,
      resourceChanges: err.resourceChanges,
      originalErrorMessage: null,
      abortError: { requestId: err.requestId ?? null, abortReason: err.abortReason ?? null }
    };
  }
  return null;
}

/**
 * 包装 GM 端成功结果，使调用端能区分“正常结果”与“专用错误信封”。
 */
export function wrapResourceSocketResult(result) {
  return { [RESOURCE_SOCKET_RESULT]: true, ok: true, result };
}

/**
 * 包装 GM 端异常；资源提交错误与脚本中止错误转为信封，
 * 其他错误原样抛出，由 socketlib 走既有异常通道。
 */
export function wrapResourceSocketError(err) {
  const error = toResourceCommitErrorEnvelope(err);
  if (!error) throw err;
  return { [RESOURCE_SOCKET_RESULT]: true, ok: false, error };
}

/**
 * 调用端解包 socket 结果；专用错误信封会重建为等价错误：
 * 资源提交错误恢复 XJZLResourceCommitError；携带中止身份时保留 scriptAbort，
 * 使脚本运行器能继续按中止透传（含 committed 等真实提交状态）。
 */
export function unwrapResourceSocketResult(payload) {
  if (payload && typeof payload === "object" && payload[RESOURCE_SOCKET_RESULT]) {
    if (payload.ok) return payload.result;
    const error = payload.error || {};
    let originalError = error.originalErrorMessage ? new Error(error.originalErrorMessage) : null;
    if (error.abortError) {
      // 重建原始中止错误并挂回包装：执行器按 scriptAbort 识别中止身份。
      originalError = new XJZLScriptAbortError(
        error.originalErrorMessage || error.message || "XJZL | 远程脚本中止",
        {
          requestId: error.abortError.requestId,
          actorUuid: error.actorUuid,
          reason: error.abortError.abortReason
        }
      );
    }
    const rebuilt = new XJZLResourceCommitError(error.message || "XJZL | 远程资源事务失败", {
      committed: error.committed,
      phase: error.phase,
      cause: error.cause,
      actorUuid: error.actorUuid,
      resourceChanges: error.resourceChanges,
      originalError
    });
    if (error.abortError && isScriptAbortError(originalError)) {
      rebuilt.scriptAbort = originalError;
    }
    throw rebuilt;
  }
  return payload;
}
