/**
 * 扩展原生的 ActiveEffect 类
 * 核心职责：实现“基于装备状态的自动抑制”
 */
import { SCRIPT_TRIGGERS } from "../data/common.mjs";
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

  /* -------------------------------------------- */
  /*  脚本数据封装 (Script Helpers)         */
  /* -------------------------------------------- */

  /**
   * 获取挂载在特效上的脚本数组
   * 模拟 DataModel 的访问方式，直接返回数组
   * 为了兼容性，这里的flags里封装的scripts的数据结构应该和我们通用的makeScriptEffectSchema里定义的相同
   * 如果数据库里存的是伪数组对象 {"0":...}，自动转为数组返回
   * @returns {Array} [{ label, trigger, script, active }]
   */
  get scripts() {
    const raw = this.getFlag("xjzl-system", "scripts");

    // 1. 空值处理
    if (!raw) return [];

    // 2. 兼容性修复：如果是对象但不是数组，说明数据脏了，兼容性读取
    if (typeof raw === "object" && !Array.isArray(raw)) {
      return Object.values(raw);
    }

    // 3. 正常数组
    return raw;
  }

  /**
   * 检查是否拥有特定时机的脚本 (辅助优化性能)
   * @param {String} trigger 
   * @returns {Boolean}
   */
  hasScript(trigger) {
    const scripts = this.scripts;
    return scripts.some(s => s.trigger === trigger && s.active !== false);
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

      // B. 破衣 (Poyi) 逻辑
      if (parent.type === "armor") {
        const actor = parent.parent;

        if (actor && actor instanceof Actor) {
          // 直接读取 Actor 预计算好的缓存值
          // 现在这个值是基于 changes 扫描的，支持任意来源的特效
          const isBroken = actor.isArmorBroken;

          // 检查部位
          const bodySlots = ["head", "top", "bottom", "shoes"];
          const isBodyPart = bodySlots.includes(itemData.type);

          if (isBroken && isBodyPart) {
            return true;
          }
        }
      }

    }

    // 4. 其他情况 (如特效在 Actor 身上)，保持默认行为
    return super.isSuppressed;
  }

  // 添加静态方法确保生成slug的逻辑一致
  static getSlug(effectData) {
    // 1. 优先读显式设置的 Flag (绝对权威)
    const flagSlug = foundry.utils.getProperty(effectData, "flags.xjzl-system.slug");
    if (flagSlug) return flagSlug;

    // 2. 其次读 Name (语义化匹配，叠层的核心)
    // 只要名字叫 "Poison"，不管 ID 是多少，都认为是同一种毒
    if (effectData.name) return effectData.name.slugify();

    // 3. 最后读 ID (仅用于没有任何名字的特殊情况)
    if (effectData._id) return effectData._id;

    // 4. 实在没有就生成随机的 (防止空字符串)
    return foundry.utils.randomID();
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
      let autoSlug = XJZLActiveEffect.getSlug(data);
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

    // 5. 初始化脚本结构
    // 确保 flags.scripts 是一个数组，防止后续遍历报错
    if (!flags.scripts) {
      updates["flags.xjzl-system.scripts"] = [];
    }

    // 应用更新到 data 对象中 (因为还在 _preCreate，直接修改 source)
    this.updateSource(updates);
  }

  /**
   * 在更新写入数据库之前触发
   * 因为FVTT 自带的AE的提交会把数组转换为对象，为了保持和我们数据文件的一致，这里把他转换回数组
   * 拦截所有来源的更新（包括标准提交按钮、API调用），确保 scripts 是数组
   */
  async _preUpdate(changed, options, user) {
    await super._preUpdate(changed, options, user);

    // 1. 检查是否有针对我们系统的 flags 更新
    const xjzlFlags = changed.flags?.["xjzl-system"];

    // 2. 只有当更新包含 scripts 字段时才介入
    if (xjzlFlags && "scripts" in xjzlFlags) {

      const incomingScripts = xjzlFlags.scripts;
      console.log("XJZL DEBUG | _preUpdate Check Scripts:", incomingScripts);

      // 3. 检测伪数组对象 (例如 {"0": {...}, "1": {...}})
      if (typeof incomingScripts === "object" && !Array.isArray(incomingScripts)) {
        // 4. 强制修正为数组
        // Object.values 会按照索引顺序提取值，生成纯净数组
        xjzlFlags.scripts = Object.values(incomingScripts);
      }
    }
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

  /**
   * 拦截系统原本的飘字方法
   * @override
   * @param {boolean} enabled - 状态是开启还是关闭
   */
  _displayScrollingStatus(enabled) {
    // ---------------------------------------------------------------
    // 显式屏蔽：系统默认的白色状态飘字
    // ---------------------------------------------------------------
    // 我们已经通过 active-effect-manager.mjs 实现了基于 Socket 的
    // 自定义飘字（绿色/红色、支持叠层显示），因此必须在这里阻断
    // 核心的默认行为，防止出现双重飘字。
    // ---------------------------------------------------------------
    
    return; // 显式返回，表明“此处逻辑终结”
  }
}