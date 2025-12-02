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
}
