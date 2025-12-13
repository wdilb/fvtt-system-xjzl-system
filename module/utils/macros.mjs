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
     * @param {Actor} [options.attacker] 发起者 Actor (可选，用于显示名字，脚本里通常是 `actor` 或 `attacker`)
     * @param {Number} options.level 预设优劣势 (正数=优, 负数=劣)
     */
    static async requestSave({ target, type, dc, label, onFail, attacker, level = 0 }) {
        if (!target) return ui.notifications.error("requestSave: 缺少目标 (target)");
        if (!type) return ui.notifications.error("requestSave: 缺少属性类型 (type)");

        // 1. 准备显示数据
        // 兼容 stats 和 skills 的 Label 查找
        const labelKey = CONFIG.XJZL.attributes[type] || CONFIG.XJZL.skills[type] || type;
        const attrLabel = game.i18n.localize(labelKey);

        const attackerName = attacker ? attacker.name : "未知来源";
        const targetName = target.name;

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
            attribute: type,
            dc: dc,
            onFail: onFail, // 直接存入 Effect 数据对象
            level: level //优势劣势等级
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
        if (!args.isHit) return false;

        // B. 必须是能够被格挡的伤害类型 (内功/外功)
        // 流失、毒素、真实伤害通常不触发架招
        const validTypes = ["waigong", "neigong"];
        if (!validTypes.includes(args.type)) return false;

        // C. 检查是否被“无视架招” (破招/虚招击破/特殊效果)
        if (args.ignoreStance) return false;

        return true;
    }
}