/* module/utils.mjs */

/**
 * 将配置对象的值进行本地化
 * 输入: { key: "LOC.Key" }
 * 输出: { key: "翻译后的文本" }
 */
export function localizeConfig(config) {
  const localized = {};
  for (const [key, labelKey] of Object.entries(config)) {
    localized[key] = game.i18n.localize(labelKey);
  }
  return localized;
}

/* -------------------------------------------- */
/*  残疾表系统 (Disability Logic)               */
/* -------------------------------------------- */

/**
 * [内部工具] 查表逻辑
 * @param {Number} rollResult 
 */
export function getDisabilityResult(rollResult) {
  const table = CONFIG.XJZL.disabilityTable; // 确保在 config.mjs 里导出了这个
  if (!table) return "配置缺失";

  const entry = table.find(e => rollResult >= e.min && rollResult <= e.max);
  if (!entry) return "未知结果";

  return game.i18n.localize(`XJZL.Disability.Table.${entry.key}`);
}

/**
 * [系统功能] 投掷残疾表
 * @param {Actor} [actor] - 关联角色
 */
export async function rollDisabilityTable(actor) {
  // 1. 投掷 d100
  const roll = await new Roll("1d100").evaluate();
  const total = roll.total;

  // 2. 查表
  const resultText = getDisabilityResult(total);

  // 3. 渲染卡片内容
  const content = `
  <div class="xjzl-chat-card">
      <header class="card-header" style="border-bottom: 2px solid #8b0000; margin-bottom: 10px;">
          <h3 style="color:#8b0000; font-weight:900;">${game.i18n.localize("XJZL.Disability.Label")}</h3>
      </header>
      <div style="font-size: 1.1em; text-align: center; margin-bottom: 10px;">
          <span style="font-weight:bold; font-size:1.5em; color:#333;">${total}</span>
          <span style="font-size:0.8em; color:#666;">(d100)</span>
      </div>
      <div style="background:rgba(0,0,0,0.05); padding:10px; border-radius:4px; color:#444; line-height:1.5; font-size: 0.9em; text-align: left;">
          ${resultText}
      </div>
  </div>
  `;

  // 4. 发送消息 (V13 标准写法)
  const chatData = {
    user: game.user.id,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: "命运" },
    flavor: game.i18n.localize("XJZL.Disability.Flavor"),
    content: content,
    // 移除 type/style，让系统自动推断
    // 必须传入 rolls 数组，系统才会触发 3D 骰子和声音
    rolls: [roll]
  };

  ChatMessage.applyRollMode(chatData, game.settings.get("core", "rollMode"));

  // 移除 game.dice3d.showForRoll(...)，防止双重播放
  await ChatMessage.create(chatData);
}

/**
 * [UI功能] 打开查询弹窗
 */
export async function promptDisabilityQuery() {
  const formId = `disability-query-${foundry.utils.randomID()}`;

  const content = `
  <div style="text-align:center; padding:10px;">
      <p>${game.i18n.localize("XJZL.Disability.QueryHint")}</p>
      <input type="number" id="${formId}" min="1" max="100" autofocus 
             style="width:80px; font-size:2em; text-align:center; border:2px solid var(--xjzl-gold); border-radius:4px;">
      <div id="${formId}-result" style="margin-top:15px; text-align:left; min-height:60px; padding:10px; background:rgba(0,0,0,0.05); border-radius:4px; font-size:0.9em;">
          ...
      </div>
  </div>
  `;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("XJZL.Disability.QueryTitle"), icon: "fas fa-search", width: 400 },
    content: content,
    render: (event) => {
      const input = document.getElementById(formId);
      const output = document.getElementById(`${formId}-result`);
      if (!input || !output) return;

      input.addEventListener("input", (e) => {
        const val = parseInt(e.target.value);
        if (!val || val < 1 || val > 100) {
          output.innerHTML = "...";
          return;
        }
        output.innerHTML = getDisabilityResult(val);
      });
    },
    ok: { label: "关闭", callback: () => { } },
    rejectClose: false
  });
}

/**
 * 获取所有可修正属性的列表 (用于 Actor 自定义修正 和 Item 内功特效)
 * 返回结构: { "分组名": { "key": "Label" }, ... }
 */
export function getModifierChoices() {
  const groups = {};

  // 辅助: 添加到指定分组
  const add = (groupName, key, label) => {
    if (!groups[groupName]) groups[groupName] = {};
    groups[groupName][key] = label;
  };

  // 9. 资源上限 (Resources) 移动到最前面，这个用的多
  const groupRes = game.i18n.localize("XJZL.Resources.Label");
  add(groupRes, "resources.hp.bonus", `${game.i18n.localize("XJZL.Resources.HP")} (Bonus)`);
  add(groupRes, "resources.mp.bonus", `${game.i18n.localize("XJZL.Resources.MP")} (Bonus)`);

  // 1. 七维属性 (Stats)
  const groupStats = game.i18n.localize("XJZL.Stats.Label");
  for (const [k, labelKey] of Object.entries(CONFIG.XJZL.attributes)) {
    add(groupStats, `stats.${k}.mod`, `${game.i18n.localize(labelKey)} (Mod)`);
  }

  // 2. 战斗属性 (Combat Base)
  const groupCombat = game.i18n.localize("XJZL.Combat.Label");
  const combatInputs = {
    "speed": "XJZL.Combat.Speed", "dodge": "XJZL.Combat.Dodge",
    "block": "XJZL.Combat.Block", "kanpo": "XJZL.Combat.Kanpo",
    "initiative": "XJZL.Combat.Initiative", "xuzhao": "XJZL.Combat.XuZhao",
    "def_waigong": "XJZL.Combat.DefWaigong", "def_neigong": "XJZL.Combat.DefNeigong",
    "hit_waigong": "XJZL.Combat.HitWaigong", "hit_neigong": "XJZL.Combat.HitNeigong",
    "crit_waigong": "XJZL.Combat.CritWaigong", "crit_neigong": "XJZL.Combat.CritNeigong"
  };
  for (const [k, labelKey] of Object.entries(combatInputs)) {
    add(groupCombat, `combat.${k}`, `${game.i18n.localize(labelKey)} (Base/Mod)`);
  }

  // 3. 兵器造诣 (Weapon Ranks)
  const groupWeaponRank = game.i18n.localize("XJZL.Combat.WeaponRanks");
  for (const [k, labelKey] of Object.entries(CONFIG.XJZL.weaponTypes)) {
    if (k === 'none') continue;
    add(groupWeaponRank, `combat.weaponRanks.${k}.mod`, `${game.i18n.localize(labelKey)} (Mod)`);
  }

  // 4. 伤害加成 (Damages)
  const groupDmg = "伤害加成";
  // 基础类型
  add(groupDmg, "combat.damages.global.mod", "全局伤害 (Mod)");
  add(groupDmg, "combat.damages.weapon.mod", "武器伤害 (Mod)");
  add(groupDmg, "combat.damages.skill.mod", "招式伤害 (Mod)");
  add(groupDmg, "combat.damages.normal.mod", "普攻伤害 (Mod)");
  add(groupDmg, "combat.damages.neigong.mod", "内功伤害 (Mod)"); 
  add(groupDmg, "combat.damages.waigong.mod", "外功伤害 (Mod)"); 
  // 五行类型
  for (const k of ["yang", "yin", "gang", "rou", "taiji"]) {
    add(groupDmg, `combat.damages.${k}.mod`, `${game.i18n.localize("XJZL.Combat.Dmg." + k.charAt(0).toUpperCase() + k.slice(1))} (Mod)`);
  }

  // 5. 抗性修正 (Resistances)
  const groupResist = "抗性修正";
  // 基础类型
  add(groupResist, "combat.resistances.global.mod", "全局抗性 (Mod)"); // [补全]
  add(groupResist, "combat.resistances.skill.mod", "招式抗性 (Mod)"); // [补全]
  // 特殊类型
  for (const k of ["poison", "bleed", "fire", "mental", "liushi"]) {
    add(groupResist, `combat.resistances.${k}.mod`, `${game.i18n.localize("XJZL.Combat.Res." + k.charAt(0).toUpperCase() + k.slice(1))} (Mod)`);
  }

  // 6. 消耗减少 (Costs) - [这次主要补全的部分]
  const groupCost = "消耗减少"; // game.i18n.localize("XJZL.Combat.ReduceCost")
  add(groupCost, "combat.costs.neili.mod", "内力消耗减少 (Mod)");
  add(groupCost, "combat.costs.rage.mod", "怒气消耗减少 (Mod)");

  // 7. 技能 (Skills)
  const groupSkills = game.i18n.localize("XJZL.Skills.Label");
  // 确保 CONFIG.XJZL.skills 存在
  if (CONFIG.XJZL.skills) {
    for (const [k, labelKey] of Object.entries(CONFIG.XJZL.skills)) {
      add(groupSkills, `skills.${k}.mod`, `${game.i18n.localize(labelKey)} (Mod)`);
    }
  }

  // 8. 技艺 (Arts)
  const groupArts = game.i18n.localize("XJZL.Arts.Label");
  // 确保 CONFIG.XJZL.arts 存在
  if (CONFIG.XJZL.arts) {
    for (const [k, labelKey] of Object.entries(CONFIG.XJZL.arts)) {
      const label = game.i18n.localize(labelKey);
      add(groupArts, `arts.${k}.mod`, `${label} (等级 Mod)`);
      add(groupArts, `arts.${k}.checkMod`, `${label} (检定 Mod)`);
    }
  }

  return groups;
}