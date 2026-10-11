/**
 * 技艺书修为按篇拆分（纯函数，无 Foundry 依赖，供数据模型迁移与 Node 回归共用）。
 * 背景见 XJZLArtBookData.migrateData：旧版修为存于书级总池，新版存于各章。
 */

/**
 * 按原顺序分配算法把书级总修为与来源构成拆分到各章。
 * 分配结果与旧版 prepareDerivedData 的串行展示严格一致：前一章填满才轮到下一章。
 * 来源构成按自动投入策略拆分（优先专属）：历史真值不可考，只保证总额守恒，
 * 仅影响按篇返还时退哪个池，不影响修为总量。
 * 书级总投入超过全书总消耗时，溢出连同剩余构成并入首章（旧系统下该残留可经
 * 散功取回，迁移必须保住总额）；章节为空时溢出保留在 leftover 由调用方处理。
 * @param {Array<object>} chapters 数据源章节（读取 cost/xpCostRatio，其余字段原样保留）
 * @param {number} xpInvested 书级已投入总修为
 * @param {{general?: number, specific?: number}} sourceBreakdown 书级来源构成
 * @returns {{chapters: Array<object>, leftover: number}} 拆分后的章节数组与未能分配的修为
 *   （有章节时 leftover 恒为 0）
 */
export function allocateBookXPToChapters(chapters, xpInvested, sourceBreakdown = {}) {
  let currentXP = xpInvested || 0;
  let remainingGeneral = sourceBreakdown?.general || 0;
  let remainingSpecific = sourceBreakdown?.specific || 0;

  const allocated = (chapters || []).map(chapter => {
    const rawCost = chapter.cost || 0;
    const ratio = chapter.xpCostRatio ?? 1;
    const chapterCost = Math.floor(rawCost * ratio);

    // 与旧版顺序分配一致：min(剩余总池, 本章消耗)
    const invested = Math.min(currentXP, chapterCost);
    currentXP -= invested;

    // 构成拆分优先专属（同自动投入的偏好），并受本章实际分配量约束
    const take = Math.min(invested, remainingGeneral + remainingSpecific);
    const fromSpecific = Math.min(remainingSpecific, take);
    const fromGeneral = take - fromSpecific;
    remainingSpecific -= fromSpecific;
    remainingGeneral -= fromGeneral;

    return {
      ...chapter,
      xpInvested: invested,
      sourceBreakdown: { general: fromGeneral, specific: fromSpecific }
    };
  });

  // 溢出并入首章，构成同步并入并保持"来源合计 = 章节投入"的返还不变量
  if (currentXP > 0 && allocated.length > 0) {
    const first = allocated[0];
    const fromSpecific = Math.min(remainingSpecific, currentXP);
    const fromGeneral = Math.min(remainingGeneral, currentXP - fromSpecific);
    first.xpInvested += currentXP;
    first.sourceBreakdown.general += fromGeneral;
    first.sourceBreakdown.specific += fromSpecific;
    currentXP = 0;
  }

  return { chapters: allocated, leftover: currentXP };
}
