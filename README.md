---

# 侠界之旅系统 (XJZL System) - Foundry VTT V13

![Foundry v13](https://img.shields.io/badge/Foundry-v13-orange)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

> **宁可无武，不可无侠。**
>
> 这是一个专为 **Foundry VTT V13** 开发的武侠跑团系统，基于《侠界之旅》规则集构建。

> [![QQ Group](https://img.shields.io/badge/侠界交流群-753714737-blue?logo=tencent-qq&logoColor=white)](https://qm.qq.com/cgi-bin/qm/qr?k=YOUR_LINK)
> [![QQ Group](https://img.shields.io/badge/系统反馈群-818849921-blue?logo=tencent-qq&logoColor=white)](https://qm.qq.com/cgi-bin/qm/qr?k=YOUR_LINK)
> <img width="3077" height="1687" alt="image" src="https://github.com/user-attachments/assets/fedfaa11-de4c-42b3-9944-64d601bf47d6" />

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

# 📖 侠界之旅 (XJZL) - 脚本与特效开发全书 (v6.0)

**适用版本**: Foundry VTT V13 (XJZL System)
**目标读者**: 游戏主持人 (GM)、模组制作者、脚本开发者

本系统内置了一套**全周期事件驱动脚本引擎**。作为创作者，你可以通过编写 JavaScript 代码片段，介入游戏逻辑的每一个环节：从属性计算、出招判定、防御结算到最终的伤害应用。

---

## 🏗️ 1. 核心概念与环境

### 1.1 脚本编写位置
1.  **物品 (Item)**: 在 **内功**、**武学招式**、**武器/装备** 的详情页 -> “特效”页签。
2.  **状态 (Active Effect)**: 在 **Active Effect** 的配置页 -> “脚本”页签。
    *   *推荐*: 将持续性效果（如中毒、持续回血）写在 Active Effect 中。当 AE 被移除时，脚本逻辑会自动停止，无需手动清理。

### 1.2 沙盒变量 (Global Context)
系统为每一段脚本注入了以下全局变量。为了保证脚本的健壮性，**强烈建议使用 `args.xxx` 来访问参数**。

| 变量名 | 类型 | 详细说明 |
| :--- | :--- | :--- |
| **`args`** | `Object` | **上下文参数包**。包含当前事件的所有信息（如伤害值、目标、配置项）。**内容随触发时机变化**，详见下文各章节。 |
| **`actor`** | `XJZLActor` | **当前脚本的宿主角色**。<br>通常是施法者、攻击者或佩戴者。<br>⚠️ **注意**: 在防御类触发器（如 `PRE_DEFENSE`, `DAMAGED`）中，它是**防御者**。 |
| **`attacker`** | `XJZLActor` | **动作的发起者**。<br>在绝大多数触发器中都会显式提供。即使 `actor` 是防御者，你也可以通过 `attacker` 找到是谁打了你。 |
| **`system`** | `Object` | `actor.system` 的引用。角色的核心数据源（属性、资源、combat数据等）。 |
| **`S`** | `Object` | `system` 的简写别名。例如 `S.stats.liliang.total`。 |
| **`thisItem`** | `Item` \| `Effect` | **脚本的物理位置**。<br>指向**这段脚本存放的地方**。如果脚本写在“金蛇剑”里，它是金蛇剑；如果脚本写在“中毒”BUFF里，它是中毒BUFF。 |
| **`thisEffect`** | `ActiveEffect` | **脚本宿主特效指针**。<br>仅当脚本挂载在 Active Effect 上时存在。|
| **`item`** | `Item` | 由 `roll()` 或 `_applyDamage` 通过 `context` 传入。  **仅限主动时机**<br>(`attack`, `hit`, `calc`, `check`)  **动作的发起源**。<br>仅指武学，因为全部的动作由武学主动发起，注意不是招式。<br>❌ **在被动/防御/回合结算时 (`damaged`, `turnStart`) 为 `undefined`。** |
| **`move`** | `Object` | **当前正在施展的招式数据**。<br>✅ **主动出招时** (`attack`, `hit`, `calc`, `check`): 指向**你正在使用**的那一招。<br>> **⚠️ 重要**: 即使脚本写在**内功、装备或BUFF**上，只要是因为你出招而触发，这里读取到的就是你**手里那一招**的数据（例如：用“太极剑”出招触发了身上“纯阳内功”的脚本，这里的 `move` 就是“太极剑”）。<br>💡 **被动时** (`passive`): 仅当脚本写在**招式内部**时，指向该招式自身；写在其他地方（如内功/装备）为 `undefined`。<br>❌ **受击/防御时(avoided、preDefense、preTake、damaged)**: **`undefined`**。 |
| **`trigger`** | `String` | **当前触发时机**。例如 `"attack"`, `"hit"`, `"damaged"`。用于在同一脚本中处理多重逻辑。 |
| **`Macros`** | `Class` | **系统工具箱**。提供 `requestSave` (发起检定), `checkStance` (架招判断) 等静态方法。 |
| **`console`** | `Console` | 浏览器控制台，用于 `console.log(args)` 调试。 |
| **`game`, `ui`** | `Object` | Foundry VTT 核心全局对象。 |

---

## ⚡ 2. 触发时机与参数全解 (API Reference)

### A. 属性与状态计算 (同步阶段)
> ⚠️ **警告**: 此阶段**严禁**使用 `await` 或进行数据库操作（如 `update`, `createEmbeddedDocuments`）。

#### 🛡️ `passive` (被动常驻)
*   **时机**: 角色数据初始化时 (`prepareDerivedData`)。
*   **用途**: 修改基础属性修正值 (`.mod`)、开启状态开关。
*   **生效范围 (重要)**: 为了保障系统性能，系统**不会**遍历所有武学的所有招式。`PASSIVE` 脚本仅在以下情况生效：
    1.  **特殊功法**: 类型为 **轻功 (qinggong)**、**散手 (sanshou)**、**阵法 (zhenfa)** 的武学，其所有招式下的脚本都会运行。
    2.  **当前架招**: 角色当前**已开启**的那个架招 (`martial.stance`)，其脚本会运行。
    *   *注意：普通武学 (wuxue) 的实招/虚招/气招中编写 `passive` 脚本将**不会**生效。*
*   **参数 (`args`)**:
    *   `move` (Object): **当前招式数据**。这是关键参数，允许脚本根据招式等级成长 (例如 `args.move.computedLevel`)。
    *   `item` (Item): 所属的物品对象。
    *   `actor` (Actor): 角色实例。

#### 🧮 `calc` (数值计算)
*   **时机**: 计算招式面板数值时 (显示预览或掷骰前)。
*   **用途**: 修改招式的面板伤害或虚招值。
*   **参数 (`args`)**:
    *   `move` (Object): 当前招式数据。
    *   `item` (Item): 来源物品。
    *   `baseData` (Object, **只读**): 基础数值参考。
        *   `base` (Number): 招式自带的基础伤害 (基础 + 成长 * 等级)。
        *   `weapon` (Number): 武器提供的伤害值 (如未装备匹配武器则为0)。
        *   `level` (Number): 招式的当前计算等级。
        *   `isWeaponMatch` (Bool): 是否装备了符合招式要求的武器。
    *   `output` (Object, **可修改**):
        *   `damage` (Number): 最终计算出的伤害/治疗量。**脚本主要修改此值**。
        *   `feint` (Number): 最终计算出的虚招值。
        *   `bonusDesc` (Array): 描述文本数组，可使用 `.push("说明")` 添加到伤害详情中。

#### 🎯 `check` (检定修正/比对)
*   **时机**: 掷骰前，针对**每一个目标**分别运行。
*   **用途**: 判断“我对这个**特定目标**的命中率/优劣势/穿透”。
*   **参数 (`args`)**:
    *   `target` (Actor): 目标角色。
    *   `attacker` (Actor): 攻击者。
    *   `item` (Item): 来源物品。
    *   `move` (Object): 招式数据。
    *   `flags` (Object, **可修改**):
        *   `grantLevel` (Int): **命中优劣势修正**。+1=给予攻方优势(2d20kh)，-1=劣势(2d20kl)。
        *   `grantFeintLevel` (Int): **虚招优劣势修正**。
        *   `grantHit` (Int): **命中数值修正** (如 +5)。直接加在最终命中结果上。
        *   `forceHit` (Bool): **单体必中**。设为 `true` 强制对该目标命中（跳过投掷，这也代表着不会暴击，如果需要能暴击的必中请给grantHit一个很大的加值来实现）。
        *   `grantFeint` (Int): **虚招数值修正**。
        *   `critThresholdMod` (Int): **暴击阈值修正**。正数表示更容易暴击 (如 +2 表示 18 即可暴击)。仅对当前目标生效。
        *   `ignoreBlock` (Bool): **无视格挡**。
        *   `ignoreDefense` (Bool): **无视防御**。
        *   `ignoreStance` (Bool): **无视架招**。

---

### B. 战斗决策与交互 (异步阶段)
> ✅ **提示**: 此阶段及后续阶段**可以使用** `await`。

#### ⚔️ `attack` (出招决策/数值修正)
*   **时机**: 点击招式按钮后 -> 资源扣除完毕 -> **基础伤害计算完毕** -> 掷骰前。
*   **用途**:
    1.  决定自身的全局状态（优势、暴击加成、必中）。
    2.  直接修改最终伤害数值。
    3.  阻断出招或标记瞬发。
*   **参数 (`args`)**:
    *   `move` (Object): 当前招式数据。
    *   `item` (Item): 来源物品。
    *   `attacker` (Actor): 攻击者实例。
    *   `flags` (Object, **可修改**):
        *   `damageResult` (Object): 伤害计算结果引用。
            *   `damage` (Number): 当前计算出的总伤害（含基础+武器+属性+手动修正+濒死加成）。**脚本直接修改此值即可改变最终伤害**。
            *   `feint` (Number): 基础虚招值（尚未包含脚本修正）。
            *   `breakdown` (String): 伤害构成描述文本。建议修改伤害后同步追加描述 (`+= "\n+ 说明..."`)。
        *   `level` (Int): 自身命中优劣势（+1优势/-1劣势）。
        *   `feintLevel` (Int): 自身虚招优劣势。
        *   `bonusHit` (Int): 自身全局命中数值修正。
        *   `forceHit` (Bool): **单体必中**。设为 `true` 强制命中（跳过投掷，不暴击）。
        *   `bonusFeint` (Int): **自身全局虚招数值修正**。此值会在脚本结束后加到 `calcResult.feint` 上。
        *   `critThresholdMod` (Int): 全局暴击阈值修正。
        *   `abort` (Bool): 设为 `true` 阻断出招。
        *   `abortReason` (String): 阻断提示文本。
        *   `autoApplied` (Bool): 设为 `true` 隐藏聊天卡片上的“应用”按钮。

---

### C. 防御与受击流程 (异步阶段)
> ⚠️ **关键**: 此阶段所有触发器中，`actor` 指的是**防御者**。

#### 💨 `avoided` (防御者：未命中)
*   **时机**: 判定为**未命中**时触发。
*   **用途**: 闪避后的副作用 (如“凌波微步：闪避回蓝”)。
*   **参数 (`args`)**:
    *   `attacker` (Actor): 攻击者。
    *   `target` (Actor): 防御者 (自己)。
    *   `type` (String): 伤害类型。
    *   `baseDamage` (Number): 原始面板伤害。
    *   `isCrit` (Bool): 攻击者是否触发了暴击判定。
    *   `outcome` (Object, **只读**): `{ isHit: false, isBroken: Bool }`。明确告知未命中。

#### 🛡️ `preDefense` (防御者：防御计算前)
*   **时机**: 命中后，但在计算防御减伤、抗性之前。
*   **用途**: 防御者最后修改攻击属性的机会 (如“金钟罩：免疫暴击”、“软猬甲：无视穿透”)。
*   **参数 (`args`)**:
    *   `attacker` (Actor): 攻击者。
    *   `target` (Actor): 防御者。
    *   `type` (String): 伤害类型。
    *   `element` (String): 招式的五行属性 (`yin`, `yang`, `gang`, `rou`, `taiji`, `none`)。
    *   `baseDamage` (Number): 原始面板伤害。
    *   `config` (Object, **可修改**):
        *   `ignoreBlock` (Bool): 是否无视格挡。
        *   `ignoreDefense` (Bool): 是否无视防御。
        *   `ignoreStance` (Bool): 是否无视架招。
        *   `isCrit` (Bool): 是否暴击。**设为 false 可免疫暴击**。
        *   `applyCritDamage` (Bool): 是否应用暴击伤害倍率 (x2)。

#### 🛡️ `preTake` (防御者：受伤前/护盾)
*   **时机**: 防御、格挡、抗性全部计算完毕，即将扣血前。
*   **用途**: 实现**护盾 (Shields)**、伤害吸收、完全免疫。
*   **参数 (`args`)**:
    *   `attacker` (Actor), `target` (Actor)。
    *   `type` (String), `baseDamage` (Number)。
    *   `element` (String): 招式的五行属性 (`yin`, `yang`, `gang`, `rou`, `taiji`, `none`)。
    *   `calcDamage` (Number): 减伤后的**理论伤害值** (防御/格挡已扣除)。
    *   `isCrit` (Bool), `isBroken` (Bool)。
    *   `config` (Object, **只读**): 查看当前的穿透/暴击配置。
    *   `output` (Object, **可修改**):
        *   `damage` (Number): **最终即将扣除的数值**。修改此值实现护盾。
        *   `abort` (Bool): 设为 `true` **完全免疫**本次伤害流程 (不飘字，不扣血)。

#### 💥 `damaged` (防御者：受伤后/反伤)
*   **时机**: 气血/护体/内力已经扣除完毕，数据库已更新。
*   **用途**: 实现**反伤 (Thorns)**、受击回怒、受击触发 Buff。
*   **参数 (`args`)**:
    *   `attacker` (Actor), `target` (Actor)。
    *   `finalDamage` (Number): 护盾计算后的理论应扣伤害。
    *   `hpLost` (Number): **实际**扣除的气血。
    *   `hutiLost` (Number): **实际**扣除的护体。
    *   `mpLost` (Number): **实际**扣除的内力。
    *   `element` (String): 招式的五行属性 (`yin`, `yang`, `gang`, `rou`, `taiji`, `none`)。
    *   `isDying` (Bool): 是否因此进入濒死。
    *   `isDead` (Bool): 是否因此死亡。
    *   `isCrit` (Bool), `isBroken` (Bool)。
    *   `config` (Object): 伤害配置快照。

#### 💀 `dying` / `death` (防御者：濒死/死亡)
*   **时机**: 气血归零 (`dying`) 或 内力归零 (`death`) 时 (在 `damaged` 之前触发)。
*   **用途**: 免死金牌、凤凰涅槃。
*   **参数 (`args`)**:
    *   `attacker`, `target`。
    *   `damage` (Number): 致死的那一下伤害数值。
    *   `preventDying` (Bool, **可修改**): 设为 `true` **阻止濒死** (保持 HP 1 或其他逻辑)。
    *   `preventDeath` (Bool, **可修改**): 设为 `true` **阻止死亡**。

---

### D. 攻击结算与应用 (异步阶段)
> ✅ **提示**: 此阶段 `actor` 指**攻击者**。

#### 🌪️ `preDamage` (攻击者：伤害应用前)
*   **时机**: 命中/暴击已定，在调用防御者 `applyDamage` 之前。
*   **用途**: 攻击者视角修改伤害属性（如：暴击后转为精神伤害）。
*   **参数 (`args`)**:
    *   `attacker`, `target`, `item`, `move`。
    *   `isManual` (Bool): 是否为手动应用模式 (Shift+点击)。
    *   `outcome` (Object, **只读**): `{ isHit(是否命中), isCrit(是否暴击), isBroken(是否击破架招) }`。
    *   `config` (Object, **可修改**):
        *   `amount` (Number): 伤害数值。
        *   `type` (String): 伤害类型。
        *   `element` (String): 招式的五行属性 (`yin`, `yang`, `gang`, `rou`, `taiji`, `none`)。
        *   `ignoreBlock`, `ignoreDefense`, `ignoreStance`, `applyCritDamage` (Bool)。

#### 🩸 `hit` (单体结算/应用)
*   **时机**: 对**每一个目标**应用伤害/治疗/Buff 后触发。
*   **用途**: **最核心的触发器**。用于施加 Buff/Debuff、吸血、附毒、额外效果。
*   **参数 (`args`) - 通用**:
    *   `target` (Actor): 目标。
    *   `attacker` (Actor): 攻击者。
    *   `item` (Item): 来源物品。
    *   `move` (Object): 招式数据。
    *   `type` (String): `"attack"`, `"heal"`, 或 `"buff"`。
    *   `isManual` (Bool): 是否手动应用。
    *   `isHit`, `isCrit`, `isBroken` (Bool)。
    *   `isAttack`, `isHeal`, `isBuff` (Bool): 快捷类型标记。
*   **参数 (`args`) - 攻击特有 (`type="attack"`)**:
    *   `baseDamage` (Number): 面板伤害。
    *   `finalDamage` (Number): 结算伤害。
    *   `hpLost`, `mpLost`, `hutiLost` (Number): **实际**造成的损失。
    *   `isDying`, `isDead` (Bool): 目标状态。
    *   `damageResult` (Object): 完整的结算数据包 (包含上述所有字段)。
*   **参数 (`args`) - 治疗/Buff特有 (`type="heal"/"buff"`)**:
    *   `baseAmount` (Number): 面板数值 (治疗量或强度)。
    *   `finalAmount` (Number):
        *   若 `type === 'heal'`: 实际应用到 HP 上的回复量。
        *   若 `type === 'buff'`: 等于 `baseAmount` (视为强度 Potency)。
    *   `healAmount` (Number): 同 `finalAmount`。
    *   `isBuffOnly` (Bool): 标识是否仅为Buff (无治疗数值)。

#### 🩸 `hit_once` (全局结算)
*   **时机**: 所有目标处理完毕后执行一次。
*   **用途**: 群攻/群奶后的自身反馈 (如"每命中一人回1点气")。
*   **参数 (`args`)**:
    *   `targets` (Array): 包含所有目标详细结果 (`summaryData`) 的数组。
    *   `hitCount` (Int): 命中的目标总数。
    *   `baseDamage` (Number): 面板伤害 (攻击模式下)。
    *   `totalHealAmount` (Number): (治疗模式下) 总治疗量。
    *   `attacker`, `item`, `move`, `isManual`。

---

## 📝 3. 武学招式创建与配置指南

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

### 🧱 特别说明：架招 (Stance) 的双重生命周期

架招在系统中存在两种完全不同的状态，脚本的触发规则也因此截然不同：

#### 1. 开启瞬间 (Active Activation)
*   **定义**：玩家点击架招按钮，也就是出招时。
*   **逻辑**：此时架招被视为一个**主动招式**。
*   **生效触发器**：**所有**。
    *   `attack`: 会正常触发。可用于实现“开启架招获得XXX”、“开启消耗特殊资源”等逻辑。
    *   `calc`: 会正常触发。

#### 2. 背景常驻 (Background State)
*   **定义**：架招已经开启，玩家正在施展**其他招式**（如普攻、技能）或**被攻击**时。
*   **逻辑**：此时架招被视为角色的**背景状态/被动 Buff**。
*   **生效触发器 (白名单机制)**：
    为了防止逻辑污染（例如：防止架招的攻击脚本污染了其他招式的攻击判定），处于背景状态的架招**仅响应以下触发器**：
    *   ✅ **被动类**: `passive`
    *   ✅ **防御/交互类**: `avoided`, `preDefense`, `preTake`, `damaged`, `dying`, `death`
    *   ❌ **进攻类 (被屏蔽)**: `attack`, `calc`, `preDamage`, `hit`, `hit_once`, `check`

> **设计启示**：如果你希望架招能增强你的攻击（如“开启架招后，所有攻击伤害+10”），请不要在架招的 `attack` 脚本里写加攻逻辑（会被屏蔽）。你应该在架招的 `passive` 脚本里修改 `system.combat.damages.global.mod`，或者给角色挂一个 Active Effect。

---

## 🛠️ 4. 宏工具箱 (Macros API)

在脚本中通过 `Macros` 对象调用。

### 4.1 `Macros.requestSave(options)`
**功能**: 向目标发起属性判定请求（如点穴、中毒豁免），并在聊天栏发送卡片，失败自动应用效果。

| 参数 | 类型 | 说明 |
| :--- | :--- | :--- |
| `target` | Actor | 目标角色 (必须)。 |
| `type` | String | 属性 Key (如 `"liliang"`, `"neixi"`, `"qiaoshou"`)。 |
| `dc` | Number | 难度等级。 |
| `label` | String | 弹窗标题 (可选)。 |
| `level` | Number | 预设优劣势 (正数优, 负数劣)。 |
| `onFail` | Object | **关键**: 失败时自动应用的 Active Effect 数据对象。 |
| `attacker`| Actor | 发起者 (用于显示名字)。 |

**示例**:
```javascript
// 发起内息判定，失败晕眩
await Macros.requestSave({
    target: args.target,
    type: "neixi",
    dc: 15,
    label: "抵抗点穴",
    attacker: actor,
    onFail: {
        name: "晕眩",
        changes: [{ key: "flags.xjzl-system.stun", mode: 5, value: "true" }]
    }
});
```

### 4.2 `Macros.checkStance(actor, args)`
**功能**: 在 `damaged` 或 `preTake` 脚本中，辅助判断是否满足触发架招特效的硬性条件。
**检查逻辑**: 1. 架招已开启; 2. 命中; 3. 伤害类型有效(内外功); 4. 未被无视架招。

*   **参数**: `actor` (防御者), `args` (当前脚本上下文)。
*   **返回**: `Boolean`。

---

## 🚩 5. 状态标志 (Flags) 完全手册

在 Active Effect 中 Key 为 `flags.xjzl-system.[Flag]`。
在脚本中通过 `actor.xjzlStatuses.[Flag]` 读取，或直接修改。

### A. 战斗博弈 (数值型, ADD)
> **正数(+)=优势/容易，负数(-)=劣势/困难。**

| Key | 作用方 | 含义 |
| :--- | :--- | :--- |
| **`attackLevel`** | 自身 | 我攻击时的命中优劣势 (是否投2d20)。 |
| **`grantAttackLevel`** | 目标 | 别人攻击我时的命中优劣势 (空门大开)。 |
| **`feintLevel`** | 自身 | 我施展虚招(攻) 或 看破(守) 的优劣势。 |
| **`defendFeintLevel`** | 目标 | 别人对我施展虚招时的优劣势 (心神不宁)。 |

### B. 行为封锁 (布尔型, OVERRIDE)
> **设为 `true` 生效。**

| Key | 说明 |
| :--- | :--- |
| **`stun`** | **晕眩/定身**。无法行动，自动解除架招，速度闪避归零。 |
| **`silence`** | **封穴**。无法施展任何招式。 |
| **`forceUnarmed`** | **缴械**。只能使用徒手招式。 |
| **`brokenDefense`** | **破甲**。外功防御力强行置零。 |
| **`forceSpeedZero`** | **禁足**。移动速度归零。 |
| **`forceDodgeZero`** | **禁闪**。闪避值归零。 |
| **`noRecoverHP`** | **禁疗**。无法回复气血。 |
| **`noRecoverNeili`** | **气滞**。无法回复内力。 |
| **`noRecoverRage`** | **不怒**。无法获得怒气。 |
| **`blockShiZhao`** | **禁实**。无法施展实招。 |
| **`blockXuZhao`** | **禁虚**。无法施展虚招。 |
| **`blockQiZhao`** | **禁气**。无法施展气招。 |
| **`blockCounter`** | **禁反**。无法施展反击。 |
| **`blockUltimate`** | **禁绝**。无法施展绝招。 |
| **`blockStance`** | **禁架**。无法开启架招。 |

### C. 穿透与特殊 (布尔型/数值型)

| Key | 类型 | 含义 |
| :--- | :--- | :--- |
| **`ignoreBlock`** | Bool | **无视格挡**。 |
| **`ignoreDefense`** | Bool | **无视防御** (真实伤害)。 |
| **`ignoreStance`** | Bool | **无视架招** (不触发反震)。 |
| **`ignoreArmorEffects`**| Bool | **破衣**。防具的所有属性和特效失效。 |
| **`passiveBlock`** | Bool | **被动格挡**。未开架招时也有格挡值。 |
| **`unstable`** | Bool | **下盘不稳**。速度减半。 |
| **`bleedOnHit`** | Number | **撕裂**。受击时额外流失 X 点气血。 |
| **`wuxueBleedOnHit`** | Number | **旧疾**。仅受内外功伤害时流失 X 点气血。 |
| **`bloodLossLevel`** | Number | **失血**。每层减少 10% 气血上限。 |

### D. 自动化回复 (数值型, ADD)
> **命名规则**: `regen` + 资源 + 时机。正数回复，负数流失。

*   **TurnStart**: `regenHpTurnStart`, `regenMpTurnStart`, `regenRageTurnStart`
*   **TurnEnd**: `regenHpTurnEnd`, `regenMpTurnEnd`, `regenRageTurnEnd`
*   **Attack** (出招时): `regenHpAttack`, `regenMpAttack`, `regenRageAttack`

---

## 📝 6. 常用属性路径速查

在 Active Effect 或 `passive` 脚本中修改。前缀 `system.` (AE) 或 `S.` (脚本)。

| 类别 | 属性路径 | 修改方式 | 说明 |
| :--- | :--- | :--- | :--- |
| **七维** | `stats.[key].mod` | ADD | `liliang`, `shenfa`, `neixi`, `tipo`, `qigan`, `shencai`, `wuxing` |
| **格挡** | `combat.block` | ADD | 基础格挡值 |
| **防御** | `combat.def_waigong` | ADD | 外功防御 |
| **命中** | `combat.hit_waigong` | ADD | 外功命中修正 |
| **伤害** | `combat.damages.skill.mod` | ADD | **招式伤害** (最常用) |
| **属性伤**| `combat.damages.[element].mod`| ADD | `yang`, `yin`, `gang`, `rou` |
| **速度** | `combat.speed` | ADD | 移动距离 |
| **技能** | `skills.[key].mod` | ADD | `qinggong`, `liaoshang` 等 |

---

## 💡 7. 脚本实战范例大全 (Verified v6.1)

以下范例均提取自系统核心合集包，经过实机验证，可直接作为模板使用。

### A. 叠加型 Buff 的获取
> **场景**: 物品内部存有一个 Active Effect 模板（例如“魔气”或“劲力”）。每次攻击或受伤时，复制这个模板并叠加到角色身上。
> **时机**: `attack` 或 `damaged`

```javascript
// 1. 获取物品内的特效模板 (Template)
// 假设特效名称为 "魔气"
const sourceEffect = thisItem.effects.getName("魔气");
if (!sourceEffect) return;

// 2. 克隆数据 (转为普通 Object 并清理 ID)
const effectData = sourceEffect.toObject();
delete effectData._id;          
effectData.origin = thisItem.uuid; // 关键：标记来源，防止重复创建

// 3. 动态修改 (可选)
// 例如：根据内功层数修改最大叠加层数
// 这里假设我们想把最大层数动态设为 5
foundry.utils.setProperty(effectData, "flags.xjzl-system.maxStacks", 5);

// 4. 调用管理器应用特效 (自动处理叠加/刷新)
await game.xjzl.api.effects.addEffect(actor, effectData);
```

### B. 濒死触发与动态回血
> **场景**: 这是一个写在 Active Effect 上的脚本。当角色气血归零（濒死）时，消耗自身层数回复气血，并移除该特效。
> **时机**: `dying` (挂载在 Active Effect 上)

```javascript
// thisEffect 指向当前运行脚本的特效实例
const stacks = thisEffect.stacks; // 获取当前层数

// 1. 计算回血量 (每层 10% 最大气血)
const healAmount = Math.floor(S.resources.hp.max * 0.1 * stacks);

// 2. 发送剧情卡片 (可选，增强代入感)
const content = `<div class="xjzl-chat-card">
    <div style="padding:5px; background:#f3e5f5; color:#8e44ad; font-weight:bold;">
        <i class="fas fa-shield-alt"></i> 护体秘术触发！消耗 ${stacks} 层。
    </div>
</div>`;
await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: actor }),
    content: content
});

// 3. 执行治疗 (自动处理飘字)
await actor.applyHealing({ amount: healAmount, type: 'hp', showScrolling: true });

// 4. 移除特效 (任务完成)
await thisEffect.delete();
```

### C. 击破架招施加状态
> **场景**: 攻击命中后，如果判定为“击破架招 (isBroken)”，给目标施加一个系统通用状态（如“封招”）。
> **时机**: `hit`

```javascript
// args.isBroken 是系统计算好的布尔值
if (args.isBroken) {
    // 1. 从系统配置中查找通用状态 (例如封招 fengzhao)
    const statusConfig = CONFIG.statusEffects.find(e => e.id === "fengzhao");
    
    if(statusConfig) {
        // 2. 克隆并修改持续时间
        const data = foundry.utils.deepClone(statusConfig);
        data.duration = { rounds: 1 }; // 强制持续 1 回合
        
        // 3. 应用给目标
        await game.xjzl.api.effects.addEffect(args.target, data);
        ui.notifications.info(`${args.target.name} 被封招！`);
    }
}
```

### D. 属性快照型 Buff
> **场景**: 给自己上一个 Buff，其数值（如格挡值）等于施法瞬间角色的“悟性”总值。即使后续悟性变化，该 Buff 的数值也不变。
> **时机**: `hit` (气招/Buff模式)

```javascript
// 1. 计算动态数值
const wuxing = actor.system.stats.wuxing.total; // 获取当前悟性
const lvl = Math.max(1, move.computedLevel || 1);
const rounds = 1 + (lvl - 1); // 持续时间随等级成长

// 2. 获取模板 (假设名为 "玄龟")
const eff = thisItem.effects.getName("玄龟").toObject();

// 3. 写入动态数据
eff.duration = { rounds: rounds };
// 假设模板里第0个 change 是修改格挡值的
// 将当前悟性值“快照”写入
eff.changes[0].value = String(wuxing); 

// 4. 应用
await game.xjzl.api.effects.addEffect(actor, eff);
```

### E. 伤害预览与资源消耗决策
> **场景**: 这是一个组合拳脚本。
> 1. `calc` 阶段：如果在预览时发现满足加成条件（如身上有Buff），直接把伤害加成显示在面板上。
> 2. `attack` 阶段：正式出招时弹窗询问是否消耗该Buff。如果玩家拒绝，则把加成的伤害扣除。

**脚本 1 (Calc 阶段 - 预览):**
```javascript
// 检查是否有指定 Buff (假设名为 "蓄力")
const hasBuff = actor.effects.some(e => e.getFlag("xjzl-system", "slug") === "xuli_buff");

if (hasBuff) {
    // 计算加成 (示例：固定值 50)
    const bonus = 50; 
    
    // 修改输出对象，不仅改数值，还加描述
    args.output.damage += bonus;
    args.output.bonusDesc.push(`蓄力加伤 +${bonus} (需消耗Buff)`);
}
```

**脚本 2 (Attack 阶段 - 决策):**
```javascript
const buff = actor.effects.find(e => e.getFlag("xjzl-system", "slug") === "xuli_buff");
const bonus = 50; // 需与 calc 保持一致逻辑

if (buff) {
    // 弹出确认框
    const confirm = await foundry.applications.api.DialogV2.confirm({
        window: { title: "强力一击" },
        content: `<p>预计算伤害已包含 <b>+${bonus}</b> 加成。</p><p>是否消耗一层 [蓄力] 以生效此加成？</p>`,
        yes: { label: "消耗 (保留加成)", icon: "fas fa-check" },
        no: { label: "不消耗 (移除加成)", icon: "fas fa-times" }
    });

    if (confirm) {
        // 玩家同意：消耗 1 层 Buff
        await game.xjzl.api.effects.removeEffect(actor, "xuli_buff", 1);
        ui.notifications.info("已消耗 [蓄力] 增强招式");
    } else {
        // 玩家拒绝：手动回滚伤害
        // 注意：args.flags.damageResult.damage 是包含 calc 结果的总值
        args.flags.damageResult.damage -= bonus;
        // 修改描述，让聊天卡片显示减法
        args.flags.damageResult.breakdown += `\n- 未消耗：移除加成 (-${bonus})`;
    }
}
```

### F. 属性判定与失败惩罚
> **场景**: 命中后，要求目标进行属性判定（如内息），失败则施加特定状态（如点穴）。
> **时机**: `hit`

```javascript
// 仅当命中且目标未开启架招时生效
if (args.isHit && !args.target.system.martial.stanceActive) {
    // 计算动态难度 (DC)
    const dc = 20 + (Math.max(1, move.computedLevel || 1) - 1) * 2;

    await Macros.requestSave({
        target: args.target,
        attacker: actor,
        type: "neixi", // 判定属性
        dc: dc,
        label: "抵抗点穴",
        onFail: "dianxue" // 失败时应用的状态 ID (来自 CONFIG.statusEffects)
        // 也可以直接传一个 Active Effect 数据对象
    });
}
```

### G. 智能反伤与防死循环
> **场景**: 受到近战攻击时反弹伤害。必须防止“反伤触发反伤”的无限循环。
> **时机**: `damaged` (防御者视角)

```javascript
// 1. 基础校验：必须有攻击者，且不能是自己
if (!args.attacker || args.attacker.uuid === actor.uuid) return;

// 2. 防乒乓机制 (Ping-Pong Protection)
// 检查攻击者身上是否有“正在承受反伤”的临时标记
if (args.attacker.isReceivingReflection) return;

// 3. 距离检测 (V13 标准写法)
const t1 = actor.token?.object || actor.getActiveTokens()[0];
const t2 = args.attacker.token?.object || args.attacker.getActiveTokens()[0];
let inRange = false;

if (t1 && t2) {
    // 使用 Canvas Grid 测量距离
    const measure = canvas.grid.measurePath([t1.center, t2.center]);
    // 允许 1.1 米误差 (兼容斜向贴身)
    if (measure.distance <= 1.1) inRange = true;
}

// 4. 执行反伤
if (inRange) {
    // [关键] 标记目标正在承受反伤，防止目标身上的反伤装备再次触发反弹
    args.attacker.isReceivingReflection = true;

    try {
        // 造成真实伤害 (ignoreDefense: true)
        await args.attacker.applyDamage({ 
            amount: 15, 
            type: "poison", 
            attacker: actor, 
            isHit: true,        // 反伤视为必中
            ignoreDefense: true // 无视防御
        });
        
        // 发送提示
        ui.notifications.info("反伤甲触发！");

    } finally {
        // [关键] 无论成功失败，必须清除标记
        args.attacker.isReceivingReflection = false;
    }
}
```

### H. 架招机制：激活与触发
> **场景**: 架招包含两部分逻辑：
> 1. **激活时**：开启架招瞬间，获得一个持续性 Buff（如“剑意”）。
> 2. **生效时**：开启架招期间，每次成功格挡攻击，给对方施加 Debuff 或自己获得增益。

**脚本 1 (激活架招 - 获得状态):**
> **注意**: 架招的流程会在 `attack` 阶段结束后终止，不会进入 `hit` 阶段。因此“开启即生效”的逻辑必须写在 `attack` 里。
> **时机**: `attack`

```javascript
// 1. 获取物品内预设的 Buff 模板 (例如 "剑意")
const buff = thisItem.effects.getName("剑意");

if (buff) {
    const effectData = buff.toObject();
    delete effectData._id;
    effectData.origin = thisItem.uuid;
    
    // 2. 应用 Buff
    // 因为是架招，这个 Buff 通常持续到战斗结束或架招关闭
    await game.xjzl.api.effects.addEffect(actor, effectData);
    
    // ui.notifications.info("架势已展开，剑意流转。");
}
```

**脚本 2 (格挡成功 - 触发特效):**
> **注意**: 这是防御逻辑。使用 `Macros.checkStance` 辅助函数，它会自动判断：是否开启了架招、攻击是否命中、是否为内/外功、是否被“无视架招”。
> **时机**: `damaged` (防御者视角)

```javascript
// 1. 核心判断：是否满足架招触发条件
// 如果没开架招，或者攻击被闪避，或者攻击具有[无视架招]特性，这里会返回 false
if (!Macros.checkStance(actor, args)) return;

// 2. 执行逻辑 (例如：给攻击者施加 "震慑")
const debuff = thisItem.effects.getName("震慑");

if (debuff && args.attacker) {
    const effectData = debuff.toObject();
    delete effectData._id;
    effectData.origin = thisItem.uuid;
    
    // 给攻击者 (args.attacker) 上状态
    await game.xjzl.api.effects.addEffect(args.attacker, effectData);
    
    // 飘字提示
    if (actor.token?.object) {
        canvas.interface.createScrollingText(actor.token.object.center, "格挡反震！", { 
            fill: "#FFA500", stroke: "#000000", strokeThickness: 4 
        });
    }
}
```

---

## 📝 8. 最佳实践

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

6.  **优先使用 Active Effect 脚本**:
    *   对于赋予状态后产生的逻辑（如“每回合扣血”、“攻击附带效果”），请优先将脚本写在 Active Effect 中，而不是在物品脚本里创建“虚拟物品”来监听。这样当 Buff 消失时，逻辑也会自动停止，更加清洁高效。

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
