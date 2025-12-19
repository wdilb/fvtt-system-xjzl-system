import { XJZL } from "../config.mjs";
import { SCRIPT_TRIGGERS } from "../data/common.mjs";
const renderTemplate = foundry.applications.handlebars.renderTemplate;


export class XJZLItem extends Item {
  /* -------------------------------------------- */
  /*  核心交互逻辑                                */
  /* -------------------------------------------- */

  /**
   * @override
   * 数据库更新后的逻辑钩子
   * 用于处理“数据变动后的副作用”，例如性格同步 AE、自动计算价格等
   */
  async _onUpdate(changed, options, userId) {
    await super._onUpdate(changed, options, userId);

    // 1. 仅由触发更新的客户端执行 (防止多端冲突)
    if (game.user.id !== userId) return;

    // 2. 逻辑分流：性格 (Personality)
    // 只有当 'system.chosen' 字段确实发生变化时才触发
    if (this.type === "personality" && foundry.utils.hasProperty(changed, "system.chosen")) {
      // 调用 DataModel 中的同步方法
      // 注意：这里不需要 try-catch，让错误暴露出来反而利于调试
      await this.system.syncToEffect();
    }
  }

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

    // 3. 执行脚本(消耗品仍保留旧的 usageScript 逻辑，或者可以以后统一)
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

  /* -------------------------------------------- */
  /*  修炼系统 (Cultivation Logic)                */
  /* -------------------------------------------- */

  /**
   * 获取当前物品对应的 Actor 专属修为池的 Key
   * @returns {string|null} "neigong" | "wuxue" | null
   */
  _getSpecificPoolKey() {
    if (this.type === "neigong") return "neigong";
    if (this.type === "wuxue") return "wuxue";
    if (this.type === "art_book") return "arts";
    return null;
  }

  /**
   * 内功修炼：投入修为
   * @param {Number|Object} amountOrAllocation - 可以是数字(自动分配)，也可以是对象(手动分配)
   */
  async investNeigong(amountOrAllocation) {
    if (this.type !== "neigong") return ui.notifications.warn("只能投入于内功。");;
    if (!this.actor) return ui.notifications.warn("物品不在角色身上。");

    // === 1. 参数归一化 (Normalization) ===
    let general = 0;
    let specific = 0;
    let totalTarget = 0;

    // A. 自动模式：传入的是数字
    if (typeof amountOrAllocation === "number" || typeof amountOrAllocation === "string") {
      totalTarget = parseInt(amountOrAllocation);
      if (isNaN(totalTarget) || totalTarget <= 0) return ui.notifications.warn("无效数字");

      // --- 核心逻辑：计算自动分配 (优先扣专属) ---
      const specificKey = this._getSpecificPoolKey(); // "neigong"
      // 获取 Actor 身上现有的专属修为余额
      const actorSpecificBalance = this.actor.system.cultivation[specificKey] || 0;

      // 既然优先扣专属，那就看专属够不够
      // 如果 需求 100，专属有 30，那就 specific=30, general=70
      specific = Math.min(totalTarget, actorSpecificBalance);
      general = totalTarget - specific;
    }
    // B. 手动模式：传入的是对象
    else {
      general = parseInt(amountOrAllocation.general) || 0;
      specific = parseInt(amountOrAllocation.specific) || 0;
      totalTarget = general + specific;
    }
    if (totalTarget <= 0) return ui.notifications.warn("请输入有效的投入数量。");

    // === 2. 上限检查与溢出钳制 (Clamping) ===
    const currentInvested = this.system.xpInvested;
    const maxXP = this.system.progressData.absoluteMax; // 来源于 DataModel prepareDerivedData

    // 检查是否已满
    if (currentInvested >= maxXP) {
      return ui.notifications.warn(`${this.name} 已达圆满境界，无需再投入。`);
    }

    // 如果投入总和超过了需求，我们需要“削减”投入量。
    // 策略：优先保留“专属修为”(specific)，削减“通用修为”(general)。
    const needed = maxXP - currentInvested;
    if (totalTarget > needed) {
      const overflow = totalTarget - needed;

      // 尝试从通用里扣除溢出部分
      if (general >= overflow) {
        general -= overflow;
      } else {
        // 如果通用不够扣，才扣专属
        const remainder = overflow - general;
        general = 0;
        specific -= remainder;
      }
      ui.notifications.info(`投入溢出，已自动调整为：通用 ${general} / 专属 ${specific}。`);
    }

    // 重新计算实际投入总额
    const finalTotal = general + specific;

    // === 3. 余额检查 (Balance Check) ===
    const specificKey = this._getSpecificPoolKey();
    const actorGeneral = this.actor.system.cultivation.general;
    const actorSpecific = this.actor.system.cultivation[specificKey] || 0;

    if (actorGeneral < general) {
      return ui.notifications.warn(`通用修为不足！需要 ${general}，拥有 ${actorGeneral}。`);
    }
    if (actorSpecific < specific) {
      return ui.notifications.warn(`专属修为不足！需要 ${specific}，拥有 ${actorSpecific}。`);
    }

    // === 4. 执行更新 ===
    // 更新成分池 (Breakdown)
    const currentBreakdown = this.system.sourceBreakdown || { general: 0, specific: 0 };
    const newBreakdown = {
      general: currentBreakdown.general + general,
      specific: currentBreakdown.specific + specific
    };

    const actorUpdates = {
      "system.cultivation.general": actorGeneral - general
    };
    // 只有当有专属消耗时才更新专属字段
    if (specific > 0) {
      actorUpdates[`system.cultivation.${specificKey}`] = actorSpecific - specific;
    }

    await Promise.all([
      this.actor.update(actorUpdates),
      this.update({
        "system.xpInvested": currentInvested + finalTotal,
        "system.sourceBreakdown": newBreakdown
      })
    ]);

    ui.notifications.info(`${this.name} 修为增加 ${finalTotal} (通用:${general}, 专属:${specific})。`);
  }

  /**
   * 内功回退：回收修为
   * 策略：优先退还通用修为 (LIFO)
   */
  async refundNeigong(amountOrAllocation) {
    if (this.type !== "neigong") return;
    if (!this.actor) return;

    // === 1. 参数归一化 ===
    let refundGeneral = 0;
    let refundSpecific = 0;
    let totalRefund = 0;

    // 获取 Item 内部当前的构成
    const breakdown = this.system.sourceBreakdown || { general: 0, specific: 0 };
    // A. 自动模式
    if (typeof amountOrAllocation === "number" || typeof amountOrAllocation === "string") {
      totalRefund = parseInt(amountOrAllocation);
      if (isNaN(totalRefund) || totalRefund <= 0) return ui.notifications.warn("请输入有效数字。");

      // --- 核心逻辑：优先退通用 ---
      // 假设要退 100。Item 里有 通用80，专属50。
      // general = min(100, 80) = 80
      // specific = 100 - 80 = 20
      refundGeneral = Math.min(totalRefund, breakdown.general);
      refundSpecific = totalRefund - refundGeneral;

      // 安全检查：如果 item 里没那么多专属
      if (refundSpecific > breakdown.specific) {
        refundSpecific = breakdown.specific;
        totalRefund = refundGeneral + refundSpecific; // 调整总数
      }
    }
    // B. 手动模式
    else {
      refundGeneral = parseInt(amountOrAllocation.general) || 0;
      refundSpecific = parseInt(amountOrAllocation.specific) || 0;
      totalRefund = refundGeneral + refundSpecific;

      // 存量检查
      if (refundGeneral > breakdown.general) return ui.notifications.warn("通用存量不足");
      if (refundSpecific > breakdown.specific) return ui.notifications.warn("专属存量不足");
    }

    // === 2. 执行更新 ===
    const specificKey = this._getSpecificPoolKey();
    const actorUpdates = {
      "system.cultivation.general": this.actor.system.cultivation.general + refundGeneral
    };
    if (refundSpecific > 0) {
      // 退回到对应的专属池
      const currentActorSpecific = this.actor.system.cultivation[specificKey] || 0;
      actorUpdates[`system.cultivation.${specificKey}`] = currentActorSpecific + refundSpecific;
    }

    const newBreakdown = {
      general: breakdown.general - refundGeneral,
      specific: breakdown.specific - refundSpecific
    };

    // 使用 Promise.all 同时发送请求，性能更好
    await Promise.all([
      this.actor.update(actorUpdates),
      this.update({
        "system.xpInvested": this.system.xpInvested - totalRefund,
        "system.sourceBreakdown": newBreakdown
      })
    ]);

    ui.notifications.info(`${this.name} 回退成功，返还 ${totalRefund} 点修为。(通:${refundGeneral}/专:${refundSpecific})`);
  }

  /**
   * 招式修炼
   * @param {String} moveId - 招式 ID
   * @param {Number|Object} amountOrAllocation - 数字(自动) 或 对象(手动 {general, specific})
   */
  async investMove(moveId, amountOrAllocation) {
    if (this.type !== "wuxue") return;
    if (!this.actor) return ui.notifications.warn("物品不在角色身上。");

    // === 1. 准备数据 ===
    // 必须使用 toObject 获取纯数据副本，因为我们要修改数组内部
    const itemData = this.system.toObject();
    const moveIndex = itemData.moves.findIndex(m => m.id === moveId);

    if (moveIndex === -1) return ui.notifications.error("未找到指定招式。");

    // moveDerived: 用于读取计算后的数据 (如 absoluteMax)
    // targetMove: 用于写入数据 (Source Data)
    const moveDerived = this.system.moves[moveIndex];
    const targetMove = itemData.moves[moveIndex];

    // === 2. 参数归一化 ===
    let general = 0;
    let specific = 0;
    let totalTarget = 0;

    // A. 自动模式
    if (typeof amountOrAllocation === "number" || typeof amountOrAllocation === "string") {
      totalTarget = parseInt(amountOrAllocation);
      if (isNaN(totalTarget) || totalTarget <= 0) return ui.notifications.warn("无效数字");

      // --- 核心逻辑：自动分配 (优先扣专属) ---
      const specificKey = this._getSpecificPoolKey(); // "wuxue"
      const actorSpecificBalance = this.actor.system.cultivation[specificKey] || 0;

      specific = Math.min(totalTarget, actorSpecificBalance);
      general = totalTarget - specific;
    }
    // B. 手动模式
    else {
      general = parseInt(amountOrAllocation.general) || 0;
      specific = parseInt(amountOrAllocation.specific) || 0;
      totalTarget = general + specific;
    }
    if (totalTarget <= 0) return ui.notifications.warn("请输入有效的投入数量。");


    // === 3. 上限检查与溢出钳制 (Clamping) ===
    const maxXP = moveDerived.progress.absoluteMax;
    const currentInvested = targetMove.xpInvested || 0;

    if (currentInvested >= maxXP) return ui.notifications.warn("该招式已修至化境。");

    const needed = maxXP - currentInvested;

    // 溢出策略：优先保留专属，削减通用
    if (totalTarget > needed) {
      const overflow = totalTarget - needed;

      if (general >= overflow) {
        general -= overflow;
      } else {
        const remainder = overflow - general;
        general = 0;
        specific -= remainder;
      }
      ui.notifications.info(`投入溢出，已自动调整为：通用 ${general} / 专属 ${specific}。`);
    }

    const finalTotal = general + specific;

    // === 4. 余额检查 ===
    const specificKey = this._getSpecificPoolKey();
    const actorGeneral = this.actor.system.cultivation.general;
    const actorSpecific = this.actor.system.cultivation[specificKey] || 0;

    if (actorGeneral < general) return ui.notifications.warn(`通用修为不足！需要 ${general}`);
    if (actorSpecific < specific) return ui.notifications.warn(`专属修为不足！需要 ${specific}`);

    // === 5. 执行更新 ===
    // 更新目标招式的数据
    targetMove.xpInvested = currentInvested + finalTotal;

    // 初始化/更新成分池
    if (!targetMove.sourceBreakdown) targetMove.sourceBreakdown = { general: 0, specific: 0 };
    targetMove.sourceBreakdown.general += general;
    targetMove.sourceBreakdown.specific += specific;

    // 准备 Actor 更新数据
    const actorUpdates = {
      "system.cultivation.general": actorGeneral - general
    };
    if (specific > 0) {
      actorUpdates[`system.cultivation.${specificKey}`] = actorSpecific - specific;
    }

    // 并发提交
    await Promise.all([
      this.actor.update(actorUpdates),
      this.update({ "system.moves": itemData.moves }) // 全量更新 moves 数组
    ]);

    ui.notifications.info(`${moveDerived.name} 获得 ${finalTotal} 点修为 (通:${general}/专:${specific})。`);
  }

  /**
   * 招式回退
   * @param {String} moveId - 招式 ID
   * @param {Number|Object} amountOrAllocation - 回收数量或分配对象
   */
  async refundMove(moveId, amountOrAllocation) {
    if (this.type !== "wuxue") return;
    if (!this.actor) return;

    // === 1. 获取数据 ===
    const itemData = this.system.toObject();
    const moveIndex = itemData.moves.findIndex(m => m.id === moveId);
    if (moveIndex === -1) return;

    const targetMove = itemData.moves[moveIndex];
    // 读取当前存量 (Component Check)
    const breakdown = targetMove.sourceBreakdown || { general: 0, specific: 0 };

    // === 2. 参数归一化 ===
    let refundGeneral = 0;
    let refundSpecific = 0;
    let totalRefund = 0;

    // A. 自动模式
    if (typeof amountOrAllocation === "number" || typeof amountOrAllocation === "string") {
      totalRefund = parseInt(amountOrAllocation);
      if (isNaN(totalRefund) || totalRefund <= 0) return ui.notifications.warn("请输入有效数字。");

      // --- 核心逻辑：优先退通用 (LIFO) ---
      refundGeneral = Math.min(totalRefund, breakdown.general);
      refundSpecific = totalRefund - refundGeneral;

      if (refundSpecific > breakdown.specific) {
        refundSpecific = breakdown.specific;
        totalRefund = refundGeneral + refundSpecific;
      }
    }
    // B. 手动模式
    else {
      refundGeneral = parseInt(amountOrAllocation.general) || 0;
      refundSpecific = parseInt(amountOrAllocation.specific) || 0;
      totalRefund = refundGeneral + refundSpecific;

      if (refundGeneral > breakdown.general) return ui.notifications.warn("通用修为存量不足");
      if (refundSpecific > breakdown.specific) return ui.notifications.warn("专属修为存量不足");
    }

    if (totalRefund <= 0) return;

    // === 3. 执行更新 ===
    // 扣除招式内数据
    targetMove.xpInvested -= totalRefund;
    targetMove.sourceBreakdown.general = breakdown.general - refundGeneral;
    targetMove.sourceBreakdown.specific = breakdown.specific - refundSpecific;

    // 准备 Actor 返还数据
    const specificKey = this._getSpecificPoolKey();
    const actorUpdates = {
      "system.cultivation.general": this.actor.system.cultivation.general + refundGeneral
    };
    if (refundSpecific > 0) {
      const currentActorSpecific = this.actor.system.cultivation[specificKey] || 0;
      actorUpdates[`system.cultivation.${specificKey}`] = currentActorSpecific + refundSpecific;
    }

    await Promise.all([
      this.actor.update(actorUpdates),
      this.update({ "system.moves": itemData.moves })
    ]);

    ui.notifications.info(`招式回退成功，返还 ${totalRefund} 点 (通:${refundGeneral}/专:${refundSpecific})。`);
  }

  /**
   * 技艺书修炼：投入修为
   * 逻辑对齐: investMove
   * @param {Number|Object} amountOrAllocation - 数量或分配对象
   */
  async investArt(amountOrAllocation) {
    if (this.type !== "art_book") return;
    if (!this.actor) return ui.notifications.warn("物品不在角色身上。");

    // === 1. 准备数据 ===
    // 技艺书没有固定的 maxXP 属性，它是所有章节消耗的总和
    // 这些数据都在 system 上，不需要像招式那样去数组里找
    const totalCost = this.system.chapters.reduce((sum, c) => sum + (c.cost || 0), 0);
    const currentInvested = this.system.xpInvested;

    if (currentInvested >= totalCost) {
      return ui.notifications.warn("该书籍已全部研读完毕。");
    }

    // === 2. 参数归一化 ===
    let general = 0;
    let specific = 0;
    let totalTarget = 0;

    // A. 自动模式
    if (typeof amountOrAllocation === "number" || typeof amountOrAllocation === "string") {
      totalTarget = parseInt(amountOrAllocation);
      if (isNaN(totalTarget) || totalTarget <= 0) return ui.notifications.warn("无效数字");

      // --- 核心逻辑：自动分配 (优先扣专属) ---
      const specificKey = this._getSpecificPoolKey(); // "arts"
      const actorSpecificBalance = this.actor.system.cultivation[specificKey] || 0;

      specific = Math.min(totalTarget, actorSpecificBalance);
      general = totalTarget - specific;
    }
    // B. 手动模式
    else {
      general = parseInt(amountOrAllocation.general) || 0;
      specific = parseInt(amountOrAllocation.specific) || 0;
      totalTarget = general + specific;
    }
    if (totalTarget <= 0) return ui.notifications.warn("请输入有效的投入数量。");

    // === 3. 上限检查与溢出钳制 (Clamping) ===
    const needed = totalCost - currentInvested;

    // 溢出策略：优先保留专属，削减通用
    if (totalTarget > needed) {
      const overflow = totalTarget - needed;

      if (general >= overflow) {
        general -= overflow;
      } else {
        const remainder = overflow - general;
        general = 0;
        specific -= remainder;
      }
      ui.notifications.info(`投入溢出，已自动调整为：通用 ${general} / 专属 ${specific}。`);
    }

    const finalTotal = general + specific;
    if (finalTotal <= 0) return; // 调整后可能为0

    // === 4. 余额检查 ===
    const specificKey = this._getSpecificPoolKey();
    const actorGeneral = this.actor.system.cultivation.general;
    const actorSpecific = this.actor.system.cultivation[specificKey] || 0;

    if (actorGeneral < general) return ui.notifications.warn(`通用修为不足！需要 ${general}`);
    if (actorSpecific < specific) return ui.notifications.warn(`技艺修为不足！需要 ${specific}`);

    // === 5. 执行更新 ===
    // 读取当前 breakdown (防空)
    const currentBreakdown = this.system.sourceBreakdown || { general: 0, specific: 0 };

    // 计算新 breakdown
    const newBreakdown = {
      general: currentBreakdown.general + general,
      specific: currentBreakdown.specific + specific
    };

    // 准备 Actor 更新数据
    const actorUpdates = {
      "system.cultivation.general": actorGeneral - general
    };
    if (specific > 0) {
      actorUpdates[`system.cultivation.${specificKey}`] = actorSpecific - specific;
    }

    // 并发提交
    await Promise.all([
      this.actor.update(actorUpdates),
      this.update({
        "system.xpInvested": currentInvested + finalTotal,
        "system.sourceBreakdown": newBreakdown
      })
    ]);

    ui.notifications.info(`${this.name} 研读进度 +${finalTotal} (通用:${general}, 专属:${specific})。`);
  }

  /**
   * 技艺书散功：回收修为
   * 逻辑对齐: refundMove (优先退还通用)
   * @param {Number|Object} amountOrAllocation 
   */
  async refundArt(amountOrAllocation) {
    if (this.type !== "art_book") return;
    if (!this.actor) return;

    // === 1. 获取数据 ===
    // 读取当前存量 (Component Check)
    const breakdown = this.system.sourceBreakdown || { general: 0, specific: 0 };

    // === 2. 参数归一化 ===
    let refundGeneral = 0;
    let refundSpecific = 0;
    let totalRefund = 0;

    // A. 自动模式
    if (typeof amountOrAllocation === "number" || typeof amountOrAllocation === "string") {
      totalRefund = parseInt(amountOrAllocation);
      if (isNaN(totalRefund) || totalRefund <= 0) return ui.notifications.warn("请输入有效数字。");

      // --- 核心逻辑：优先退通用 (LIFO) ---
      refundGeneral = Math.min(totalRefund, breakdown.general);
      refundSpecific = totalRefund - refundGeneral;

      // 如果通用不够退，才退专属
      if (refundSpecific > breakdown.specific) {
        refundSpecific = breakdown.specific;
        totalRefund = refundGeneral + refundSpecific;
      }
    }
    // B. 手动模式
    else {
      refundGeneral = parseInt(amountOrAllocation.general) || 0;
      refundSpecific = parseInt(amountOrAllocation.specific) || 0;
      totalRefund = refundGeneral + refundSpecific;

      if (refundGeneral > breakdown.general) return ui.notifications.warn("通用存量不足");
      if (refundSpecific > breakdown.specific) return ui.notifications.warn("专属存量不足");
    }

    if (totalRefund <= 0) return;

    // === 3. 执行更新 ===
    // 扣除书籍内数据
    const newXP = this.system.xpInvested - totalRefund;
    const newBreakdown = {
      general: breakdown.general - refundGeneral,
      specific: breakdown.specific - refundSpecific
    };

    // 准备 Actor 返还数据
    const specificKey = this._getSpecificPoolKey(); // "arts"
    const actorUpdates = {
      "system.cultivation.general": this.actor.system.cultivation.general + refundGeneral
    };
    if (refundSpecific > 0) {
      const currentActorSpecific = this.actor.system.cultivation[specificKey] || 0;
      actorUpdates[`system.cultivation.${specificKey}`] = currentActorSpecific + refundSpecific;
    }

    await Promise.all([
      this.actor.update(actorUpdates),
      this.update({
        "system.xpInvested": newXP,
        "system.sourceBreakdown": newBreakdown
      })
    ]);

    ui.notifications.info(`${this.name} 散功成功，返还 ${totalRefund} (通:${refundGeneral}/专:${refundSpecific})。`);
  }

  /* -------------------------------------------- */
  /*  核心战斗计算 (Core Combat Logic)            */
  /* -------------------------------------------- */

  /**
   * 计算招式的详细数值 (预览/结算通用)
   * @param {String} moveId - 招式 ID
   * @returns {Object|null} 计算结果 { damage, feint, breakdown, cost, ... }
   */
  calculateMoveDamage(moveId) {
    // 1. 基础校验
    if (this.type !== "wuxue") return null;
    const actor = this.actor;
    if (!actor) return null;

    // 获取招式数据 (注意：读取的是 prepareDerivedData 后的 system.moves)
    const move = this.system.moves.find(m => m.id === moveId);
    if (!move) return null;

    // 2. 准备目标 (Target / Mock)
    // 已经不需要构建虚拟目标了，我们不再在这里使用目标

    // =====================================================
    //  核心计算流程
    // =====================================================

    // --- A. 招式自带基础 (Base + Growth) ---
    const lvl = Math.max(1, move.computedLevel || 1);
    const moveBaseDmg = (move.calculation.base || 0) + (move.calculation.growth || 0) * (lvl - 1);

    // --- B. 武器基础伤害 (Weapon Item) & 装备判定 ---
    let weaponDmg = 0;
    let isWeaponMatch = false; // 标记：是否满足武器条件

    // 1. 如果招式是徒手，默认满足
    if (move.weaponType === 'unarmed') {
      isWeaponMatch = true;
    }
    // 2. 否则查找已装备且类型匹配的武器
    else if (actor.itemTypes.weapon && move.weaponType && move.weaponType !== 'none') {
      const weapon = actor.itemTypes.weapon.find(w =>
        w.system.equipped === true &&
        w.system.type === move.weaponType
      );
      if (weapon) {
        weaponDmg = weapon.system.damage || 0;
        isWeaponMatch = true;
      }
    }

    // --- C. 内功系数加成 ---
    // getNeigongDamageBonus 定义在 Actor DataModel 中
    const neigongBonusRatio = actor.system.getNeigongDamageBonus ? actor.system.getNeigongDamageBonus(move.element) : 0;

    // --- D. 属性加成 (Scalings) ---
    let attrBonus = 0;
    if (move.calculation.scalings) {
      for (const scale of move.calculation.scalings) {
        const propVal = foundry.utils.getProperty(actor.system.stats, `${scale.prop}.total`) || 0;
        // 规则：内功加成直接加在属性系数上
        const finalRatio = (scale.ratio || 0) + neigongBonusRatio;
        attrBonus += propVal * finalRatio;
      }
    }

    // --- E. 固定增伤 (Flat Bonuses from Actor) ---
    let flatBonus = 0;
    if (actor.system.combat?.damages) {
      flatBonus += (actor.system.combat.damages.global?.total || 0);
      flatBonus += (actor.system.combat.damages.skill?.total || 0);
      if (move.element && move.element !== "none") {
        flatBonus += (actor.system.combat.damages[move.element]?.total || 0);
      }
    }

    // 武器等级增伤 (只有在武器匹配时生效)
    let weaponDmgBonus = 0;
    if (isWeaponMatch && move.weaponType && actor.system.combat?.weaponRanks) {
      const rankObj = actor.system.combat.weaponRanks[move.weaponType];
      if (rankObj) {
        const rank = rankObj.total || 0;
        let rankDmg = 0;
        if (rank <= 4) rankDmg = rank * 1;
        else if (rank <= 8) rankDmg = rank * 2;
        else rankDmg = rank * 3;
        weaponDmgBonus += rankDmg;
      }
    }

    // --- F. 初步汇总 (Pre-Script) ---
    let preScriptDmg = Math.floor(moveBaseDmg + weaponDmg + attrBonus + flatBonus + weaponDmgBonus);
    let totalDmg = preScriptDmg;
    let scriptDmgBonus = 0;
    let scriptFeintBonus = 0;

    // --- 虚招值计算 (Pre-Script) ---
    let feintVal = 0;
    let feintBreakdown = "";

    if (move.type === 'feint') {
      const base = move.baseFeint || 0; // DataModel 算好的基础值

      // 武器等级加成 (同上逻辑)
      let wRankVal = 0;
      if (isWeaponMatch && move.weaponType && actor.system.combat?.weaponRanks) {
        wRankVal = actor.system.combat.weaponRanks[move.weaponType]?.total || 0;
      }

      const actorBonus = actor.system.combat.xuzhaoTotal || 0;
      feintVal = base + wRankVal + actorBonus;

      // 生成提示文本
      feintBreakdown = `${game.i18n.localize("XJZL.Wuxue.Moves.BaseFeint")} ${base} + ${game.i18n.localize("XJZL.Combat.WeaponRanks")} ${wRankVal} + ${game.i18n.localize("XJZL.Combat.XuZhao")} ${actorBonus}`;
    }

    // ==========================================================
    // G. 执行 CALC 阶段脚本 (Script Execution)
    // ==========================================================
    // 替换了旧的 move.script 逻辑，现在统一调用 actor.runScripts
    // 1. 准备可变输出对象 (Output)
    // 脚本通过修改这个对象来影响最终结果
    const calcOutput = {
      damage: preScriptDmg, // 初始伤害
      feint: feintVal,      // 初始虚招
      bonusDesc: []         // 允许脚本添加额外的描述文本
    };

    // 2. 准备上下文 (Context)
    const context = {
      move: move,
      // 传入基础数值供参考 (只读)
      baseData: {
        base: moveBaseDmg,
        weapon: weaponDmg,
        level: lvl,
        isWeaponMatch: isWeaponMatch
      },
      // 传入输出对象 (可写)
      output: calcOutput
    };

    // 3. 运行脚本 (同步)
    // 注意：这里把 move 作为 contextItem 传入而不是this，以便 collectScripts 能找到招式自身的脚本
    // 因为对于武学来说，脚本是挂在招式(move)上的，不是挂在物品(this)上的
    actor.runScripts(SCRIPT_TRIGGERS.CALC, context, move);

    // 4. 读取结果
    const finalDamage = Math.floor(calcOutput.damage);
    const finalFeint = Math.floor(calcOutput.feint);

    // 计算脚本带来的差值 (用于显示 Breakdown)
    scriptDmgBonus = finalDamage - preScriptDmg;
    scriptFeintBonus = finalFeint - feintVal;

    // --- H. 生成显示数据 (Breakdown) ---
    let breakdownText = `招式本身伤害: ${moveBaseDmg}\n`;
    breakdownText += `+ 武器伤害: ${weaponDmg}\n`;
    breakdownText += `+ 武器等级增伤: ${weaponDmgBonus}\n`;
    breakdownText += `+ 属性增伤: ${Math.floor(attrBonus)}\n`;
    breakdownText += `+ 其他增伤: ${flatBonus}`;

    if (scriptDmgBonus !== 0) {
      const sign = scriptDmgBonus > 0 ? "+" : "";
      breakdownText += `\n${sign} 特效增伤: ${scriptDmgBonus}(仅生效计算阶段特效与被动特效，不代表最终结果)`;
    }

    if (scriptFeintBonus !== 0) {
      const sign = scriptFeintBonus > 0 ? "+" : "";
      if (!feintBreakdown) feintBreakdown = "基础 0";
      feintBreakdown += ` ${sign} 特效加值 ${scriptFeintBonus}(仅生效计算阶段特效与被动特效，不代表最终结果)`;
    }

    if (!isWeaponMatch && move.weaponType && move.weaponType !== 'none' && move.weaponType !== 'unarmed') {
      breakdownText += `\n(⚠️ 未装备匹配武器)`;
      feintBreakdown += `\n(⚠️ 未装备匹配武器)`;
    }

    // 返回结果包
    return {
      damage: totalDmg,
      feint: feintVal,
      breakdown: breakdownText,
      feintBreakdown: feintBreakdown,
      neigongBonus: neigongBonusRatio > 0 ? `+${(neigongBonusRatio).toFixed(1)}系数` : "",
      cost: move.currentCost || { mp: 0, rage: 0, hp: 0 },
      // 把是否匹配武器也传出去，方便做 UI 变灰处理
      isWeaponMatch: isWeaponMatch
    };
  }

  /* -------------------------------------------- */
  /*  Roll: 核心招式执行                           */
  /* -------------------------------------------- */

  /**
   * 步骤 0: 动态配置弹窗
   * 根据招式类型显示不同的输入框
   */
  async _promptRollConfiguration(move) {
    if (move.type === "stance") return {};

    // 1. 生成唯一 ID
    const formId = `roll-config-${foundry.utils.randomID()}`;

    // 2. 准备模板数据
    const context = {
      formId: formId, // 传入 ID
      needsAttack: ["real", "feint"].includes(move.type) && ["waigong", "neigong"].includes(move.damageType),
      isFeint: move.type === "feint",
      needsDamage: ["real", "feint", "counter"].includes(move.type),
      isCounter: move.type === "counter",
      canCrit: move.type !== "counter"
    };

    // 3. 渲染 HTML
    const content = await renderTemplate("systems/xjzl-system/templates/apps/roll-config.hbs", context);

    // 4. 使用 DialogV2.wait
    return foundry.applications.api.DialogV2.wait({
      window: { title: `施展: ${move.name}`, icon: "fas fa-dice" },
      content: content,

      // 使用 ID 查找，忽略回调参数
      render: (event) => {
        const root = document.getElementById(formId);
        if (!root) return; // 安全检查

        // 使用事件委托处理点击
        root.addEventListener("click", (event) => {
          const btn = event.target.closest("button[data-action]");
          if (!btn) return;

          event.preventDefault();

          const action = btn.dataset.action;
          const targetName = btn.dataset.target;

          const input = root.querySelector(`input[name="${targetName}"]`);
          if (!input) return;

          let val = parseInt(input.value) || 0;

          if (action === "increase") val++;
          else if (action === "decrease") val--;

          input.value = val;
        });
      },

      buttons: [{
        action: "ok",
        label: "执行",
        icon: "fas fa-check",
        default: true,
        callback: (event, button, dialog) => {
          // 【关键修正】同样使用 ID 获取数据，绝对稳健
          const root = document.getElementById(formId);
          if (!root) return {}; // 容错

          // 手动构建数据，不依赖 FormData 自动解析（因为 root 可能不是 form 标签，只是个 div）
          // 但为了方便，我们可以临时构造 FormData 也是可以的，或者直接 querySelector

          // 辅助取值函数
          const getVal = (name) => {
            const el = root.querySelector(`[name="${name}"]`);
            if (!el) return 0;
            if (el.type === "checkbox") return el.checked ? "on" : null;
            return el.value;
          };

          return {
            bonusAttack: parseInt(getVal("bonusAttack")) || 0,
            bonusFeint: parseInt(getVal("bonusFeint")) || 0,
            bonusDamage: parseInt(getVal("bonusDamage")) || 0,
            canCrit: getVal("canCrit") === "on",
            manualAttackLevel: parseInt(getVal("manualAttackLevel")) || 0,
            manualFeintLevel: parseInt(getVal("manualFeintLevel")) || 0
          };
        }
      }],

      rejectClose: false,
      close: () => null
    });
  }

  /**
   * 执行招式 (Roll)
   * @param {String} moveId - 招式 ID
   * @param {Object} options - 额外配置 (如 targets, skipDialog 等)
   */
  async roll(moveId, options = {}) {
    // 0. 防连点/重入锁 (UI 层面防止重复点击导致资源连扣)
    // 这里的 _rolling 只是一个临时标记，不需要存入数据库
    if (this._rolling) return;
    this._rolling = true;

    try {
      //  基础校验
      if (this.type !== "wuxue") return;
      const actor = this.actor;
      if (!actor) {
        ui.notifications.warn("该武学不在角色身上。");
        return;
      }

      const move = this.system.moves.find(m => m.id === moveId);
      if (!move) {
        ui.notifications.error("未找到招式数据。");
        return;
      }


      // =====================================================
      // 1. 状态阻断检查 (Status Check)
      // =====================================================
      const s = actor.xjzlStatuses || {};

      // 硬控：晕眩
      if (s.stun) return ui.notifications.warn(`${actor.name} 无法行动！`);

      // 沉默：无法施展任何招式
      if (s.silence) {
        return ui.notifications.warn(`${actor.name} 无法施展任何招式！`);
      }

      // 缴械：只能用徒手
      if (s.forceUnarmed && move.weaponType !== "unarmed") {
        return ui.notifications.warn(`${actor.name} 被缴械，只能使用徒手招式！`);
      }

      // 类型封锁
      if (s.blockShiZhao && move.type === "real") return ui.notifications.warn("无法施展实招！");
      if (s.blockXuZhao && move.type === "feint") return ui.notifications.warn("无法施展虚招！");
      if (s.blockQiZhao && move.type === "qi") return ui.notifications.warn("无法施展气招！");
      if (s.blockCounter && move.type === "counter") return ui.notifications.warn("无法施展反击！");
      if (s.blockStance && move.type === "stance") return ui.notifications.warn("无法开启架招！");
      if (s.blockUltimate && move.isUltimate) return ui.notifications.warn("无法施展绝招！");

      // 插入 Hook：允许模组在招式执行前进行干预 (例如：定身状态下无法攻击)
      // 如果 Hook 返回 false，则流程中止
      if (Hooks.call("xjzl.preRollMove", this, move, options, actor) === false) return;

      // =====================================================
      // 2. 准备上下文与目标
      // =====================================================
      // 即使目前是单体，也保留完整的 targets 数组传递给后续流程，为 AOE 铺路
      // 保留 targets 仅用于记录 Chat Message 的 flags，不传给脚本
      const targets = options.targets || Array.from(game.user.targets);

      // === 玩家配置弹窗 (Dialog) ===
      let config = { bonusAttack: 0, bonusFeint: 0, bonusDamage: 0, canCrit: true, manualAttackLevel: 0, manualFeintLevel: 0 };

      if (!options.skipDialog) {
        const dialogResult = await this._promptRollConfiguration(move);
        if (!dialogResult) return;
        config = dialogResult;
      }

      // =====================================================
      // 3. 资源消耗检查 (Resource Check)
      // =====================================================
      // 计算实际消耗 (原消耗 - 减耗属性)
      // 注意：减耗不能把消耗减成负数
      // 应该放在执行出招脚本前面，资源不足直接出招失败了
      const costs = move.currentCost; // { mp: 10, rage: 0, hp: 0 }
      const costReductions = actor.system.combat.costs; // { mp: {total: 5}, rage: ... }

      const finalCost = {
        mp: Math.max(0, costs.mp - (costReductions?.mp?.total || 0)),
        rage: Math.max(0, costs.rage - (costReductions?.rage?.total || 0)),
        hp: costs.hp // 气血通常不享受减耗
      };

      // 检查余额 (这里改为 throw Error 以便跳出 try 块并由 catch 统一处理，或者你也可以保留 return)
      if (actor.system.resources.mp.value < finalCost.mp) {
        ui.notifications.warn("内力不足！");
        return;
      }
      if (actor.system.resources.rage.value < finalCost.rage) {
        ui.notifications.warn("怒气不足！");
        return;
      }
      if (actor.system.resources.hp.value <= finalCost.hp) {
        ui.notifications.warn("气血不足，无法施展！");
        return;
      }

      //扣除资源
      const resourceUpdates = {};
      if (finalCost.mp > 0) resourceUpdates["system.resources.mp.value"] = actor.system.resources.mp.value - finalCost.mp;
      if (finalCost.rage > 0) resourceUpdates["system.resources.rage.value"] = actor.system.resources.rage.value - finalCost.rage;
      if (finalCost.hp > 0) resourceUpdates["system.resources.hp.value"] = actor.system.resources.hp.value - finalCost.hp;

      if (!foundry.utils.isEmpty(resourceUpdates)) {
        await actor.update(resourceUpdates);
      }

      // =====================================================
      // 3.5 触发 "出招" 特效 (Regen On Attack)
      // =====================================================
      // 这里的时机：资源已扣除，ATTACK 脚本尚未执行。
      await actor.processRegen("Attack");

      // =====================================================
      // 4. 执行 ATTACK (Pre-Roll) 脚本
      // =====================================================
      // 这是“决策阶段”，用于决定是否优势、是否允许出招、消耗资源
      // 替代了旧的 executionScript

      const attackContext = {
        move: move,
        // 使用数值计数器，不再使用布尔值的flags
        // 核心 Flags (供脚本修改)
        flags: {
          level: s.attackLevel || 0, // 使用数值计数器，不再使用布尔值的flags,初始值继承自 Actor
          feintLevel: s.feintLevel || 0, // 虚招自身等级
          abort: false,       // 脚本设为 true 可阻断攻击
          abortReason: ""     // 阻断原因
        }
      };
      // 现在脚本里：
      // 增加优势: flags.level += 1
      // 增加劣势: flags.level -= 1
      // 强制普通: flags.level = 0
      // 执行异步脚本 (ATTACK)
      await actor.runScripts(SCRIPT_TRIGGERS.ATTACK, attackContext, move);

      // 检查阻断
      if (attackContext.flags.abort) {
        // 如果脚本没有提供原因，则使用默认提示
        if (attackContext.flags.abortReason) ui.notifications.warn(attackContext.flags.abortReason);
        return;
      }

      // === 特殊分支：架招 和 气招 ===
      // 架招不消耗普通资源(通常)，不弹窗，直接生效
      // 在伤害计算之前我们把架招和气招处理了，他们根本不造成伤害
      if (move.type === "stance") {
        // 1. 切换状态
        await actor.update({
          "system.martial.stanceActive": true,
          "system.martial.stance": move.id,      // 存招式 ID (用于读取数值)
          "system.martial.stanceItemId": this.id // 存物品 ID (用于快速查找)
        });

        // 2. 发送简单卡片
        ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: actor }),
          flavor: `开启了架招: ${move.name}`,
          content: `<div class="xjzl-chat-card"><div class="card-result">已开启架招</div></div>`
        });
        return; // 架招流程结束
      }

      if (move.type === "qi") {
        // 1. 发送简单卡片
        ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: actor }),
          flavor: `开启了架招: ${move.name}`,
          content: `<div class="xjzl-chat-card"><div class="card-result">已使用气招</div></div>`
        });
        return; // 气招流程结束
      }

      // =====================================================
      // 5. 伤害计算 (Sync Calculation)
      // =====================================================
      // 直接调用我们之前封装好的方法，保证和角色卡预览一致
      const calcResult = this.calculateMoveDamage(moveId);

      if (!calcResult) return ui.notifications.error("伤害计算失败。");

      // 应用手动修正
      calcResult.damage += config.bonusDamage;
      calcResult.feint += config.bonusFeint;

      // =====================================================
      // 6. 目标状态预计算 (Target Pre-Calculation)
      // =====================================================
      // 将这部分逻辑移出 needsHitCheck，对所有目标执行

      const targetContexts = new Map(); // 存储每个目标的计算结果 (UUID -> Context)

      // 读取自身状态
      // 提前初始化自身优劣势计数，确保 flags 能读到
      // 直接读取 context 里的数字 (包含了 Actor 被动 + 脚本修改)
      const selfLevel = attackContext.flags.level + config.manualAttackLevel;;
      const selfFeintLevel = attackContext.flags.feintLevel + config.manualFeintLevel;

      // 获取攻击者自身的被动状态 (Base)
      // 这里的逻辑是：如果攻击者身上本来就有"无视格挡"的Buff，那打谁都无视
      const baseIgnoreBlock = s.ignoreBlock || false;
      const baseIgnoreDefense = s.ignoreDefense || false;
      const baseIgnoreStance = s.ignoreStance || false;

      // 遍历目标进行脚本运算
      if (targets.length > 0) {
        for (const targetToken of targets) {
          const targetActor = targetToken.actor;
          if (!targetActor) continue;

          // 运行 CHECK 脚本
          const checkContext = {
            target: targetActor,
            flags: {
              grantLevel: 0,      // 攻击修正
              grantFeintLevel: 0,  // 虚招修正
              ignoreBlock: false,
              ignoreDefense: false,
              ignoreStance: false
            }
          };

          await actor.runScripts(SCRIPT_TRIGGERS.CHECK, checkContext, move);

          // 最终状态 = 攻击者自身被动 OR 脚本临时赋予
          const finalIgnoreBlock = baseIgnoreBlock || checkContext.flags.ignoreBlock;
          const finalIgnoreDefense = baseIgnoreDefense || checkContext.flags.ignoreDefense;
          const finalIgnoreStance = baseIgnoreStance || checkContext.flags.ignoreStance;

          // 读取目标被动状态
          const tStatus = targetActor.xjzlStatuses || {};

          // --- A. 计算命中优劣势 ---
          const targetGrant = tStatus.grantAttackLevel || 0;
          const scriptGrant = checkContext.flags.grantLevel || 0;
          const totalAttackLevel = selfLevel + targetGrant + scriptGrant;

          let attackState = 0;
          if (totalAttackLevel > 0) attackState = 1;
          else if (totalAttackLevel < 0) attackState = -1;

          // --- B. 计算虚招优劣势 ---
          const targetFeintGrant = tStatus.defendFeintLevel || 0;
          const scriptFeintGrant = checkContext.flags.grantFeintLevel || 0;
          const totalFeintLevel = selfFeintLevel + targetFeintGrant + scriptFeintGrant;

          let feintState = 0;
          if (totalFeintLevel > 0) feintState = 1;
          else if (totalFeintLevel < 0) feintState = -1;

          // 存入 Map
          targetContexts.set(targetToken.document.uuid, {
            attackState: attackState,
            feintState: feintState,
            // 这里还可以存一些中间值备查
            ignoreBlock: finalIgnoreBlock,
            ignoreDefense: finalIgnoreDefense,
            ignoreStance: finalIgnoreStance
          });
        }
      }

      // =====================================================
      // 7. 命中检定 (Hit Roll)
      // =====================================================
      let attackRoll = null;
      let rollJSON = null;
      let rollTooltip = null;
      let displayTotal = 0; // 卡片上显示的数字，用来处理复杂的优势劣势情况下该显示什么数字
      // 初始化 targetsResults，防止 ReferenceError
      const targetsResults = {};
      const damageType = move.damageType || "waigong";
      let needsHitCheck = ["waigong", "neigong"].includes(damageType); //只有内外功需要进行命中检定
      if (move.type === "counter") needsHitCheck = false; //反击必中，其他的架招和虚招在上面已经返回了
      // 将 flavorText 提到外层作用域，防止 needsHitCheck=false 时报错
      let flavorText = "";

      if (needsHitCheck) {
        // A. 确定检定加值
        let hitMod = (damageType === "waigong" ? actor.system.combat.hitWaigongTotal : actor.system.combat.hitNeigongTotal);
        hitMod += config.bonusAttack; //玩家手动加值

        // B. 确定优势/劣势 (Advantage/Disadvantage)

        // 判断是否需要 2d20 (只要有一个目标导致自身非平局)
        // 逻辑：如果没有任何目标，就只看自身 selfLevel
        let needsTwoDice = false;
        if (targets.length === 0) {
          if (selfLevel !== 0) needsTwoDice = true;
        } else {
          // 检查 Map 里是否有任意一个 state != 0
          for (const ctx of targetContexts.values()) {
            if (ctx.attackState !== 0) {
              needsTwoDice = true;
              break;
            }
          }
        }

        // C. 执行投掷
        // 如果需要补骰，公式显示 2d20，方便玩家知道“哦，我有优势/劣势处理”
        const diceFormula = needsTwoDice ? "2d20" : "1d20";
        attackRoll = await new Roll(`${diceFormula} + @mod`, { mod: hitMod }).evaluate();
        // 生成 Tooltip HTML
        rollTooltip = await attackRoll.getTooltip();
        rollJSON = attackRoll.toJSON();

        // D. 分配结果
        const diceResults = attackRoll.terms[0].results.map(r => r.result);
        const d1 = diceResults[0];
        const d2 = diceResults[1] || d1;

        // 计算显示用的 flavorText (取首要目标状态或自身状态)
        let primaryState = 0;
        if (targets.length > 0) {
          primaryState = targetContexts.get(targets[0].document.uuid)?.attackState || 0;
        } else {
          primaryState = (selfLevel > 0) ? 1 : ((selfLevel < 0) ? -1 : 0);
        }

        // 根据主要状态计算大数字
        if (primaryState === 1) {
          displayTotal = Math.max(d1, d2) + hitMod;
          flavorText = "攻击 (优势)";
        } else if (primaryState === -1) {
          displayTotal = Math.min(d1, d2) + hitMod;
          flavorText = "攻击 (劣势)";
        } else {
          displayTotal = d1 + hitMod;
          flavorText = "攻击";
        }

        // 填充预判结果
        targets.forEach(t => {
          // 修改为使用 t.document.uuid 作为 Key，而不是 t.id
          // t.id 只是由 ID 组成的字符串，而 uuid 包含场景信息，更安全
          const tokenUuid = t.document.uuid;
          const ctx = targetContexts.get(tokenUuid) || { attackState: 0 };
          const state = ctx.attackState;
          let finalDie = d1;
          let outcomeLabel = "平";
          // 根据每个目标的最终状态，从 d1/d2 中选一个
          if (state === 1) { finalDie = Math.max(d1, d2); outcomeLabel = "优"; }
          else if (state === -1) { finalDie = Math.min(d1, d2); outcomeLabel = "劣"; }

          const total = finalDie + hitMod;

          // 获取目标闪避
          // 这里只是预览命中，不做逻辑判定
          const dodge = t.actor.system.combat.dodgeTotal || 10;

          let isHit = false;

          // 规则：20必中，1必失
          if (finalDie === 20) {
            isHit = true;
          } else if (finalDie === 1) {
            isHit = false;
          } else {
            // 常规检定
            isHit = total >= dodge;
          }

          targetsResults[tokenUuid] = {
            name: t.name,
            total: total,
            isHit: isHit,
            stateLabel: outcomeLabel,
            dodge: dodge,
            die: finalDie, //显示用的哪个骰子
            feintState: ctx.feintState, //对每个目标的虚招优劣势 
            ignoreBlock: ctx.ignoreBlock,
            ignoreDefense: ctx.ignoreDefense,
            ignoreStance: ctx.ignoreStance
          };
        });
      }
      else {
        // 不需要检定 (如反击)，但我们仍需填充 targetsResults 以便显示 "必中"
        // 同时，虽然没投攻击骰，但虚招优劣势 (feintState) 已经算好了存着了
        targets.forEach(t => {
          const tokenUuid = t.document.uuid;
          const ctx = targetContexts.get(tokenUuid) || { attackState: 0 };
          targetsResults[t.document.uuid] = {
            name: t.name,
            total: "-",
            isHit: true, // 默认必中
            stateLabel: "-",
            dodge: "-",
            die: "-",
            feintState: ctx.feintState
          };
        });
        flavorText = "施展 (无需检定)";
      }

      // =====================================================
      // 8. 发送消息
      // =====================================================

      // --- 计算是否显示虚招对抗按钮 ---
      let showFeintBtn = false;

      // 只有虚招才需要判断
      if (move.type === "feint") {
        if (targets.length === 0) {
          // 情况 1: 没选目标 -> 默认显示 (允许玩家发卡后手动选人点按钮)
          showFeintBtn = true;
        } else {
          // 情况 2: 选了目标 -> 检查是否有任意一个目标开启了架招
          // 使用 .some() 方法，找到一个满足条件的就停止
          showFeintBtn = targets.some(t => t.actor?.system.martial?.stanceActive === true);
        }
      }

      // 生成聊天卡片 (Chat Card)
      const templateData = {
        actor: actor,       // 施法者
        item: this,         // 武学物品
        move: move,         // 招式数据
        calc: calcResult,   // 伤害计算结果 (包含 breakdown, damage, feint)
        cost: finalCost,    // 实际消耗
        isFeint: move.type === "feint",
        system: this.system,// 方便在模板里直接用 system.tier 等
        attackRoll: attackRoll, // 骰子实例
        rollTooltip: rollTooltip, // 骰子详情 HTML
        damageTypeLabel: game.i18n.localize(XJZL.damageTypes[damageType]),
        displayTotal: displayTotal,
        targetsResults: targetsResults,
        hasTargets: Object.keys(targetsResults).length > 0,
        showFeintBtn: showFeintBtn
      };

      const content = await renderTemplate(
        "systems/xjzl-system/templates/chat/move-card.hbs",
        templateData
      );

      // 发送消息
      const chatData = {
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor: actor }),
        flavor: flavorText || `施展了招式: ${move.name}`,
        content: content,

        // 这里的 flags 存储了所有“生成伤害”所需的信息
        // 后续的“应用伤害”按钮将读取这些 info 来运行 On-Hit 脚本和扣血
        flags: {
          "xjzl-system": {
            // 1. 基础标识
            actionType: "move-attack", // 消息类型，用于监听器识别
            itemId: this.id,           // 武学 Item ID
            moveId: move.id,           // 招式 ID
            moveType: move.type,       // 招式类型

            // 2. 数值结果
            damage: calcResult.damage, // 最终伤害值 (整数)
            feint: calcResult.feint,   // 最终虚招值 (整数)
            calc: calcResult,          // 完整计算详情 (含 breakdown 文本)
            damageType: damageType,    // 伤害类型 (waigong/neigong/...)
            canCrit: config.canCrit,   //是否可以暴击（反应不能暴击）
            attackBonus: config.bonusAttack,//传递手动加值，因为后面可能需要进行补骰
            contextLevel: {
              selfLevel: selfLevel,  // 存下 Roll 时的自身等级
              selfFeintLevel: selfFeintLevel //自身虚招等级
            },//只需要存数字了
            // 3. 掷骰结果
            // 我们存入 JSON，以便后续可以重新构建 Roll 对象 (roll = Roll.fromJSON(...))
            // 供后续脚本判断 roll.total 或 roll.isCritical
            rollJSON: rollJSON,

            // 4. 目标快照
            // 记录 UUID 列表，方便 GM 点击“一键应用”时自动寻找目标
            // 并不代表 ATTACK 脚本处理了这些目标，仅仅是 UI 层的记录
            targets: targets.map(t => t.document.uuid),
            // 存储预判结果 Map
            // 这里的 Key 是 Token ID，Value 是预判的状态
            // 这样在 Apply Damage 时，直接通过 Token ID 查表即可
            // Manager 如果要复用，会直接读这个；如果要重算，会读 contextFlags
            targetsResultMap: Object.keys(targetsResults).reduce((acc, tokenId) => {
              const res = targetsResults[tokenId];
              const safeKey = tokenId.replaceAll(".", "_");
              acc[safeKey] = {
                stateLabel: res.stateLabel, // "优", "劣", "平"
                isHit: res.isHit,           // 是否命中
                total: res.total,           // 最终数值
                dieUsed: res.die,           // 用的哪个骰子
                feintState: res.feintState,
                // 保存穿透标志到数据库
                ignoreBlock: res.ignoreBlock,
                ignoreDefense: res.ignoreDefense,
                ignoreStance: res.ignoreStance
              };
              return acc;
            }, {})
          }
        }
      };

      // 如果配置了骰子声音
      if (attackRoll) {
        ChatMessage.applyRollMode(chatData, game.settings.get("core", "rollMode"));
      }
      const message = await ChatMessage.create(chatData);

      // 播放 3D 骰子 (如果装了 Dice So Nice)
      if (attackRoll && game.dice3d) {
        game.dice3d.showForRoll(attackRoll, game.user, true);
      }

      // 插入 Hook：允许后续逻辑（如自动播放特效、自动化模组监听）
      Hooks.callAll("xjzl.rollMove", this, move, message, calcResult);

    } catch (err) {
      // 统一的错误捕获，防止报错后锁没有解开
      console.error(err);
      ui.notifications.error("招式执行过程中发生未知错误，请检查控制台。");
    } finally {
      // 无论成功还是失败，最后都解锁，允许下一次点击
      this._rolling = false;
    }
  }
}