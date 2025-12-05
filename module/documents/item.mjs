import { XJZL } from "../config.mjs";
const renderTemplate = foundry.applications.handlebars.renderTemplate;
export class XJZLItem extends Item {
  /* -------------------------------------------- */
  /*  核心交互逻辑                                */
  /* -------------------------------------------- */

  /**
   * 统一的使用接口
   * 外部调用 item.use() 即可，无需关心具体类型
   */
  async use() {
    if (!this.actor) return ui.notifications.warn("该物品不在角色身上，无法使用。");

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

    const content = await renderTemplate(
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
    const content = await renderTemplate(
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

  /**
   * 切换内功运行状态
   */
  async toggleNeigong() {
    if (this.type !== "neigong") return ui.notifications.warn("只能运行内功。");
    const actor = this.actor;
    if (!actor) return ui.notifications.warn("该内功不在角色身上，无法运行。");

    const isActive = this.system.active; // 当前状态
    const targetState = !isActive;       // 目标状态 (取反)

    // === 1. 准备 Item 的更新数据 (Batch Updates) ===
    const itemUpdates = [];

    // 如果是要开启新内功，需要先找到所有其他正在运行的内功，把它们关掉
    if (targetState) {
      // 遍历角色身上所有内功
      for (const i of actor.itemTypes.neigong) {
        // 排除自己，且只处理当前是 active 的
        if (i.id !== this.id && i.system.active) {
          itemUpdates.push({ 
            _id: i.id, 
            "system.active": false 
          });
        }
      }
    }

    // 把自己状态的更新也放进这个数组，一起提交！
    itemUpdates.push({
      _id: this.id,
      "system.active": targetState
    });

    // === 2. 执行数据库更新 ===
    
    // 2.1 批量更新所有涉及变动的 Item (关闭旧的 + 开启新的) -> 触发一次界面刷新
    if (itemUpdates.length > 0) {
      await actor.updateEmbeddedDocuments("Item", itemUpdates);
    }

    // 2.2 更新 Actor 自身的记录字段 -> 触发一次界面刷新
    // 如果开启，记录 ID；如果关闭，清空记录
    const newActiveId = targetState ? this.id : "";
    
    // 只有当 Actor 记录的数据和我们预期的不一致时才更新 (节省性能)
    if (actor.system.martial.active_neigong !== newActiveId) {
        await actor.update({ "system.martial.active_neigong": newActiveId });
    }

    // === 3. 提示信息 ===
    if (targetState) {
      ui.notifications.info(`${this.name} 开始运行。`);
    } else {
      ui.notifications.info(`${this.name} 停止运行。`);
    }
  }

  /**
   * 切换装备状态
   * @param {String} [acupoint] - (仅奇珍) 指定镶嵌的穴位 Key
   */
  async toggleEquip(acupoint = null) {
    const actor = this.actor;
    if (!actor) return ui.notifications.warn("该物品不在角色身上，无法装备。");;

    const isEquipping = !this.system.equipped; // 目标状态

    // === 卸下逻辑 (简单) ===
    if (!isEquipping) {
      // 如果是奇珍，卸下时清空穴位记录
      if (this.type === "qizhen") {
        await this.update({ "system.equipped": false, "system.acupoint": "" });
      } else {
        await this.update({ "system.equipped": false });
      }
      return;
    }

    // === 装备逻辑 (复杂，含互斥) ===
    const updates = [];

    // 1. 武器 (互斥)
    if (this.type === "weapon") {
      // 找到所有已装备的武器
      const equippedWeapons = actor.itemTypes.weapon.filter(i => i.system.equipped);
      // 将它们全部加入卸下队列
      equippedWeapons.forEach(w => updates.push({ _id: w.id, "system.equipped": false }));
    }

    // 2. 防具 (同部位互斥，戒指限2，饰品限6)
    else if (this.type === "armor") {
      const type = this.system.type;
      const limit = (type === "ring") ? 2 : 1;
      // 找到同部位已装备的
      const equippedArmor = actor.itemTypes.armor.filter(i => i.system.equipped && i.system.type === type);

      // 如果满了，卸下最早的一个 (FIFO)
      if (equippedArmor.length >= limit) {
        // 按 sort 排序或直接取第一个
        // 如果戒指有2个，这里会卸下第1个，保留第2个，腾出位置给新戒指
        // 如果想做得更细(比如弹窗让用户选卸下哪个)，逻辑会复杂很多，这里采用自动替换
        updates.push({ _id: equippedArmor[0].id, "system.equipped": false });
      }
    }

    // 3. 奇珍 (穴位校验)
    else if (this.type === "qizhen") {
      // 必须传入穴位
      if (!acupoint) {
        return ui.notifications.error("装备奇珍必须指定穴位。");
      }
      // 增加校验逻辑：防止宏强行插入已占用的穴位
      const available = this.actor.getAvailableAcupoints();
      if (!available.find(a => a.key === acupoint)) {
            return ui.notifications.error("该穴位未打通或已被占用！");
      }
      // 这里进行最终的逻辑校验 (Sheet层可能已经校验过 UI，这里做数据兜底)
      // 比如检查穴位是否打通、是否被占用等，逻辑同 Sheet，建议封装 helper
      // 为简化，这里假设传入的 acupoint 是合法的，直接写入
      await this.update({
        "system.equipped": true,
        "system.acupoint": acupoint
      });
      ui.notifications.info(`已将 ${this.name} 储存至 ${game.i18n.localize(XJZL.acupoints[acupoint] || acupoint)}`);
      return; // 奇珍已独立处理，直接返回
    }
    // 把“自己”的更新也加入到 updates 数组中！
    // 这样 卸下旧的 + 装备新的 = 1 次数据库操作 = 1 次界面刷新
    // 注意：奇珍已经在前面 return 了，所以走到这里的一定是 weapon 或 armor
    updates.push({
      _id: this.id,
      "system.equipped": true
    });

    // 统一提交
    await actor.updateEmbeddedDocuments("Item", updates);
    ui.notifications.info(`已装备 ${this.name}`);
  }

  // 将来 roll() 也会写在这里
  async roll() {
    // ...
  }
}