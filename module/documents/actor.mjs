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
    super.prepareDerivedData();
    
    // 执行完 DataModel 的基础计算后，我们来处理复杂的“脚本特效”
    this._applyNeigongEffects();
  }

  /**
   * 处理内功的被动特效脚本
   */
  _applyNeigongEffects() {
    // 1. 获取当前运行的内功
    const activeNeigongId = this.system.martial.active_neigong;
    if (!activeNeigongId) return;

    const item = this.items.get(activeNeigongId);
    if (!item || item.type !== "neigong") return;

    // 2. 获取当前阶段的脚本 (由 Item DataModel 算出来的 current.script)
    const script = item.system.current?.script;
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
      
    } catch (err) {
      console.error(`内功 [${item.name}] 脚本执行错误:`, err);
      // 可以在界面上提示，但为了防止刷屏，建议只在控制台报错
    }
  }
}
