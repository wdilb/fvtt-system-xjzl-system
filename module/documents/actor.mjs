/**
 * 扩展核心 Actor 类
 */
export class XJZLActor extends Actor {

  /* -------------------------------------------- */
  /*  生命周期钩子 (Lifecycle Hooks)              */
  /* -------------------------------------------- */

  /**
   * 监控内嵌文档更新 (装备/内功/Buff 变动)
   */
  _onUpdateEmbeddedDocuments(embeddedName, documents, result, options, userId) {
    super._onUpdateEmbeddedDocuments(embeddedName, documents, result, options, userId);
    // 只由当前操作的用户执行，防止多客户端重复写入
    if (userId !== game.user.id) return;

    this._enforceResourceIntegrity();
  }

  /**
   * 监控自身数据更新 (基础属性变动/升级)
   */
  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if (userId !== game.user.id) return;

    this._enforceResourceIntegrity();
  }

  /**
   * 应用 Active Effects
   * 我们在这里拦截装备的特效。如果装备没穿上，就在内存里把特效“屏蔽”掉。
   * 应该不需要这个方法了，已经重写了ActiveEffects，在ActiveEffects里处理了抑制未装备物品的特效
   */
  // applyActiveEffects() {
  //   // ---------------------------------------------------------------
  //   // 阶段 1: 预处理 - 抑制未装备物品的特效 (Optimization Mode)
  //   // ---------------------------------------------------------------
  //   // 我们遍历 Items 而不是 Effects，因为 Item 数量通常更少且结构更清晰。
  //   // 这样避免了使用了耗时的 fromUuidSync。

  //   for (const item of this.items) {
  //     // 1. 检查是否是“可装备”的物品，且状态为“未装备”
  //     // 注意：不仅是 weapon/armor，奇珍也有 equipped 字段
  //     if ("equipped" in item.system && item.system.equipped === false) {
  //       // 2. 遍历该物品拥有的所有特效
  //       for (const effect of item.effects) {
  //         // 3. 只抑制 "Transfer" (被动) 特效
  //         // 触发类特效 (Transfer=false) 本来就不会自动挂在 Actor 身上，不用管
  //         if (effect.transfer) {
  //           // V13 中 isSuppressed 是只读 Getter，不能直接赋值。
  //           // 我们使用 defineProperty 强制在内存实例上覆盖它。
  //           // 这样既不会报错，又能让 super.applyActiveEffects 跳过它。
  //           try {
  //             Object.defineProperty(effect, "isSuppressed", {
  //               value: true,
  //               writable: true,
  //               configurable: true
  //             });
  //           } catch (err) {
  //             console.warn("无法抑制特效:", err);
  //           }
  //         }
  //       }
  //     }
  //   }

  //   // ---------------------------------------------------------------
  //   // 阶段 2: 执行核心应用逻辑
  //   // ---------------------------------------------------------------
  //   // 调用父类方法。Foundry 核心在遍历 effects 时，
  //   // 会自动跳过所有 isSuppressed === true 的特效。
  //   return super.applyActiveEffects();
  // }

  /**
   * 数据准备流程的生命周期：
   * 1. prepareData()
   *    -> prepareBaseData()  (DataModel)
   *    -> applyActiveEffects() (Foundry Core)
   *    -> prepareDerivedData() (DataModel + Document)
   */
  prepareDerivedData() {
    // ----------------------------------------------------
    // PHASE 1: 基础计算 (Pass 1)
    // ----------------------------------------------------
    // 执行 DataModel.prepareDerivedData()
    // 此时：
    // - 内功的固定属性加成已生效
    super.prepareDerivedData();

    // 初始化状态字典
    // 现在可以在其他地方直接写 if (this.xjzlStatuses.exposed) { ... } 
    // 而不需要写难看的 if (this.getFlag("xjzl-system", "exposed")) { ... }
    this.xjzlStatuses = {};
    const statusFlags = CONFIG.XJZL.statusFlags || {}; // 安全防空
    for (const key of Object.keys(statusFlags)) {
      // 检查当前是否有这个 Flag
      this.xjzlStatuses[key] = this.getFlag("xjzl-system", key) || false;
    }

    // ----------------------------------------------------
    // PHASE 2: 脚本干预 (Script Execution)
    // ----------------------------------------------------
    // 运行内功脚本。
    // 因为 Pass 1 已经执行，脚本可以安全地读取计算后的属性：
    this._applyNeigongEffects();

    // ----------------------------------------------------
    // PHASE 3: 重算 (Pass 2)
    // ----------------------------------------------------
    // 因为脚本可能修改了 stats.mod，我们需要重新跑一遍公式。
    // 调用我们在 DataModel 里新写的 recalculate()。
    this.system.recalculate();
  }

  /**
   * 准备用于骰子检定的数据 (Roll Data)
   * 这决定了你在公式里可以用 @ 什么属性
   */
  getRollData() {
    const data = super.getRollData();
    const sys = this.system;

    // 1. 将七维属性添加到顶层，方便引用
    // 例如: @liliang 代替 @stats.liliang.total
    if (sys.stats) {
      for (const [key, stat] of Object.entries(sys.stats)) {
        if (stat && typeof stat === 'object') {
          data[key] = stat.total || 0;
        }
      }
    }

    // 2. 将资源添加到顶层
    // 例如: @hp, @mp, @rage
    if (sys.resources) {
      data.hp = sys.resources.hp.value;
      data.mp = sys.resources.mp.value;
      data.rage = sys.resources.rage.value;
    }

    // 3. 将战斗属性添加到顶层
    // 例如: @wuxue (武学技能), @speed
    if (sys.skills) {
      for (const [key, skill] of Object.entries(sys.skills)) {
        data[key] = skill.total || 0;
      }
    }

    return data;
  }


  /**
   * 处理内功的被动特效脚本
   */
  _applyNeigongEffects() {
    // 1. 获取当前运行的内功
    const activeNeigongId = this.system.martial.active_neigong;
    // console.log(">>> [Actor] 开始执行内功脚本检测, ActiveID:", activeNeigongId);
    if (!activeNeigongId) return;

    const item = this.items.get(activeNeigongId);
    if (!item || item.type !== "neigong") return;

    // 2. 获取当前阶段的脚本 (由 Item DataModel 算出来的 current.script)
    const script = item.system.current?.script;
    // console.log(`>>> [Actor] 运行内功: ${item.name}, 脚本内容:`, script);
    if (!script || !script.trim()) return;

    // 3. 沙盒执行脚本
    // 我们把 actor.system 暴露为 'S' 以便简写
    const sandbox = {
      actor: this,
      item: item,
      system: this.system, // 允许脚本直接修改 system 下的属性
      S: this.system, // 快捷别名
    };

    try {
      // 创建函数：Function("变量名1", "变量名2", ..., "代码体")
      const fn = new Function("actor", "item", "system", "S", script);

      // 执行函数
      fn.call(this, sandbox.actor, sandbox.item, sandbox.system, sandbox.S);
    } catch (err) {
      console.error(`内功 [${item.name}] 脚本执行错误:`, err);
      // 可以在界面上提示，但为了防止刷屏，建议只在控制台报错
    }
  }

  /**
   * 【核心功能】应用可堆叠的特效
   * @param {Object} effectData  从物品里拿出来的特效数据 (toObject后的)
   */
  async applyStackableEffect(effectData) {
    const isStackable = foundry.utils.getProperty(
      effectData,
      "flags.xjzl-system.stackable"
    );
    // 获取配置的最大层数 (默认为0，即无限)
    const maxStacksLimit =
      foundry.utils.getProperty(effectData, "flags.xjzl-system.maxStacks") || 0;
    const originalName = effectData.name; // 记录原始名字，如 "中毒"

    // 查找逻辑升级：
    // 1. 匹配名字完全一样的 (未堆叠时)
    // 2. 或者匹配 flag 中记录的原始名字 (堆叠后)
    const existingEffect = this.effects.find(
      (e) =>
        e.name === originalName ||
        e.getFlag("xjzl-system", "sourceName") === originalName
    );

    // --- 情况 A: 不可堆叠 或 找不到现有特效 ---
    if (!isStackable || !existingEffect) {
      // 如果不可堆叠且已存在，先删除旧的覆盖
      if (existingEffect && !isStackable) await existingEffect.delete();

      // 准备新数据
      if (isStackable) {
        // 如果是可堆叠的，初始化层数和原始名字标记
        foundry.utils.setProperty(effectData, "flags.xjzl-system.stacks", 1);
        foundry.utils.setProperty(
          effectData,
          "flags.xjzl-system.sourceName",
          originalName
        );
        effectData.name = `${originalName} (1)`;
      }

      return this.createEmbeddedDocuments("ActiveEffect", [effectData]);
    }

    // --- 情况 B: 可堆叠且已存在 ---
    else {
      const currentStacks =
        existingEffect.getFlag("xjzl-system", "stacks") || 1;
      // 上限检查
      if (maxStacksLimit > 0 && currentStacks >= maxStacksLimit) {
        ui.notifications.warn(
          `${this.name} 身上的 [${originalName}] 已达最大层数 (${maxStacksLimit})。`
        );
        return; // 终止堆叠
      }

      const newStacks = currentStacks + 1;

      // 计算数值 (假设 effectData.changes 里存的是单层基础值)
      const newChanges = existingEffect.changes.map((change) => {
        const baseChange = effectData.changes.find((c) => c.key === change.key);
        if (!baseChange) return change;

        const baseValue = Number(baseChange.value);
        if (!isNaN(baseValue)) {
          return { ...change, value: String(baseValue * newStacks) };
        }
        return change;
      });

      // 获取原始名字 (从 flag 取，或者从参数取)
      const sourceName =
        existingEffect.getFlag("xjzl-system", "sourceName") || originalName;

      await existingEffect.update({
        name: `${sourceName} (${newStacks})`,
        changes: newChanges,
        "flags.xjzl-system.stacks": newStacks,
        "duration.startTime": game.time.worldTime,
      });

      ui.notifications.info(
        `${this.name} 的 [${sourceName}] 叠加到了 ${newStacks} 层！`
      );
    }
  }

  /**
   * 辅助方法：获取当前角色可用的穴位列表
   */
  getAvailableAcupoints() {
    const occupiedPoints = new Set();
    this.itemTypes.qizhen.forEach(i => {
      if (i.system.equipped && i.system.acupoint) {
        occupiedPoints.add(i.system.acupoint);
      }
    });

    const available = [];
    const standardJingmai = this.system.jingmai.standard;

    for (const [key, isOpen] of Object.entries(standardJingmai)) {
      // 这里记得要把 XJZL 配置对象引进来，或者通过 CONFIG.XJZL 访问
      const labelKey = CONFIG.XJZL.acupoints[key] || key;

      if (isOpen && !occupiedPoints.has(key)) {
        available.push({
          key: key,
          label: game.i18n.localize(labelKey)
        });
      }
    }
    return available;
  }


  /**
   * 验证属性点更新是否合法
   * @param {string} fieldName - 字段名 (如 "system.stats.liliang.assigned")
   * @param {number} newValue - 新的值
   * @returns {Object} { valid: boolean, message: string, oldValue: number }
   */
  canUpdateStat(fieldName, newValue) {
    // 1. 获取旧值
    const oldValue = foundry.utils.getProperty(this, fieldName) || 0;

    // 2. 负数检查
    if (newValue < 0) {
      return { valid: false, message: "分配值不能为负数。", oldValue };
    }

    // 3. 余额检查
    const currentFree = this.system.stats.freePoints.total; // 基于 DataModel 自动计算的
    const delta = newValue - oldValue;

    if (currentFree - delta < 0) {
      return {
        valid: false,
        message: `自由属性点不足！剩余: ${currentFree}, 需要: ${delta}`,
        oldValue
      };
    }

    return { valid: true };
  }

  /**
   * 强制资源完整性检查 (HP & MP)
   * 如果 数据库原值 > 当前计算出的上限，则执行截断写入
   */
  _enforceResourceIntegrity() {
    // 1. 获取计算后的衍生数据 (包含最新的 max)
    const res = this.system.resources;

    // 2. 获取数据库里的原始数据 (Source Data)
    // 使用 getProperty 安全读取，防止数据结构缺失报错
    const sourceHP = foundry.utils.getProperty(this._source, "system.resources.hp.value") || 0;
    const sourceMP = foundry.utils.getProperty(this._source, "system.resources.mp.value") || 0;

    // 3. 准备更新对象
    const updates = {};

    // --- 检查 HP ---
    if (sourceHP > res.hp.max) {
      updates["system.resources.hp.value"] = res.hp.max;
    }

    // --- 检查 MP ---
    if (sourceMP > res.mp.max) {
      updates["system.resources.mp.value"] = res.mp.max;
    }

    // 4. 如果有需要更新的内容，一次性提交
    if (!foundry.utils.isEmpty(updates)) {
      this.update(updates);
      // 可选：在这里加个 ui.notifications.info("境界跌落，气血/内力已流失...") 更有修仙味
    }
  }
}
