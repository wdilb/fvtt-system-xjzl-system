/**
 * xjzlAura 光环的施加账本与结算执行器。
 *
 * 职责划分：Region 行为（xjzl-aura-behavior.mjs）只做事件接收与门控，
 * 全部结算落在活动 GM 端，按目标 Actor＋payload 串行执行；
 * 入队后再次核对覆盖状态。
 *
 * 账本存于 region flags `xjzl-system.ledger`，按 tokenId → payloadKey
 * 记录 `{active, stacks, created, stackable, slug, exitClear, eid}`；
 * `active` 是唯一幂等与对账依据——enter 以"已有条目"为已生效，贡献层数为 0
 * 或 created=false 的 enter 同样记 active 条目；exit 按条目摘除后清除账目。
 * 对账以覆盖状态与施加账本为依据。
 */

/** 账本与节流的 flags 根路径。 */
const FLAG_SCOPE = "xjzl-system";
const FLAG_AURA = "aura";
const FLAG_LEDGER = "ledger";
const FLAG_THROTTLE = "throttle";

/** GM 端串行队列：优先按 `${actorUuid}|${payloadKey}` 分键。 */
const opQueues = new Map();
/** GM 端 movement.id 去重集合，避免重复结算同次移动。 */
const processedMovements = new Set();
/** GM 端回合结算去重集合，避免同一单位同一回合重复结算。 */
const processedRounds = new Set();
/** GM 端已处理条目 eid：删除快照和补偿清理据此避免重复摘除。 */
const processedEids = new Set();
/** 去重集合容量上限，防止长会话无限增长。 */
const DEDUP_LIMIT = 256;

/* -------------------------------------------- */
/*  发起端入口（Region 事件 handler 调用）        */
/* -------------------------------------------- */

export class AuraLedger {

  /**
   * 提交一次 enter 结算（移动发起者端调用，活动 GM 时直接入队）。
   * @param {object} payload - {behaviorId, regionUuid, tokenUuid, payloadKey}
   * @param {object} socketlibRef - xjzlSocket 实例（由调用方传入避免循环依赖）
   */
  static submitEnter(payload, socketlibRef) {
    return this.#submit({op: "enter", ...payload}, socketlibRef);
  }

  /**
   * 提交一次 exit 结算。入队时携带发起端可见的账本快照：
   * region 删除补发 exit 时行为与 flags 可能随 region 消失，快照是摘除
   * 凭据；快照为该目标全部有效条目（含 exitClear/slug），配置页更换
   * payload 引用变化或 region 删除都不影响摘除。
   * @param {object} payload - {behaviorId, regionUuid, tokenUuid, actorUuid, payloadKey}
   * @param {Array<{key: string, entry: object}>} snapshots - 有效账本条目快照数组
   * @param {object} socketlibRef - xjzlSocket 实例
   */
  static submitExit(payload, snapshots, socketlibRef) {
    return this.#submit({op: "exit", snapshots: snapshots ?? [], ...payload}, socketlibRef);
  }

  /**
   * 提交一次区域内部移动结算。
   * movement 只保留去重与纯区域内判定所需字段，避免整份 movement 过 socket。
   * @param {object} payload - {behaviorId, regionUuid, tokenUuid, payloadKey}
   * @param {object} movement - {id, origin, destination}（origin/destination 为 {x,y} 点）
   * @param {object} socketlibRef - xjzlSocket 实例
   */
  static submitMoveWithin(payload, movement, socketlibRef) {
    return this.#submit({op: "moveWithin", movement, ...payload}, socketlibRef);
  }

  /**
   * 提交一次回合结算。回合事件由活动 GM 端 Combat 工作流派发，通常本端即
   * 活动 GM；非本端时仍委托，以保证结算统一落在活动 GM 端。
   * @param {object} payload - {behaviorId, regionUuid, tokenUuid, payloadKey, timing, combatId, round}
   * @param {object} socketlibRef - xjzlSocket 实例
   */
  static submitRound(payload, socketlibRef) {
    return this.#submit({op: "round", ...payload}, socketlibRef);
  }

  /**
   * 统一提交口：活动 GM 端直接入队；否则经 socketlib 委托活动 GM。
   * 发起端只做事件转发，不等待结算结果（fire-and-forget，核心事件本就如此）。
   * @param {object} op - 完整操作对象
   * @param {object} socketlibRef - xjzlSocket 实例
   */
  static #submit(op, socketlibRef) {
    if (game.users.activeGM?.isSelf) {
      this.enqueue(op).catch(err => console.error("XJZL | 光环结算队列执行失败:", op, err));
      return;
    }
    socketlibRef?.executeAsGM("auraLedger", op)?.catch?.(err => {
      console.error("XJZL | 光环结算委托活动 GM 失败:", op, err);
    });
  }

  /**
   * 将操作加入目标＋payload 串行队列并在活动 GM 端执行（socket 处理端入口）。
   * 串行键按**目标 Actor**＋payload：同一关联 Actor 的多个 Token
   * 必须落在同一队列，否则并发修改同一 Actor 的 AE 会记重贡献；合成 Actor
   * 的 uuid 即 Token uuid，天然按 Token 分队。payloadKey 由行为 handler 在
   * 入队时计算并随操作携带——串行键必须在入队时刻同步确定：region 删除
   * 补发的 exit 拿不到行为配置，若此时才异步解析，同一目标＋payload 的
   * enter/exit 会落入不同队列，串行性失效。
   * @param {object} op - {op, behaviorId, regionUuid, tokenUuid, actorUuid, payloadKey, ...}
   * @returns {Promise<void>} 该操作在队列中的完成 promise
   */
  static async enqueue(op) {
    const key = `${op.actorUuid || op.tokenUuid}|${op.payloadKey || `direct:${op.regionUuid}.${op.behaviorId}`}`;
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
   * 读取一个账本条目。
   * @param {RegionDocument} region - 光环 region
   * @param {string} tokenId - 目标 Token id
   * @param {string} payloadKey - payload 串行键
   * @returns {object|undefined} 条目 {active, stacks, created, stackable, slug, exitClear}
   */
  static getEntry(region, tokenId, payloadKey) {
    const ledger = region.getFlag(FLAG_SCOPE, FLAG_LEDGER) ?? {};
    return ledger[tokenId]?.[payloadKey];
  }

  /**
   * 写入一个账本条目（覆盖式）；region 已从场景移除时跳过。
   * @param {RegionDocument} region - 光环 region
   * @param {string} tokenId - 目标 Token id
   * @param {string} payloadKey - payload 串行键
   * @param {object} entry - {active, stacks, created, stackable, slug, exitClear}
   */
  static putEntry(region, tokenId, payloadKey, entry) {
    if (!this.#regionLive(region)) return Promise.resolve();
    return region.update({[`flags.${FLAG_SCOPE}.${FLAG_LEDGER}.${tokenId}.${payloadKey}`]: entry});
  }

  /**
   * 清除一个账本条目（exit 摘除后调用）；region 已从场景移除时跳过。
   * 使用 ForcedDeletion 删除嵌套 flag，避免删除键兼容性警告。
   * @param {RegionDocument} region - 光环 region
   * @param {string} tokenId - 目标 Token id
   * @param {string} payloadKey - payload 串行键
   */
  static clearEntry(region, tokenId, payloadKey) {
    if (!this.#regionLive(region)) return Promise.resolve();
    const Deletion = foundry.data.operators.ForcedDeletion;
    return region.update({[`flags.${FLAG_SCOPE}.${FLAG_LEDGER}.${tokenId}.${payloadKey}`]: new Deletion()});
  }

  /**
   * 读取某 Token 的全部有效账本条目（对账用）。
   * @param {RegionDocument} region - 光环 region
   * @param {string} tokenId - 目标 Token id
   * @returns {Object<string, object>} payloadKey → 条目
   */
  static getEntriesOfToken(region, tokenId) {
    const ledger = region.getFlag(FLAG_SCOPE, FLAG_LEDGER) ?? {};
    return ledger[tokenId] ?? {};
  }

  /**
   * 读取上次进入结算的节流键。
   * @param {RegionDocument} region - 光环 region
   * @param {string} tokenId - 目标 Token id
   * @returns {string|undefined} 如 "combatId:round"
   */
  static getThrottle(region, tokenId) {
    return region.getFlag(FLAG_SCOPE, `${FLAG_THROTTLE}.${tokenId}`);
  }

  /**
   * 写入节流记录；region 已从场景移除时跳过。
   * @param {RegionDocument} region - 光环 region
   * @param {string} tokenId - 目标 Token id
   * @param {string} key - 节流键 `${combatId}:${round}`
   */
  static setThrottle(region, tokenId, key) {
    if (!this.#regionLive(region)) return Promise.resolve();
    return region.update({[`flags.${FLAG_SCOPE}.${FLAG_THROTTLE}.${tokenId}`]: key});
  }

  /* -------------------------------------------- */
  /*  对账（GM 端）                                */
  /* -------------------------------------------- */

  /**
   * 对单个 Token 做覆盖状态与账本比对。
   * 以核心包含性跟踪 `token._source._regions` 为覆盖基准（服务端在每次含
   * 移动字段的更新时重算，权威口径）；hidden region 与 disabled 行为不派发
   * 事件、行为停摆，账本冻结，对账跳过以免误补。
   * 漏挂补挂、漏摘按账本快照补摘，均复用 enter/exit 队列逻辑（含节流与过滤）。
   * @param {TokenDocument} tokenDoc - 待对账的 Token
   * @returns {Promise<void>}
   */
  static async reconcileToken(tokenDoc) {
    if (!tokenDoc?.parent) return;
    const regionIds = new Set(tokenDoc._source?._regions ?? []);
    for (const region of tokenDoc.parent.regions) {
      const behavior = region.behaviors.find(b => b.type === "xjzlAura" && !b.disabled);
      if (!behavior || region.hidden) continue;
      const inside = regionIds.has(region.id);
      const entries = this.getEntriesOfToken(region, tokenDoc.id);
      const activeKeys = Object.keys(entries).filter(k => entries[k]?.active);
      if (inside && activeKeys.length === 0) {
        // 覆盖内但无任何有效账目 → 补挂（复用 enter；节流与过滤在队列内生效）
        this.submitEnter({
          behaviorId: behavior.id,
          regionUuid: region.uuid,
          tokenUuid: tokenDoc.uuid,
          actorUuid: tokenDoc.actor?.uuid ?? tokenDoc.uuid,
          payloadKey: payloadKeyOf(behavior.system, behavior.id)
        }, null);
      } else if (!inside && activeKeys.length > 0) {
        // 覆盖外仍有有效账目：按全部有效条目补摘，避免配置变化后遗漏旧键。
        const snapshots = activeKeys.map(key => ({key, entry: entries[key]}));
        this.submitExit({
          behaviorId: behavior.id,
          regionUuid: region.uuid,
          tokenUuid: tokenDoc.uuid,
          actorUuid: tokenDoc.actor?.uuid ?? tokenDoc.uuid,
          payloadKey: activeKeys[0]
        }, snapshots, null);
      }
    }
  }

  /* -------------------------------------------- */
  /*  队列执行体（仅活动 GM 端）                    */
  /* -------------------------------------------- */

  /**
   * 队列执行体：解析文档 → 分发到具体结算。
   * @param {object} op - 队列操作
   */
  static async #execute(op) {
    const region = await fromUuid(op.regionUuid);
    const behavior = region?.behaviors.get(op.behaviorId);
    const token = await fromUuid(op.tokenUuid);
    const actor = token?.actor;
    if (!actor) return;

    switch (op.op) {
      case "enter":
        await this.#executeEnter(op, region, behavior, token, actor);
        break;
      case "exit":
        await this.#executeExit(op, region, behavior, token, actor);
        break;
      case "moveWithin":
        await this.#executeMoveWithin(op, region, behavior, token, actor);
        break;
      case "round":
        await this.#executeRound(op, region, behavior, token, actor);
        break;
    }
  }

  /**
   * enter 结算：幂等 → 节流 → 过滤 → 挂 AE（记贡献）→ 直接动作 → 二次核对。
   * @param {object} op - 队列操作
   * @param {RegionDocument|null} region - 已解析 region（可能已被删除）
   * @param {RegionBehavior|null} behavior - 行为文档
   * @param {TokenDocument} token - 目标 Token（可能是非链接 Token 的合成分支）
   * @param {Actor} actor - 目标 Actor
   */
  static async #executeEnter(op, region, behavior, token, actor) {
    // 入队后核对：region 已删或目标已退出则不再施加——
    // 没有施加就没有账目，后续 exit 自然空操作，状态一致。
    if (!region || !behavior || behavior.disabled) return;
    // 对账补挂也会走到这里，须服从 enterEnabled，避免无进入结算的区域被反复施加。
    if (!region.tokens.has(token)) return;
    const system = behavior.system;
    if (!system.enterEnabled) return;
    const payloadKey = op.payloadKey || payloadKeyOf(system, behavior.id);
    const meta = region.getFlag(FLAG_SCOPE, FLAG_AURA) ?? {};

    // enter 以账本存在性幂等：已有条目即视为已生效，
    // 防区域边界重算/行为重激活引起的重复 enter 触发门面重复刷新或覆盖。
    if (this.getEntry(region, token.id, payloadKey)?.active) return;

    // 阵营过滤先于节流：被过滤的目标不参与本光环结算，不记节流与账目
    // （覆盖↔账本对账对其余目标才保持"范围内应有条目"的语义）。
    const sourceToken = await resolveSourceToken(meta);
    if (!passesFilter(system, token, sourceToken)) return;

    // 节流以 {战斗 ID, 轮次} 为键：区域外整轮的 token 收不到该区域的
    // roundStart，只有战斗 ID＋轮次组合能表达"本回合尚未结算过"。
    const throttleKey = currentThrottleKey();
    if (system.throttlePerRound && throttleKey && this.getThrottle(region, token.id) === throttleKey) {
      // 节流命中仍记录 active；否则对账会反复把目标判为漏挂。
      // exitClear 随条目保存，确保退出清理不依赖行为当前配置。
      await this.putEntry(region, token.id, payloadKey, {active: true, stacks: 0, created: false, stackable: false, slug: null, exitClear: Boolean(system.exitClear), eid: foundry.utils.randomID()});
      return;
    }

    // 挂载 payload 并记账（enter 与回合挂载共用；调用方已做账本
    // 存在性幂等检查）。记账先于直接动作：动作抛错时挂载已记录，
    // 对账不会重复施加。
    const entry = await this.#applyAndRecord(system, meta, region, token, actor, payloadKey);

    await applyAction(system.enterAction, actor, sourceToken?.actor ?? null);
    if (system.throttlePerRound && throttleKey) await this.setThrottle(region, token.id, throttleKey);

    // 写入完成后二次核对：异步结算期间 region 被删除或目标已
    // 退出（enter 在途时快速进出），按刚记的账本条目立即补偿清理。
    if (!region.tokens.has(token) || !(await fromUuid(op.regionUuid))) {
      await this.#compensateRemove(region, token, actor, payloadKey, entry);
    }
  }

  /**
   * 挂载 payload 并写账本条目（enter 与回合挂载共用；账本存在性幂等
   * 由调用方检查）。条目记录实际 slug 与施加时的 exitClear，摘除不依赖
   * 行为当前配置。无 payload 时记空条目（active 仍是对账唯一依据）。
   * @param {object} system - 行为 system 数据
   * @param {object} meta - region flags 的 aura 元数据
   * @param {RegionDocument} region - 光环 region
   * @param {TokenDocument} token - 目标 Token
   * @param {Actor} actor - 目标 Actor
   * @param {string} payloadKey - payload 账本键
   * @returns {Promise<object>} 写入的账本条目
   */
  static async #applyAndRecord(system, meta, region, token, actor, payloadKey) {
    let stacks = 0;
    let created = false;
    let stackable = false;
    let effectSlug = null;
    const effect = await resolvePayload(system, meta);
    if (effect) {
      // before/after 按实际 slug 查找：显式 slug 的 payload
      // 与配置级键不同，按配置级键查找永远落空，会误记"非本光环创建"
      // 导致退出不摘除。
      effectSlug = effect.slug;
      const before = findEffectBySlug(actor, effect.slug);
      // 叠加前层数必须在 addEffect 之前立即求值：叠加走 update 不换
      // 文档 id，before 与 after 是同一对象，惰性求值会把 before 读成
      // 更新后的层数，贡献恒记 0、退出摘不掉（层数漂移）。
      const beforeStacks = stackCount(before);
      // 可叠层判定：目标已有时以现存 AE 为准（maxStacks 可能被更高来源
      // 升级过）；首次挂载时取源 AE 定义。
      stackable = before ? isStackable(before) : isStackable(effect.data);
      await game.xjzl.api.effects.addEffect(actor, effect.data, 1);
      const after = findEffectBySlug(actor, effect.slug);
      if (before) {
        // 叠层贡献 = 叠加前后层数差（受 maxStacks 钳制时为 0）；
        // 非叠层走覆盖刷新，贡献恒 0，摘除责任记在 created 上。
        stacks = stackable ? Math.max(0, stackCount(after) - beforeStacks) : 0;
        created = false;
      } else {
        stacks = stackable ? stackCount(after) : 0;
        created = after != null;
      }
    }
    // 条目 eid 是快照摘除的幂等凭据：预提交与核心删除补发可能各携带一份
    // 相同条目快照，凭 eid 只摘一次（见 #executeExit）。
    const entry = {active: true, stacks, created, stackable, slug: effectSlug, exitClear: Boolean(system.exitClear), eid: foundry.utils.randomID()};
    await this.putEntry(region, token.id, payloadKey, entry);
    return entry;
  }

  /**
   * exit 结算：按账本条目摘除，再清账目。
   * exitClear/stackable/slug 都在 enter 记账时写入
   * 条目，摘除不再依赖行为当前配置——region 删除后行为解析不到、配置页
   * 更换 payload 引用（旧条目仍以旧键存在）都不会让摘除失效。
   * 摘除范围是本 region 账本中该 token 的**全部**有效条目：正常场景单配置
   * 单键；更换 payload 引用后旧键条目随同一次退出清理，不留残留特效。
   * 幂等（防重复 exit 双摘）：region 仍在时以实时账目为准，账目已清即
   * 本次摘除已被处理（预提交与核心补发可能对同一事件各提交一次），直接
   * 结束、**不回退事件快照**；仅 region 已删（实时账目不可得）时才凭快照
   * 摘除，且快照条目按 eid 去重（见 #applyAndRecord），同一份条目只摘一次。
   * @param {object} op - 队列操作（可携带 snapshots）
   * @param {RegionDocument|null} region - 已解析 region（删除补发场景可能为 null）
   * @param {RegionBehavior|null} behavior - 行为文档（摘除不依赖它，条目自足）
   * @param {TokenDocument} token - 目标 Token
   * @param {Actor} actor - 目标 Actor
   */
  static async #executeExit(op, region, behavior, token, actor) {
    let entries = null;
    let fromSnapshot = false;
    if (region) {
      const stored = this.getEntriesOfToken(region, token.id);
      entries = Object.entries(stored)
        .filter(([, entry]) => entry?.active)
        .map(([key, entry]) => ({key, entry}));
      // 实时账目已清：重复 exit（预提交＋核心补发各一次），不再重放快照
      if (!entries.length) return;
    } else {
      // region 已删，实时账目不可得：凭入队快照摘除
      fromSnapshot = true;
      const snapshots = Array.isArray(op.snapshots) ? op.snapshots : [];
      entries = snapshots
        .filter(s => s?.entry?.active)
        .map(s => ({key: s.key, entry: s.entry}));
    }
    if (!entries.length) return;

    for (const {key, entry} of entries) {
      // 条目 eid 是快照重放的幂等凭据：无论实时摘除还是快照摘除，处理过
      // 的条目不再第二次摘除（预提交与删除补发可能各携带一份相同快照）
      if (entry.eid) {
        if (processedEids.has(entry.eid) && fromSnapshot) continue;
        rememberDedup(processedEids, entry.eid);
      }
      // 摘除一律按条目内存的实际 slug；无 payload 的直接动作光环 slug
      // 为 null，无需也无法摘除 AE，只清账目。
      if (entry.exitClear && entry.slug) {
        // 清空型移除整条 AE，由施加时的条目配置决定。
        await removeEffectBySlug(actor, entry.slug, Number.MAX_SAFE_INTEGER);
      } else if (entry.stackable && entry.slug && (entry.stacks ?? 0) > 0) {
        // 可叠层：按贡献层数摘除；贡献等于剩余层数时门面会整条移除。
        await removeEffectBySlug(actor, entry.slug, entry.stacks);
      } else if (!entry.stackable && entry.created && entry.slug) {
        // 非叠层且本光环创建：同 payload（按实际 slug 判定）光环仍覆盖
        // 目标时账本转移（创建标记移交给存活光环），否则删除。
        // 覆盖判定按 Actor 全部 Token：链接 Actor 的 Token A、
        // B 同在光环内时，A 退出不能删掉 B 仍需的共享 AE——AE 挂在
        // Actor 上，只查退出 Token 会导致 B 的效果被误删且对账不补挂。
        const covering = await findOtherCoveringAura(region, token, entry.slug);
        if (covering) {
          // 创建标记写入**覆盖 Token** 在存活光环账本中的条目：
          // 写到退出 Token 的键下会成为永久脏条目，覆盖 Token 退出时
          // created=false 不摘除，共享 AE 残留。
          await this.putEntry(covering.region, covering.tokenId, covering.payloadKey,
            {...covering.entry, created: true});
        } else {
          await removeEffectBySlug(actor, entry.slug, Number.MAX_SAFE_INTEGER);
        }
      }
      // entry.created=false 且非叠层：AE 由目标预存或来源光环之外的东西
      // 创建，不摘除目标预存的同名 AE，保留其层数与数值。

      if (region) await this.clearEntry(region, token.id, key);
    }
  }

  /**
   * 区域内部移动结算：同一 movement.id 只结算一次，且只对
   * 起点/终点都在区域内的"纯区域内移动"结算——踏入移动已由 tokenEnter
   * 结算，避免踏入移动同时触发 enter 与 moveWithin 而重复施加。
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
    // 去重键必须带 region＋token：一次移动穿过多个 moveWithin
    // 光环时核心对每个 region 各派发一次同 id 事件，全局按 id 去重会让
    // 只有第一个区域结算；按区域+目标分键后各光环独立幂等。
    const dedupKey = `${op.regionUuid}|${op.tokenUuid}|${movement.id}`;
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
   * tokenRoundEnd）→ timing 匹配 → 去重 → 直接动作。
   * 回合事件由活动 GM 派发、每单位每回合各一次，去重集合提供
   * 幂等保障（防核心重放与我方回合队列交错双发）。
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

    const dedupKey = `${op.regionUuid}|${op.tokenUuid}|${op.timing}|${op.combatId}|${op.round}`;
    if (processedRounds.has(dedupKey)) return;
    rememberDedup(processedRounds, dedupKey);

    const meta = region.getFlag(FLAG_SCOPE, FLAG_AURA) ?? {};
    const sourceToken = await resolveSourceToken(meta);
    if (!passesFilter(system, token, sourceToken)) return;

    // 挂载特效（按轮固定）：账本存在性幂等——进入时已挂的不再重复挂，
    // 只为结算时机点上尚未拥有的单位补挂（如灼日的"回合开始未目盲者目盲"）。
    // 挂载与 enter 共用同一账本键与摘除路径，离开时照常清理。
    if (kind === "effect") {
      const payloadKey = op.payloadKey || payloadKeyOf(system, behavior.id);
      if (this.getEntry(region, token.id, payloadKey)?.active) return;
      // 与 enter 同款成员核对：回合事件与离开事件并发时，目标可能已不在
      // 覆盖内，挂载会造成范围外特效。
      if (!region.tokens.has(token)) return;
      const entry = await this.#applyAndRecord(system, meta, region, token, actor, payloadKey);
      // 写入后二次核对：挂载在途期间目标离开或 region 删除 → 按条目补偿
      if (!region.tokens.has(token) || !(await fromUuid(op.regionUuid))) {
        await this.#compensateRemove(region, token, actor, payloadKey, entry);
      }
      return;
    }
    await applyAction(system.roundAction, actor, sourceToken?.actor ?? null);
  }

  /**
   * 补偿清理：按账本条目摘除已施加的 AE 并清账目，不触发
   * 覆盖转移（补偿路径只求"不留残留"）；清空型与正常退出同口径整条
   * 清除，避免满层钳制的清空型在施加过程中遇到 Region 删除时残留。
   * @param {RegionDocument} region - 光环 region
   * @param {TokenDocument} token - 目标 Token
   * @param {Actor} actor - 目标 Actor
   * @param {string} payloadKey - payload 串行键
   * @param {object} entry - 账本条目
   */
  static async #compensateRemove(region, token, actor, payloadKey, entry) {
    // 补偿摘除与快照摘除共用 eid 幂等凭据：同一份条目只摘一次
    if (entry.eid) rememberDedup(processedEids, entry.eid);
    if (entry.exitClear && entry.slug) {
      await removeEffectBySlug(actor, entry.slug, Number.MAX_SAFE_INTEGER);
    } else if (entry.stackable && entry.slug && (entry.stacks ?? 0) > 0) {
      await removeEffectBySlug(actor, entry.slug, entry.stacks);
    } else if (!entry.stackable && entry.created && entry.slug) {
      await removeEffectBySlug(actor, entry.slug, Number.MAX_SAFE_INTEGER);
    }
    await this.clearEntry(region, token.id, payloadKey);
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
 * 由行为配置计算 payload 的账本键（配置级：分组与定位用）。
 * 注意与实际 slug 的区分：门面优先使用 payload AE 的显式 slug（如中文
 * 名"浩渺气海"的显式 slug 可能是拼音），效果名 slugify 只是配置级身份；
 * 实际 slug 由 resolvePayload 解析后存入账本条目的 slug 字段。
 * 键必须可安全用于点分隔的 flags 更新路径：slugify 产物与 behaviorId
 * 均无点，仍显式剔除以防配置异常。
 * @param {object} system - 行为 system 数据
 * @param {string} [behaviorId] - 行为文档 id（直接动作光环的键成分）
 * @returns {string} payloadKey
 */
export function payloadKeyOf(system, behaviorId = "") {
  const slug = slugOfPayload(system);
  const key = slug || `direct:${behaviorId || ""}`;
  return key.replace(/\./g, "-");
}

/**
 * payload 效果名的 slug 化；与门面 XJZLActiveEffect.getSlug 的 name 分支
 * 口径一致（不引入门面文档类，避免文档模块与队列模块循环依赖）。
 * 仅作配置级身份；实际匹配 slug 见 resolvePayload。
 * @param {object} system - 行为 system 数据
 * @returns {string} slug；无 payload 名时返回空串
 */
function slugOfPayload(system) {
  const name = system?.payloadEffectName;
  return name ? String(name).slugify() : "";
}

/**
 * 解析 payload 引用为可施加的 AE 数据（源物品 UUID＋效果名）。
 * 返回的 slug 是**实际** slug——优先显式 flag，与门面 getSlug 的匹配口径
 * 完全一致；账本查找、摘除、覆盖判定都必须用它，否则显式 slug 的 payload
 * 施加后无法按账本摘除。
 * @param {object} system - 行为 system 数据
 * @param {object} meta - region flags 的 aura 元数据
 * @returns {Promise<{data: object, slug: string}|null>} 解析失败返回 null（已警告）
 */
async function resolvePayload(system, meta) {
  if (!system.payloadItemUuid || !system.payloadEffectName) return null;
  const item = await fromUuid(system.payloadItemUuid);
  const found = item?.effects?.find(e => e.name === system.payloadEffectName);
  if (!found) {
    console.warn(`XJZL | 光环 payload 不可解析: ${system.payloadItemUuid} / "${system.payloadEffectName}"（源物品被删或效果名不匹配）`);
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
 * 按账本键摘除 AE：走门面 removeEffect 保留叠层/飘字语义。
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
 * @param {object} system - 行为 system 数据
 * @param {TokenDocument} token - 目标 Token
 * @param {TokenDocument|null} sourceToken - 源 Token
 * @returns {boolean} 是否通过过滤
 */
export function passesFilter(system, token, sourceToken) {
  if (system.includeSelf === false && sourceToken && token.id === sourceToken.id) return false;
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

/**
 * 读取动作类型；缺省/非法值归 "none"。
 * @param {object} action - 动作配置
 * @returns {string} "none"|"damage"|"healing"
 */
function actionKindOf(action) {
  const kind = action?.kind;
  return (kind === "damage" || kind === "healing") ? kind : "none";
}

/**
 * 解析动作数值：固定数值直接使用；公式按源角色 rollData 解析
 * （如 "0.4*@neixi"，由 actor.getRollData 提供属性引用）。
 * @param {string|number} raw - 数值或公式
 * @param {Actor|null} sourceActor - 源 Actor
 * @returns {Promise<number>} 解析结果；解析失败警告并返回 0（不结算）
 */
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

/**
 * 当前节流键 `${combatId}:${round}`；战斗外返回 null（进出挂摘不节流）。
 * @returns {string|null}
 */
function currentThrottleKey() {
  const combat = game.combat;
  if (!combat?.round) return null;
  return `${combat.id}:${combat.round}`;
}

/**
 * 判定移动是否为"纯区域内移动"（起点与终点格都在 grid offsets 内）。
 * 核心 GridShapeData 的 offsets 是场景绝对格坐标，成员 {i: 行, j: 列}
 * （grid.getOffset 返回 i=floor(y/size) 行、j=floor(x/size) 列）。
 * @param {RegionDocument} region - 光环 region
 * @param {object} movement - {origin, destination}
 * @returns {boolean}
 */
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
 * 查找与退出 payload 相同（按实际 slug 判定）且仍覆盖该 Actor 的其他
 * 光环。覆盖判定遍历 Actor 的**全部实际 Token 文档**：
 * 用核心 getDependentTokens({concreteOnly:true}) 跨场景取依赖注册表中的
 * Token；同一关联 Actor 的其他场景 Token 仍被同 payload 光环覆盖时，
 * 共享 AE 必须保留；合成 Actor 只
 * 返回自身。任一 Token 仍被覆盖即视为"仍被覆盖"，转移目标写该覆盖
 * Token 在存活光环账本中的条目。只认 enter 开启、行为激活、账本有效的
 * 覆盖。触发频率为"非叠层 created 退出"分支（低频事件），注册表查找
 * 成本可忽略。
 * @param {RegionDocument|null} originRegion - 退出的光环 region（可已删除）
 * @param {TokenDocument} originToken - 退出的 Token（兜底与行为解析）
 * @param {string} slug - 退出条目的实际 slug
 * @returns {Promise<{region: RegionDocument, tokenId: string, payloadKey: string, entry: object}|null>}
 *   tokenId 是覆盖 Token 的 id（创建标记要写到它的条目上）
 */
async function findOtherCoveringAura(originRegion, originToken, slug) {
  let candidates;
  try {
    candidates = originToken.actor?.getDependentTokens?.({concreteOnly: true}) ?? [];
  } catch (err) {
    console.warn("XJZL | 解析 Actor 的依赖 Token 失败，覆盖转移退回单 Token 判定:", err);
    candidates = [];
  }
  if (!candidates.length) candidates = [originToken];

  for (const token of candidates) {
    for (const region of token.regions ?? []) {
      if (region.hidden) continue;
      // 仅排除正在退出的 Token 条目；同 Actor 的其他 Token 仍可持有共享 AE。
      if (originRegion && region.id === originRegion.id && token.id === originToken.id) continue;
      const behavior = region.behaviors.find(b => b.type === "xjzlAura" && !b.disabled);
      if (!behavior) continue;
      // 回合挂载的光环即使关闭进入结算，也可能持有有效账目。
      const sys = behavior.system;
      const canHoldEntry = sys.enterEnabled || (sys.roundEnabled && sys.roundAction?.kind === "effect");
      if (!canHoldEntry) continue;
      const stored = AuraLedger.getEntriesOfToken(region, token.id);
      for (const [key, entry] of Object.entries(stored)) {
        if (entry?.active && entry.slug && entry.slug === slug) {
          return {region, tokenId: token.id, payloadKey: key, entry};
        }
      }
    }
  }
  return null;
}

/**
 * 记录去重键；超容量时清空重来（宁可极小概率重算，也不无限占用内存）。
 * @param {Set<string>} set - 去重集合
 * @param {string} key - 去重键
 */
function rememberDedup(set, key) {
  if (set.size >= DEDUP_LIMIT) set.clear();
  set.add(key);
}
