/**
 * xjzlAura —— 光环施加账本与结算执行器。
 *
 * 业务模型：
 * - **Region 事件是施加事实源**：每次被接受的真实 tokenEnter 都调用一次
 *   门面 addEffect；throttlePerRound 是进入事件唯一的业务节流；回合挂载
 *   每个有效回合事件调用一次 addEffect（叠层累加与非叠层刷新语义全部
 *   归门面）。不以账本存在性、也不以当前覆盖状态否定已发生的事件。
 * - **账目是清理收据，不是覆盖状态事实源**：账本按 Region flag
 *   `xjzl-system.ledger` 保存，身份 tokenId → behaviorId，一行为对一目标
 *   至多一条；条目自带 actorUuid，Token 删除后仍可按它解析 Actor 清理。
 * - **清理开关 cleanupOnExit**（行为 schema）：true 时记录清理账目——
 *   可叠层累计 contributedStacks、不可叠层记录 owner 身份与接管基线
 *   existedBeforeAura；false 时施加但不记账，退出不处理（效果保留）。
 * - 全部同 Actor 的施加/释放经按 actorUuid 串行的 GM 队列执行，事件顺序
 *   即队列顺序，不做基于几何覆盖状态的二次判定。
 */

/** 账本与节流的 flags 根路径。 */
const FLAG_SCOPE = "xjzl-system";
const FLAG_AURA = "aura";
const FLAG_LEDGER = "ledger";
const FLAG_THROTTLE = "throttle";

/** GM 端串行队列：按 `${actorUuid}` 分键。 */
const opQueues = new Map();
/** GM 端 movement.id 去重集合，避免重复结算同次移动。 */
const processedMovements = new Set();
/** GM 端回合结算去重集合，避免同一单位同一回合重复结算。 */
const processedRounds = new Set();
/** GM 端已处理条目 eid：删除快照和补偿清理据此避免重复摘除。 */
const processedEids = new Set();
/** 去重集合容量上限：按插入顺序 FIFO 淘汰最旧记录，不整体清空——
 *  整体清空会让刚处理过的重复事件在大批量结算后重新执行。 */
const DEDUP_LIMIT = 1024;

export class AuraLedger {

  /* -------------------------------------------- */
  /*  提交入口（事件端转发，结算统一落活动 GM）      */
  /* -------------------------------------------- */

  /**
   * 提交一次 enter 结算（移动发起者端调用，活动 GM 时直接入队）。
   * @param {object} payload - {behaviorId, regionUuid, tokenUuid, actorUuid}
   * @param {object} socketlibRef - xjzlSocket 实例（由调用方传入避免循环依赖）
   * @returns {Promise<void>} 结算完成 promise
   */
  static submitEnter(payload, socketlibRef) {
    return this.#submit({op: "enter", ...payload}, socketlibRef);
  }

  /**
   * 提交一次 exit 结算。入队时携带发起端可见的账本快照：
   * region 删除补发 exit 时行为与 flags 可能随 region 消失，快照是摘除
   * 凭据；快照为该目标**本行为**的有效账目（普通退出每行为独立结算，
   * region 删除由管理器按账目逐条提交，每条独立 owner 释放）。
   * @param {object} payload - {behaviorId, regionUuid, tokenUuid, actorUuid}
   * @param {Array<{key: string, tokenId: string, entry: object}>} snapshots - 账本条目快照数组
   * @param {object} socketlibRef - xjzlSocket 实例
   * @returns {Promise<void>} 结算完成 promise
   */
  static submitExit(payload, snapshots, socketlibRef) {
    return this.#submit({op: "exit", snapshots: snapshots ?? [], ...payload}, socketlibRef);
  }

  /**
   * 提交一次区域内部移动结算。
   * movement 只保留去重与纯区域内判定所需字段，避免整份 movement 过 socket。
   * @param {object} payload - {behaviorId, regionUuid, tokenUuid, actorUuid}
   * @param {object} movement - {id, origin, destination}（origin/destination 为 {x,y} 点）
   * @param {object} socketlibRef - xjzlSocket 实例
   * @returns {Promise<void>} 结算完成 promise
   */
  static submitMoveWithin(payload, movement, socketlibRef) {
    return this.#submit({op: "moveWithin", movement, ...payload}, socketlibRef);
  }

  /**
   * 提交一次回合结算。回合事件由活动 GM 端 Combat 工作流派发，通常本端即
   * 活动 GM；非本端时仍委托，以保证结算统一落在活动 GM 端。
   * @param {object} payload - {behaviorId, regionUuid, tokenUuid, actorUuid, timing, combatId, round}
   * @param {object} socketlibRef - xjzlSocket 实例
   * @returns {Promise<void>} 结算完成 promise
   */
  static submitRound(payload, socketlibRef) {
    return this.#submit({op: "round", ...payload}, socketlibRef);
  }

  /**
   * 统一提交口：活动 GM 端直接入队；否则经 socketlib 委托活动 GM。
   * 发起端只做事件转发，不等待结算结果（fire-and-forget，核心事件本就
   * 如此）；失败会向外抛出，调用方自行决定记录或忽略——**不得把失败
   * 转成成功**：预清理路径依赖 Promise 状态判定是否允许删除 region。
   * @param {object} op - 完整操作对象
   * @param {object} socketlibRef - xjzlSocket 实例
   * @returns {Promise<void>} 结算完成 promise（失败时 reject）
   */
  static #submit(op, socketlibRef) {
    if (game.users.activeGM?.isSelf) return this.enqueue(op);
    if (!socketlibRef?.executeAsGM) {
      // socketlib 未就绪时不得把委托失败当成成功：预清理等路径据此中止。
      return Promise.reject(new Error("XJZL | 光环账目操作失败：socketlib 尚未就绪，无法委托活动 GM"));
    }
    return socketlibRef.executeAsGM("auraLedger", op).catch(err => {
      console.error("XJZL | 光环结算委托活动 GM 失败:", op, err);
      throw err;
    });
  }

  /**
   * 将操作加入目标 Actor 串行队列并在活动 GM 端执行（socket 处理端入口）。
   * 串行键按目标 Actor：同一关联 Actor 的多个 Token
   * 落同一队列，AE 的施加/释放严格按事件顺序执行；合成 Actor 的 uuid 即
   * Token uuid，天然按 Token 分队。
   * @param {object} op - {op, behaviorId, regionUuid, tokenUuid, actorUuid, ...}
   * @returns {Promise<void>} 该操作在队列中的完成 promise
   */
  static async enqueue(op) {
    const key = op.actorUuid || op.tokenUuid;
    const previous = opQueues.get(key) || Promise.resolve();
    const current = previous
        .catch(err => console.error(`XJZL | 光环队列前序操作失败 [${key}]:`, err))
        .then(() => this.#execute(op));
    const queued = current.finally(() => {
      if (opQueues.get(key) === queued) opQueues.delete(key);
    });
    opQueues.set(key, queued);
    return queued;
  }

  /* -------------------------------------------- */
  /*  账本读写（GM 端）                            */
  /* -------------------------------------------- */

  /**
   * region 是否仍在父场景集合中：region 删除与队列操作并发时，执行体
   * 可能在本地集合移除前 fromUuid 到"临终"实例，其后的 flags 写回会因
   * 目标 id 已不存在而抛错；账目随 region 删除自然消失，写回直接跳过。
   * @param {RegionDocument} region - 光环 region
   * @returns {boolean}
   */
  static #regionLive(region) {
    return Boolean(region?.parent?.regions?.has?.(region.id));
  }

  /**
   * 读取一个清理账目（按行为键）。
   * @param {RegionDocument} region - 光环 region
   * @param {string} tokenId - 目标 Token id
   * @param {string} behaviorId - 行为 id（账本键）
   * @returns {object|undefined} 账目 {eid, actorUuid, tokenUuid, behaviorId,
   *   slug, ref, stackable, contributedStacks, existedBeforeAura}
   */
  static getEntry(region, tokenId, behaviorId) {
    const ledger = region.getFlag(FLAG_SCOPE, FLAG_LEDGER) ?? {};
    return ledger[tokenId]?.[behaviorId];
  }

  /**
   * 写入一个清理账目（覆盖式）；region 已从场景移除时跳过。
   * @param {RegionDocument} region - 光环 region
   * @param {string} tokenId - 目标 Token id
   * @param {string} behaviorId - 行为 id（账本键）
   * @param {object} entry - 清理账目
   */
  static putEntry(region, tokenId, behaviorId, entry) {
    if (!this.#regionLive(region)) return Promise.resolve();
    return region.update({[`flags.${FLAG_SCOPE}.${FLAG_LEDGER}.${tokenId}.${behaviorId}`]: entry});
  }

  /**
   * 清除一个清理账目（exit 释放后调用）；region 已从场景移除时跳过。
   * 使用 ForcedDeletion 删除嵌套 flag，避免删除键兼容性警告。
   * @param {RegionDocument} region - 光环 region
   * @param {string} tokenId - 目标 Token id
   * @param {string} behaviorId - 行为 id（账本键）
   */
  static clearEntry(region, tokenId, behaviorId) {
    if (!this.#regionLive(region)) return Promise.resolve();
    const Deletion = foundry.data.operators.ForcedDeletion;
    return region.update({[`flags.${FLAG_SCOPE}.${FLAG_LEDGER}.${tokenId}.${behaviorId}`]: new Deletion()});
  }

  /**
   * 读取某 Token 的全部清理账目。
   * @param {RegionDocument} region - 光环 region
   * @param {string} tokenId - 目标 Token id
   * @returns {Object<string, object>} behaviorId → 账目
   */
  static getEntriesOfToken(region, tokenId) {
    const ledger = region.getFlag(FLAG_SCOPE, FLAG_LEDGER) ?? {};
    return ledger[tokenId] ?? {};
  }

  /**
   * 读取某行为对目标 Token 的清理账目：普通 tokenExit 只结算本行为的
   * 账目；同 region 其他行为的账目由各自的退出事件负责。
   * @param {RegionDocument} region - 光环 region
   * @param {string} tokenId - 目标 Token id
   * @param {string} behaviorId - 行为 id
   * @returns {Array<{key: string, tokenId: string, entry: object}>} 0 或 1 条
   */
  static ownEntriesOfToken(region, tokenId, behaviorId) {
    const entry = this.getEntriesOfToken(region, tokenId)[behaviorId];
    return entry ? [{key: behaviorId, tokenId, entry}] : [];
  }

  /**
   * 读取 region 账本中的全部清理账目（region 删除预清理用）：
   * 账目自带 actorUuid/tokenUuid，不依赖 region.tokens 枚举（Token 可能
   * 已删除而账目仍在）。
   * @param {RegionDocument} region - 光环 region
   * @returns {Array<{key: string, tokenId: string, entry: object}>}
   */
  static allEntriesOfRegion(region) {
    const out = [];
    const ledger = region.getFlag(FLAG_SCOPE, FLAG_LEDGER) ?? {};
    for (const [tokenId, entries] of Object.entries(ledger)) {
      for (const [behaviorId, entry] of Object.entries(entries ?? {})) {
        if (!entry) continue;
        out.push({key: behaviorId, tokenId, entry});
      }
    }
    return out;
  }

  /**
   * 读取上次进入结算的节流键。
   * @param {RegionDocument} region - 光环 region
   * @param {string} scopeKey - 节流作用域键 `${behaviorId}|${tokenId}`；
   *   行为维度使同 region 多行为的节流互不影响
   * @returns {string|undefined} 如 "combatId:round"
   */
  static getThrottle(region, scopeKey) {
    return region.getFlag(FLAG_SCOPE, `${FLAG_THROTTLE}.${scopeKey}`);
  }

  /**
   * 写入节流记录；region 已从场景移除时跳过。
   * @param {RegionDocument} region - 光环 region
   * @param {string} scopeKey - 节流作用域键 `${behaviorId}|${tokenId}`
   * @param {string} key - 节流键 `${combatId}:${round}`
   */
  static setThrottle(region, scopeKey, key) {
    if (!this.#regionLive(region)) return Promise.resolve();
    return region.update({[`flags.${FLAG_SCOPE}.${FLAG_THROTTLE}.${scopeKey}`]: key});
  }

  /* -------------------------------------------- */
  /*  队列执行体（仅活动 GM 端）                    */
  /* -------------------------------------------- */

  /**
   * 队列执行体：解析文档 → 分发到具体结算。
   * Actor 解析以 token.actor 优先；exit 在 Token 已删除时按账目的
   * actorUuid 兜底解析（账目自带，清理不依赖 Token 存活）。
   * @param {object} op - 队列操作
   */
  static async #execute(op) {
    const region = await fromUuid(op.regionUuid).catch(() => null);
    const behavior = region?.behaviors.get(op.behaviorId);
    const token = await fromUuid(op.tokenUuid).catch(() => null);
    const actor = token?.actor ?? await fromUuid(op.actorUuid).catch(() => null);

    switch (op.op) {
      case "enter":
        if (token && actor) await this.#executeEnter(op, region, behavior, token, actor);
        break;
      case "exit":
        if (actor) await this.#executeExit(op, region, behavior, token, actor);
        break;
      case "moveWithin":
        if (token && actor) await this.#executeMoveWithin(op, region, behavior, token, actor);
        break;
      case "round":
        if (token && actor) await this.#executeRound(op, region, behavior, token, actor);
        break;
    }
  }

  /**
   * enter 结算：过滤 → 节流 → 挂 AE（cleanup 记账）→ 直接动作。
   * 每次被接受的真实 enter 都施加一次；节流是唯一的业务门，命中时不
   * 施加、不执行动作、也不建账目。不以账本存在性或当前是否仍在区域内
   * 否定已发生的事件。Actor 队列保证 enter→exit 顺序，退出事件负责
   * 后续清理。
   * @param {object} op - 队列操作
   * @param {RegionDocument|null} region - 已解析 region（可能已被删除）
   * @param {RegionBehavior|null} behavior - 行为文档
   * @param {TokenDocument} token - 目标 Token（可能是非链接 Token 的合成分支）
   * @param {Actor} actor - 目标 Actor
   */
  static async #executeEnter(op, region, behavior, token, actor) {
    // region 已删或行为停用：光环已不存在，进入事件失效。
    if (!region || !behavior || behavior.disabled) return;
    const system = behavior.system;
    if (!system.enterEnabled) return;
    const meta = region.getFlag(FLAG_SCOPE, FLAG_AURA) ?? {};

    // 阵营过滤先于节流：被过滤的目标不参与本光环结算，不占节流计数。
    const sourceToken = await resolveSourceToken(meta);
    if (!passesFilter(system, token, sourceToken)) return;

    // 节流以 {战斗 ID, 轮次} 为键、作用域含行为与 Token：战斗外
    // currentThrottleKey 为 null、不节流；命中则本回合不再结算。
    const throttleKey = currentThrottleKey();
    if (system.throttlePerRound && throttleKey
      && this.getThrottle(region, `${op.behaviorId}|${token.id}`) === throttleKey) return;

    // 每次真实进入施加一次；记账先于直接动作：动作抛错时账目已记录。
    const entry = await this.#applyPayload(system, meta, region, token, actor, op.behaviorId);
    await applyAction(system.enterAction, actor, sourceToken?.actor ?? null);
    if (system.throttlePerRound && throttleKey) {
      await this.setThrottle(region, `${op.behaviorId}|${token.id}`, throttleKey);
    }

    // 施加过程中 region 被删除：退出事件不会再来，cleanup 账目就地补偿
    // 释放；不清理语义按"不清理"保留。region 存活时一切交给退出事件。
    if (entry && !this.#regionLive(region)) {
      await this.#releaseContribution(actor, entry);
      if (entry.eid) rememberDedup(processedEids, entry.eid);
    }
  }

  /**
   * exit 结算：按本行为账目释放贡献并清账目。
   * 普通退出只结算当前 behaviorId 的账目；region 删除由管理器按账目
   * 逐条提交（每条独立 owner 释放），无需范围标记。
   * 幂等（防重复 exit 双摘）：region 与 token 均在时以实时账目为准，
   * 账目已清即本次释放已被处理（预清理与核心补发可能对同一事件各提交
   * 一次），直接结束、不回退快照；region 或 token 已不在时凭快照释放，
   * 快照条目按 eid 去重。
   * @param {object} op - 队列操作（可携带 snapshots）
   * @param {RegionDocument|null} region - 已解析 region（删除补发场景可能为 null）
   * @param {RegionBehavior|null} behavior - 行为文档（释放不依赖它，账目自足）
   * @param {TokenDocument|null} token - 目标 Token（可能已删除）
   * @param {Actor} actor - 目标 Actor（token.actor 优先，账目 actorUuid 兜底）
   */
  static async #executeExit(op, region, behavior, token, actor) {
    let entries;
    if (region && token) {
      entries = this.ownEntriesOfToken(region, token.id, op.behaviorId);
      // 实时账目已清：重复 exit（预清理＋核心补发各一次），不再重放快照
      if (!entries.length) return;
    } else {
      // region 或 token 已不在：凭入队快照释放
      entries = (Array.isArray(op.snapshots) ? op.snapshots : [])
        .filter(s => s?.entry)
        .map(s => ({key: s.key ?? s.entry.behaviorId, tokenId: s.tokenId, entry: s.entry}));
    }
    if (!entries.length) return;

    for (const {key, tokenId, entry} of entries) {
      // 账目 eid 只在实际释放成功后标记：释放抛错时不标记，
      // 同一快照的重试不会被误判为重复；已成功处理的条目（eid 已标记）重入
      // 时只补清仍残留的实时账目，不再重复摘效果——最后清账若失败，重试
      // 走到此处即完成收尾。
      const done = entry.eid && processedEids.has(entry.eid);
      if (!done) await this.#releaseContribution(actor, entry);
      if (entry.eid) rememberDedup(processedEids, entry.eid);
      if (region && tokenId) await this.clearEntry(region, tokenId, key);
    }
  }

  /**
   * 区域内部移动结算：同一 movement.id 只结算一次，且只对
   * 起点/终点都在区域内的"纯区域内移动"结算——踏入移动已由 tokenEnter
   * 结算，避免踏入移动同时触发 enter 与 moveWithin 而重复施加。
   * moveWithin 只复用 enterAction，不重复挂载 payload。
   * @param {object} op - 队列操作（携带 movement {id, origin, destination}）
   * @param {RegionDocument|null} region - 已解析 region
   * @param {RegionBehavior|null} behavior - 行为文档
   * @param {TokenDocument} token - 目标 Token
   * @param {Actor} actor - 目标 Actor
   */
  static async #executeMoveWithin(op, region, behavior, token, actor) {
    if (!region || !behavior || behavior.disabled) return;
    const movement = op.movement;
    if (!movement?.id) return;
    // 去重键必须带 region＋token＋行为：一次移动穿过多个 moveWithin
    // 光环时核心对每个 region 各派发一次同 id 事件，全局按 id 去重会让
    // 只有第一个区域结算；按区域+目标分键后各光环独立幂等。行为维度
    // 同理，同 region 的多个行为各自独立结算。
    const dedupKey = `${op.behaviorId}|${op.regionUuid}|${op.tokenUuid}|${movement.id}`;
    if (processedMovements.has(dedupKey)) return;
    rememberDedup(processedMovements, dedupKey);

    const system = behavior.system;
    if (!system.moveWithin || actionKindOf(system.enterAction) === "none") return;
    if (!isMovementFullyInside(region, movement)) return;

    const meta = region.getFlag(FLAG_SCOPE, FLAG_AURA) ?? {};
    const sourceToken = await resolveSourceToken(meta);
    if (!passesFilter(system, token, sourceToken)) return;
    await applyAction(system.enterAction, actor, sourceToken?.actor ?? null);
  }

  /**
   * 回合结算：round>=1 门控（战斗开始 round 0→1 边界会先派发一轮
   * tokenRoundEnd）→ timing 匹配 → 去重 → 挂 AE / 直接动作。
   * 回合事件由活动 GM 派发、每单位每回合各一次，去重集合提供
   * 幂等保障（防核心重放与我方回合队列交错双发）。
   * 挂载特效：每个有效回合事件都调用一次 addEffect——可叠层逐次累加
   * 贡献，非叠层重复施加走门面的覆盖/刷新语义；账目冻结边界见
   * #applyPayload。
   * @param {object} op - 队列操作（携带 timing/combatId/round）
   * @param {RegionDocument|null} region - 已解析 region
   * @param {RegionBehavior|null} behavior - 行为文档
   * @param {TokenDocument} token - 目标 Token
   * @param {Actor} actor - 目标 Actor
   */
  static async #executeRound(op, region, behavior, token, actor) {
    if (!region || !behavior || behavior.disabled) return;
    if (!Number.isFinite(op.round) || op.round < 1) return;
    const system = behavior.system;
    if (system.roundTiming !== op.timing) return;
    const kind = system.roundAction?.kind;
    // 未配置动作且未配置挂载特效 → 无回合结算
    if (actionKindOf(system.roundAction) === "none" && kind !== "effect") return;

    const dedupKey = `${op.behaviorId}|${op.regionUuid}|${op.tokenUuid}|${op.timing}|${op.combatId}|${op.round}`;
    if (processedRounds.has(dedupKey)) return;
    rememberDedup(processedRounds, dedupKey);

    const meta = region.getFlag(FLAG_SCOPE, FLAG_AURA) ?? {};
    const sourceToken = await resolveSourceToken(meta);
    if (!passesFilter(system, token, sourceToken)) return;

    if (kind === "effect") {
      const entry = await this.#applyPayload(system, meta, region, token, actor, op.behaviorId);
      // 施加过程中 region 被删除：退出事件不会再来，cleanup 账目就地
      // 补偿释放；不清理语义按"不清理"保留。
      if (entry && !this.#regionLive(region)) {
        await this.#releaseContribution(actor, entry);
        if (entry.eid) rememberDedup(processedEids, entry.eid);
      }
      return;
    }
    await applyAction(system.roundAction, actor, sourceToken?.actor ?? null);
  }

  /* -------------------------------------------- */
  /*  施加与释放的核心实现                          */
  /* -------------------------------------------- */

  /**
   * 施加 payload 并维护清理账目（enter 与回合挂载共用）。
   *
   * 施加语义：每次调用都执行一次门面 addEffect，叠层累加/覆盖刷新/时长
   * 刷新全部由门面裁决；施加后重查实际 AE，未产生同 slug AE（免疫、转化
   * 等）时不建虚假账目。
   *
   * 记账语义（cleanupOnExit=true）：
   * - 可叠层：本次贡献 = max(0, 施加后层数 − 施加前层数)，累计进既有账目；
   *   无既有账目且本次差值为 0（如已满层）时不建账目。
   * - 不可叠层：同一 owner（regionUuid+behaviorId+tokenUuid）保持同一条目，
   *   每次仍施加；首建时继承同 actorUuid+slug owner 组的接管基线
   *   existedBeforeAura（无同组 owner 时取"施加前是否已存在同 slug AE"）。
   *
   * payload 配置在 owner 存续期间变化时：cleanup 账目已存在且配置
   * 引用与账目 ref 不一致 → 继续施加账目 ref 指向的旧 payload 直到退出
   * （即时切换走 refreshAura）；定义漂移（同名效果换显式 slug）会混入账本
   * 不追踪的新 slug → 冻结本次施加，旧效果保留至退出。cleanupOnExit=false
   * 无账目，始终使用当前配置，旧效果按"不清理"语义保留。
   * @param {object} system - 行为 system 数据
   * @param {object} meta - region flags 的 aura 元数据
   * @param {RegionDocument} region - 光环 region
   * @param {TokenDocument} token - 目标 Token
   * @param {Actor} actor - 目标 Actor
   * @param {string} behaviorId - 行为 id（账本键）
   * @returns {Promise<object|null>} 生效中的清理账目（新建、既有或无）
   */
  static async #applyPayload(system, meta, region, token, actor, behaviorId) {
    // 始终读取既有账目：清理账目存续期间，清理开关与 payload 引用冻结到
    // 退出；中途关闭开关不会让后续施加脱离账目，退出重进后才采用新值。
    // 无账目时按当前开关行事。
    const existing = this.getEntry(region, token.id, behaviorId);
    const cleanup = Boolean(existing || system.cleanupOnExit);
    const refChanged = Boolean(existing?.ref)
      && (existing.ref.item !== (system.payloadItemUuid ?? "")
        || existing.ref.name !== (system.payloadEffectName ?? ""));
    const ref = refChanged
      ? {...existing.ref}
      : (system.payloadItemUuid && system.payloadEffectName
        ? {item: system.payloadItemUuid, name: system.payloadEffectName}
        : null);
    if (!ref) return null;
    const effect = await resolvePayloadRef(ref);
    if (!effect) return null;
    // 定义漂移（同名换显式 slug）：施加会混入账本不追踪的新 slug，冻结
    // 本次施加；既有账目的旧效果保留至退出。
    if (existing && existing.slug && existing.slug !== effect.slug) return existing;

    // 叠层差值必须以施加前瞬时读数为基线（无既有 AE 时基线为 0——
    // stackCount 的"无标记视为 1 层"语义只适用于已存在的 AE）：叠加走
    // update 不换文档 id，若保留对象惰性读数，before 会读到施加后的层数。
    const before = findEffectBySlug(actor, effect.slug);
    const beforeStacks = before ? stackCount(before) : 0;
    await game.xjzl.api.effects.addEffect(actor, effect.data, 1);
    // 施加后重查实际 AE：免疫/转化/失败时不建虚假 owner 或虚假贡献。
    const after = findEffectBySlug(actor, effect.slug);
    if (!after) return null;
    if (!cleanup) return null;

    const stackable = isStackable(after);
    // 账目是唯一清理凭据；putEntry 失败（region.update 拒绝等）时必须
    // 回滚本次施加，避免留下无法清理的贡献。
    const putOrRollback = async (entryToWrite, diff) => {
      try {
        await this.putEntry(region, token.id, behaviorId, entryToWrite);
      } catch (err) {
        console.error("XJZL | 光环清理账目写入失败，回滚本次施加:", err);
        await this.#rollbackApply(actor, entryToWrite, diff, err);
        // 回滚只恢复状态；本次结算仍然失败，阻止后续动作和节流继续执行。
        throw err;
      }
    };

    if (stackable) {
      const diff = Math.max(0, stackCount(after) - beforeStacks);
      if (existing) {
        const contributedStacks = (existing.contributedStacks ?? 0) + diff;
        if (diff > 0) {
          const updated = {...existing, contributedStacks};
          // 回滚只撤本次新增的 diff 层：旧账目写入未成功、保持原值，
          // 不得按总贡献回滚
          await putOrRollback(updated, diff);
          return updated;
        }
        return {...existing, contributedStacks};
      }
      // 无既有账目且本次差值为 0（满层进入等）：退出无可释放贡献，不建账目
      if (diff <= 0) return null;
      const entry = this.#buildEntry(system, actor, token, behaviorId, effect,
        {stackable: true, contributedStacks: diff, existedBeforeAura: false});
      await putOrRollback(entry, diff);
      return entry;
    }

    // 不可叠层 owner：同一 owner 多次施加保持同一条目（每次仍已施加）。
    if (existing) return existing;
    const siblings = this.#findSiblingOwners(actor, effect.slug, null);
    const existedBeforeAura = siblings.length
      ? Boolean(siblings[0].existedBeforeAura)
      : Boolean(before);
    const entry = this.#buildEntry(system, actor, token, behaviorId, effect,
      {stackable: false, contributedStacks: 0, existedBeforeAura});
    await putOrRollback(entry, 0);
    return entry;
  }

  /**
   * 记账写入失败时回滚刚刚这一次施加（不恢复全局状态，只撤销本次）：
   * - 可叠层：只撤销本次新增的 diff 层——旧账目未写入成功、保持原值，
   *   不得按账目总贡献回滚；
   * - 不可叠层：用准备写入的新账目走 #releaseContribution，正确处理
   *   existedBeforeAura 与同组其他 owner；
   * 回滚也失败时抛 AggregateError（原写入错误 + 回滚错误）：状态不一致
   * 但日志完整可查，交由上层记录。
   * @param {Actor} actor - 目标 Actor
   * @param {object} entry - 准备写入的清理账目
   * @param {number} diff - 本次施加新增的层数（可叠层用）
   * @param {Error} writeErr - 账目写入失败的原始错误
   */
  static async #rollbackApply(actor, entry, diff, writeErr) {
    try {
      if (entry.stackable) {
        if (diff > 0) await removeEffectBySlug(actor, entry.slug, diff);
      } else {
        await this.#releaseContribution(actor, entry);
      }
    } catch (rollbackErr) {
      throw new AggregateError([writeErr, rollbackErr],
        "XJZL | 光环施加成功但清理账目写入失败，且回滚也失败（存在未记账贡献）");
    }
  }

  /**
   * 组装一条新清理账目。
   * @param {object} system - 行为 system 数据（取当前 payload 引用快照）
   * @param {Actor} actor - 目标 Actor
   * @param {TokenDocument} token - 目标 Token
   * @param {string} behaviorId - 行为 id
   * @param {{slug: string}} effect - 已施加 payload 的实际 slug
   * @param {object} extra - {stackable, contributedStacks, existedBeforeAura}
   * @returns {object} 清理账目
   */
  static #buildEntry(system, actor, token, behaviorId, effect, extra) {
    return {
      eid: foundry.utils.randomID(),
      actorUuid: actor.uuid,
      tokenUuid: token.uuid,
      behaviorId,
      slug: effect.slug,
      ref: {item: system.payloadItemUuid ?? "", name: system.payloadEffectName ?? ""},
      stackable: false,
      contributedStacks: 0,
      existedBeforeAura: false,
      ...extra
    };
  }

  /**
   * 释放一条清理账目（exit 与补偿共用）。eid 标记由调用方在**成功返回后**
   * 写入：释放抛错时同快照重试不会被幂等集合误判为已处理。
   * - 可叠层：仅当 contributedStacks > 0 时按累计贡献减层，预存层数保留。
   * - 不可叠层 owner：同 actorUuid+slug 仍有其他 owner → 保留；无其他
   *   owner 但 existedBeforeAura=true（接管前 AE 已存在）→ 保留；否则
   *   整条移除。清理只依据账目归属，不做几何覆盖判定。
   * @param {Actor} actor - 目标 Actor
   * @param {object} entry - 清理账目
   */
  static async #releaseContribution(actor, entry) {
    if (!actor || !entry?.slug) return;
    if (entry.stackable) {
      const stacks = entry.contributedStacks ?? 0;
      if (stacks > 0) await removeEffectBySlug(actor, entry.slug, stacks);
      return;
    }
    const siblings = this.#findSiblingOwners(actor, entry.slug, entry.eid);
    if (siblings.length || entry.existedBeforeAura) return;
    await removeEffectBySlug(actor, entry.slug, Number.MAX_SAFE_INTEGER);
  }

  /**
   * 查找同 actorUuid、同 slug 的其他有效清理账目（owner 组）。
   * 账目散布在各 region flags 中，按 Actor 的全部关联 Token 反查其所在
   * region 的账本（核心 Actor#getDependentTokens 跨场景取依赖 Token；
   * 合成 Actor 只返回自身）。同一关联 Actor 的多个 Token 是多个 owner，
   * 共享 Actor 上的同一 AE；这是账本归属查找，不做几何覆盖判定。
   * @param {Actor} actor - 目标 Actor
   * @param {string} slug - 实际 slug
   * @param {string|null} excludeEid - 排除的账目 eid（释放自身时排除自己）
   * @returns {Array<object>} 同组其他 owner 账目
   */
  static #findSiblingOwners(actor, slug, excludeEid) {
    const actorUuid = actor?.uuid;
    if (!actorUuid) return [];
    let tokens = [];
    try {
      tokens = actor.getDependentTokens?.() ?? [];
    } catch (err) {
      console.warn("XJZL | 解析 Actor 的依赖 Token 失败，owner 组按空处理:", err);
    }
    const out = [];
    const seenRegions = new Set();
    for (const token of tokens) {
      for (const region of token.regions ?? []) {
        if (seenRegions.has(region.uuid)) continue;
        seenRegions.add(region.uuid);
        const ledger = region.getFlag(FLAG_SCOPE, FLAG_LEDGER) ?? {};
        for (const entries of Object.values(ledger)) {
          for (const entry of Object.values(entries ?? {})) {
            if (!entry || entry.eid === excludeEid) continue;
            if (entry.actorUuid !== actorUuid || entry.slug !== slug) continue;
            out.push(entry);
          }
        }
      }
    }
    return out;
  }
}

/* -------------------------------------------- */
/*  内部工具                                     */
/* -------------------------------------------- */

/**
 * 解析光环源 Token：跟随型直接取持久化的源 Token；放置型回退到源 Actor
 * 在当前画布的活动 Token（放置型友方光环以放置者为阵营基准）。
 * @param {object} meta - region flags 的 aura 元数据
 * @returns {Promise<TokenDocument|null>}
 */
async function resolveSourceToken(meta) {
  if (meta.sourceTokenUuid) return fromUuid(meta.sourceTokenUuid);
  if (meta.sourceActorUuid) {
    const actor = await fromUuid(meta.sourceActorUuid);
    return actor?.getActiveTokens?.(false)?.[0]?.document ?? null;
  }
  return null;
}

/**
 * 解析 payload 引用为可施加的 AE 数据（源物品 UUID＋效果名）。
 * 返回的 slug 是**实际** slug——优先显式 flag，与门面 getSlug 的匹配口径
 * 完全一致；账本查找、摘除都必须用它，否则显式 slug 的 payload 施加后
 * 无法按账本摘除。
 * @param {{item: string, name: string}} ref - payload 引用快照
 * @returns {Promise<{data: object, slug: string}|null>} 解析失败返回 null（已警告）
 */
async function resolvePayloadRef(ref) {
  if (!ref?.item || !ref?.name) return null;
  const item = await fromUuid(ref.item);
  const found = item?.effects?.find(e => e.name === ref.name);
  if (!found) {
    console.warn(`XJZL | 光环 payload 不可解析: ${ref.item} / "${ref.name}"（源物品被删或效果名不匹配）`);
    return null;
  }
  const data = found.toObject();
  // 实际 slug：显式 flag 优先，其次名字 slugify（与门面一致），无名的
  // 病态数据退回源 AE id（此时账本摘除同样按它定位）
  const slug = foundry.utils.getProperty(data, "flags.xjzl-system.slug")
    || (data.name ? String(data.name).slugify() : "")
    || found.id
    || "";
  delete data._id;
  if (!data.origin) data.origin = found.uuid;
  return {data, slug};
}

/**
 * 读取 AE（或 AE 源数据）的可叠层标记。
 * @param {ActiveEffect|object|null} effectLike - AE 文档或源数据
 * @returns {boolean}
 */
function isStackable(effectLike) {
  return Boolean(foundry.utils.getProperty(effectLike ?? {}, "flags.xjzl-system.stackable"));
}

/**
 * 读取 AE 当前层数（门面约定：无 stacks 标记视为 1 层）。
 * @param {ActiveEffect|null} effect - AE 文档
 * @returns {number}
 */
function stackCount(effect) {
  return effect?.getFlag("xjzl-system", "stacks") || 1;
}

/**
 * 按 slug 查找目标身上的 AE（与门面匹配口径一致：slug 优先，name 兜底）。
 * @param {Actor} actor - 目标 Actor
 * @param {string} slug - 已施加 AE 的实际 slug
 * @returns {ActiveEffect|undefined}
 */
function findEffectBySlug(actor, slug) {
  return actor.effects.find(e => {
    const eSlug = e.getFlag("xjzl-system", "slug");
    return eSlug === slug || (!eSlug && e.name?.slugify() === slug);
  });
}

/**
 * 按实际 slug 摘除 AE：走门面 removeEffect 保留叠层/飘字语义。
 * @param {Actor} actor - 目标 Actor
 * @param {string} slug - 已施加 AE 的实际 slug
 * @param {number} amount - 摘除层数；极大值表示整条移除
 */
async function removeEffectBySlug(actor, slug, amount) {
  if (!findEffectBySlug(actor, slug)) return;
  await game.xjzl.api.effects.removeEffect(actor, slug, amount);
}

/**
 * 阵营过滤（执行时权威判定）。
 * 口径：与源 Token 同 disposition 为友方；敌方 = 与源对置且非中立——
 * 中立单位不视作任何一方的敌人，与战局 HUD 的三色口径一致。
 * includeSelf=false 按 **Actor UUID** 判定：源 Actor 的其他关联 Token
 * 同样视为自身，与 queryTokens 的过滤口径一致；非链接 Token 的合成
 * Actor uuid 各自独立，行为等同按 Token 判定。
 * @param {object} system - 行为 system 数据
 * @param {TokenDocument} token - 目标 Token
 * @param {TokenDocument|null} sourceToken - 源 Token
 * @returns {boolean} 是否通过过滤
 */
export function passesFilter(system, token, sourceToken) {
  if (system.includeSelf === false && sourceToken
    && token.actor?.uuid && token.actor.uuid === sourceToken.actor?.uuid) return false;
  const faction = system.faction ?? "all";
  if (faction === "all") return true;
  if (!sourceToken) return false;
  const sourceDisp = sourceToken.disposition;
  if (faction === "ally") return token.disposition === sourceDisp;
  const hostileDisp = sourceDisp === CONST.TOKEN_DISPOSITIONS.HOSTILE
    ? CONST.TOKEN_DISPOSITIONS.FRIENDLY
    : CONST.TOKEN_DISPOSITIONS.HOSTILE;
  return token.disposition === hostileDisp;
}

/**
 * 执行一个直接结算动作（伤害/治疗，走资源事务）。
 * 光环伤害以 source:"dot" 标记（不触发濒死借机等攻击性副作用）、必中不暴击；
 * 治疗允许负数表达资源流失。
 * @param {object} action - {kind, amount, type, pierce}
 * @param {Actor} actor - 目标 Actor
 * @param {Actor|null} sourceActor - 源 Actor（统计溯源与公式 rollData）
 */
async function applyAction(action, actor, sourceActor) {
  const kind = actionKindOf(action);
  if (kind === "none") return;
  const amount = await resolveAmount(action.amount, sourceActor);
  if (!amount) return;
  if (kind === "damage") {
    await actor.applyDamage({
      amount,
      type: action.type || "liushi",
      attacker: sourceActor,
      isHit: true,
      isCrit: false,
      source: "dot",
      ignoreBlock: Boolean(action.pierce),
      ignoreDefense: Boolean(action.pierce),
      ignoreMinDamage: Boolean(action.pierce)
    });
  } else {
    await actor.applyHealing({
      amount,
      type: action.type || "hp",
      healer: sourceActor,
      showScrolling: true
    });
  }
}

function actionKindOf(action) {
  const kind = action?.kind;
  return (kind === "damage" || kind === "healing") ? kind : "none";
}

async function resolveAmount(raw, sourceActor) {
  if (raw === undefined || raw === null || raw === "") return 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;
  try {
    const rollData = sourceActor?.getRollData?.() ?? {};
    const roll = new Roll(String(raw), rollData);
    const result = await roll.evaluate({async: true});
    return Math.round(result.total ?? 0);
  } catch (err) {
    console.warn(`XJZL | 光环动作数值解析失败: "${raw}"`, err);
    return 0;
  }
}

function currentThrottleKey() {
  const combat = game.combat;
  if (!combat?.round) return null;
  return `${combat.id}:${combat.round}`;
}

function isMovementFullyInside(region, movement) {
  const shape = region.shapes?.find(s => (s.type === "grid") || Array.isArray(s.offsets));
  if (!shape?.offsets?.length) return false;
  const grid = region.parent?.grid;
  if (!grid || grid.isGridless) return false;
  const keys = new Set(shape.offsets.map(o => `${o.i}.${o.j}`));
  for (const point of [movement.origin, movement.destination]) {
    if (!point) return false;
    const {i, j} = grid.getOffset(point);
    if (!keys.has(`${i}.${j}`)) return false;
  }
  return true;
}

/**
 * 记录去重键；超容量时按插入顺序淘汰最旧的一条（Set 迭代即插入序），
 * 近期记录始终保留，避免大批量结算后刚处理的重复事件重新执行。
 * @param {Set<string>} set - 去重集合
 * @param {string} key - 去重键
 */
function rememberDedup(set, key) {
  while (set.size >= DEDUP_LIMIT) set.delete(set.values().next().value);
  set.add(key);
}
