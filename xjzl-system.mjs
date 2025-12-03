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
// import { XJZLNPCData } from "./module/data/actor/npc.mjs"; // 暂时注释，写了再开
import { XJZLNeigongData } from "./module/data/item/neigong.mjs";
import { XJZLWuxueData } from "./module/data/item/wuxue.mjs"
import { XJZLWeaponData } from "./module/data/item/weapon.mjs";
import { XJZLArmorData } from "./module/data/item/armor.mjs";
import { XJZLQizhenData } from "./module/data/item/qizhen.mjs";

// 导入 Sheets (UI)
import { XJZLCharacterSheet } from "./module/sheets/character-sheet.mjs";
import { XJZLNeigongSheet } from "./module/sheets/neigong-sheet.mjs";
import { XJZLWuxueSheet } from "./module/sheets/wuxue-sheet.mjs";
import { XJZLEquipmentSheet  } from "./module/sheets/equipment-sheet.mjs";

// 导入配置
import { XJZL } from "./module/config.mjs";

/* -------------------------------------------- */
/*  Init Hook (初始化钩子)                       */
/* -------------------------------------------- */

Hooks.once("init", async function () {
  console.log(`侠界之旅系统 - v${game.system.version} 初始化中...`);

  // 1. 将自定义配置挂载到全局 CONFIG
  CONFIG.XJZL = XJZL;

  // 2. 注册自定义 Document 类 (逻辑层)
  // 告诉 Foundry 使用我们需要扩展的类，而不是默认的 Actor/Item
  CONFIG.Actor.documentClass = XJZLActor;
  CONFIG.Item.documentClass = XJZLItem;
  // 注册 ActiveEffect 类，用来处理装备的自动抑制
  CONFIG.ActiveEffect.documentClass = XJZLActiveEffect;

  // 3. 注册 DataModels (数据层) - V13 核心
  // 将 system.json 中定义的类型与 JS 类绑定
  CONFIG.Actor.dataModels = {
    character: XJZLCharacterData,
    // npc: XJZLNPCData,
    // creature: XJZLCreatureData (未来添加)
  };

  CONFIG.Item.dataModels = {
    neigong: XJZLNeigongData,
    wuxue: XJZLWuxueData, // 注册武学数据
    weapon: XJZLWeaponData,
    armor: XJZLArmorData,
    qizhen: XJZLQizhenData
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
    types: ["character"], // 暂时只绑定 character 类型
    makeDefault: true,
    label: "XJZL.Sheet.Character"
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

  // ==========================================
  //  5.注册 常用Handlebars 辅助函数
  // ==========================================

  registerHandlebarsHelpers();

  // 预加载 Handlebars 模板,必须等待预加载完成
  await preloadHandlebarsTemplates();
});

/* -------------------------------------------- */
/*  Ready Hook (就绪钩子)                        */
/* -------------------------------------------- */

Hooks.once("ready", async function () {
  // 等待系统完全加载后的操作，比如处理设置、欢迎弹窗等
  console.log("侠界之旅系统 - 准备就绪");
});

/* -------------------------------------------- */
/*  Hooks: Active Effect Config                 */
/* -------------------------------------------- */

// 在打开特效编辑窗口时，注入“可堆叠”选项
Hooks.on("renderActiveEffectConfig", (app, html, data) => {
  // V13 兼容性处理：确保 html 是原生 DOM 元素
  const el = html instanceof HTMLElement ? html : html[0];

  const disabledInput = el.querySelector('input[name="disabled"]');
  if (!disabledInput) return;

  const disabledField = disabledInput.closest(".form-group");

  // 使用 app.document 而不是 app.object
  // 读取 Flag
  const isStackable = app.document.getFlag("xjzl-system", "stackable") || false;
  const maxStacks = app.document.getFlag("xjzl-system", "maxStacks") || 0;

  // 构建 HTML (包含堆叠开关 和 最大层数)
  const stackableHtml = `
    <div class="form-group">
        <label>可堆叠 (Stackable)</label>
        <div class="form-fields">
            <input type="checkbox" name="flags.xjzl-system.stackable" ${isStackable ? "checked" : ""}>
        </div>
        <p class="notes">勾选后，重复应用将增加层数而非覆盖。</p>
    </div>
    
    <div class="form-group">
        <label>最大层数 (Max Stacks)</label>
        <div class="form-fields">
            <input type="number" name="flags.xjzl-system.maxStacks" value="${maxStacks}" placeholder="0 为无限制">
        </div>
        <p class="notes">设为 0 表示无上限。</p>
    </div>
  `;

  disabledField.insertAdjacentHTML('afterend', stackableHtml);
  app.setPosition({ height: "auto" });
});

/* -------------------------------------------- */
/*  辅助函数                                    */
/* -------------------------------------------- */
/**
 * 注册 Handlebars 辅助函数
 */
function registerHandlebarsHelpers() {
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

  // 增加 selectOptions (Item Sheet 用到了)
  Handlebars.registerHelper("selectOptions", (choices, options) => {
    // 获取当前选中的值，转为字符串以便比较
    const selected = String(options.hash.selected ?? "");
    let html = "";

    // 情况 A: 传入的是对象 { key: "Label", yin: "阴" }
    if (choices && typeof choices === 'object' && !Array.isArray(choices)) {
      for (const [key, label] of Object.entries(choices)) {
        const isSelected = String(key) === selected ? " selected" : "";
        html += `<option value="${key}"${isSelected}>${label}</option>`;
      }
    }
    // 情况 B: 传入的是数组 [1, 2, 3] 或 [{value:1, label:"一"}]
    else if (Array.isArray(choices)) {
      for (const choice of choices) {
        let value, label;
        // 如果数组里是对象 {value, label}
        if (typeof choice === 'object' && choice !== null) {
          value = choice.value;
          label = choice.label || value;
        } else {
          // 简单数组 [1, 2, 3]
          value = choice;
          label = choice;
        }
        const isSelected = String(value) === selected ? " selected" : "";
        html += `<option value="${value}"${isSelected}>${label}</option>`;
      }
    }
    return new Handlebars.SafeString(html);
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
    "systems/xjzl-system/templates/actor/character/tab-stats.hbs",
    "systems/xjzl-system/templates/actor/character/tab-cultivation.hbs",
    "systems/xjzl-system/templates/actor/character/tab-combat.hbs",
    "systems/xjzl-system/templates/actor/character/tab-jingmai.hbs",
    "systems/xjzl-system/templates/actor/character/tab-inventory.hbs",
    // NPC Sheets (未来添加)
    // "systems/xjzl-system/templates/actor/npc/header.hbs",

    // 内功
    "systems/xjzl-system/templates/item/neigong/sheet.hbs",
    //武学
    "systems/xjzl-system/templates/item/wuxue/header.hbs",
    "systems/xjzl-system/templates/item/wuxue/tabs.hbs",
    "systems/xjzl-system/templates/item/wuxue/tab-details.hbs",
    "systems/xjzl-system/templates/item/wuxue/tab-effects.hbs",
    //装备
    "systems/xjzl-system/templates/item/equipment/header.hbs",
    "systems/xjzl-system/templates/item/equipment/tabs.hbs",
    "systems/xjzl-system/templates/item/equipment/tab-details.hbs",
    "systems/xjzl-system/templates/item/equipment/tab-effects.hbs"
  ];
  // 严格 V13 写法：使用命名空间
  return foundry.applications.handlebars.loadTemplates(templatePaths);
}