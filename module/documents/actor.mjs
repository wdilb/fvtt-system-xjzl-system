/**
 * 扩展核心 Actor 类
 */
import { SCRIPT_TRIGGERS } from "../data/common.mjs";
import { XJZLMacros } from "../utils/macros.mjs";
import { xjzlSocket } from "../socket.mjs";
import { ActionTracker } from "../applications/action-tracker.mjs";
import { XJZLResourceCommitError, unwrapResourceSocketResult } from "../utils/resource-commit-error.mjs";

// 尝试突破经脉花费固定为500
const JINGMAI_ATTEMPT_COST = 500;

// 资源事务只关注会参与战斗脚本的数值字段；银两、休息次数等非战斗数据不进入该触发器。
const RESOURCE_FIELDS = Object.freeze([
  { key: "hp", path: "system.resources.hp.value" },
  { key: "mp", path: "system.resources.mp.value" },
  { key: "rage", path: "system.resources.rage.value" },
  {
    key: "huti",
    path: "system.resources.huti",
    updatePaths: ["system.resources.huti", "system.resources.huti.value"]
  },
  { key: "tili", path: "system.resources.tili.value" },
  { key: "morale", path: "system.resources.morale.value" }
]);
const RESOURCE_SCRIPT_MAX_DEPTH = 8;
const EMPTY_RESOURCE_CONTEXT = Object.freeze({});
// 只有这些阶段代表角色正在施展招式；回合与受击脚本即使归属于某招式，也不能冒充“出招来源”。
const MOVE_ACTION_RESOURCE_TRIGGERS = new Set([
  SCRIPT_TRIGGERS.PRE_ATTACK,
  SCRIPT_TRIGGERS.ATTACK,
  SCRIPT_TRIGGERS.CHECK,
  SCRIPT_TRIGGERS.PRE_DAMAGE,
  SCRIPT_TRIGGERS.HIT,
  SCRIPT_TRIGGERS.HIT_ONCE
]);
const RESOURCE_TRANSACTION_OPTIONS = new Set([
  "xjzlResourceContext",
  "xjzlResourceTransaction"
]);

/**
 * 将资源触发上下文压缩为可通过 socket 传输的形式。
 * 文档对象由 GM 端按 UUID 恢复，招式数据保持为普通对象。
 */
function serializeResourceContext(context = {}) {
  context = context || {};
  const { item, sourceActor, target, attacker, healer, ...plainContext } = context;
  const serialized = {
    ...plainContext,
    itemUuid: item?.uuid || context.itemUuid || null,
    sourceActorUuid: sourceActor?.uuid || context.sourceActorUuid || null,
    targetUuid: target?.uuid || context.targetUuid || null,
    attackerUuid: attacker?.uuid || context.attackerUuid || null,
    healerUuid: healer?.uuid || context.healerUuid || null
  };
  // 普通对象（如普通攻击的虚拟 item）没有 uuid，不能按 UUID 还原；保留原样跨 Socket 传输。
  if (item && !item.uuid) serialized.item = item;
  return serialized;
}

/**
 * 继承当前资源事件的连锁标识；只复制递归元数据，避免把整批变化重复塞进 socket。
 */
function inheritResourceChain(context = null, inheritedContext = null) {
  if (!inheritedContext) return context || EMPTY_RESOURCE_CONTEXT;
  const normalized = { ...(context || EMPTY_RESOURCE_CONTEXT) };
  if (!normalized.chainId) normalized.chainId = inheritedContext.chainId;
  if (!Number.isInteger(normalized.depth)) normalized.depth = inheritedContext.depth + 1;
  return normalized;
}

/**
 * 从当前脚本调用栈补齐资源来源，使旧招式直接 update/applyHealing 时仍能识别当前动作。
 */
function inheritScriptResourceContext(actor, context = {}) {
  const stack = actor?._scriptContextStack;
  const current = stack?.[stack.length - 1];
  if (!current) return context || EMPTY_RESOURCE_CONTEXT;

  const inherited = { ...(context || EMPTY_RESOURCE_CONTEXT) };
  if (!inherited.sourceActor) inherited.sourceActor = actor;
  if (!inherited.item && current.actionItem instanceof Item) inherited.item = current.actionItem;
  if (!inherited.item && current.item instanceof Item) inherited.item = current.item;
  if (!inherited.move && current.actionMove) inherited.move = current.actionMove;
  if (!inherited.cause) inherited.cause = "script";
  if (!inherited.source && current.actionSource) inherited.source = current.actionSource;
  return inherited;
}

/** 移除资源事务的内部选项；普通 update 直接复用原对象，保持 Foundry 原生调用语义。 */
function getDatabaseOperation(operation = {}) {
  if (operation?.xjzlResourceContext === undefined
    && operation?.xjzlResourceTransaction === undefined) return operation;
  const databaseOperation = { ...operation };
  for (const key of RESOURCE_TRANSACTION_OPTIONS) delete databaseOperation[key];
  return databaseOperation;
}

// 将构造器缓存在模块作用域，避免每次 runScripts 重复创建
const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
const SCRIPT_FUNCTION_CACHE_LIMIT = 256;
const SCRIPT_FUNCTION_CACHE = new Map();
const renderTemplate = foundry.applications.handlebars.renderTemplate;

/**
 * 缓存已编译脚本并限制容量；仅在真正执行脚本时调用，不影响无脚本快速路径。
 * @param {Function} constructor - Function 或 AsyncFunction 构造器。
 * @param {string[]} paramNames - 本次沙盒的参数名及顺序。
 * @param {string} script - 脚本源码。
 * @returns {Function} 可复用的已编译函数。
 */
function getCompiledScript(constructor, paramNames, script) {
  const cacheKey = JSON.stringify([constructor === AsyncFunction ? "async" : "sync", paramNames, script]);
  const cached = SCRIPT_FUNCTION_CACHE.get(cacheKey);
  if (cached) {
    SCRIPT_FUNCTION_CACHE.delete(cacheKey);
    SCRIPT_FUNCTION_CACHE.set(cacheKey, cached);
    return cached;
  }

  const compiled = new constructor(...paramNames, script);
  SCRIPT_FUNCTION_CACHE.set(cacheKey, compiled);
  if (SCRIPT_FUNCTION_CACHE.size > SCRIPT_FUNCTION_CACHE_LIMIT) {
    SCRIPT_FUNCTION_CACHE.delete(SCRIPT_FUNCTION_CACHE.keys().next().value);
  }
  return compiled;
}

export class XJZLActor extends Actor {

  /**
   * 统一资源事务入口：提交成功后按实际差值触发 resourceChanged。
   * @param {Object} updates - Actor.update 使用的增量对象
   * @param {Object} context - cause、item、move、sourceActor 等触发上下文
   * @returns {Promise<Document|null|undefined>} 原始 Actor 更新结果或 socket 空结果
   */
  async changeResources(updates = {}, context = null) {
    context = inheritScriptResourceContext(this, inheritResourceChain(context, this._resourceEventContext));
    if (!this.isOwner) {
      const socketResult = await xjzlSocket.executeAsGM(
        "changeResources",
        this.uuid,
        updates,
        serializeResourceContext(context)
      );
      return unwrapResourceSocketResult(socketResult);
    }

    const transaction = await this._commitResourceChanges(updates, context);
    if (transaction.changes.length > 0) {
      await this._dispatchResourceChanges(transaction.changes, context);
    }
    return transaction.result;
  }

  /**
   * 统一包装 Actor 更新，使未迁移的直接 update 也能获得资源变动兜底。
   * 无资源字段或当前没有脚本时直接走父类更新，不创建快照、不构建沙盒。
   */
  async update(changes = {}, operation = {}) {
    const context = inheritScriptResourceContext(
      this,
      inheritResourceChain(operation?.xjzlResourceContext, this._resourceEventContext)
    );
    const contextItem = context.move || null;
    const contextScripts = contextItem?.scripts;
    const contextHasResourceScript = Array.isArray(contextScripts) && contextScripts.some(script =>
      script.trigger === SCRIPT_TRIGGERS.RESOURCE_CHANGED && script.active
    );
    if (this._resourceScriptCache === false
      && !contextHasResourceScript
      && !this._changesResourceScriptSources(changes)) {
      const databaseOperation = getDatabaseOperation(operation);
      if (this._resourceCommitQueue && this._getChangedResourceFields(changes).length > 0) {
        return await this._withResourceCommitLock(() => super.update(changes, databaseOperation));
      }
      return await super.update(changes, databaseOperation);
    }
    const transaction = await this._commitResourceChanges(changes, context, operation);
    if (transaction.changes.length > 0) {
      await this._dispatchResourceChanges(transaction.changes, context);
    }
    return transaction.result;
  }

  /**
   * 提交资源更新并计算真实差值；此方法不负责触发脚本，供伤害结算延迟派发。
   */
  async _commitResourceChanges(updates = {}, context = {}, operation = {}) {
    const contextItem = context.move || null;
    const contextScripts = contextItem?.scripts;
    const contextHasResourceScript = Array.isArray(contextScripts) && contextScripts.some(script =>
      script.trigger === SCRIPT_TRIGGERS.RESOURCE_CHANGED && script.active
    );
    // 缓存确认没有宿主脚本且本次没有招式脚本时，连资源路径解析也跳过。
    const scriptSourcesChanged = this._changesResourceScriptSources(updates);
    if (this._resourceScriptCache === false && !contextHasResourceScript && !scriptSourcesChanged) {
      const databaseOperation = getDatabaseOperation(operation);
      const result = this._resourceCommitQueue && this._getChangedResourceFields(updates).length > 0
        ? await this._withResourceCommitLock(() => super.update(updates, databaseOperation))
        : await super.update(updates, databaseOperation);
      return { result, changes: [] };
    }

    const changedFields = this._getChangedResourceFields(updates);
    const hasResourceScripts = changedFields.length > 0
      && (scriptSourcesChanged || this._hasResourceScripts(contextItem));
    const databaseOptions = getDatabaseOperation(operation);

    // 快速路径：没有资源字段，或 Actor 没有该触发器脚本时，行为等同原始 update。
    if (!hasResourceScripts) {
      const result = this._resourceCommitQueue && changedFields.length > 0
        ? await this._withResourceCommitLock(() => super.update(updates, databaseOptions))
        : await super.update(updates, databaseOptions);
      return { result, changes: [] };
    }

    return await this._withResourceCommitLock(async () => {
      // 快照全部“实际适用且持久化”的资源字段，确保完整性检查额外裁剪的资源也能进入本次 changes。
      const applicableFields = this._getApplicableResourceFields();
      const before = this._snapshotResources(applicableFields);

      let result;
      try {
        result = await super.update(updates, {
          ...databaseOptions,
          xjzlResourceTransaction: true
        });
      } catch (err) {
        throw new XJZLResourceCommitError(`XJZL | 资源事务数据库提交失败 [${this.uuid}]`, {
          committed: "unknown",
          phase: "database",
          cause: context.cause,
          actorUuid: this.uuid,
          resourceChanges: null,
          originalError: err
        });
      }

      // 上限可能因同一更新中的其他字段或派生数据而变化；等待截断完成后再读取真实结果。
      try {
        await this._enforceResourceIntegrity({ resourceTransaction: true });
      } catch (err) {
        throw new XJZLResourceCommitError(`XJZL | 资源事务完整性检查失败 [${this.uuid}]`, {
          committed: true,
          phase: "resourceIntegrity",
          cause: context.cause,
          actorUuid: this.uuid,
          resourceChanges: null,
          originalError: err
        });
      }

      return { result, changes: this._computeResourceChanges(applicableFields, before) };
    });
  }

  /**
   * 串行执行同一 Actor 的资源写入，保证脚本事务的前后快照不混入并发更新。
   * @param {Function} callback - 获得写锁后执行的异步提交函数。
   * @returns {Promise<*>} 提交函数的结果。
   */
  async _withResourceCommitLock(callback) {
    const previousCommit = this._resourceCommitQueue || Promise.resolve();
    let releaseCommit;
    const currentCommit = new Promise(resolve => { releaseCommit = resolve; });
    this._resourceCommitQueue = currentCommit;
    await previousCommit;

    try {
      return await callback();
    } finally {
      releaseCommit();
      if (this._resourceCommitQueue === currentCommit) this._resourceCommitQueue = null;
    }
  }

  /**
   * 判断本次更新涉及哪些受支持的资源字段。
   */
  _getChangedResourceFields(changes = {}) {
    return RESOURCE_FIELDS.filter(field => (field.updatePaths || [field.path]).some(path =>
      foundry.utils.getProperty(changes, path) !== undefined
    ));
  }

  /**
   * 返回当前 Actor 实际持久化且适用的资源字段。
   * 依据 _source 而非派生后的 this.system，避免 creature 的 hp 由 tili 派生导致重复报告。
   */
  _getApplicableResourceFields() {
    if (this.type === "container") return [];
    const typeKeys = this.type === "creature"
      ? ["tili", "rage"]
      : ["hp", "mp", "rage", "huti", "morale"];
    return RESOURCE_FIELDS.filter(field => typeKeys.includes(field.key)
      && foundry.utils.getProperty(this._source, field.path) !== undefined);
  }

  /**
   * 读取一组资源字段的当前值并生成快照 Map。
   */
  _snapshotResources(fields) {
    return new Map(fields.map(field => [field.key, this._readResourceValue(field)]));
  }

  /**
   * 对比快照与当前值，返回有实际差值的资源变化；无效数值跳过并记录警告。
   */
  _computeResourceChanges(fields, before) {
    const changedResources = [];
    for (const field of fields) {
      const oldValue = before.get(field.key);
      const newValue = this._readResourceValue(field);
      if (!Number.isFinite(oldValue) || !Number.isFinite(newValue)) {
        console.warn(`XJZL | resourceChanged 跳过资源 [${field.key}]，读取值无效`, {
          actor: this.uuid,
          resource: field.key,
          oldValue,
          newValue
        });
        continue;
      }
      if (Object.is(oldValue, newValue)) continue;
      changedResources.push({
        resource: field.key,
        path: field.path,
        oldValue,
        newValue,
        delta: newValue - oldValue
      });
    }
    return changedResources;
  }

  /**
   * 判断同一更新是否会改变内功、架招或护甲脚本来源，以便在更新后重新收集脚本。
   */
  _changesResourceScriptSources(changes = {}) {
    const keys = Object.keys(changes);
    const hasFlatSourceChange = keys.some(key =>
      key === "system.martial"
      || key.startsWith("system.martial.")
      || key === "flags.xjzl-system.ignoreArmorEffects"
      || key === "flags.xjzl-system.-=ignoreArmorEffects"
    );
    if (hasFlatSourceChange || changes.system?.martial !== undefined) return true;
    const systemFlags = changes.flags?.["xjzl-system"];
    return systemFlags?.ignoreArmorEffects !== undefined
      || systemFlags?.["-=ignoreArmorEffects"] !== undefined;
  }

  /**
   * 读取派生数据中的当前资源值。
   */
  _readResourceValue(field) {
    let value = foundry.utils.getProperty(this, field.path);
    // 兼容旧世界中护体仍为 {value, max} 的数据形态。
    if (field.key === "huti" && value && typeof value === "object") value = value.value;
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : undefined;
  }

  /**
   * 惰性判断 Actor 是否拥有 resourceChanged 脚本；缓存会在所有脚本来源变化时失效。
   */
  _hasResourceScripts(contextItem = null) {
    const contextScripts = contextItem?.scripts;
    if (Array.isArray(contextScripts) && contextScripts.some(script =>
      script.trigger === SCRIPT_TRIGGERS.RESOURCE_CHANGED && script.active
    )) return true;

    if (this._resourceScriptCache !== undefined) return this._resourceScriptCache;
    this._resourceScriptCache = this.collectScripts(SCRIPT_TRIGGERS.RESOURCE_CHANGED).length > 0;
    return this._resourceScriptCache;
  }

  /**
   * 将一次或多次资源变化合并为一个脚本事件，并限制脚本递归深度。
   */
  async _dispatchResourceChanges(changes, context = {}) {
    if (!changes?.length) return;
    const inheritedContext = this._resourceEventContext;
    const depth = Number.isInteger(context.depth)
      ? context.depth
      : (inheritedContext ? inheritedContext.depth + 1 : 0);
    if (depth >= RESOURCE_SCRIPT_MAX_DEPTH) {
      console.error(`XJZL | resourceChanged 递归深度超过 ${RESOURCE_SCRIPT_MAX_DEPTH}，已终止。`);
      return;
    }

    const byResource = Object.fromEntries(changes.map(change => [change.resource, change]));
    const eventContext = {
      ...context,
      changes,
      byResource,
      cause: context.cause || "update",
      sourceActor: context.sourceActor || null,
      item: context.item || null,
      move: context.move || null,
      chainId: context.chainId || inheritedContext?.chainId || foundry.utils.randomID(),
      depth
    };
    const previousContext = this._resourceEventContext;
    this._resourceEventContext = eventContext;
    try {
      await this.runScripts(
        SCRIPT_TRIGGERS.RESOURCE_CHANGED,
        eventContext,
        eventContext.move || eventContext.item
      );
    } catch (err) {
      // 数据库主更新已提交；这里只记录并反馈派发失败，不向上抛出，避免调用方误判为未提交。
      console.error("XJZL | resourceChanged 派发失败", {
        actor: this.uuid,
        cause: eventContext.cause,
        changes,
        error: err
      });
      ui.notifications.error(`资源变动脚本派发失败：${this.name}`);
    } finally {
      this._resourceEventContext = previousContext;
    }
  }

  /* -------------------------------------------- */
  /*  生命周期钩子 (Lifecycle Hooks)              */
  /* -------------------------------------------- */

  /**
   * 监控内嵌文档更新 (装备/内功/Buff 变动)
   */
  _onUpdateEmbeddedDocuments(embeddedName, documents, result, options, userId) {
    super._onUpdateEmbeddedDocuments(embeddedName, documents, result, options, userId);
    this._resourceScriptCache = undefined;
    // 只由当前操作的用户执行，防止多客户端重复写入
    if (userId !== game.user.id) return;

    void this._enforceResourceIntegrity().catch(err => {
      console.error("XJZL | 内嵌文档更新后的资源完整性检查失败:", err);
    });
  }

  /** 创建物品/特效后，使资源脚本存在性缓存失效。 */
  _onCreateDescendantDocuments(parent, collection, documents, data, options, userId) {
    super._onCreateDescendantDocuments(parent, collection, documents, data, options, userId);
    this._resourceScriptCache = undefined;
  }

  /** 删除物品/特效后，使资源脚本存在性缓存失效。 */
  _onDeleteDescendantDocuments(parent, collection, documents, ids, options, userId) {
    super._onDeleteDescendantDocuments(parent, collection, documents, ids, options, userId);
    this._resourceScriptCache = undefined;
  }

  /** 修改物品/特效脚本或启用状态后，使资源脚本存在性缓存失效。 */
  _onUpdateDescendantDocuments(parent, collection, documents, changes, options, userId) {
    super._onUpdateDescendantDocuments(parent, collection, documents, changes, options, userId);
    this._resourceScriptCache = undefined;
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
    // 如果是容器，跳过所有复杂的角色数据预处理
    if (this.type === "container") return;

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
    // 如果是容器，直接终止，不再执行后续的资源检查
    if (this.type === "container") {
      super._onUpdate(changed, options, userId);
      return;
    }

    super._onUpdate(changed, options, userId);

    // 内功/架招和破衣状态会改变脚本来源；普通资源更新无需使缓存失效。
    if (this._changesResourceScriptSources(changed)) {
      this._resourceScriptCache = undefined;
    }

    if (userId !== game.user.id) return;

    // 资源事务会在提交函数中等待完整性校正，避免这里发起无法等待的重复更新。
    if (!options?.xjzlResourceTransaction) {
      void this._enforceResourceIntegrity().catch(err => {
        console.error("XJZL | Actor 更新后的资源完整性检查失败:", err);
      });
    }

    // 醉意监控
    const newAlcohol = foundry.utils.getProperty(changed, "system.resources.alcohol.value");
    if (newAlcohol !== undefined) {
      const maxAlcohol = this.system.resources.alcohol.max;
      if (newAlcohol > maxAlcohol) {
        const hasZuidao = this.effects.some(e => e.getFlag("xjzl-system", "slug") === "zuidao" || e.statuses.has("zuidao"));

        // 如果醉意超标，且身上没醉倒，则自动施加系统醉倒
        if (!hasZuidao) {
          game.xjzl.api.effects.toggleStatus(this, "zuidao", true);
        }
      }
    }

    // =====================================================
    // 2. 濒死/死亡状态自动解除
    // =====================================================
    // 检查本次更新是否涉及 HP 变化
    const newHp = foundry.utils.getProperty(changed, "system.resources.hp.value");

    // 如果 HP 发生了变化，且当前 HP > 0
    // (注意：this.system.resources.hp.value 此时已经是更新后的新值了)
    if (newHp !== undefined && this.system.resources.hp.value > 0) {

      // 查找身上是否有 dying 或 dead 状态
      const effectsToDelete = [];
      this.effects.forEach(e => {
        if (e.statuses.has("dying") || e.statuses.has("dead")) {
          effectsToDelete.push(e.id);
        }
      });

      // 如果有，移除它们
      if (effectsToDelete.length > 0) {
        this.deleteEmbeddedDocuments("ActiveEffect", effectsToDelete);

        // 视觉反馈
        this.showFloatyText("脱离濒死", { fill: "#00FF00" });
      }
    }
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

    // A. 容器/战利品 特殊初始化
    if (data.type === "container") {
      // 1. 默认权限：所有玩家可见 (Observer)
      // 这样玩家可以直接双击 Token 打开查看，或双击列表里的名字
      this.updateSource({
        "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
      });

      // 2. Token 设置：
      // - 敌对状态：中立 (0)
      // - 显示名字：总是显示 (或者悬停显示)
      // - 战利品 Token 各自保存库存；仓库/商铺 Token 关联世界 Actor，共享同一份持久库存。
      //   工作台切换模式时只同步原型；已经放置到场景中的 Token 保持原有关联状态。
      prototypeToken.actorLink = data.system?.mode ? data.system.mode !== "loot" : false;
      prototypeToken.disposition = CONST.TOKEN_DISPOSITIONS.NEUTRAL;
      prototypeToken.displayName = CONST.TOKEN_DISPLAY_MODES.HOVER;

      // 应用 Token 设置
      this.updateSource({ prototypeToken });

      // 容器处理完毕，直接退出，不走下面角色的逻辑
      return;
    }

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
    // 容器类型的特殊处理：直接跳过后续复杂的初始化
    if (this.type === "container") {
      return;
    }
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
   * 专门处理容器的数据准备 (如果有需要的话)
   */
  _prepareContainerData() {
    // 目前可能什么都不用做
    // 但如果未来要做什么，可以写在这里
  }

  /**
   * 数据准备流程的生命周期：
   * 1. prepareData()
   *    -> prepareBaseData()  (DataModel)
   *    -> applyActiveEffects() (Foundry Core)
   *    -> prepareDerivedData() (DataModel + Document)
   */
  prepareDerivedData() {
    // 容器类型的特殊处理：直接跳过
    // 容器没有属性、没有派生数值、不需要计算内功加成
    if (this.type === "container") {
      this._prepareContainerData();
      return;
    }
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
      "bleedOnHit", "wuxueBleedOnHit", "bloodLossLevel", "mpCostMultiplier", "takeBleedDamageTurnStart"];
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
    // --- 容器直接返回基础数据，不进行属性映射 ---
    if (this.type === "container") return super.getRollData();
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
    // --- 容器没有脚本逻辑 ---
    if (this.type === "container") return [];
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
    // 2.5 特效/特性 (Trait) - 全局生效，无条件收集
    // =====================================================
    const traits = this.itemTypes.trait || [];
    for (const item of traits) {
      if (item.system.scripts) {
        item.system.scripts.forEach(s => {
          // 同样的，检查触发时机和开关
          if (s.trigger === trigger && s.active) {
            scripts.push({
              script: s.script,
              label: s.label || item.name,
              source: item
            });
          }
        });
      }
    }

    // =====================================================
    // 3. 当前激活的架招 (Active Stance)
    // =====================================================
    // 架招开启后，应当视为常驻被动效果，直到关闭
    const martial = this.system.martial;
    // 定义架招作为“背景状态”时允许响应的触发器白名单
    // 只有在这些时机下，后台架招的脚本才会被收集
    // 严禁包含 'attack', 'hit', 'calc' 等进攻性时机，防止架招逻辑污染主动攻击
    const STANCE_BACKGROUND_TRIGGERS = [
      SCRIPT_TRIGGERS.PASSIVE,
      SCRIPT_TRIGGERS.AVOIDED,     // 我闪避时
      SCRIPT_TRIGGERS.PRE_DEFENSE, // 防御计算前
      SCRIPT_TRIGGERS.PRE_TAKE,    // 扣血前 (护盾)
      SCRIPT_TRIGGERS.DAMAGED,     // 受伤后 (反伤)
      SCRIPT_TRIGGERS.DYING,
      SCRIPT_TRIGGERS.DEATH,
      SCRIPT_TRIGGERS.RESOURCE_CHANGED
    ];
    // 检查：架招激活 + 有记录的 Move ID + 有记录的 Item ID
    if (martial?.stanceActive && martial?.stance && martial?.stanceItemId) {
      // 如果当前触发器不在白名单内，直接跳过架招脚本收集
      // 解决了“开启架招后，普攻也会触发架招attack脚本”的问题
      if (STANCE_BACKGROUND_TRIGGERS.includes(trigger)) {
        const wuxueItem = this.items.get(martial.stanceItemId);
        if (wuxueItem) {
          // 在该武学中找到对应的招式
          const stanceMove = wuxueItem.system.moves.find(m => m.id === martial.stance);
          // 新增校验：只有当招式等级 > 0 时才收集脚本，免得一些被动在没有领悟的情况下就生效
          if (stanceMove && stanceMove.scripts && (stanceMove.computedLevel || 0) > 0) {
            stanceMove.scripts.forEach(s => {
              // 同样检查触发器和开关
              if (s.trigger === trigger && s.active) {
                scripts.push({
                  script: s.script,
                  label: s.label || stanceMove.name,
                  source: wuxueItem, // 源头依然归属于该武学物品
                  contextData: stanceMove
                });
              }
            });
          }
        }
      }
    }

    // ==========================================================
    // 4. 武学全局被动 (极少数武学存在被动效果)
    // ==========================================================
    // 只有在 PASSIVE 时机，我们才遍历所有武学，寻找是否有被动脚本。
    // 这样不会影响战斗时机 (ATTACK/HIT) 的性能。
    if (trigger === SCRIPT_TRIGGERS.PASSIVE) {
      // 仅筛选特定类型的物品，大幅减少循环次数
      const passiveItems = this.itemTypes.wuxue.filter(i =>
        ["qinggong", "sanshou", "zhenfa"].includes(i.system.category)
      );

      for (const item of passiveItems) {
        // 遍历这些物品下的所有招式
        for (const move of item.system.moves) {
          // 直接跳过未入门的招式，避免被动在未入门的时候就生效
          if ((move.computedLevel || 0) <= 0) continue;
          const moveScripts = move.scripts;
          if (!moveScripts || moveScripts.length === 0) continue;
          for (const s of move.scripts) {
            // 找到 passive 脚本并激活
            if (s.trigger === trigger && s.active) {
              scripts.push({
                script: s.script,
                label: `${s.label} (${move.name} - ${item.name})`,
                source: item, // 注意：源头依然是 Item，但在脚本里可以通过 args.move 获取招式详情
                contextData: move
              });
            }
          }
        }
      }
    }

    // 5. 上下文对象 (Context Item/Move)
    // 这是在 roll()或者其他调用的时候传进来的，比如当前正在施展的招式
    if (contextItem && Array.isArray(contextItem.scripts)) {
      const contextScripts = contextItem.scripts;
      contextScripts.forEach(s => {
        if (s.trigger === trigger && s.active) {
          scripts.push({
            script: s.script,
            label: s.label || "招式特效",
            source: contextItem
          });
        }
      });
    }

    // =====================================================
    // 6. 遍历 Active Effects (AE Scripting)
    // =====================================================
    // 使用 appliedEffects 自动获得过滤后的列表 (已剔除禁用/未装备/过期)
    // 如果没有 appliedEffects (旧版本)，使用 this.effects.filter(...)
    const activeEffects = this.appliedEffects || this.effects.filter(e => !e.disabled && !e.isSuppressed);

    for (const effect of activeEffects) {
      // 使用我们在 XJZLActiveEffect 中定义的 getter 和 helper
      // 预检查优化：如果这个特效压根没有这个时机的脚本，直接跳过
      if (!effect.hasScript || !effect.hasScript(trigger)) continue;

      const effectScripts = effect.scripts; // 获取数组

      effectScripts.forEach(s => {
        if (s.trigger === trigger && s.active !== false) {
          scripts.push({
            script: s.script,
            label: s.label || effect.name,
            source: effect // 源头指向 AE 文档
          });
        }
      });
    }

    // =====================================================
    // 7. 战斗开始、回合开始、回合结束，全部武学都可以触发
    // =====================================================
    // 使用 appliedEffects 自动获得过滤后的列表 (已剔除禁用/未装备/过期)
    // 如果没有 appliedEffects (旧版本)，使用 this.effects.filter(...)
    const GLOBAL_WUXUE_TRIGGERS = [
      SCRIPT_TRIGGERS.COMBAT_START,
      SCRIPT_TRIGGERS.TURN_START,
      SCRIPT_TRIGGERS.TURN_END
    ];
    if (GLOBAL_WUXUE_TRIGGERS.includes(trigger)) {
      // 获取这名角色身上所有的武学物品
      const wuxueItems = this.itemTypes.wuxue;
      for (const item of wuxueItems) {
        // 遍历这些武学下的所有招式
        for (const move of item.system.moves) {
          // 直接跳过未入门的招式 (层数<=0不生效)
          if ((move.computedLevel || 0) <= 0) continue;

          if (!move.scripts || move.scripts.length === 0) continue;
          for (const s of move.scripts) {
            // 匹配 trigger 且 脚本处于激活状态
            if (s.trigger === trigger && s.active) {
              scripts.push({
                script: s.script,
                label: `${s.label} (${move.name} - ${item.name})`,
                source: item, // 源头依然是 Item
                contextData: move
              });
            }
          }
        }
      }
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
    if (this.type === "container") return; //容器没有脚本
    // 1. 收集脚本
    const scriptsToRun = this.collectScripts(trigger, contextItem);
    if (!scriptsToRun.length) return;

    // 固定本次运行的动作上下文，避免后续为被动脚本注入的 contextData 被误判为正在出招。
    const actionContext = MOVE_ACTION_RESOURCE_TRIGGERS.has(trigger) && context?.move
      ? {
        item: context.item instanceof Item ? context.item : null,
        move: context.move,
        source: "move"
      }
      : null;

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

    // 为无权限对象注入本次运行专用的 Document Proxy；runScripts 结束后恢复上下文中的原文档引用。
    const restoreSandboxDocuments = this._proxifySandbox(sandbox);

    // 3. 决定执行模式 (同步/异步)
    // Passive 和 Calc  必须同步运行，不能 await，否则会阻塞数据计算
    const isSync = [SCRIPT_TRIGGERS.PASSIVE, SCRIPT_TRIGGERS.CALC].includes(trigger);

    try {
      if (isSync) {
        this._runScriptsSync(scriptsToRun, sandbox, actionContext);
      } else {
        await this._runScriptsAsync(scriptsToRun, sandbox, actionContext);
      }
    } finally {
      restoreSandboxDocuments?.();
    }
  }

  /**
   * 临时把脚本来源招式注入 sandbox.move / args.move，并返回精确恢复函数。
   * @param {Object} sandbox - 本次触发共享的脚本沙盒
   * @param {Object} contextData - 来源招式数据
   * @returns {Function} 恢复函数；未注入时返回 null
   */
  _injectContextMove(sandbox, contextData) {
    if (!contextData) return null;
    const args = sandbox.args;
    const moveExisted = Object.prototype.hasOwnProperty.call(sandbox, "move");
    const argsMoveExisted = args && Object.prototype.hasOwnProperty.call(args, "move");
    const previousMove = sandbox.move;
    const previousArgsMove = args?.move;

    sandbox.move = contextData;
    if (args) args.move = contextData;

    return () => {
      if (moveExisted) sandbox.move = previousMove;
      else delete sandbox.move;
      if (args) {
        if (argsMoveExisted) args.move = previousArgsMove;
        else delete args.move;
      }
    };
  }

  /**
   * [内部] 同步执行 (用于 Passive, Calc)
   * @param {Object[]} scripts - 已收集并按顺序执行的脚本条目
   * @param {Object} sandbox - 本次触发共享的脚本沙盒
   * @param {Object|null} actionContext - 仅在主动招式阶段存在的资源来源上下文
   */
  _runScriptsSync(scripts, sandbox, actionContext = null) {
    // 初始化执行上下文栈
    if (!this._scriptContextStack) this._scriptContextStack = [];
    for (const entry of scripts) {
      let restoreMove = null;
      try {
        // 动态注入 thisItem，指向当前脚本所属的物品
        // 这样脚本里写 thisItem.system.xxx 就能读到自己的数据
        // 主要用于类似装备上带的受击特效等没有传入 contextItem 的情况，可以找到触发的物品
        let thisItem = null;
        let thisEffect = null;

        if (entry.source instanceof Item) {
          // 情况A: 源头是物品
          thisItem = entry.source;
        }
        else if (entry.source instanceof ActiveEffect) {
          // 情况B: 源头是特效
          thisEffect = entry.source;
          // 兼容性指向：让 thisItem 也指向 AE，防止脚本报错
          thisItem = entry.source;
        }
        // 如果此时 thisItem 仍为空，尝试从沙盒上下文(args)中获取
        // 招式脚本会将武学物品作为 'item' 传入上下文
        if (!thisItem && sandbox.item instanceof Item) {
          thisItem = sandbox.item;
        }
        // 临时注入来源招式，脚本执行后精确恢复，避免污染同一批后续脚本。
        restoreMove = this._injectContextMove(sandbox, entry.contextData);
        sandbox.thisItem = thisItem;
        sandbox.thisEffect = thisEffect;
        // 入栈：记录当前正在执行的脚本来源
        this._scriptContextStack.push({
          item: thisItem,
          effect: thisEffect,
          label: entry.label,
          contextData: entry.contextData || null,
          actionItem: actionContext?.item || null,
          actionMove: actionContext?.move || null,
          actionSource: actionContext?.source || null
        });
        // 构建函数: new Function("变量名1", ..., "脚本内容")
        const paramNames = Object.keys(sandbox);
        const paramValues = Object.values(sandbox);
        // console.log(`[XJZL] 执行脚本 [${entry.label}]:`, entry.script);
        // 这里的 entry.script 就是用户填写的 JS 代码字符串
        const fn = getCompiledScript(Function, paramNames, entry.script);
        fn(...paramValues);
      } catch (err) {
        console.error(`[XJZL] 同步脚本错误 [${entry.label}]:`, err);
        // 可选：开发模式下弹出提示
        // ui.notifications.error(`脚本错误: ${entry.label}`);
      }
      finally {
        restoreMove?.();
        // 出栈：无论成功失败，保证栈的清洁
        this._scriptContextStack.pop();
      }
    }
  }

  /**
   * [内部] 异步执行 (用于 Attack, Hit, TurnStart...)
   * @param {Object[]} scripts - 已收集并按顺序执行的脚本条目
   * @param {Object} sandbox - 本次触发共享的脚本沙盒
   * @param {Object|null} actionContext - 仅在主动招式阶段存在的资源来源上下文
   */
  async _runScriptsAsync(scripts, sandbox, actionContext = null) {
    // 初始化执行上下文栈
    if (!this._scriptContextStack) this._scriptContextStack = [];

    for (const entry of scripts) {
      let restoreMove = null;
      try {
        // 动态注入 thisItem，指向当前脚本所属的物品
        // 这样脚本里写 thisItem.system.xxx 就能读到自己的数据
        // 主要用于类似装备上带的受击特效等没有传入 contextItem 的情况，可以找到触发的物品
        let thisItem = null;
        let thisEffect = null;

        if (entry.source instanceof Item) {
          // 情况A: 源头是物品
          thisItem = entry.source;
        }
        else if (entry.source instanceof ActiveEffect) {
          // 情况B: 源头是特效
          thisEffect = entry.source;
          // 兼容性指向：让 thisItem 也指向 AE，防止脚本报错
          thisItem = entry.source;
        }
        // 如果此时 thisItem 仍为空，尝试从沙盒上下文(args)中获取
        // 招式脚本会将武学物品作为 'item' 传入上下文
        if (!thisItem && sandbox.item instanceof Item) {
          thisItem = sandbox.item;
        }
        // 临时注入来源招式，脚本执行后精确恢复，避免污染同一批后续脚本。
        restoreMove = this._injectContextMove(sandbox, entry.contextData);
        sandbox.thisItem = thisItem;
        sandbox.thisEffect = thisEffect;
        // 入栈：记录当前正在执行的脚本来源
        this._scriptContextStack.push({
          item: thisItem,
          effect: thisEffect,
          label: entry.label,
          contextData: entry.contextData || null,
          actionItem: actionContext?.item || null,
          actionMove: actionContext?.move || null,
          actionSource: actionContext?.source || null
        });
        const paramNames = Object.keys(sandbox);
        const paramValues = Object.values(sandbox);
        // console.log(`[XJZL] 执行脚本 [${entry.label}]:`, entry.script);
        const fn = getCompiledScript(AsyncFunction, paramNames, entry.script);
        await fn(...paramValues);
      } catch (err) {
        console.error(`[XJZL] 异步脚本错误 [${entry.label}]:`, err);
        ui.notifications.error(`特效脚本执行失败: ${entry.label}`);
      } finally {
        restoreMove?.();
        // 出栈：无论成功失败，保证栈的清洁
        this._scriptContextStack.pop();
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
    // --- 容器没有属性 ---
    if (this.type === "container") return null;

    const sys = this.system;

    let labelKey = "";
    let val = 0;          // 基础等级 (属性值/技能总值/技艺总值)
    let extraBonus = 0;   // 内部额外加值 (如技艺书提供的检定加值，非玩家临时输入的)
    let type = "unknown";

    // 1. 识别类型 (Stat vs Skill)
    // 直接使用 Config 判断，比检查 sys 对象更准确
    if (CONFIG.XJZL.attributes[key]) {
      val = sys.stats[key]?.total || 0;
      // 如果是属性(stat)且 key 不是 "wuxing"，则将数值除以 10 向下取整
      // 例如: 力量 165 -> 16
      if (key !== "wuxing") {
        val = Math.floor(val / 10);
      }
      labelKey = CONFIG.XJZL.attributes[key];
      // 读取属性专属的检定修正
      extraBonus = sys.stats[key]?.checkMod || 0;
      type = "stat";
    }
    else if (CONFIG.XJZL.skills[key]) {
      val = sys.skills[key]?.total || 0;
      labelKey = CONFIG.XJZL.skills[key];
      extraBonus = sys.skills[key]?.checkMod || 0;
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
    else if (CONFIG.XJZL.weaponTypes[key] && sys.combat?.weaponRanks?.[key]) {
      // --- D. 武器等级 (Weapon Ranks) ---
      // 只有在 Config 里有定义，且 Actor 数据里确实有这个 Rank 时才执行
      const rank = sys.combat.weaponRanks[key];
      val = rank.total || 0; // 直接取 Total

      // 武器等级检定是硬过的，不吃任何内置加成
      extraBonus = 0;

      labelKey = CONFIG.XJZL.weaponTypes[key];
      type = "weaponRank";
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

    // === 静默模式拦截 ===
    // 如果 options.chatMessage 为 false，则直接返回 roll 对象，不发消息
    // 这样 ChatManager 拿到 roll 后可以更新到对抗卡片里
    if (options.chatMessage === false) {
      // 既然不发卡片，最好在这里播放一下 3D 骰子，否则玩家不知道投了
      if (game.dice3d) game.dice3d.showForRoll(roll, game.user, true);
      return roll;
    }

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
    if (this.type === "container") return []; //容器直接返回
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
    if (this.type === "container") return { valid: false }; //容器直接返回
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
   * 根据当前 _source 与派生上限计算需要截断的资源更新。
   * 纯计算函数，不读取锁、不提交。
   */
  _computeResourceClampUpdates() {
    const res = this.system.resources;
    const updates = {};
    const getSource = (path) => foundry.utils.getProperty(this._source, path) || 0;

    // 怒气是野兽和侠客共有的
    if (res.rage) {
      const sourceRage = getSource("system.resources.rage.value");
      const maxRage = res.rage.max || 10;
      if (sourceRage > maxRage) updates["system.resources.rage.value"] = maxRage;
    }

    if (this.type === "creature") {
      if (res.tili) {
        const sourceTili = getSource("system.resources.tili.value");
        const maxTili = res.tili.max;
        if (sourceTili > maxTili) updates["system.resources.tili.value"] = maxTili;
      }
    } else {
      const sourceHP = getSource("system.resources.hp.value");
      if (sourceHP > res.hp.max) updates["system.resources.hp.value"] = res.hp.max;

      const sourceMP = getSource("system.resources.mp.value");
      if (sourceMP > res.mp.max) updates["system.resources.mp.value"] = res.mp.max;
    }

    return updates;
  }

  /**
   * 强制资源完整性检查 (Integrity Check)
   * 职责：如果 数据库原值 > 当前计算出的上限，则执行截断写入。
   * 覆盖范围：HP, MP, Tili (野兽), Rage (怒气)
   * @param {Object} [options] - resourceTransaction=true 时合并进当前资源事务，不另行派发。
   * @returns {Promise<void>}
   */
  async _enforceResourceIntegrity({ resourceTransaction = false } = {}) {
    // --- 容器没有这些资源，直接跳过 ---
    if (this.type === "container") return;

    // 事务路径：调用方已经持有资源锁，这里只计算并提交，不再次加锁，也不派发。
    if (resourceTransaction) {
      const updates = this._computeResourceClampUpdates();
      if (!foundry.utils.isEmpty(updates)) {
        await super.update(updates, { xjzlResourceTransaction: true });
      }
      return;
    }

    // 非事务路径：读取、计算、提交必须处于同一资源锁内，避免等待锁期间值已被其他业务修改。
    const { changes } = await this._withResourceCommitLock(async () => {
      const updates = this._computeResourceClampUpdates();
      if (foundry.utils.isEmpty(updates)) return { changes: [] };

      const applicableFields = this._getApplicableResourceFields();
      const before = this._snapshotResources(applicableFields);
      await super.update(updates, { xjzlResourceTransaction: true });
      return { changes: this._computeResourceChanges(applicableFields, before) };
    });

    if (changes.length > 0) {
      const clampContext = inheritScriptResourceContext(this, { cause: "resourceClamp" });
      await this._dispatchResourceChanges(changes, clampContext);
    }
  }

  /**
   * [核心] 伤害结算处理函数
   * 流程：AVOIDED -> PRE_DEFENSE -> (计算暴击/防御) -> PRE_TAKE -> (扣血) -> DAMAGED
   * @param {Object} data - 伤害参数包
   * @returns {Object} 结算结果
   */
  async applyDamage(data) {
    // [权限拦截]
    if (!this.isOwner) {
      // 统一走资源上下文序列化：attacker/item 等 Document 转 UUID，GM 端按 UUID 还原，避免跨 Socket 丢失。
      const socketData = serializeResourceContext(data);
      return unwrapResourceSocketResult(await xjzlSocket.executeAsGM("applyDamage", this.uuid, socketData));
    }

    // --- 容器受到攻击不处理，或者返回0伤害 ---
    if (this.type === "container") {
      this.showFloatyText("无效", { fill: "#cccccc" });
      return { finalDamage: 0 };
    }

    // =====================================================
    // 0. 野兽/怪物特化逻辑 (Creature Logic)
    // =====================================================
    if (this.type === "creature") {
      let { amount, isHit, isCrit, applyCritDamage } = data;

      // 1. 未命中直接返回
      if (!isHit) {
        this.showFloatyText("闪避", { fontSize: 32, fill: "#ffffff" });
        return { finalDamage: 0, isDead: false };
      }

      // 与标准伤害流程保持一致：把来源 item/move/source 一并交给资源事务与 resourceChanged，避免野兽伤害丢失物品溯源。
      const creatureDamageType = data.type || "waigong";
      const creatureResourceContext = {
        cause: "damage",
        attacker: data.attacker || null,
        target: this,
        type: creatureDamageType,
        damageType: creatureDamageType,
        move: data.move || null,
        item: data.item || null,
        source: data.source || "extra"
      };

      // 2. 获取配置
      const mode = game.settings.get("xjzl-system", "creatureDamageMode");
      const scalingBase = game.settings.get("xjzl-system", "creatureDamageScaling");
      const protection = this.system.combat.protection || 0;

      let tiliLost = 0;
      let isDead = false;

      // 3. 伤害计算
      if (isCrit && applyCritDamage !== false) {
        amount = Math.floor(amount * 2); // 暴击翻倍
      }
      if (amount > protection) {
        if (mode === "strict") {
          tiliLost = 1; // A. 规则书模式：固定扣 1
        } else {
          // B. 倍率模式：根据伤害量计算
          const divisor = Math.max(protection, scalingBase);
          tiliLost = Math.floor(amount / divisor);
          tiliLost = Math.max(1, tiliLost);
        }

        // 执行扣除
        const current = this.system.resources.tili.value;
        if (current > 0) {
          const actualLost = Math.min(current, tiliLost);
          const newVal = current - actualLost;

          const resourceTransaction = await this._commitResourceChanges(
            { "system.resources.tili.value": newVal },
            creatureResourceContext
          );

          // 飘字
          let flavor = `-${actualLost} 体力`;
          let color = "#ff0000";
          let size = 32;

          // 暴击时的视觉反馈
          if (isCrit) {
            flavor = `暴击! ${flavor}`;
            size = 48;
            color = "#ff4500";
          }

          this.showFloatyText(flavor, { fill: color, fontSize: size });

          // 死亡检查
          if (newVal <= 0) {
            isDead = true;
            const hasDead = this.effects.some(e => e.statuses.has("dead"));
            if (!hasDead) {
              await this.toggleStatusEffect("dead", { overlay: true, active: true });
            }
          }

          await this._dispatchResourceChanges(resourceTransaction.changes, creatureResourceContext);
        }
      } else {
        // 未破防
        this.showFloatyText("未破防", { fill: "#cccccc" });
      }

      const finalDamageResult = {
        finalDamage: tiliLost, tiliLost: tiliLost, hpLost: 0, hutiLost: 0, mpLost: 0,
        isDead: isDead, isDying: false, isHit: true
      };

      // 野兽特化逻辑的溯源 Hook (仅限脚本引擎调用的伤害)，用于后续的数据统计功能
      const damageType = creatureDamageType;
      const attacker = data.attacker || null;
      let isScriptDamage = false; // 防重复拦截锁

      if (game.settings.get("xjzl-system", "enableCombatStats") && attacker && attacker._scriptContextStack?.length > 0) {
        isScriptDamage = true; // <== 锁上，后面的常规统计不再执行
        const ctx = attacker._scriptContextStack[attacker._scriptContextStack.length - 1];
        const sourceItem = ctx.item || ctx.effect || null;
        const sourceName = sourceItem ? sourceItem.name : ctx.label;

        Hooks.callAll("xjzl.scriptDamageDealt", {
          eventType: "script_damage",
          attacker: attacker,
          defender: this,
          damageType: damageType,
          sourceItem: sourceItem,
          sourceName: sourceName,
          result: finalDamageResult
        });
      }

      // === [战斗统计] 野兽伤害 ===
      if (game.settings.get("xjzl-system", "enableCombatStats") && !isScriptDamage) {
        Hooks.callAll("xjzl.combatStatRecord", {
          eventType: "damage",
          attacker: data.attacker || null,
          defender: this,
          source: data.source || "extra",
          move: data.move || null,
          item: data.item || null,
          damageType: damageType,
          amount: finalDamageResult.finalDamage,
          hutiLost: 0,
          mpLost: 0,
          tiliLost: finalDamageResult.tiliLost,
          isHit: finalDamageResult.isHit,
          isCrit: data.isCrit || false,
          isBroken: false,
          isDying: false,
          isDead: finalDamageResult.isDead
        });
      }

      return finalDamageResult;
    }

    // =====================================================
    // 1. 初始化与解构
    // =====================================================
    const {
      amount,             // 原始伤害 (面板)
      type = "waigong",   // 伤害类型
      element = "none",       // 伤害元素类型（阴、柔、阳、刚、太极）
      attacker = null,    // 攻击者 Actor
      isHit = true,       // 是否命中
      isBroken = false,   // 是否被破防 (状态，不可逆)
      targetKanpo = 0,    // 接收敌方看破值，用于战斗统计功能
      isSkill = true,     // false表示普通攻击
      move = null,
      item = null,
      source = "extra"    // 伤害来源标识 (move, basic, both, dot, extra)，默认是extra也就是额外伤害，用来处理哪些伤害应该触发濒死、易伤等问题
    } = data;

    // 构建可配置对象 (Mutable Config)
    // 这里的属性允许被 PRE_DEFENSE 脚本修改
    const config = {
      // 穿透规则
      ignoreBlock: data.ignoreBlock || false,
      ignoreDefense: data.ignoreDefense || false,
      ignoreStance: data.ignoreStance || false,

      // 暴击规则 (允许脚本修改暴击状态)
      isCrit: data.isCrit || false,
      applyCritDamage: data.applyCritDamage ?? true,

      element: element
    };
    // =====================================================
    // 2. 闪避处理 (Trigger: AVOIDED)
    // =====================================================
    if (!isHit) {
      const avoidContext = {
        attacker: attacker,
        target: this,
        type: type,
        baseDamage: amount,
        isCrit: config.isCrit, // 虽然未命中，但把暴击意图传过去也无妨
        move: move,
        item: item,
        outcome: { isHit: false, isBroken: isBroken } // 只读结果
      };

      await this.runScripts(SCRIPT_TRIGGERS.AVOIDED, avoidContext);

      // 飘字：闪避
      this.showFloatyText("闪避", { fontSize: 32, fill: "#ffffff" });

      return { finalDamage: 0, hpLost: 0, isDead: false };
    }

    const sys = this.system;
    const combat = sys.combat;

    // =====================================================
    // 3. 防御前置脚本 (Trigger: PRE_DEFENSE)
    // =====================================================
    // 此时尚未计算暴击倍率，也未计算防御减伤
    // 目的：修改 config (如：免疫暴击、强制无视防御、获得临时抗性)
    const preDefContext = {
      attacker: attacker,
      target: this,
      type: type,
      damageType: type, // 与 type 完全等价，确保脚本无论用 args.type 还是 args.damageType 都能取到
      baseDamage: amount, // 原始面板伤害
      element: config.element,
      move: move,
      item: item,
      // 允许修改的配置 (包括 isCrit)
      config: config
    };

    await this.runScripts(SCRIPT_TRIGGERS.PRE_DEFENSE, preDefContext);

    // =====================================================
    // 4. 计算理论伤害 (Calculation)
    // =====================================================
    // 注意：这里的暴击计算必须在 PRE_DEFENSE 之后
    // 这样脚本里 config.isCrit = false 才能生效
    let calculatedDamage = amount;

    if (config.isCrit && config.applyCritDamage) {
      calculatedDamage = Math.floor(calculatedDamage * 2);
    }
    // =====================================================
    // 5. 计算减伤 (Mitigation)
    // 逻辑：伤害 - 防御 - 格挡 - 抗性
    // =====================================================

    // A. 基础防御 (Defense)
    let defenseVal = 0;
    if (!config.ignoreDefense) { // 使用 config 中的值
      if (type === "waigong") defenseVal = combat.defWaigongTotal || 0;
      else if (type === "neigong") defenseVal = combat.defNeigongTotal || 0;
    }

    // B. 格挡 (Block)
    let blockVal = 0;
    if (type === "waigong" || type === "neigong") { //只有内外功才有格挡
      if (!config.ignoreBlock) { // 使用 config 中的值
        let total = combat.blockTotal || 0;
        // 无视架招处理：仅扣除架招加值，保留基础格挡
        if (config.ignoreStance) {
          const stancePart = combat.stanceBlockValue || 0;
          total = Math.max(0, total - stancePart);
        }
        blockVal = total;
      }
    }


    // C. 抗性 (Resistance)
    const resMap = sys.combat.resistances;
    const globalRes = resMap.global.total || 0;
    let skillRes = 0
    if (type === "waigong" || type === "neigong") {
      skillRes = isSkill ? (resMap.skill?.total || 0) : 0;
    }
    let specificRes = 0;

    switch (type) {
      case "bleed": specificRes = resMap.bleed.total; break;
      case "poison": specificRes = resMap.poison.total; break;
      case "fire": specificRes = resMap.fire.total; break;
      case "mental": specificRes = resMap.mental.total; break;
      case "liushi": specificRes = resMap.liushi.total; break;
      case "neigong": specificRes = resMap.neigong.total; break;
      case "waigong": specificRes = resMap.waigong.total; break;
      default: specificRes = 0; break;
    }
    const totalRes = globalRes + specificRes + skillRes;
    // D. 执行减法
    let reducedDamage = calculatedDamage - defenseVal - blockVal - totalRes;
    // 检查是否允许伤害归零 (默认为 false，即保底 1)
    // 某些情况下我们允许伤害归零
    // 或者不是内外功伤害，保底也为0
    // 或者如果招式自带的面板基础伤害(amount)为 0，说明是纯控制/特殊机制招式，不触发保底 1 伤害！
    let minDamage = 0;
    if (amount > 0) {
      minDamage = (data.ignoreMinDamage || !["waigong", "neigong"].includes(type)) ? 0 : 1;
    }
    reducedDamage = Math.max(minDamage, reducedDamage);
    // =====================================================
    // 6. 受伤前置/护盾脚本 (Trigger: PRE_TAKE)
    // =====================================================
    // 此时已完成防御计算，准备扣血
    // 目的：护盾(Shields)、完全免疫(Abort)、最终数值修正
    const takeContext = {
      attacker: attacker,
      target: this,
      type: type,
      damageType: type, // 与 type 完全等价，确保脚本无论用 args.type 还是 args.damageType 都能取到
      element: config.element,
      baseDamage: amount,        // 原始面板
      calcDamage: reducedDamage, // 减伤后理论值

      isCrit: config.isCrit,     // 使用最终确定的暴击状态
      isBroken: isBroken,
      move: move,
      item: item,
      config: config,            // 传入配置备查

      // 允许修改的输出对象
      output: {
        damage: reducedDamage, // 脚本修改这个值来做护盾
        abort: false           // 脚本设为 true 可完全免疫
      }
    };

    await this.runScripts(SCRIPT_TRIGGERS.PRE_TAKE, takeContext);

    // 脚本可能强行中止 (如无敌)
    if (takeContext.output.abort) {
      this.showFloatyText("免疫", { fill: "#ffff00" });
      return { finalDamage: 0, hpLost: 0, isDead: false };
    }

    // 获取脚本修改后的最终伤害
    let finalDamage = Math.floor(takeContext.output.damage);

    // =====================================================
    // 7. 资源扣除 (Deduction)
    // =====================================================
    // 拍摄快照
    const originalHP = sys.resources.hp.value;

    // --- 计算流失伤害 ---
    let liushiDamage = 0;
    // 仅招式、普攻、复合、Dot 触发易伤，额外伤害(extra)不触发
    const validYishangSources = ["move", "basic", "both", "dot"];
    if (finalDamage > 0 && validYishangSources.includes(source)) {
      liushiDamage += (this.xjzlStatuses.bleedOnHit || 0);
      if (["waigong", "neigong"].includes(type)) {
        liushiDamage += (this.xjzlStatuses.wuxueBleedOnHit || 0);
      }
      if (liushiDamage > 0) {
        const liushiRes = sys.combat.resistances?.liushi?.total || 0;
        liushiDamage = Math.max(0, liushiDamage - liushiRes);
      }
    }

    // 准备更新
    const updates = {};
    let currentHuti = sys.resources.huti ?? 0;
    let currentHP = sys.resources.hp.value;
    let currentMP = sys.resources.mp.value;

    let stdHutiLost = 0, stdHpLost = 0, stdMpLost = 0;
    let liuHutiLost = 0, liuHpLost = 0, liuMpLost = 0;
    let isDying = false;
    let isDead = false;

    // 内部辅助：扣除逻辑
    const applyDeduction = (dmg, ratio) => {
      let res = { h: 0, p: 0, m: 0 };
      if (dmg <= 0) return res;

      let remaining = dmg;

      // A. 扣护体
      if (currentHuti > 0 && remaining > 0) {
        const hTake = Math.min(currentHuti, remaining);
        currentHuti -= hTake;
        res.h += hTake;
        remaining -= hTake;
      }

      // B. 扣气血
      if (remaining > 0) {
        if (currentHP > remaining) {
          currentHP -= remaining;
          res.p += remaining;
          remaining = 0;
        } else {
          const hpTake = currentHP;
          currentHP = 0;
          res.p += hpTake;
          remaining -= hpTake;
          if (hpTake > 0) isDying = true; // 只有确实扣了血导致归零，才算“刚刚濒死”
        }
      }

      // C. 扣内力
      if (remaining > 0) {
        const mpDamage = Math.ceil(remaining / ratio);
        const mpTake = Math.min(currentMP, mpDamage);

        currentMP -= mpTake;
        res.m += mpTake;

        if (mpDamage > mpTake) isDead = true;
      }
      return res;
    }

    // 第一轮：常规伤害 (内/外功 5:1抵扣，其他 1:1)
    const standardRatio = (type === "waigong" || type === "neigong") ? 5 : 1;
    const stdRes = applyDeduction(finalDamage, standardRatio);
    stdHutiLost = stdRes.h; stdHpLost = stdRes.p; stdMpLost = stdRes.m;

    // 第二轮：流失伤害 (1:1)
    const liuRes = applyDeduction(liushiDamage, 1);
    liuHutiLost = liuRes.h; liuHpLost = liuRes.p; liuMpLost = liuRes.m;

    // 更新数据库
    const totalHutiLost = stdHutiLost + liuHutiLost;
    const totalHpLost = stdHpLost + liuHpLost;
    const totalMpLost = stdMpLost + liuMpLost;

    if (totalHutiLost > 0) updates["system.resources.huti"] = currentHuti;
    if (totalHpLost > 0) updates["system.resources.hp.value"] = currentHP;
    if (totalMpLost > 0) updates["system.resources.mp.value"] = currentMP;

    let resourceTransaction = { result: null, changes: [] };
    if (!foundry.utils.isEmpty(updates)) {
      // 先提交资源，待 DYING/DEATH/DAMAGED 原有流程完成后再派发资源后效。
      resourceTransaction = await this._commitResourceChanges(updates, {
        cause: "damage",
        attacker,
        target: this,
        type,
        damageType: type,
        element: config.element,
        move,
        item,
        source
      });
    }

    // =====================================================
    // 8. 状态触发 (Status Triggers)
    // =====================================================
    const statusCtx = {
      attacker: attacker,
      target: this,
      damage: finalDamage,
      preventDying: false,
      preventDeath: false
    };

    const wasDead = this.effects.some(e => e.statuses.has("dead"));

    if (!wasDead) {
      // A. 濒死判定
      const isHitWhileDying = (originalHP <= 0 && finalDamage > 0);
      // 鞭尸有效性：只有来源是 招式、普攻 或 复合，鞭尸才发卡片/触发濒死
      const validWhipCorpse = ["move", "basic", "both"].includes(source);
      // 如果是“刚被打入濒死(isDying)” 必定触发
      // 如果是“躺着被鞭尸(isHitWhileDying)”，则必须来源有效才触发
      if (isDying || (isHitWhileDying && validWhipCorpse)) {
        await this.runScripts(SCRIPT_TRIGGERS.DYING, statusCtx);
        if (statusCtx.preventDying) {
          isDying = false;
        } else {
          const hasDying = this.effects.some(e => e.statuses.has("dying"));
          //因为可能存在一些脚本不阻止濒死，但会回血，所以不能挂上濒死状态（对，就是我们的合欢宗），但是需要发送濒死卡片
          if (!hasDying && this.system.resources.hp.value <= 0) {
            await this.toggleStatusEffect("dying", { active: true });
            // 濒死时自动解除架招
            if (this.system.martial?.stanceActive) {
              await this.stopStance();
            }
            // 濒死自动倒地
            await this.toggleStatusEffect("prone", { active: true });
          }

          const content = await renderTemplate("systems/xjzl-system/templates/chat/death-card.hbs", { isDead: false });
          ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this }),
            content: content,
            flags: { "xjzl-system": { type: "death-card" } }
          });
        }
      }

      // B. 死亡判定
      if (isDead) {
        await this.runScripts(SCRIPT_TRIGGERS.DEATH, statusCtx);

        if (statusCtx.preventDeath) {
          isDead = false;
        } else {
          await this.toggleStatusEffect("dead", { overlay: true, active: true });
          const content = await renderTemplate("systems/xjzl-system/templates/chat/death-card.hbs", { isDead: true });
          ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this }),
            content: content,
            flags: { "xjzl-system": { type: "death-card" } }
          });
        }
      }
    }

    // =====================================================
    // 9. 结算后/后效脚本 (Trigger: DAMAGED)
    // =====================================================
    // 目的：处理反伤、受击后特效。
    const damagedContext = {
      attacker: attacker,
      target: this,
      type: type,
      damageType: type, // 与 type 完全等价，确保脚本无论用 args.type 还是 args.damageType 都能取到
      element: config.element,

      finalDamage: finalDamage, // 理论应扣
      hpLost: stdHpLost,        // 实际扣血
      mpLost: stdMpLost,
      hutiLost: stdHutiLost,

      config: config, // 把配置传进来，以便检查 ignoreStance
      isBroken: isBroken, // 把破防状态传进来

      isCrit: config.isCrit,    // 使用最终暴击状态
      isDying: isDying,
      isDead: isDead,
      move: move,
      item: item
    };

    await this.runScripts(SCRIPT_TRIGGERS.DAMAGED, damagedContext);

    await this._dispatchResourceChanges(resourceTransaction.changes, {
      cause: "damage",
      attacker,
      target: this,
      type,
      damageType: type,
      element: config.element,
      move,
      item,
      source
    });

    // =====================================================
    // 10. 视觉与回怒 (Visuals & Rage)
    // =====================================================

    // A. 飘字
    if (this.token?.object) {
      const stdTotal = stdHutiLost + stdHpLost;
      if (stdTotal > 0) {
        let flavor = `-${stdTotal}`;
        let color = "#ff0000";
        let size = 32;

        if (config.isCrit) { // 使用最终暴击状态判断颜色
          flavor = `暴击! ${flavor}`;
          size = 48;
          color = "#ff4500";
        }
        if (stdHutiLost > 0 && stdHpLost === 0) {
          color = "#00ffff";
          flavor = `护体 -${stdHutiLost}`;
        }

        this.showFloatyText(flavor, { fontSize: size, fill: color, anchor: 0 });
      }

      // --- 内力扣除  ---
      // 濒死抵扣或以蓝代血时触发
      if (stdMpLost > 0) {
        // 蓝色字体表示内力损耗
        let mpFlavor = `内力 -${stdMpLost}`;
        if (config.isCrit && stdTotal === 0) { // 如果全是暴击造成的内力伤，也可以加暴击前缀
          mpFlavor = `暴击! ${mpFlavor}`;
        }
        this.showFloatyText(mpFlavor, {
          fontSize: 32,
          fill: "#4444ff",
          anchor: CONST.TEXT_ANCHOR_POINTS.CENTER,
          jitter: 0.35 // 稍微增加抖动以错开位置
        });
      }

      // --- 流失伤害 (易伤/撕裂/中毒) 处理 ---
      // 包含内力流失检查，防止仅流失内力时不提示
      const liuTotal = liuHutiLost + liuHpLost + liuMpLost;

      if (liuTotal > 0) {
        // 1. 保持原有的飘字
        this.showFloatyText(`流失 -${liuHutiLost + liuHpLost}`, { fontSize: 28, fill: "#8b0000", anchor: 1 });

        // 2. 发送流失结算卡片
        // 只有当有实际数值损失时才生成文本
        let parts = [];
        if (liuHutiLost > 0) parts.push(`护体 <span style="font-weight:bold;">-${liuHutiLost}</span>`);
        if (liuHpLost > 0) parts.push(`气血 <span style="font-weight:bold;">-${liuHpLost}</span>`);
        if (liuMpLost > 0) parts.push(`内力 <span style="font-weight:bold;">-${liuMpLost}</span>`);

        const cardContent = `
          <div class="xjzl-chat-card" style="padding: 4px 8px; border-left: 3px solid #8b0000; background: rgba(139, 0, 0, 0.05); font-size: 0.9em; color: #666;">
              <div style="font-weight: bold; color: #8b0000; margin-bottom: 2px;">
                  <i class="fas fa-tint"></i> 触发气血流失
              </div>
              <div style="display: flex; gap: 10px;">
                  ${parts.join('<span style="color:#ccc;">|</span>')}
              </div>
          </div>
        `;

        // 发送给所有玩家看 (type: OTHER)
        ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: this }),
          content: cardContent,
          style: CONST.CHAT_MESSAGE_STYLES.OTHER
        });
      }

      // 必须所有类型的损失都为0才算无伤
      const totalLoss = stdTotal + stdMpLost + liuTotal;

      if (totalLoss === 0 && isHit) {
        this.showFloatyText("无伤", { fill: "#cccccc" });
      }

    }


    // B. 被击回怒
    let rageGained = false;
    if (finalDamage > 0 && ["waigong", "neigong"].includes(type)) {
      const currentRage = sys.resources.rage.value;
      const maxRage = sys.resources.rage.max;
      const noRecover = this.xjzlStatuses?.noRecoverRage;
      // 读取受击不回怒标记
      const noRageOnHit = this.xjzlStatuses?.noRageOnHit;

      // 只有在没有“不怒”且没有“受击不回怒”时，才增加怒气
      if (currentRage < maxRage && !noRecover && !noRageOnHit) {
        await this.changeResources({ "system.resources.rage.value": currentRage + 1 }, {
          cause: "hitRage",
          attacker,
          target: this,
          type,
          move,
          item
        });
        rageGained = true;
      }
    }

    // =====================================================
    // 11. 返回结果
    // =====================================================
    const finalDamageResult = {
      finalDamage: finalDamage,
      hpLost: stdHpLost,
      hutiLost: stdHutiLost,
      mpLost: stdMpLost,
      tiliLost: 0,
      isDying: isDying,
      isDead: isDead,
      rageGained: rageGained,
      isHit: true
    };
    // 针对脚本触发伤害的隐式溯源 Hook (仅限脚本引擎调用的伤害)，用于后续的数据统计功能
    // 判定条件：没有通过标准卡片传入 data.item，且攻击者正处于脚本执行栈中
    let isScriptDamage = false; // 防重复拦截锁
    if (game.settings.get("xjzl-system", "enableCombatStats") && attacker && attacker._scriptContextStack?.length > 0) {
      isScriptDamage = true; // 锁定，防止重复统计
      const ctx = attacker._scriptContextStack[attacker._scriptContextStack.length - 1];
      const sourceItem = ctx.item || ctx.effect || null;
      const sourceName = sourceItem ? sourceItem.name : ctx.label;

      Hooks.callAll("xjzl.scriptDamageDealt", {
        eventType: "script_damage",
        attacker: attacker,
        defender: this,
        damageType: type,
        sourceItem: sourceItem,
        sourceName: sourceName,
        result: finalDamageResult
      });
    }

    // === [战斗统计] 常规伤害 ===
    if (game.settings.get("xjzl-system", "enableCombatStats") && !isScriptDamage) {
      Hooks.callAll("xjzl.combatStatRecord", {
        eventType: "damage",
        attacker: attacker || null, // 可能为null，如环境伤害/跌落
        defender: this,
        source: source,             // "move", "basic", "dot", "extra"
        move: move || null,
        item: item || null,
        damageType: type,
        amount: finalDamage,        // 造成了多少伤害（护甲折算后）
        hutiLost: stdHutiLost + liuHutiLost, // 破了多少护体
        mpLost: stdMpLost + liuMpLost,       // 扣了多少内力（以蓝代血）
        tiliLost: 0,
        isHit: isHit,
        isCrit: config.isCrit,      // 使用最终暴击状态
        isBroken: isBroken,
        targetKanpo: targetKanpo,  // 用于战斗统计功能
        isDying: isDying,
        isDead: isDead
      });
    }

    return finalDamageResult;
  }

  /**
     * [核心] 治疗处理函数
     * @param {Object} data
     * @param {number} data.amount - 治疗数值 (正数=回复, 负数=流失)
     * @param {string} data.type - 类型: "hp" | "neili" | "mp" | "huti" | "tili" | "rage"
     * @param {boolean} [data.showScrolling=true] - 是否显示飘字
     * @param {Actor} [data.healer] - 施加治疗/流失的源头 Actor。传入此参数有助于底层脚本引擎精准溯源该效果是由哪件装备/Buff触发的（用于战斗统计）。
     * @param {Object} [data.move] - 当前招式；脚本内省略时会从正在执行的动作继承
     * @param {Item} [data.item] - 当前招式所属物品；脚本内省略时会从正在执行的动作继承
     * @param {string} [data.source="extra"] - 资源来源标识
     * @returns {Promise<Object>} 返回结果 { actualHeal, type, oldVal, newVal }
     */
  async applyHealing(data) {
    // 在权限路由前固化来源，否则目标交由 GM 处理后，调用者的脚本栈已经不可见。
    const hasExplicitHealer = Object.prototype.hasOwnProperty.call(data, "healer");
    const inputHealer = data.healer ?? null;
    const scriptOwner = inputHealer instanceof Actor ? inputHealer : this;
    const scriptContext = inheritScriptResourceContext(scriptOwner, {});
    const {
      amount = 0,
      type = "hp",
      showScrolling = true,
      move = null,
      item = null,
      source = "extra",
      healer = null
    } = data;
    const resourceMove = move || scriptContext.move || null;
    const resourceItem = item || scriptContext.item || null;
    const resourceSource = source === "extra" ? (scriptContext.source || source) : source;
    const resourceHealer = hasExplicitHealer ? healer : (scriptContext.sourceActor || this);

    // [权限拦截]
    if (!this.isOwner) {
      const socketData = {
        ...data,
        move: resourceMove,
        source: resourceSource
      };
      if (resourceItem?.uuid) {
        socketData.itemUuid = resourceItem.uuid;
        delete socketData.item;
      }
      if (resourceHealer?.uuid) {
        socketData.healerUuid = resourceHealer.uuid;
        delete socketData.healer;
      }
      return unwrapResourceSocketResult(await xjzlSocket.executeAsGM("applyHealing", this.uuid, socketData));
    }
    // --- 容器无法治疗 ---
    if (this.type === "container") return { actualHeal: 0 };

    // 允许负数，只拦截 0
    if (amount === 0) return { actualHeal: 0 };

    const updates = {};
    let actualHeal = 0; // 实际变动值 (正或负)
    let label = "";
    let color = "#00FF00"; // 默认绿色 (HP回复)
    let oldVal = 0;
    let newVal = 0;

    // A. 气血 (HP)
    if (type === "hp") {
      const current = this.system.resources.hp.value;
      const max = this.system.resources.hp.max;
      oldVal = current;

      // 检查禁疗 (预检查，用于计算 actualHeal 显示 0 还是 真实值)
      // 虽然 _preUpdate 会拦截，但为了飘字准确，这里先判一下
      // 禁疗只阻止正向回复 (amount > 0)，不阻止扣血 (amount < 0)
      if (amount > 0 && this.xjzlStatuses.noRecoverHP) {
        actualHeal = 0;
        newVal = current;
      } else {
        // 兼容正负数逻辑
        // 如果是回复(>0): 限制不超过 max
        // 如果是流失(<0): 限制不低于 0
        if (amount > 0) {
          newVal = Math.min(max, current + amount);
        } else {
          newVal = Math.max(0, current + amount);
        }

        actualHeal = newVal - current;
        if (actualHeal !== 0) {
          updates["system.resources.hp.value"] = newVal;
        }
      }

      // 根据正负生成 Label 和 Color
      if (actualHeal > 0) {
        label = `+${actualHeal}`;
        color = "#00FF00"; // 绿
      } else if (actualHeal < 0) {
        label = `${actualHeal}`; // 自带负号
        color = "#FF0000"; // 红 (扣血)
      }
    }

    // B. 内力 (MP / Neili)
    else if (type === "mp" || type === "neili") {
      const current = this.system.resources.mp.value;
      const max = this.system.resources.mp.max;
      oldVal = current;

      // 气滞只阻止回复
      if (amount > 0 && this.xjzlStatuses.noRecoverNeili) {
        actualHeal = 0;
        newVal = current;
      } else {
        // 兼容正负数逻辑
        if (amount > 0) {
          newVal = Math.min(max, current + amount);
        } else {
          newVal = Math.max(0, current + amount);
        }

        actualHeal = newVal - current;
        if (actualHeal !== 0) {
          updates["system.resources.mp.value"] = newVal;
        }
      }

      // Label 和 Color
      label = `内力 ${actualHeal > 0 ? '+' : ''}${actualHeal}`;
      color = "#0000FF"; // 蓝色
    }

    // C. 护体真气 (Huti)
    else if (type === "huti") {
      const current = this.system.resources.huti || 0;
      oldVal = current;

      // 护体允许减少
      newVal = Math.max(0, current + amount);

      // 护体通常没有固定上限，或者由 DataModel 限制
      actualHeal = newVal - current;

      if (actualHeal !== 0) {
        updates["system.resources.huti"] = newVal;
      }

      label = `护体 ${actualHeal > 0 ? '+' : ''}${actualHeal}`;
      color = "#00FFFF"; // 青色/天蓝
    }

    // D. 野兽体力 (Tili)
    else if (type === "tili") {
      const resource = this.system.resources.tili;
      // 非野兽没有体力字段；保持旧有的安全无操作语义，避免通用资源脚本误传类型时崩溃。
      if (!resource) {
        return { actualHeal: 0, type, overflow: amount, isBlocked: false, oldVal: null, newVal: null };
      }
      const current = resource.value;
      const max = resource.max;
      oldVal = current;
      newVal = amount > 0 ? Math.min(max, current + amount) : Math.max(0, current + amount);
      actualHeal = newVal - current;

      if (actualHeal !== 0) updates["system.resources.tili.value"] = newVal;
      label = `体力 ${actualHeal > 0 ? '+' : ''}${actualHeal}`;
      color = "#82C96F";
    }

    // E. 怒气 (Rage)
    else if (type === "rage") {
      const current = this.system.resources.rage.value;
      const max = this.system.resources.rage.max;
      oldVal = current;

      // 不怒 (怒气锁定) 只阻止获得怒气，不阻止扣除
      if (amount > 0 && this.xjzlStatuses.noRecoverRage) {
        actualHeal = 0;
        newVal = current;
      } else {
        // 回复不超过上限，扣除不低于 0
        newVal = amount > 0 ? Math.min(max, current + amount) : Math.max(0, current + amount);
        actualHeal = newVal - current;
        if (actualHeal !== 0) {
          updates["system.resources.rage.value"] = newVal;
        }
      }

      label = `怒气 ${actualHeal > 0 ? '+' : ''}${actualHeal}`;
      color = "#e67e22"; // 橙
    }

    // 执行更新
    // 注意：如果 updates 为空（被 Flag 拦截导致 actualHeal=0），这里就不会执行
    const resourceContext = {
      cause: amount > 0 ? "healing" : "resourceLoss",
      healer: resourceHealer,
      target: this,
      type,
      move: resourceMove,
      item: resourceItem,
      source: resourceSource
    };
    let resourceTransaction = { result: null, changes: [] };
    if (!foundry.utils.isEmpty(updates)) {
      resourceTransaction = await this._commitResourceChanges(updates, resourceContext);
    }

    // 视觉效果
    // 逻辑：
    // 1. 如果 actualHeal != 0，说明数值变动了，飘数字。
    // 2. 如果 actualHeal == 0 且是因为被禁疗拦截了
    if (showScrolling) {
      if (actualHeal !== 0) {
        this.showFloatyText(label, {
          direction: actualHeal > 0 ? 0 : 1, // 0=Top, 1=Bottom
          fontSize: 32,
          fill: color
        });
      } else {
        // 可选：如果是因为禁疗导致加血失败，飘一个提示
        let blockLabel = "";
        // 只有正向治疗被拦截才提示
        if (amount > 0) {
          if (type === "hp" && this.xjzlStatuses.noRecoverHP) blockLabel = "禁疗";
          if ((type === "mp" || type === "neili") && this.xjzlStatuses.noRecoverNeili) blockLabel = "气滞";
          if (type === "rage" && this.xjzlStatuses.noRecoverRage) blockLabel = "怒气锁定";
        }

        if (blockLabel) {
          this.showFloatyText(blockLabel, { fontSize: 24, fill: "#cccccc" });
        }
      }
    }
    // 返回详细结果供调用者使用
    const isBlocked = amount > 0 && (
      (type === "hp" && !!this.xjzlStatuses.noRecoverHP)
      || ((type === "mp" || type === "neili") && !!this.xjzlStatuses.noRecoverNeili)
      || (type === "rage" && !!this.xjzlStatuses.noRecoverRage)
    );
    const finalHealResult = {
      actualHeal: actualHeal,
      type: type,
      overflow: amount - actualHeal, // 溢出/被浪费的治疗量
      isBlocked: isBlocked,
      oldVal: oldVal,
      newVal: newVal
    };
    // 针对脚本触发治疗的隐式溯源 Hook,用于后续的数据统计功能
    // 获取施法源：优先看有没有传入 healer，没有则默认是自己 (this) 身上挂的 Buff 触发的
    const actualHealer = resourceHealer;
    let isScriptHealing = false; // 防重复拦截锁
    if (game.settings.get("xjzl-system", "enableCombatStats") && actualHealer?._scriptContextStack?.length > 0) {
      isScriptHealing = true;
      const ctx = actualHealer._scriptContextStack[actualHealer._scriptContextStack.length - 1];
      // 兼容招式透传过来的 item
      const sourceItem = ctx.item || ctx.effect || resourceItem || null;
      const sourceName = sourceItem ? sourceItem.name : ctx.label;

      Hooks.callAll("xjzl.scriptHealingApplied", {
        eventType: "script_healing",
        healer: actualHealer,
        target: this,
        healType: type,
        sourceItem: sourceItem,
        sourceName: sourceName,
        result: finalHealResult,
        move: resourceMove || ctx.contextData || null,
        item: resourceItem || sourceItem
      });
    }

    // === [战斗统计] 治疗与流失 ===
    if (game.settings.get("xjzl-system", "enableCombatStats") && !isScriptHealing) {
      Hooks.callAll("xjzl.combatStatRecord", {
        eventType: "healing",
        healer: actualHealer,
        target: this,
        healType: type,
        amount: actualHeal,
        overflow: amount - actualHeal,
        isBlocked: finalHealResult.isBlocked,
        move: resourceMove,     // 透传招式对象
        item: resourceItem,     // 透传物品对象
        source: resourceSource  // 透传来源 (move/script/extra)
      });
    }

    await this._dispatchResourceChanges(resourceTransaction.changes, resourceContext);

    return finalHealResult;
  }

  /**
   * 处理自动化回复/消耗
   * @param {String} timing 时机标识: "TurnStart", "TurnEnd", "Attack"
   */
  async processRegen(timing) {
    // --- 容器没有自动回复 ---
    if (this.type === "container") return;

    const updates = {};
    const messages = [];
    const resources = this.system.resources;

    // 定义资源键名映射
    const resKeys = ["hp", "mp", "rage"];
    const labels = { hp: "气血", mp: "内力", rage: "怒气" };

    // 检查当前是否处于濒死状态
    const isDying = this.effects.some(e => e.statuses.has("dying"));
    let deathTriggered = false; // 防止单次结算触发多次死亡卡片

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

          // =====================================================
          // 濒死状态下的内力流失专项处理
          // =====================================================
          if (res === "mp" && delta < 0 && isDying && timing === "TurnStart") {

            // 1. 播报濒死内力流失卡片
            const mpLossContent = `
                  <div class="xjzl-chat-card" style="padding:4px 8px; border-left:3px solid #8b0000; background:rgba(139,0,0,0.05);">
                      <div style="color:#8b0000; font-weight:bold; font-size:0.9em; margin-bottom: 2px;">
                          <i class="fas fa-skull"></i> 濒死真气涣散
                      </div>
                      <div style="font-size:0.85em; color:#555;">
                          由于处于濒死状态，流失了 <b style="color:red;">${Math.abs(delta)}</b> 点内力。
                      </div>
                  </div>`;
            ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor: this }),
              content: mpLossContent
            });

            // 2. 如果这波流失直接让内力归零，触发死亡！
            if (newVal === 0 && !deathTriggered) {
              deathTriggered = true; // 标记已触发，防止重复

              // 强制挂上死亡状态 (系统默认的 overlay 行为)
              await this.toggleStatusEffect("dead", { overlay: true, active: true });

              // 渲染并发送死检卡片
              renderTemplate("systems/xjzl-system/templates/chat/death-card.hbs", { isDead: true })
                .then(content => {
                  ChatMessage.create({
                    user: game.user.id,
                    speaker: ChatMessage.getSpeaker({ actor: this }),
                    content: content,
                    flags: { "xjzl-system": { type: "death-card" } }
                  });
                });
            }
          }
        }
      }
    }

    // 执行更新
    if (!foundry.utils.isEmpty(updates)) {
      await this.changeResources(updates, {
        cause: "regen",
        regenTiming: timing
      });

      // 发送飘字或提示 (仅当有变动时)
      if (messages.length > 0) {
        const flavor = `${timing === "Attack" ? "出招" : (timing === "TurnStart" ? "回合开始" : "回合结束")}: ${messages.join(", ")}`;

        // 飘字
        this.showFloatyText(messages.join(" "), {
          direction: 1,
          fontSize: 28,
          fill: "#00FF00"
        });

        // 发送个小的 ChatMessage 记录，防止玩家不知道为什么血变了

        ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: this }),
          content: `<div style="font-size:0.8em; color:#555;">${flavor}</div>`
        });

      }
    }
    // 专门处理回合初造成流血伤害
    if (timing === "TurnStart") {
      const bleedDmg = this.xjzlStatuses.takeBleedDamageTurnStart || 0;

      if (bleedDmg > 0) {
        // 调用 applyDamage，系统会自动减去目标的流血抗性 (凝血)
        const dmgRes = await this.applyDamage({
          amount: bleedDmg,
          type: "bleed",      // 设定为流血伤害
          isHit: true,        // 状态伤害必定命中
          ignoreBlock: true,  // 无法被格挡
          ignoreStance: true, // 无视架招反击
          ignoreDefense: true, // 无视常规内外功护甲，仅拼抗性
          source: "dot" //这是一种dot伤害
        });

        // 构造专属的流血战报发送给聊天栏
        let contentHtml = "";
        if (dmgRes.finalDamage > 0) {
          contentHtml = `
            <div class="xjzl-chat-card" style="padding:4px 8px; border-left:3px solid #8b0000; background:rgba(139,0,0,0.05);">
                <div style="color:#8b0000; font-weight:bold; font-size:0.9em; margin-bottom: 2px;">
                    <i class="fas fa-tint"></i> 伤口流血
                </div>
                <div style="font-size:0.85em; color:#555;">
                    受到 <b style="color:red;">${dmgRes.finalDamage}</b> 点流血伤害。<br>
                    <span style="color:#888;">(面板伤害 ${bleedDmg} - 凝血抗性)</span>
                </div>
            </div>`;
        } else {
          // 如果被抗性完全抵挡，也发一条绿色的提示给玩家正反馈
          contentHtml = `
            <div class="xjzl-chat-card" style="padding:4px 8px; border-left:3px solid #27ae60; background:rgba(39,174,96,0.05);">
                <div style="color:#27ae60; font-weight:bold; font-size:0.9em; margin-bottom: 2px;">
                    <i class="fas fa-shield-alt"></i> 凝血生效
                </div>
                <div style="font-size:0.85em; color:#555;">
                    凭借强悍的凝血能力，完全止住了 <b>${bleedDmg}</b> 点流血伤害。
                </div>
            </div>`;
        }

        ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: this }),
          content: contentHtml
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
    if (this.type === "container") return; //容器直接返回
    const mode = options.mode || "basic";
    const isOpportunity = mode === "opportunity";
    // 野兽攻击：复用本管线，但永不暴击、伤害值/类型由特性提供
    const isCreatureAttack = options.isCreatureAttack === true;
    const label = options.label || (isOpportunity ? "趁虚而入" : "普通攻击");
    // 0. 状态阻断检查 (Status Check)
    const s = this.xjzlStatuses || {};
    if (s.stun) return ui.notifications.warn(`${this.name} 处于晕眩状态，无法行动！`);

    // 1. 获取当前主武器信息
    // 逻辑：寻找第一个已装备的武器，如果没有则视为徒手
    const weapon = this.itemTypes.weapon.find(i => i.system.equipped);
    const weaponType = weapon ? weapon.system.type : "unarmed";
    const weaponName = weapon ? weapon.name : "徒手";
    // 野兽攻击的伤害值由特性直接提供；人物普攻取武器基础伤害
    const baseDamage = options.baseDamage ?? (weapon ? (weapon.system.damage || 0) : 0); // 徒手基础伤害通常为0

    // 2. 弹窗配置 (Dialog)
    // 普攻需要选择：伤害类型 (内功/外功)、手动修正
    let config = {
      damageType: options.damageType || "waigong",
      bonusAttack: 0,
      bonusDamage: 0,
      canCrit: true, // 普攻默认可暴击
      manualAttackLevel: 0,
      alwaysHit: false //必定命中，默认否
    };

    if (!options.skipDialog) {
      const dialogResult = await this._promptBasicAttackConfig(weaponName, options);
      if (!dialogResult) return; // 用户取消
      config = { ...config, ...dialogResult };
    }

    // 野兽攻击永不暴击：强制关闭，并经由 chat flag neverCrit 抑制 isCrit 状态
    if (isCreatureAttack) config.canCrit = false;

    // 3. 构建“虚拟招式”对象 (Virtual Move)
    // 这是一个临时对象，结构模仿 Item 中的 move，以便兼容脚本引擎和聊天模板
    const virtualMove = {
      id: isOpportunity ? "opportunity-attack" : (isCreatureAttack ? "creature-attack" : "basic-attack"),
      name: isCreatureAttack ? label : `${label} (${weaponName})`,
      type: "basic", // 新增加一种单独的类型，避免触发其他的特效
      damageType: config.damageType, // 由弹窗决定
      weaponType: weaponType,
      isUltimate: false,
      img: isOpportunity ? "icons/skills/melee/strike-dagger-blood-red.webp" : (weapon ? weapon.img : "icons/skills/melee/unarmed-punch-fist.webp"), // 图标
      currentCost: { mp: 0, rage: 0, hp: 0 }, // 普攻无消耗
      description: isOpportunity ? "发起一次趁虚而入。" : "发起一次基础攻击。"
    };

    // 资源处理 (趁虚而入特供)
    const resourceUpdates = {};
    let moraleSpent = 0;

    // 只有趁虚而入才消耗士气
    if (isOpportunity) {
      moraleSpent = this.system.resources.morale.value || 0;
      if (moraleSpent > 0) {
        resourceUpdates["system.resources.morale.value"] = 0;
        // 执行扣除
        await this.changeResources(resourceUpdates, {
          cause: "moveCost",
          sourceActor: this,
          item: null,
          move: virtualMove
        });
      }
    }

    // 构造消耗记录对象 (普攻无蓝耗，但有士气耗)
    const costConsumed = {
      mp: 0, hp: 0, rage: 0,
      morale: moraleSpent
    };

    // =====================================================
    // 3.5 构建“虚拟物品”对象 (Virtual Item)
    // 目的: 填充脚本上下文中的 args.item，防止脚本报错
    // =====================================================
    const virtualItem = {
      id: "basic", // 固定 ID
      uuid: "Virtual.BasicAttack", // 虚拟 UUID
      name: "普通攻击",
      type: "basic", // 特殊类型，方便脚本判断
      img: virtualMove.img,
      actor: this, // 链接回 Actor
      system: {
        description: "基础攻击动作",
        moves: [virtualMove] // 包含招式
      },
      // 简单的 Mock 方法，防止脚本调用 getFlag 报错
      getFlag: (scope, key) => null,
      flags: {}
    };

    // === [战斗统计] 普攻出招 ===
    if (game.settings.get("xjzl-system", "enableCombatStats")) {
      Hooks.callAll("xjzl.combatStatRecord", {
        eventType: "cast",
        attacker: this,
        move: virtualMove,
        item: virtualItem,
        cost: costConsumed
      });
    }

    // =====================================================
    // 4. 触发 "出招" 回复 (Regen On Attack)
    // =====================================================
    if (isOpportunity) await this.processRegen("Attack");
    // TODO 暂时来说没有普通攻击触发的，以后会有吗？

    // === 消耗次要动作 ===
    ActionTracker.consumeAction(this, "次要动作");

    // =====================================================
    // 4·5 提前计算基础伤害
    // =====================================================
    // 理由：让脚本能获取并修改这个结果
    const calcResult = this._calculateBasicAttackDamage(virtualMove, baseDamage, config, mode, moraleSpent, virtualItem);

    if (!calcResult) {
      return ui.notifications.error("伤害计算失败");
    }

    // =====================================================
    // 5. 执行 ATTACK 阶段脚本
    // =====================================================
    const attackContext = {
      move: virtualMove,
      item: virtualItem, // 注入虚拟物品
      attacker: this,    // 明确 attacker
      costConsumed: costConsumed,
      flags: {
        level: s.attackLevel || 0,
        feintLevel: 0, // 普攻没有虚招
        abort: false,
        abortReason: "",
        autoApplied: false,    // 是否自动应用
        critThresholdMod: 0,   // 暴击阈值修正
        bonusHit: 0,           // 脚本给予的命中加值
        bonusFeint: 0,         // 脚本给予的虚招加值(虽然普攻一般不用，但为了兼容性加上)
        forceHit: false, // 全局必中参数
        alwaysHit: config.alwaysHit || false, //必定命中，和上个参数的区别是这个不会跳过投掷，可以暴击
        damageResult: calcResult
      }
    };

    // 运行脚本：虽然没有招式但内功、装备等可能对“普通攻击”有特殊加成
    // 脚本中可以通过判断 trigger === 'attack' && args.move.type === 'basic' 来专门针对普攻写逻辑
    await this.runScripts(SCRIPT_TRIGGERS.ATTACK, attackContext, virtualMove);
    // 获取全局必中状态
    const isGlobalForceHit = attackContext.flags.forceHit || false;
    // 提取脚本计算出的命中修正
    const scriptBonusHit = attackContext.flags.bonusHit || 0;
    if (attackContext.flags.abort) {
      if (attackContext.flags.abortReason) ui.notifications.warn(attackContext.flags.abortReason);
      return;
    }

    // =====================================================
    // 6. 伤害计算，应该不需要了，我们把伤害计算提前了
    // =====================================================
    // 我们需要把 moraleSpent 传给计算函数
    // const calcResult = this._calculateBasicAttackDamage(virtualMove, baseDamage, config, mode, moraleSpent, virtualItem);

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
        attacker: this,
        item: virtualItem,
        move: virtualMove,
        flags: {
          grantLevel: 0,
          ignoreBlock: false,
          ignoreDefense: false,
          ignoreStance: false,
          grantFeintLevel: 0,  // 虚招等级修正
          critThresholdMod: 0, // 针对该目标的暴击阈值修正
          grantHit: 0,         // 针对该目标的命中加值
          grantFeint: 0,        // 针对该目标的虚招加值
          forceHit: false, // 添加单目标必中参数
          alwaysHit: false //必定命中，和上个参数的区别是这个不会跳过投掷，可以暴击
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
        ignoreStance: baseIgnoreStance || checkContext.flags.ignoreStance,
        critThresholdMod: checkContext.flags.critThresholdMod || 0,
        grantHit: checkContext.flags.grantHit || 0,
        grantFeint: checkContext.flags.grantFeint || 0,
        forceHit: checkContext.flags.forceHit || false,
        alwaysHit: checkContext.flags.alwaysHit || false
      });
    }

    // =====================================================
    // 8. 掷骰 (Roll)
    // =====================================================
    // 普攻必定需要命中检定
    let hitMod = (config.damageType === "waigong" ? this.system.combat.hitWaigongTotal : this.system.combat.hitNeigongTotal);
    hitMod += (config.bonusAttack + scriptBonusHit);

    let attackRoll = null;
    let rollJSON = null;
    let rollTooltip = null;

    // 初始化显示数据
    let displayTotal = 0;
    let flavorSuffix = "";

    // 初始化骰子结果变量，供后面使用
    let d1 = 0;
    let d2 = 0;

    // 只有在 (非全局必中) 时才进行投掷
    if (!isGlobalForceHit) {

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
      attackRoll = await new Roll(`${diceFormula} + @mod`, { mod: hitMod }).evaluate();
      rollJSON = attackRoll.toJSON();
      rollTooltip = await attackRoll.getTooltip();

      // 解析结果
      const diceResults = attackRoll.terms[0].results.map(r => r.result);
      d1 = diceResults[0];
      d2 = diceResults[1] || d1;

      // 计算主要显示的数值
      let primaryState = 0;
      if (targets.length > 0) {
        primaryState = targetContexts.get(targets[0].document.uuid)?.attackState || 0;
      } else {
        primaryState = (selfLevel > 0) ? 1 : ((selfLevel < 0) ? -1 : 0);
      }

      displayTotal = 0;
      flavorSuffix = "";
      if (primaryState === 1) {
        displayTotal = Math.max(d1, d2) + hitMod;
        flavorSuffix = "(优势)";
      } else if (primaryState === -1) {
        displayTotal = Math.min(d1, d2) + hitMod;
        flavorSuffix = "(劣势)";
      } else {
        displayTotal = d1 + hitMod;
      }
    } else {
      // 全局必中模式
      flavorSuffix = "(必中)";
      displayTotal = "-"; // 或者 0
      // attackRoll 保持 null
    }

    // 填充目标结果
    const targetsResults = {};
    targets.forEach(t => {
      const tokenUuid = t.document.uuid;
      const ctx = targetContexts.get(tokenUuid) || { attackState: 0 };
      const state = ctx.attackState;
      const isTargetForceHit = ctx.forceHit;

      let finalDie = "-";
      let outcomeLabel = "-";
      let total = "-";
      let isHit = false;
      let dodge = "-";

      // 判定逻辑
      if (!isGlobalForceHit && !isTargetForceHit) {

        finalDie = d1;
        outcomeLabel = "平";
        if (state === 1) { finalDie = Math.max(d1, d2); outcomeLabel = "优"; }
        else if (state === -1) { finalDie = Math.min(d1, d2); outcomeLabel = "劣"; }

        total = finalDie + hitMod + (ctx.grantHit || 0);
        dodge = t.actor?.system.combat.dodgeTotal ?? 10;
        // alwaysHit 干预
        const isGlobalAlwaysHit = attackContext.flags.alwaysHit || false;

        if (finalDie === 20) {
          isHit = true;
        } else if (isGlobalAlwaysHit || ctx.alwaysHit) {
          isHit = true; // 强制命中
          if (!outcomeLabel.includes("必中")) outcomeLabel += "(必中)"; // 界面提示
        } else if (finalDie === 1) {
          isHit = false;
        } else {
          isHit = total >= dodge;
        }
      } else {
        // 必中逻辑
        isHit = true;
        outcomeLabel = "必中";
        // total, finalDie 保持 "-"
      }

      targetsResults[tokenUuid] = {
        name: t.name,
        total: total,
        isHit: isHit,
        stateLabel: outcomeLabel,
        dodge: dodge,
        dieUsed: finalDie,
        feintState: 0,
        ignoreBlock: ctx.ignoreBlock,
        ignoreDefense: ctx.ignoreDefense,
        ignoreStance: ctx.ignoreStance,
        critThresholdMod: ctx.critThresholdMod || 0,
        forceHit: isTargetForceHit
      };
    });

    // =====================================================
    // 9. 发送聊天消息
    // =====================================================
    const isAutoApplied = attackContext.flags.autoApplied || false;
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
      showFeintBtn: false, // 普攻不显示虚招
      autoApplied: isAutoApplied
    };

    const content = await renderTemplate(
      "systems/xjzl-system/templates/chat/move-card.hbs",
      templateData
    );

    const chatData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: `${isCreatureAttack ? ("发起" + label) : "发起普通攻击"} ${flavorSuffix}`,
      content: content,
      flags: {
        "xjzl-system": {
          actionType: "basic-attack", // 特殊标识
          // 这里不传 itemId 和 moveId，或者传特定的标记
          itemId: "basic",
          moveId: virtualMove.id, // 区分 ID
          moveType: "basic",
          scriptBonusHit: scriptBonusHit,
          critThresholdMod: attackContext.flags.critThresholdMod || 0,
          forceHit: isGlobalForceHit,
          alwaysHit: attackContext.flags.alwaysHit || false,

          costConsumed: costConsumed, // 记录消耗
          damage: calcResult.damage,
          feint: 0,
          calc: calcResult,
          damageType: config.damageType,
          canCrit: config.canCrit,
          neverCrit: isCreatureAttack, // 野兽攻击永不暴击：抑制 isCrit 状态
          manualCritMod: config.manualCritMod,
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
              forceHit: res.forceHit,
              alwaysHit: res.alwaysHit || false,
              critThresholdMod: res.critThresholdMod || 0,
              total: res.total,
              dieUsed: res.dieUsed,
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

    if (attackRoll && game.dice3d) {
      game.dice3d.showForRoll(attackRoll, game.user, true);
    }

    // =====================================================
    // 10. Automated Animations 模组对接
    // =====================================================
    if (game.modules.get("autoanimations")?.active) {
      // 获取场景中的 Token 对象
      const tokens = this.isToken ? [this.token.object] : this.getActiveTokens();
      const sourceToken = tokens.length > 0 ? tokens[0] : null;

      if (sourceToken) {
        // 使用 virtualMove 的名称 (例如 "普通攻击 (徒手)" 或 "趁虚而入 (金蛇剑)")
        const safeName = virtualMove.name.trim();

        // 构建伪造 Item 对象
        const pseudoItem = {
          name: safeName,
          type: "weapon", // 普攻均视为物理武器攻击
          img: virtualMove.img,
          hasAttack: true,
          hasDamage: true,
          system: {
            actionType: "mwak" // mwak = 近战武器攻击
          }
        };

        // 播放动画
        AutomatedAnimations.playAnimation(sourceToken, pseudoItem, { targets: targets });
      }
    }

    // 插入 Hook：允许后续逻辑（如自动播放特效、自动化模组监听）
    Hooks.callAll("xjzl.basicAttack", this, virtualMove, message, calcResult);
  }

  /**
   * [内部] 普攻配置弹窗
   * options 参数
   */
  async _promptBasicAttackConfig(weaponName, options = {}) {
    // 1. 生成唯一 ID
    const formId = `roll-config-${foundry.utils.randomID()}`;
    const isOpportunity = options.mode === "opportunity"; // 判断是否趁虚而入
    // 野兽攻击：隐藏暴击区、对所有伤害类型都显示命中区
    const isCreatureAttack = options.isCreatureAttack === true;
    // 2. 准备基础数据
    // 必须提供 selectOptions 所需的列表，否则 Handlebars 会报错
    const moveTypes = {
      real: "实招", // 普攻只能是实招
    };

    // 伤害类型：野兽攻击用全量列表（由特性传入），人物普攻默认外功/内功
    const damageTypes = options.damageTypes || { waigong: "外功", neigong: "内功" };

    // 3. 准备模板上下文
    const context = {
      formId: formId,
      // --- 关键修复：传入下拉框数据 ---
      moveTypes: moveTypes,
      damageTypes: damageTypes,

      // 默认选中状态
      currentMoveType: "real",    // 普攻默认为实招
      currentDamageType: options.defaultDamageType || "waigong", // 默认外功（野兽取特性上的类型）

      // 初始显隐控制
      needsAttack: true,  // 实招默认显示攻击
      isFeint: false,     // 实招默认不显示虚招
      needsDamage: true,  // 普攻需要伤害
      isHeal: false,
      // 野兽攻击永不暴击 → 隐藏暴击区；趁虚而入默认不勾选暴击，普攻默认勾选
      canCrit: isCreatureAttack ? false : (!isOpportunity),

      // 额外标记
      weaponName: weaponName
    };
    // 4. 渲染模板
    const content = await renderTemplate("systems/xjzl-system/templates/apps/roll-config.hbs", context);

    // 注意：不再需要 extraContent 的字符串替换 Hack，因为新的 HBS 顶部已经包含了伤害类型选择器

    // 5. 调用 DialogV2
    return foundry.applications.api.DialogV2.wait({
      window: {
        title: `普通攻击配置 (${weaponName})`, // 将武器名显示在标题更合适
        icon: "fas fa-fist-raised"
      },
      content: content,

      render: (event) => {
        const root = document.getElementById(formId);
        if (!root) return;

        // --- 复用显隐逻辑 (Copied from _promptRollConfiguration) ---
        // 这是为了当用户在普攻界面依然想切换成“虚招”时，界面能正确响应
        const refreshUI = () => {
          const mType = root.querySelector('[name="overrideMoveType"]').value;
          const dType = root.querySelector('[name="overrideDamageType"]').value;

          const setVisible = (el, isVisible, displayType = "block") => {
            if (!el) return;
            if (isVisible) {
              el.style.removeProperty("display");
              el.style.setProperty("display", displayType, "important");
            } else {
              el.style.setProperty("display", "none", "important");
            }
          };

          // 1. 虚招板块
          const feintSection = root.querySelector('[data-section="feint"]');
          setVisible(feintSection, mType === "feint", "block");

          // 2. 攻击板块 (实招且非反击)
          // 野兽攻击：无论何种伤害类型都先过命中，故始终显示攻击板块
          const needsAtk = isCreatureAttack || ((mType !== "counter") && ["waigong", "neigong"].includes(dType));
          const atkSection = root.querySelector('[data-section="attack"]');
          setVisible(atkSection, needsAtk, "block");

          // 3. 暴击板块（野兽攻击永不暴击，强制隐藏）
          const critSection = root.querySelector('[data-section="crit"]');
          setVisible(critSection, (mType !== "counter") && !isCreatureAttack, "flex");
        };

        // 绑定监听
        root.querySelector('[name="overrideMoveType"]').addEventListener("change", refreshUI);
        root.querySelector('[name="overrideDamageType"]').addEventListener("change", refreshUI);

        // 初始化一次 UI 状态
        refreshUI();

        // 按钮点击监听 (计数器)
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
            // 从 HBS 的新字段 overrideDamageType 获取值，并赋给 damageType
            damageType: getVal("overrideDamageType"),

            bonusAttack: parseInt(getVal("bonusAttack")) || 0,
            bonusDamage: parseInt(getVal("bonusDamage")) || 0,
            manualAttackLevel: parseInt(getVal("manualAttackLevel")) || 0,
            canCrit: getVal("canCrit") !== false,
            manualCritMod: parseInt(getVal("manualCritMod")) || 0, //手动暴击阈值

            // 如果普攻也能临时变更为虚招，可以在这里获取 overrideMoveType
            // 但目前的 rollBasicAttack 逻辑只处理 basic，这里仅作兼容
            isFeint: getVal("overrideMoveType") === "feint",
            alwaysHit: getVal("alwaysHit") === true // 必定命中
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
   * 增加 moraleSpent 参数
   */
  _calculateBasicAttackDamage(virtualMove, baseDamage, config, mode, moraleSpent = 0, virtualItem = null) {
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
    let cxBonus = 0;
    const wType = virtualMove.weaponType;
    let flatBonus = 0;
    if (sys.combat?.damages) {
      flatBonus += (sys.combat.damages.global?.total || 0); // 全局加成
      flatBonus += (sys.combat.damages.normal?.total || 0); // 专门针对普攻的加成
      // 只有当拿着兵器时才生效
      if (wType && wType !== 'none') {
        flatBonus += (sys.combat.damages.weapon?.total || 0); // 武器类伤害加成
      }
      // 特定武器类型伤害 (Specific Weapon Type Bonus)
      if (wType && sys.combat.damages.weaponTypes) {
        flatBonus += (sys.combat.damages.weaponTypes[wType]?.total || 0);
      }
      if (isOpportunity) {
        flatBonus += (sys.combat.damages.skill?.total || 0); //趁虚而入还能享受到招式伤害加成
        // 使用传入的已消耗士气，而不是读取 system
        flatBonus += moraleSpent;
        //处理趁虚而入的升级伤害加成
        // 查找身上是否有趁虚而入招式以获取升级加成
        for (const w of this.itemTypes.wuxue) {
          // 趁虚而入是散手，直接跳过普通武学、轻功等
          if (w.system.category !== "sanshou") continue;
          const cxMove = w.system.moves?.find(m => m.name === "趁虚而入");
          if (cxMove) {
            const lvl = Math.max(1, cxMove.computedLevel || 1);
            if (lvl > 1) {
              cxBonus = (lvl - 1) * 5;
              flatBonus += cxBonus;
            }
            break;
          }
        }
      }
      //新增了内功伤害和外功伤害的加成
      if (virtualMove.damageType && virtualMove.damageType === "neigong") {
        flatBonus += (sys.combat.damages.neigong?.total || 0);
      }
      if (virtualMove.damageType && virtualMove.damageType === "waigong") {
        flatBonus += (sys.combat.damages.waigong?.total || 0);
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
      bonusDesc: [],
      feintBonusDesc: [] // 让参数与招式保持一致
    };

    // 注入 item 到上下文
    const calcContext = {
      move: virtualMove,
      item: virtualItem,
      baseData: { base: weaponDmg, rank: rankBonus, weapon: weaponDmg, isWeaponMatch: true },
      output: calcOutput
    };

    // 同步执行
    this.runScripts(SCRIPT_TRIGGERS.CALC, calcContext, virtualMove);

    // 5. 应用手动修正
    let finalDamage = Math.floor(calcOutput.damage + config.bonusDamage);

    // 6. 生成 Breakdown
    let breakdownText = `武器基础: ${weaponDmg}\n`;
    breakdownText += `+ 武器等级: ${rankBonus}\n`;
    breakdownText += `+ 其他增伤: ${flatBonus}`;
    if (isOpportunity) {
      breakdownText += ` (含招式加成)`; // 提示文本
      if (cxBonus > 0) {
        breakdownText += `\n+ 趁虚而入升级加成: ${cxBonus}`;
      }
    }

    const scriptBonus = Math.floor(calcOutput.damage) - preScriptDmg;
    if (config.bonusDamage !== 0) {
      breakdownText += `\n+ 手动修正: ${config.bonusDamage}`;
    }
    if (isOpportunity && moraleSpent > 0) {
      breakdownText += ` (含士气 ${moraleSpent})`;
    }

    const hasScriptChange = scriptBonus !== 0;
    const hasScriptDesc = calcOutput.bonusDesc && calcOutput.bonusDesc.length > 0;

    if (hasScriptChange || hasScriptDesc) {
      const sign = scriptBonus > 0 ? "\n+" : "";
      // 显示总的数值变化
      breakdownText += `${sign} 特效修正: ${scriptBonus}`;

      // 如果有详细描述，遍历显示
      if (hasScriptDesc) {
        breakdownText += `\n`; // 换行开始列出详情
        calcOutput.bonusDesc.forEach(desc => {
          // 使用缩进符号 (└) 让层级更清晰
          breakdownText += `   └ ${desc}\n`;
        });
      } else {
        // 如果没有描述但有数值变化，保留原来的通用提示
        breakdownText += ` (计算/被动特效)\n`;
      }
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

  /* -------------------------------------------- */
  /*  架招管理 (Stance Management)                */
  /* -------------------------------------------- */

  /**
   * 主动解除当前架招
   * 1. 重置 martial 状态
   * 2. 移除源自该架招的临时特效 (如果有)
   * 3. 视觉反馈
   */
  async stopStance() {
    if (this.type === "container") return; //容器直接返回

    // ==========================================
    // 如果没权限，打包发给 GM 执行
    // ==========================================
    if (!this.isOwner) {
      return await xjzlSocket.executeAsGM("stopStance", this.uuid);
    }

    // 1. 检查当前是否有架招
    const martial = this.system.martial;
    if (!martial.stanceActive) return;

    // 2. 准备更新数据
    const updates = {
      "system.martial.stanceActive": false,
      "system.martial.stance": "",       // 清空招式ID
      "system.martial.stanceItemId": ""  // 清空物品ID
    };

    // 3. 查找需要清理的特效 (只清理标记了 tiedToStance 标签的AE)
    const effectsToDelete = [];
    for (const effect of this.effects) {
      if (effect.getFlag("xjzl-system", "tiedToStance")) {
        effectsToDelete.push(effect.id);
      }
    }

    // 4. 执行更新
    await this.update(updates);

    if (effectsToDelete.length > 0) {
      await this.deleteEmbeddedDocuments("ActiveEffect", effectsToDelete);
    }

    // 5. 视觉反馈
    this.showFloatyText("解除架招", {
      direction: 1,
      fontSize: 28,
      fill: "#cccccc"
    });

    // 可选：发送一条聊天提示
    /*
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<div style="font-size:0.8em; color:#555;">已解除架招姿态。</div>`
    });
    */
  }

  /**
   * 切换招式的“常用”状态 (Pin/Unpin)
   * 操作 flags.xjzl-system.pinnedMoves
   * @param {String} itemId - 武学物品 ID
   * @param {String} moveId - 招式 ID
   */
  async togglePinnedMove(itemId, moveId) {
    // 1. 获取当前列表 (Set 自动去重)
    const currentList = this.getFlag("xjzl-system", "pinnedMoves") || [];
    const targetRef = `${itemId}.${moveId}`;
    const newSet = new Set(currentList);

    // 2. 切换状态
    if (newSet.has(targetRef)) {
      newSet.delete(targetRef);
      // ui.notifications.info("已取消常用招式"); // 可选反馈
    } else {
      newSet.add(targetRef);
      // ui.notifications.info("已设为常用招式");
    }

    // 3. 保存
    await this.setFlag("xjzl-system", "pinnedMoves", Array.from(newSet));
  }

  /**
   * 手动修改修为池 (带审计日志) - [修正版]
   * @param {String} poolKey - 目标池 (general, neigong, wuxue, arts)
   * @param {Number} amount - 变动数值
   * @param {Object} details - 日志详情 { title, reason, gameDate }
   */
  async manualModifyXP(poolKey, amount, { title, reason, gameDate } = {}) {
    if (this.type === "container") return; //容器直接返回
    const system = this.system;

    // 1. 验证目标池
    if (!["general", "neigong", "wuxue", "arts"].includes(poolKey)) {
      ui.notifications.error(`无效的修为池类型: ${poolKey}`);
      return;
    }

    // 2. 计算新余额
    const currentBalance = system.cultivation[poolKey] || 0;
    const newBalance = currentBalance + amount;

    if (newBalance < 0) {
      ui.notifications.warn(`操作失败：${poolKey} 余额不足 (当前: ${currentBalance})`);
      return;
    }


    // 3. 构建历史日志 (History Object)
    const historyEntry = {
      id: foundry.utils.randomID(),
      realTime: Date.now(), // 现实时间永远记录，作为技术底层的排序依据

      // 玩家手动输入的游戏时间，留空则前端显示时通常会回退显示现实时间
      gameDate: gameDate || "",

      type: "resource",
      // 固定为 1 (正常显示)，因为手动调整通常都是值得记录的大事
      importance: 1,

      // 优先使用玩家输入的标题
      title: title || "修为调整",

      delta: (amount > 0 ? "+" : "") + amount,
      balance: `${poolKey}: ${newBalance}`,
      reason: reason || "手动调整",
      refId: this.uuid
    };

    // 4. 执行更新
    const updateData = {
      [`system.cultivation.${poolKey}`]: newBalance,
      "system.history": [historyEntry, ...system.history]
    };

    await this.update(updateData);
    ui.notifications.info(`修为已更新: ${poolKey} ${amount > 0 ? '+' : ''}${amount}`);
  }

  /**
   * 执行小憩 (Short Rest)
   */
  async shortRest() {
    if (this.type === "container") return; // 容器不能休息
    const res = this.system.resources;

    // 1. 检查次数
    if (res.rest.value <= 0) {
      ui.notifications.warn("今日小憩次数已用尽，请进行休整。");
      return;
    }

    // 先计算好数值，防止模板里出现 undefined
    const newRestValue = res.rest.value - 1;
    const maxRestValue = res.rest.max;

    // 2. 准备更新数据
    const updates = {
      "system.resources.mp.value": res.mp.max,      // 回满内力
      "system.resources.rage.value": 0,             // 清空怒气
      "system.resources.huti": 0,                   // 清空护体
      "system.resources.rest.value": newRestValue   // 扣除次数
    };

    // 3. 执行更新
    await this.changeResources(updates, { cause: "shortRest" });

    // 4. 发送聊天卡片
    const content = `
      <div class="xjzl-chat-card item-card">
        
        <header class="card-header" style="border-left: 4px solid var(--c-cinnabar);">
            <img src="${this.img}" style="border:none;" />
            <div>
                <h3 style="color: var(--c-cinnabar);">小憩 </h3>
                <div style="font-size: 0.8em; color: #555;">
                    <span style="background: #555; color: #fff; padding: 0 4px; border-radius: 2px;">休息</span>
                    耗时：半个时辰 (1小时)
                </div>
            </div>
        </header>

        <div class="card-content-wrapper">
            <div class="card-description" style="font-style: italic; color: #666; margin-bottom: 8px;">
                你聚精会神，搬运内功，顿觉神清气爽。
            </div>

            <div class="card-tags" style="margin-bottom: 5px;">
                <span style="background: rgba(0,0,0,0.05); border: 1px solid rgba(0,0,0,0.1);">
                    <strong>内力:</strong> 已回满
                </span>
                <span style="background: rgba(0,0,0,0.05); border: 1px solid rgba(0,0,0,0.1);">
                    <strong>怒气:</strong> 清零
                </span>
            </div>

            <div style="margin: 5px 0; padding: 4px; background: #fdf6e3; border: 1px solid #d6d6d6; border-radius: 3px; font-size: 0.9em; text-align: center;">
                 剩余次数: <b>${newRestValue}</b> / ${maxRestValue}
            </div>

            <div style="margin-top: 8px; border-top: 1px dashed #ccc; padding-top: 5px; font-size: 0.85em; color: #2c3e50;">
                <div style="margin-bottom: 3px;">
                    <i class="fas fa-exclamation-circle"></i> <b>可选行动:</b>
                </div>
                <ul style="margin: 0; padding-left: 20px; color: #555;">
                    <li>进行一次 <strong>[疗伤]</strong> 检定以回复气血。</li>
                    <li>尝试一次 <strong>[打通经脉]</strong>。</li>
                </ul>
            </div>
        </div>
      </div>
    `;

    ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  }

  /**
   * 执行休整 (Long Rest)
   */
  async longRest() {
    if (this.type === "container") return; //容器直接返回
    const res = this.system.resources;

    // 1. 准备更新数据
    const updates = {
      "system.resources.hp.value": res.hp.max,    // 回满气血
      "system.resources.mp.value": res.mp.max,    // 回满内力
      "system.resources.rage.value": 0,           // 清空怒气
      "system.resources.huti": 0,                 // 清空护体
      "system.resources.rest.value": res.rest.max // 重置小憩次数
    };

    // 2. 执行更新
    await this.changeResources(updates, { cause: "longRest" });

    // 3. 发送聊天卡片 (蓝色主题，区分于小憩)
    const content = `
      <div class="xjzl-chat-card item-card">
        
        <header class="card-header" style="border-left: 4px solid #2a506f;">
            <img src="${this.img}" style="border:none;" />
            <div>
                <h3 style="color: #2a506f;">休整</h3>
                <div style="font-size: 0.8em; color: #555;">
                    <span style="background: #2a506f; color: #fff; padding: 0 4px; border-radius: 2px;">睡眠</span>
                    耗时：四个时辰 (8小时)
                </div>
            </div>
        </header>

        <div class="card-content-wrapper">
            <div class="card-description" style="font-style: italic; color: #666; margin-bottom: 8px;">
                经过长时间的休息、进食与练功，你的状态已恢复巅峰。
            </div>

            <div class="card-tags" style="margin-bottom: 5px;">
                <span style="background: rgba(42, 80, 111, 0.1); border: 1px solid rgba(42, 80, 111, 0.2);">
                    <strong>气血/内力:</strong> 回满
                </span>
                <span style="background: rgba(42, 80, 111, 0.1); border: 1px solid rgba(42, 80, 111, 0.2);">
                    <strong>小憩次数:</strong> 重置
                </span>
            </div>

            <div style="margin-top: 8px; border-top: 1px dashed #aaa; padding-top: 5px; font-size: 0.85em; color: #2c3e50;">
                <div style="margin-bottom: 3px;">
                    <i class="fas fa-book-reader"></i> <b>休整期活动:</b>
                </div>
                <ul style="margin: 0; padding-left: 20px; color: #555;">
                    <li>打开界面 <strong>[分配修为]</strong> 提升武学。</li>
                    <li><strong>[研读]</strong> 技艺书籍。</li>
                    <li>尝试 <strong>[打通经脉]</strong>。</li>
                </ul>
            </div>
        </div>
      </div>
    `;

    ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  }

  /**
   * 执行经脉操作 (Invest/Refund Jingmai)
   */

  /**
   * 增加突破经脉次数
   * @param {string} key - 经脉名
   */
  async investJingmai(key) {

    if (this.type === "container") return { applied: 0, cost: 0 }; //容器直接返回

    // 检查经脉是否是十二正经
    if (!CONFIG.XJZL.acupoints[key]) {
      ui?.notifications?.warn?.(`${key}不存在或无法突破，请选择十二正经之一`);
      return { applied: 0, cost: 0 };
    }

    const jingmaiPath = `system.jingmai.standard.${key}`;
    const attemptsPath = `system.jingmai.attempts.${key}`;

    const isOpened = !!foundry.utils.getProperty(this, jingmaiPath);
    const currentAttempts = Number(foundry.utils.getProperty(this, attemptsPath)) || 0;
    const actorGeneral = Number(this.system?.cultivation?.general) || 0;

    // 检查通用修为是否足够或者经脉是否已打通
    // 仅仅只是记录修为消耗用的，感觉没必要限制
    // if (isOpened) {
    //   ui?.notifications?.warn?.("此经脉已打通，不可再突破。");
    //   return { applied: 0, cost: 0 };
    // }

    if (actorGeneral < JINGMAI_ATTEMPT_COST) {
      ui?.notifications?.warn?.("通用修为不足。");
      return { applied: 0, cost: 0 };
    }

    // 执行更新
    await this.update({
      [attemptsPath]: currentAttempts + 1,
      "system.cultivation.general": actorGeneral - JINGMAI_ATTEMPT_COST,
    });

    console.log(`使用500修为尝试突破经脉: ${key}。`);

    return { applied: 1, cost: JINGMAI_ATTEMPT_COST };
  }

  /**
   * 减少突破经脉次数
   * @param {string} key - 经脉名
   */
  async refundJingmai(key) {
    if (this.type === "container") return { applied: 0, refund: 0 }; //容器直接返回
    // 检查经脉是否是十二正经
    if (!CONFIG.XJZL.acupoints[key]) {
      ui?.notifications?.warn?.(`${key}不存在或无法突破，请选择十二正经之一`);
      return { applied: 0, refund: 0 };
    }

    const jingmaiPath = `system.jingmai.standard.${key}`;
    const attemptsPath = `system.jingmai.attempts.${key}`;

    const isOpened = !!foundry.utils.getProperty(this, jingmaiPath);
    const currentAttempts = Number(foundry.utils.getProperty(this, attemptsPath)) || 0;
    const actorGeneral = Number(this.system?.cultivation?.general) || 0;

    // 扣除时还需检查是否为0
    if (currentAttempts <= 0) {
      ui?.notifications?.warn?.(`此经脉没有尝试过突破，无法退还。`);
      return { applied: 0, refund: 0 }
    }

    // 检查经脉是否已打通
    // 仅仅只是记录修为消耗用的，感觉没必要限制
    // if (isOpened) {
    //   ui?.notifications?.warn?.("此经脉已打通，请取消后再修改。");
    //   return { applied: 0, cost: 0 };
    // }

    // 执行更新
    await this.update({
      [attemptsPath]: currentAttempts - 1,
      "system.cultivation.general": actorGeneral + JINGMAI_ATTEMPT_COST,
    });

    console.log(`返还突破 ${key}使用的500修为。`);

    return { applied: 1, refund: JINGMAI_ATTEMPT_COST };
  }


  // ================= 权限辅助 =================

  /**
   * 获取 Actor 的第一个 owner 用户 ID
   * 优先读取 Token 的 ownership（处理 unlinked token 的独立 ownership），
   * 其次读取 Actor 的 ownership。
   * 优先返回玩家（非 GM），如果没有玩家 owner 才返回 GM。
   * @returns {string|null} owner userId，如果没有则返回 null
   */
  getFirstOwnerId() {
    // 优先读取 Token 的 ownership
    let ownership = null;
    if (this.isToken && this.token && this.token.actorLink === false && this.token.ownership) {
      ownership = this.token.ownership;
    } else if (this.ownership) {
      ownership = this.ownership;
    }

    if (!ownership) return null;

    // 一遍遍历：优先返回在线玩家，记录第一个 GM 作为兜底
    let firstGmOwnerId = null;
    for (const [userId, level] of Object.entries(ownership)) {
      if (userId === 'default') continue;
      if (level >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
        const user = game.users.get(userId);
        if (!user) continue;

        // 如果是在线玩家，立即返回（优先级最高）
        if (!user.isGM && user.active) {
          return userId;
        }

        // 如果是 GM，记录第一个（作为兜底）
        if (user.isGM && !firstGmOwnerId) {
          firstGmOwnerId = userId;
        }
      }
    }

    // 如果没有在线玩家 owner，返回第一个 GM owner（让 GM 兜底执行）
    return firstGmOwnerId;
  }

  // ======= 添加代理工厂方法 =======
  /**
   * 为本次 runScripts 创建局部 Document Proxy，并替换 sandbox / args 中的非 owner 文档别名。
   * 不修改原始 Document 实例；返回恢复函数，runScripts 结束后还原上下文中的原文档引用。
   * @returns {Function} 恢复上下文文档引用的函数
   */
  _proxifySandbox(sandbox) {
    const host = this;
    const proxies = new WeakMap();
    const restorations = [];

    const getProxy = (doc) => {
      let proxy = proxies.get(doc);
      if (!proxy) {
        proxy = new Proxy(doc, {
          get(target, prop) {
            // 权限委托方法：走 GM socket，并携带当前脚本宿主与资源链。
            if (prop === "update") {
              return async (data, context) => {
                const operation = { ...(context || {}) };
                operation.xjzlResourceContext = serializeResourceContext(inheritScriptResourceContext(
                  host,
                  inheritResourceChain(operation.xjzlResourceContext, host._resourceEventContext)
                ));
                return unwrapResourceSocketResult(await xjzlSocket.executeAsGM("updateDocument", target.uuid, data, operation));
              };
            }
            if (prop === "changeResources" && typeof target.changeResources === "function") {
              return async (data, context) => {
                const resourceContext = inheritScriptResourceContext(
                  host,
                  inheritResourceChain(context, host._resourceEventContext)
                );
                return unwrapResourceSocketResult(await xjzlSocket.executeAsGM(
                  "changeResources",
                  target.uuid,
                  data,
                  serializeResourceContext(resourceContext)
                ));
              };
            }
            if (prop === "createEmbeddedDocuments") {
              return async (type, data, context) => xjzlSocket.executeAsGM("createEmbedded", target.uuid, type, data, context);
            }
            if (prop === "deleteEmbeddedDocuments") {
              return async (type, ids, context) => xjzlSocket.executeAsGM("deleteEmbedded", target.uuid, type, ids, context);
            }
            // 其他属性和方法转发到原文档，方法绑定到 target，避免 Proxy this 破坏私有字段。
            const value = Reflect.get(target, prop, target);
            return typeof value === "function" ? value.bind(target) : value;
          }
        });
        proxies.set(doc, proxy);
      }
      return proxy;
    };

    const replaceDocuments = (obj) => {
      if (!obj || typeof obj !== "object") return;
      for (const [key, value] of Object.entries(obj)) {
        if (value instanceof foundry.abstract.Document && !value.isOwner) {
          const proxy = getProxy(value);
          restorations.push(() => { obj[key] = value; });
          obj[key] = proxy;
        }
      }
    };

    replaceDocuments(sandbox);
    replaceDocuments(sandbox.args);

    return () => {
      for (const restore of restorations.reverse()) restore();
    };
  }

  /**
   * 广播飘字效果 (Socket版)
   * 自动通过 Socket 通知所有客户端渲染。
   * @param {string} content - 显示的文本
   * @param {Object} [style] - 样式配置 (可覆盖默认值)
   * @param {number} [style.fontSize=32] - 字号
   * @param {string} [style.fill="#ffffff"] - 填充颜色
   * @param {string} [style.stroke="#000000"] - 描边颜色
   * @param {number} [style.strokeThickness=4] - 描边宽度
   * @param {number} [style.jitter=0.25] - 抖动幅度
   * @param {number} [style.anchor] - 锚点
   * @param {number} [style.direction] - 飘动方向
   */
  async showFloatyText(content, style = {}) {
    // 1. 定义系统默认样式
    const defaults = {
      anchor: CONST.TEXT_ANCHOR_POINTS.CENTER,
      direction: CONST.TEXT_ANCHOR_POINTS.TOP,
      jitter: 0.25,
      stroke: "#000000",
      strokeThickness: 4,
      fontSize: 32,
      fill: "#ffffff" // 默认白色
    };

    // 2. 合并样式：传入的 style 会覆盖 defaults
    const finalStyle = { ...defaults, ...style };

    // 3. 调用 Socket 广播
    // 传入 this.uuid，Socket端会自动解析
    if (xjzlSocket) {
      await xjzlSocket.executeForEveryone("showScrollingText", this.uuid, content, finalStyle);
    } else {
      console.warn("XJZL | Socket 未初始化，无法飘字");
    }
  }
}
