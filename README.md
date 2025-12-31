---

# 侠界之旅系统 (XJZL System) - Foundry VTT V13

![Foundry v13](https://img.shields.io/badge/Foundry-v13-orange)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

> **宁可无武，不可无侠。**
>
> 这是一个专为 **Foundry VTT V13** 开发的武侠跑团系统，基于《侠界之旅》规则集构建。

---

## ✨ 核心特性 (Features)

### 🧘‍♂️ 深度修炼系统 (Cultivation)
本系统还原了基于侠界之旅规则的修炼体验：
*   **多维修为池**：区分“通用修为”与“专属修为”（内功/武学/技艺）。
*   **境界突破**：内功分为“领悟、小成、圆满”三重境界，每重境界解锁不同特效。
*   **招式精进**：招式分为“领悟、掌握、精通、合一（天级）”三（四）重境界，升级可增强伤害与特效。

### ⚔️ 武侠战斗 (Hardcore Combat)
基于 V13 `ApplicationV2` 构建的现代化战斗流：
*   **虚实博弈**：根据侠界之旅规则，系统内置 **命中(Hit)**、**格挡(Block)**、**看破(Kanpo)** 与 **虚招(Feint)** 对抗逻辑。
*   **内/外功体系**：区分外功防御与内功防御，支持护体真气抵扣伤害。
*   **部位与穴位**：支持奇珍异宝镶嵌至特定经脉穴位。
*   **自动化结算**：一键应用伤害、治疗或 Buff，自动扣除气血、内力与怒气。

### 🧶 全周期脚本引擎 (Script Engine)
系统内置了强大的事件驱动脚本引擎，允许 GM 或模组作者为物品编写 JavaScript 逻辑：
*   **全时机覆盖**：支持 `Passive` (常驻)、`Attack` (出招前)、`Hit` (命中后)、`Damaged` (受击时)、`Dying` (濒死) 等 10+ 种触发时机。
*   **沙盒化环境**：内置 `Macros` 工具库，轻松实现是否触发架招、让对方检定属性失败则触发效果等复杂逻辑。
*   **所见即所得**：在物品栏直接编写代码，即刻生效。

### 🎨 其他特色 (Immersion)
*   **可视化经脉图**：在角色卡上直观查看十二正经与奇经八脉的打通情况。
*   **自定义移动规则**：重写底层网格算法，实现了侠界之旅“方格地图 只有第一次斜着走算1格，后面算2格”移动消耗规则。
*   **自定义属性组**：为一些无法实现自动化的情况，提供了丰富的手动属性加成选择。
---

## 📷 界面预览 (Screenshots)

### 角色卡片 (Character Sheet)
*集成了属性、装备、经脉与修炼面板的现代化界面。*
<details>
<summary><strong>点击展开：角色卡片界面</strong></summary>
<br>
<img width="1912" height="1290" alt="1" src="https://github.com/user-attachments/assets/0112c588-c1a2-4fd6-947f-b67938db64f9" />
<img width="1897" height="1297" alt="3" src="https://github.com/user-attachments/assets/3aafe9a4-9d32-43da-8cfd-f831e17c604c" />
<img width="1913" height="1300" alt="4" src="https://github.com/user-attachments/assets/d31d129c-1e2a-43fd-b373-5c7c0b4ad7d3" />
</details>

### 战斗交互 (Combat)
*支持普通攻击、趁虚而入以及详细的招式结算卡片。*
<details>
<summary><strong>点击展开：战斗交互卡片</strong></summary>
<br>
<img width="525" height="1206" alt="z1" src="https://github.com/user-attachments/assets/61f4d5bc-2a34-4b63-9f2b-967c1940dc1a" />
<img width="520" height="838" alt="z2" src="https://github.com/user-attachments/assets/456f033d-28db-43f7-a38f-5b4dc0afe45d" />
<img width="508" height="805" alt="z3" src="https://github.com/user-attachments/assets/657f3897-bd0b-46cf-b143-2ed96a4c5c62" />
<img width="516" height="1269" alt="z4" src="https://github.com/user-attachments/assets/6001e8b5-d9ea-460a-bfe3-e0205f05fef8" />
</details>

### 经脉与穴位 (Jingmai)
*可视化的穴位冲穴与奇珍镶嵌系统。*
<details>
<summary><strong>点击展开：经脉界面</strong></summary>
<br>
<img width="1916" height="1288" alt="6" src="https://github.com/user-attachments/assets/c914b504-a3fd-4be5-b90d-128e3744493e" />
</details>

### 手动修正 (CustomModifiers)
*为了避免自动化无法涉及的部分，添加了手动修正。*
<details>
<summary><strong>点击展开：手动修正界面</strong></summary>
<br>
<img width="1927" height="1307" alt="7" src="https://github.com/user-attachments/assets/34760172-169e-4cc2-a55c-a3cdade0df4c" />
</details>

---

## 🚀 安装指南 (Installation)

⚠️ **注意**：目前系统尚未发布正式 Release 版本，且正在进行数据合集包 (Compendium Packs) 的构建工作。在此期间，请通过以下方式手动安装。

### 手动安装步骤

1.  在本项目 GitHub 页面顶部，点击绿色的 **Code** 按钮。
2.  选择 **Download ZIP**。
3.  解压下载的压缩包。
4.  **【关键步骤】** 将解压后的文件夹重命名为 `xjzl-system` (必须与 `system.json` 中的 id 一致)。
5.  将该文件夹放入你的 Foundry VTT 用户数据目录：
    `.../Data/systems/xjzl-system`
6.  重启 Foundry VTT，在游戏世界设置中即可选择本系统。

> **提示**：正式的自动安装链接将在所有数据包制作完成后发布。
---

## 📖 脚本引擎简述 (Scripting)

本系统允许你在物品（内功、武学、装备）上绑定脚本。以下是一个简单的示例：

**示例：攻击附带中毒效果**
*触发时机：`hit` (命中后)*

```javascript
// 1. 发起体魄检定 (DC 15)
await Macros.requestSave({
    target: args.target,
    attacker: actor,
    type: "tipo", 
    dc: 15,
    label: "抵抗剧毒",
    
    // 2. 失败回调：应用中毒状态
    onFail: async () => {
        const poisonEffect = {
            name: "剧毒攻心",
            icon: "icons/svg/skull.svg",
            duration: { rounds: 3 },
            changes: [
                { key: "system.combat.speed", mode: 2, value: -2 }
            ]
        };
        await args.target.createEmbeddedDocuments("ActiveEffect", [poisonEffect]);
        ui.notifications.warn(args.target.name + " 中毒了！");
    }
});
```

<details>
<summary><strong>📚 点击展开：脚本引擎完整开发文档 (Script Engine API)</strong></summary>
<br>

# 📖 侠界之旅 (XJZL) - 脚本与特效开发指南

**适用对象**: 游戏主持人 (GM)、模组制作者、高阶玩家

本系统内置了一套**全周期事件驱动脚本引擎**。作为创作者，你可以通过编写 JavaScript 代码片段，实现内功特效、武学逻辑、装备特质以及复杂的战斗交互。

---

## 🏗️ 1. 核心概念与环境

### 1.1 哪里写脚本？
在 **内功**、**武学招式**、**武器/装备** 的详情页中，点击 **“添加特效”**，并在编辑器中输入代码。

### 1.2 沙盒变量 (Global Context)
系统为每一段脚本注入了以下全局变量，你可以直接使用：

| 变量名 | 类型 | 说明 |
| :--- | :--- | :--- |
| **`actor`** | `XJZLActor` | 当前**运行该脚本的角色**实例（施法者/佩戴者/被击者）。 |
| **`system`** | `Object` | `actor.system` 的引用。核心数据源。 |
| **`S`** | `Object` | `system` 的简写别名。例如 `S.stats.liliang.total`。 |
| **`thisItem`** | `XJZLItem` | **当前脚本所属的物品**（如：正在生效的内功、护甲）。用于引用自身数据（如等级、图片）。 |
| **`move`** | `Object` | **当前正在施展的招式数据** (仅限招式相关脚本)。 |
| **`args`** | `Object` | **上下文参数包**。包含当前事件的所有信息（如伤害值、命中结果、目标）。内容随触发时机变化。 |
| **`Macros`** | `Class` | **系统工具箱**。包含 `requestSave` 等高级功能。 |
| **`game`, `ui`** | - | Foundry VTT 核心全局对象。 |

---

## ⚡ 2. 触发时机完全详解

脚本分为 **同步 (Sync)** 和 **异步 (Async)** 两种模式。
*   **同步**: 用于属性计算，**严禁**使用 `await` 或数据库操作。
*   **异步**: 用于流程交互，**必须**使用 `await` 进行数据修改或弹窗。

### A. 属性与状态计算 (同步)

#### 🛡️ `passive` (被动常驻)
*   **时机**: 角色数据初始化时 (`prepareDerivedData`)。
*   **用途**: 修改属性修正值 (`.mod`)、开启状态开关。
*   **生效前提**: 内功运行中、装备已穿戴、架招已开启。
*   **代码示例**:
    ```javascript
    // 气血低于30%时，外功防御 +10
    if (S.resources.hp.value / S.resources.hp.max < 0.3) {
        S.combat.def_waigong += 10;
    }
    // 开启“被动格挡”状态
    actor.xjzlStatuses.passiveBlock = true;
    ```

#### 🧮 `calc` (数值计算)
*   **时机**: 计算招式伤害或治疗面板时。
*   **args 内容**: `{ move, baseData, output }`
*   **用途**: 修改 `args.output.damage` (基础伤害/治疗量) 或 `feint` (虚招值)。
*   **代码示例**:
    ```javascript
    // 每100内力修为提供 1 点额外伤害
    const extra = Math.floor(S.resources.mp.value / 100);
    args.output.damage += extra;
    args.output.bonusDesc.push(`修为加持(+${extra})`);
    ```

#### 🎯 `check` (检定修正/比对)
*   **时机**: 掷骰前，针对**每一个目标**分别运行。
*   **args 内容**: `{ target, flags }`
*   **flags 可修改项**:
    *   `grantLevel`: 命中优劣势修正 (+/-)
    *   `grantFeintLevel`: 虚招优劣势修正 (+/-)
    *   `ignoreBlock/Defense/Stance`: 是否对该目标穿透。
*   **用途**: “若目标处于中毒状态，则本次攻击无视格挡”。
*   **代码示例**:
    ```javascript
    // 目标有 "poison" 状态，赋予无视格挡
    // (注: statuses 是 FVTT 核心集合，也可以用 target.xjzlStatuses.poison)
    if (args.target.statuses.has("poison")) {
        args.flags.ignoreBlock = true;
    }
    ```

---

### B. 战斗流程交互 (异步)

#### ⚔️ `attack` (出招前)
*   **时机**: 点击招式按钮，资源（含士气）扣除后，掷骰前。
*   **args 内容**: `{ move, flags }`
*   **flags 可修改项**: 
    *   `level` (自身命中修正)
    *   `feintLevel` (虚招修正)
    *   `abort` (阻断)
    *   **`autoApplied`**: 设为 `true` 可隐藏聊天卡片上的“应用”按钮（用于脚本已自动处理全部逻辑的场合，如“天魔解体”）。
*   **用途**: 自身状态检查、消耗特殊资源、给予自身优势、接管后续流程。
*   **代码示例**:
    ```javascript
    // 隐身时出招获得优势
    if (actor.xjzlStatuses.invisible) {
        args.flags.level += 1; // 叠加优势
    }
    ```

#### 🌪️ `preDamage` (伤害结算前) - ****
*   **时机**: 命中、暴击、击破状态已确定，但在调用防御者减伤逻辑(`applyDamage`)之前。
*   **args 内容**:
    *   `outcome`: `{ isHit, isCrit, isBroken }` (**只读**，本次判定的结果)。
    *   `config`: `{ amount, type, ignoreBlock, ignoreDefense, ignoreStance, applyCritDamage }` (**可修改**，传入防御结算的参数)。
*   **用途**: 实现“暴击后转为精神伤害”、“命中后伤害类型改变”等逻辑。
*   **代码示例**:
    ```javascript
    // 如果本次攻击暴击了
    if (args.outcome.isCrit) {
        // 将伤害类型强制转为 "mental" (精神)
        args.config.type = "mental";
        // 赋予无视防御
        args.config.ignoreDefense = true;
        ui.notifications.info("暴击触发！转化为精神冲击！");
    }
    ```

#### 🩸 `hit` (结算/应用) - **[核心更新]**
*   **时机**: 点击“应用伤害”、“应用治疗”或“应用效果”后，对**每个目标**运行。
*   **args 内容 (通用)**:
    *   `target`: 目标角色 Actor。
    *   `type`: `"attack"`, `"heal"` 或 **`"buff"`** (用于区分脚本逻辑)。
    *   `isHit`: 对于攻击是命中结果；对于治疗/Buff **恒为 true**。
    *   `isCrit`: 是否暴击 (治疗目前恒为 false)。
    *   ** `isBuff`**: Boolean，是否为辅助/气招类型。
*   **args 内容 (攻击特有)**:
    *   `hpLost`, `hutiLost`: 实际造成的损失。
    *   `damageResult`: 完整的伤害结算对象。
*   **args 内容 (治疗/Buff 特有)**:
    *   `baseAmount`: 面板数值 (治疗量或强度)。
    *   **[变更] `finalAmount`**: 
        *   若 `type === 'heal'`: 实际应用到 HP 上的回复量。
        *   若 `type === 'buff'`: 等于 `baseAmount` (视为强度 Potency)，**不会**自动加血，脚本可根据此数值决定护盾厚度等。
*   **用途**: **最常用**。施加 Buff/Debuff、吸血、额外回复内力。
*   **代码示例 (通用 Buff)**:
    ```javascript
    // 无论攻击还是治疗，都给目标上个 Buff
    const effectData = { name: "余韵", ... };
    await args.target.createEmbeddedDocuments("ActiveEffect", [effectData]);
    ```
*   **代码示例 (治疗回蓝)**:
    ```javascript
    // 如果是治疗招式，额外回复 5 点内力
    if (args.type === 'heal') {
        // 使用 applyHealing 接口，type 设为 mp
        await args.target.applyHealing({ amount: 5, type: "mp" });
    }
    ```

#### 🩸 `hit_once` (全局结算)
*   **时机**: 所有目标处理完毕后，执行一次。
*   **args 内容**: `{ targets: [], hitCount, totalHealAmount ... }`
*   **用途**: 群攻/群奶后的自身反馈。
*   **代码示例**:
    ```javascript
    // 群奶后，根据总奶量回气
    if (args.type === 'heal' && args.totalHealAmount > 50) {
        ui.notifications.info("医术高超，气顺神清！");
        await actor.applyHealing({ amount: 10, type: "mp" });
    }
    ```

#### 🛡️ `damaged` (受伤/受击)
*   **时机**: 角色即将扣血时（防御者视角）。
*   **args 内容**: `{ attacker, type, damage, ignoreStance, output }`
*   **用途**: 护盾、减伤、反伤、触发架招特效。
*   **代码示例 (标准架招写法)**:
    ```javascript
    // 1. 使用助手检查架招触发条件 (含是否被穿透)
    if (!Macros.checkStance(actor, args)) return;

    // 2. 减伤 50%
    args.output.damage = Math.floor(args.damage * 0.5);
    
    // 3. 反伤
    // (需手动构造伤害数据回敬 attacker，此处略)
    ```

#### 💀 `dying` / `death` (濒死/死亡)
*   **时机**: 气血归零 / 内力归零时。
*   **args 内容**: `{ preventDying, preventDeath }`
*   **用途**: 免死金牌、凤凰涅槃。
*   **代码示例**:
    ```javascript
    // 免疫一次死亡，并回满血
    args.preventDeath = true;
    // 使用新的治疗接口回满
    await actor.applyHealing({ amount: S.resources.hp.max, type: "hp" });
    ui.notifications.warn(`${actor.name} 涅槃重生！`);
    // 记得销毁这个特效本身，防止无限复活
    await thisItem.delete();
    ```

---

## 🛠️ 3. 宏工具箱 (Macros API)

为了简化复杂逻辑，系统封装了 `Macros` 工具类，可在脚本中直接调用。

### 3.1 `Macros.requestSave(options)`
**功能**: 向目标发起属性判定请求（点穴、中毒豁免等）。
**特点**: 自动发送聊天卡片，等待目标点击，失败自动应用 Debuff。

**参数对象 (`options`)**:
*   `target` (Actor): 目标角色。
*   `type` (String): 属性或技能 Key (如 `neixi`, `qiaoshou`)。
*   `dc` (Number): 难度等级。
*   `label` (String, 可选): 卡片标题。
*   `level` (Number, 可选): 赋予目标的优劣势 (正数优, 负数劣)。
*   `onFail` (Object, 可选): 失败时应用的 Active Effect 数据。

**完整示例 (写在 HIT 脚本中)**:
```javascript
// 定义晕眩 Debuff (使用新的原子化 flag)
const debuff = {
    name: "点穴 (晕眩)",
    icon: "icons/svg/daze.svg",
    duration: { rounds: 1 },
    // 晕眩=定身(stun) + 禁足(SpeedZero/DodgeZero) + 破绽(GrantAttack)
    changes: [
        { key: "flags.xjzl-system.stun", mode: 5, value: "true" },
        { key: "flags.xjzl-system.forceSpeedZero", mode: 5, value: "true" },
        { key: "flags.xjzl-system.forceDodgeZero", mode: 5, value: "true" }
    ]
};

// 发起判定：内息 DC 15
await Macros.requestSave({
    target: args.target,
    attacker: actor,
    type: "neixi",
    dc: 15,
    label: "点穴劲力",
    level: -1,     // 哪怕对方属性高，这次判定也强制劣势
    onFail: debuff // 失败自动挂晕眩
});
```

### 3.2 `Macros.checkStance(actor, args)`
**功能**: 检查当前是否满足触发架招特效的所有硬性条件。
**检查项**: 架招开启 + 命中 + 内外功类型 + 未被无视架招。
**返回值**: `Boolean`

---

## 📊 4. 可修改属性全表 (Attribute Paths)

在 **Active Effect** 或 **Passive 脚本** 中，你可以通过以下路径修改属性。
**通用前缀**: `system.` (在 AE 中使用) 或 `S.` (在脚本中使用)。

### A. 七维属性 (Stats)
*   **修改方式**: 针对 `.mod` 进行 `ADD` (加减)。
*   **路径**: `stats.[key].mod`
*   **Key 列表**: `liliang`, `shenfa`, `neixi`, `tipo`, `qigan`, `shencai`, `wuxing`

### B. 战斗属性 (Combat)
*   **修改方式**: 直接修改属性本身，`ADD` (加减)。
*   **路径**: `combat.[key]`
*   **Key 列表**:
    *   `block` (格挡), `kanpo` (看破), `xuzhao` (虚招加值)
    *   `speed` (速度), `dodge` (闪避), `initiative` (先攻)
    *   `hit_waigong`, `hit_neigong` (命中)
    *   `def_waigong`, `def_neigong` (防御)
    *   `crit_waigong`, `crit_neigong` (暴击, 越低越好)

### C. 伤害与抗性 (Damages & Resistances)
*   **修改方式**: 针对 `.mod` 进行 `ADD`。
*   **路径**: `combat.[category].[key].mod`
*   **Damages (category=damages)**:
    *   `global` (全局), `weapon` (兵器)
    *   `skill` (招式) **[常用]**
    *   `yang`, `yin`, `gang`, `rou`, `taiji` (五行)
*   **Resistances (category=resistances)**:
    *   `global` (全局), `skill` (招式抗性)
    *   `poison` (毒), `bleed` (血), `fire` (火), `mental` (神), `liushi` (流)

### D. 资源上限与减耗
*   **HP/MP 上限**: `resources.hp.bonus`, `resources.mp.bonus` (注意是 bonus)
*   **消耗减少**: `combat.costs.neili.mod` (内力减耗), `combat.costs.rage.mod` (怒气减耗)

### E. 技能 (Skills)
*   **修改方式**: 针对 `.mod` 进行 `ADD`。
*   **路径**: `skills.[key].mod`
*   **常用 Key**: `qinggong` (轻功), `qiaoshou` (巧手), `liaoshang` (疗伤), `dianxue` (点穴) ... (参见技能列表)

---

## 🚩 5. 状态标志 (Flags) 速查

在 **Active Effect** 中，Key 为 `flags.xjzl-system.[FlagName]`。
在 **脚本** 中，通过 `actor.xjzlStatuses.[FlagName]` 读取，或直接修改 Flag。

### A. 自动化回复 (数值型, ADD)
> **功能**: 在特定时机自动回/扣资源。正数=回复，负数=消耗。

| Key | 说明 | Key | 说明 | Key | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `regenHpTurnStart` | 回合开始回血 | `regenHpTurnEnd` | 回合结束回血 | `regenHpAttack` | 出招时回血 |
| `regenMpTurnStart` | 回合开始回内 | `regenMpTurnEnd` | 回合结束回内 | `regenMpAttack` | 出招时回内 |
| `regenRageTurnStart`| 回合开始回怒 | `regenRageTurnEnd`| 回合结束回怒 | `regenRageAttack`| 出招时回怒 |

### B. 检定修正 (数值型, ADD)
> **功能**: 影响 `rollAttributeTest` (判定/检定) 的骰子。正数=优势(kh)，负数=劣势(kl)。

*   **全局**: `globalCheckLevel` (影响所有检定)
*   **属性**: `liliangCheckLevel`, `shenfaCheckLevel`, `neixiCheckLevel` ... (对应七维)
*   **技能**: `qiaoshouCheckLevel`, `qinggongCheckLevel` ... (对应所有技能 Key + CheckLevel)

### C. 战斗博弈 (数值型, ADD)
> **功能**: 影响战斗中的命中与虚招对抗。

| Key | 作用方 | 含义 |
| :--- | :--- | :--- |
| **`attackLevel`** | 自身 | 我攻击时的命中优劣势。 |
| **`grantAttackLevel`** | 目标 | 别人攻击我时的命中优劣势 (如：空门大开+1)。 |
| **`feintLevel`** | 自身 | 我施展虚招(攻) 或 进行看破(守) 时的优劣势。 |
| **`defendFeintLevel`** | 目标 | 别人对我施展虚招时的优劣势 (如：心神不宁+1)。 |

### D. 行为穿透 (布尔型, OVERRIDE)
> **功能**: 通常由攻击者持有，用于无视目标的防御手段。设为 `true` 生效。

| Key | 说明 |
| :--- | :--- |
| `ignoreBlock` | **无视格挡**。目标的格挡值归零。 |
| `ignoreDefense` | **无视防御**。目标的内/外功防御归零 (真实伤害)。 |
| `ignoreStance` | **无视架招**。目标的格挡值中扣除架招部分，且**不会触发**架招的 `DAMAGED` 特效。 |
| `ignoreArmorEffects` | **无视防具 (破衣)**。目标防具的被动属性和脚本全部失效。 |

### E. 行为与数值封锁 (布尔型, OVERRIDE)
> **功能**: 强控状态或数值置零。设为 `true` 生效。

| Key | 说明 |
| :--- | :--- |
| `stun` | **晕眩/定身**。无法行动，解除架招。 |
| `silence` | **封穴**。无法施展招式。 |
| `forceUnarmed` | **缴械**。只能使用徒手招式。 |
| `brokenDefense` | **破甲**。外功防御力强行置零。 |
| `forceSpeedZero` | **禁足/速度归零**。移动速度强行置零。 |
| `forceDodgeZero` | **闪避归零**。闪避值强行置零。 |
| `blockShiZhao`... | **封招系列**。禁止施展实招/虚招/气招/反击/绝招。 |
| `noRecoverHP`... | **禁疗系列**。禁止气血/内力/怒气回复。 |

### F. 特殊状态与数值修正
> **功能**: 包含特殊机制开关或线性百分比修正。

| Key | 类型 | 说明 |
| :--- | :--- | :--- |
| `passiveBlock` | Bool | **被动格挡**。即使未开启架招，面板格挡值依然生效。 |
| `bleedOnHit` | Number | **撕裂**。受到伤害时，额外流失 X 点气血。 |
| `wuxueBleedOnHit`| Number | **旧疾**。仅受内外功伤害时，额外流失 X 点气血。 |
| `unstable` | Bool | **下盘不稳**。最终移动速度减半 (Floor)。 |
| `bloodLossLevel` | Number | **失血层数**。每层使最大气血上限降低 10% (线性叠加)。 |

---

## 📝 6. 武学招式创建与脚本指南 (Wuxue & Scripts)

随着 V13 版本的更新，招式系统引入了“行为分流”机制。本章将指导你如何创建复杂的辅助、治疗和控制类招式。

### 6.1 招式配置逻辑

对于 **气招 (Qi)**，你需要根据其具体效果选择 **“结算模式 (Action Type)”**：

*   **默认/Buff (Default)**:
    *   **用途**: 给自身或队友施加状态、无伤害的 Debuff。
    *   **逻辑**: 无需命中检定。卡片显示**“应用效果”**。数值(`baseAmount`)作为**强度**传递给脚本，**不会**自动扣血/回血。
    *   **目标**: 如果未选中目标，**默认对自己生效**。
*   **治疗 (Heal)**:
    *   **用途**: 回复气血 (HP)。
    *   **逻辑**: 无需命中检定。点击“应用治疗”后自动回复面板数值。
    *   **目标**: 如果未选中目标，**默认对自己生效**。
*   **攻击 (Attack)**:
    *   **用途**: 造成伤害（如音波功、精神攻击）。
    *   **逻辑**: 只有伤害类型为 **外功/内功** 时才需要命中检定。**精神/无** 类型为必中。
    *   **目标**: **必须**选中目标，否则报错。

---

### 6.2 常见复杂招式脚本范例

请将以下代码粘贴到招式的 **脚本 (Scripts)** 编辑器中，触发时机通常选择 **`hit`**。

#### A. 给目标施加 Buff (如：提升移动速度)
> **场景**: 气招 (Buff)，选中队友或自己，持续 3 回合。

```javascript
// 1. 定义 Active Effect 数据结构
const effectData = {
    name: "神行百变",
    icon: "icons/svg/wing.svg", // 图标路径
    origin: item.uuid,
    duration: { rounds: 3 },    // 持续时间
    description: "移动速度提升 3 点。",
    changes: [
        // 修改战斗属性：速度 +3
        { key: "system.combat.speed.mod", mode: 2, value: 3 }
    ]
};

// 2. 给目标创建特效
// args.target 可能是选中的队友，也可能是施法者自己(隐式目标)
await args.target.createEmbeddedDocuments("ActiveEffect", [effectData]);

// 3. (可选) 飘字反馈
if (args.target.token?.object) {
    canvas.interface.createScrollingText(args.target.token.object.center, "神行", {
        fill: "#00FF00", stroke: "#000000", strokeThickness: 4
    });
}
```

#### B. 治疗 + 回复内力 (如：提按端挤)
> **场景**: 气招 (Heal)。面板设置 10 点治疗量 (自动回血)，脚本负责回内力。

```javascript
// args.finalAmount 是实际回复的气血量
if (args.finalAmount > 0) {
    // 额外回复 5 点内力
    await args.target.applyHealing({ 
        amount: 5, 
        type: "mp", 
        showScrolling: true 
    });
}
```

#### C. 精神伤害 + 定力检定 (如：醉里吴音)
> **场景**: 气招 (Attack)，伤害类型选 `Mental`。
> **逻辑**: 点击应用伤害时，先不扣血，而是发起检定。如果检定失败再扣血。

```javascript
// 1. 阻止默认的伤害应用 (如果是 Attack 模式)
// 注意：对于精神伤害，通常建议面板填 0，完全由脚本控制扣血，或者面板填全额，脚本控制减半
// 这里演示面板填 0，脚本全权负责

// 2. 发起检定请求
await Macros.requestSave({
    target: args.target,
    attacker: actor,
    type: "dingli", // 定力检定
    dc: 13,         // 难度
    label: "抵抗靡靡之音",
    
    // 检定失败的回调：直接扣血
    onFail: async () => {
        // 造成 10 点伤害
        await args.target.applyDamage({
            amount: 10,
            type: "mental", // 精神伤害
            attacker: actor,
            isHit: true,
            ignoreDefense: true // 精神伤害无视防御
        });
        ui.notifications.info(`${args.target.name} 受到精神重创！`);
    }
});
```

#### D. 自动化回血 Buff (如：养血)
> **场景**: 气招 (Buff)。给目标上一个状态，让他每回合结束自动回血。

```javascript
const effectData = {
    name: "养血",
    icon: "icons/magic/life/heart-cross-green.webp",
    duration: { rounds: 3 },
    changes: [
        // 修改自动化 Flag: 回合结束回血 (regenHpTurnEnd)
        // mode: 2 (ADD) 表示叠加
        { key: "flags.xjzl-system.regenHpTurnEnd", mode: 2, value: 10 }
    ]
};

await args.target.createEmbeddedDocuments("ActiveEffect", [effectData]);
```

#### E. 随等级成长的特效 (如：万龙馈影)
> **场景**: 架招或攻击。给目标施加一个 Debuff（如蛇瘴），其**数值**和**最大层数**随着招式等级提升而增加。
> **前置**: 在武学物品中先创建一个名为“蛇瘴”的特效作为**模板**（数值填基础值即可）。

```javascript
// 1. 获取特效模板
// thisItem 指向当前武学，我们在其中查找名为 "蛇瘴" 的 AE
const sourceEffect = thisItem.effects.getName("蛇瘴");
if (!sourceEffect) return ui.notifications.warn("特效模板缺失");

// 2. 克隆数据 (转为普通 Object)
const effectData = sourceEffect.toObject();
delete effectData._id;          // 清除 ID 以便创建新实例
effectData.origin = thisItem.uuid; // 确保来源指向本武学

// 3. 获取当前招式等级
// args.move 包含了当前招式的运行时数据
const lvl = Math.max(1, args.move.computedLevel || 1);

// 4. 动态修改数据 (原生 JS 操作)

// A. 修改最大层数 (基础3层，每级+1)
// Manager 会自动处理层数升级逻辑
const newMax = 3 + (lvl - 1) * 1;
foundry.utils.setProperty(effectData, "flags.xjzl-system.maxStacks", newMax);

// B. 修改流失数值 (基础5点，每级+5)
// 找到控制流失的 change 条目 (假设是第一个，或者通过 key 查找)
const change = effectData.changes.find(c => c.key === "flags.xjzl-system.regenHpTurnStart");
if (change) {
    // 注意：流失通常是负数
    const val = -5 + (lvl - 1) * (-5);
    change.value = String(val);
}

// 5. 应用特效
// 调用 API 挂载到目标身上 (attacker 是触发架招的人)
await game.xjzl.api.effects.addEffect(args.attacker, effectData);

// 6. 飘字
if (actor.token?.object) {
    canvas.interface.createScrollingText(actor.token.object.center, "蛇瘴入体", { 
        fill: "#8e44ad", stroke: "#000000", strokeThickness: 4 
    });
}
```

#### F. 进阶消耗品：武器淬毒 (虚拟物品法)
> **场景**: 使用一瓶“鹤顶红”。你希望它不是立即生效，而是给你的武器“淬毒”。当你**下一次攻击命中**敌人时，触发敌人的体魄检定，失败则中毒。
> **原理**: 消耗品本身无法监听 `HIT` (命中) 事件。我们需要在 `usageScript` 中，在角色身上动态创建一个**临时的虚拟物品**（如一个隐形的奇珍），由这个虚拟物品来承载 `HIT` 脚本。

```javascript
// 写在消耗品的 [使用脚本] 中

// 1. 定义虚拟物品数据
// 我们创建一个临时的"奇珍"装备到身上，作为毒药效果的容器
const virtualItemData = {
    name: "淬毒效果 (临时)",
    type: "qizhen", // 借用奇珍类型
    img: "icons/svg/poison.svg",
    system: {
        equipped: true, // 必须设为已装备，脚本才会生效
        description: "攻击命中时触发剧毒判定。",
        // --- 核心：在虚拟物品里嵌套定义脚本 ---
        scripts: [
            {
                label: "毒发逻辑",
                trigger: "hit", // 监听命中事件
                active: true,
                // 注意：这里的 script 是字符串形式的代码
                script: `
                    // --- 以下代码将在攻击命中时执行 ---
                    
                    // 1. 发起判定请求
                    await Macros.requestSave({
                        target: args.target,
                        attacker: actor,
                        type: "tipo", // 体魄检定
                        dc: 15,       // 难度
                        label: "抵抗剧毒",
                        
                        // 2. 失败回调：应用中毒状态
                        onFail: async () => {
                            const poisonEffect = {
                                name: "剧毒攻心",
                                icon: "icons/svg/skull.svg",
                                duration: { rounds: 3 },
                                changes: [
                                    { key: "system.combat.speed", mode: 2, value: -2 }
                                ]
                            };
                            await args.target.createEmbeddedDocuments("ActiveEffect", [poisonEffect]);
                            ui.notifications.warn(args.target.name + " 中毒了！");
                        }
                    });

                    // 3. (可选) 触发一次后销毁虚拟物品 (一次性毒药)
                    // 如果不写这行，就是持续性淬毒
                    await thisItem.delete();
                `
            }
        ]
    }
};

// 2. 将虚拟物品创建到角色身上
await actor.createEmbeddedDocuments("Item", [virtualItemData]);
ui.notifications.info("兵刃已淬毒！下一次攻击将触发特效。");
```

#### G. 瞬发型气招 (如：天魔解体)
> **场景**: 气招 (Buff)。点击招式后，无需选择目标，立即执行脚本（如：扣血加攻）并隐藏聊天卡片上的按钮。
> **原理**: 使用 `autoApplied` 标记接管 UI 流程。

```javascript
// 触发时机: ATTACK (出招前)

// 1. 执行逻辑：扣除自身 30% 气血，获得攻击力 Buff
const hpCost = Math.floor(S.resources.hp.max * 0.3);
if (S.resources.hp.value <= hpCost) {
    ui.notifications.warn("气血不足以施展天魔解体！");
    args.flags.abort = true; // 阻断出招
    return;
}

// 扣血
await actor.applyDamage({ amount: hpCost, type: "true", isHit: true });

// 上 Buff
const buff = {
    name: "天魔解体",
    icon: "icons/svg/blood.svg",
    changes: [{ key: "system.combat.damages.global.mod", mode: 2, value: 50 }]
};
await actor.createEmbeddedDocuments("ActiveEffect", [buff]);

// 2. 关键：告诉系统“我已经处理完了”，隐藏卡片按钮
args.flags.autoApplied = true;

ui.notifications.info(`${actor.name} 施展了天魔解体！`);
```

#### H. 让特殊攻击暴击 (如：摄魂一击)
> **场景**: 攻击 (Attack)。普通命中是外功伤害，外功伤害可以暴击，但如果**暴击**，则转化为**精神伤害**（特殊伤害不能暴击，这样就达成了暴击的特殊伤害）。
> **触发时机**: `preDamage`

```javascript
// 检查只读状态：是否暴击
if (args.outcome.isCrit) {
    // 修改伤害配置
    args.config.type = "mental";
    
    // 提示
    ui.notifications.warn("摄魂一击触发暴击！转化为精神伤害！");
}
```

---

## 📝 7. 最佳实践

1.  **数值修改规范**:
    *   在 `attack` / `check` 脚本中修改 `flags.level` 等数值时，**请使用 `+=`** (如 `args.flags.level += 1`)，以免覆盖其他特效。

2.  **Item 引用**:
    *   使用 `thisItem` 来引用脚本所属的物品（如“本剑”）。
    *   使用 `item` (如果存在于 args) 来引用触发事件的物品（如“攻击者用的剑”）。

3.  **判断逻辑**:
    *   尽量使用 `Macros` 提供的助手函数（如 `checkStance`），避免手动写复杂的 `if` 判断，减少 Bug。

4.  **调试技巧**:
    *   善用 `console.log(args)` 在 F12 控制台查看当前上下文里到底有什么。
    *   善用 `ui.notifications.info("...")` 来确认脚本是否执行到了某一行。

5.  **资源消耗警告 (士气/内力)** 
    *   **士气 (Morale)**: 现在系统采用“出招即消耗”机制。在运行 `hit` 脚本时，角色的士气值已被清空（转化为伤害加成）。若需知晓本次消耗了多少士气，请勿读取 `S.resources.morale.value`（它现在是0），而应根据业务逻辑自行判断，或等待系统未来提供历史快照。

</details>

---

## 👥 贡献与鸣谢 (Credits)

*   **系统作者**: Tiwelee
*   **特别感谢**:
    *   **一气长虹**: 提供了核心数据类型设计、计算逻辑参考以及无私的规则指导。
    *   **安迪亚**: 提供了宝贵的界面设计建议与测试反馈。

---

> **🎨 素材声明**：系统内包含的大部分图像素材由 AI 生成（非AI生成素材由侠界之旅官方提供）。

## 📄 协议 (License)

本项目采用 [MIT License](LICENSE) 开源。
允许在遵守协议的前提下自由修改、分发与使用。
