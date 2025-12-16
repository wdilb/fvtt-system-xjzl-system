/**
 * 扩展原生的 ActiveEffect 类
 * 核心职责：实现“基于装备状态的自动抑制”
 */
export class XJZLActiveEffect extends ActiveEffect {

  /**
   * ---------------------------------------------------------------
   * Getters: 用于 UI 展示和逻辑判断的快捷属性
   * ---------------------------------------------------------------
   */

  /**
   * 获取特效的唯一标识符 (Slug)
   * 这是判定叠层的核心依据，同 Slug 即视为同种特效
   * @returns {string}
   */
  get slug() {
    return this.getFlag("xjzl-system", "slug");
  }

  /**
   * 获取当前层数
   * @returns {number} 默认为 1
   */
  get stacks() {
    return this.getFlag("xjzl-system", "stacks") || 1;
  }

  /**
   * 获取最大层数
   * @returns {number} 0 代表无限
   */
  get maxStacks() {
    return this.getFlag("xjzl-system", "maxStacks") || 0;
  }

  /**
   * 是否可堆叠
   * @returns {boolean}
   */
  get isStackable() {
    return this.getFlag("xjzl-system", "stackable") || false;
  }

  /**
   * 动态显示名称，能在显示层解决的事情不要修改数据库里的name
   * 如果层数 > 1，自动追加 " (xN)"
   * @returns {string} 用于 UI 显示的名字
   */
  get displayLabel() {
    const stacks = this.stacks;
    if (stacks > 1) {
      return `${this.name} (${stacks})`;
    }
    return this.name;
  }

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

  /**
   * ---------------------------------------------------------------
   * Life Cycle: 数据生命周期钩子
   * ---------------------------------------------------------------
   */

  /**
   * 在特效创建前执行 (数据库写入前)
   * 目标：
   * 1. 确保有 slug (如果没有，用 name 生成或随机生成)
   * 2. 确保有 baseChanges 快照 (用于后续乘法计算)
   * 3. 初始化 stacks
   */
  async _preCreate(data, options, user) {
    await super._preCreate(data, options, user);

    // 1. 初始化 Flags 容器
    const flags = data.flags?.["xjzl-system"] || {};
    const updates = {};

    // 2. 确保 Slug 存在
    if (!flags.slug) {
      // 优先尝试将 name 转为 slug (如 "Green Snake Poison" -> "green-snake-poison")
      // 如果 name 是中文，slugify 可能会变空，则使用随机 ID
      let autoSlug = foundry.utils.slugify(data.name);
      if (!autoSlug || autoSlug.length === 0) {
        autoSlug = `effect-${foundry.utils.randomID()}`;
      }
      updates["flags.xjzl-system.slug"] = autoSlug;
    }

    // 3. 拍摄数值快照 (Base Snapshot)
    // 如果是第一次创建，且没有现成的 baseChanges，我们将当前的 changes 存为 baseChanges
    if (!flags.baseChanges && data.changes) {
      updates["flags.xjzl-system.baseChanges"] = foundry.utils.deepClone(data.changes);
    }

    // 4. 初始化层数
    if (!flags.stacks) {
      updates["flags.xjzl-system.stacks"] = 1;
    }

    // 应用更新到 data 对象中 (因为还在 _preCreate，直接修改 source)
    this.updateSource(updates);
  }

  /**
   * ---------------------------------------------------------------
   * Logic Methods: 核心业务逻辑
   * ---------------------------------------------------------------
   */

  /**
   * 计算新的 Changes 数组 (用于叠层)
   * 规则：
   * 1. 仅 Mode = 2 (ADD) 的数值会被乘算
   * 2. 其他 Mode 保持原样
   * @param {number} newStacks 目标层数
   * @returns {Array} 计算后的 changes 数组
   */
  calculateChangesForStacks(newStacks) {
    const baseChanges = this.getFlag("xjzl-system", "baseChanges");
    if (!baseChanges) return this.changes; // 容错：如果没有快照，就用当前的

    return baseChanges.map(change => {
      // 深度拷贝，避免修改原引用
      const newChange = { ...change };

      // 核心算法：
      // 只有 Mode 2 (ADD) 且 Value 是纯数字时，才进行乘法
      // V13 常量: CONST.ACTIVE_EFFECT_MODES.ADD === 2
      if (Number(newChange.mode) === CONST.ACTIVE_EFFECT_MODES.ADD) {
        const baseValue = Number(newChange.value);
        if (!isNaN(baseValue)) {
          newChange.value = String(baseValue * newStacks);
        }
      }

      return newChange;
    });
  }
}