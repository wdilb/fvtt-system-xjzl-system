# 侠界之旅 V13 → V14 升级方案

本文档是 `feat/v14-upgrade` 分支的总纲，负责记录升级范围、决策、API 依据、代码定位和验收标准；[`V14_PLAN.md`](V14_PLAN.md) 负责工作项、依赖、进度与验证记录。新会话先读执行计划，再按工作项查阅本文对应章节与实际代码。本文中的设计描述不代表待办状态，已完成范围以执行计划为准。

复杂工作可另建专项计划，由执行计划中的原工作项链接过去；本文只同步影响整体范围、接口或决策的结论，不承载逐步施工记录。标注「待验证」或「倾向」的内容不能当作已经确认的事实。

信息来源以[官方发布说明](https://foundryvtt.com/releases/14.368)、[V14 API](https://foundryvtt.com/api/) 和[弃用移除清单 #13436](https://github.com/foundryvtt/foundryvtt/issues/13436) 为准；DCC 迁移参考与社区记录仅提供实测线索。截至 2026-09-22，发布说明核查至 14.368，API 页面标注 14.365，后续验收须记录实际构建号。

历史锚点：`b2f3833` 为首批 A 类替换。数量只是当时的检索基线，不是迁移验收条件，也不表示剩余工作量：脚本统计先解析 data/ JSON，再统计 `script`/`command` 字符串中的调用次数，不能与 grep 命中行数混用。实施时复核实际调用方，以行为和验证结果验收，不为凑齐旧数量修改代码。

---

## 0. 既定决策

| # | 决策 | 内容 |
|---|------|------|
| D1 | 硬切 V14，不做 V13 兼容 | `system.json` 的 `compatibility.minimum/verified` 已设为 14，发布前须经 M5 完整回归确认；迁移后的代码（如 `i18n.localize(key, data)` 插值写法）在 V13 下不可用，属预期 |
| D2 | 保留自研 ActiveEffect 门面 | `game.xjzl.api.effects.addEffect/removeEffect` 等公开 API 保持签名不变。兼容层仅归一化**已到达入口的普通数据**，包括内联构造的 V13 风格入参；调用前访问旧文档路径的脚本无法由它修复，须单独迁移，范围见 §2.3 |
| D3 | 脚本内 `CONFIG.statusEffects.find` 迁移 | 先由 S2.9 实现 `game.xjzl.api.effects.getStatus(id)`，再由 S4.2 按查询谓词迁移 data/ 脚本、S4.7 处理世界副本；检索基线为 script/command 字段中 500 个调用 |
| D4 | 分支策略 | 全部升级工作在 `feat/v14-upgrade` 分支进行 |

**已确认 Q3（保留原问题编号）**：ActiveEffect system 数据模型通过 `CONFIG.ActiveEffect.dataModels` 注册，基础模型为 `foundry.data.ActiveEffectTypeDataModel`，详见 §2.4。是否需要自定义模型、派生字段如何应用变更仍由 S0.1/S0.7 验证，S2.1 落实；注册入口本身不再是待定问题。

### 待定问题（在相关实现前定稿，不阻塞无关工作）

| # | 问题 | 倾向 | 落点 |
|---|------|------|------|
| Q1 | 世界数据迁移框架：`flags.xjzl-system.baseChanges`（V13 格式叠层快照）等系统私有数据如何迁移 | 用独立 world setting 记录已完成的迁移版本；迁移可重复执行，仅全部成功后推进版本，失败时保留可重试状态（见 §6） | S2.7 定稿并实现框架；S4.7 实施与验收世界迁移 |
| Q2 | data/ 源 JSON 的格式转换方式 | 直接把 data/ 全量改为 V14 格式，再 `game.xjzl.seed.all()` 重建合集包（保持事实源唯一）；不采用 seeding 时转换 | S2.6/S4.1 涉及转换方式的改动前定稿，两处遵循同一决策；S4.4 重建合集 |
| Q4 | AOE 工具的产品形态：仅还原"圆圈 + 跟随"，还是升级为完整光环系统 | 见 §3.3，建议按自定义 RegionBehavior 方向做完整设计 | S0.4 提供机制结论；M3 实现前完成 S3.6 中的范围和架构决策 |
| Q5 | 过期清理分工：自研 `cleanExpiredEffects` 与 V14 expiry 事件/registry 如何共存 | 保留自研统一入口以维持叠层语义，registry 作为辅助 | S0.6 提供机制结论；S2.4 定稿并实现，避免双方重复清理 |

定稿后把结论移至上方已确认区，保留原编号和对应工作项；倾向不等于已经决定。§2.6 的可选能力与 Q4 的扩展方案只有明确纳入范围后才安排实施。

### 环境注意

- V14 要求 Node.js 24（与 V13 互斥）；自建服务器需独立部署。
- 桌面端 V13→V14 不能原地升级，需全新安装并建议独立 User Data 目录。
- `socketlib` 已验证支持 V14，依赖不变。
- 升级发布时同步更新 `system.json` 的 `download` 链接版本号。

---

## 1. 升级总览

三大工作块，按体量排序：

1. **ActiveEffect 融合**（§2）：V14 把 `changes` 迁入 `system.changes`、数字 `mode` 改字符串 `type`、duration 模型重做。我们的叠层/抑制/飘字/时长规则引擎全部保留，只迁移数据格式并按新机制重接。
2. **距离与光环 / Region**（§3）：MeasuredTemplate 文档类型已弃用（14.368 保留兼容层），AOE 工具与跟随光环改用 Region 体系重建；是否新增完整光环及脚本触发器，由 Q4 决定。
3. **机械替换与数据迁移**（§4–§6）：i18n、TextEditor、statusEffects 形态、聊天可见性、CSS 变量、渲染钩子等确定性替换，加 data/ 源数据与合集包迁移。

已有架构基础：Sheet/Application 主框架已使用 V2，Actor/Item 数据模型已使用 `foundry.abstract.TypeDataModel`，无需另做这两项架构迁移；具体字段、AE 配置窗、DOM 和钩子仍按后文适配。检索未发现 `template.json`、TinyMCE、`ChatLog.MESSAGE_PATTERNS`、whisper/blind 硬编码、`foundry.utils.duplicate` 或自定义 context menu 钩子的迁移任务，后续新增命中项再补录。

---

## 2. ActiveEffect 融合设计（重点一）

### 2.1 V14 Active Effects V2 能力盘点

- `ActiveEffect#changes` → `ActiveEffect#system#changes`（结构化数据模型承载变更）。
- `EffectChangeData#mode`（数字）→ `#type`（字符串字面量：`custom/multiply/add/subtract/downgrade/upgrade/override`）。[`CONST.ACTIVE_EFFECT_CHANGE_TYPES`](https://foundryvtt.com/api/variables/CONST.ACTIVE_EFFECT_CHANGE_TYPES.html) 的键是类型名，值是默认优先级（如 `add: 20`），不能将成员值当作 `type`，也不存在 `.ADD` 成员。
- `EffectChangeData#value` 官方文档描述会做 JSON 反序列化；**14.368 实测（计划 S0.7）：`"true"` 在模型清洗、DB 写入与 flags 应用全链路保持字符串**，未出现布尔化。flag 类 override 变更（`value: "true"`）按字符串语义读写。
- duration 重做：支持任意时间单位与 **expiry 事件**（如"直到战斗结束"），`ActiveEffect.registry` 追踪临时特效时长。
- 变更支持**应用阶段**（application phases）：[`initial`/`final` 为核心内置阶段](https://foundryvtt.com/api/variables/CONST.ACTIVE_EFFECT_CHANGE_PHASES.html)，`CONFIG.ActiveEffect.phases` 只注册附加阶段，且注册方须在相应时机调用 `Actor#applyActiveEffects(phase)`。M0 验证它们与本系统数据准备顺序的配合，不重复注册内置阶段。
- 变更值可引用 actor 数据（`@` 插值），新增 `subtract` 类型。
- `ActiveEffect#isSuppressed` 判定逻辑简化；提供可 override 的"是否应用某条变更"接口与 `getReplacementData` 富化点。
- `tokenOverrides`：特效可直接改 Token 的视野/光照/形象/阵营/透明度。
- ActiveEffect 升级为可直接存入合集包的文档类型。
- `ActiveEffect#origin` 改为 DocumentUUIDField（合法 UUID 才能通过校验）。
- `CONFIG.ActiveEffect.legacyTransferral` 的兼容支持彻底移除；现有 `isSuppressed` 已按物品特效保留在 Item 上的模型实现，S2.2 清理过时注释并回归转移与抑制行为。

### 2.2 自研功能 × V14 能力对照

| 自研能力 | 现实现 | V14 对应 | 融合策略 |
|---|---|---|---|
| slug 叠层体系（stacks/maxStacks/stackable、baseChanges 快照、`calculateChangesForStacks` 乘算） | `module/documents/active-effect.mjs` + flags | **无原生叠层** | 全部保留；`type === "add"` 判断已修正（S1.3），沿用现实现；剩余内部读写由 S2.2/S2.6 迁移至 `system.changes`，baseChanges 快照随 S2.7/S4.7 迁移 |
| 装备状态抑制（未装备不生效、破衣抑制防具） | `isSuppressed` getter override | `isSuppressed` 判定简化 | 保留 override，按新逻辑重测 |
| 自定义飘字（绿/红/叠层字幕、socket 广播、状态卡片） | `_displayScrollingStatus` 屏蔽 + `showScrollingText` socket | 核心飘字仍在但能力弱 | 保留自研；验证 override 与 `{scrollingStatusText: false}` 选项仍有效 |
| 时长规则引擎（叠加/刷新/锚点重置、忍耐减免剧痛、颤手→缴械、心火→走火入魔） | `active-effect-manager.mjs` | duration 新模型仅覆盖"存储与过期"语义 | 规则引擎全部保留；读写对齐新 schema（见 2.3） |
| 过期清理（战斗流转时 `cleanExpiredEffects`） | `xjzl-system.mjs` updateCombat 流程 | expiry 事件 + registry | 按 Q5 决策；倾向保留统一入口 |
| 状态选取器（通用状态/场上特效/收藏/最近） | `effect-selection-dialog.mjs` | 无直接对应 | 对象访问替换已由 S1.5 完成；S2.8 负责与新 AE 数据链路联调 |
| 特效挂载脚本（`flags.scripts` + `collectScripts`/`runScripts`） | `XJZLActiveEffect.scripts` | 无对应 | 保留 |
| 权限代理（玩家操作经 socketlib 委托 GM） | manager + `module/socket.mjs` | 无对应 | 保留 |
| 状态定义（全量替换核心状态表） | `module/config.mjs` 的 `XJZL.statusEffects`，经 `CONFIG.XJZL` 暴露 | `CONFIG.statusEffects` 按 id 键访问 | S1.5 已在 `xjzl-system.mjs` 的 init 赋值处用 `Object.fromEntries` 转换；源定义继续保持数组。S2.6 仅迁移条目内 AE 数据字段，不再次改变容器形态（§4-A5） |
| V13 入参兼容 | 无 | — | 新增：`addEffect/removeEffect` 入口做格式归一化（D2），覆盖 `changes`/`mode`/旧 `duration`/`icon→img`；不能修复到达入口前的文档访问，见 §2.3 |

### 2.3 数据格式迁移细节

- 读取侧：所有文档上的 `effect.changes` → `effect.system.changes`。涉及 [active-effect.mjs](../module/documents/active-effect.mjs)（`_preCreate` 快照、`calculateChangesForStacks`）、[active-effect-manager.mjs](../module/managers/active-effect-manager.mjs)（`addEffect`/`removeEffect`）、[personality.mjs](../module/data/item/personality.mjs)（`buildModifierEffectData`/`syncToEffect`）、[actor.mjs](../module/documents/actor.mjs)（`XJZLActor.prepareBaseData` 扫描 flag 键）、[item.mjs](../module/documents/item.mjs)、[config.mjs](../module/config.mjs)（`XJZL.statusEffects` 条目）。逐点核查剩余访问，不重复改写 S1.3 已完成的类型判断。
- 写入侧：`update({changes})` → `update({"system.changes": ...})`；`effectData.changes` 构造点同理。
- duration：`ActiveEffectManager.addEffect` 中 `rounds/turns/seconds/startRound/startTurn/startTime` 的读写、叠加与刷新逻辑按 V14 schema 适配；`compareDurations`/`getDurationScore` 保留现有时长比较规则，新单位或 expiry 事件的处理随 S0.6/Q5 定稿，不能预设只改取值路径即可。`cleanExpiredEffects` 需重测 `duration.remaining`/`isTemporary` 语义及与核心 registry 的清理分工。
- 兼容层（D2）：`addEffect` 收到的对象若带顶层 `changes`/数字 `mode`/旧 `duration` 结构/`icon` 字段，先归一化为 V14 格式再进入流程。边界取决于数据是否已到达入口，而非对象是否写成内联字面量。脚本若先读取文档再修改（如 `thisItem.effects.getName(x).toObject()` 后 `eff.changes.push(...)`），会在调用前失败，必须迁移；直接绕过门面创建/更新 AE 的脚本也必须适配。当前脚本中 `eff/effect/thisEffect/ae.changes` 共 98 处，只是检索起点，须追踪变量来源并检查其他别名。
- 状态查询门面（D3，**S2.9 先于 S4.2/S4.7**）：在 `ActiveEffectManager` 新增静态 `getStatus(id)`，通过现有 `game.xjzl.api.effects` 入口暴露。拟定契约为同步按状态 id 查询，未命中返回 `undefined`，命中返回可安全修改的状态数据副本，不能污染 `CONFIG.statusEffects`；不负责创建或更新文档。返回数据格式与 S2.6 一致，并同步 `SCRIPT_ENGINE.md` 中的公共 API 说明。
- 脚本直查状态（D3）：检索基线中的 500 个 `CONFIG.statusEffects.find(...)` 调用须按谓词分类；按 id 查询在 S2.9 完成后改用 `getStatus`，其他条件保留查询语义。解析 JSON 后修改目标脚本字段，再验证脚本语法与未命中项，不能对整个文件做无条件文本替换。

### 2.4 init 配置与模型选择

- 官方注册入口已明确为 [`CONFIG.ActiveEffect.dataModels`](https://foundryvtt.com/api/variables/CONFIG.ActiveEffect.html)；M0 只决定是否需要自定义模型，核心模型足够时无需额外注册。
- 若需要扩展，继承 [`foundry.data.ActiveEffectTypeDataModel`](https://foundryvtt.com/api/classes/foundry.data.ActiveEffectTypeDataModel.html)；扩展 changes schema 时保留 `type`、`phase`、`priority`，并验证新建和存量效果的类型选择。
- `CONFIG.ActiveEffect.documentClass` 继续承载自研文档行为，不能代替 system 数据模型注册。内置 `initial`/`final` 不重复配置；附加阶段按需增量注册并显式调用，不覆盖整个 phases 表。

S2.2 同步清理 [active-effect.mjs](../module/documents/active-effect.mjs) 的 `XJZLActiveEffect.isSuppressed` 中 `legacyTransferral` 相关过时注释，并验证物品特效抑制行为。

### 2.5 需重写的组件

- **`XJZLActiveEffectConfig`**（[active-effect-config.mjs](../module/sheets/active-effect-config.mjs)）：现依赖 `renderXJZLActiveEffectConfig` 钩子 + jQuery 注入 DOM + `app._tabs[0].active` 内部状态 + `app.setPosition` + V13 核心配置窗 Tab 结构（`details/duration/changes/effects`）。V14 核心 ActiveEffectConfig 为 AE V2 全新实现，上述全部失效。改为 ApplicationV2 规范做法：子类声明自己的 tab 与 `PARTS`/partial，事件用 `actions` 绑定，去除 jQuery 与钩子注入。
- **`XJZLActiveEffect` 类**：`calculateChangesForStacks` 的 `type === "add"` 已修正；M2 仍须迁移 `_preCreate` 的 `data.changes` 快照到 `data.system?.changes`，转换旧 baseChanges，并验证 `_displayScrollingStatus` 签名及完整叠层流程。

### 2.6 可选的 V14 新能力采纳（不阻塞升级，逐项独立评估）

- `tokenOverrides`：目盲、伪装、光照类特效可声明式化，替代部分脚本。
- 变更值引用 actor 数据：数值类 buff（如"按等级加成"）可少写脚本。
- 特效独立入包：状态库可脱离 Item 直接进合集包，状态选取器可接入。
- `subtract` 类型：减益数值可直接表达。

### 2.7 设计红线

- 谨慎覆写 Actor 的 `applyActiveEffects`：保留按 phase 筛选和调用的契约，避免重复应用。自定义变更的官方入口是静态 [`ActiveEffect.applyChange()`/`applyChangeField()`](https://foundryvtt.com/api/classes/foundry.documents.ActiveEffect.html#applychange)，`shouldApplyChange()` 只负责是否应用的判定。先实测数值、数字字符串、布尔 override、`@` 引用及非 schema 派生字段，再决定是否需要定制；不依据早期社区案例直接增加 workaround。
- 兼容层只做"入参归一化"，不做"数据回写"：不要把 V13 格式写回数据库，保证存量数据单向迁净。

---

## 3. 距离与光环 / Region 设计（重点二）

### 3.1 V14 Region 能力盘点

- Region 形状：圆形、矩形、多边形、直线、锥形、网格集合（`GridShapeData`，按格定义任意形状，与我们的 1-2-2-2 距离天然契合）。
- `RegionDocument#attachment.token`：区域**附着 Token 并自动跟随**；`hidden` 状态可与所附 Token 联动。
- 行为框架：事件驱动（Token 进入/离开/区域内移动等），核心自带 **Apply Active Effect** 行为（区域对内部 Token 施加/移除特效）。
- `RegionDocument#createTokenEmanation`：从 Token 生成放射状区域。
- `RegionLayer#placeRegion(s)`：交互式放置，支持 `attachToToken`、`preCommit` 等。
- 其他：隐藏区域（仅 GM）、传送/生成 Token 行为、表面遮挡行为等。

### 3.2 现有 MeasuredTemplate 功能归宿

V14 **弃用 MeasuredTemplate 文档类型**（14.368 实测保留兼容层：类、`CONFIG.MeasuredTemplate`、`scene.templates` 仍可用，未来版本移除），逐项归宿：

| 现功能 | 现实现 | V14 归宿 |
|---|---|---|
| AOE 圆圈创建（静态/跟随两种模式） | [aoe-creator.mjs](../module/applications/aoe-creator.mjs) `createEmbeddedDocuments("MeasuredTemplate")` | 创建圆形 Region；跟随模式用 `attachment.token` |
| 跟随同步（粘性模板随 Token 移动） | [xjzl-system.mjs](../xjzl-system.mjs) `updateToken` 钩子手写同步 | `attachment.token` 原生替代，**删除手写同步** |
| Token 删除时自动清理 | `deleteToken` 钩子 | 验证核心是否自动清理附着区域；若不自动清理，再补充 Region 删除逻辑 |
| 自定义标签显示 | 模板 flag `label` + `measured-template.mjs` 自绘文字 | Region 名称/显示测量选项 |
| 1-2-2-2 网格高亮（圆形按格覆盖算法） | `XJZLMeasuredTemplate._getGridHighlightPositions` | 与 `GridShapeData` 结合重做，或先降级为核心高亮（待设计） |
| `tokens` 接口（AoE 自动化预留，暂无调用方） | `XJZLMeasuredTemplate.tokens` | Region 事件/查询 API 重新设计 |
| 工具栏 AOE 按钮 | 注入 `controls.templates` 层 | templates 层已删除；按钮迁至 token 层或 region 层 |
| 跟随光环宏 | [data/macros/utility.json](../data/macros/utility.json) | 改写为 Region 版，或并入光环系统（§3.3） |
| `CONFIG.MeasuredTemplate.objectClass` 注册 + [measured-template.mjs](../module/measured-template.mjs) | 整文件 | 删除 |

> 摘除动作（静态 import、CONFIG 注册、`scene.templates` 相关钩子与 AOE 创建调用）已在 M1 完成：14.368 兼容层下旧代码仍可运行，摘除并非启动所必需，而是**不基于弃用 API 继续开发**（兼容层将在未来版本移除，届时再摘即为启动阻断）；本节的 Region 重建设计属于 M3。

### 3.3 光环设计方向（Q4，待重点讨论）

三个候选架构：

- **方案 A：纯核心行为**——直接用核心 Apply Active Effect 行为。零自研代码，但应用不走我们的 `addEffect`，丢失 slug/叠层/权限代理/飘字语义，与脚本引擎无融合。
- **方案 B：自定义 RegionBehavior 子类（建议）**——系统注册自己的光环行为类型（如 `xjzl-aura`），在 Token 进入/离开事件里调用 `game.xjzl.api.effects.addEffect/removeEffect`。完整保留自研语义；光环定义（半径/形状/跟随/来源物品/生效条件）挂在武学/内功/奇珍等 Item 的 system 数据上，由行为或管理器负责创建与销毁 Region。
- **方案 C：混合**——纯视觉区域用核心行为，玩法光环用自定义行为。

方案 B 的脚本引擎集成设想（新触发器需同步 `SCRIPT_TRIGGERS`/`TRIGGER_CHOICES`/本地化/`SCRIPT_ENGINE.md`）：

- 新触发器：`auraEnter` / `auraExit`（或统一为 `regionEnter`/`regionExit`），上下文提供区域、光环来源 Item、进入/离开的 Actor。
- 光环生命周期：装备/运转某物 → 创建附着 Region → 进出结算 → 卸下/停止 → 移除 Region 与光环特效。
- AOECreator 与光环工具合并为统一的"区域工具"（手动区域 + 物品驱动光环共用一套 Region 生成逻辑）。

### 3.4 1-2-2-2 距离的保留与验证

- `SquareGrid.prototype.measurePath` 劫持（[xjzl-system.mjs](../xjzl-system.mjs) init 内）：V14 未标记破坏，但属于内部 API，实机验证；V14 新增 `BaseGrid#getLine/getRectangle/getEllipse` 等接口，若 measurePath 行为变化需重适配。
- 标尺劫持 `CONFIG.Canvas.rulerClass.prototype._getWaypointLabelContext`：V14 TokenRuler 有改动（路径点标签支持中间航点等），需重适配。
- 若 §3.2 的网格高亮改用 `GridShapeData`，圆形"按 1-2-2-2 覆盖哪些格"可直接复用我们已有的遍历+剪枝算法输出格子集合。

---

## 4. API 替换清单（A2 可选；A10 需适配参数与返回值）

| # | 改动 | 位置与数量 |
|---|------|-----------|
| A1 | `game.i18n.format(key, data)` → `game.i18n.localize(key, data)` | `b2f3833` 实际替换 73 处（V14 将 format 并入 localize） |
| A2 | `foundry.applications.ux.TextEditor.implementation.enrichHTML(...)` → 直接调用该 TextEditor 类的 `enrichHTML(...)` | 已改 10 处 / 8 文件：compendium-browser、loot-workbench-sheet、equipment-sheet、neigong-sheet、general-item-sheet、art-book-sheet、trait-sheet、wuxue-sheet。[官方 `.implementation` getter 仍有效](https://foundryvtt.com/api/classes/foundry.applications.ux.TextEditor.html#implementation)；这是可选调整，存在编辑器替换模块时不保证行为等价，列入 M5 兼容性回归 |
| A3 | 数字 `mode` → 字符串 `type` 字面量（如 `2→"add"`、`5→"override"`）；不做两个 CONST 表之间的成员替换 | 首批 active-effect.mjs、personality.mjs、config.mjs 已改；其他代码构造点与数据分别由 S2.6/S4.1 迁移 |
| A4 | ActiveEffect 数据 `icon:` → `img:` | personality.mjs（唯一一处） |
| A5 | `CONFIG.statusEffects` 数组 → 按 id 键对象；`.find(e => e.id === x)` → `CONFIG.statusEffects[x]`；`.map(...)` → `Object.values(...)` | 源定义保持数组，在 [xjzl-system.mjs](../xjzl-system.mjs) 的 CONFIG 赋值处用 `Object.fromEntries` 转换；[条目 `id` 仍按官方接口保留](https://foundryvtt.com/api/interfaces/CONFIG._StatusEffectConfig.html#id)，并与对象键保持一致。调用侧涉及 active-effect-manager、chat-manager、effect-selection-dialog、xjzl-system.mjs |
| A6 | `game.settings.get("core","rollMode")` → `"messageMode"`；`ChatMessage.applyRollMode` → `ChatMessage.applyMode`；模式串 `publicroll→public`、`gmroll→gm`、`blindroll→blind`、`selfroll→self` | `utils.mjs` 的 `rollDisabilityTable`、`XJZLActor.rollBasicAttack`、`XJZLItem.roll`、`XJZLContainerTransactionManager.#postNeedChat`（固定公开消息） |
| A7 | `system.json` 兼容版本 13 → 14；发布时更新 download 链接（`verified: 14` 的发布依据须通过 M5 完整回归，M0 机制试验不足以代替） | [system.json](../system.json) |
| A8 | `ApplicationV2#bringToTop()` → `bringToFront()`（V14 已移除） | character-sheet.mjs 审计日志入口（1 处） |
| A9 | ChatMessage 数据 `user:` → `author:`（旧字段及其迁移/shim 在 V14 已移除） | 已改模块 27 处、data/ 脚本 88 处（按调用次数口径）；已导入的世界脚本副本仍由 S4.7 处理 |
| A10 | `canvas.grid.measureDistance()` → `measurePath()`（V14 已移除；入参从 Token 对象改为路径点坐标，需验证取点与距离单位），随 M4 处理 | data/ 脚本 2 处（armor/top.json、wuxue/xiaoyaopai.json） |

> 除本表外，[官方 #13436](https://github.com/foundryvtt/foundryvtt/issues/13436) 是**必查清单**：M1 审计入口、module 与模板（其中也有 Handlebars helper 的移除），M4 审计 data/ 脚本字符串。已预检的 `grid.getOffset/getCenterPoint/getTopLeftPoint/measurePath` 与 `foundry.grid.SquareGrid` 使用新命名，但命名正确不能替代实际行为回归。

---

## 5. 其他逻辑改动

| # | 改动 | 说明 |
|---|------|------|
| B1 | AE 全链路（见 §2） | 重点一 |
| B2 | `XJZLActiveEffectConfig` 重写（见 §2.5） | 脱离 jQuery 钩子注入，改 V2 规范 |
| B3 | MeasuredTemplate → Region（见 §3） | 重点二 |
| B4 | 渲染钩子**逐钩子实测** V14 派发形态，不做批量改名：ApplicationV2 的通用渲染钩子就是 `render<ClassName>`（参数为 HTMLElement），`renderChatMessageHTML` 是 ChatMessage 专属命名、不可推广到其他窗口。`renderItemDirectory`/`renderActorDirectory`/`renderCompendiumDirectory` 预期原名保留；`renderTokenHUD` 单独核查 V14 中 TokenHUD 的形态、选择器与事件委托（不能只凭 HTMLElement 兼容判断无需修改）；`renderCombatTracker` 双绑实测后清理冗余的一侧 | [官方 ApplicationV2 钩子契约](https://foundryvtt.com/api/functions/hookEvents.renderApplicationV2.html)；现有代码已按 HTMLElement 兼容书写 |
| B5 | 核查 `xjzl-system.mjs` 的 `Hooks.once("init")` 内 `Actors.unregisterSheet`/`Items.unregisterSheet` 及其 `foundry.applications.sheets.ActorSheet/ItemSheet` 引用：确认 V14 核心默认表的注册形态与继承链后，再删除或改写注销逻辑 | [AppV1 仍存在于弃用命名空间](https://foundryvtt.com/api/classes/foundry.appv1.api.Application.html)，自 V13 弃用；我们为所有类型注册了 `makeDefault` 的 V2 表 |
| B6 | `-=`/`==` 更新键在 **V14 弃用，移除期为 V16**。审计写入方与钩子接收形态，迁移到 `foundry.data.operators`；确认删除/替换仍触发 `_changesResourceScriptSources` 重算后，再精简 `"-=ignoreArmorEffects"` 检测 | [官方 #13090](https://github.com/foundryvtt/foundryvtt/issues/13090)；核查 operator 经 socket 传递和更新钩子归一化后的行为，不直接删掉检测 |
| B7 | CSS 旧变量族替换：`--color-border-light-*`（8）、`--color-text-dark-primary`（4）、`--color-text-light-primary`、`--color-text-light-highlight`、`--color-shadow-highlight`、`--color-border-dark` | 共 17 处，分布在 item-equipment/trait/general.css 等；按 V14 变量表映射，聊天样式注意新 `--chat-*` 变量 |

---

## 6. 数据与合集包迁移

1. **data/ 源 JSON 中的 AE 数据转 V14 格式**：`changes` → `system.changes`、数字 `mode` → 字符串 `type`、`icon` → `img`、duration 对齐。按 AE 结构遍历，避免修改其他同名字段；涉及 armor/consumables/neigong/wuxue/qizhen/origins/traits 等源文件。
2. **脚本迁移**（D3）：S2.9 的查询 API 可用后，按谓词迁移检索基线中的 500 个 `CONFIG.statusEffects.find` 调用；构造 V13 风格数据且经门面传入的脚本可由 D2 承接，直接调用核心文档 API 的须迁移；2 处 `measureDistance` 改 `measurePath`，核对取点、返回值和单位。
3. **文档访问类脚本迁移**：以 98 处 `eff/effect/thisEffect/ae.changes` 为起点，追踪文档、导出对象与普通构造对象来源，前两者改 `system.changes`；继续检查其他变量别名，不能把这 98 处当成完整覆盖证明。
4. **合集包重建**：所有 data/、seed-*.mjs 修改及脚本 API 审计完成后，GM 端执行 `game.xjzl.seed.all()`；验证包内数据及导入行为，不能仅以种子函数返回成功验收。
5. **世界侧副本迁移**（不受 data/ 迁移与合集重建影响）：覆盖世界物品、角色内嵌物品、非关联 Token 的 Actor、Actor/Item 上的 AE 与其脚本、已导入宏。既要处理 baseChanges 等私有数据，也要处理状态查询、changes 访问、聊天 `author`、距离 API 和光环宏。核心对 AE schema 的迁移不能改写这些任意脚本字符串。对用户修改过的脚本仅做可确认的定点转换，无法识别的记录 UUID/字段位置供人工处理，不整项覆盖。
6. **宏包**：utility.json 跟随光环宏改写（并入 §3.3）。
7. **对照官方 #13436 清单审计 data/ 脚本字符串**中的已移除 API（与 M1 的 module 侧审计对应）。
8. **文档同步**：`CLAUDE.md`（V13 引用与不变量描述）、`SCRIPT_ENGINE.md`（mode→type、changes 格式、状态访问新方式）、`SEEDING_GUIDELINES.md`（若录入格式变化）、`README.md`、`PROJECT_MAP.md`（若入口变化）。

世界迁移先在备份的 V13 世界副本验证，由活动 GM 单次执行并记录结果；测试首次迁移、重复启动和中断后重试。仅全部成功后更新独立迁移版本，失败或存在未解决项时不得标记整体完成。验收同时覆盖新世界导入与既有世界升级，确认用户修改保留、二次运行不重复加成或创建效果。

---

## 7. 实机验证清单（V14 未标破坏，但我们踩在内部 API 上）

**画布原型劫持**：`SquareGrid.prototype.measurePath`（1-2-2-2 计费）；`rulerClass.prototype._getWaypointLabelContext`（标尺）；`Token.prototype._refreshTurnMarker`/`_animateTurnMarker`（[combat-turn-marker.mjs](../module/combat-turn-marker.mjs)）。

**画布 API**：`canvas.interface.createScrollingText`；`CONST.TEXT_ANCHOR_POINTS`；`actor.getActiveTokens`；`canvas.tokens.hover/controlled`。

**特效行为**：`isSuppressed` override；`_displayScrollingStatus` override；`{scrollingStatusText: false}` 选项；`new XJZLActiveEffect(data, {parent})` 临时实例化（叠层计算用）；`isTemporary`/`duration.remaining` 新语义；`transfer` 字段行为。

**杂项**：`CONFIG.specialStatusEffects.BLIND`（目盲屏蔽）；`CONFIG.time.roundTime`；`getSceneControlButtons` 注入结构（tools 对象/Map）与 `onChange` 按钮；`CONFIG.ui.pause` 替换（GamePause 类）；`hotbarDrop` 钩子（V14 调整了锁检查顺序）；`ClientDocument.fromDropData` 不再写 `_stats.compendiumSource`（影响拖拽查重）；附着 Region 是否随 Token 删除。

**首批替换回归**：聊天作者与 public/gm/blind/self 可见性（含 `Roll.toMessage`）；审计日志重复打开后置前；富文本增强、链接与编辑器配置实现兼容性（A2）；状态对象的 key/id 一致性与 HUD 操作。

---

## 8. 阶段依赖与验收标准

实际进度及验收证据只在执行计划维护；本表定义完成条件。工作项编号用于稳定引用，不代表必须按数字顺序执行。

| 里程碑 | 内容 | 出口标准 |
|--------|------|----------|
| M0 验证 spike | 确认是否需要自定义 AE 模型、核心阶段与数据准备的配合、duration、Region API 及 §7 劫持点；官方已明确的注册入口不再作为未知项 | 记录 Foundry 构建号、样例和结论，解决影响实现的待定问题 |
| M1 机械替换与启动解阻 | A1–A9 + B4/B5/B6/B7 + S1.14 摘除旧模板依赖 + #13436 的入口/module/模板审计；A10 随 M4 | 空白测试世界完成 init/ready，启动路径无未处理异常和本阶段涉及的弃用警告；AE/脚本/AOE 功能分别留待后续里程碑验收 |
| M2 AE 链路 | §2 必需改动 + D2 兼容层 + S2.9 状态查询 API + Q1 迁移框架（§2.6 新能力另评估） | 用 V14 测试数据验证叠层/抑制/飘字/时长/阶段、旧入参兼容与查询副本隔离；世界迁移样本由 M4 验收 |
| M3 Region/光环 | 恢复旧 AOE 功能与距离语义；Q4 决定是否纳入完整光环和新触发器 | 静态/跟随区域、Token 删除清理、1-2-2-2 正常；完整光环若暂缓则记录决策 |
| M4 数据迁移 | §6 数据与脚本转换、API 审计、packs 重建、世界副本迁移；依赖 M2，光环宏另依赖 M3 | 新世界导入与既有世界升级均通过；重复执行及失败重试正确，未解决项有定位且未被误标完成 |
| M5 回归与文档 | §7 清单逐项回归 + 文档同步 + S5.6 发布声明核验 | 完整战斗流程实测通过，各阶段必需项与验收齐全，文档更新；据此确认 `verified: 14` 与发布链接，明确记录未纳入范围的可选能力 |

优先做 M0 的机制试验，可使用独立 V14 最小环境；若验证必须依赖完整系统，先完成 S1.14 等必要启动修复，再补做依赖它的验证，不把暂时无法验证记作通过。M1 启动可用后，M2/M3 可穿插；M3 实现前先定 Q4。M4 先完成源数据、脚本及 API 审计，再执行 S4.4 重建合集与 S4.7 世界迁移验收；状态查询迁移依赖 S2.9。M0 中的机制结论不能替代 M1–M5 的系统集成验收。
