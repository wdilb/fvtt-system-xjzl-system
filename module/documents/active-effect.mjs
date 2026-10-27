/**
 * 扩展原生的 ActiveEffect 类
 * 核心职责：装备抑制、战斗内外分离计时，以及参战者移除后的到期兜底。
 */
import { SCRIPT_TRIGGERS } from "../data/common.mjs";
import { assertNoSyncScriptWrite } from "../utils/sync-script-guard.mjs";
import { getEffectDurationMode, getEffectTurnCount } from "../utils/effect-duration.mjs";
export class XJZLActiveEffect extends ActiveEffect {

  /**
   * 解析本效果的战斗计时基准；已删除的起始参战者仍保留原战斗锚点。
   * @param {object} [start=this.start] 已解析的 start 或包含 Combat ID 的源数据。
   * @returns {object|null} 进行中的战斗、起始参战者及位置；无适用战斗返回 null。
   */
  #getCombatClock(start = this.start) {
    const combatId = typeof start?.combat === "string" ? start.combat : start?.combat?.id ?? this._source.start?.combat;
    const combat = game.combats.get(combatId) ?? game.combat;
    if (!combat?.started || !combat.turns.length) return null;
    const sameCombat = combat.id === combatId;
    const combatant = sameCombat && start?.combatant
      ? combat.combatants.get(start.combatant)
      : combat.getCombatantsByActor(this.actor)[0];
    const removed = sameCombat && !!start?.combatant && !combatant;
    if (!combatant && !removed) return null;
    return {
      combat,
      combatant,
      removed,
      round: sameCombat ? (start.round ?? combatant?.roundJoined ?? combat.round) : combatant.roundJoined,
      turn: sameCombat ? (start.turn ?? 0) : combatant.turnNumber
    };
  }

  /**
   * 按角色次数或固定大轮计算 rounds，turns 保留行动轮次语义；不读取世界时间。
   * @param {string} units rounds 或 turns。
   * @param {object} clock getCombatClock 返回的计时基准。
   * @param {number} round 当前轮次。
   * @param {number} turn 零基回合位置；轮末使用最后一个有效行动位置。
   * @param {object} [context] 核心事件计数快照；省略时读取客户端最新计数。
   * @returns {number} 已过回合或行动轮次数。
   */
  #getCombatElapsed(units, clock, round, turn, context) {
    if (units === "rounds") {
      if (getEffectDurationMode() === "combatant" && !clock.removed
        && ["turnStart", "turnEnd"].includes(this._source.duration.expiry)) {
        const baseline = this._source.flags?.["xjzl-system"]?.effectTurnStart;
        if (baseline?.combatId === clock.combat.id && baseline.combatantId === clock.combatant.id) {
          return Math.max(0, getEffectTurnCount(clock.combat, baseline.combatantId, context) - baseline.count);
        }
        // 旧效果在首次实际回合前尚无计数快照，只能按当前轮次和角色位置建立一次基准。
        const index = clock.combat.turns.indexOf(clock.combatant);
        return Math.max(0, round - clock.round - (index > turn ? 1 : 0));
      }
      return round - clock.round;
    }
    const length = clock.combat.turns.length;
    const priorRounds = Math.max(0, length - clock.turn - 1 + length * (round - clock.round - 1));
    const thisRound = round === clock.round ? Math.max(0, turn - clock.turn) : turn + 1;
    return priorRounds + thisRound;
  }

  /**
   * 战斗内按独立的角色计数或战斗位置派生；战斗外才折算为秒交给核心。
   * @param {object} duration 已归一化为有限 value 的时长对象。
   * @param {object} [context] 核心回合事件的 round/turn 快照。
   * @returns {object} 含 remaining/secondsRemaining/label 的派生时长。
   */
  _prepareCombatBasedDuration(duration, context) {
    const clock = this.#getCombatClock();
    // turns 的战斗外换算独立于全局 turnTime，避免每名参战者行动都额外推进世界时间。
    const conversion = duration.units === "rounds" ? (CONFIG.time.roundTime || 2) : 1;
    const seconds = duration.value * conversion;
    if (!clock) {
      if (game._documentsReady) return this._prepareTimeBasedDuration({ ...duration, units: "seconds", value: seconds }, context);
      return Object.assign(duration, { seconds, remaining: Infinity, secondsRemaining: Infinity,
        label: game.i18n.localize("COMMON.None") });
    }

    const round = context?.round ?? clock.combat.round;
    const turn = context?.turn ?? clock.combat.turn;
    const remaining = duration.value - this.#getCombatElapsed(duration.units, clock, round, turn, context);
    const unit = duration.units === "rounds" ? "ROUNDS" : "TURNS";
    const plural = game.i18n.pluralRules.select(Math.abs(remaining));
    const label = game.i18n.format(`EFFECT.DURATION.${unit}${remaining < 0 ? "_AGO" : ""}.${plural}`,
      { [duration.units]: Math.abs(remaining) });
    return Object.assign(duration, { seconds, remaining, secondsRemaining: remaining * conversion, label });
  }

  /**
   * 角色模式按原 ID 到期；先攻模式或原 ID 已移除时，以施加时先攻数值到期。
   * @param {string} event 核心 Registry 的事件名。
   * @param {object} [context] 所属 Combat、事件角色/位置与计数快照；不使用实时行动者替代。
   * @returns {boolean} 是否已到达配置的到期事件，剩余量判断仍由核心负责。
   */
  isExpiryEvent(event, context) {
    const units = this._source.duration.units;
    if (units !== "rounds" && units !== "turns") return super.isExpiryEvent(event, context);
    const clock = this.#getCombatClock();
    if (!clock) return super.isExpiryEvent(event, context);
    if (context?.combat && context.combat !== clock.combat) return false;
    if (event === "updateWorldTime") return false;
    const initiativeMode = (units === "rounds" && getEffectDurationMode() === "initiative") || clock.removed;
    const expiry = this.duration.expiry;
    if (!initiativeMode) {
      if (expiry !== "turnStart" && expiry !== "turnEnd") return super.isExpiryEvent(event, context);
      if (event !== expiry || context?.skipped) return false;
      const eventId = context?.combatantId
        ?? (Number.isInteger(context?.turn) ? clock.combat.turns[context.turn]?.id
          : event === "turnEnd" ? clock.combat.previous.combatantId : clock.combat.combatant?.id);
      if (eventId !== clock.combatant.id) return false;
      // turnEnd 的缓存可能已按终点刷新过，仍须用结束事件本身的计数确认到期。
      return !Number.isFinite(this.duration.value) || this.#getCombatElapsed(units, clock,
        context?.round ?? clock.combat.round, context?.turn ?? clock.combat.turn, context) >= this.duration.value;
    }

    if (expiry !== "turnStart" && expiry !== "turnEnd") {
      if (["combatStart", "combatEnd", "roundStart", "roundEnd"].includes(expiry)) return event === expiry;
      return super.isExpiryEvent(event, context);
    }
    // 先攻模式只比较数值，不按同先攻 ID 拆分时点；到期大轮的轮末兜底保证不会永续。
    if (event !== expiry && event !== "roundEnd") return false;
    const combat = clock.combat;
    const initiative = this.start.initiative ?? -Infinity;
    const round = context?.round ?? combat.round;
    // 轮末没有 turn，实时 Combat 可能已进入下一轮，不能拼接下一轮的行动位置。
    const turn = event === "roundEnd" ? combat.turns.length - 1 : (context?.turn ?? combat.turn);
    const current = context?.combatantId ? combat.combatants.get(context.combatantId) : combat.turns[turn];
    if (event !== "roundEnd" && (!current || (current.initiative ?? -Infinity) > initiative)) return false;
    const elapsed = this.#getCombatElapsed(units, clock, round, turn, context);
    return !Number.isFinite(this.duration.value) || elapsed >= this.duration.value;
  }

  /**
   * 只刷新属于本战斗的 AE 派生时长和已打开角色卡，不执行过期删除。
   * @param {Combat} combat 计数已变化的战斗。
   * @param {object} [context] GM 核心事件使用阶段快照；客户端显示省略以读取最新计数。
   */
  static refreshCombatDurations(combat, context) {
    const actors = new Set();
    for (const effect of ActiveEffect.registry) {
      if (!(effect instanceof XJZLActiveEffect)) continue;
      if (!["rounds", "turns"].includes(effect._source.duration.units)) continue;
      if (effect.#getCombatClock()?.combat !== combat) continue;
      const units = effect.duration.units;
      const remaining = effect.duration.remaining;
      const updated = effect.updateDuration(context);
      if (units !== updated.units || remaining !== updated.remaining) actors.add(effect.actor);
    }
    for (const actor of actors) actor?.render(false);
  }

  /**
   * 为无计数快照的旧运行效果建立一次基准；新的效果由创建/刷新入口直接记录。
   * @param {Combat} combat 本次流转所属战斗。
   * @param {object} context 已同步记账、本次开始事件的 round/turn 快照。
   * @returns {Promise<void>} 使用核心批量更新，写入失败向调用方抛出。
   */
  static async initializeTurnCounters(combat, context) {
    const byParent = new Map();
    for (const effect of ActiveEffect.registry) {
      if (!(effect instanceof XJZLActiveEffect) || effect._source.duration.units !== "rounds") continue;
      if (!["turnStart", "turnEnd"].includes(effect._source.duration.expiry)) continue;
      const clock = effect.#getCombatClock();
      if (!clock || clock.combat !== combat || clock.removed) continue;
      const saved = effect._source.flags?.["xjzl-system"]?.effectTurnStart;
      if (saved?.combatId === combat.id && saved.combatantId === clock.combatant.id) continue;
      const index = combat.turns.indexOf(clock.combatant);
      // 新事件已同步入账；旧效果的历史估算仍须区分本次开始前后的来源位置。
      const elapsed = Math.max(0, context.round - clock.round - (index >= context.turn ? 1 : 0));
      const baseline = {
        combatId: combat.id, combatantId: clock.combatant.id,
        count: getEffectTurnCount(combat, clock.combatant.id, context) - elapsed - (index === context.turn ? 1 : 0)
      };
      if (!byParent.has(effect.parent)) byParent.set(effect.parent, []);
      byParent.get(effect.parent).push({ _id: effect.id, "flags.xjzl-system.effectTurnStart": baseline });
    }
    if (byParent.size) {
      await foundry.documents.modifyBatch([...byParent].map(([parent, updates]) => ({
        action: "update", documentName: "ActiveEffect", parent, updates
      })));
    }
  }

  /** 返回给定 start 的当前角色回合计数快照；战斗外及已移除的来源不生成快照。 */
  #captureTurnCounter(start = this.start) {
    const clock = this.#getCombatClock(start);
    if (!clock || clock.removed) return null;
    return { combatId: clock.combat.id, combatantId: clock.combatant.id,
      count: getEffectTurnCount(clock.combat, clock.combatant.id) };
  }

  /**
   * 共享 AE 的旧数字路径在野兽上只改变 mod，人物目标仍使用原路径。
   * 先按 value + mod 交给核心计算，保留乘算、覆盖和优先级语义；不修改 AE 模板。
   * @param {Document} targetDoc AE 的实际接受者（包括非关联 Token 的合成 Actor）。
   * @param {object} change 核心已按优先级排序的单条变更。
   * @param {object} [options] 保留核心 replacementData/modifyTarget 选项。
   * @returns {object} 核心变更结果及对应的内存 mod。
   */
  static applyChange(targetDoc, change, options = {}) {
    const match = targetDoc.type === "creature"
      && /^system\.combat\.(speed|dodge|hit|protection)$/.exec(change.key);
    if (!match) return super.applyChange(targetDoc, change, options);

    const stat = targetDoc.system.combat[match[1]];
    const previousTotal = stat.total;
    const totalKey = `${change.key}.total`;
    stat.total = stat.value + stat.mod;
    try {
      const result = super.applyChange(targetDoc, { ...change, key: totalKey }, options);
      if (!Number.isFinite(result[totalKey])) return result;
      const mod = result[totalKey] - stat.value;
      if (options.modifyTarget !== false) stat.mod = mod;
      return { ...result, [`${change.key}.mod`]: mod };
    } finally {
      if (options.modifyTarget === false) stat.total = previousTotal;
    }
  }

  /* ------------------------------------------------------------------
   * 同步脚本写入防护入口：以下覆写只在 passive/calc 执行期间生效，
   * 常规流程直接透传父类行为。入口必须同步（非 async），保证阻断时
   * 抛出的是可被同步执行器捕获的异常，而不是被丢弃的 rejected Promise。
   * ------------------------------------------------------------------ */

  update(changes, context) {
    assertNoSyncScriptWrite("ActiveEffect.update", { document: this.name });
    return super.update(changes, context);
  }

  delete(options) {
    assertNoSyncScriptWrite("ActiveEffect.delete", { document: this.name });
    return super.delete(options);
  }

  setFlag(scope, key, value) {
    assertNoSyncScriptWrite(`ActiveEffect.setFlag(${scope}.${key})`, { document: this.name });
    return super.setFlag(scope, key, value);
  }

  unsetFlag(scope, key) {
    assertNoSyncScriptWrite(`ActiveEffect.unsetFlag(${scope}.${key})`, { document: this.name });
    return super.unsetFlag(scope, key);
  }

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
   * 是否与架招绑定
   * @returns {boolean}
   */
  get isTiedToStance() {
    return this.getFlag("xjzl-system", "tiedToStance") || false;
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
    // V14 已彻底移除 legacyTransferral 兼容层：内嵌物品的特效始终留在 Item 上（parent 恒为 Item），
    // transfer 仅决定变更的应用目标（true 时经核心 target getter 作用于所属 Actor），不再是转移开关
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
    // V14 核心默认判定等价于 duration.expired（基础模型无 system.isSuppressed 字段），
    // 已到期的特效由此自然失效
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
   * 从 AE 数据中解析系统状态 slug；只用于免疫判定，不把自定义效果归类为系统状态。
   * @param {object} effectData - 待创建或叠加的 AE 数据
   * @returns {string|null} 系统状态 slug，无法识别时返回 null
   */
  static getSystemStatusSlug(effectData) {
    // 原生路径可能把 statuses 保留为 Set，表单/旧数据也可能留下伪数组对象。
    const rawStatuses = effectData?.statuses;
    const statuses = Array.isArray(rawStatuses)
      ? rawStatuses
      : rawStatuses instanceof Set
        ? [...rawStatuses]
        : rawStatuses && typeof rawStatuses === "object"
          ? Object.values(rawStatuses)
          : [];
    for (const status of statuses) {
      if (CONFIG.statusEffects?.[status]) return status;
    }

    if (effectData?.id && CONFIG.statusEffects?.[effectData.id]) return effectData.id;
    const slug = this.getSlug(effectData);
    return CONFIG.statusEffects?.[slug] ? slug : null;
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
   * 4. 拦截 Actor 的系统状态免疫；Item 内嵌模板不参与判定
   * @returns {Promise<boolean|void>} 免疫或父类取消时返回 false
   */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;

    // addEffect 已完成检查时带上内部标记；其他原生创建路径仍在这里兜底，
    // 防止 toggleStatusEffect 或外部 createEmbeddedDocuments 绕过统一入口。
    const actor = this.parent;
    if (!options?.xjzlImmunityChecked && actor instanceof Actor) {
      const statusSlug = XJZLActiveEffect.getSystemStatusSlug(data);
      if (statusSlug && actor.hasEffectImmunity?.(statusSlug)) {
        const statusName = game.i18n.localize(CONFIG.statusEffects[statusSlug]?.name ?? statusSlug);
        actor.showFloatyText?.(`免疫 ${statusName}`, { fill: "#ffffff" });
        return false;
      }
    }

    // 1. 初始化 Flags 容器
    const flags = data.flags?.["xjzl-system"] || {};
    const updates = {};

    if (this._source?.start && this._source.duration.units === "rounds") {
      const baseline = this.#captureTurnCounter();
      const saved = flags.effectTurnStart;
      if (baseline && (saved?.combatId !== baseline.combatId || saved.combatantId !== baseline.combatantId)) {
        updates["flags.xjzl-system.effectTurnStart"] = baseline;
      }
    }

    // 强制本地化 Description
    // 无论来源是 Core toggleStatusEffect 还是其他
    if (data.description) {
      // game.i18n.localize 的特性：如果有翻译就返回翻译，没有就返回原Key
      // 所以这里直接赋值是安全的，不会把原本就是中文的文本搞坏
      const localizedDesc = game.i18n.localize(data.description);
      if (localizedDesc !== data.description) {
        updates["description"] = localizedDesc;
      }
    }

    // 强制本地化 Name (防止某些直接调用没翻译名字)
    if (data.name) {
      const localizedName = game.i18n.localize(data.name);
      if (localizedName !== data.name) {
        updates["name"] = localizedName;
      }
    }

    // 2. 确保 Slug 存在
    if (!flags.slug) {
      // 优先尝试将 name 转为 slug (如 "Green Snake Poison" -> "green-snake-poison")
      // 如果 name 是中文，slugify 可能会变空，则使用随机 ID
      let autoSlug = XJZLActiveEffect.getSlug(data);
      updates["flags.xjzl-system.slug"] = autoSlug;
    }

    // 3. 拍摄数值快照 (Base Snapshot)
    // 如果是第一次创建，且没有现成的 baseChanges，我们将当前的 changes 存为 baseChanges
    // V14 起变更数组由 system 数据模型承载；创建数据在到达本钩子前已经过核心 migrateData
    // （旧顶层 changes 已迁入 system.changes、数字 mode 已转字符串 type），因此只读 V14 路径
    if (!flags.baseChanges && data.system?.changes) {
      updates["flags.xjzl-system.baseChanges"] = foundry.utils.deepClone(data.system.changes);
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

    if (changed.start && this._source?.start) {
      const start = { ...this._source.start, ...changed.start };
      const baseline = this.#captureTurnCounter(start);
      changed.flags ??= {};
      changed.flags["xjzl-system"] ??= {};
      changed.flags["xjzl-system"].effectTurnStart = baseline;
    }

    // 1. 检查是否有针对我们系统的 flags 更新
    const xjzlFlags = changed.flags?.["xjzl-system"];

    // 2. 只有当更新包含 scripts 字段时才介入
    if (xjzlFlags && "scripts" in xjzlFlags) {

      const incomingScripts = xjzlFlags.scripts;
      // console.log("XJZL DEBUG | _preUpdate Check Scripts:", incomingScripts);

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
   * 1. 仅 add 类型的数值会被乘算
   * 2. 其他类型保持原样
   * @param {number} newStacks 目标层数
   * @returns {Array} 计算后的 changes 数组
   */
  calculateChangesForStacks(newStacks) {
    const baseChanges = this.getFlag("xjzl-system", "baseChanges");
    if (!baseChanges) return this.system.changes; // 容错：如果没有快照，就用当前的

    return baseChanges.map(change => {
      // 深度拷贝，避免修改原引用
      const newChange = { ...change };

      // 核心算法：
      // 只有 add 类型且 Value 是纯数字时，才进行乘法
      // 注意：变更类型是字符串字面量。CONST.ACTIVE_EFFECT_CHANGE_TYPES 的成员值是
      // 默认优先级数字（如 add: 20）而非类型串，不能用常量做等值比较，直接写字面量。
      if (newChange.type === "add") {
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
