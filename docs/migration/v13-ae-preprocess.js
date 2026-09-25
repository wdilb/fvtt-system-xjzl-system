/**
 * V13 → V14 升级前时长预处理宏
 * ============================================================
 * 运行环境：Foundry VTT 13.351，目标世界内，GM 身份执行。
 * 执行方式：将本文件全部内容粘贴到 V13 宏编辑器（JS 类型）运行，
 *           或作为世界宏导入后执行。
 *
 * 目的：在数据仍为 V13 原始形态时消除 V14 清洗的不可逆损失——
 * V13 的 rounds+turns（或与 seconds）并存 duration，在 V14 加载时会被按
 * seconds→turns→rounds 优先序误补（如 {rounds:3, turns:0} 变成 0 turns），
 * 且旧单位键随即被 schema 清洗删除，无法在 V14 侧恢复。本宏按系统语义
 * rounds 优先合并为单一主单位。
 * （不做 transfer 统计：V13 schema 会把 transfer 物化为布尔默认值，已加载
 * 文档无法区分"显式声明"；世界存量也不存在未声明的施加型效果。）
 *
 * 实现要点：
 * - 更新使用 V13 的强制替换键 "==duration"（避免增量合并把未提交的
 *   turns/seconds 残留在库中），并在更新后重新读取校验只剩一个时长单位；
 *   校验失败会计入 report.unverified，必须人工处理后再升级。
 * - before 在更新前捕获；报告自动下载为 JSON。
 *
 * 安全性：仅修改存在并存形态的 duration；其余数据零改动。锚点键
 * （startTime/startRound/startTurn）原样保留，由 V14 加载时迁移。
 * 幂等：重复运行，已合并的效果不再命中条件、零二次修改。
 */

const report = { scanned: 0, merged: [], unverified: [], errors: [] };

/** 合并并存形态的 duration；返回 {duration, note} 或 null */
function mergeDuration(duration) {
  if (!duration || typeof duration !== "object") return null;
  const hasRounds = typeof duration.rounds === "number";
  const hasTurns = typeof duration.turns === "number";
  const hasSeconds = typeof duration.seconds === "number";
  // 仅处理并存形态：单一单位（或无时长）不存在 V14 清洗陷阱
  const conflicts = [hasRounds, hasTurns, hasSeconds].filter(Boolean).length;
  if (conflicts < 2) return null;

  const merged = { ...duration };
  let note;
  if (hasRounds && duration.rounds !== 0) {
    delete merged.turns;
    delete merged.seconds;
    note = `合并为 ${merged.rounds} rounds`;
  } else if (hasTurns && duration.turns !== 0) {
    delete merged.rounds;
    delete merged.seconds;
    note = `合并为 ${merged.turns} turns`;
  } else if (hasSeconds) {
    delete merged.rounds;
    delete merged.turns;
    note = `合并为 ${merged.seconds} seconds`;
  } else {
    // 各单位全为 0：视为无限/异常时长，清空并存键（V14 下按永久处理）
    delete merged.rounds;
    delete merged.turns;
    delete merged.seconds;
    note = "全部单位为 0，清空并存键（V14 下按永久处理）";
  }
  return { duration: merged, note };
}

/** 更新后重新读取，确认 duration 只剩一个时长单位 */
function verifySingleUnit(duration) {
  if (!duration || typeof duration !== "object") return false;
  const units = ["rounds", "turns", "seconds"].filter(u => typeof duration[u] === "number");
  return units.length <= 1;
}

/** 处理单个效果（更新前捕获 before，更新后重读校验） */
async function processEffect(effect, ownerPath) {
  report.scanned++;
  try {
    // before 必须在更新前捕获（更新后 duration 即为新值）
    const before = { ...(effect.duration ?? {}) };
    const merged = mergeDuration(effect.duration);
    if (!merged) return;
    // "==duration" 为 V13 的强制替换键：整体替换 duration，
    // 避免增量合并把未提交的 turns/seconds 残留在数据库中
    await effect.update({ "==duration": merged.duration });
    // 更新后从父集合重新读取，校验更新后的模型形态只剩一个时长单位。
    // 定位限定：这是内存模型校验，用于捕获 "==duration" 强制替换未生效的
    // 合并语义失败（如增量合并残留旧单位）；数据库持久化须在重启后核对。
    const fresh = effect.parent?.effects?.get(effect.id) ?? effect;
    const after = fresh.duration ?? {};
    const single = verifySingleUnit(after);
    if (single) {
      report.merged.push({ path: ownerPath, id: effect.id, name: effect.name ?? effect.label, note: merged.note, before, after: { ...after } });
    } else {
      report.unverified.push({ path: ownerPath, id: effect.id, name: effect.name ?? effect.label, expected: merged.duration, actual: { ...after } });
    }
  } catch (err) {
    report.errors.push({ path: ownerPath, id: effect?.id, error: String(err?.message ?? err) });
  }
}

async function main() {
  // 1. 世界 Actor 本体 + 内嵌物品
  for (const actor of game.actors) {
    for (const effect of actor.effects) await processEffect(effect, `Actor.${actor.id}`);
    for (const item of actor.items) {
      for (const effect of item.effects) await processEffect(effect, `Actor.${actor.id}>Item.${item.id}`);
    }
  }
  // 2. 世界物品
  for (const item of game.items) {
    for (const effect of item.effects) await processEffect(effect, `Item.${item.id}`);
  }
  // 3. 非链接 Token 的合成数据（V13 的修改落在 token.actorData，可经合成 Actor 更新）
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (token.actorLink) continue; // V13 TokenDocument 的顶层字段
      const synth = token.actor;
      if (!synth) continue;
      for (const effect of synth.effects) await processEffect(effect, `Scene.${scene.id}>Token.${token.id}`);
      for (const item of synth.items) {
        for (const effect of item.effects) await processEffect(effect, `Scene.${scene.id}>Token.${token.id}>Item.${item.id}`);
      }
    }
  }

  // 4. 输出报告（errors/unverified 非零表示仍有并存形态旧时长未合并，禁止直接升级）
  const hasIssues = report.unverified.length > 0 || report.errors.length > 0;
  console.log(`%cV13 AE 预处理${hasIssues ? "存在未解决条目" : "全部完成"}：扫描 ${report.scanned} 条，合并 ${report.merged.length} 条，未验证 ${report.unverified.length} 条，错误 ${report.errors.length} 条`, hasIssues ? "color:#c62828;font-weight:bold" : "color:#c84b31;font-weight:bold");
  if (report.merged.length) console.table(report.merged);
  if (report.unverified.length) console.table(report.unverified);
  if (report.errors.length) console.table(report.errors);
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "v13-ae-preprocess-report.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  if (hasIssues) {
    ui.notifications.error(`V13 AE 预处理未通过：${report.unverified.length} 条未验证、${report.errors.length} 条失败。必须按报告定位人工处理并重跑宏至全部归零，才能升级 V14（核对清单已下载）`);
  } else {
    ui.notifications.info(`V13 AE 预处理全部完成：扫描 ${report.scanned} 条，合并 ${report.merged.length} 条（核对清单已下载）`);
  }
  return report;
}

await main();
