/**
 * 资源事务提交错误及其 socket 序列化辅助。
 * socketlib 无法跨客户端传递自定义 Error 字段，因此 GM 端捕获专用错误后
 * 返回可序列化的结果信封，调用端再重建等价的 XJZLResourceCommitError。
 */

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
 * 将 XJZLResourceCommitError 转为可序列化对象；其他错误返回 null。
 */
export function toResourceCommitErrorEnvelope(err) {
  if (!(err instanceof XJZLResourceCommitError)) return null;
  return {
    message: err.message,
    committed: err.committed,
    phase: err.phase,
    cause: err.cause,
    actorUuid: err.actorUuid,
    resourceChanges: err.resourceChanges,
    originalErrorMessage: err.originalError?.message ?? null
  };
}

/**
 * 包装 GM 端成功结果，使调用端能区分“正常结果”与“专用错误信封”。
 */
export function wrapResourceSocketResult(result) {
  return { [RESOURCE_SOCKET_RESULT]: true, ok: true, result };
}

/**
 * 包装 GM 端异常；非 XJZLResourceCommitError 原样抛出，由 socketlib 走既有异常通道。
 */
export function wrapResourceSocketError(err) {
  const error = toResourceCommitErrorEnvelope(err);
  if (!error) throw err;
  return { [RESOURCE_SOCKET_RESULT]: true, ok: false, error };
}

/**
 * 调用端解包 socket 结果；专用错误信封会被重建为 XJZLResourceCommitError。
 */
export function unwrapResourceSocketResult(payload) {
  if (payload && typeof payload === "object" && payload[RESOURCE_SOCKET_RESULT]) {
    if (payload.ok) return payload.result;
    const error = payload.error || {};
    throw new XJZLResourceCommitError(error.message || "XJZL | 远程资源事务失败", {
      committed: error.committed,
      phase: error.phase,
      cause: error.cause,
      actorUuid: error.actorUuid,
      resourceChanges: error.resourceChanges,
      originalError: error.originalErrorMessage ? new Error(error.originalErrorMessage) : null
    });
  }
  return payload;
}
