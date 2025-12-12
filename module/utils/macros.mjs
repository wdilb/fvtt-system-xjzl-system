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
     */
    static async requestSave({ target, type, dc, label, onFail, attacker }) {
        if (!target) return ui.notifications.error("requestSave: 缺少目标 (target)");
        if (!type) return ui.notifications.error("requestSave: 缺少属性类型 (type)");

        // 1. 准备显示数据
        const attrLabel = game.i18n.localize(CONFIG.XJZL.stats[type] || type);
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
            onFail: onFail // 直接存入 Effect 数据对象
        };

        // 4. 发送消息
        return ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: target }), // 建议 Speaker 是目标，方便玩家自己看
            content: content,
            flags: { "xjzl-system": flags }
        });
    }
}