/**
 * 扩展核心 Actor 类
 */
import { SCRIPT_TRIGGERS } from "../data/common.mjs";
import { XJZLMacros } from "../utils/macros.mjs";

// 将构造器缓存在模块作用域，避免每次 runScripts 重复创建
const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
const renderTemplate = foundry.applications.handlebars.renderTemplate;
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
  * 数据库更新拦截器 (_preUpdate)
  * 在数据写入数据库前触发，用于验证逻辑或修改数据
  * @param {Object} changed - 即将更新的数据增量
  * @param {Object} options - 更新选项
  * @param {string} user - 操作用户 ID
  */
  async _preUpdate(changed, options, user) {
    await super._preUpdate(changed, options, user);

    // 只有当 system 数据发生变化时才检查
    if (!changed.system) return;

    // 辅助函数：检查并阻止资源恢复
    // path: 资源的路径 (例如 "resources.hp.value")
    // flagKey: 对应的 Flag 键名 (例如 "noRecoverHP")
    // label: 报错时显示的资源名称
    const blockRecovery = (path, flagKey, label) => {
      // 1. 获取新值 (从 changed 对象中查找，支持嵌套或扁平写法)
      const newValue = foundry.utils.getProperty(changed.system, path);

      // 如果这次更新不包含这个属性，直接跳过
      if (newValue === undefined) return;

      // 2. 获取旧值 (当前 Actor 的值)
      const currentValue = foundry.utils.getProperty(this.system, path);

      // 3. 判断逻辑：如果数值增加 (New > Old) 且 有禁疗 Flag
      if (newValue > currentValue && this.xjzlStatuses[flagKey]) {
        // 4. 核心拦截：直接从 changed 对象中删除该字段
        // 这样 FVTT 就认为“这个字段没有变化”，从而阻止更新
        // 注意：我们需要处理 flatten 后的键名，通常 safe 的做法是直接操作 changed 对象结构

        // 简单处理：如果 changed 是扁平的 "system.resources.hp.value"
        if (`system.${path}` in changed) delete changed[`system.${path}`];

        // 如果 changed 是嵌套的 { system: { resources: { hp: { value: ... } } } }
        // 使用 delete foundry.utils.getProperty 是不行的，必须逐层查找删除，或者直接覆写为旧值
        // 最稳妥的做法：强制把新值改回旧值
        foundry.utils.setProperty(changed.system, path, currentValue);

        // 5. 提示用户
        ui.notifications.warn(`${this.name} 处于 [${game.i18n.localize("XJZL.Status." + capitalize(flagKey))}] 状态，无法恢复${label}！`);
      }
    };

    // 辅助：首字母大写用于匹配 Locale Key (noRecoverHP -> NoRecoverHP)
    const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    // --- 执行检查 ---

    // 1. 禁疗 (HP)
    blockRecovery("resources.hp.value", "noRecoverHP", "气血");

    // 2. 气滞 (MP/Neili)
    blockRecovery("resources.mp.value", "noRecoverNeili", "内力");

    // 3. 不怒 (Rage)
    blockRecovery("resources.rage.value", "noRecoverRage", "怒气");
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
   * @override 
   * @description
   *  1. 根据角色类型设置默认token状态
   *  2. 统一设置（例如显示名字）
  */
  async _preCreate(data, options, user) {
    // 调用父类逻辑
    await super._preCreate(data, options, user);

    // 获取原型 Token 的初始数据
    const prototypeToken = {};

    // === 1. 根据角色类型设置默认关联状态 ===
    if (data.type === "character") {
      // 玩家角色：默认【关联】
      prototypeToken.actorLink = true;

      // 玩家角色：默认【友方】 (1 = Friendly, 0 = Neutral, -1 = Hostile)
      prototypeToken.disposition = CONST.TOKEN_DISPOSITIONS.FRIENDLY;

      // 可选：玩家默认开启视野
      // prototypeToken.sight = { enabled: true };
    }
    else if (data.type === "npc") {
      // NPC：默认【不关联】
      prototypeToken.actorLink = false;

      // NPC：默认【敌对】
      prototypeToken.disposition = CONST.TOKEN_DISPOSITIONS.HOSTILE;
    }

    // === 2. 统一设置 ===
    // 鼠标悬停时显示名字 (20 = Hover, 40 = Always, 0 = None)
    prototypeToken.displayName = CONST.TOKEN_DISPLAY_MODES.HOVER;

    // 默认显示血条 (50 = Always, 40 = Hover Owner, etc.)
    // prototypeToken.displayBars = CONST.TOKEN_DISPLAY_MODES.ALWAYS;

    // 将修改应用到当前正在创建的 Actor 上
    this.updateSource({ prototypeToken });
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

  prepareBaseData() {
    super.prepareBaseData();
    // =====================================================
    // 检测让装备无效的flags，如果不在这里加载可能会因为加载AE顺序的问题导致flags生效的时候其他装备的AE已经被计算过了的问题
    // =====================================================

    // 我们不再检查 slug === 'poyi'
    // 而是检查：是否有任何未禁用的特效，试图修改 'ignoreArmorEffects' 这个 Flag
    const targetFlagKey = "flags.xjzl-system.ignoreArmorEffects";

    this.isArmorBroken = this.effects.some(e => {
      // 1. 基本过滤：特效必须是开启的
      if (e.disabled) return false;

      // 2. 扫描 Changes：看有没有针对目标 Flag 的修改
      // 注意：e.changes 是一个数组对象
      return e.changes.some(change => change.key === targetFlagKey);
    });
  }

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
    // 需要特殊处理为数字的 Key 列表 (战斗类)
    const numericCombatFlags = ["attackLevel", "grantAttackLevel", "feintLevel", "defendFeintLevel",
      "bleedOnHit", "wuxueBleedOnHit", "bloodLossLevel"];
    for (const key of Object.keys(statusFlags)) {
      // 检查当前是否有这个 Flag
      // 如果是那数值型的 Key，单独处理，否则按布尔处理
      // 判定逻辑：如果是战斗计数器 OR 是自动回复(regen开头)，都转为数字
      if (numericCombatFlags.includes(key) || key.startsWith("regen")) {
        // 初始化数值计数器 (支持 AE 的 ADD 模式)
        // 注意：getFlag 读取出来的可能是 undefined，必须保底为 0
        this.xjzlStatuses[key] = parseInt(this.getFlag("xjzl-system", key)) || 0;
      } else {
        // 布尔型
        this.xjzlStatuses[key] = this.getFlag("xjzl-system", key) || false;
      }
    }

    // 处理检定状态 (Check Flags)
    // 来源: CONFIG.XJZL.checkFlags
    // 特性: 全部视为整数 (Level)
    const checkFlags = CONFIG.XJZL.checkFlags || {};

    for (const key of Object.keys(checkFlags)) {
      // 直接读取并转为 Int，默认为 0
      this.xjzlStatuses[key] = parseInt(this.getFlag("xjzl-system", key)) || 0;
    }

    // ----------------------------------------------------
    // PHASE 2: 脚本干预 (Script Execution)
    // ----------------------------------------------------
    // 运行 [被动常驻] 类型的脚本 (内功、装备等)
    // 因为 Pass 1 已经执行，脚本可以安全地读取计算后的属性：
    // 此时不需要上下文 Item，传入空对象即可
    // 脚本可以修改 this.system 下的属性，也可以修改 this.xjzlStatuses
    this.runScripts(SCRIPT_TRIGGERS.PASSIVE, {});

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

    // 3. 创建战斗属性的快捷方式 (Combat Shortcuts)
    // 你的计算代码把结果存为了 xxxTotal，我们可以做一些简化映射
    if (sys.combat) {
      // 先攻 (Initiative)
      // 映射后，公式里可以用 @init 或 @combat.initiativeTotal
      data.init = sys.combat.initiativeTotal || 0;

      // 速度 (Speed) -> @speed
      data.speed = sys.combat.speedTotal || 0;

      // 闪避 (Dodge) -> @dodge
      data.dodge = sys.combat.dodgeTotal || 0;

      // 命中 (Hit)
      data.hitWai = sys.combat.hitWaigongTotal || 0;
      data.hitNei = sys.combat.hitNeigongTotal || 0;

      // 暴击 (Crit)
      data.critWai = sys.combat.critWaigongTotal || 0;
      data.critNei = sys.combat.critNeigongTotal || 0;
    }

    return data;
  }

  /**
   * 重写：决定哪些特效应该显示在 Token 图标上，为了在token上显示那些没有持续时间的非被动的AE
   * 核心逻辑：显示所有“临时特效”以及所有“非被动传输的特效”
   */
  get temporaryEffects() {
    // 1. 获取所有当前生效的特效
    const effects = this.appliedEffects;

    // 2. 过滤
    return effects.filter(e => {
      // A. 如果特效被禁用，不显示
      if (e.disabled) return false;

      // B. 如果没有图标，或者图标是默认的神秘人，不显示
      if (!e.img || e.img === "icons/svg/mystery-man.svg") return false;

      // C. 核心修改：
      // 情况1: 是系统认定的临时特效 (有持续时间 或 是通用状态) -> 显示
      if (e.isTemporary) return true;

      // 情况2: 是“非传输”特效 (即 transfer: false) -> 显示
      // 这意味着它是通过脚本、消耗品或技能“施加”在身上的，而不是装备自带的
      // 满足“持续到战斗结束的Buff”这一需求
      if (e.transfer === false) return true;

      // 其他情况 (如装备自带的无时限被动) -> 不显示
      return false;
    });
  }

  /* -------------------------------------------- */
  /*  核心脚本引擎 (Script Engine)                 */
  /* -------------------------------------------- */

  /**
   * [核心] 收集当前 Actor 身上所有符合触发条件的脚本
   * @param {String} trigger - 触发时机 (来自 SCRIPT_TRIGGERS, 如 'attack')
   * @param {Object|Item} [contextItem] - (可选) 当前正在交互的具体对象 (如招式数据 move，或物品 item)
   * @returns {Array} 脚本对象数组 [{ script, label, source }]
   */
  collectScripts(trigger, contextItem = null) {
    const scripts = [];

    // 1. 内功 (Neigong) - 从 active_neigong 指向的 Item 中读取
    const neigongId = this.system.martial?.active_neigong;
    if (neigongId) {
      const neigong = this.items.get(neigongId);
      // 注意：读取的是 system.current.scripts (这是我们在 DataModel 里算好的当前阶段数据)
      if (neigong?.system?.current?.scripts) {
        neigong.system.current.scripts.forEach(s => {
          if (s.trigger === trigger && s.active) {
            scripts.push({
              script: s.script,
              label: s.label || neigong.name,
              source: neigong
            });
          }
        });
      }
    }

    // 2. 装备 (Weapon, Armor, Qizhen) - 筛选已装备的

    // 获取破衣标记
    // 注意：我们在 applyDamage 前已经把 flags 解析到 xjzlStatuses 里了
    // 但在 collectScripts 运行时机可能不同，最稳妥是用 getFlag
    const isArmorBroken = this.getFlag("xjzl-system", "ignoreArmorEffects");

    // 定义受破衣影响的部位
    // 假设你的 Armor DataModel 里，部位存储在 system.type 中
    // 如果存在 system.slot，请替换为 i.system.slot
    const bodySlots = ["head", "top", "bottom", "shoes"];

    const equipments = this.items.filter(i =>
      ["weapon", "armor", "qizhen"].includes(i.type) &&
      i.system.equipped &&
      i.system.scripts // 确保有脚本字段
    );

    for (const item of equipments) {
      // --- 破衣拦截逻辑 ---
      if (isArmorBroken && item.type === "armor") {
        // 进一步检查是否属于身体部位 (排除掉护身符等可能也是 armor 类型的特殊物品)
        if (bodySlots.includes(item.system.type)) {
          continue; // 跳过此物品，不收集其脚本
        }
      }
      item.system.scripts.forEach(s => {
        if (s.trigger === trigger && s.active) {
          scripts.push({
            script: s.script,
            label: s.label || item.name,
            source: item
          });
        }
      });
    }

    // =====================================================
    // 3. 当前激活的架招 (Active Stance)
    // =====================================================
    // 架招开启后，应当视为常驻被动效果，直到关闭
    const martial = this.system.martial;
    // 检查：架招激活 + 有记录的 Move ID + 有记录的 Item ID
    if (martial?.stanceActive && martial?.stance && martial?.stanceItemId) {

      const wuxueItem = this.items.get(martial.stanceItemId);

      if (wuxueItem) {
        // 在该武学中找到对应的招式
        const stanceMove = wuxueItem.system.moves.find(m => m.id === martial.stance);

        if (stanceMove && stanceMove.scripts) {
          stanceMove.scripts.forEach(s => {
            // 同样检查触发器和开关
            if (s.trigger === trigger && s.active) {
              scripts.push({
                script: s.script,
                label: s.label || stanceMove.name,
                source: wuxueItem // 源头依然归属于该武学物品
              });
            }
          });
        }
      }
    }

    // ==========================================================
    // 4. 武学全局被动 (极少数武学存在被动效果)
    // ==========================================================
    // 只有在 PASSIVE 时机，我们才遍历所有武学，寻找是否有被动脚本。
    // 这样不会影响战斗时机 (ATTACK/HIT) 的性能。
    if (trigger === SCRIPT_TRIGGERS.PASSIVE) {
      // 使用 itemTypes.wuxue 快速访问，避免遍历所有 items
      const allWuxues = this.itemTypes.wuxue || [];

      for (const item of allWuxues) {
        // 排除掉已经作为架招处理过的物品 (避免重复叠加)
        if (item.id === martial?.stanceItemId && martial?.stanceActive) continue;

        // 直接检查 system.scripts 数组长度，如果是空数组直接跳过，不进入 forEach
        // (DataModel 的数组即使为空也是一个 Array 实例，length 访问极快)
        const itemScripts = item.system.scripts;
        if (!itemScripts || itemScripts.length === 0) continue;

        // 只有真的有脚本时，才进入内层循环
        for (const s of itemScripts) {
          if (s.trigger === trigger && s.active) {
            scripts.push({
              script: s.script,
              label: `${s.label} (${item.name})`,
              source: item
            });
          }
        }
      }
    }

    // 5. 上下文对象 (Context Item/Move)
    // 这是在 roll()或者其他调用的时候传进来的，比如当前正在施展的招式
    if (contextItem && contextItem.scripts && Array.isArray(contextItem.scripts)) {
      contextItem.scripts.forEach(s => {
        if (s.trigger === trigger && s.active) {
          scripts.push({
            script: s.script,
            label: s.label || "招式特效",
            source: contextItem
          });
        }
      });
    }

    return scripts;
  }

  /**
   * [核心] 执行指定时机的脚本
   * @param {String} trigger - 触发时机
   * @param {Object} context - 传递给脚本的上下文变量 (如 { actor, target, flags ... })
   * @param {Object|Item} [contextItem] - 用于 collectScripts 的上下文对象
   */
  async runScripts(trigger, context = {}, contextItem = null) {
    // 1. 收集脚本
    const scriptsToRun = this.collectScripts(trigger, contextItem);
    if (!scriptsToRun.length) return;

    // 2. 准备基础沙盒变量
    const sandbox = {
      ...context,           // 展开传入的上下文
      args: context,        // 将上下文打包为 args 对象，方便传递给辅助函数
      actor: this,          // 始终提供 actor
      system: this.system,  // 始终提供 system
      S: this.system,       // 简写别名
      console: console,     // 允许打印日志
      game: game,           // 允许访问 game
      ui: ui,               // 允许访问 ui
      trigger: trigger,      // 告诉脚本当前是什么时机
      // 注入宏工具
      Macros: XJZLMacros  // 脚本里可以用 Macros.requestSave(...)
    };

    // 3. 决定执行模式 (同步/异步)
    // Passive 和 Calc 和 CHECK 必须同步运行，不能 await，否则会阻塞数据计算
    const isSync = [SCRIPT_TRIGGERS.PASSIVE, SCRIPT_TRIGGERS.CALC, SCRIPT_TRIGGERS.CHECK].includes(trigger);

    if (isSync) {
      this._runScriptsSync(scriptsToRun, sandbox);
    } else {
      await this._runScriptsAsync(scriptsToRun, sandbox);
    }
  }

  /**
   * [内部] 同步执行 (用于 Passive, Calc)
   */
  _runScriptsSync(scripts, sandbox) {
    for (const entry of scripts) {
      try {
        // 动态注入 thisItem，指向当前脚本所属的物品
        // 这样脚本里写 thisItem.system.xxx 就能读到自己的数据
        // 主要用于类似装备上带的受击特效等没有传入 contextItem 的情况，可以找到触发的物品
        sandbox.thisItem = entry.source;
        // 构建函数: new Function("变量名1", ..., "脚本内容")
        const paramNames = Object.keys(sandbox);
        const paramValues = Object.values(sandbox);
        // console.log(`[XJZL] 执行脚本 [${entry.label}]:`, entry.script);
        // 这里的 entry.script 就是用户填写的 JS 代码字符串
        const fn = new Function(...paramNames, entry.script);
        fn(...paramValues);
      } catch (err) {
        console.error(`[XJZL] 同步脚本错误 [${entry.label}]:`, err);
        // 可选：开发模式下弹出提示
        // ui.notifications.error(`脚本错误: ${entry.label}`);
      }
    }
  }

  /**
   * [内部] 异步执行 (用于 Attack, Hit, TurnStart...)
   */
  async _runScriptsAsync(scripts, sandbox) {

    for (const entry of scripts) {
      try {
        // 动态注入 thisItem，指向当前脚本所属的物品
        // 这样脚本里写 thisItem.system.xxx 就能读到自己的数据
        // 主要用于类似装备上带的受击特效等没有传入 contextItem 的情况，可以找到触发的物品
        sandbox.thisItem = entry.source;
        const paramNames = Object.keys(sandbox);
        const paramValues = Object.values(sandbox);
        // console.log(`[XJZL] 执行脚本 [${entry.label}]:`, entry.script);
        const fn = new AsyncFunction(...paramNames, entry.script);
        await fn(...paramValues);
      } catch (err) {
        console.error(`[XJZL] 异步脚本错误 [${entry.label}]:`, err);
        ui.notifications.error(`特效脚本执行失败: ${entry.label}`);
      }
    }
  }

  /* -------------------------------------------- */
  /*  其他辅助方法 (Helpers)                       */
  /* -------------------------------------------- */

  /**
   * 属性检定配置弹窗
   * @param {Object} context - 包含显示所需的数据
   */
  async _promptAttributeTestConfig(context) {
    const formId = `attr-test-${foundry.utils.randomID()}`;

    // 合并 ID 到上下文
    const templateData = { ...context, formId };

    const content = await renderTemplate("systems/xjzl-system/templates/apps/attribute-test-config.hbs", templateData);

    return foundry.applications.api.DialogV2.wait({
      window: { title: `${context.label} 检定配置`, icon: "fas fa-dice-d20" },
      content: content,

      render: (event) => {
        const root = document.getElementById(formId);
        if (!root) return;

        root.addEventListener("click", (e) => {
          const btn = e.target.closest("button[data-action]");
          if (!btn) return;
          e.preventDefault();

          const action = btn.dataset.action;
          const targetName = btn.dataset.target;
          const input = root.querySelector(`input[name="${targetName}"]`);

          if (input) {
            let val = parseInt(input.value) || 0;
            if (action === "increase") val++;
            else if (action === "decrease") val--;
            input.value = val;
          }
        });
      },

      buttons: [{
        action: "ok",
        label: "投掷",
        icon: "fas fa-check",
        default: true,
        callback: () => {
          const root = document.getElementById(formId);
          if (!root) return { bonus: 0, level: 0 };

          return {
            bonus: parseInt(root.querySelector('[name="bonus"]').value) || 0,
            level: parseInt(root.querySelector('[name="level"]').value) || 0
          };
        }
      }],
      rejectClose: false,
      close: () => null
    });
  }

  /**
   * 执行属性或技能检定
   * 
   * @param {String} key 属性或技能的键名 (如 "liliang", "qiaoshou")
   * @param {Object} options 额外配置
   * @param {Number} options.level 临时优劣势层级 (正数=优, 负数=劣)
   * @param {Number} options.bonus 额外数值加值
   * @param {String} options.flavor 自定义 Flavor 文本
   * @returns {Promise<Roll>} 返回 Roll 实例
   */
  async rollAttributeTest(key, options = {}) {
    const sys = this.system;

    let labelKey = "";
    let val = 0;          // 基础等级 (属性值/技能总值/技艺总值)
    let extraBonus = 0;   // 内部额外加值 (如技艺书提供的检定加值，非玩家临时输入的)
    let type = "unknown";

    // 1. 识别类型 (Stat vs Skill)
    // 直接使用 Config 判断，比检查 sys 对象更准确
    if (CONFIG.XJZL.attributes[key]) {
      val = sys.stats[key]?.total || 0;
      labelKey = CONFIG.XJZL.attributes[key];
      type = "stat";
    }
    else if (CONFIG.XJZL.skills[key]) {
      val = sys.skills[key]?.total || 0;
      labelKey = CONFIG.XJZL.skills[key];
      type = "skill";
    }
    else if (CONFIG.XJZL.arts[key]) {
      const art = sys.arts[key];
      // 基础值 = 技艺等级
      val = art?.total || 0;

      // 技艺特有的检定加成 (Buff + 书籍)
      // 这些加成不加在等级上，但加在检定结果上
      extraBonus = (art?.checkMod || 0) + (art?.bookCheck || 0);

      labelKey = CONFIG.XJZL.arts[key];
      type = "art";
    }
    else {
      ui.notifications.warn(`未知的属性/技能键名: ${key}`);
      return null;
    }

    const label = game.i18n.localize(labelKey);

    // =====================================================
    // 1.5 玩家交互弹窗
    // =====================================================
    let sysLevel = (this.xjzlStatuses.globalCheckLevel || 0);
    const selfFlagKey = `${key}CheckLevel`;
    sysLevel += (this.xjzlStatuses[selfFlagKey] || 0);

    let manualBonus = options.bonus || 0;
    let manualLevel = options.level || 0;

    // 除非显式跳过，否则弹出配置框
    if (!options.skipDialog) {

      // 将系统当前的状态传给弹窗显示
      const context = {
        label: label,
        baseVal: val,        // 当前面板等级
        sysBonus: extraBonus, // 系统额外修正
        sysLevel: sysLevel,   // 系统优劣势
        defaultBonus: manualBonus,
        defaultLevel: manualLevel
      };
      const dialogConfig = await this._promptAttributeTestConfig(context);

      // 如果玩家点了关闭/取消，中止流程
      if (!dialogConfig) return null;

      // 这里的逻辑是：弹窗里的值 是 最终的手动修正值
      // 如果 options.bonus 传了 2，弹窗里默认显示 2。如果玩家改成了 3，那就是 3。
      // 所以我们直接覆盖，而不是累加 (因为 defaultBonus 已经传进去了)
      manualBonus = dialogConfig.bonus;
      manualLevel = dialogConfig.level;
    }

    // =====================================================
    // 2. 计算优劣势层级 (Level Calculation)
    // =====================================================
    // 最终层级 = 系统层级 + 手动层级
    const totalLevel = sysLevel + manualLevel;

    // =====================================================
    // 3. 构建骰子公式
    // =====================================================
    let dice = "1d20";
    let rollTypeLabel = "";

    if (totalLevel > 0) {
      dice = "2d20kh";
      rollTypeLabel = " (优势)";
    }
    else if (totalLevel < 0) {
      dice = "2d20kl";
      rollTypeLabel = " (劣势)";
    }

    // 构造公式: 1d20 + @val + @extra(内部加值) + @bonus(手动加值)
    // 为了公式整洁，只有当值不为0时才拼接到字符串里
    let formula = `${dice} + @val`;
    if (extraBonus !== 0) formula += " + @extra";
    if (manualBonus !== 0) formula += " + @bonus";

    const rollData = {
      val: val,
      extra: extraBonus,
      bonus: manualBonus
    };

    // 4. 执行投掷
    const roll = new Roll(formula, rollData);
    await roll.evaluate();

    // 5. 准备消息
    const flavorText = options.flavor || `${this.name} 进行 ${label} 检定${rollTypeLabel}`;

    // 在下面的tomessage会自动调用动画，所以这里可以不用调用了
    // if (game.dice3d) game.dice3d.showForRoll(roll, game.user, true);

    const messageData = {
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: flavorText,
      flags: {
        "xjzl-system": {
          type: "attribute-test", // 消息类型
          attribute: key,         // 检定 Key
          testType: type,         // stat / skill
          level: totalLevel       // 最终层级 (方便 Debug)
        }
      }
    };

    await roll.toMessage(messageData);
    return roll;
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

  /**
   * [核心] 伤害结算处理函数
   * 职责：计算减伤 -> 运行脚本 -> 扣除资源 -> 返回结果
   * @param {Object} data - 伤害参数包
   * @returns {Object} 结算结果 { finalDamage, hpLost, mpLost, isDead, ... }
   */
  async applyDamage(data) {
    const {
      amount,             // 原始伤害 (面板)
      type = "waigong",   // 伤害类型
      attacker = null,    // 攻击者 Actor
      isHit = true,       // 是否命中
      isCrit = false,     // 是否暴击
      applyCritDamage = true, // 是否应用暴击倍率
      isBroken = false,   // 是否被破防
      ignoreBlock = false,   // 强制无视格挡
      ignoreDefense = false,  // 强制无视防御
      ignoreStance = false,  // 强制无视架招
      isSkill = true // false表示普通攻击
    } = data;

    // 0. 未命中直接返回
    if (!isHit) {
      // 即使闪避也执行 DAMAGED 脚本 (用于触发"闪避后给敌人上Debuff"等)
      // 构造一个基础上下文，跳过复杂的减伤计算
      const missContext = {
        baseDamage: amount,
        damage: 0,
        type: type,
        attacker: attacker,
        target: this, // 明确传入自己
        isHit: false,
        isCrit: false,
        isBroken: isBroken,
        ignoreBlock: ignoreBlock,
        ignoreDefense: ignoreDefense,
        ignoreStance: ignoreStance,
        output: { damage: 0, abort: false }
      };

      await this.runScripts(SCRIPT_TRIGGERS.DAMAGED, missContext);
      // 飘字：闪避
      if (this.token?.object) {
        canvas.interface.createScrollingText(this.token.object.center, "闪避", {
          direction: 0, fontSize: 32, fill: "#ffffff", stroke: "#000000", strokeThickness: 4
        });
      }
      return { finalDamage: 0, hpLost: 0, isDead: false };
    }

    const sys = this.system;
    const combat = sys.combat;

    // =====================================================
    // 1. 计算理论伤害 (Pre-Mitigation)
    // =====================================================
    let calculatedDamage = amount;

    // A. 暴击修正 (如果启用)
    // 规则：暴击造成2倍伤害
    if (isCrit && applyCritDamage) {
      calculatedDamage = Math.floor(calculatedDamage * 2);
    }

    // =====================================================
    // 2. 计算减伤 (Mitigation)
    // 逻辑：伤害 - 防御 - 格挡 - 抗性
    // =====================================================

    // B. 基础防御 (Defense)
    let defenseVal = 0;
    if (!ignoreDefense) {
      if (type === "waigong") defenseVal = combat.defWaigongTotal || 0;
      else if (type === "neigong") defenseVal = combat.defNeigongTotal || 0;
    }

    // C. 格挡 (Block)
    // 如果强制无视(ignoreBlock)，则格挡无效， 不能用isBroken来判断，因为我们存在即使没有架招也生效格挡的特效（无敌的密宗瑜伽，哎)
    let blockVal = 0;
    if (!ignoreBlock) {
      // 读取总格挡
      let total = combat.blockTotal || 0;

      // 2. 如果无视架招 (且没无视格挡)，则扣除架招部分
      if (ignoreStance) {
        // 安全读取 stanceBlockValue (我们在 DataModel 里刚加的)
        const stancePart = combat.stanceBlockValue || 0;
        total = Math.max(0, total - stancePart);
      }

      blockVal = total;
    }

    // D. 抗性 (Resistance)
    const resMap = sys.combat.resistances;
    const globalRes = resMap.global.total || 0;
    // 招式抗性
    // 只有当 isSkill 为 true 时才生效
    const skillRes = isSkill ? (resMap.skill?.total || 0) : 0;
    let specificRes = 0;
    // 根据类型映射抗性
    switch (type) {
      case "bleed": specificRes = resMap.bleed.total; break;
      case "poison": specificRes = resMap.poison.total; break;
      case "fire": specificRes = resMap.fire.total; break;
      case "mental": specificRes = resMap.mental.total; break;
      case "liushi": specificRes = resMap.liushi.total; break;
      // 内外功没有特定抗性字段
      default: specificRes = 0; break;
    }

    const totalRes = globalRes + specificRes + skillRes;

    // E. 执行减法
    // 公式：(伤害 - 防御 - 格挡 - 抗性)
    let reducedDamage = calculatedDamage - defenseVal - blockVal - totalRes;
    reducedDamage = Math.max(1, reducedDamage); // 保底为1

    // =====================================================
    // 3. 执行脚本 (Script: DAMAGED)
    // =====================================================
    // 允许脚本在扣血前最后一次修改伤害 (例如：无敌盾、伤害吸收、反伤)
    const damageContext = {
      baseDamage: amount, //基础伤害也传过去
      damage: reducedDamage, // 当前计算值
      type: type,
      attacker: attacker,
      isHit: isHit,
      isCrit: isCrit,
      isBroken: isBroken,
      ignoreBlock: ignoreBlock,
      ignoreDefense: ignoreDefense,
      ignoreStance: ignoreStance,
      // 允许脚本修改的输出对象
      output: {
        damage: reducedDamage,
        abort: false // 脚本设为 true 可完全免疫
      }
    };

    await this.runScripts(SCRIPT_TRIGGERS.DAMAGED, damageContext);
    // 脚本可能强行中止 (如无敌)
    if (damageContext.output.abort) {
      if (this.token?.object) {
        canvas.interface.createScrollingText(this.token.object.center, "免疫", {
          fill: "#ffff00", stroke: "#000000", strokeThickness: 4
        });
      }
      return { finalDamage: 0, hpLost: 0, isDead: false };
    }

    // 获取脚本修改后的最终伤害
    let finalDamage = Math.floor(damageContext.output.damage);

    // =====================================================
    // 4. 资源扣除 (Deduction)
    // 优先级：护体 -> 气血 -> (濒死) -> 内力
    // =====================================================
    // 在任何计算和更新之前，拍摄当前血量的快照
    // 用于后续判断是否是从“活”变“死”
    const originalHP = sys.resources.hp.value;
    // --- 计算流失伤害 (Liushi Damage) ---
    // 逻辑：受伤时触发，受流失抗性抵消，随后进入通用扣除流程
    let liushiDamage = 0;
    // 只有常规伤害 > 0 (造成了实际伤害) 时才触发“受伤流失”
    if (finalDamage > 0) {
      // 1. 读取 Flags 
      liushiDamage += (this.xjzlStatuses.bleedOnHit || 0);

      if (["waigong", "neigong"].includes(type)) {
        liushiDamage += (this.xjzlStatuses.wuxueBleedOnHit || 0);
      }

      // 2. 应用流失抗性
      if (liushiDamage > 0) {
        const liushiRes = sys.combat.resistances?.liushi?.total || 0;
        liushiDamage = Math.max(0, liushiDamage - liushiRes);
      }
    }
    // 准备更新数据包 (Batch Update)
    const updates = {};
    // 获取当前资源快照 (用于连续计算)
    let currentHuti = sys.resources.huti ?? 0;
    let currentHP = sys.resources.hp.value;
    let currentMP = sys.resources.mp.value;

    // 追踪损失量 (用于统计和更新)
    // 我们把 常规损失 和 流失损失 分开统计，以便飘字区分
    let stdHutiLost = 0, stdHpLost = 0, stdMpLost = 0;
    let liuHutiLost = 0, liuHpLost = 0, liuMpLost = 0;
    let isDying = false; // 是否进入濒死
    let isDead = false;  // 是否彻底死亡

    /**
     * [内部辅助] 单次伤害扣除逻辑
     * @param {number} dmg - 待扣除伤害值
     * @param {number} ratio - 内力抵扣比率 (5:1 或 1:1)
     * @returns {Object} { hutiLost, hpLost, mpLost } 本次扣除的具体数值
     */
    const applyDeduction = (dmg, ratio) => {
      let res = { h: 0, p: 0, m: 0 }; // 局部统计
      if (dmg <= 0) return res;

      let remaining = dmg;

      // A. 扣除护体真气 (Huti)
      if (currentHuti > 0 && remaining > 0) {
        const hTake = Math.min(currentHuti, remaining);
        currentHuti -= hTake;
        res.h += hTake;
        remaining -= hTake;
      }

      // B. 扣除气血 (HP)
      if (remaining > 0) {
        if (currentHP > remaining) {
          // 够扣，还没死
          currentHP -= remaining;
          res.p += remaining;
          remaining = 0;
        } else {
          // 不够扣，触发濒死
          const hpTake = currentHP;
          currentHP = 0; // 血归零
          res.p += hpTake;
          remaining -= hpTake;
          isDying = true; // 只要血归零，就算濒死
        }
      }

      // C. 扣内力 (濒死溢出)
      if (remaining > 0) {
        const mpDamage = Math.ceil(remaining / ratio);
        const mpTake = Math.min(currentMP, mpDamage);

        currentMP -= mpTake;
        res.m += mpTake;

        // 如果还不够扣 -> 死亡
        if (mpDamage > mpTake) {
          isDead = true;
        }
      }
      return res;
    }
    // --- 第一轮：常规伤害 ---
    // 内/外功 5:1，其他 1:1
    const standardRatio = (type === "waigong" || type === "neigong") ? 5 : 1;
    const stdRes = applyDeduction(finalDamage, standardRatio);
    stdHutiLost = stdRes.h; stdHpLost = stdRes.p; stdMpLost = stdRes.m;

    // --- 第二轮：流失伤害 ---
    // 转扣内力永远是 1:1 (特殊伤害)
    const liuRes = applyDeduction(liushiDamage, 1);
    liuHutiLost = liuRes.h; liuHpLost = liuRes.p; liuMpLost = liuRes.m;

    // 汇总总损失 (用于更新数据库)
    const totalHutiLost = stdHutiLost + liuHutiLost;
    const totalHpLost = stdHpLost + liuHpLost;
    const totalMpLost = stdMpLost + liuMpLost;

    // 生成数据库更新包
    if (totalHutiLost > 0) updates["system.resources.huti"] = currentHuti;
    if (totalHpLost > 0) updates["system.resources.hp.value"] = currentHP;
    if (totalMpLost > 0) updates["system.resources.mp.value"] = currentMP;

    // 执行数据库更新
    if (!foundry.utils.isEmpty(updates)) {
      await this.update(updates);
    }

    // =====================================================
    // 5. 状态触发脚本 (Triggers)
    // =====================================================

    // 准备上下文，允许脚本修改 prevent 标记来阻止状态结算
    // 虽然 runScripts 会自动注入 actor: this，但显式传入 target 符合战斗脚本习惯
    const statusCtx = {
      attacker: attacker,
      target: this,     // 传入自己，方便脚本操作 (如 this.update)
      damage: finalDamage,
      preventDying: false, // [输出参数] 脚本设为 true 可阻止濒死判定
      preventDeath: false  // [输出参数] 脚本设为 true 可阻止死亡判定
    };

    // A. 濒死触发
    // 判断条件：原本活着(currentHP > 0) 且 本次结算判定为濒死(isDying)
    if (isDying && originalHP > 0) {
      await this.runScripts(SCRIPT_TRIGGERS.DYING, statusCtx);

      // 检查脚本是否挽救了角色
      if (statusCtx.preventDying) {
        isDying = false; // 取消濒死标记
        // 注意：脚本里应该已经写了回血逻辑，否则血量还是0
      } else {
        // 把触发濒死的代码移到了这里，因为有可能有特效阻止濒死
        // TODO: 触发【濒死】状态 (AE & Event)
        // await this.applyDyingEffect(); 
        // 触发濒死检定
      }
    }

    // B. 死亡触发
    if (isDead) {
      await this.runScripts(SCRIPT_TRIGGERS.DEATH, statusCtx);

      // 检查脚本是否免死
      if (statusCtx.preventDeath) {
        isDead = false; // 取消死亡标记
        // 同样，脚本里需要负责把内力/血量拉回来
      }
      else {
        // TODO: 触发死亡逻辑 (Overlay图标、发送聊天信息等)
        // 使用 Actor 的方法切换状态
        // "dead" 是 Foundry 核心默认的死亡状态 ID，通常会自动挂载骷髅图标
        // overlay: true 表示这是一个覆盖全图的大图标
        // await this.toggleStatusEffect("dead", { overlay: true, active: true });
      }
    }


    // =====================================================
    // 6. 视觉
    // =====================================================

    // A. 飘字
    if (this.token?.object) {
      // 1. 常规伤害飘字
      const stdTotal = stdHutiLost + stdHpLost; // 只显示常规部分的扣血+护体
      if (stdTotal > 0) {
        let flavor = `-${stdTotal}`;
        let color = "#ff0000";
        let size = 32;

        if (isCrit) {
          flavor = `暴击! ${flavor}`;
          size = 48;
          color = "#ff4500";
        }
        if (stdHutiLost > 0 && stdHpLost === 0) {
          color = "#00ffff"; // 纯护体扣除
          flavor = `护体 -${stdHutiLost}`;
        }

        canvas.interface.createScrollingText(this.token.object.center, flavor, {
          direction: 0, fontSize: size, fill: color,
          stroke: "#000000", strokeThickness: 4, jitter: 0.25
        });
      }

      // 2. 流失伤害飘字 (单独显示)
      // 只有当真的产生了流失扣血(或扣护体)时才飘字
      const liuTotal = liuHutiLost + liuHpLost;
      if (liuTotal > 0) {
        // 让流失字体稍微延后一点或颜色不同，深红色
        canvas.interface.createScrollingText(this.token.object.center, `流失 -${liuTotal}`, {
          direction: 0, // 向下飘或者换个方向
          fontSize: 28,
          fill: "#8b0000", // 深红/暗红
          stroke: "#ffffff",
          strokeThickness: 2,
          jitter: 0.25,
          anchor: 1 // 稍微偏移一点位置防止完全重叠
        });
      }

      // 3. 无伤提示
      if (stdTotal === 0 && liuTotal === 0 && isHit) {
        canvas.interface.createScrollingText(this.token.object.center, "无伤", {
          fill: "#cccccc", stroke: "#000000", strokeThickness: 4
        });
      }
    }

    // B. 被击回怒 (Defender Rage)
    // 规则：受到 内/外功 伤害 +1 怒气
    let rageGained = false;
    if (finalDamage > 0 && ["waigong", "neigong"].includes(type)) { //这里有一个细节，就是只要造成伤害就回怒了，即使被护体真气抵挡了，具体是不是这样后续可以再修改
      const currentRage = sys.resources.rage.value;
      const maxRage = sys.resources.rage.max;
      // 检查是否被封穴/禁怒 (通过 Flags)
      const noRecover = this.xjzlStatuses?.noRecoverRage;

      if (currentRage < maxRage && !noRecover) {
        await this.update({ "system.resources.rage.value": currentRage + 1 });
        rageGained = true; // 标记已回怒，用于回退怒气
      }
    }

    // =====================================================
    // 6. 返回结果
    // =====================================================
    return {
      finalDamage: finalDamage, // 实际总扣除 (HP+Huti)
      hpLost: stdHpLost,
      hutiLost: stdHutiLost,
      mpLost: stdMpLost,
      isDying: isDying,
      isDead: isDead,
      rageGained: rageGained,
      isHit: true
    };
  }

  /**
   * [核心] 治疗处理函数
   * @param {Object} data
   * @param {number} data.amount - 治疗数值
   * @param {string} data.type - 类型: "hp" | "neili" | "huti"
   * @param {boolean} data.showScrolling - 是否显示飘字
   */
  async applyHealing(data) {
    const { amount = 0, type = "hp", showScrolling = true } = data;
    if (amount <= 0) return;

    const updates = {};
    let actualHeal = 0;
    let label = "";
    let color = "#00FF00"; // 默认绿色 (HP)

    // A. 气血 (HP)
    if (type === "hp") {
      const current = this.system.resources.hp.value;
      const max = this.system.resources.hp.max;

      // 检查禁疗 (预检查，用于计算 actualHeal 显示 0 还是 真实值)
      // 虽然 _preUpdate 会拦截，但为了飘字准确，这里先判一下
      if (this.xjzlStatuses.noRecoverHP) {
        actualHeal = 0;
      } else {
        // 手动计算 Min 是为了让飘字显示实际增加量，而不是溢出量
        const newVal = Math.min(max, current + amount);
        actualHeal = newVal - current;
        if (actualHeal > 0) {
          updates["system.resources.hp.value"] = newVal;
        }
      }
      label = `+${actualHeal}`;
    }

    // B. 内力 (MP / Neili)
    else if (type === "mp" || type === "neili") {
      const current = this.system.resources.mp.value;
      const max = this.system.resources.mp.max;

      if (this.xjzlStatuses.noRecoverNeili) {
        actualHeal = 0;
      } else {
        const newVal = Math.min(max, current + amount);
        actualHeal = newVal - current;
        if (actualHeal > 0) {
          updates["system.resources.mp.value"] = newVal;
        }
      }
      label = `内力 +${actualHeal}`;
      color = "#0000FF"; // 蓝色
    }

    // C. 护体真气 (Huti)
    else if (type === "huti") {
      const current = this.system.resources.huti || 0;
      // 护体通常没有固定上限，或者由 DataModel 限制
      // 这里直接叠加
      const newVal = current + amount;
      actualHeal = amount;

      updates["system.resources.huti"] = newVal;

      label = `护体 +${actualHeal}`;
      color = "#00FFFF"; // 青色/天蓝
    }

    // 执行更新
    // 注意：如果 updates 为空（被 Flag 拦截导致 actualHeal=0），这里就不会执行
    if (!foundry.utils.isEmpty(updates)) {
      await this.update(updates);
    }

    // 视觉效果
    // 逻辑：
    // 1. 如果 actualHeal > 0，说明真的加血了，飘数字。
    // 2. 如果 actualHeal == 0 且是因为被禁疗拦截了，飘“禁疗”提示 (可选优化)
    if (showScrolling) {
      if (actualHeal > 0) {
        if (this.token?.object) {
          canvas.interface.createScrollingText(this.token.object.center, label, {
            direction: 0, fontSize: 32, fill: color,
            stroke: "#000000", strokeThickness: 4, jitter: 0.25
          });
        }
      } else {
        // 可选：如果是因为禁疗导致加血失败，飘一个提示
        let blockLabel = "";
        if (type === "hp" && this.xjzlStatuses.noRecoverHP) blockLabel = "禁疗";
        if ((type === "mp" || type === "neili") && this.xjzlStatuses.noRecoverNeili) blockLabel = "气滞";

        if (blockLabel && this.token?.object) {
          canvas.interface.createScrollingText(this.token.object.center, blockLabel, {
            direction: 0, fontSize: 24, fill: "#cccccc", // 灰色
            stroke: "#000000", strokeThickness: 2, jitter: 0.25
          });
        }
      }
    }
  }

  /**
   * 处理自动化回复/消耗
   * @param {String} timing 时机标识: "TurnStart", "TurnEnd", "Attack"
   */
  async processRegen(timing) {
    const updates = {};
    const messages = [];
    const resources = this.system.resources;

    // 定义资源键名映射
    const resKeys = ["hp", "mp", "rage"];
    const labels = { hp: "气血", mp: "内力", rage: "怒气" };

    for (const res of resKeys) {
      // 拼接 Flag Key，例如: regenHpTurnStart
      // 注意大小写：配置里是 regenHp... 所以这里要把 res 首字母大写
      const capRes = res.charAt(0).toUpperCase() + res.slice(1);
      const flagKey = `regen${capRes}${timing}`;

      // 从 xjzlStatuses 读取数值 (我们在 prepareDerivedData 里已经转成 int 了)
      const delta = this.xjzlStatuses[flagKey] || 0;

      if (delta !== 0) {
        const current = resources[res].value;
        const max = resources[res].max;

        // 计算新值 (限制在 0 ~ max 之间)
        // 注意：如果是负数(消耗)，也不能扣到负数
        let newVal = Math.max(0, Math.min(max, current + delta));

        if (newVal !== current) {
          updates[`system.resources.${res}.value`] = newVal;

          // 记录日志文本
          const sign = delta > 0 ? "+" : "";
          messages.push(`${labels[res]} ${sign}${delta}`);
        }
      }
    }

    // 执行更新
    if (!foundry.utils.isEmpty(updates)) {
      await this.update(updates);

      // 发送飘字或提示 (仅当有变动时)
      if (messages.length > 0) {
        const flavor = `${timing === "Attack" ? "出招" : (timing === "TurnStart" ? "回合开始" : "回合结束")}: ${messages.join(", ")}`;

        // 飘字
        if (this.token?.object) {
          canvas.interface.createScrollingText(this.token.object.center, messages.join(" "), {
            direction: 1,
            fontSize: 28,
            fill: "#00FF00",
            stroke: "#000000",
            strokeThickness: 4
          });
        }

        // 发送个小的 ChatMessage 记录，防止玩家不知道为什么血变了

        ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: this }),
          content: `<div style="font-size:0.8em; color:#555;">${flavor}</div>`
        });

      }
    }

  }

  /* -------------------------------------------- */
  /*  普通攻击 (Basic Attack)                      */
  /* -------------------------------------------- */

  /**
   * 发起普通攻击
   * 逻辑：构建虚拟招式 -> 弹窗配置 -> 运行脚本 -> 命中检定 -> 发送卡片
   * @param {Object} options - 额外配置
   * @param {String} [options.mode="basic"] - "basic" | "opportunity"
   */
  async rollBasicAttack(options = {}) {
    const mode = options.mode || "basic";
    const isOpportunity = mode === "opportunity";
    const label = isOpportunity ? "趁虚而入" : "普通攻击";
    // 0. 状态阻断检查 (Status Check)
    const s = this.xjzlStatuses || {};
    if (s.stun) return ui.notifications.warn(`${this.name} 处于晕眩状态，无法行动！`);

    // 1. 获取当前主武器信息
    // 逻辑：寻找第一个已装备的武器，如果没有则视为徒手
    const weapon = this.itemTypes.weapon.find(i => i.system.equipped);
    const weaponType = weapon ? weapon.system.type : "unarmed";
    const weaponName = weapon ? weapon.name : "徒手";
    const baseDamage = weapon ? (weapon.system.damage || 0) : 0; // 徒手基础伤害通常为0

    // 2. 弹窗配置 (Dialog)
    // 普攻需要选择：伤害类型 (内功/外功)、手动修正
    let config = {
      damageType: "waigong",
      bonusAttack: 0,
      bonusDamage: 0,
      canCrit: true, // 普攻默认可暴击
      manualAttackLevel: 0
    };

    if (!options.skipDialog) {
      const dialogResult = await this._promptBasicAttackConfig(weaponName);
      if (!dialogResult) return; // 用户取消
      config = { ...config, ...dialogResult };
    }

    // 3. 构建“虚拟招式”对象 (Virtual Move)
    // 这是一个临时对象，结构模仿 Item 中的 move，以便兼容脚本引擎和聊天模板
    const virtualMove = {
      id: isOpportunity ? "opportunity-attack" : "basic-attack",
      name: `${label} (${weaponName})`,
      type: "basic", // 新增加一种单独的类型，避免触发其他的特效
      damageType: config.damageType, // 由弹窗决定
      weaponType: weaponType,
      isUltimate: false,
      img: isOpportunity ? "icons/skills/melee/strike-dagger-blood-red.webp" : (weapon ? weapon.img : "icons/skills/melee/unarmed-punch-fist.webp"), // 图标
      currentCost: { mp: 0, rage: 0, hp: 0 }, // 普攻无消耗
      description: isOpportunity ? "发起一次趁虚而入。" : "发起一次基础攻击。"
    };

    // =====================================================
    // 4. 触发 "出招" 回复 (Regen On Attack)
    // =====================================================
    if (isOpportunity) await this.processRegen("Attack");
    // TODO 暂时来说没有普通攻击触发的，以后会有吗？

    // =====================================================
    // 5. 执行 ATTACK 阶段脚本
    // =====================================================
    const attackContext = {
      move: virtualMove,
      flags: {
        level: s.attackLevel || 0,
        feintLevel: 0, // 普攻没有虚招
        abort: false,
        abortReason: ""
      }
    };

    // 运行脚本：虽然没有招式但内功、装备等可能对“普通攻击”有特殊加成
    // 脚本中可以通过判断 trigger === 'attack' && args.move.type === 'basic' 来专门针对普攻写逻辑
    await this.runScripts(SCRIPT_TRIGGERS.ATTACK, attackContext, virtualMove);

    if (attackContext.flags.abort) {
      if (attackContext.flags.abortReason) ui.notifications.warn(attackContext.flags.abortReason);
      return;
    }

    // =====================================================
    // 6. 伤害计算
    // =====================================================
    const calcResult = this._calculateBasicAttackDamage(virtualMove, baseDamage, config, mode);

    // =====================================================
    // 7. 目标命中检定 (Hit Check)
    // =====================================================
    const targets = options.targets || Array.from(game.user.targets);
    const targetContexts = new Map();
    const selfLevel = attackContext.flags.level + config.manualAttackLevel;

    // 自身被动
    const baseIgnoreBlock = isOpportunity ? true : (s.ignoreBlock || false); //趁虚而入必定无视格挡
    const baseIgnoreDefense = s.ignoreDefense || false;
    const baseIgnoreStance = isOpportunity ? true : (s.ignoreStance || false); //趁虚而入必定无视架招

    // 遍历目标运行 CHECK 脚本
    for (const targetToken of targets) {
      const targetActor = targetToken.actor;
      if (!targetActor) continue;

      const checkContext = {
        target: targetActor,
        flags: {
          grantLevel: 0,
          ignoreBlock: false,
          ignoreDefense: false,
          ignoreStance: false
        }
      };

      // 普攻也触发 CHECK 脚本 (例如：某内功特效“普攻无视目标格挡”)
      await this.runScripts(SCRIPT_TRIGGERS.CHECK, checkContext, virtualMove);

      const tStatus = targetActor.xjzlStatuses || {};
      const targetGrant = tStatus.grantAttackLevel || 0;
      const totalLevel = selfLevel + targetGrant + checkContext.flags.grantLevel;

      let attackState = 0;
      if (totalLevel > 0) attackState = 1;
      else if (totalLevel < 0) attackState = -1;

      targetContexts.set(targetToken.document.uuid, {
        attackState: attackState,
        feintState: 0, // 普攻不涉及虚招
        ignoreBlock: baseIgnoreBlock || checkContext.flags.ignoreBlock,
        ignoreDefense: baseIgnoreDefense || checkContext.flags.ignoreDefense,
        ignoreStance: baseIgnoreStance || checkContext.flags.ignoreStance
      });
    }

    // =====================================================
    // 8. 掷骰 (Roll)
    // =====================================================
    // 普攻必定需要命中检定
    let hitMod = (config.damageType === "waigong" ? this.system.combat.hitWaigongTotal : this.system.combat.hitNeigongTotal);
    hitMod += config.bonusAttack;

    // 判定骰子类型 (是否需要 2d20)
    let needsTwoDice = false;
    if (targets.length === 0) {
      if (selfLevel !== 0) needsTwoDice = true;
    } else {
      for (const ctx of targetContexts.values()) {
        if (ctx.attackState !== 0) {
          needsTwoDice = true;
          break;
        }
      }
    }

    const diceFormula = needsTwoDice ? "2d20" : "1d20";
    const attackRoll = await new Roll(`${diceFormula} + @mod`, { mod: hitMod }).evaluate();
    const rollJSON = attackRoll.toJSON();
    const rollTooltip = await attackRoll.getTooltip();

    // 解析结果
    const diceResults = attackRoll.terms[0].results.map(r => r.result);
    const d1 = diceResults[0];
    const d2 = diceResults[1] || d1;

    // 计算主要显示的数值
    let primaryState = 0;
    if (targets.length > 0) {
      primaryState = targetContexts.get(targets[0].document.uuid)?.attackState || 0;
    } else {
      primaryState = (selfLevel > 0) ? 1 : ((selfLevel < 0) ? -1 : 0);
    }

    let displayTotal = 0;
    let flavorSuffix = "";
    if (primaryState === 1) {
      displayTotal = Math.max(d1, d2) + hitMod;
      flavorSuffix = "(优势)";
    } else if (primaryState === -1) {
      displayTotal = Math.min(d1, d2) + hitMod;
      flavorSuffix = "(劣势)";
    } else {
      displayTotal = d1 + hitMod;
    }

    // 填充目标结果
    const targetsResults = {};
    targets.forEach(t => {
      const tokenUuid = t.document.uuid;
      const ctx = targetContexts.get(tokenUuid) || { attackState: 0 };
      const state = ctx.attackState;

      let finalDie = d1;
      let outcomeLabel = "平";
      if (state === 1) { finalDie = Math.max(d1, d2); outcomeLabel = "优"; }
      else if (state === -1) { finalDie = Math.min(d1, d2); outcomeLabel = "劣"; }

      const total = finalDie + hitMod;
      const dodge = t.actor?.system.combat.dodgeTotal || 10;

      let isHit = false;
      if (finalDie === 20) isHit = true;
      else if (finalDie === 1) isHit = false;
      else isHit = total >= dodge;

      targetsResults[tokenUuid] = {
        name: t.name,
        total: total,
        isHit: isHit,
        stateLabel: outcomeLabel,
        dodge: dodge,
        die: finalDie,
        feintState: 0,
        ignoreBlock: ctx.ignoreBlock,
        ignoreDefense: ctx.ignoreDefense,
        ignoreStance: ctx.ignoreStance
      };
    });

    // =====================================================
    // 9. 发送聊天消息
    // =====================================================
    const templateData = {
      actor: this,
      item: null, // 普攻没有 Item
      move: virtualMove,
      calc: calcResult,
      cost: virtualMove.currentCost,
      isFeint: false,
      system: this.system,
      attackRoll: attackRoll,
      rollTooltip: rollTooltip,
      damageTypeLabel: game.i18n.localize(CONFIG.XJZL.damageTypes[config.damageType]),
      displayTotal: displayTotal,
      targetsResults: targetsResults,
      hasTargets: Object.keys(targetsResults).length > 0,
      showFeintBtn: false // 普攻不显示虚招
    };

    const content = await renderTemplate(
      "systems/xjzl-system/templates/chat/move-card.hbs",
      templateData
    );

    const chatData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `发起普通攻击 ${flavorSuffix}`,
      content: content,
      flags: {
        "xjzl-system": {
          actionType: "basic-attack", // 特殊标识
          // 这里不传 itemId 和 moveId，或者传特定的标记
          itemId: "basic",
          moveId: isOpportunity ? "opportunity" : "basic", // 区分 ID
          moveType: "basic",

          damage: calcResult.damage,
          feint: 0,
          calc: calcResult,
          damageType: config.damageType,
          canCrit: config.canCrit,
          attackBonus: config.bonusAttack,
          contextLevel: {
            selfLevel: selfLevel,
            selfFeintLevel: 0
          },
          rollJSON: rollJSON,
          targets: targets.map(t => t.document.uuid),
          targetsResultMap: Object.keys(targetsResults).reduce((acc, tokenId) => {
            const res = targetsResults[tokenId];
            const safeKey = tokenId.replaceAll(".", "_");
            acc[safeKey] = {
              stateLabel: res.stateLabel,
              isHit: res.isHit,
              total: res.total,
              dieUsed: res.die,
              feintState: 0,
              ignoreBlock: res.ignoreBlock,
              ignoreDefense: res.ignoreDefense,
              ignoreStance: res.ignoreStance
            };
            return acc;
          }, {})
        }
      }
    };

    ChatMessage.applyRollMode(chatData, game.settings.get("core", "rollMode"));
    const message = await ChatMessage.create(chatData);

    if (game.dice3d) {
      game.dice3d.showForRoll(attackRoll, game.user, true);
    }
  }

  /**
   * [内部] 普攻配置弹窗
   */
  async _promptBasicAttackConfig(weaponName) {
    // 1. 生成唯一 ID，防止 DOM 冲突
    const formId = `roll-config-${foundry.utils.randomID()}`;

    // 2. 准备模板数据 (复用 roll-config.hbs)
    const context = {
      formId: formId,
      needsAttack: true,  // 普攻必检定
      isFeint: false,     // 普攻非虚招
      needsDamage: true,  // 普攻必有伤害
      isCounter: false,
      canCrit: true       // 普攻可暴击
    };

    const content = await renderTemplate("systems/xjzl-system/templates/apps/roll-config.hbs", context);

    // 3. 额外注入：伤害类型的选择 (因为通用模板里没有这个下拉框)
    // 我们将其插入到模板生成的 HTML 顶部
    const extraContent = `
      <div class="xjzl-rc-row" style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #ccc;">
          <label class="xjzl-rc-label">使用武器</label>
          <div style="text-align: right; font-weight: bold;">${weaponName}</div>
      </div>
      <div class="xjzl-rc-row">
          <label class="xjzl-rc-label">伤害类型</label>
          <select name="damageType" style="width: 50%; text-align: center;">
            <option value="waigong">外功 (Waigong)</option>
            <option value="neigong">内功 (Neigong)</option>
          </select>
      </div>
    `;

    // 简单的字符串拼接，将额外选项插在 root div 开始标签之后
    // 注意：roll-config.hbs 的第一行是 <div id="{{formId}}" class="xjzl-rc-root">
    const finalContent = content.replace('class="xjzl-rc-root">', `class="xjzl-rc-root">${extraContent}`);

    // 4. 调用 DialogV2
    return foundry.applications.api.DialogV2.wait({
      window: { title: "普通攻击配置", icon: "fas fa-fist-raised" },
      content: finalContent,

      // --- 关键：挂载按钮监听 ---
      render: (event) => {
        const root = document.getElementById(formId);
        if (!root) return;

        root.addEventListener("click", (e) => {
          const btn = e.target.closest("button[data-action]");
          if (!btn) return;
          e.preventDefault();

          const action = btn.dataset.action;
          const targetName = btn.dataset.target;
          const input = root.querySelector(`input[name="${targetName}"]`);

          if (input) {
            let val = parseInt(input.value) || 0;
            if (action === "increase") val++;
            else if (action === "decrease") val--;
            input.value = val;
          }
        });
      },

      buttons: [{
        action: "ok",
        label: "攻击",
        icon: "fas fa-check",
        default: true,
        callback: (event, button) => {
          const root = document.getElementById(formId);
          if (!root) return {};

          const getVal = (name) => {
            const el = root.querySelector(`[name="${name}"]`);
            if (!el) return 0;
            if (el.type === "checkbox") return el.checked;
            return el.value;
          };

          return {
            damageType: getVal("damageType"), // 获取上面的额外字段
            bonusAttack: parseInt(getVal("bonusAttack")) || 0,
            bonusDamage: parseInt(getVal("bonusDamage")) || 0,
            manualAttackLevel: parseInt(getVal("manualAttackLevel")) || 0,
            canCrit: getVal("canCrit") !== false // 默认为 true
          };
        }
      }],
      rejectClose: false,
      close: () => null
    });
  }

  /**
   * [内部] 计算普攻伤害
   * 公式：武器伤害 + 武器等级加成 + 属性加成(无) + 通用/类型加成
   */
  _calculateBasicAttackDamage(virtualMove, baseDamage, config, mode) {
    const sys = this.system;
    const isOpportunity = mode === "opportunity";
    // 1. 武器基础伤害
    const weaponDmg = baseDamage;

    // 2. 武器等级加成 (Weapon Ranks)
    // 从 prepareDerivedData 里的 weaponRanks 中获取
    // 普攻完整享受该武器类型的等级加成
    let rankBonus = 0;
    if (virtualMove.weaponType && sys.combat?.weaponRanks) {
      const rankObj = sys.combat.weaponRanks[virtualMove.weaponType];
      if (rankObj) {
        const rank = rankObj.total || 0;
        // 伤害加成公式 (同 Actor 里的逻辑)
        if (rank <= 4) rankBonus = rank * 1;
        else if (rank <= 8) rankBonus = rank * 2;
        else rankBonus = rank * 3;
      }
    }

    // 3. 固定增伤 (Flat Bonuses)
    let flatBonus = 0;
    if (sys.combat?.damages) {
      flatBonus += (sys.combat.damages.global?.total || 0); // 全局加成
      flatBonus += (sys.combat.damages.normal?.total || 0); // 专门针对普攻的加成
      flatBonus += (sys.combat.damages.weapon?.total || 0); // 武器类伤害加成
      if (isOpportunity) {
        flatBonus += (sys.combat.damages.skill?.total || 0); //趁虚而入还能享受到招式伤害加成
      }
      //应该是没有其他的伤害加成了
    }

    // 4. 计算前脚本干预 (CALC Trigger)
    let preScriptDmg = Math.floor(weaponDmg + rankBonus + flatBonus);

    // 运行 CALC 脚本 (允许内功/Buff 修改普攻面板)
    // 构造 context
    const calcOutput = {
      damage: preScriptDmg,
      feint: 0,
      bonusDesc: []
    };

    // 同步执行
    this.runScripts(SCRIPT_TRIGGERS.CALC, {
      move: virtualMove,
      baseData: { base: weaponDmg, rank: rankBonus },
      output: calcOutput
    }, virtualMove);

    // 5. 应用手动修正
    let finalDamage = Math.floor(calcOutput.damage + config.bonusDamage);

    // 6. 生成 Breakdown
    let breakdownText = `武器基础: ${weaponDmg}\n`;
    breakdownText += `+ 武器等级: ${rankBonus}\n`;
    breakdownText += `+ 面板增伤: ${flatBonus}`;
    if (isOpportunity) breakdownText += ` (含招式加成)`; // 提示文本

    const scriptBonus = Math.floor(calcOutput.damage) - preScriptDmg;
    if (scriptBonus !== 0) {
      breakdownText += `\n+ 特效修正: ${scriptBonus}`;
    }
    if (config.bonusDamage !== 0) {
      breakdownText += `\n+ 手动修正: ${config.bonusDamage}`;
    }

    return {
      damage: finalDamage,
      feint: 0,// 普攻无虚招值
      breakdown: breakdownText,
      feintBreakdown: "",
      neigongBonus: "", // 普攻通常不享受内功系数加成
      cost: { mp: 0, rage: 0, hp: 0 },
      isWeaponMatch: true
    };
  }
}
