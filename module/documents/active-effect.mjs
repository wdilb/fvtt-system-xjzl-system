/**
 * 扩展原生的 ActiveEffect 类
 * 核心职责：实现“基于装备状态的自动抑制”
 */
export class XJZLActiveEffect extends ActiveEffect {

  /**
   * 重写 isSuppressed (是否被抑制)
   * 这是一个 Getter，每次系统计算属性时都会询问它
   */
  get isSuppressed() {
    // 1. 如果被用户手动禁用了 (Disabled)，直接返回 true
    if (this.disabled) return true;

    // 2. 获取父级 (Parent)
    const parent = this.parent;

    // 3. 核心逻辑：如果父级是物品 (Item)，且物品没装备，则抑制
    // 注意：只有在 CONFIG.ActiveEffect.legacyTransferral = false 时，
    // 被动特效才会留在 Item 上，此时 parent 才是 Item。
    if (parent instanceof Item) {
      // 检查 Item 是否有 equipped 属性
      const itemData = parent.system;
      
      // 如果物品有“装备”概念，且处于“未装备”状态
      if ("equipped" in itemData && itemData.equipped === false) {
        // 且这是一个被动传输的特效
        if (this.transfer) {
          return true; // 抑制！
        }
      }
    }

    // 4. 其他情况 (如特效在 Actor 身上)，保持默认行为
    return super.isSuppressed; 
  }
}