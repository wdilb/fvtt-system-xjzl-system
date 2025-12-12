/**
 * ==============================================================================
 *  通用伤害与环境结算工具 (Generic Damage Tool)
 * ==============================================================================
 * 
 * 这是一个基于 ApplicationV2 的独立工具窗口。
 * 
 *  **设计目标**:
 *  - 允许 GM 或授权玩家快速对选中的 Token 施加伤害。
 *  - 模拟陷阱、坠落、环境伤害（如火海、毒气）或“神的制裁”。
 *  - 绕过 Items 和 Rolls 流程，直接构建数据包调用 Actor.applyDamage。
 * 
 * ==============================================================================
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const renderTemplate = foundry.applications.handlebars.renderTemplate;

export class GenericDamageTool extends HandlebarsApplicationMixin(ApplicationV2) {
  
  /**
   *  核心配置 (V13 Standard)
   */
  static DEFAULT_OPTIONS = {
    tag: "form",
    id: "xjzl-damage-tool",
    // 样式类名：xjzl-window (通用窗口样式), damage-tool (本窗口专用)
    classes: ["xjzl-window", "damage-tool"],
    position: { 
      width: 420, 
      height: "auto" 
    },
    window: { 
      title: "⚔️ 通用伤害工具", 
      icon: "fas fa-meteor", // 陨石图标，代表天降伤害
      resizable: false 
    },
    actions: {
      // 绑定按钮动作
      apply: GenericDamageTool.prototype._onApply
    }
  };

  /**
   *  模板定义
   */
  static PARTS = {
    form: { 
      template: "systems/xjzl-system/templates/apps/damage-tool.hbs" 
    }
  };

  /**
   *  数据准备上下文
   * 将系统配置传递给 Handlebars 模板
   */
  async _prepareContext(options) {
    // 获取伤害类型配置 (包含 Key 和 本地化 Key)
    // 格式: { waigong: "XJZL.Damage.Waigong", ... }
    const damageTypes = {};
    
    for (const [key, labelKey] of Object.entries(CONFIG.XJZL.damageTypes)) {
      damageTypes[key] = game.i18n.localize(labelKey);
    }

    return {
      damageTypes: damageTypes,
      // 默认选中的类型
      defaultType: "waigong",
      // 默认理由
      defaultReason: "环境伤害"
    };
  }

  /* -------------------------------------------- */
  /*  交互逻辑处理 (Event Handlers)               */
  /* -------------------------------------------- */

  /**
   *  点击 "施加伤害" 按钮时触发
   */
  async _onApply(event, target) {
    event.preventDefault();
    
    // 1. 获取表单数据 (使用 FormData API)
    const formData = new FormData(this.element);
    
    const amount = parseInt(formData.get("amount")) || 0;
    const type = formData.get("type");
    const reason = formData.get("reason") || "神秘伤害";
    
    // 获取开关状态 (checkbox 在 formData 中仅当选中时存在且为 "on")
    const config = {
      ignoreDefense: formData.get("ignoreDefense") === "on",
      ignoreBlock: formData.get("ignoreBlock") === "on",
      isCrit: formData.get("isCrit") === "on",
      forceHit: formData.get("forceHit") === "on"
    };

    // 2. 基础校验
    if (amount <= 0) {
      return ui.notifications.warn("伤害数值必须大于 0。");
    }

    // 3. 获取目标 (当前被框选的 Token)
    // 兼容性写法：优先取 activeLayer 的 controlled，防止切层导致获取不到
    const tokens = canvas.tokens.controlled;
    const actors = tokens.map(t => t.actor).filter(a => a); // 过滤掉无效 Actor

    if (actors.length === 0) {
      return ui.notifications.warn("请先在场景中选中至少一个目标 Token。");
    }

    // 4. 执行循环应用 (Batch Process)
    // 并不需要并行(Promise.all)，因为每个 applyDamage 都会生成卡片，顺序执行视觉效果更好
    for (const actor of actors) {
      await this._applyToActor(actor, amount, type, reason, config);
    }

    // 提示完成
    ui.notifications.info(`已对 ${actors.length} 个目标施加伤害。`);
  }

  /**
   *  内部核心：单体应用逻辑
   */
  async _applyToActor(actor, amount, type, reason, config) {
    try {
      // 1. 调用 Actor 核心伤害接口
      // 注意：attacker 传 null，代表无来源/环境
      const result = await actor.applyDamage({
        amount: amount,
        type: type,
        attacker: null, 
        isHit: true,        // 默认命中
        isCrit: config.isCrit,
        applyCritDamage: true, // 如果勾选暴击，这里默认应用暴击倍率
        isBroken: config.ignoreBlock,
        ignoreDefense: config.ignoreDefense,
        ignoreBlock: config.ignoreBlock
      });

      // 2. 准备聊天卡片数据 (复用 damage-card.hbs)
      // 获取 Token 图片用于显示，如果没有 Token 则用 Actor 头像
      const tokenImg = actor.token?.texture?.src || actor.prototypeToken?.texture?.src || actor.img;
      const typeLabel = game.i18n.localize(CONFIG.XJZL.damageTypes[type] || type);

      const templateData = {
        name: actor.name,
        img: tokenImg,
        finalDamage: result.finalDamage,
        hutiLost: result.hutiLost,
        hpLost: result.hpLost,
        mpLost: result.mpLost,
        isDead: result.isDead,
        isDying: result.isDying,
        rageGained: result.rageGained
      };

      const content = await renderTemplate(
        "systems/xjzl-system/templates/chat/damage-card.hbs",
        templateData
      );

      // 3. 准备撤销数据 (Undo Data)
      // 虽然没有攻击者，但仍支持回退 HP/MP 扣除
      const undoData = {
        attackerUuid: null, // 无攻击者
        targetUuid: actor.uuid,
        hpLost: result.hpLost,
        hutiLost: result.hutiLost,
        mpLost: result.mpLost,
        gainedDead: result.isDead,
        gainedDying: result.isDying,
        gainedRage: result.rageGained
      };

      // 4. 发送聊天消息
      ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor: actor }),
        // Flavor 文本：显示伤害来源和类型
        flavor: `<span style="font-weight:bold">${reason}</span> <span style="font-size:0.8em; color:#666">(${typeLabel})</span>`,
        content: content,
        flags: {
          "xjzl-system": {
            type: "damage-card",
            undoData: undoData
          }
        }
      });

    } catch (err) {
      console.error(`[XJZL] 应用伤害失败 [${actor.name}]:`, err);
      ui.notifications.error(`对 ${actor.name} 应用伤害时发生错误，请查看控制台。`);
    }
  }
}