/**
 * 侠界之旅 - 系统主入口
 * Author: Tiwelee
 * Tech Stack: Foundry V13, ESM, DataModels
 */

// 导入 Document 类
import { XJZLActor } from "./module/documents/actor.mjs";
import { XJZLItem } from "./module/documents/item.mjs";
import { XJZLActiveEffect } from "./module/documents/active-effect.mjs";

// 导入 DataModels (数据结构)
import { XJZLCharacterData } from "./module/data/actor/character.mjs";
// import { XJZLNPCData } from "./module/data/actor/npc.mjs"; // npc就使用和character一样的数据好了
import { XJZLContainerData } from "./module/data/actor/container.mjs";
import { XJZLCreatureData } from "./module/data/actor/creature.mjs";
import { XJZLNeigongData } from "./module/data/item/neigong.mjs";
import { XJZLWuxueData } from "./module/data/item/wuxue.mjs"
import { XJZLWeaponData } from "./module/data/item/weapon.mjs";
import { XJZLArmorData } from "./module/data/item/armor.mjs";
import { XJZLQizhenData } from "./module/data/item/qizhen.mjs";
import { XJZLConsumableData } from "./module/data/item/consumable.mjs";
import { XJZLManualData } from "./module/data/item/manual.mjs";
import { XJZLMiscData } from "./module/data/item/misc.mjs";
import { XJZLArtBookData } from "./module/data/item/art-book.mjs";
import { XJZLPersonalityData } from "./module/data/item/personality.mjs";
import { XJZLBackgroundData } from "./module/data/item/background.mjs";
import { XJZLTraitData } from "./module/data/item/trait.mjs";
import { XJZLEncounterData } from "./module/data/item/encounter.mjs";

// 导入 Sheets (UI)
import { XJZLCharacterSheet } from "./module/sheets/character-sheet.mjs";
import { XJZLCreatureSheet } from "./module/sheets/creature-sheet.mjs";
import { XJZLContainerSheet } from "./module/sheets/container-sheet.mjs";
import { XJZLNeigongSheet } from "./module/sheets/neigong-sheet.mjs";
import { XJZLWuxueSheet } from "./module/sheets/wuxue-sheet.mjs";
import { XJZLEquipmentSheet } from "./module/sheets/equipment-sheet.mjs";
import { XJZLGeneralItemSheet } from "./module/sheets/general-item-sheet.mjs";
import { XJZLArtBookSheet } from "./module/sheets/art-book-sheet.mjs";
import { XJZLPersonalitySheet } from "./module/sheets/personality-sheet.mjs";
import { XJZLBackgroundSheet } from "./module/sheets/background-sheet.mjs";
import { XJZLActiveEffectConfig } from "./module/sheets/active-effect-config.mjs";
import { XJZLTraitSheet } from "./module/sheets/trait-sheet.mjs";
import { XJZLEncounterSheet } from "./module/sheets/encounter-sheet.mjs";

//导入管理器
import { ChatCardManager } from "./module/managers/chat-manager.mjs";
import { TargetManager } from "./module/managers/target-manager.mjs";
import { ActiveEffectManager } from "./module/managers/active-effect-manager.mjs";
import { CombatStatsManager } from "./module/managers/combat-stats-manager.mjs";
import { EncounterManager } from "./module/managers/encounter-manager.mjs";

//导入工具
import { GenericDamageTool } from "./module/applications/damage-tool.mjs";
import { EffectSelectionDialog } from "./module/applications/effect-selection-dialog.mjs";
import { SeedingManager } from "./module/utils/seeding/index.mjs";  //合集包数据转换类
import { XJZLCompendiumBrowser } from "./module/applications/compendium-browser.mjs";
import { setupSocket } from "./module/socket.mjs";
import { XJZLMeasuredTemplate } from "./module/measured-template.mjs";
import { AOECreator } from "./module/applications/aoe-creator.mjs";
import { XJZLMacros } from "./module/utils/macros.mjs";
import { XJZLTurnMarkerManager } from "./module/combat-turn-marker.mjs";
import { ActionTracker } from "./module/applications/action-tracker.mjs";
import { ToneTracker } from "./module/applications/tone-tracker.mjs";
import { CombatMeterUI } from "./module/applications/combat-meter-ui.mjs";
import { xjzlSocket } from "./module/socket.mjs";
import { parseBackgroundAssets, resolveBackgroundItems, grantAndTrack, revokeBackgroundGrants, grantSectAssets, revokeAllSectGrants } from "./module/utils/background-assets.mjs";
import { EncounterRuntimeApp } from "./module/applications/encounter-runtime.mjs";

// 导入配置
import { XJZL } from "./module/config.mjs";

import { XJZLPause } from "./module/pause.mjs";

/* -------------------------------------------- */
/*  Init Hook (初始化钩子)                       */
/* -------------------------------------------- */

Hooks.once("init", async function () {
  console.log(`侠界之旅系统 - v${game.system.version} 初始化中...`);

  // 1. 将自定义配置挂载到全局 CONFIG
  CONFIG.XJZL = XJZL;

  // 替换系统的暂停类
  CONFIG.ui.pause = XJZLPause;

  // 替换系统的当前战斗指示物
  XJZLTurnMarkerManager.registerSettings();

  // 是否启用侠界自定义距离
  game.settings.register("xjzl-system", "customDistanceRule", {
    name: "启用侠界自定义距离规则 (1-2-2-2)",
    hint: "开启后，移动和测量将遵循：直行1，第一步斜行1，后续斜行2的规则，并针对V13地形消耗进行了修正。\n如果关闭，将使用FVTT核心设置（如欧几里得或5-10-5）进行计算。建议开启以获得最佳体验。",
    scope: "world",      // 世界级设置，保持同步
    config: true,        // 显示在菜单里
    default: true,       // 默认开启
    type: Boolean,
    requiresReload: true // 重要！修改底层原型必须刷新页面才能生效/还原
  });
  // 获取用户设置
  const useCustomRule = game.settings.get("xjzl-system", "customDistanceRule");
  if (useCustomRule) {

    // 替换系统的测量模板
    CONFIG.MeasuredTemplate.objectClass = XJZLMeasuredTemplate;

    // 替换FVTT自带的一定距离计算方式
    const SquareGrid = foundry.grid.SquareGrid;

    if (!SquareGrid) {
      console.error("XJZL | 无法找到 SquareGrid 类，移动距离计算修改失败。");
      return;
    }

    // ==========================================
    //  第一部分：Token 拖拽计算 (你完美的原始代码，原封不动)
    // ==========================================
    // 2. 保存原始方法 (说不定后面要用到)
    const originalMeasurePath = SquareGrid.prototype.measurePath;

    // 3. 修改原型 (Prototype)，这会影响所有基于方形网格的场景
    SquareGrid.prototype.measurePath = function (waypoints, options = {}) {

      // 调用原始方法获取 segments 结构
      const result = originalMeasurePath.call(this, waypoints, options);

      if (!result || !result.segments || result.segments.length === 0) return result;

      const d = canvas.dimensions;
      let globalDiagonalCount = 0; // 全局斜向计数 (跨越多个线段累加)
      let runningTotal = 0;

      for (let i = 0; i < result.segments.length; i++) {
        const s = result.segments[i];
        const p0 = waypoints[i];
        const p1 = waypoints[i + 1];

        if (!p0 || !p1) continue;

        // 计算像素差
        const dxPixels = p1.x - p0.x;
        const dyPixels = p1.y - p0.y;

        // 转换为格子数
        const nx = Math.round(Math.abs(dxPixels) / d.size);
        const ny = Math.round(Math.abs(dyPixels) / d.size);

        // 计算直行和斜行步数
        const diagonalSteps = Math.min(nx, ny);
        const straightSteps = Math.abs(ny - nx);

        // === 核心计费逻辑 (1-2-2-2...) ===
        // 每步斜向按 2 计算，第一步全局斜向扣除 1 (即 1-2-2-2 逻辑)
        let segGridCost = straightSteps + (diagonalSteps * 2);
        if (globalDiagonalCount === 0 && diagonalSteps > 0) {
          segGridCost -= 1;
        }
        globalDiagonalCount += diagonalSteps;

        // 提取地形倍率 (Terrain Factor)
        const standardGeometricSteps = Math.max(nx, ny);
        let terrainMultiplier = 1;

        if (standardGeometricSteps > 0 && typeof s.cost === "number") {
          terrainMultiplier = s.cost / standardGeometricSteps;
        }

        // 计算距离数值
        const finalSegCost = segGridCost * terrainMultiplier;
        const finalSegDistance = finalSegCost * d.distance;

        // 回写数据
        s.distance = finalSegDistance;
        if (typeof s.cost !== "undefined") {
          s.cost = finalSegCost;
        }

        // 更新显示的标签
        s.label = String(Math.round(finalSegDistance * 100) / 100);

        runningTotal += finalSegDistance;
      }

      // 更新总结果
      result.distance = runningTotal;
      if (typeof result.totalDistance !== "undefined") result.totalDistance = runningTotal;

      return result;
    };


    // ==========================================
    //  第二部分：测量尺 (快捷键 R) 的表现层劫持补丁
    // ==========================================
    // V13 中，独立的测量标尺 (Ruler) 被设计为测量纯物理距离，完全绕过了 measurePath
    // 这导致它会产生 0.5 这样的小数，且不受 1-2-2-2 规则约束。
    // 我们在此拦截标尺生成数字标签的函数，提取它的坐标，重新计算！
    if (CONFIG.Canvas?.rulerClass?.prototype?._getWaypointLabelContext) {
      const originalGetLabel = CONFIG.Canvas.rulerClass.prototype._getWaypointLabelContext;

      CONFIG.Canvas.rulerClass.prototype._getWaypointLabelContext = function (waypoint, state) {
        // 先获取原生渲染上下文
        const context = originalGetLabel.call(this, waypoint, state);
        if (!context) return context;

        // 提取测量尺画出的所有路径点 (V13 API 存在 this.path 中)
        const points = this.path || [];
        if (points.length < 2) return context;
        const d = canvas.dimensions;
        let globalDiagonalCount = 0;
        let runningTotalGrid = 0;// 只记录纯格子数，延迟做乘法

        // 重新遍历路径，用侠界之旅的 1-2-2-2 逻辑强制覆写
        for (let i = 0; i < points.length - 1; i++) {
          const p0 = points[i];
          const p1 = points[i + 1];

          // 和 token 移动一样，通过除以 d.size 并取整 (Math.round)，
          // 强制将任何 0.5 格子这类的“物理距离”坍缩为整数“逻辑格子步数”
          const dxPixels = p1.x - p0.x;
          const dyPixels = p1.y - p0.y;
          const nx = Math.round(Math.abs(dxPixels) / d.size);
          const ny = Math.round(Math.abs(dyPixels) / d.size);

          const diagonalSteps = Math.min(nx, ny);
          const straightSteps = Math.abs(ny - nx);

          let segGridCost = straightSteps + (diagonalSteps * 2);
          if (globalDiagonalCount === 0 && diagonalSteps > 0) {
            segGridCost -= 1;
          }
          globalDiagonalCount += diagonalSteps;
          // 累加距离 (独立 Ruler 不算地形影响，直接乘以单位距离)
          runningTotalGrid += segGridCost;
          // 当算到当前需要显示的那个坐标节点时，拦截并替换它的显示文本
          if (Math.abs(p1.x - waypoint.x) < 1 && Math.abs(p1.y - waypoint.y) < 1) {
            const finalDist = Math.round((runningTotalGrid * d.distance) * 100) / 100;
            if (context.distance && typeof context.distance === "object") {
              context.distance.total = String(finalDist); // 修改内部的值
            } else {
              // 兼容兜底：万一它没生成对象，我们给它补上
              context.distance = { total: String(finalDist) };
            }

            // 同理，保留 text 和 label 的同步更新（如果有的话），防范其他插件读取
            if (context.label !== undefined) {
              const unit = canvas.grid.units ? ` ${canvas.grid.units}` : "";
              context.label = `${finalDist}${unit}`;
            }
            if (context.text !== undefined) {
              context.text = String(finalDist);
            }
            break;
          }
        }
        return context;
      };
    }

    console.log("XJZL | 已成功应用自定义距离移动计算。");
  }

  // 注销默认表单
  foundry.applications.apps.DocumentSheetConfig.unregisterSheet(ActiveEffect, "core", "ActiveEffectConfig");

  // 注册我们的表单
  foundry.applications.apps.DocumentSheetConfig.registerSheet(ActiveEffect, "xjzl-system", XJZLActiveEffectConfig, {
    makeDefault: true,
    label: "XJZL Active Effect Config"
  });

  // 替换系统核心的状态效果列表
  CONFIG.statusEffects = CONFIG.XJZL.statusEffects;

  // 修改世界时间配置
  CONFIG.time.roundTime = 2; // 设置 1 轮 = 2 秒 (我们侠界是这么快的)

  // 1. 配置 Combat 先攻设置
  CONFIG.Combat.initiative = {
    // 这里填你的先攻公式字符串
    // @attributes.shenfa.value 必须能通过 actor.getRollData() 访问到
    formula: "1d20 + @init",
    decimals: 2 // 出现平局时保留2位小数
  };

  // 2. 注册自定义 Document 类 (逻辑层)
  // 告诉 Foundry 使用我们需要扩展的类，而不是默认的 Actor/Item
  CONFIG.Actor.documentClass = XJZLActor;
  CONFIG.Item.documentClass = XJZLItem;
  // 注册 ActiveEffect 类，用来处理装备的自动抑制和其他我们自定义的AE规则
  CONFIG.ActiveEffect.documentClass = XJZLActiveEffect;

  // 3. 注册 DataModels (数据层) - V13 核心
  // 将 system.json 中定义的类型与 JS 类绑定
  CONFIG.Actor.dataModels = {
    character: XJZLCharacterData,
    npc: XJZLCharacterData,
    creature: XJZLCreatureData,
    container: XJZLContainerData
  };

  CONFIG.Item.dataModels = {
    neigong: XJZLNeigongData,
    wuxue: XJZLWuxueData, // 注册武学数据
    weapon: XJZLWeaponData,
    armor: XJZLArmorData,
    qizhen: XJZLQizhenData,
    consumable: XJZLConsumableData,
    manual: XJZLManualData,
    misc: XJZLMiscData,
    art_book: XJZLArtBookData,
    personality: XJZLPersonalityData,
    background: XJZLBackgroundData,
    trait: XJZLTraitData,
    encounter: XJZLEncounterData
  };

  // 4. 注册 Sheets (表现层)
  // 使用命名空间访问 Actors 集合
  const Actors = foundry.documents.collections.Actors;
  // 使用命名空间访问 V1 ActorSheet (用于注销)
  const ActorSheet = foundry.applications.sheets.ActorSheet;
  // 注销默认 Sheet，注册我们需要用来渲染的 AppV2 Sheet
  Actors.unregisterSheet("core", ActorSheet);

  // 注意：V13 中虽然推荐 AppV2，但注册方式仍需兼容 DocumentSheetConfig
  Actors.registerSheet("xjzl-system", XJZLCharacterSheet, {
    types: ["character", "npc"],
    makeDefault: true,
    label: "XJZL.Sheet.Character"
  });

  Actors.registerSheet("xjzl-system", XJZLCreatureSheet, {
    types: ["creature"],
    makeDefault: true,
    label: "XJZL.Sheet.Creature"
  });

  Actors.registerSheet("xjzl-system", XJZLContainerSheet, {
    types: ["container"],
    makeDefault: true,
    label: "XJZL.Sheet.Container"
  });

  // ---注册 Item Sheet ---
  // 使用命名空间访问 Items 集合
  const Items = foundry.documents.collections.Items;
  // 使用命名空间访问 V1 ItemSheet (用于注销)
  const ItemSheet = foundry.applications.sheets.ItemSheet;
  Items.unregisterSheet("core", ItemSheet);
  // 注册内功表单
  Items.registerSheet("xjzl-system", XJZLNeigongSheet, {
    types: ["neigong"],
    makeDefault: true,
    label: "XJZL.Sheet.Neigong"
  });

  // 注册武学表单
  Items.registerSheet("xjzl-system", XJZLWuxueSheet, {
    types: ["wuxue"],
    makeDefault: true,
    label: "XJZL.Sheet.Wuxue"
  });

  // 注册装备表单 (复用同一个类)
  Items.registerSheet("xjzl-system", XJZLEquipmentSheet, {
    types: ["weapon", "armor", "qizhen"], // 同时绑定三种类型
    makeDefault: true,
    label: "XJZL.Sheet.Equipment" // 记得在 zh-cn.json 里加这个 label
  });

  // 注册物品表单
  Items.registerSheet("xjzl-system", XJZLGeneralItemSheet, {
    types: ["consumable", "manual", "misc"],
    makeDefault: true,
    label: "XJZL.Sheet.GeneralItem"
  });

  //注册技艺书籍
  Items.registerSheet("xjzl-system", XJZLArtBookSheet, {
    types: ["art_book"],
    makeDefault: true,
    label: "XJZL.Sheet.ArtBook"
  });

  //注册性格特质
  Items.registerSheet("xjzl-system", XJZLPersonalitySheet, {
    types: ["personality"],
    makeDefault: true,
    label: "XJZL.Sheet.Personality"
  });

  //注册身世背景
  Items.registerSheet("xjzl-system", XJZLBackgroundSheet, {
    types: ["background"],
    makeDefault: true,
    label: "XJZL.Sheet.Background"
  });

  //注册特性/特效
  Items.registerSheet("xjzl-system", XJZLTraitSheet, {
    types: ["trait"],
    makeDefault: true,
    label: "XJZL.Sheet.Trait"
  });

  // 战局使用专用 Sheet，避免通用 Item Sheet 暴露无关字段。
  Items.registerSheet("xjzl-system", XJZLEncounterSheet, {
    types: ["encounter"],
    makeDefault: true,
    label: "XJZL.Sheet.Encounter"
  });

  // ==========================================
  //  5.注册 常用Handlebars 辅助函数
  // ==========================================

  registerHandlebarsHelpers();

  // 预加载 Handlebars 模板,必须等待预加载完成
  await preloadHandlebarsTemplates();

  // ==========================================
  //  6.注册 配置菜单
  // ==========================================
  // 是否隐藏敌对阵营自动发送卡片中的规则详情
  game.settings.register("xjzl-system", "hideHostileChatDetails", {
    name: game.i18n.localize("XJZL.Settings.HideHostileChatDetails.Name"),
    hint: game.i18n.localize("XJZL.Settings.HideHostileChatDetails.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false
  });

  // 是否允许玩家使用伤害与治疗工具
  game.settings.register("xjzl-system", "allowPlayerDamageTool", {
    name: "允许玩家使用伤害与治疗工具",
    hint: "如果开启，玩家也能在左侧 Token 工具栏看到并使用【通用伤害与治疗工具】。通常仅供 GM 或可信赖的助手使用。",
    scope: "world",      // 这是一个世界级设置，所有客户端同步
    config: true,        // 显示在设置菜单中
    type: Boolean,
    default: true,      // 默认开启，关闭则仅GM可用
    requiresReload: true // 修改后刷新页面生效
  });

  // 是否启用 Alt+左键 快速选择目标
  game.settings.register("xjzl-system", "enableAltTargeting", {
    name: "启用快速选择目标 (Alt + 左键)",
    hint: "开启后，按住 Alt 键并左键点击 Token，可以快速选择目标（增量选择）。",
    scope: "client",     // 客户端级设置，每个玩家可以自己决定是否开启
    config: true,        // 显示在设置菜单中
    type: Boolean,
    default: true,       // 默认开启
    requiresReload: false // 不需要刷新，即改即生效
  });

  // 伤害工具与状态盘读取目标的方式：框选（画布选中）还是瞄准（Alt+左键）
  game.settings.register("xjzl-system", "targetSelectionMode", {
    name: "目标选择模式",
    hint: "通用伤害工具与状态盘读取目标的方式：框选 = 读取画布当前选中的 Token；瞄准 = 读取 Alt+左键 瞄准的目标。可在工具窗口内直接切换。",
    scope: "client",     // 每个玩家可以自己决定习惯的目标选取方式
    config: false,       // 仅在工具窗口内切换，不暴露到设置菜单
    type: String,
    choices: {
      controlled: "框选（画布选中）",
      targeted: "瞄准（Alt+左键）"
    },
    default: "controlled",
    requiresReload: false
  });

  // 是否播放江湖万卷阁的抽取演出
  game.settings.register("xjzl-system", "enableCompendiumDrawAnimation", {
    name: "启用江湖万卷阁抽取动画",
    hint: "开启后，抽取物品时会播放全屏显形演出；关闭后将直接把抽取结果发送到聊天栏。",
    scope: "client",      // 演出偏好由每位玩家自行决定
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false // 抽取时即时读取，无需刷新
  });

  // 江湖万卷阁：排序偏好（客户端持久化，在浏览器统计条内切换，不进设置菜单）
  game.settings.register("xjzl-system", "compendiumBrowserSort", {
    name: "万卷阁排序偏好",
    hint: "江湖万卷阁卡片列表的排序方式，可在浏览器右上角切换。",
    scope: "client",
    config: false,
    type: String,
    choices: {
      name: "名称",
      "quality-desc": "品质降序",
      "quality-asc": "品质升序"
    },
    default: "name",
    requiresReload: false
  });

  // 江湖万卷阁：视图偏好（紧凑列表 / 图鉴网格，客户端持久化）
  game.settings.register("xjzl-system", "compendiumBrowserView", {
    name: "万卷阁视图偏好",
    hint: "江湖万卷阁卡片列表的呈现形态（简洁列表 / 图鉴网格）。",
    scope: "client",
    config: false,
    type: String,
    choices: {
      compact: "简洁列表",
      grid: "图鉴网格"
    },
    default: "compact",
    requiresReload: false
  });

  // 是否允许玩家使用状态选取器
  game.settings.register("xjzl-system", "allowPlayerEffectPicker", {
    name: "允许玩家使用状态选取器",
    hint: "开启后，玩家可以在 Token 工具栏看到【状态选取器】，并能查看场景内公开的特效。",
    scope: "world",
    config: true,
    type: Boolean,
    default: true, // 默认开启，关闭则仅GM可用
    requiresReload: true
  });

  // 是否在聊天栏显示状态变更
  game.settings.register("xjzl-system", "showEffectChatCards", {
    name: "在聊天栏显示状态变更",
    hint: "开启后，当角色获得、叠加或移除状态特效时，会在聊天栏发送一张提示卡片。",
    scope: "world",      // 这是一个世界级设置，全部人同步
    config: true,        // 显示在设置菜单中
    type: Boolean,
    default: false,      // 默认不开启
    requiresReload: false
  });

  // --- 野兽伤害规则设置 ---

  // 1. 计算模式
  game.settings.register("xjzl-system", "creatureDamageMode", {
    name: "野兽伤害计算模式",
    hint: "定义野兽受到伤害时如何扣除体力。\n规则书模式: 伤害>防护值，固定扣1点。\n倍率模式: 伤害越高，扣除体力越多。",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "strict": "规则书模式 (固定 1 点)",
      "scaling": "倍率模式 (基于伤害量)"
    },
    default: "strict", // 默认遵从规则书
    requiresReload: false
  });

  // 2. 倍率阈值 (仅在倍率模式下生效)
  game.settings.register("xjzl-system", "creatureDamageScaling", {
    name: "野兽伤害倍率阈值",
    hint: "仅在倍率模式下生效。计算公式: 体力损失 = 向下取整( 伤害 / Max(防护, 阈值) )。\n例如设为10: 伤害35打防护0的野兽 -> 35/10=3体力; 打防护20的野兽 -> 35/20=1体力。",
    scope: "world",
    config: true,
    type: Number,
    default: 10, // 默认每 10 点溢出伤害扣 1 体力
    requiresReload: false
  });

  // 是否打开动作计数器
  game.settings.register("xjzl-system", "enableActionTracker", {
    name: "开启战斗动作计数器",
    hint: "在屏幕上显示当前选中角色的动作状态（主/次/反/简），并在出招和回合开始时自动扣除/重置。",
    scope: "world", // 世界级别，GM统一开关
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  // 是否打开音阶追踪器
  game.settings.register("xjzl-system", "enableToneTracker", {
    name: "开启五声音阶追踪器",
    hint: "在屏幕左上角显示五声音阶面板，支持手动快捷记录、轮换与推入。",
    scope: "world", // 世界级别，GM统一开关
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  // 是否解除目盲视野遮挡
  game.settings.register("xjzl-system", "disableBlindVision", {
    name: "解除目盲视野遮挡",
    hint: "默认开启。开启后，赋予角色“目盲”状态时，不会触发 Foundry VTT 底层默认的 Token 视野完全变黑机制。关闭则保留系统原生行为。",
    scope: "world",      // 世界级设置，保持全场统一
    config: true,        // 显示在设置菜单中
    type: Boolean,
    default: true,       // 默认阻止 FVTT 的自带效果
    requiresReload: true // 因为涉及核心 CONFIG 变量的修改，需要刷新页面生效
  });

  // 是否启用战斗统计
  game.settings.register("xjzl-system", "enableCombatStats", {
    name: "开启战斗统计系统",
    hint: "开启后，系统将在战斗中精确记录伤害、治疗、承受伤害、闪避、看破以及资源消耗情况。",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  // 隐形的持久化数据库，不在设置面板显示，专门用于存储战斗统计数据
  game.settings.register("xjzl-system", "combatStatsStorage", {
    name: "战斗统计缓存",
    hint: "开启后，将会在GM刷新之后也保存之前的战斗记录，但需要注意仅仅会在战斗开始与结束的瞬间保存。",
    scope: "world",     // 仅GM有权限写入世界级设置
    config: false,      // false: 不在系统的设置弹窗中显示给玩家看
    type: Object,       // 允许保存对象类型
    default: { active: null, history: [] }
  });
});

Hooks.once("setup", () => {
  // 读取系统设置，判断是否需要移除默认的盲目视野关联
  const disableBlind = game.settings.get("xjzl-system", "disableBlindVision");

  if (disableBlind) {
    if (CONFIG.specialStatusEffects.BLIND === "blind") {
      CONFIG.specialStatusEffects.BLIND = null;
    }
  }
});

// 在 Hooks.once("init") 之后的合适位置，添加这个钩子
Hooks.once("socketlib.ready", () => {
  setupSocket();
});

/** 战局 Item 使用统一内部图标，Sheet 不提供图片编辑入口。 */
Hooks.on("preCreateItem", (item) => {
  if (item.type === "encounter") item.updateSource({ img: "icons/svg/combat.svg" });
});

/* -------------------------------------------- */
/*  Ready Hook (就绪钩子)                        */
/* -------------------------------------------- */

Hooks.once("ready", async function () {
  // 等待系统完全加载后的操作，比如处理设置、欢迎弹窗等
  // 监听聊天消息渲染，绑定按钮事件
  Hooks.on("renderChatMessageHTML", ChatCardManager.onRenderChatMessage);
  //目标选择管理器，修改为按下ALT后左键点击选择目标
  TargetManager.init();

  //为了避免isGM没有初始化读取失败，把API容器的定义挪到这里
  // 1. 初始化全局 API 容器
  // 注意：防止重复定义，先判断是否存在
  if (!game.xjzl) game.xjzl = {};

  // --- 实例化合集浏览器 ---
  const compendiumBrowser = new XJZLCompendiumBrowser();
  // 自动开始构建索引
  compendiumBrowser.loadData();

  // 2. 挂载通用 API (所有玩家可用)
  game.xjzl = {
    api: {
      // 将来可能有其他 API，所以这里放 effects 子命名空间
      effects: ActiveEffectManager //这样就可以调用 game.xjzl.api.effects.addEffect
    }
  };

  // 合集浏览器实例供目录入口和宏复用。
  game.xjzl.compendiumBrowser = compendiumBrowser;
  // Socket 引用供系统内需要 GM 权限的客户端请求使用。
  game.xjzl.socket = xjzlSocket;
  // 保留 encounters 作为兼容 API，仅暴露战局 HUD 的稳定打开与关联入口。
  game.xjzl.encounters = {
    open: (combat = game.combat) => EncounterRuntimeApp.open(combat),
    link: (combat = game.combat) => EncounterManager.chooseEncounter(combat)
  };
  // 对外保留原有可扩展应用类入口。
  game.xjzl.applications = {
    XJZLCompendiumBrowser
  };

  // 伤害工具宏只依赖稳定的纯数据入口，不暴露窗口实例或内部状态。
  game.xjzl.damageTool = {
    executePreset: preset => GenericDamageTool.executePreset(preset)
  };

  game.xjzl.Macros = XJZLMacros;

  // 3. 挂载 GM 专用 API (生成器)
  // 此时 game.user 已经不是 null 了，可以安全检查权限
  if (game.user.isGM) {
    game.xjzl.seed = SeedingManager;
  }

  // 4·加载动作计数器
  if (game.settings.get("xjzl-system", "enableActionTracker")) {
    ActionTracker.init();
  }

  // 5·加载音阶计数器
  if (game.settings.get("xjzl-system", "enableToneTracker")) {
    ToneTracker.init();
  }

  // 6·加载战斗统计工具
  if (game.settings.get("xjzl-system", "enableCombatStats")) {
    CombatStatsManager.init();
    CombatMeterUI.init();
    await CombatStatsManager.ready();
  }


  // 7·背景赠品自动化 — 监听物品创建/删除
  Hooks.on("createItem", async (item, options, userId) => {
    if (userId !== game.user.id) return;
    if (item.type !== "background") return;
    const actor = item.parent;
    if (!actor || actor.type === "container") return;
    if (item.getFlag("xjzl-system", "_wizardCreated")) return;

    const assetsText = item.system.assets;
    if (!assetsText) return;

    const parsed = parseBackgroundAssets(assetsText);
    if (parsed.items.length === 0 && parsed.silver === 0) return;

    const resolved = await resolveBackgroundItems(parsed.items);
    for (const r of resolved) {
      if (!r.found) console.warn(`XJZL | 背景 "${item.name}" 赠品 "${r.name}" 在合集包中未找到`);
    }

    await grantAndTrack(actor, resolved.filter(r => r.found), parsed.silver, item.id);
  });

  Hooks.on("deleteItem", async (item, options, userId) => {
    if (userId !== game.user.id) return;
    if (item.type !== "background") return;
    const actor = item.parent;
    if (!actor || actor.type === "container") return;

    const assetsText = item.system?.assets || "";
    const silver = parseBackgroundAssets(assetsText).silver;
    const grantToken = item.getFlag("xjzl-system", "grantToken");
    await revokeBackgroundGrants(actor, item.id, silver, grantToken);
  });

  // 8·门派赠品自动化 — 监听角色门派变更
  Hooks.on("updateActor", async (actor, changes, options, userId) => {
    if (userId !== game.user.id) return;
    if (actor.type === "container" || actor.type === "creature") return;

    const newSect = foundry.utils.getProperty(changes, "system.info.sect");
    if (newSect === undefined) return;  // 门派未变更
    // 向导流程中由向导手动处理，跳过自动发放
    if (actor.getFlag("xjzl-system", "_wizardActive")) return;

    // 先清理旧门派的赠品
    await revokeAllSectGrants(actor);
    // 发放新门派赠品（none 或空字符串跳过）
    if (newSect && newSect !== "none") {
      await grantSectAssets(actor, newSect);
    }
  });

  console.log("XJZL | 门派赠品自动化已就绪");
  console.log("XJZL | 背景赠品自动化已就绪");
  console.log("侠界之旅系统 - 准备就绪");
});

//  在 getSceneControlButtons 阶段注入按钮
Hooks.on('getSceneControlButtons', (controls) => {

  // 检查权限
  const isGM = game.user.isGM;
  const allowPlayer = game.settings.get("xjzl-system", "allowPlayerDamageTool");

  // 如果既不是GM，也没有开启玩家权限，直接退出
  if (!isGM && !allowPlayer) return;

  // 只有 GM，或者设置允许玩家使用时，才显示
  const damageToolBtn = {
    name: "damage-tool",
    title: "XJZL.UI.DamageTool.Title",
    icon: "fas fa-meteor",
    visible: true,
    button: true,
    // V13 必须使用 onChange，废弃 onClick
    onChange: () => {
      // 单例模式：查找或新建
      const existingApp = Object.values(ui.windows).find(
        (app) => app.options.id === "xjzl-damage-tool"
      );
      if (existingApp) {
        existingApp.render(true, { focus: true });
      } else {
        // 确保 GenericDamageTool 已被导入
        new GenericDamageTool().render(true);
      }
    }
  };

  // --- 步骤 1: 查找 Token 控制层级 (严格参考你的 QTE 代码逻辑) ---
  let tokenLayer = null;

  // V13 模式: controls 是对象，直接通过属性访问
  if (controls.token) {
    tokenLayer = controls.token; // 注意：V13 有时是 controls.token 而不是 controls.tokens，但你的参考代码用了 tokens，如果是 tokens 请看下一行
  }
  else if (controls.tokens) {
    tokenLayer = controls.tokens; // 兼容 controls.tokens 的写法
  }
  // 兼容 Map 结构 (V13 的某些构建版本)
  else if (controls instanceof Map && controls.has('token')) {
    tokenLayer = controls.get('token');
  }

  // --- 步骤 2: 注入按钮到控制层 ---
  if (tokenLayer) {
    const tools = tokenLayer.tools;

    // 情况 A: V13 Map/Object 结构
    if (tools && !Array.isArray(tools)) {
      // 如果是 Map 类型
      if (tools instanceof Map) {
        if (!tools.has('damage-tool')) {
          tools.set('damage-tool', damageToolBtn);
        }
      }
      // 如果是普通 Object 类型
      else {
        // 防止重复添加 (虽然 Object Key 本身就防重复，但为了逻辑严谨)
        if (!tools['damage-tool']) {
          tokenLayer.tools['damage-tool'] = damageToolBtn;
        }
      }
    }
    // 情况 B: 数组结构 (V12 或 V13 早期)
    // 既然你的 QTE 代码里保留了这个分支且能运行，我们为了稳妥也保留它
    else if (Array.isArray(tools)) {
      if (!tools.some(t => t.name === 'damage-tool')) {
        tools.push(damageToolBtn);
      }
    }
  } else {
    console.warn("XJZL | 无法找到 Token 控制层级，按钮添加失败。");
  }

  // 2. 状态选取器逻辑
  const allowPicker = game.settings.get("xjzl-system", "allowPlayerEffectPicker");

  if (isGM || allowPicker) {
    const effectPickerBtn = {
      name: "effect-picker",
      title: "状态选取器 (Effect Picker)",
      icon: "fas fa-hand-sparkles", // 找一个好看的图标
      visible: true,
      button: true,
      onChange: () => {
        // 单例模式：查找或新建
        const existingApp = Object.values(ui.windows).find(
          (app) => app.options.id === "xjzl-effect-picker"
        );

        if (existingApp) {
          existingApp.actor = null;
          existingApp.render(true, { focus: true });
        } else {
          // 这里不再需要传 actor 参数，因为它是全局的
          new EffectSelectionDialog().render(true);
        }
      }
    };

    // 注入逻辑 (复用你现有的稳健代码)
    let tokenLayer = null;
    if (controls.token) tokenLayer = controls.token;
    else if (controls.tokens) tokenLayer = controls.tokens;
    else if (controls instanceof Map && controls.has('token')) tokenLayer = controls.get('token');

    if (tokenLayer) {
      const tools = tokenLayer.tools;
      if (tools instanceof Map) {
        if (!tools.has('effect-picker')) tools.set('effect-picker', effectPickerBtn);
      } else if (Array.isArray(tools)) {
        if (!tools.some(t => t.name === 'effect-picker')) tools.push(effectPickerBtn);
      } else if (tools && !tools['effect-picker']) {
        tokenLayer.tools['effect-picker'] = effectPickerBtn;
      }
    }
  }

  // 3·战斗统计面板
  if (game.settings.get("xjzl-system", "enableCombatStats")) {
    const meterBtn = {
      name: "combat-meter",
      title: "战斗统计 (Details)",
      icon: "fas fa-chart-bar", // 柱状图图标
      visible: true,
      button: true, // 点击型按钮
      onChange: () => {
        // 直接通过单例实例来控制开关
        const app = CombatMeterUI.instance;
        if (app) {
          if (app.rendered) {
            app.close();
          } else {
            app.render({ force: true });
          }
        }
      }
    };

    if (tokenLayer) {
      const tools = tokenLayer.tools;
      if (tools instanceof Map) {
        if (!tools.has('combat-meter')) tools.set('combat-meter', meterBtn);
      } else if (Array.isArray(tools)) {
        if (!tools.some(t => t.name === 'combat-meter')) tools.push(meterBtn);
      } else if (tools && !tools['combat-meter']) {
        tokenLayer.tools['combat-meter'] = meterBtn;
      }
    }
  }

  // 4·注入 AOE Creator 按钮 
  // 1. 查找 templates 层级 (测量工具在代码里叫 templates)
  let templateLayer = null;

  // 仿照你处理 tokenLayer 的方式
  if (controls.templates) {
    templateLayer = controls.templates;
  }
  else if (controls instanceof Map && controls.has('templates')) {
    templateLayer = controls.get('templates');
  }
  else if (Array.isArray(controls)) {
    templateLayer = controls.find(c => c.name === "templates");
  }

  // 2. 注入按钮
  if (templateLayer) {
    const aoeBtn = {
      name: "xjzl-aoe",
      title: "创建效果区域（距离计算按照侠界之旅规则）",
      icon: "fas fa-bullseye",
      visible: true,
      button: true, // 关键：这是点击型按钮
      onChange: () => {
        const existingApp = Object.values(ui.windows).find(
          (app) => app.options.id === "xjzl-aoe-creator"
        );
        if (existingApp) {
          existingApp.render(true, { focus: true });
        } else {
          new AOECreator().render(true);
        }
      }
    };

    const tools = templateLayer.tools;

    // 3. 处理 tools 集合 (严格仿照你原本的 tools 处理逻辑)

    // 情况 A: Map 结构
    if (tools instanceof Map) {
      if (!tools.has('xjzl-aoe')) {
        tools.set('xjzl-aoe', aoeBtn);
      }
    }
    // 情况 B: 数组结构
    else if (Array.isArray(tools)) {
      if (!tools.some(t => t.name === 'xjzl-aoe')) {
        tools.push(aoeBtn);
      }
    }
    // 情况 C: 普通对象结构 (Object)
    else if (tools) {
      if (!tools['xjzl-aoe']) {
        templateLayer.tools['xjzl-aoe'] = aoeBtn;
      }
    }
  }
});

/* -------------------------------------------- */
/*  Token HUD 改造（实现左键叠层，右键减少层）     */
/* -------------------------------------------- */
Hooks.on("renderTokenHUD", (app, html, data) => {
  const actor = app.object.actor;
  if (!actor) return;

  const element = html instanceof HTMLElement ? html : html[0];
  const statusIcons = element.querySelectorAll(".status-effects .effect-control");

  statusIcons.forEach((icon) => {
    const slug = icon.dataset.statusId;
    const statusData = CONFIG.statusEffects.find(e => e.id === slug);
    if (!statusData) return;

    // 克隆节点移除旧事件
    const newIcon = icon.cloneNode(true);

    // 绑定左键 (添加/叠层)
    newIcon.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      // 深拷贝数据，避免污染 CONFIG
      const dataToAdd = foundry.utils.deepClone(statusData);
      await game.xjzl.api.effects.addEffect(actor, dataToAdd);
    });

    // 绑定右键 (减层/移除)
    newIcon.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await game.xjzl.api.effects.removeEffect(actor, slug, 1);
    });

    icon.replaceWith(newIcon);
  });
});

/**
 * 渲染物品目录侧边栏钩子
 * 用于注入 "江湖万卷阁" 按钮
 */
Hooks.on("renderItemDirectory", (app, html, data) => {
  // 1. V13 兼容性处理：确保获取原生 DOM 元素
  const element = html instanceof HTMLElement ? html : html[0];

  // 2. 查找插入点 (.header-actions)
  const headerActions = element.querySelector(".header-actions");
  if (!headerActions) return;

  // 3. 创建按钮 (使用原生 DOM API)
  const button = document.createElement("button");
  button.type = "button"; // 防止意外提交表单
  button.className = "xjzl-browser-btn";
  // 直接写内联样式，或者你在 css 文件里写类名
  button.style.cssText = "min-width: 96%; margin: 0 2% 5px 2%; display: flex; align-items: center; justify-content: center; gap: 5px;";
  button.innerHTML = '<i class="fas fa-book-open"></i> 江湖万卷阁';

  // 4. 绑定点击事件
  button.addEventListener("click", (ev) => {
    ev.preventDefault();
    // 调用我们在 ready 中挂载的单例
    if (game.xjzl?.compendiumBrowser) {
      game.xjzl.compendiumBrowser.render(true);
    } else {
      ui.notifications.warn("江湖万卷阁尚未初始化，请稍候...");
    }
  });

  // 5. 插入到界面中 (headerActions 之后)
  headerActions.after(button);
});

/**
 * 渲染合集包目录侧边栏钩子
 * 用于注入 "江湖万卷阁" 按钮
 */
Hooks.on("renderCompendiumDirectory", (app, html, data) => {
  const element = html instanceof HTMLElement ? html : html[0];
  const headerActions = element.querySelector(".header-actions");
  if (!headerActions) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "xjzl-browser-btn";
  button.style.cssText = "min-width: 96%; margin: 0 2% 5px 2%; display: flex; align-items: center; justify-content: center; gap: 5px;";
  button.innerHTML = '<i class="fas fa-book-open"></i> 江湖万卷阁';

  button.addEventListener("click", (ev) => {
    ev.preventDefault();
    if (game.xjzl?.compendiumBrowser) {
      game.xjzl.compendiumBrowser.render(true);
    } else {
      ui.notifications.warn("江湖万卷阁尚未初始化，请稍候...");
    }
  });

  headerActions.after(button);
});

/**
 * 渲染角色目录时的钩子
 * 作用：对玩家隐藏 "container" 类型的 Actor，避免侧边栏剧透
 */
Hooks.on("renderActorDirectory", (app, html, data) => {
  // 1. GM 始终可见所有，直接跳过
  if (game.user.isGM) return;

  // 2. 筛选需要隐藏的 Actor ID
  // 逻辑：类型是 container 且 当前用户不是 Owner (即 Observer 或 None)
  const hiddenActorIds = game.actors
    .filter(a => a.type === "container" && !a.isOwner)
    .map(a => a.id);

  // 3. 获取或创建样式标签
  const styleId = "xjzl-hide-containers";
  let styleElement = document.getElementById(styleId);

  // 如果没有需要隐藏的（比如玩家买了仓库，有了 Owner 权限），且样式标签存在，则清空它
  if (hiddenActorIds.length === 0) {
    if (styleElement) styleElement.innerText = "";
    return;
  }

  // 4. 构建 CSS 规则
  const selector = hiddenActorIds.map(id => `.directory-item[data-entry-id="${id}"]`).join(", ");
  const cssRule = `${selector} { display: none !important; }`;

  // 5. 比对内容
  // 只有当规则发生变化时（比如新发现了战利品），才操作 DOM
  if (!styleElement) {
    styleElement = document.createElement("style");
    styleElement.id = styleId;
    document.head.appendChild(styleElement);
  }

  if (styleElement.innerText !== cssRule) {
    styleElement.innerText = cssRule;
  }
});


/**
 * 监听聊天消息渲染钩子
 * 用于修复自定义 Loot Card 的拖拽功能
 */
Hooks.on("renderChatMessageHTML", (message, html) => {
  // html 参数现在直接就是 HTMLElement，不需要 jQuery 转换

  // 使用事件委托
  // 我们只给这一条消息的容器绑定一个监听器
  html.addEventListener("dragstart", (event) => {
    // 检查被拖动的元素是不是我们的 loot-item
    const target = event.target.closest(".loot-item[draggable='true']");

    if (target && target.dataset.dragData) {
      // 写入拖拽数据
      event.dataTransfer.setData("text/plain", target.dataset.dragData);
      event.dataTransfer.effectAllowed = "copy";

      // 阻止事件冒泡（可选，但在聊天栏里通常是个好习惯）
      event.stopPropagation();
    }
  });
});

/**
 * 统一的战斗状态流转监听(将战斗开始、回合开始、回合结束统一监听，避免竞争执行产生的错误)
 */
Hooks.on("updateCombat", async (combat, updateData, options, userId) => {
  // 战局副本、轮次或回合位置变化都会影响 HUD 的实时状态，所有客户端先行刷新显示。
  const shouldRefreshEncounter = ("round" in updateData)
    || ("turn" in updateData)
    || ("flags.xjzl-system.encounter" in updateData)
    || foundry.utils.hasProperty(updateData, "flags.xjzl-system.encounter");
  if (shouldRefreshEncounter) {
    Hooks.callAll("xjzl.encounterUpdated", combat);
  }

  // 1. 仅限主 GM 执行，防止多 GM 重复触发
  if (!game.users.activeGM?.isSelf) return;

  const isCombatStart = updateData.hasOwnProperty("round") && updateData.round === 1 && combat.previous.round === 0;
  const isTurnChange = ("turn" in updateData) || ("round" in updateData);
  const transition = {
    previousCombatantId: combat.previous.combatantId,
    currentCombatantId: combat.current.combatantId,
    previousRound: Number(combat.previous.round) || 0,
    currentRound: Number(combat.round) || 0,
    previousTurn: combat.previous.turn,
    currentTurn: combat.turn
  };

  // 如果既不是战斗开始，也不是轮次流转，直接返回
  if (!isCombatStart && !isTurnChange) return;

  // Combat 更新 Hook 可能在快速切换回合时重入；按 Combat 串行化可保证六阶段顺序。
  await EncounterManager.queueCombatUpdate(combat, updateData, async () => {
    if (isCombatStart && !EncounterManager.getState(combat)) {
      await EncounterManager.chooseEncounter(combat);
    }

    // 第 1 轮先完成系统进战，再结算战局 combatStart。
    if (isCombatStart) {
      console.log("XJZL | 战斗正式开始！正在触发所有参战者脚本...");
      await triggerCombatStartScripts(combat.combatants);
      await EncounterManager.runFieldTrigger(combat, "combatStart", { round: 1, turn: transition.currentTurn });
    }

    if (isTurnChange) {
      const prevId = transition.previousCombatantId;
      const currId = transition.currentCombatantId;
      const previousRound = transition.previousRound;
      const currentRound = transition.currentRound;
      const isNewRound = currentRound > previousRound;

      // 1-2. 上一个角色的系统与战局回合结束。
      if (prevId && !isCombatStart) {
        const prevCombatant = combat.combatants.get(prevId);
        if (prevCombatant?.actor) await _routeActorTurnScript(prevCombatant.actor, "turnEnd", "TurnEnd");
        await EncounterManager.runFieldTrigger(combat, "combatantTurnEnd", { combatant: prevCombatant, round: previousRound, turn: transition.previousTurn });
      }

      // 3. 只有自然进入下一轮时才结算上一轮结束。
      if (isNewRound && previousRound > 0) {
        await EncounterManager.runFieldTrigger(combat, "roundEnd", { round: previousRound, turn: transition.previousTurn });
      }

      // 4. 新轮开始先刷新支援额度，再按 Item 顺序混合结算三类轮初效果。
      if (isCombatStart || isNewRound) {
        await EncounterManager.resetRoundSupport(combat);
        await EncounterManager.runRoundStartTriggers(combat, { round: currentRound, turn: transition.currentTurn });
      }

      // 5-6. 当前角色的系统与战局回合开始。
      if (currId) {
        const currCombatant = combat.combatants.get(currId);
        if (currCombatant?.actor) await _routeActorTurnScript(currCombatant.actor, "turnStart", "TurnStart");
        await EncounterManager.runFieldTrigger(combat, "combatantTurnStart", { combatant: currCombatant, round: currentRound, turn: transition.currentTurn });
      }
    }

    for (const combatant of combat.combatants) {
      if (combatant.actor) await ActiveEffectManager.cleanExpiredEffects(combatant.actor);
    }
  });
});

/**
 * 监听新成员加入 (处理中途拖入 Token)
 * 作用对象：新加入的那一个 Combatant，用来补充上面的钩子无法触发在中途加入战斗的token的战斗开始触发脚本的问题
 */
Hooks.on("createCombatant", async (combatant, options, userId) => {
  if (!game.users.activeGM?.isSelf) return; // 仅主 GM 执行

  const combat = combatant.combat;

  // 只有当战斗“已经开始”后加入的人，才立即执行脚本
  // 如果战斗还在 Round 0，则不执行，等着上面那个 updateCombat 一起处理
  if (combat.round > 0) {
    console.log(`XJZL | 检测到中途加入战斗: ${combatant.name}`);
    await triggerCombatStartScripts([combatant]);
  }
});

/**
 * 在 V13 战斗追踪器中同步紧凑入口：先移除上次插入的控件，再按当前状态判断是否重建。
 * 每次渲染幂等清理，保证删除战斗、解绑或删除源战局后旧按钮不会残留。
 */
function renderEncounterTrackerControls(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const combat = app.viewed ?? game.combat;
  root.querySelectorAll(".xjzl-encounter-tracker-controls").forEach(node => node.remove());
  if (!combat) return;
  const state = EncounterManager.getState(combat);
  const controls = document.createElement("div");
  controls.className = "xjzl-encounter-tracker-controls";
  controls.dataset.combatId = combat.id;
  // 战斗关联的是源 Item 的独立快照副本，因此已关联入口只以 flag 状态为准，不依赖源 Item 是否仍存在。
  if (state?.status === "linked") {
    const battle = document.createElement("button");
    battle.type = "button";
    battle.className = "encounter-linked";
    battle.innerHTML = `<i class="fas fa-shield-halved"></i> ${game.i18n.localize("XJZL.Encounter.BattleSituation")}`;
    battle.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      EncounterRuntimeApp.open(combat);
    });
    controls.append(battle);
  } else if (game.user.isGM && (combat.round ?? 0) <= 0 && game.items.some(item => item.type === "encounter")) {
    const link = document.createElement("button");
    link.type = "button";
    link.innerHTML = `<i class="fas fa-link"></i> ${game.i18n.localize("XJZL.Encounter.LinkEncounter")}`;
    link.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      await EncounterManager.chooseEncounter(combat);
      app.render({ force: true });
    });
    controls.append(link);
  }
  if (!controls.childElementCount) return;
  const anchor = root.querySelector(".combat-tracker-header, header");
  if (anchor) anchor.insertAdjacentElement("afterend", controls);
  else root.prepend(controls);
}

Hooks.on("renderCombatTracker", renderEncounterTrackerControls);
Hooks.on("renderCombatTrackerHTML", renderEncounterTrackerControls);
// 删除战局 Item 时只清理“未关联”的失效按钮；已关联战斗持有独立快照副本，不受源 Item 删除影响。
// 保留 linked 按钮是为了让已关联战斗的战局副本继续可访问、可运行。
Hooks.on("deleteItem", item => {
  if (item.type !== "encounter" || item.parent) return;
  const hasRemainingEncounter = game.items.some(entry => entry.type === "encounter" && entry.id !== item.id);
  if (hasRemainingEncounter) return;
  for (const controls of document.querySelectorAll(".xjzl-encounter-tracker-controls")) {
    if (!controls.querySelector(".encounter-linked")) controls.remove();
  }
});
Hooks.on("updateCombatant", combatant => {
  if (combatant.combat) Hooks.callAll("xjzl.encounterUpdated", combatant.combat);
});
Hooks.on("deleteCombatant", combatant => {
  if (combatant.combat) Hooks.callAll("xjzl.encounterUpdated", combatant.combat);
});

/**
 * 执行战斗开始脚本，把公共部分抽象出来了
 * GM 路由：将每个 actor 的脚本路由到对应玩家端执行，如果无 owner 则在 GM 端执行
 */
async function triggerCombatStartScripts(combatants) {
  const promises = combatants.map(async (combatant) => {
    const actor = combatant.actor;
    if (!actor) return;

    const context = {
      combatant: combatant,
      combat: combatant.combat
    };

    const ownerUserId = actor.getFirstOwnerId();

    // 场景 A: NPC 无 owner 或玩家掉线 → GM 端直接执行
    if (!ownerUserId) {
      try {
        await actor.runScripts("combatStart", context);
      } catch (err) {
        console.error(`XJZL | [GM] 进战脚本执行错误 [${actor.name}]:`, err);
      }
      return;
    }

    // 场景 B: 在线玩家 → 路由到玩家端执行
    try {
      await xjzlSocket.executeForUsers(
        "runActorScript",
        [ownerUserId],
        actor.uuid,
        "combatStart",
        context
      );
    } catch (err) {
      console.error(`XJZL | 路由脚本执行失败 [${actor.name}]:`, err);
      // 路由失败时，GM 端兜底执行
      try {
        await actor.runScripts("combatStart", context);
      } catch (fallbackErr) {
        console.error(`XJZL | [GM兜底] 进战脚本执行错误 [${actor.name}]:`, fallbackErr);
      }
    }
  });

  await Promise.all(promises);
};

/**
 * 路由单个 actor 的回合脚本执行
 * 将 processRegen 和 runScripts 路由到对应玩家端执行
 * @param {Actor} actor - 目标 Actor
 * @param {string} trigger - 触发时机 (turnStart/turnEnd)
 * @param {string} regenTiming - processRegen 的时机 (TurnStart/TurnEnd)
 */
async function _routeActorTurnScript(actor, trigger, regenTiming) {
  const ownerUserId = actor.getFirstOwnerId();

  // 场景 A: NPC 无 owner 或玩家掉线 → GM 端直接执行
  if (!ownerUserId) {
    try {
      await actor.processRegen(regenTiming);
      await actor.runScripts(trigger, {});
    } catch (err) {
      console.error(`XJZL | [GM] ${trigger} 脚本执行错误 [${actor.name}]:`, err);
    }
    return;
  }

  // 场景 B: 在线玩家 → 路由到玩家端执行
  try {
    await xjzlSocket.executeForUsers(
      "runActorScriptWithRegen",
      [ownerUserId],
      actor.uuid,
      trigger,
      regenTiming
    );
  } catch (err) {
    console.error(`XJZL | 路由脚本执行失败 [${actor.name}]:`, err);
    // 路由失败时，GM 端兜底执行
    try {
      await actor.processRegen(regenTiming);
      await actor.runScripts(trigger, {});
    } catch (fallbackErr) {
      console.error(`XJZL | [GM兜底] ${trigger} 脚本执行错误 [${actor.name}]:`, fallbackErr);
    }
  }
}

// 应该没有必要浪费性能去实现这种功能
// 监听世界时间变化 (Seconds 变化)来清理过期AE
// 比如 GM 手动调整时间，或使用了 Calendar 模组
// Hooks.on("updateWorldTime", async (worldTime, dt) => {
//   if (!game.user.isGM) return;

//   // 性能优化：只检查当前场景中的 Actor
//   // 遍历画布上的所有 Token
//   const tokens = canvas.tokens.placeables;
//   for (const token of tokens) {
//     if (token.actor) {
//       await ActiveEffectManager.cleanExpiredEffects(token.actor);
//     }
//   }
// });

/**
 * 统一处理 Token 更新：名称/阵营变化刷新战局目标，位置变化同步“粘性”模板。
 */
Hooks.on("updateToken", (tokenDoc, change, options, userId) => {
  if (("name" in change) || ("disposition" in change)) {
    for (const combat of game.combats) {
      if (combat.scene?.id === tokenDoc.parent?.id && combat.combatants.some(combatant => combatant.tokenId === tokenDoc.id)) {
        Hooks.callAll("xjzl.encounterUpdated", combat);
      }
    }
  }

  // 1. 没有位移、非当前用户、场景未准备好，直接退出
  if (!canvas.ready) return;
  if (!change.x && !change.y) return;
  if (game.user.id !== userId) return;

  const scene = tokenDoc.parent;
  if (!scene) return;

  // 2. 场景里根本没有模板，直接退出 (避免无意义遍历)
  // V13 Collection 使用 .size
  if (scene.templates.size === 0) return;

  // 3. 预计算 Token 新中心点
  const gridSize = canvas.grid.size;
  // 使用 ?? 运算符处理 0 的情况
  const newX = change.x ?? tokenDoc.x;
  const newY = change.y ?? tokenDoc.y;

  const targetCenterX = newX + (tokenDoc.width * gridSize) / 2;
  const targetCenterY = newY + (tokenDoc.height * gridSize) / 2;

  // 4. 单次遍历查找并构建更新数据
  const directUpdates = [];

  // V13 推荐直接遍历 Collection
  for (const t of scene.templates) {
    // 快速检查 Flag
    const flags = t.flags["xjzl-system"]; // 直接访问属性比 getFlag 稍微快一点点
    if (!flags || flags.sourceToken !== tokenDoc.id || flags.sticky !== true) continue;

    // 检查是否真的需要更新
    // 如果位置差异小于 1 像素，视为未移动，跳过数据库更新
    if (Math.abs(t.x - targetCenterX) < 1 && Math.abs(t.y - targetCenterY) < 1) continue;

    const updateData = { _id: t.id, x: targetCenterX, y: targetCenterY };

    // ==========================================
    // 🌟 如果玩家权限不足，则交给Socket 委托
    // ==========================================
    // t.canUserModify 是 Foundry 底层 API，判断当前玩家能否直接改它
    if (t.canUserModify(game.user, "update")) {
      // 自己建的，或者 GM 操作：直接改，零延迟！
      directUpdates.push(updateData);
    } else {
      // 没权限（比如 GM 给玩家建的）：委托 Socket 让 GM 帮忙改，不报错！
      if (xjzlSocket) {
        xjzlSocket.executeAsGM("updateDocument", t.uuid, updateData);
      }
    }
  }

  // 5. 批量提交
  if (directUpdates.length > 0) {
    scene.updateEmbeddedDocuments("MeasuredTemplate", directUpdates);
  }
});

/**
 * 战斗删除后的统一收尾：先清理客户端战局 HUD/队列，再由删除发起者重置参战角色怒气。
 */
Hooks.on("deleteCombat", async (combat, options, userId) => {
  EncounterRuntimeApp.closeForCombat(combat);
  EncounterManager.cleanupCombat(combat);
  // 主动移除该战斗的追踪器入口，避免依赖 tracker 重渲染导致按钮残留。
  document.querySelectorAll(`.xjzl-encounter-tracker-controls[data-combat-id="${combat.id}"]`).forEach(node => node.remove());

  // 这里确保只让“触发删除操作的用户（通常是GM）”来执行数据库写操作，防止并发冲突。
  if (game.user.id !== userId) return;

  let hasUpdated = false;

  // 遍历战斗追踪器中的所有参战者
  for (const combatant of combat.combatants) {
    // combatant.actor 是一个智能指针，可以处理关联和非关联的问题
    const actor = combatant.actor;

    // 安全检查：角色存在，且有资源结构，且怒气大于 0
    if (actor && actor.system.resources?.rage?.value > 0) {

      // 执行更新
      await actor.changeResources({
        "system.resources.rage.value": 0
      }, {
        cause: "combatEnd",
        sourceActor: actor
      });
      hasUpdated = true;
    }
  }

  // 给予 GM 视觉反馈
  if (hasUpdated) {
    ui.notifications.info("脱离战斗：所有参战角色的怒气已自动清零。");
  }
});

/**
 * 处理 Token 删除
 */
Hooks.on("deleteToken", (tokenDoc, options, userId) => {
  if (game.user.id !== userId) return;

  const scene = tokenDoc.parent;
  if (!scene || scene.templates.size === 0) return;

  const idsToDelete = [];

  for (const t of scene.templates) {
    const flags = t.flags["xjzl-system"];
    if (flags && flags.sourceToken === tokenDoc.id && flags.autoDelete === true) {
      idsToDelete.push(t.id);
    }
  }

  if (idsToDelete.length > 0) {
    scene.deleteEmbeddedDocuments("MeasuredTemplate", idsToDelete);
  }
});

/**
 * 监听宏栏放置事件 (Hotbar Drop Hook)
 */
/**
 * 1. 同步钩子：负责拦截
 * 只要是 Item，立刻告诉 Foundry "你不许动，放着我来"，然后调用异步处理函数。
 */
Hooks.on("hotbarDrop", (bar, data, slot) => {

  // 只拦截 Item 类型，且必须包含 UUID
  if (data.type === "Item" && data.uuid) {
    // 不加 await，直接触发异步逻辑
    handleSystemMacro(data, slot);

    // 立刻返回 false，阻止 Foundry 生成默认宏
    return false;
  }

  // 其他类型（如 Actor, Journal）放行
  return true;
});

/**
 * 2. 异步处理函数：负责脏活累活
 */
async function handleSystemMacro(data, slot) {
  try {
    const uuid = data.uuid;
    // 从 data.data 中获取信息，避免查询数据库
    // 注意：item.toObject() 产生的数据结构中，type 在顶层
    const itemData = data.data || {};

    let name = data.name || itemData.name || "未命名";
    let img = itemData.img || "icons/svg/item-bag.svg";
    let command = "";

    // === 逻辑分流 ===

    // A. 招式 (Move)
    if (data.moveId) {
      command = `
// 招式宏: ${name}
const item = await fromUuid("${uuid}");
if (!item) return ui.notifications.warn("原物品已丢失");
if (typeof item.roll === "function") {
    await item.roll("${data.moveId}");
} else {
    ui.notifications.error("该物品无法执行招式，请检查系统版本或重新创建宏。");
}
`;
    }
    // B. 消耗品 (Consumable)
    // 检查 itemData.type (对应 item.type)
    else if (itemData.type === "consumable") {
      command = `
// 物品宏: ${name}
const item = await fromUuid("${uuid}");
if (!item) return ui.notifications.warn("原物品已丢失");
if (typeof item.use === "function") {
    await item.use();
} else {
    ui.notifications.error("该物品无法执行招式，请检查系统版本或重新创建宏。");
}
`;
    }
    // C. 其他物品 (发送详情)
    else {
      command = `
// 物品展示宏: ${name}
const item = await fromUuid("${uuid}");
if (item) item.postToChat();
`;
    }

    // === 创建宏 ===

    // 查重：找一个名字、指令都一样，且属于当前玩家的宏
    let macro = game.macros.find(m =>
      m.name === name &&
      m.command === command &&
      m.isOwner
    );

    if (!macro) {
      macro = await Macro.create({
        name: name,
        type: "script",
        img: img,
        command: command,
        flags: { "xjzl.macro": true }
      });
    }

    // 分配
    await game.user.assignHotbarMacro(macro, slot);
    console.log("XJZL | 宏创建成功:", name);

  } catch (err) {
    console.error("XJZL | 宏创建失败:", err);
    ui.notifications.error("宏创建失败，请按F12查看控制台报错");
  }
}

/**
 * 在物品创建前进行预处理
 * 用于解决从角色身上拖拽已装备物品到物品栏时，状态依然是"已装备"的问题
 */
Hooks.on("preCreateItem", (item, data, options, userId) => {
  // 1. 只有“世界物品”（没有 Parent Actor）才需要清洗
  // 如果 item.parent 存在，说明是往角色身上添加物品，这时候通常需要保留数据（比如复制/导入）
  if (item.parent) return;

  // 准备一个更新对象，用于批量清洗
  const updates = {};

  // 2. 通用清洗：装备状态
  // 任何放在物品栏的东西都不应该是“已装备”的
  if (item.system.equipped) {
    updates["system.equipped"] = false;
  }

  // 3. 类型 A：内功 (Neigong) 清洗
  if (item.type === "neigong") {
    // 如果有投入修为，重置为 0
    if (item.system.xpInvested > 0) {
      updates["system.xpInvested"] = 0;
      updates["system.sourceBreakdown"] = { general: 0, specific: 0 };
    }
    // 如果正在运行，强制停止
    if (item.system.active) {
      updates["system.active"] = false;
    }
  }

  // 4. 类型 B：武学 (Wuxue) 清洗
  else if (item.type === "wuxue") {
    // 武学比较特殊，因为数据藏在 system.moves 数组里
    // 我们需要遍历每一个招式，把它们的修为清零

    // 获取原始 moves 数组的副本
    const rawMoves = item.system.toObject().moves || [];

    // 标记是否有数据被修改
    let hasChanges = false;

    const cleanMoves = rawMoves.map(move => {
      // 检查该招式是否有脏数据
      if (move.xpInvested > 0) {
        hasChanges = true;
        // 返回清洗后的新对象 (保留其他字段，仅重置修为)
        return foundry.utils.mergeObject(move, {
          xpInvested: 0,
          sourceBreakdown: { general: 0, specific: 0 }
        });
      }
      return move;
    });

    // 只有当確實发生了清洗时，才写入 updates，节省性能
    if (hasChanges) {
      updates["system.moves"] = cleanMoves;
    }
  }

  // 5. 类型 C：技艺书 (Art Book) 清洗 (如果有的话)
  else if (item.type === "art_book") {
    if (item.system.xpInvested > 0) {
      updates["system.xpInvested"] = 0;
      updates["system.sourceBreakdown"] = { general: 0, specific: 0 };
      // 如果有章节进度，可能也需要重置，视具体结构而定
    }
  }

  // 6. 执行更新
  // updateSource 会直接修改即将写入数据库的内存对象，不会触发额外的 update 钩子，非常高效
  if (!foundry.utils.isEmpty(updates)) {
    item.updateSource(updates);
    // console.log(`XJZL | 已清洗物品数据: ${item.name}`, updates);
  }
});

/* -------------------------------------------- */
/*  辅助函数                                    */
/* -------------------------------------------- */
/**
 * 注册 Handlebars 辅助函数
 */
function registerHandlebarsHelpers() {
  Handlebars.registerHelper("or", function (...args) {
    args.pop();
    return args.some(Boolean);
  });
  Handlebars.registerHelper("gt", (a, b) => a > b);
  Handlebars.registerHelper("capitalize", function (value) {
    if (typeof value !== "string") return "";
    return value.charAt(0).toUpperCase() + value.slice(1);
  });

  Handlebars.registerHelper("eq", function (a, b) {
    return a === b;
  });

  Handlebars.registerHelper("concat", function (...args) {
    args.pop();
    return args.join("");
  });

  // 用于 checkbox 的选中状态
  Handlebars.registerHelper("checked", function (value) {
    return value ? "checked" : "";
  });
  //计算百分比
  Handlebars.registerHelper("calculatePercentage", function (value, max) {
    if (!max || max === 0) return 0;
    return Math.min(100, Math.floor((value / max) * 100));
  });

  Handlebars.registerHelper("ne", function (a, b) {
    return a !== b;
  });

  Handlebars.registerHelper("log", function (context) {
    console.log("HBS Context:", context);
  });

  Handlebars.registerHelper("array", (...args) => {
    args.pop(); // 移除最后一个 Handlebars 传入的 options 对象
    return args;
  });

  // 截取字符串: {{substring "string" 0 1}}
  Handlebars.registerHelper('substring', function (string, start, end) {
    if (typeof string !== 'string') return "";
    return string.substring(start, end);
  });

  Handlebars.registerHelper("split", function (string, separator) {
    if (typeof string !== "string") return [];
    return string.split(separator);
  });

  /* math 帮助函数 */
  Handlebars.registerHelper("math", function (lvalue, operator, rvalue, options) {
    lvalue = parseFloat(lvalue);
    rvalue = parseFloat(rvalue);

    return {
      "+": lvalue + rvalue,
      "-": lvalue - rvalue,
      "*": lvalue * rvalue,
      "/": lvalue / rvalue,
      "%": lvalue % rvalue
    }[operator];
  });

  // 支持分组的 Select
  Handlebars.registerHelper("selectOptionsGrouped", (groupedChoices, options) => {
    const selected = String(options.hash.selected ?? "");
    let html = "";

    // 遍历每一个组
    for (const [groupLabel, choices] of Object.entries(groupedChoices)) {
      html += `<optgroup label="${groupLabel}">`;

      // 遍历组内选项
      for (const [key, label] of Object.entries(choices)) {
        const isSelected = String(key) === selected ? " selected" : "";
        html += `<option value="${key}"${isSelected}>${label}</option>`;
      }

      html += `</optgroup>`;
    }

    return new Handlebars.SafeString(html);
  });

  Handlebars.registerHelper('includes', function (array, value) {
    if (!Array.isArray(array)) return false;
    return array.includes(value);
  });
}
/**
 * 预加载模板片段
 * 使用 foundry.applications.handlebars.loadTemplates
 */
async function preloadHandlebarsTemplates() {
  const SYSTEM_ID = "xjzl-system";
  const templatePaths = [
    // 角色卡
    "systems/xjzl-system/templates/actor/character/header.hbs",
    "systems/xjzl-system/templates/actor/character/tabs.hbs",
    "systems/xjzl-system/templates/actor/character/tab-cultivation.hbs",
    "systems/xjzl-system/templates/actor/character/tab-combat.hbs",
    "systems/xjzl-system/templates/actor/character/tab-jingmai.hbs",
    "systems/xjzl-system/templates/actor/character/tab-inventory.hbs",
    "systems/xjzl-system/templates/actor/character/tab-bio.hbs",
    "systems/xjzl-system/templates/actor/character/tab-config.hbs",
    "systems/xjzl-system/templates/actor/character/audit-log.hbs",
    "systems/xjzl-system/templates/actor/character/manage-xp.hbs",
    // NPC Sheets (未来添加)
    // "systems/xjzl-system/templates/actor/npc/header.hbs",
    "systems/xjzl-system/templates/actor/container/sheet.hbs",

    // 内功
    "systems/xjzl-system/templates/item/neigong/header.hbs",
    "systems/xjzl-system/templates/item/neigong/tabs.hbs",
    "systems/xjzl-system/templates/item/neigong/tab-config.hbs",
    "systems/xjzl-system/templates/item/neigong/tab-effects.hbs",
    //武学
    "systems/xjzl-system/templates/item/wuxue/header.hbs",
    "systems/xjzl-system/templates/item/wuxue/tabs.hbs",
    "systems/xjzl-system/templates/item/wuxue/tab-details.hbs",
    "systems/xjzl-system/templates/item/wuxue/tab-effects.hbs",
    //装备
    "systems/xjzl-system/templates/item/equipment/header.hbs",
    "systems/xjzl-system/templates/item/equipment/tabs.hbs",
    "systems/xjzl-system/templates/item/equipment/tab-details.hbs",
    "systems/xjzl-system/templates/item/equipment/tab-effects.hbs",
    //特效/特性
    "systems/xjzl-system/templates/item/trait/header.hbs",
    "systems/xjzl-system/templates/item/trait/tabs.hbs",
    "systems/xjzl-system/templates/item/trait/tab-details.hbs",
    "systems/xjzl-system/templates/item/trait/tab-effects.hbs",
    //物品
    "systems/xjzl-system/templates/item/general/header.hbs",
    "systems/xjzl-system/templates/item/general/tabs.hbs",
    "systems/xjzl-system/templates/item/general/tab-details.hbs",
    "systems/xjzl-system/templates/item/general/tab-effects.hbs",
    //技艺书
    "systems/xjzl-system/templates/item/art-book/header.hbs",
    "systems/xjzl-system/templates/item/art-book/details.hbs",
    //性格和背景
    "systems/xjzl-system/templates/item/background/header.hbs",
    "systems/xjzl-system/templates/item/background/tabs.hbs",
    "systems/xjzl-system/templates/item/background/tab-details.hbs",
    "systems/xjzl-system/templates/item/background/tab-effects.hbs",
    "systems/xjzl-system/templates/item/personality/header.hbs",
    "systems/xjzl-system/templates/item/personality/details.hbs",
    // 战局 Item 与聊天卡片
    "systems/xjzl-system/templates/item/encounter/header.hbs",
    "systems/xjzl-system/templates/item/encounter/tabs.hbs",
    "systems/xjzl-system/templates/item/encounter/tab-overview.hbs",
    "systems/xjzl-system/templates/item/encounter/tab-fields.hbs",
    "systems/xjzl-system/templates/item/encounter/tab-support.hbs",
    "systems/xjzl-system/templates/chat/encounter-card.hbs",
    //聊天卡片
    "systems/xjzl-system/templates/chat/item-card.hbs", //物品使用
    "systems/xjzl-system/templates/chat/move-card.hbs", //招式使用
    "systems/xjzl-system/templates/chat/request-defense.hbs", //虚招对抗
    "systems/xjzl-system/templates/chat/damage-card.hbs", //伤害卡片
    "systems/xjzl-system/templates/chat/heal-card.hbs", //伤害卡片
    "systems/xjzl-system/templates/chat/defend-result.hbs", //看破结果
    "systems/xjzl-system/templates/chat/request-save.hbs", //属性判定
    "systems/xjzl-system/templates/chat/request-contest.hbs", //属性对抗
    "systems/xjzl-system/templates/chat/loot-card.hbs", //随机抽取卡片
    //应用窗口
    "systems/xjzl-system/templates/apps/damage-tool.hbs", //伤害工具
    "systems/xjzl-system/templates/apps/roll-config.hbs", //roll设置窗口
    "systems/xjzl-system/templates/apps/defend-config.hbs", //看破设置窗口
    "systems/xjzl-system/templates/apps/effect-selection.hbs", //特效选择
    "systems/xjzl-system/templates/apps/attribute-test-config.hbs", //属性检定设置窗口
    "systems/xjzl-system/templates/apps/modifier-picker.hbs", //属性修正选择器
    "systems/xjzl-system/templates/apps/compendiumbrowser/content.hbs", // 合集浏览器
    "systems/xjzl-system/templates/apps/compendiumbrowser/navigation.hbs", // 合集浏览器
    "systems/xjzl-system/templates/apps/compendiumbrowser/sidebar.hbs", // 合集浏览器
    "systems/xjzl-system/templates/apps/compendiumbrowser/card-list.hbs", // 合集浏览器卡片列表（含增量追加）
    "systems/xjzl-system/templates/apps/compendiumbrowser/random-dialog.hbs", // 合集浏览器随机抽取对话框
    "systems/xjzl-system/templates/apps/compendiumbrowser/draw-reveal.hbs", // 合集浏览器抽取演出
    "systems/xjzl-system/templates/apps/aoe-creator.hbs", // aoe创建器窗口
    "systems/xjzl-system/templates/apps/character-preview.hbs", //角色预览
    "systems/xjzl-system/templates/apps/tone-tracker.hbs",//音阶计数器
    "systems/xjzl-system/templates/apps/action-tracker.hbs",//动作计数器
    "systems/xjzl-system/templates/apps/combat-meter.hbs",//数据统计
    "systems/xjzl-system/templates/apps/combat-score.hbs",//数据评分
    "systems/xjzl-system/templates/apps/encounter-runtime.hbs", // 战局运行 HUD
    // 向导界面
    "systems/xjzl-system/templates/apps/character-wizard/sidebar.hbs",
    "systems/xjzl-system/templates/apps/character-wizard/main.hbs",
    "systems/xjzl-system/templates/apps/character-wizard/footer.hbs",
    //暂停按钮的界面
    "systems/xjzl-system/templates/system/pause.hbs",
  ];
  // 严格 V13 写法：使用命名空间
  return foundry.applications.handlebars.loadTemplates(templatePaths);
}
