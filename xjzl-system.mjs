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
import { XJZLArtBookData } from "./module/data/item/art-book.mjs";
import { XJZLPersonalityData } from "./module/data/item/personality.mjs";
import { XJZLBackgroundData } from "./module/data/item/background.mjs";

// 导入 Sheets (UI)
import { XJZLCharacterSheet } from "./module/sheets/character-sheet.mjs";
import { XJZLNeigongSheet } from "./module/sheets/neigong-sheet.mjs";
import { XJZLWuxueSheet } from "./module/sheets/wuxue-sheet.mjs";
import { XJZLEquipmentSheet } from "./module/sheets/equipment-sheet.mjs";
import { XJZLGeneralItemSheet } from "./module/sheets/general-item-sheet.mjs";
import { XJZLArtBookSheet } from "./module/sheets/art-book-sheet.mjs";
import { XJZLPersonalitySheet } from "./module/sheets/personality-sheet.mjs";
import { XJZLBackgroundSheet } from "./module/sheets/background-sheet.mjs";

//导入管理器
import { ChatCardManager } from "./module/managers/chat-manager.mjs";
import { TargetManager } from "./module/managers/target-manager.mjs";
import { ActiveEffectManager } from "./module/managers/active-effect-manager.mjs";

//导入工具
import { GenericDamageTool } from "./module/applications/damage-tool.mjs";
import { EffectSelectionDialog } from "./module/applications/effect-selection-dialog.mjs";

// 导入配置
import { XJZL } from "./module/config.mjs";

/* -------------------------------------------- */
/*  Init Hook (初始化钩子)                       */
/* -------------------------------------------- */

Hooks.once("init", async function () {
  console.log(`侠界之旅系统 - v${game.system.version} 初始化中...`);

  // 1. 将自定义配置挂载到全局 CONFIG
  CONFIG.XJZL = XJZL;

  // 挂载到全局命名空间
  game.xjzl = {
    api: {
      // 将来可能有其他 API，所以这里放 effects 子命名空间
      effects: ActiveEffectManager //这样就可以调用 game.xjzl.api.effects.addEffect
    }
  };

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
    misc: XJZLMiscData,
    art_book: XJZLArtBookData,
    personality: XJZLPersonalityData,
    background: XJZLBackgroundData
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
  console.log("侠界之旅系统 - 准备就绪");
});

/* -------------------------------------------- */
/*  Hooks: Active Effect Config (New Tab Style) */
/* -------------------------------------------- */

Hooks.on("renderActiveEffectConfig", (app, html, data) => {
  // 1. 获取原生 DOM
  const el = html instanceof HTMLElement ? html : html[0];

  // 2. 获取数据
  const effect = app.document;
  const flags = effect.flags["xjzl-system"] || {};

  const slug = flags.slug || "";
  const isStackable = flags.stackable || false;
  const maxStacks = flags.maxStacks || 0;

  let autoSlug = "auto-generated-slug";
  if (effect.name) {
    autoSlug = effect.name.slugify();
  }

  // =====================================================
  // 3. 注入导航栏 (Add Navigation Item)
  // =====================================================
  const nav = el.querySelector('nav.tabs');

  if (nav) {
    const navItem = document.createElement("a");
    // 【关键修正 1】必须添加 data-action="tab"
    navItem.dataset.action = "tab";
    // 【关键修正 2】组名必须是 "sheet" (参考你的 HTML 截图)
    navItem.dataset.group = "sheet";
    navItem.dataset.tab = "xjzl-config";

    // 为了保持样式一致，内部加 span
    navItem.innerHTML = `<i class="fas fa-dragon"></i> <span>侠界配置</span>`;

    nav.appendChild(navItem);
  }

  // =====================================================
  // 4. 注入标签页内容 (Add Tab Content)
  // =====================================================

  // 使用 section 以匹配原生样式
  const tabContent = document.createElement("section");
  tabContent.className = "tab";
  tabContent.dataset.tab = "xjzl-config";
  // 【关键修正 3】组名必须匹配 "sheet"
  tabContent.dataset.group = "sheet";

  // 构建配置 HTML
  tabContent.innerHTML = `
    <div style="padding: 10px;">
        <h3 class="form-header"><i class="fas fa-cogs"></i> 高级规则配置</h3>
        <p class="notes" style="margin-bottom: 10px;">配置该特效在侠界系统中的自动化行为。</p>

        <fieldset style="border: 1px solid #7a7971; border-radius: 5px; padding: 10px; margin-bottom: 10px;">
            <legend>叠层逻辑 (Stacking)</legend>
            
            <div class="form-group">
                <label>唯一标识 (Slug)</label>
                <div class="form-fields">
                    <input type="text" name="flags.xjzl-system.slug" value="${slug}" placeholder="${autoSlug}">
                </div>
                <p class="notes">用于识别同类效果。留空则自动生成。</p>
            </div>

            <div class="form-group">
                <label>可堆叠 (Stackable)</label>
                <div class="form-fields">
                    <input type="checkbox" name="flags.xjzl-system.stackable" ${isStackable ? "checked" : ""}>
                </div>
                <p class="notes">允许重复应用以增加层数。</p>
            </div>
            
            <div class="form-group">
                <label>最大层数 (Max Stacks)</label>
                <div class="form-fields">
                    <input type="number" name="flags.xjzl-system.maxStacks" value="${maxStacks}" placeholder="0">
                </div>
                <p class="notes">0 表示无上限。</p>
            </div>
        </fieldset>
    </div>
  `;

  // 插入到 footer 之前
  const submitButton = el.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.closest("footer").before(tabContent);
  } else {
    const form = el.querySelector('form');
    if (form) form.appendChild(tabContent);
  }

  // =====================================================
  // 5. 激活标签页切换逻辑 (Re-initialize Tabs)
  // =====================================================
  // 因为我们是动态注入的 Tab，需要告诉 Application 重新计算一下 Tab 逻辑
  // 或者最简单的：因为我们注入了标准的 .item 和 .tab，
  // Foundry 的 TabsV2 Controller 通常会自动识别点击事件。

  // 调整高度以适应新 Tab (如果需要)
  app.setPosition({ height: "auto" });


  // =====================================================
  // 6. 属性 Key 自动补全 (保持不变，因为这是全局生效的)
  // =====================================================
  const listId = `xjzl-status-list-${effect.id || foundry.utils.randomID()}`;
  let options = "";
  for (const [key, label] of Object.entries(CONFIG.XJZL.statusFlags)) {
    options += `<option value="flags.xjzl-system.${key}">${game.i18n.localize(label)}</option>`;
  }
  options += `<option value="system.resources.mp.value">内力值 (当前)</option>`;
  options += `<option value="system.resources.hp.value">气血值 (当前)</option>`;

  const datalist = document.createElement("datalist");
  datalist.id = listId;
  datalist.innerHTML = options;
  el.appendChild(datalist);

  const keyInputs = el.querySelectorAll('input[name^="changes."][name$=".key"]');
  keyInputs.forEach(input => {
    input.setAttribute("list", listId);
    input.setAttribute("placeholder", "Key...");
  });
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
 * 战斗轮次流转监听
 * 用于处理 回合开始/回合结束 的自动回复与脚本
 */
Hooks.on("updateCombat", async (combat, updateData, context) => {
  // 1. 仅限 GM 处理 (防止重复触发)
  if (!game.user.isGM) return;

  // 2. 检查是否是回合变更 (turn 或 round 变化)
  if (!("turn" in updateData) && !("round" in updateData)) return;

  // 3. 获取 上一位 (Previous) 和 当前位 (Current) 的 Combatant
  // previous: 刚刚结束回合的人
  // current:  即将开始回合的人
  const prevId = combat.previous.combatantId;
  const currId = combat.current.combatantId;

  // --- A. 处理回合结束 (Turn End) ---
  if (prevId) {
    const prevCombatant = combat.combatants.get(prevId);
    const prevActor = prevCombatant?.actor;
    if (prevActor) {
      // 1. 执行数值回复
      await prevActor.processRegen("TurnEnd");
      // 2. 执行脚本 (Script Trigger)
      await prevActor.runScripts("turnEnd", {});
    }
  }

  // --- B. 处理回合开始 (Turn Start) ---
  if (currId) {
    const currCombatant = combat.combatants.get(currId);
    const currActor = currCombatant?.actor;
    if (currActor) {
      // 1. 执行数值回复
      await currActor.processRegen("TurnStart");
      // 2. 执行脚本 (Script Trigger)
      await currActor.runScripts("turnStart", {});
    }
  }

  // 遍历战斗中的所有战斗员，清除过期的ae效果
  for (const combatant of combat.combatants) {
    if (combatant.actor) {
      await ActiveEffectManager.cleanExpiredEffects(combatant.actor);
    }
  }
});

/**
 * 监听战斗人员创建 (进入战斗)
 */
Hooks.on("createCombatant", async (combatant, options, userId) => {
  // 1. 仅限 GM 执行 (防止多客户端重复触发数据修改)
  if (!game.user.isGM) return;

  // 2. 获取 Actor
  const actor = combatant.actor;
  if (!actor) return;

  // 3. 执行脚本
  // "combatStart" 时机通常不需要额外的 context，
  // 但我们可以把 combatant 本身传进去，万一脚本想读取先攻值之类的
  const context = {
    combatant: combatant
  };

  try {
    await actor.runScripts("combatStart", context);
    // 其他进入战斗触发的逻辑也可以写在这
  } catch (err) {
    console.error(`XJZL | 进战脚本执行错误 [${actor.name}]:`, err);
  }
});
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
    "systems/xjzl-system/templates/actor/character/tab-config.hbs",
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
    //技艺书
    "systems/xjzl-system/templates/item/art-book/header.hbs",
    "systems/xjzl-system/templates/item/art-book/details.hbs",
    //聊天卡片
    "systems/xjzl-system/templates/chat/item-card.hbs", //物品使用
    "systems/xjzl-system/templates/chat/move-card.hbs", //招式使用
    "systems/xjzl-system/templates/chat/request-defense.hbs", //虚招对抗
    "systems/xjzl-system/templates/chat/damage-card.hbs", //伤害卡片
    "systems/xjzl-system/templates/chat/defend-result.hbs", //看破结果
    "systems/xjzl-system/templates/chat/request-save.hbs", //属性判定
    //应用窗口
    "systems/xjzl-system/templates/apps/damage-tool.hbs", //伤害工具
    "systems/xjzl-system/templates/apps/roll-config.hbs", //roll设置窗口
    "systems/xjzl-system/templates/apps/defend-config.hbs", //看破设置窗口
    "systems/xjzl-system/templates/apps/effect-selection.hbs", //特效选择
    "systems/xjzl-system/templates/apps/attribute-test-config.hbs", //属性检定设置窗口
  ];
  // 严格 V13 写法：使用命名空间
  return foundry.applications.handlebars.loadTemplates(templatePaths);
}