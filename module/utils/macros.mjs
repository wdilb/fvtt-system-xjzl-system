const renderTemplate = foundry.applications.handlebars.renderTemplate;

/**
 * 将招式压缩为随卡保存的普通字段：只保留受击消费者在真实结算阶段确需的信息，
 * 不保存描述、脚本数组或完整招式；请求卡真实后果按自身语义决定来源，不强制继承。
 */
function toPlainMoveSnapshot(move) {
    if (!move || typeof move !== "object") return null;
    return {
        id: move.id ?? null,
        name: move.name ?? null,
        type: move.type ?? null,
        element: move.element ?? "none",
        damageType: move.damageType ?? null,
        weaponType: move.weaponType ?? null,
        currentCost: move.currentCost
            ? { mp: move.currentCost.mp || 0, rage: move.currentCost.rage || 0, hp: move.currentCost.hp || 0 }
            : null
    };
}

/** 来源 Item 支持 Item 文档或 UUID 字符串；卡片只保存 UUID，结算时按本地或 GM 路径还原。 */
function toSourceItemUuid(item) {
    if (!item) return null;
    return typeof item === "string" ? item : (item.uuid ?? null);
}

/** 组装随卡保存的来源字段：延期的原攻击按需保留来源与破架统计参数；通用无来源请求不写入这些键。 */
function buildSourceFlags({ item, move, source, isBroken, isSkill, targetKanpo }) {
    const sourceItemUuid = toSourceItemUuid(item);
    const sourceMove = toPlainMoveSnapshot(move);
    const flags = {};
    if (sourceItemUuid) flags.sourceItemUuid = sourceItemUuid;
    if (sourceMove) flags.sourceMove = sourceMove;
    if (source) flags.source = source;
    if (isBroken === true) flags.isBroken = true;
    if (isSkill === false) flags.isSkill = false;
    // 破架统计所需的看破值：仅延期原攻击显式传入非零值时随卡保存；缺省行为保持 0
    if (Number.isFinite(targetKanpo) && targetKanpo !== 0) flags.targetKanpo = targetKanpo;
    return flags;
}

/**
 * 将后果配置中的一笔伤害转为请求卡伤害参数。
 * value 非有限正数（含 0/缺失）视为未配置该笔后果，返回 null；
 * 单笔字段默认值与 requestSave/requestContest 的结算契约一致
 * （isCrit=false、applyCritDamage=true、ignoreX=false、element="none"、ignoreMinDamage=false）。
 * 定义于宏模块而非野兽数据模型，避免 documents/actor.mjs 依赖数据模型模块
 * （数据模型类在部分 Node 回归的 foundry mock 下无法求值）。
 * @param {Object} [damage] 后果配置中的 damage 节点
 * @returns {Object|null} 可直接传给请求宏的单笔伤害参数；未配置时为 null
 */
export function buildOutcomeDamageConfig(damage) {
    const value = Number(damage?.value);
    if (!Number.isFinite(value) || value <= 0) return null;
    return {
        value,
        type: damage.type || "hp",
        isCrit: damage.isCrit === true,
        applyCritDamage: damage.applyCritDamage !== false,
        ignoreBlock: damage.ignoreBlock === true,
        ignoreDefense: damage.ignoreDefense === true,
        ignoreStance: damage.ignoreStance === true,
        element: damage.element || "none",
        ignoreMinDamage: damage.ignoreMinDamage === true
    };
}

/**
 * 将野兽特性中的状态 ID 转为请求卡可持久化的状态引用。
 * duration/层数只在明确配置时写入，普通旧数据仍保持字符串 ID 兼容。
 * @param {string[]|Object[]} ids 状态 ID 或已构造的状态对象
 * @param {Object} [options] count/stackable/maxStacks/duration 配置；duration 统一按战斗回合处理
 * @returns {Object[]} 可传给 ActiveEffectManager 的状态数据
 */
export function buildCreatureEffectConfigs(ids, options = {}) {
    return (ids || []).filter(Boolean).map(id => {
        const effect = typeof id === "string" ? { id } : foundry.utils.deepClone(id);
        const count = Number(options.count);
        const maxStacks = Number(options.maxStacks);
        // 只在用户明确勾选“允许叠层”时覆盖状态定义；未勾选时保留状态原本的叠层规则。
        if (options.stackable === true) {
            effect.flags = effect.flags || {};
            effect.flags["xjzl-system"] = {
                ...(effect.flags["xjzl-system"] || {}),
                stackable: true,
                // 0 明确表示无限上限，因此即使状态定义自带上限也要覆盖为 0。
                maxStacks: Number.isInteger(maxStacks) && maxStacks >= 0 ? maxStacks : 0
            };
        }
        if (Number.isInteger(count) && count > 1) effect.count = count;
        const duration = options.duration;
        if (duration && Number(duration.value) > 0) {
            effect.duration = {
                value: Number(duration.value),
                // 野兽配置界面只提供“回合”，避免用户接触 Foundry 内部单位名。
                units: "rounds",
                expiry: duration.expiry || "turnStart"
            };
        }
        return effect;
    });
}

/**
 * 将豁免后果配置转换为 requestSave 的单侧参数集。
 * 只保留已配置的键；空配置返回空对象（发起端把空值直接传给宏即可，宏侧按缺省跳过）。
 * @param {Object} [outcome] check.save.success / check.save.fail 节点
 * @returns {{text?: String, effects?: Object[], damage?: Object, removeStance?: Boolean}}
 */
export function buildCreatureSaveOutcome(outcome) {
    const cfg = {};
    if (outcome?.text) cfg.text = outcome.text;
    const effects = buildCreatureEffectConfigs(outcome?.effects, {
        stackable: outcome?.effectStackable === true,
        count: outcome?.effectCount,
        maxStacks: outcome?.effectMaxStacks,
        duration: outcome?.effectDuration
    });
    if (effects.length > 0) cfg.effects = effects;
    const damage = buildOutcomeDamageConfig(outcome?.damage);
    if (damage) cfg.damage = damage;
    if (outcome?.removeStance === true) cfg.removeStance = true;
    return cfg;
}

/**
 * 将对抗后果配置转换为 requestContest 的 outcome.win/lose 节点。
 * 目标侧 = 对抗者，自身侧 = 发起野兽；全部后果均未配置时返回 undefined（对方无自动化）。
 * @param {Object} [outcome] check.contest.win / check.contest.lose 节点
 * @returns {Object|undefined} { text, targetEffect, targetDamage, selfEffect, selfDamage, selfRecovery }
 */
export function buildCreatureContestOutcome(outcome) {
    const cfg = {};
    if (outcome?.text) cfg.text = outcome.text;
    const targetEffects = buildCreatureEffectConfigs(outcome?.effects, {
        stackable: outcome?.effectStackable === true,
        count: outcome?.effectCount,
        maxStacks: outcome?.effectMaxStacks,
        duration: outcome?.effectDuration
    });
    if (targetEffects.length > 0) cfg.targetEffect = targetEffects;
    const targetDamage = buildOutcomeDamageConfig(outcome?.damage);
    if (targetDamage) cfg.targetDamage = targetDamage;
    const selfEffects = buildCreatureEffectConfigs(outcome?.selfEffects, {
        stackable: outcome?.selfEffectStackable === true,
        count: outcome?.selfEffectCount,
        maxStacks: outcome?.selfEffectMaxStacks,
        duration: outcome?.selfEffectDuration
    });
    if (selfEffects.length > 0) cfg.selfEffect = selfEffects;
    const selfDamage = buildOutcomeDamageConfig(outcome?.selfDamage);
    if (selfDamage) cfg.selfDamage = selfDamage;
    const recValue = Number(outcome?.selfRecovery?.value);
    if (Number.isFinite(recValue) && recValue > 0) {
        // 缺省 tili：发起者是野兽，自身只持久化体力/怒气，hp 恢复会被静默丢弃
        cfg.selfRecovery = { value: recValue, type: outcome.selfRecovery.type || "tili" };
    }
    return Object.keys(cfg).length > 0 ? cfg : undefined;
}

/**
 * 脚本宏助手 (Script Macros)
 * 提供给 Item 脚本使用的高级封装函数
 */
export class XJZLMacros {

    /**
     * 发起属性判定请求 (Request Saving Throw)
     * @param {Object} options 配置对象
     * @param {Actor} options.target     目标 Actor (必须)
     * @param {String} options.type      属性 Key (如 "liliang", "neixi", "wuxing")
     * @param {Number} options.dc        难度等级
     * @param {String} [options.label]   自定义标题 (可选)
     * 
     * @param {Object|Array} [options.onFail] 失败时应用的 Effect 数据 (必须包含 name, changes 等)
     * @param {Object} [options.damageOnFail] 失败时扣除资源或造成伤害 { value: 10, type: "poison" } 
     *                                        (注: type支持"hp"等系统资源直接流失，也支持"poison","waigong"等伤害类型，走完整抗性结算)
     * 
     * @param {Object|Array} [options.onSuccess] 成功时应用的 Effect 数据 (格式同 onFail)
     * @param {Object} [options.damageOnSuccess] 成功时扣除资源/造成伤害 (格式同 damageOnFail，常用于豁免后伤害减半)
     *
     * @param {Actor} [options.attacker] 发起者 Actor (可选，用于显示名字，脚本里通常是 `actor` 或 `attacker`)
     * @param {Number} options.level     预设优劣势 (正数=优, 负数=劣)
     * @param {Number} options.bonus     预设加减值
     * @param {String} [options.successText] 成功时的提示文本
     * @param {String} [options.failureText] 失败时的提示文本
     * @param {Boolean} [options.removeStanceOnSuccess] 成功时解除检定者的架招
     * @param {Boolean} [options.removeStanceOnFail] 失败时解除检定者的架招
     *
     * 延期原攻击的来源恢复 (可选；通用无来源请求不传，保持缺省行为)：
     * @param {Item|String} [options.item] 原攻击来源 Item 文档或 UUID；随卡保存 UUID，结算时还原
     * @param {Object} [options.move] 原攻击招式；只随卡保存 id/name/type/element/damageType/weaponType/currentCost 普通字段
     * @param {String} [options.source] 真实伤害后果的 applyDamage source (如 "move"/"basic"/"both")；默认 "extra"
     * @param {Boolean} [options.isBroken] 真实伤害后果保留的破架状态；默认 false
     * @param {Boolean} [options.isSkill] 真实伤害后果是否按招式伤害计入技能抗性；默认 true
     * @param {Number} [options.targetKanpo] 破架统计所需的目标看破值（解除架招前保存）；默认 0
     *
     * damageOnSuccess/damageOnFail 单笔字段 (默认值)：isCrit=false、applyCritDamage=true、
     * ignoreBlock/ignoreDefense/ignoreStance=false、element="none"、ignoreMinDamage=false；
     * value 为非负有限数值（number 类型，含合法零输入），伤害类型走标准 applyDamage，资源类型走负数 applyHealing 直接流失；
     * 缺失、非 number 类型或负数视为录入错误，拒绝本笔结算并报告（不做字符串、布尔等值的数值折算）。
     */
    static async requestSave({ target, type, dc, label, onFail, damageOnFail, onSuccess, damageOnSuccess, attacker, level = 0, bonus = 0, successText, failureText, removeStanceOnSuccess = false, removeStanceOnFail = false, item, move, source, isBroken, isSkill, targetKanpo }) {
        if (!target) return ui.notifications.error(game.i18n.localize("XJZL.Script.Notifications.RequestSaveNoTarget"));
        if (!type) return ui.notifications.error(game.i18n.localize("XJZL.Script.Notifications.RequestSaveNoType"));

        // 1. 准备显示数据
        // 兼容 stats 和 skills 的 Label 查找
        const labelKey = CONFIG.XJZL.attributes[type] ||
            CONFIG.XJZL.skills[type] ||
            CONFIG.XJZL.arts[type] ||
            CONFIG.XJZL.weaponTypes[type] ||
            type;
        const attrLabel = game.i18n.localize(labelKey);

        const attackerName = attacker ? attacker.name : "未知来源";
        const targetName = target.name;

        // 数据清洗与防错
        let safeOnFail = onFail;
        let safeOnSuccess = onSuccess;

        // 检查 onFail/onSuccess 是否为函数
        if (typeof onFail === 'function') {
            console.warn(`XJZL Dev Warning | Macros.requestSave: onFail 参数不能是函数，因为它无法存入数据库。已自动忽略该参数。如果你想显示提示，请使用 'failureText' 参数。`);
            safeOnFail = null;
        }
        if (typeof onSuccess === 'function') {
            console.warn(`XJZL Dev Warning | Macros.requestSave: onSuccess 参数不能是函数，因为它无法存入数据库。已自动忽略该参数。如果你想显示提示，请使用 'successText' 参数。`);
            safeOnSuccess = null;
        }

        // 2. 渲染模板
        const content = await renderTemplate("systems/xjzl-system/templates/chat/request-save.hbs", {
            attackerName,
            targetName,
            targetImg: target.img,
            attrLabel,
            dc,
            label
        });

        // 3. 构造 Flags 数据
        // 这些数据将在 ChatManager._rollSave 中被读取
        const flags = {
            type: "save-request", // 标记类型
            targetUuid: target.uuid,
            attackerUuid: attacker?.uuid, //备用
            attribute: type,
            dc: dc,
            onFail: safeOnFail, // 直接存入 Effect 数据对象
            damageOnFail: damageOnFail, //失败扣减的数值
            onSuccess: safeOnSuccess, // 成功时的 Effect 数据
            damageOnSuccess: damageOnSuccess, //成功扣减的数值
            level: level, //优势劣势等级
            bonus: bonus,
            successText: successText || null,
            failureText: failureText || null,
            removeStanceOnSuccess: Boolean(removeStanceOnSuccess),
            removeStanceOnFail: Boolean(removeStanceOnFail),
            // 延期原攻击的来源恢复；无来源请求不写入这些键，保持缺省行为
            ...buildSourceFlags({ item, move, source, isBroken, isSkill, targetKanpo })
        };

        // 4. 发送消息
        return ChatMessage.create({
            author: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: target }), // 建议 Speaker 是目标，方便玩家自己看
            content: content,
            flags: { "xjzl-system": flags }
        });
    }

    /**
      * 发起对抗请求 (Request Contest)
      * 这是一个异步的“记分牌”系统，支持并发防冲突与自动化结算。
      * 
      * @param {Object} options 配置对象
      * @param {Actor} options.attacker   发起者 Actor (通常是 current actor，必须)
      * @param {Actor} options.defender   对抗者 Actor (目标，必须)
      * @param {String} options.type      发起者的属性/技能/技艺 Key (如 "neili", "liliang")
      * @param {String} [options.defType] 对抗者的属性 Key (如果不填，默认和发起者一致)
      * @param {String} [options.label]   对抗标题 (如 "内力比拼", "吸星大法")
      * @param {Number} [options.attBonus=0] 发起者在本次对抗中的临时数值修正 (正数为加值，负数为减值)
      * @param {Number} [options.defBonus=0] 对抗者在本次对抗中的临时数值修正
      * @param {String} [options.winText] 发起者获胜时的描述文本 (会被 outcome.win.text 覆盖)
      * @param {String} [options.loseText] 发起者失败时的描述文本 (会被 outcome.lose.text 覆盖)
      * 
     * @param {Object} [options.outcome] 自动化后果配置 (基于发起者视角)
     * @param {Object} [options.outcome.win] 发起者获胜时执行的结果
     * @param {String} [options.outcome.win.text] 获胜描述文本
     * @param {Object} [options.outcome.win.selfRecovery] 发起者恢复资源 { value: 10, type: "hp/mp/rage" }
     * @param {Object} [options.outcome.win.selfDamage] 发起者流失资源/受伤害 { value: 10, type: "hp/poison..." }
     * @param {String|Object|Array} [options.outcome.win.selfEffect] 发起者获得状态 (如 "prone")
     * @param {Object} [options.outcome.win.targetDamage] 对抗者流失资源/受伤害
     * @param {String|Object|Array} [options.outcome.win.targetEffect] 对抗者获得状态
     *
     * @param {Object} [options.outcome.lose] 发起者失败时执行的结果 (内部结构同 win)
     *
     * 延期原攻击的来源恢复 (可选；通用无来源请求不传，保持缺省行为)：
     * @param {Item|String} [options.item] 原攻击来源 Item 文档或 UUID；随卡保存 UUID，结算时还原
     * @param {Object} [options.move] 原攻击招式；只随卡保存普通字段 (同 requestSave)
     * @param {String} [options.source] 真实伤害后果的 applyDamage source；默认 "extra"
     * @param {Boolean} [options.isBroken] 真实伤害后果保留的破架状态；默认 false
     * @param {Boolean} [options.isSkill] 真实伤害后果是否按招式伤害计入技能抗性；默认 true
     * @param {Number} [options.targetKanpo] 破架统计所需的目标看破值（解除架招前保存）；默认 0
     *
     * targetDamage/selfDamage 单笔字段 (默认值) 同 requestSave 的 damageOnSuccess/damageOnFail；
     * 请求级来源恢复只作用于延期的原攻击后果 (targetDamage)：自动恢复发起者、随卡 item/move、
     * source/isBroken/isSkill 与 targetKanpo；反噬 (selfDamage) 不继承这些来源，按 applyDamage/
     * applyHealing 缺省行为结算，也没有单笔来源覆盖参数。
     */
    static async requestContest({ attacker, defender, type, defType, label, winText, loseText, outcome, attBonus = 0, defBonus = 0, item, move, source, isBroken, isSkill, targetKanpo }) {
        if (!attacker || !defender) return ui.notifications.error(game.i18n.localize("XJZL.Script.Notifications.RequestContestNoActors"));
        if (!type) return ui.notifications.error(game.i18n.localize("XJZL.Script.Notifications.RequestContestNoType"));

        const defenderType = defType || type; // 默认同属性对抗

        // 1. 准备显示标签
        // 定义一个查找函数，依次尝试从 属性、技能、技艺 中寻找本地化 Key
        const getLabel = (key) => {
            return CONFIG.XJZL.attributes[key] ||
                CONFIG.XJZL.skills[key] ||
                CONFIG.XJZL.arts[key] ||
                CONFIG.XJZL.weaponTypes[key] ||
                key;
        };

        // 获取翻译后的文本
        const attLabel = game.i18n.localize(getLabel(type));
        const defLabel = game.i18n.localize(getLabel(defenderType));

        // 将纯文本参数 winText/loseText 合并到新的 outcome 对象中
        const finalOutcome = outcome || {};

        // 确保 win/lose 节点存在
        if (!finalOutcome.win) finalOutcome.win = {};
        if (!finalOutcome.lose) finalOutcome.lose = {};

        // 如果传了简单的 winText，优先使用；如果没传，看 outcome 里有没有
        if (winText) finalOutcome.win.text = winText;
        if (loseText) finalOutcome.lose.text = loseText;

        // 默认文本保底
        if (!finalOutcome.win.text) finalOutcome.win.text = "发起方胜出。";
        if (!finalOutcome.lose.text) finalOutcome.lose.text = "发起方失败。";

        // 2. 构造初始 Flags
        // 我们只存 ID 和 配置，不存 roll 对象(因为还没投)
        const flags = {
            type: "contest-request",
            attackerUuid: attacker.uuid,
            defenderUuid: defender.uuid,
            // 延期原攻击的来源恢复；无来源请求不写入这些键，保持缺省行为
            ...buildSourceFlags({ item, move, source, isBroken, isSkill, targetKanpo }),
            config: {
                attAttr: type,
                defAttr: defenderType,
                attLabel: attLabel,
                defLabel: defLabel,
                label: label || "属性对抗",
                outcome: finalOutcome, // 存入清洗后的自动化配置
                attBonus: attBonus,
                defBonus: defBonus
            },
            // 状态记录
            state: {
                attRoll: null,
                defRoll: null,
                isCompleted: false,
                winner: null,
                executedLog: [] // 用于记录自动化执行结果，显示在卡片上
            }
        };

        // 3. 渲染初始模板
        const content = await renderTemplate("systems/xjzl-system/templates/chat/request-contest.hbs", {
            ...flags.config,
            attackerName: attacker.name,
            defenderName: defender.name,
            attackerImg: attacker.img,
            defenderImg: defender.img,
            flags: flags // 传入 flags 方便模板判断初始状态
        });

        // 4. 发送消息
        return ChatMessage.create({
            author: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: attacker }), // 默认显示发起者
            content: content,
            flags: { "xjzl-system": flags }
        });
    }

    /**
     * 【脚本助手】检查当前是否满足触发架招特效的条件
     * 
     * 用于 DAMAGED 触发器。
     * 逻辑：必须命中 + 必须是内外功 + 架招已开启 + 攻击未无视架招
     * 这样就可以在写特效脚本时 if (!Macros.checkStance(actor, item, args)) return; 直接调用来判断是否触发架招特效了
     * @param {Actor} actor 当前角色 (防御者)
     * @param {Object} args 脚本上下文 (包含 type, isHit, ignoreStance 等)
     * @returns {Boolean} 是否触发
     */
    static checkStance(actor, args) {
        // 1. 基础校验
        if (!actor || !args) return false;

        // 2. 检查架招开启状态
        const martial = actor.system.martial;
        if (!martial.stanceActive) return false;

        // 3. 检查攻击有效性
        // A. 必须命中 (闪避不触发反震)
        if (args.outcome && args.outcome.isHit === false) return false;

        // B. 必须是能够被格挡的伤害类型 (内功/外功)
        // 流失、毒素、真实伤害通常不触发架招
        const validTypes = ["waigong", "neigong"];
        if (!validTypes.includes(args.type)) return false;

        // C. 检查是否被“无视架招” (破招/虚招击破/特殊效果)
        if (args.config?.ignoreStance) return false;

        return true;
    }
}
