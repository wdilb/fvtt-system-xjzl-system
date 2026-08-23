---

# 侠界之旅系统 (XJZL System) - Foundry VTT V13

![Foundry v13](https://img.shields.io/badge/Foundry-v13-orange)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

> **宁可无武，不可无侠。**
>
> 这是一个专为 **Foundry VTT V13** 开发的武侠跑团系统，基于《侠界之旅》规则集构建。

> [![QQ Group](https://img.shields.io/badge/侠界交流群-967477288-blue?logo=tencent-qq&logoColor=white)](https://qm.qq.com/cgi-bin/qm/qr?k=YOUR_LINK)
> [![QQ Group](https://img.shields.io/badge/系统反馈群-818849921-blue?logo=tencent-qq&logoColor=white)](https://qm.qq.com/cgi-bin/qm/qr?k=YOUR_LINK)
> <img width="3382" height="1690" alt="image" src="https://github.com/user-attachments/assets/26f7149a-79f9-4fa4-8cdf-c939ced99f25" />
> <img width="1722" height="1122" alt="image" src="https://github.com/user-attachments/assets/5743f73e-65c7-4f61-8d84-54c7387a26c7" />

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
*   **全时机覆盖**：支持 `Passive` (常驻)、`Attack` (出招前)、`Hit` (命中后)、`Damaged` (受击时)、`Dying` (濒死) 等 10+ 种触发时机。为规则中95%以上的资源实现了特效自动化。
*   **沙盒化环境**：内置 `Macros` 工具库，轻松实现是否触发架招、让对方检定属性失败则触发效果等复杂逻辑。
*   **所见即所得**：在物品栏直接编写代码，即刻生效。

### 🎨 其他特色 (Immersion)
*   **可视化经脉图**：在角色卡上直观查看十二正经与奇经八脉的打通情况。
*   **自定义移动规则**：重写底层网格算法，实现了侠界之旅“方格地图 只有第一次斜着走算1格，后面算2格”移动消耗规则。
*   **自定义属性组**：为一些无法实现自动化的情况，提供了丰富的手动属性加成选择。
*   **物资节点**：同一种 Actor 可配置为战利品、队伍仓库或轻量商铺，支持修为奖励、隐藏掉落、需求投骰、真实库存与钱箱；战利品允许玩家查看和领取，仓库存取要求拥有权限，所有交易由活动 GM 复核。
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
<img width="544" height="1017" alt="image" src="https://github.com/user-attachments/assets/94fd3e75-34d4-4a15-98f2-0b6b8401e292" />
<img width="1064" height="1432" alt="image" src="https://github.com/user-attachments/assets/bb65deaf-1eb4-4382-b862-df0978d0ce84" />
<img width="500" height="583" alt="image" src="https://github.com/user-attachments/assets/507705ae-4a03-4f89-bfb4-e0ab903e7310" />
</details>

### 建卡向导 (character-wizard)
*建卡流程全自动指引*
<details>
<summary><strong>点击展开：建卡向导</strong></summary>
<br>
<img width="2476" height="1555" alt="image" src="https://github.com/user-attachments/assets/cf8c91c9-dee7-40ec-bd64-520661fd355e" />
<img width="2557" height="1510" alt="image" src="https://github.com/user-attachments/assets/3cb08c8e-b1b6-437a-9a1f-c64421a3bed9" />
<img width="2230" height="1449" alt="image" src="https://github.com/user-attachments/assets/579b89ac-0a3f-43c5-922d-67fa354f1557" />
<img width="2613" height="1563" alt="image" src="https://github.com/user-attachments/assets/46fc320c-8d9e-4e9d-afeb-b1e40465ae72" />
</details>

### 特效自动化 (AutomatedEffects)
*为规则中绝大部分的资源特效实现了自动化*
<details>
<summary><strong>点击展开：部分资源化展示</strong></summary>
<br>
<img width="1440" height="783" alt="image" src="https://github.com/user-attachments/assets/b9032139-0096-4b2f-b110-536092657999" />
<img width="716" height="1016" alt="image" src="https://github.com/user-attachments/assets/d68ec265-85ea-40b3-be9b-76d5c30069a0" />
<img width="518" height="1335" alt="image" src="https://github.com/user-attachments/assets/d3371da6-ce2c-4cbb-8a9a-e76b92107004" />
<img width="491" height="471" alt="image" src="https://github.com/user-attachments/assets/6e31efb8-7f3a-4d06-a343-f0761fe0c8ad" />
</details>

### 战斗数据统计 (CombatStats)
*内置DPS统计，让你用评分狠狠压力队友*
<details>
<summary><strong>点击展开：战斗数据统计展示</strong></summary>
<br>
<img width="584" height="854" alt="image" src="https://github.com/user-attachments/assets/29cac985-52c4-4b83-b45f-b6c6dd439b41" />
<img width="543" height="529" alt="image" src="https://github.com/user-attachments/assets/14322f30-d738-41c0-b362-60ec570997a2" />
<img width="1008" height="1043" alt="image" src="https://github.com/user-attachments/assets/8a7dcc6d-ebda-484e-9684-be7eb1e35b87" />
<img width="1001" height="1043" alt="image" src="https://github.com/user-attachments/assets/1b3eb645-8cae-4170-9b54-179d99187d88" />
</details>

### 手动修正 (CustomModifiers)
*为了避免自动化无法涉及的部分，添加了手动修正。*
<details>
<summary><strong>点击展开：手动修正界面</strong></summary>
<br>
<img width="1927" height="1307" alt="7" src="https://github.com/user-attachments/assets/34760172-169e-4cc2-a55c-a3cdade0df4c" />
</details>

### 合集包浏览器 (CompendiumBrowser)
*因为合集包数据量庞大，添加了专用浏览器，还包含在筛选条件下随机抽取的功能。*
<details>
<summary><strong>点击展开：合集包浏览器界面</strong></summary>
<br>
<img width="1652" height="1295" alt="072314fc-7f72-44c2-886a-79b6f572e068" src="https://github.com/user-attachments/assets/74576832-b4fb-450e-8d88-951fc414a4c7" />
<img width="1197" height="859" alt="image" src="https://github.com/user-attachments/assets/1ccf063d-926c-4813-a744-289b74ce8b9d" />
</details>

---

## 🚀 安装指南 (Installation)

本系统支持通过 Releases 下载安装，也支持手动安装。

### 📦 方式一：Releases 下载安装

1. **获取安装包**：前往本项目的 [Releases](https://github.com/wdilb/fvtt-system-xjzl-system/releases) 页面。
2. **下载资源**：下载最新版本（Latest）中名为 `system.zip`（或类似名称）的压缩包。
3. **解压部署**：
   - 解压下载的压缩包。
   - **【关键】** 确保解压后的文件夹名为 `xjzl-system`（必须与 `system.json` 中的 `id` 一致）。
   - 将该文件夹移动至你的 Foundry VTT 用户数据目录：
     `.../Data/systems/xjzl-system`
4. **启动系统**：重启 Foundry VTT，在创建世界时即可选择 `xjzl-system`。

### 📂 方式二：手动安装

如果你无法通过上述方式安装，或者需要测试最新版，可以尝试手动部署：

1. 在本项目 GitHub 页面点击绿色的 **Code** 按钮，选择 **Download ZIP**。
2. 解压下载的压缩包。
3. **【关键】** 将解压后的文件夹重命名为 `xjzl-system` (必须严格匹配 `system.json` 中的 `id`)。
4. 将该文件夹放入你的 Foundry VTT 用户数据目录：
   `.../Data/systems/xjzl-system`
5. 重启 Foundry VTT 即可。

---

## ⚠️ 关于数据合集包的重要说明 (Data Disclaimer)

本系统包含庞大的物品与规则数据合集。由于源数据量级过大（超出我个人手动录入负荷），目前系统内所有的合集包数据（Compendium Packs）均由 **AI 辅助转换生成**。

* **潜在风险**：尽管我们在转换过程中修正了多次提示词，但数据中仍**极大可能**存在数值错误、字段遗漏、格式异常或描述偏差。
* **使用建议**：在跑团过程中使用合集物品时，请务必**核对物品、武学描述**，小心分辨，请勿完全盲信自动过程。
* **共建反馈**：如果你发现了数据错误，非常欢迎提交 **Issue** 反馈，帮助修复。感谢你的理解与支持！
---
## 📖 脚本引擎 (Scripting)

系统允许为内功、武学招式、已装备物品、特性和 Active Effect（AE）绑定事件脚本，用于参与派生值、出招、命中、防御、资源变化和回合结算。

脚本引擎的完整公开契约已独立维护，避免 README、项目约定和录入规范各自保存一份容易过期的 API：

- [脚本引擎手册](docs/SCRIPT_ENGINE.md)：触发器、上下文字段、执行顺序、公共 API 和安全模式。
- `module/data/common.mjs`：触发器与脚本 Schema 的运行时代码事实源。

### 快速示例

下面的 `hit` 脚本在攻击命中后发起体魄检定，失败时让目标直接流失 10 点气血：

```javascript
if (!args.isHit || !args.target) return;

await Macros.requestSave({
  target: args.target,
  attacker: actor,
  type: "tipo",
  dc: 18,
  label: "抵抗剧毒",
  damageOnFail: { value: 10, type: "hp" }
});
```

对应的 JSON 脚本条目：

```json
{
  "label": "剧毒检定",
  "trigger": "hit",
  "script": "if (!args.isHit || !args.target) return;\nawait Macros.requestSave({ target: args.target, attacker: actor, type: \"tipo\", dc: 18, label: \"抵抗剧毒\", damageOnFail: { value: 10, type: \"hp\" } });",
  "active": true
}
```

### 编写前须知

- `passive` 和 `calc` 同步执行，脚本内禁止 `await`、Dialog 和文档写入；其余触发器异步执行。
- `actor` 是当前脚本的宿主。攻击侧通常是攻击者，`preDefense`、`preTake`、`damaged` 等防御侧触发器中是受击者。
- 条件变量并非始终存在。优先从 `args` 读取，并检查 `target`、`attacker`、`move`、`item` 是否为空。
- 正常伤害使用 `applyDamage()`，治疗或直接资源增减使用 `applyHealing()`，绝对资源事务使用 `changeResources()`。
- 状态使用 `game.xjzl.api.effects` 管理，检定与对抗优先使用 `Macros`。
- 脚本可执行可信 JavaScript，不是面向不可信代码的安全隔离环境。

## 👥 贡献与鸣谢 (Credits)

*   **系统作者**: Tiwelee
*   **特别感谢**:
    *   **一气长虹**: 提供了核心数据类型设计、计算逻辑参考以及无私的规则指导。
    *   **安迪亚**: 提供了宝贵的界面设计建议与测试反馈。
*   **联系交流**:
*   [![QQ Group](https://img.shields.io/badge/侠界交流群-967477288-blue?logo=tencent-qq&logoColor=white)](https://qm.qq.com/cgi-bin/qm/qr?k=YOUR_LINK)
*   [![QQ Group](https://img.shields.io/badge/系统反馈群-818849921-blue?logo=tencent-qq&logoColor=white)](https://qm.qq.com/cgi-bin/qm/qr?k=YOUR_LINK)
---

> **🎨 素材声明**：系统内包含的大部分图像素材由 AI 生成（非AI生成素材由侠界之旅官方提供）。

<details>
<summary><strong>🔊 音频素材来源 (Audio Credits)</strong></summary>

- **合集包抽取演出配乐**：基于 nene 创作的 [New Sunrise](https://opengameart.org/content/new-sunrise) V2 修改，采用 [Creative Commons Zero v1.0 Universal（CC0）](https://creativecommons.org/publicdomain/zero/1.0/) 许可。
- **合集包抽取演出音效**：由项目作者使用 ElevenLabs Sound Effects 生成。
- 文件对应关系与具体处理方式见 [`assets/sounds/compendium-draw/SOURCES.md`](assets/sounds/compendium-draw/SOURCES.md)。

以上音频素材按各自来源及许可条款使用，不因本项目代码采用 MIT License 而改变其许可条件。

</details>

## 📄 协议 (License)

本项目采用 [MIT License](LICENSE) 开源。
允许在遵守协议的前提下自由修改、分发与使用。
