const renderTemplate = foundry.applications.handlebars.renderTemplate;

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
     * @param {Object|Array} [options.onFail] 失败时应用的 Effect 数据 (必须包含 name, changes 等)
     * @param {Object} [options.damageOnFail] 失败时扣除资源 { value: 10, type: "hp" }
     * @param {Actor} [options.attacker] 发起者 Actor (可选，用于显示名字，脚本里通常是 `actor` 或 `attacker`)
     * @param {Number} options.level 预设优劣势 (正数=优, 负数=劣)
     * @param {String} [options.successText] 成功时的提示文本
     * @param {String} [options.failureText] 失败时的提示文本
     */
    static async requestSave({ target, type, dc, label, onFail, damageOnFail, attacker, level = 0, successText, failureText }) {
        if (!target) return ui.notifications.error("requestSave: 缺少目标 (target)");
        if (!type) return ui.notifications.error("requestSave: 缺少属性类型 (type)");

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

        // 检查 onFail 是否为函数
        if (typeof onFail === 'function') {
            console.warn(`XJZL Dev Warning | Macros.requestSave: onFail 参数不能是函数，因为它无法存入数据库。已自动忽略该参数。如果你想显示提示，请使用 'failureWarning' 参数。`);
            // 强制置空，防止脏数据进入 flags
            safeOnFail = null;
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
            level: level, //优势劣势等级
            successText: successText || null,
            failureText: failureText || null
        };

        // 4. 发送消息
        return ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: target }), // 建议 Speaker 是目标，方便玩家自己看
            content: content,
            flags: { "xjzl-system": flags }
        });
    }

    /**
     * 发起对抗请求 (Request Contest)
     * 这是一个异步的“记分牌”系统。
     * @param {Object} options
     * @param {Actor} options.attacker   发起者 Actor (通常是 current actor)
     * @param {Actor} options.defender   对抗者 Actor (目标)
     * @param {String} options.type      发起者的属性 Key (如 "neili")
     * @param {String} [options.defType] 对抗者的属性 Key (如果不填，默认和发起者一致)
     * @param {String} [options.label]   对抗标题 (如 "内力比拼", "吸星大法")
     * @param {String} [options.winText] 发起者获胜时的描述文本
     * @param {String} [options.loseText] 发起者失败时的描述文本
     * @param {Object} [options.outcome] 自动化配置
     */
    static async requestContest({ attacker, defender, type, defType, label, winText, loseText, outcome }) {
        if (!attacker || !defender) return ui.notifications.error("对抗请求缺少参与双方。");
        if (!type) return ui.notifications.error("对抗请求缺少属性类型。");

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
            config: {
                attAttr: type,
                defAttr: defenderType,
                attLabel: attLabel,
                defLabel: defLabel,
                label: label || "属性对抗",
                outcome: finalOutcome // 存入清洗后的自动化配置
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
            user: game.user.id,
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