import { XJZL } from "../config.mjs";
const renderTemplate = foundry.applications.handlebars.renderTemplate;

/**
 * 预设一个木桩目标用于伤害预览的计算，为了防止用户在脚本里修改全局木桩对象，加一个set 陷阱来禁止修改
 */
const DUMMY_TARGET = new Proxy({
  name: "预设木桩",
  system: {
    resources: { hp: { value: 100, max: 100 }, mp: { value: 100, max: 100 }, rage: { value: 0, max: 10 } },
    stats: {}, combat: {}
  }
}, {
  get: (t, prop) => {
    if (prop in t) return t[prop];
    // 返回一个新的递归 Proxy
    return new Proxy(() => 0, {
      get: () => 0,
      apply: () => 0,
      toPrimitive: () => 0,
      set: () => true // 允许设置操作但不生效 (静默吞掉)
    });
  },
  // 【新增】拦截对根对象的修改
  set: () => true // 告诉脚本"设置成功"，但实际上什么都不改
});
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
    // 如果以后有技艺
    // if (this.type === "art") return "arts";
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

  /* -------------------------------------------- */
  /*  核心战斗计算 (Core Combat Logic)            */
  /* -------------------------------------------- */

  /**
   * 计算招式的详细数值 (预览/结算通用)
   * @param {String} moveId - 招式 ID
   * @param {Actor|Object} [target=null] - 目标 Actor。如果不传，自动创建一个满状态木桩。
   * @returns {Object|null} 计算结果 { damage, feint, breakdown, cost, ... }
   */
  calculateMoveDamage(moveId, target = null) {
    // 1. 基础校验
    if (this.type !== "wuxue") return null;
    const actor = this.actor;
    if (!actor) return null;

    // 获取招式数据 (注意：读取的是 prepareDerivedData 后的 system.moves)
    const move = this.system.moves.find(m => m.id === moveId);
    if (!move) return null;

    // 2. 准备目标 (Target / Mock)
    // 如果没有传入目标，创建一个 Proxy 假人 (木桩)
    const actualTarget = target || DUMMY_TARGET;
    // 包装成数组以适配脚本中的 targets 参数
    const targetsArray = Array.isArray(actualTarget) ? actualTarget : [actualTarget];
    const primaryTarget = targetsArray[0];

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

    // --- G. 执行招式脚本 (Script Execution) ---
    // 注意：这是同步执行，用于计算数值
    if (move.script && move.script.trim()) {
      if (actor.system.resources && actor.system.stats) {
        const out = {
          damage: totalDmg,
          feint: feintVal
        };

        try {
          // 构造沙盒
          // 获取该 Item 的 rollData (通常包含 actor.system 的简化版)
          const rollData = this.getRollData();
          const fn = new Function("actor", "S", "out", "t", "targets", "item", "rollData", move.script);
          fn(actor, actor.system, out, primaryTarget, targetsArray, this, rollData);

          // 1. 更新伤害
          totalDmg = Math.floor(out.damage);
          scriptDmgBonus = totalDmg - preScriptDmg;

          // 2. 更新虚招值
          const newFeint = Math.floor(out.feint);
          scriptFeintBonus = newFeint - feintVal;
          feintVal = newFeint;

        } catch (err) {
          console.warn(`[XJZL] 招式 [${move.name}] 计算脚本错误:`, err);
        }
      }
    }

    // --- H. 生成显示数据 (Breakdown) ---
    let breakdownText = `招式本身伤害: ${moveBaseDmg}\n`;
    breakdownText += `+ 武器伤害: ${weaponDmg}\n`;
    breakdownText += `+ 武器等级增伤: ${weaponDmgBonus}\n`;
    breakdownText += `+ 属性增伤: ${Math.floor(attrBonus)}\n`;
    breakdownText += `+ 其他增伤: ${flatBonus}`;

    if (scriptDmgBonus !== 0) {
      const sign = scriptDmgBonus > 0 ? "+" : "";
      breakdownText += `\n${sign} 特效增伤: ${scriptDmgBonus}`;
    }

    if (scriptFeintBonus !== 0) {
      const sign = scriptFeintBonus > 0 ? "+" : "";
      if (!feintBreakdown) feintBreakdown = "基础 0";
      feintBreakdown += ` ${sign} 特效加值 ${scriptFeintBonus}`;
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

  // 将来 roll() 也会写在这里
  async roll() {
    // ...
  }
}