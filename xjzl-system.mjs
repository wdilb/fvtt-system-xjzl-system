/**
 * 侠界之旅 - 系统主入口
 * Author: Tiwelee
 * Tech Stack: Foundry V13, ESM, DataModels
 */

// 导入 Document 类
import { XJZLActor } from "./module/documents/actor.mjs";
import { XJZLItem } from "./module/documents/item.mjs";

// 导入 DataModels (数据结构)
import { XJZLCharacterData } from "./module/data/actor/character.mjs";
import { XJZLNPCData } from "./module/data/actor/npc.mjs";
// (后续会导入更多 Item 模型)

// 导入 Sheets (UI)
import { XJZLActorSheet } from "./module/sheets/actor-sheet.mjs";

// 导入配置
import { XJZL } from "./module/config.mjs";

/* -------------------------------------------- */
/*  Init Hook (初始化钩子)                       */
/* -------------------------------------------- */

Hooks.once("init", async function () {
  console.log(`侠界之旅系统 - v${game.system.version}`);

  // 1. 将自定义配置挂载到全局 CONFIG
  CONFIG.XJZL = XJZL;

  // 2. 注册自定义 Document 类 (逻辑层)
  // 告诉 Foundry 使用我们需要扩展的类，而不是默认的 Actor/Item
  CONFIG.Actor.documentClass = XJZLActor;
  CONFIG.Item.documentClass = XJZLItem;

  // 3. 注册 DataModels (数据层) - V13 核心
  // 将 system.json 中定义的类型与 JS 类绑定
  CONFIG.Actor.dataModels = {
    character: XJZLCharacterData,
    npc: XJZLNPCData,
    // creature: XJZLCreatureData (未来添加)
  };

  CONFIG.Item.dataModels = {
    // neigong: XJZLNeigongData (未来添加)
    // weapon: XJZLWeaponData (未来添加)
  };

  // 4. 注册 Sheets (表现层)
  // 注销默认 Sheet，注册我们需要用来渲染的 AppV2 Sheet
  Actors.unregisterSheet("core", ActorSheet);
  
  // 注意：V13 中虽然推荐 AppV2，但注册方式仍需兼容 DocumentSheetConfig
  Actors.registerSheet("xjzl-system", XJZLActorSheet, {
    makeDefault: true,
    label: "XJZL.Sheet.ActorDefault"
  });

  // 预加载 Handlebars 模板
  preloadHandlebarsTemplates();
});

/* -------------------------------------------- */
/*  Ready Hook (就绪钩子)                        */
/* -------------------------------------------- */

Hooks.once("ready", async function () {
  // 等待系统完全加载后的操作，比如处理设置、欢迎弹窗等
});

/* -------------------------------------------- */
/*  辅助函数                                    */
/* -------------------------------------------- */

async function preloadHandlebarsTemplates() {
  const templatePaths = [
    // "systems/xjzl-system/templates/parts/actor-stats.hbs",
  ];
  return loadTemplates(templatePaths);
}