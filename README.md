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
| **`item`** | `Item` | **动作来源物品**。<br>**注意区别**: 当你挥剑攻击时，`item` 是这把剑。<br>如果你身上的“中毒”BUFF在此时触发脚本，`thisItem` 是BUFF，而 `item` 依然是那把剑。<br>*注: 普通攻击时，这是一个包含虚拟招式数据的对象。* |
| **`move`** | `Object` | **当前正在施展的招式数据** (仅限招式相关脚本)。包含 `id`, `name`, `damageType`, `currentCost` 等字段。 |
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
    2.  **直接修改最终伤害数值**（这是新架构的核心能力）。
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

## 💡 7. 脚本实战范例大全

以下范例涵盖了从简单到复杂的各类需求。

### A. 给目标施加 Buff (如：提升移动速度)
> **场景**: 气招 (Buff)，选中队友或自己，持续 3 回合。
> **时机**: `hit`

```javascript
// 1. 定义 Active Effect 数据结构
const effectData = {
    name: "神行百变",
    icon: "icons/svg/wing.svg", // 图标路径
    origin: item.uuid,          // 标记来源
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

### B. 治疗 + 回复内力 (如：提按端挤)
> **场景**: 气招 (Heal)。面板设置 10 点治疗量 (自动回血)，脚本负责回内力。
> **时机**: `hit`

```javascript
// args.finalAmount 是实际回复的气血量
if (args.finalAmount > 0) {
    // 额外回复 5 点内力
    // 使用 applyHealing 接口，会自动处理飘字
    await args.target.applyHealing({ 
        amount: 5, 
        type: "mp", 
        showScrolling: true 
    });
}
```

### C. 精神伤害 + 定力检定 (如：醉里吴音)
> **场景**: 气招 (Attack)，伤害类型选 `Mental`。
> **逻辑**: 点击应用伤害时，先不扣血，而是发起检定。如果检定失败再扣血。
> **时机**: `hit`

```javascript
// 1. 发起检定请求
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

### D. 自动化回血 Buff (如：养血)
> **场景**: 气招 (Buff)。给目标上一个状态，让他每回合结束自动回血。
> **时机**: `hit`

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

### E. 随等级成长的特效 (如：万龙馈影)
> **场景**: 架招或攻击。给目标施加一个 Debuff（如蛇瘴），其**数值**和**最大层数**随着招式等级提升而增加。
> **前置**: 在武学物品中先创建一个名为“蛇瘴”的特效作为**模板**。
> **时机**: `hit` 或 `damaged` (如果是架招反击)

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
const newMax = 3 + (lvl - 1) * 1;
foundry.utils.setProperty(effectData, "flags.xjzl-system.maxStacks", newMax);

// B. 修改流失数值 (基础5点，每级+5)
// 找到控制流失的 change 条目 (通过 key 查找)
const change = effectData.changes.find(c => c.key === "flags.xjzl-system.regenHpTurnStart");
if (change) {
    // 注意：流失通常是负数
    const val = -5 + (lvl - 1) * (-5);
    change.value = String(val);
}

// 5. 应用特效
// 调用 API 挂载到目标身上 (attacker 是施法者)
// 这里演示如果是在 Damaged 触发器里，目标应该是 attacker (打我的人)
// 如果是在 Hit 触发器里，目标应该是 target
const targetActor = (trigger === 'damaged') ? args.attacker : args.target;
await game.xjzl.api.effects.addEffect(targetActor, effectData);
```

### F. 进阶消耗品：武器淬毒
> **场景**: 消耗品赋予自身一个名为“武器淬毒”的 Active Effect，该 AE 内部携带一个监听 `hit` 的脚本。攻击命中时消耗自己并使敌人中毒。
> **时机**: `hit` (挂载在 Active Effect 上)

```javascript
// --- 本脚本挂载在 "武器淬毒" AE 上 ---
// 只要此 AE 存在，每次攻击命中都会触发此脚本

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

// 3. 触发一次后销毁自身 (一次性毒药)
// thisEffect 指向当前运行脚本的 Active Effect (即"武器淬毒")
await thisEffect.delete();
ui.notifications.info("毒药已耗尽。");
```

### G. 瞬发型气招 (如：天魔解体)
> **场景**: 气招 (Buff)。点击招式后，无需选择目标，立即执行脚本（如：扣血加攻）并隐藏聊天卡片上的按钮。
> **时机**: `attack` (出招决策)

```javascript
// 1. 执行逻辑：扣除自身 30% 气血
const hpCost = Math.floor(S.resources.hp.max * 0.3);
// 检查是否够扣
if (S.resources.hp.value <= hpCost) {
    ui.notifications.warn("气血不足以施展天魔解体！");
    args.flags.abort = true; // 阻断出招
    return;
}

// 扣血 (真实伤害)
await actor.applyDamage({ amount: hpCost, type: "liushi", isHit: true });

// 上 Buff (攻击力+50)
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

### H. 暴击转化伤害 (如：摄魂一击)
> **场景**: 攻击命中后，如果判定为暴击，则将伤害转化为“精神伤害”并无视防御。
> **时机**: `preDamage` (攻击者视角)

```javascript
// 检查只读状态：是否暴击
if (args.outcome.isCrit) {
    // 修改伤害配置
    args.config.type = "mental";
    args.config.ignoreDefense = true; // 精神伤害无视防御
    
    // 提示
    ui.notifications.warn("摄魂一击触发暴击！转化为精神伤害！");
}
```

### I. 自身爆发状态 (如：无我境界)
> **场景**: 当自身处于“无我”状态时，施展任何招式暴击率大幅提升。
> **时机**: `attack` (出招前)

```javascript
// 检查自身是否有 "无我" 的特效
if (actor.effects.find(e => e.name === "无我")) {
    // 阈值修正 +5 (假设原阈值20，现在15即可暴击)
    args.flags.critThresholdMod += 5;
    
    // 飘字提示
    if (actor.token?.object) {
        canvas.interface.createScrollingText(actor.token.object.center, "无我·暴击提升", { 
            fill: "#e74c3c", stroke: "#000000", strokeThickness: 4 
        });
    }
}
```

### J. 针对破绽精准打击 (如：攻其不备)
> **场景**: 目标如果有“晕眩”或“破绽”，对其命中率大幅提升（数值+10）且更容易暴击。
> **时机**: `check` (对每个目标运行)

```javascript
// 检查目标状态
const t = args.target;
const isVulnerable = t.statuses.has("stun") || t.effects.find(e => e.name === "破绽");

if (isVulnerable) {
    // 针对该目标的阈值修正 +3 (更容易暴击)
    args.flags.critThresholdMod += 3;
    
    // 针对该目标的命中数值 +10 (大幅提升命中率，但并不改变优劣势状态)
    args.flags.grantHit += 10;
}
```

### K. 反伤/反震 (如：软猬甲)
> **场景**: 防御者。受到伤害时，将实际扣除气血的 50% 以真实伤害反弹给攻击者。
> **时机**: `damaged` (防御者视角)

```javascript
// 必须有攻击者，且自己真的扣血了
if (args.attacker && args.hpLost > 0) {
    const reflect = Math.floor(args.hpLost * 0.5);
    
    // 反向造成真实伤害 (applyDamage 支持 isSkill=false 的普通来源)
    await args.attacker.applyDamage({
        amount: reflect,
        type: "liushi", // 流失/真实伤害
        isHit: true
    });
    ui.notifications.info(`软猬甲反震！造成 ${reflect} 点伤害`);
}
```

### L. 濒死豁免 (如：免死金牌)
> **场景**: 防御者。气血归零即将进入濒死时触发，免疫此次濒死并回满血，然后消耗掉该物品。
> **时机**: `dying` (防御者视角)

```javascript
// 1. 阻止濒死状态应用
args.preventDying = true;

// 2. 回满气血
await actor.applyHealing({ amount: S.resources.hp.max, type: "hp" });

// 3. 提示
ui.notifications.warn(`${actor.name} 触发免死金牌，满血复活！`);

// 4. 消耗掉物品 (假设是挂在消耗品上的)
// 或者如果是 buff，则 thisEffect.delete()
if (thisItem) {
    await thisItem.delete();
}
```

### M. 针对五行属性防御 (如：寒冰真气)
> **场景**: 防御者。如果受到 **阳(yang)** 或 **刚(gang)** 属性的攻击，利用相克原理减少 20 点伤害。
> **时机**: `preTake` (受伤前/护盾)

```javascript
// 检查招式的五行属性 (args.element 或 args.config.element)
const el = args.element;

// 判断是否为被克制的属性
if (el === "yang" || el === "gang") {
    // 飘字提示
    ui.notifications.info(`${actor.name} 寒冰真气化解了 ${el === 'yang' ? '纯阳' : '刚猛'} 之力！`);
    
    // 减免 20 点伤害
    args.output.damage -= 20;
    
    // 防止减成负数 (加血)
    if (args.output.damage < 0) args.output.damage = 0;
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
