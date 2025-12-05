export class XJZLItem extends Item {
  /* -------------------------------------------- */
  /*  核心交互逻辑                                */
  /* -------------------------------------------- */

  /**
   * 统一的使用接口
   * 外部调用 item.use() 即可，无需关心具体类型
   */
  async use() {
    if (!this.actor) return ui.notifications.warn("...");

    // 1. 触发使用前钩子 (允许外部取消使用)
    if (Hooks.call("xjzl.preUseItem", this, this.actor) === false) return;

    let result;
    switch (this.type) {
      case "consumable":
        result = await this._useConsumable();
        break;
      case "manual":
        result = await this._readManual();
        break;
      default:
        // 未来可以在这里扩展其他类型的默认行为，比如点击武器显示详情到聊天栏
        return ui.notifications.warn("该类型物品无法直接使用。");
    }

    // 2. 触发使用后钩子 (允许外部响应，比如播放音效)
    Hooks.callAll("xjzl.useItem", this, this.actor, result);

    return result;
  }

  /* -------------------------------------------- */
  /*  内部实现方法                                 */
  /* -------------------------------------------- */

  /**
   * 内部逻辑：使用消耗品
   */
  async _useConsumable() {
    const actor = this.actor;
    const config = this.system;

    // 0. 检查数量
    if (this.system.quantity <= 0) {
      return ui.notifications.warn(`${this.name} 数量不足。`);
    }
    const willDestroy = this.system.quantity <= 1;

    const tags = [];
    const resultLines = [];

    // 1. 恢复资源
    const updates = {};
    if (config.recovery) {
      for (const [key, val] of Object.entries(config.recovery)) {
        if (val && val !== 0) {
          const current = actor.system.resources?.[key]?.value || 0;
          const max = actor.system.resources?.[key]?.max || 999;
          const newVal = Math.min(max, current + val);

          if (newVal !== current) {
            updates[`system.resources.${key}.value`] = newVal;
            const labelMap = { hp: "气血", mp: "内力", rage: "怒气" };
            resultLines.push(`${labelMap[key] || key} +${val}`);
            tags.push("恢复");
          }
        }
      }
    }
    if (!foundry.utils.isEmpty(updates)) await actor.update(updates);

    // 2. 应用特效 (互斥逻辑)
    const consumableType = config.type || "other";

    // 移除互斥旧特效
    const effectsToDelete = actor.effects
      .filter(e => e.getFlag("xjzl-system", "consumableType") === consumableType)
      .map(e => e.id);

    if (effectsToDelete.length > 0) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", effectsToDelete);
      // ui.notifications.info(`旧的 [${consumableType}] 效果已被覆盖。`); // 可选提示
    }

    // 创建新特效
    const effectsToCreate = this.effects.map(e => {
      const data = e.toObject();
      foundry.utils.setProperty(data, "flags.xjzl-system.consumableType", consumableType);
      data.transfer = false;
      data.disabled = false;
      // 如果物品将销毁，Origin 指向 Actor，否则指向 Item
      data.origin = willDestroy ? actor.uuid : this.uuid;
      return data;
    });

    if (effectsToCreate.length > 0) {
      await actor.createEmbeddedDocuments("ActiveEffect", effectsToCreate);
      resultLines.push(`应用状态: [${effectsToCreate.map(e => e.name).join(", ")}]`);
      tags.push("状态");
    }

    // 3. 执行脚本
    let scriptOutput = "";
    if (config.usageScript && config.usageScript.trim()) {
      try {
        // 使用 AsyncFunction 构造器(异步支持)
        const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
        const fn = new AsyncFunction("actor", "item", "game", "ui", config.usageScript);
        // 执行并等待
        const result = await fn(actor, this, game, ui);
        if (typeof result === "string") scriptOutput = result;// 允许脚本返回文本用于显示
        tags.push("特殊效果");
      } catch (err) {
        console.error(err);
        ui.notifications.error(`脚本错误: ${err.message}`);
      }
    }

    // 4. 发送聊天卡片
    const templateData = {
      item: this,
      tags: tags,
      resultText: resultLines.join("，"),
      scriptOutput: scriptOutput
    };

    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/xjzl-system/templates/chat/item-card.hbs",
      templateData
    );

    ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: actor }),
      flavor: `${actor.name} 使用了 ${this.name}`,
      content: content
    });

    // 5. 扣除数量
    if (willDestroy) {
      await this.delete();
    } else {
      await this.update({ "system.quantity": this.system.quantity - 1 });
    }
  }

  /**
   * 内部逻辑：阅读秘籍
   * 逻辑：检查目标 -> 复制创建 -> 消耗秘籍
   */
  async _readManual() {
    const targetUuid = this.system.learnItemUuid;
    if (!targetUuid) return ui.notifications.warn("这本秘籍是无字天书。");

    // 1. 获取目标物品
    let targetItem;
    try {
      targetItem = await fromUuid(targetUuid);
    } catch (err) {
      return ui.notifications.error("无法找到记载的武学。");
    }
    if (!targetItem) return ui.notifications.error("目标物品不存在。");

    // 优先检查 sourceId，如果没有 sourceId，则检查 name
    const alreadyLearned = this.actor.items.find(i =>
      (i.flags.core?.sourceId === targetUuid) ||
      (i.name === targetItem.name && i.type === targetItem.type)
    );
    if (alreadyLearned) {
      return ui.notifications.warn(`你已经学会了 ${targetItem.name}，无需重复阅读。`);
    }

    // 3. 学习
    const itemData = targetItem.toObject();
    delete itemData._id;
    delete itemData.folder;
    delete itemData.ownership;
    // 记录来源，以便下次查重
    foundry.utils.setProperty(itemData, "flags.core.sourceId", targetUuid);

    await this.actor.createEmbeddedDocuments("Item", [itemData]);

    // 4. 发送聊天卡片
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/xjzl-system/templates/chat/item-card.hbs", {
      item: this,
      tags: ["秘籍", targetItem.type === "neigong" ? "内功" : "武学"],
      resultText: `领悟了 <b>[${targetItem.name}]</b>`
    });

    ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: `${this.actor.name} 阅读了 ${this.name}`,
      content: content
    });

    // 5. 消耗
    if (this.system.destroyOnUse) {
      if (this.system.quantity > 1) {
        await this.update({ "system.quantity": this.system.quantity - 1 });
      } else {
        await this.delete();
      }
    }
  }

  // 将来 roll() 也会写在这里
  async roll() {
    // ...
  }
}