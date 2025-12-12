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
import { XJZLConsumableData } from "./module/data/item/consumable.mjs";
import { XJZLManualData } from "./module/data/item/manual.mjs";
import { XJZLMiscData } from "./module/data/item/misc.mjs";

// 导入 Sheets (UI)
import { XJZLCharacterSheet } from "./module/sheets/character-sheet.mjs";
import { XJZLNeigongSheet } from "./module/sheets/neigong-sheet.mjs";
import { XJZLWuxueSheet } from "./module/sheets/wuxue-sheet.mjs";
import { XJZLEquipmentSheet } from "./module/sheets/equipment-sheet.mjs";
import { XJZLGeneralItemSheet } from "./module/sheets/general-item-sheet.mjs";

//导入管理器
import { ChatCardManager } from "./module/managers/chat-manager.mjs";

//导入工具
import { GenericDamageTool } from "./module/applications/damage-tool.mjs";

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
    qizhen: XJZLQizhenData,
    consumable: XJZLConsumableData,
    manual: XJZLManualData,
    misc: XJZLMiscData
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

  // 注册物品表单
  Items.registerSheet("xjzl-system", XJZLGeneralItemSheet, {
    types: ["consumable", "manual", "misc"],
    makeDefault: true,
    label: "XJZL.Sheet.GeneralItem"
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
  // 是否允许玩家使用伤害工具
  game.settings.register("xjzl-system", "allowPlayerDamageTool", {
    name: "允许玩家使用伤害工具",
    hint: "如果开启，玩家也能在左侧 Token 工具栏看到并使用【通用伤害工具】。通常仅供 GM 或可信赖的助手使用。",
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
});

/* -------------------------------------------- */
/*  Ready Hook (就绪钩子)                        */
/* -------------------------------------------- */

Hooks.once("ready", async function () {
  // 等待系统完全加载后的操作，比如处理设置、欢迎弹窗等
  // 监听聊天消息渲染，绑定按钮事件
  Hooks.on("renderChatMessageHTML", ChatCardManager.onRenderChatMessage);
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

  // --- 新增：给 Attribute Key 添加自动补全 ---

  // 1. 找到 Key 的输入框
  // 注意：V13 DOM 结构可能稍有不同，建议用 name 属性查找
  const keyInput = $(html).find('select[name="changes.0.key"], input[name="changes.0.key"]');

  // 如果当前是 select (FVTT 默认给了一些)，我们可能不管它
  // 如果是 input (通常是手输)，我们给它加个 datalist
  if (keyInput.length && keyInput.prop("tagName") === "INPUT") {

    // 创建 datalist ID
    const listId = "xjzl-status-list";
    keyInput.attr("list", listId);

    // 构建选项 HTML
    let options = "";

    // A. 加入你的状态开关
    for (const [key, label] of Object.entries(CONFIG.XJZL.statusFlags)) {
      // 显示为: "flags.xjzl-system.stun (晕眩)"
      // 这里的 value 必须是真正要写入数据库的完整路径
      options += `<option value="flags.xjzl-system.${key}">${game.i18n.localize(label)}</option>`;
    }

    // B. 加入你的基础属性 (可选)
    // 比如 system.resources.mp.value
    options += `<option value="system.resources.mp.value">内力值</option>`;
    options += `<option value="system.resources.hp.value">气血值</option>`;

    // 插入 datalist 到 DOM
    const dataListHtml = `<datalist id="${listId}">${options}</datalist>`;
    keyInput.after(dataListHtml);
  }
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
        // 【修正点 2】确保 GenericDamageTool 已被导入
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
    "systems/xjzl-system/templates/actor/character/tab-effects.hbs",
    // NPC Sheets (未来添加)
    // "systems/xjzl-system/templates/actor/npc/header.hbs",

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
    //物品
    "systems/xjzl-system/templates/item/general/header.hbs",
    "systems/xjzl-system/templates/item/general/tabs.hbs",
    "systems/xjzl-system/templates/item/general/tab-details.hbs",
    "systems/xjzl-system/templates/item/general/tab-effects.hbs",
    //聊天卡片
    "systems/xjzl-system/templates/chat/item-card.hbs", //物品使用
    "systems/xjzl-system/templates/chat/move-card.hbs", //招式使用
    "systems/xjzl-system/templates/chat/request-defense.hbs", //虚招对抗
    "systems/xjzl-system/templates/chat/damage-card.hbs", //伤害卡片
    "systems/xjzl-system/templates/chat/defend-result.hbs", //看破结果
    //应用窗口
    "systems/xjzl-system/templates/apps/damage-tool.hbs", //物品使用
  ];
  // 严格 V13 写法：使用命名空间
  return foundry.applications.handlebars.loadTemplates(templatePaths);
}