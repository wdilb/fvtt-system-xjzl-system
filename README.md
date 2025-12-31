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
    // 每100内功修为提供 1 点额外伤害
    const extra = Math.floor(S.cultivation.neigong / 100);
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

#### 🌪️ `preDamage` (伤害结算前)
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

#### 🩸 `hit` (结算/应用)
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
    *   **`finalAmount`**: 
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

### 3.2 `Macros.checkStance(actor, args)`
**功能**: 检查当前是否满足触发架招特效的所有硬性条件。
**检查项**: 架招开启 + 命中 + 内外功类型 + 未被无视架招。
**返回值**: `Boolean`

---

## 📊 4. 可修改属性全表 (Attribute Paths)

在 **Active Effect** 或 **Passive 脚本** 中，你可以通过以下路径修改属性。
**通用前缀**: `system.` (在 AE 中使用) 或 `S.` (在脚本中使用)。

*   **七维属性**: `stats.[key].mod` (`liliang`, `shenfa`...)
*   **战斗属性**: `combat.[key]` (`speed`, `block`, `hit_waigong`, `def_neigong`...)
*   **伤害修正**: `combat.damages.[key].mod` (`global`, `skill`, `weapon`...)
*   **抗性修正**: `combat.resistances.[key].mod` (`global`, `poison`, `mental`...)
*   **技能等级**: `skills.[key].mod` (`qinggong`, `liaoshang`...)

---

## 🚩 5. 状态标志 (Flags) 速查

在 **Active Effect** 中，Key 为 `flags.xjzl-system.[FlagName]`。

### A. 自动化回复 (数值型, ADD)
*   `regenHpTurnStart` / `regenMpTurnStart` / `regenRageTurnStart` (回合开始)
*   `regenHpAttack` / `regenMpAttack` (出招时)

### B. 检定修正 (数值型, ADD)
*   `globalCheckLevel` (全局检定优劣)
*   `[key]CheckLevel` (特定属性检定，如 `liliangCheckLevel`)

### C. 战斗博弈 (数值型, ADD)
*   `attackLevel` (自身命中) / `grantAttackLevel` (被命中)
*   `feintLevel` (虚招) / `defendFeintLevel` (被虚招)

### D. 行为穿透 (布尔型, OVERRIDE)
*   `ignoreBlock` / `ignoreDefense` / `ignoreStance` / `ignoreArmorEffects`

### E. 封锁与控制 (布尔型, OVERRIDE)
*   `stun` (晕眩), `silence` (封穴), `forceUnarmed` (缴械)
*   `blockShiZhao`, `blockXuZhao`, `blockQiZhao`, `blockCounter`, `blockStance`

---

## 📝 6. 武学招式创建与脚本指南

### 6.1 招式配置逻辑
*   **默认/Buff**: 无检定，用于纯状态类气招。
*   **治疗 (Heal)**: 无检定，自动回血。
*   **攻击 (Attack)**: 内/外功需检定，精神/无视类型必中。

### 6.2 常见复杂招式脚本范例

*(此处包含给目标施加Buff、治疗回蓝、精神伤害检定、自动化回血、随等级成长特效、武器淬毒、瞬发气招、特殊暴击等 8 个经典范例)*

---

## 📝 7. 最佳实践

1.  **数值修改规范**: 使用 `+=` 修改数值，避免覆盖。
2.  **Item 引用**: 使用 `thisItem` 引用自身。
3.  **判断逻辑**: 善用 `Macros` 助手函数。
4.  **调试技巧**: 善用 `console.log(args)`。
5.  **资源消耗**: 士气在 `hit` 阶段已被清空，请勿直接读取当前值。

</details>

---

## 👥 贡献与鸣谢 (Credits)

*   **系统作者**: Tiwelee
*   **特别感谢**:
    *   **一气长虹**: 提供了核心数据类型设计、计算逻辑参考以及无私的规则指导。
    *   **安迪亚**: 提供了宝贵的界面设计建议与测试反馈。

---

## 📄 协议 (License)

本项目采用 [MIT License](LICENSE) 开源。
允许在遵守协议的前提下自由修改、分发与使用。
