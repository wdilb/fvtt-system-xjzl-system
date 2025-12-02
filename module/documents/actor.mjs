/**
 * 扩展核心 Actor 类
 */
export class XJZLActor extends Actor {

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
   * 处理内功的被动特效脚本
   */
  _applyNeigongEffects() {
    //到时候记得去掉日志
    // 1. 获取当前运行的内功
    const activeNeigongId = this.system.martial.active_neigong;
    console.log(">>> [Actor] 开始执行内功脚本检测, ActiveID:", activeNeigongId);
    if (!activeNeigongId) return;

    const item = this.items.get(activeNeigongId);
    if (!item || item.type !== "neigong") return;

    // 2. 获取当前阶段的脚本 (由 Item DataModel 算出来的 current.script)
    const script = item.system.current?.script;
    console.log(`>>> [Actor] 运行内功: ${item.name}, 脚本内容:`, script);
    if (!script || !script.trim()) return;

    // 3. 沙盒执行脚本
    // 我们把 actor.system 暴露为 'S' 以便简写
    const sandbox = {
      actor: this,
      item: item,
      system: this.system, // 允许脚本直接修改 system 下的属性
      S: this.system // 快捷别名
    };

    try {
      // 创建函数：Function("变量名1", "变量名2", ..., "代码体")
      const fn = new Function("actor", "item", "system", "S", script);
      
      // 执行函数
      fn.call(this, sandbox.actor, sandbox.item, sandbox.system, sandbox.S);
      console.log(`>>> [Actor] ${item.name} 脚本执行成功。S.combat.crit_neigong 现在是:`, this.system.combat.crit_neigong);
      
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
    const isStackable = foundry.utils.getProperty(effectData, "flags.xjzl-system.stackable");
    // 获取配置的最大层数 (默认为0，即无限)
    const maxStacksLimit = foundry.utils.getProperty(effectData, "flags.xjzl-system.maxStacks") || 0;
    const originalName = effectData.name; // 记录原始名字，如 "中毒"

    // 查找逻辑升级：
    // 1. 匹配名字完全一样的 (未堆叠时)
    // 2. 或者匹配 flag 中记录的原始名字 (堆叠后)
    const existingEffect = this.effects.find(e => 
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
            foundry.utils.setProperty(effectData, "flags.xjzl-system.sourceName", originalName);
            effectData.name = `${originalName} (1)`;
        }
        
        return this.createEmbeddedDocuments("ActiveEffect", [effectData]);
    } 
    
    // --- 情况 B: 可堆叠且已存在 ---
    else {
        const currentStacks = existingEffect.getFlag("xjzl-system", "stacks") || 1;
        // 上限检查
        if (maxStacksLimit > 0 && currentStacks >= maxStacksLimit) {
            ui.notifications.warn(`${this.name} 身上的 [${originalName}] 已达最大层数 (${maxStacksLimit})。`);
            return; // 终止堆叠
        }

        const newStacks = currentStacks + 1;
        
        // 计算数值 (假设 effectData.changes 里存的是单层基础值)
        const newChanges = existingEffect.changes.map(change => {
            const baseChange = effectData.changes.find(c => c.key === change.key);
            if (!baseChange) return change;

            const baseValue = Number(baseChange.value);
            if (!isNaN(baseValue)) {
                return { ...change, value: String(baseValue * newStacks) };
            }
            return change;
        });

        // 获取原始名字 (从 flag 取，或者从参数取)
        const sourceName = existingEffect.getFlag("xjzl-system", "sourceName") || originalName;

        await existingEffect.update({
            "name": `${sourceName} (${newStacks})`,
            "changes": newChanges,
            "flags.xjzl-system.stacks": newStacks,
            "duration.startTime": game.time.worldTime 
        });
        
        ui.notifications.info(`${this.name} 的 [${sourceName}] 叠加到了 ${newStacks} 层！`);
    }
  }
}
