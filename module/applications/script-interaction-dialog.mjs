/**
 * 脚本交互问答的本地表单窗口（普通 form：按钮 + integer 字段）。
 *
 * 仅负责展示与取值：输入按完整数值转换，非法值交由 script-interaction-policy
 * 按同一声明拦截，不做截断或折算。窗口由本模块直接构造并等待：
 * 核心 DialogV2.wait 不会把异步 render 的拒绝接入返回 Promise，因此这里
 * 直接观察 render 的 Promise，失败时立即返回 error 并清理；终结与清理独立于
 * 渲染完成，外部关闭、自身截止都先解除等待再尽力关闭窗口。剩余时间仅为提示，
 * 真正的超时以两端各自同步的 serverTime 截止判断，不比较本机 Date.now()。
 */

/** HTML 文本转义：仅用于由声明拼接的属性与文本节点；content 由可信脚本提供原始 HTML。 */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

/** 渲染单个 integer 字段；name 已由声明校验约束为安全标识符。 */
function renderIntegerField(field) {
  const name = escapeHtml(field.name);
  const min = field.min !== undefined ? ` min="${field.min}"` : "";
  const max = field.max !== undefined ? ` max="${field.max}"` : "";
  return `
  <div class="form-group">
    <label>${escapeHtml(field.label)}</label>
    <div class="form-fields">
      <input type="number" name="${name}" value="${field.value}"${min}${max} step="1">
    </div>
  </div>`;
}

/** 尽力关闭窗口：close 的拒绝只记录，不影响已经完成的等待。 */
function closeQuietly(app) {
  if (!app) return;
  Promise.resolve()
    .then(() => app.close())
    .catch(err => console.warn("XJZL | 关闭脚本交互窗口失败（等待已独立结束）:", err));
}

/**
 * 打开问答窗口并等待结果。
 * @param {object} payload - 已通过协议校验的问答载荷（含 spec 与 expiresAt）
 * @param {object} [options]
 * @param {Function} [options.getExternalCloseReason] - 渲染完成后的轮询；
 *   返回非空字符串时立即以该原因结束等待并关闭窗口（用于关闭通知与宿主中止的竞态清理）。
 * @returns {{promise: Promise<{status: string, action: string|null, values: object|null, reason: string|null}>,
 *            close: Function}} promise 以本地答案结案；close(reason) 供管理器提前结束纯 UI，
 *   不依赖渲染完成。
 */
export function openScriptInteractionDialog(payload, { getExternalCloseReason } = {}) {
  const spec = payload.spec;
  let intervalId = null;
  let expiryTimer = null;
  let settled = false;
  let closeReason = null;
  let app = null;

  const remainingMs = () => payload.expiresAt - game.time.serverTime;

  let resolveOuter;
  const promise = new Promise(resolve => { resolveOuter = resolve; });

  // 终结独立于渲染：无论窗口是否完成渲染，close/截止都先解除等待。
  const finish = value => {
    if (settled) return;
    settled = true;
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (expiryTimer !== null) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    resolveOuter(value);
  };
  const finishClosed = reason => {
    closeReason = reason ?? "cancelled";
    finish(closeReason === "timedOut"
      ? { status: "timedOut", action: null, values: null, reason: "deadline" }
      : { status: "cancelled", action: null, values: null, reason: closeReason });
  };

  const requestClose = reason => {
    if (settled) return;
    finishClosed(reason);
    // app 尚未渲染完成时，迟到的渲染完成会走 settled 分支补关闭。
    closeQuietly(app);
  };

  const close = reason => requestClose(reason ?? "cancelled");

  // 渲染前已到期：不开窗，直接以超时结案（不能因迟到载荷重开已终结请求）。
  if (remainingMs() <= 0) {
    finishClosed("timedOut");
    return { promise, close: () => {} };
  }

  // 独立截止计时：不依赖渲染完成；窗口到期即解除等待。
  expiryTimer = setTimeout(() => requestClose("timedOut"), Math.max(0, remainingMs()));

  const buttons = spec.buttons.map(button => ({
    action: button.action,
    label: button.label,
    ...(button.icon ? { icon: button.icon } : {}),
    ...(button.default ? { default: true } : {}),
    // 回调从 button.form 读取字段：文字点击、图标点击与键盘提交都汇聚到提交按钮（V14 契约）。
    callback: (_event, buttonElement) => {
      const values = {};
      for (const field of spec.fields) {
        const raw = buttonElement.form?.elements[field.name]?.value;
        // 完整数值转换后交给声明校验：parseInt 的截断（1.9→1、1e1→1）会篡改玩家
        // 选择的消耗数量；空输入保持 NaN，由整数校验按 error 拒绝。
        const trimmed = typeof raw === "string" ? raw.trim() : raw;
        values[field.name] = trimmed === undefined || trimmed === null || trimmed === ""
          ? NaN
          : Number(trimmed);
      }
      return { status: "answered", action: button.action, values, reason: null };
    }
  }));

  const contentHtml = `
  ${spec.content ?? ""}
  <div class="form-group xjzl-script-interaction-fields">
    ${spec.fields.map(renderIntegerField).join("")}
  </div>
  <p class="hint xjzl-script-interaction-remaining" data-remaining></p>`;

  // 复刻核心 DialogV2.wait 的解析语义：按钮回调结果经 submit resolve（关窗事件不再改变结果），
  // 关窗（rejectClose:false）解析为 null。区别在于 render 的 Promise 由本模块直接观察：
  // 渲染失败立即以确定的 error 结案并清理，而不是产生 unhandledRejection 并挂起等待。
  const dialog = new foundry.applications.api.DialogV2({
    window: { title: spec.title },
    content: contentHtml,
    buttons,
    rejectClose: false,
    submit: result => {
      if (settled) return;
      if (result && typeof result === "object") {
        finish({ ...result });
        return;
      }
      finishClosed(closeReason ?? "dismissed");
    }
  });
  dialog.addEventListener("close", () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    // 玩家关窗（Esc/取消）不经过 submit：按已记录原因或取消结案，避免挂到截止。
    if (!settled) finishClosed(closeReason ?? "dismissed");
  }, { once: true });

  const startRemainingTimer = () => {
    const updateRemaining = () => {
      if (settled) return;
      const left = remainingMs();
      const node = app?.element?.querySelector?.(".xjzl-script-interaction-remaining");
      if (node) {
        node.textContent = left > 0
          ? game.i18n.format("XJZL.ScriptInteraction.RemainingTime", { seconds: Math.ceil(left / 1000) })
          : game.i18n.localize("XJZL.ScriptInteraction.Expired");
      }
      const externalNow = getExternalCloseReason?.();
      if (left <= 0) return requestClose("timedOut");
      if (externalNow) requestClose(externalNow);
    };
    updateRemaining();
    intervalId = setInterval(updateRemaining, 1000);
  };

  Promise.resolve()
    .then(() => dialog.render({ force: true }))
    .then(() => {
      app = dialog;
      // 等待已独立终结（取消/截止先到）：迟到的窗口直接关闭，不再启动计时。
      if (settled) return closeQuietly(app);
      // 窗口登记完成后再查一次终态：关闭通知或中止可能发生在模板加载期间。
      const external = getExternalCloseReason?.();
      if (external) return requestClose(external);
      startRemainingTimer();
    })
    .catch(err => {
      // 渲染或渲染后处理失败：立即记录并以确定的 error 结案，清理窗口与计时，
      // 不产生 unhandledRejection，也不让问询挂到截止。
      console.error("XJZL | 脚本交互窗口渲染或显示失败:", err);
      if (!settled) {
        closeQuietly(dialog);
        finish({ status: "error", action: null, values: null, reason: "render-failed" });
      }
    });

  return { promise, close };
}
