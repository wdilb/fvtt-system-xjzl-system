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