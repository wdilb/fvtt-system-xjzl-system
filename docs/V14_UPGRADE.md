# 侠界之旅 V13 → V14 升级方案

本文档是 `v14-upgrade` 分支的总纲：记录既定决策、两大重点领域（ActiveEffect 融合、距离与光环/Region）的设计分析，以及全量改动清单与实施顺序。改动清单以代码检索为依据，标注了文件与数量；标注「待验证」的条目依赖 V14 实机确认，规划时不应视为事实。

信息来源：官方各版本发布说明（14.349–14.368）、DCC 系统的 V14 迁移参考、社区 wiki。官方尚未发布 V13→V14 迁移专文，本文档基于发布说明与实读代码整理。

---

## 0. 既定决策

| # | 决策 | 内容 |
|---|------|------|
| D1 | 硬切 V14，不做 V13 兼容 | 升级后 `system.json` 的 `compatibility.minimum/verified` 直接设为 14；迁移后的代码（如 `i18n.localize(key, data)` 插值写法）在 V13 下不可用，属预期 |
| D2 | 保留自研 ActiveEffect 门面 | `game.xjzl.api.effects.addEffect/removeEffect` 等公开 API 保持签名不变；data/ 与世界中约 2000 处脚本调用**不迁移**，由管理器内部的格式归一化层承接 V13 风格入参 |
| D3 | 脚本内 `CONFIG.statusEffects.find` 批量替换 | 该写法在 V14（对象形态）下直接报错，且无法用兼容层拦截；需新增辅助函数（如 `game.xjzl.api.effects.getStatus(id)`）并批量替换 data/ 中约 478 处脚本字符串 |
| D4 | 分支策略 | 全部升级工作在 `v14-upgrade` 分支进行，本文档为分支第一变更 |

### 待定问题（在各里程碑开工前必须拍板）

| # | 问题 | 倾向 |
|---|------|------|
| Q1 | 世界数据迁移框架：`flags.xjzl-system.baseChanges`（V13 格式叠层快照）等系统私有数据如何迁移 | 引入 `system.version` 版本化迁移机制一次性转换（系统首次需要世界级迁移，建议借此建立机制） |
| Q2 | data/ 源 JSON 的格式转换方式 | 直接把 data/ 全量改为 V14 格式，再 `game.xjzl.seed.all()` 重建合集包（保持事实源唯一）；不采用 seeding 时转换 |
| Q3 | ActiveEffect system 数据模型的注册机制（`CONFIG.ActiveEffect.dataModels` 还是随 documentClass 扩展） | M0 实机 spike 确认 |
| Q4 | AOE 工具的产品形态：仅还原"圆圈 + 跟随"，还是升级为完整光环系统 | 见 §3.3，建议按自定义 RegionBehavior 方向做完整设计 |
| Q5 | 过期清理分工：自研 `cleanExpiredEffects` 与 V14 expiry 事件/registry 如何共存 | 保留自研统一入口以维持叠层语义，registry 作为辅助 |

### 环境注意

- V14 要求 Node.js 24（与 V13 互斥）；自建服务器需独立部署。
- 桌面端 V13→V14 不能原地升级，需全新安装并建议独立 User Data 目录。
- `socketlib` 已验证支持 V14，依赖不变。
- 升级发布时同步更新 `system.json` 的 `download` 链接版本号。

---

## 1. 升级总览

三大工作块，按体量排序：

1. **ActiveEffect 融合**（§2）：V14 把 `changes` 迁入 `system.changes`、数字 `mode` 改字符串 `type`、duration 模型重做。我们的叠层/抑制/飘字/时长规则引擎全部保留，只迁移数据格式并按新机制重接。
2. **距离与光环 / Region**（§3）：MeasuredTemplate 文档类型整体移除，AOE 工具与跟随光环改用 Region 体系重建；同时计划把"光环"作为新能力嵌入脚本引擎。
3. **机械替换与数据迁移**（§4–§6）：i18n、TextEditor、statusEffects 形态、聊天可见性、CSS 变量、渲染钩子等确定性替换，加 data/ 源数据与合集包迁移。

已经达标、无需改动的部分：Sheet 层全部为 `ActorSheetV2/ItemSheetV2/ApplicationV2 + HandlebarsApplicationMixin`；数据层全部为 `foundry.abstract.TypeDataModel`（无 `template.json`，V14 已将其废弃）；无 TinyMCE、无 `ChatLog.MESSAGE_PATTERNS`、无 whisper/blind 硬编码、无 `foundry.utils.duplicate`、无自定义 context menu 钩子。

---

## 2. ActiveEffect 融合设计（重点一）

### 2.1 V14 Active Effects V2 能力盘点

- `ActiveEffect#changes` → `ActiveEffect#system#changes`（结构化数据模型承载变更）。
- `EffectChangeData#mode`（数字）→ `#type`（字符串：`custom/multiply/add/subtract/downgrade/upgrade/override`，常量 `CONST.ACTIVE_EFFECT_CHANGE_TYPES`；`CONST.ACTIVE_EFFECT_MODES` 废弃）。
- `EffectChangeData#value` 会做 JSON 反序列化：`"true"` 将存为布尔 `true`。我们的 flag 类 override 变更（`value: "true"`）读写要注意类型。
- duration 重做：支持任意时间单位与 **expiry 事件**（如"直到战斗结束"），`ActiveEffect.registry` 追踪临时特效时长。
- 变更支持**应用阶段**（application phases）；系统须在 init 注册 `CONFIG.ActiveEffect.phases`（至少 `initial`/`final`），否则应用特效时报错。
- 变更值可引用 actor 数据（`@` 插值），新增 `subtract` 类型。
- `ActiveEffect#isSuppressed` 判定逻辑简化；提供可 override 的"是否应用某条变更"接口与 `getReplacementData` 富化点。
- `tokenOverrides`：特效可直接改 Token 的视野/光照/形象/阵营/透明度。
- ActiveEffect 升级为可直接存入合集包的文档类型。
- `ActiveEffect#origin` 改为 DocumentUUIDField（合法 UUID 才能通过校验）。
- `CONFIG.ActiveEffect.legacyTransferral` 的兼容支持彻底移除——V13 下我们已默认运行新模型（false），行为无缝；相关注释清理即可。

### 2.2 自研功能 × V14 能力对照

| 自研能力 | 现实现 | V14 对应 | 融合策略 |
|---|---|---|---|
| slug 叠层体系（stacks/maxStacks/stackable、baseChanges 快照、`calculateChangesForStacks` 乘算） | `module/documents/active-effect.mjs` + flags | **无原生叠层** | 全部保留；内部读写改走 `system.changes`；`mode` 判断改 `type` 字符串；baseChanges 快照随 Q1 迁移 |
| 装备状态抑制（未装备不生效、破衣抑制防具） | `isSuppressed` getter override | `isSuppressed` 判定简化 | 保留 override，按新逻辑重测 |
| 自定义飘字（绿/红/叠层字幕、socket 广播、状态卡片） | `_displayScrollingStatus` 屏蔽 + `showScrollingText` socket | 核心飘字仍在但能力弱 | 保留自研；验证 override 与 `{scrollingStatusText: false}` 选项仍有效 |
| 时长规则引擎（叠加/刷新/锚点重置、忍耐减免剧痛、颤手→缴械、心火→走火入魔） | `active-effect-manager.mjs` | duration 新模型仅覆盖"存储与过期"语义 | 规则引擎全部保留；读写对齐新 schema（见 2.3） |
| 过期清理（战斗流转时 `cleanExpiredEffects`） | `xjzl-system.mjs` updateCombat 流程 | expiry 事件 + registry | 按 Q5 决策；倾向保留统一入口 |
| 状态选取器（通用状态/场上特效/收藏/最近） | `effect-selection-dialog.mjs` | 无直接对应 | 保留；`CONFIG.statusEffects` 访问改对象形态 |
| 特效挂载脚本（`flags.scripts` + `collectScripts`/`runScripts`） | `XJZLActiveEffect.scripts` | 无对应 | 保留 |
| 权限代理（玩家操作经 socketlib 委托 GM） | manager + `module/socket.mjs` | 无对应 | 保留 |
| 状态定义（全量替换核心状态表） | `CONFIG.XJZL.statusEffects`（数组） | CONFIG 改为按 id 键对象 | 定义处转对象形态（§4-A5） |
| V13 入参兼容 | 无 | — | 新增：`addEffect/removeEffect` 入口做格式归一化（D2），覆盖 `changes`/`mode`/顶层 `duration` 的 V13 风格入参 |

### 2.3 数据格式迁移细节

- 读取侧：所有 `effect.changes` → `effect.system.changes`。涉及 [active-effect.mjs](../module/documents/active-effect.mjs)（`_preCreate` 快照、`calculateChangesForStacks`）、[active-effect-manager.mjs](../module/managers/active-effect-manager.mjs)（增删叠层全流程）、[personality.mjs](../module/data/item/personality.mjs)（`buildModifierEffectData`/`syncToEffect`）、[actor.mjs](../module/documents/actor.mjs)（约 845 行扫描 `e.changes` 找 flag 键）、[item.mjs](../module/documents/item.mjs)、[config.mjs](../module/config.mjs)（全部状态定义）。
- 写入侧：`update({changes})` → `update({"system.changes": ...})`；`effectData.changes` 构造点同理。
- duration：现有 `rounds/turns/seconds/startRound/startTurn/startTime` 的读写与叠加逻辑（manager 4.1/4.2 节）按 V14 新 schema 重写；`compareDurations` 评分算法语义不变，仅取值路径调整。`duration.remaining`/`isTemporary` 语义有微调（remaining 返回按存储单位的总剩余），`cleanExpiredEffects` 判断逻辑需重测。
- 兼容层（D2）：`addEffect` 收到的对象若带顶层 `changes`/数字 `mode`/旧 `duration` 结构，先归一化为 V14 格式再进入流程。世界内与 data/ 中约 2000 处 `game.xjzl.api.effects.*` 调用因此无需迁移。
- 脚本直查状态（D3）：data/ 约 478 处 `CONFIG.statusEffects.find(e => e.id === x)` 替换为辅助函数；这是纯文本批量替换，一次完成。

### 2.4 init 阶段必要配置

```js
// 示意，具体注册方式待 M0 验证（Q3）
CONFIG.ActiveEffect.phases = { /* initial / final ... */ };
// ActiveEffect 的 system 数据模型注册：CONFIG.ActiveEffect.dataModels 或
// 继承核心 ActiveEffect 数据模型随 documentClass 提供 —— 二选一，以 V14 实测为准
```

同时清理 [active-effect.mjs](../module/documents/active-effect.mjs) 中 `legacyTransferral` 相关注释（约 116 行）。

### 2.5 需重写的组件

- **`XJZLActiveEffectConfig`**（[active-effect-config.mjs](../module/sheets/active-effect-config.mjs)）：现依赖 `renderXJZLActiveEffectConfig` 钩子 + jQuery 注入 DOM + `app._tabs[0].active` 内部状态 + `app.setPosition` + V13 核心配置窗 Tab 结构（`details/duration/changes/effects`）。V14 核心 ActiveEffectConfig 为 AE V2 全新实现，上述全部失效。改为 ApplicationV2 规范做法：子类声明自己的 tab 与 `PARTS`/partial，事件用 `actions` 绑定，去除 jQuery 与钩子注入。
- **`XJZLActiveEffect` 类**：`calculateChangesForStacks` 的 `CONST.ACTIVE_EFFECT_MODES.ADD` 判断（约 291 行）改 `type === "add"`；`_preCreate` 的 `data.changes` 快照改 `data.system?.changes`；`_displayScrollingStatus` override 待验证签名。

### 2.6 可选的 V14 新能力采纳（不阻塞升级，逐项独立评估）

- `tokenOverrides`：目盲、伪装、光照类特效可声明式化，替代部分脚本。
- 变更值引用 actor 数据：数值类 buff（如"按等级加成"）可少写脚本。
- 特效独立入包：状态库可脱离 Item 直接进合集包，状态选取器可接入。
- `subtract` 类型：减益数值可直接表达。

### 2.7 设计红线

- 不要在 Actor 上 override `applyActiveEffects`：V14 是两阶段应用，override 会双重生效。自定义应用行为放在 `ActiveEffect#apply()` 或可 override 的变更判定接口上。
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

V14 **彻底移除 MeasuredTemplate 文档类型**，逐项归宿：

| 现功能 | 现实现 | V14 归宿 |
|---|---|---|
| AOE 圆圈创建（静态/跟随两种模式） | [aoe-creator.mjs](../module/applications/aoe-creator.mjs) `createEmbeddedDocuments("MeasuredTemplate")` | 创建圆形 Region；跟随模式用 `attachment.token` |
| 跟随同步（粘性模板随 Token 移动） | [xjzl-system.mjs](../xjzl-system.mjs) `updateToken` 钩子手写同步 | `attachment.token` 原生替代，**删除手写同步** |
| Token 删除时自动清理 | `deleteToken` 钩子 | 附着区域是否随 Token 删除待验证；若不需要则保留钩子 |
| 自定义标签显示 | 模板 flag `label` + `measured-template.mjs` 自绘文字 | Region 名称/显示测量选项 |
| 1-2-2-2 网格高亮（圆形按格覆盖算法） | `XJZLMeasuredTemplate._getGridHighlightPositions` | 与 `GridShapeData` 结合重做，或先降级为核心高亮（待设计） |
| `tokens` 接口（AoE 自动化预留，暂无调用方） | `XJZLMeasuredTemplate.tokens` | Region 事件/查询 API 重新设计 |
| 工具栏 AOE 按钮 | 注入 `controls.templates` 层 | templates 层已删除；按钮迁至 token 层或 region 层 |
| 跟随光环宏 | [data/macros/utility.json](../data/macros/utility.json) | 改写为 Region 版，或并入光环系统（§3.3） |
| `CONFIG.MeasuredTemplate.objectClass` 注册 + [measured-template.mjs](../module/measured-template.mjs) | 整文件 | 删除 |

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

## 4. 机械替换清单（行为等价，可批量进行）

| # | 改动 | 位置与数量 |
|---|------|-----------|
| A1 | `game.i18n.format(key, data)` → `game.i18n.localize(key, data)` | 全库 73 处（V14 将 format 并入 localize） |
| A2 | `foundry.applications.ux.TextEditor.implementation.enrichHTML(...)` → 顶层 `TextEditor.enrichHTML(...)` | 8 处 / 6 文件：compendium-browser、loot-workbench-sheet、equipment-sheet、neigong-sheet、general-item-sheet、art-book-sheet |
| A3 | `CONST.ACTIVE_EFFECT_MODES`（数字）→ `CONST.ACTIVE_EFFECT_CHANGE_TYPES`（字符串 `type`） | active-effect.mjs、personality.mjs、config.mjs 全部 `mode: 2/5` 定义 |
| A4 | ActiveEffect 数据 `icon:` → `img:` | personality.mjs（唯一一处） |
| A5 | `CONFIG.statusEffects` 数组 → 按 id 键对象；`.find(e => e.id === x)` → `CONFIG.statusEffects[x]`；`.map(...)` → `Object.values(...)` | 定义 [config.mjs](../module/config.mjs)；调用约 16 处：active-effect-manager（5）、chat-manager（4）、effect-selection-dialog（4）、xjzl-system.mjs（2）等 |
| A6 | `game.settings.get("core","rollMode")` → `"messageMode"`；`ChatMessage.applyRollMode` → `ChatMessage.applyMode`；模式串 `publicroll→public`、`gmroll→gm`、`blindroll→blind`、`selfroll→self` | utils.mjs、actor.mjs（约 3532 行）、item.mjs（约 2551 行） |
| A7 | `system.json` 兼容版本 13 → 14；发布时更新 download 链接 | [system.json](../system.json) |

---

## 5. 其他逻辑改动

| # | 改动 | 说明 |
|---|------|------|
| B1 | AE 全链路（见 §2） | 重点一 |
| B2 | `XJZLActiveEffectConfig` 重写（见 §2.5） | 脱离 jQuery 钩子注入，改 V2 规范 |
| B3 | MeasuredTemplate → Region（见 §3） | 重点二 |
| B4 | 渲染钩子迁 `*HTML` 变体：`renderItemDirectory`/`renderActorDirectory`/`renderCompendiumDirectory`/`renderTokenHUD`（[xjzl-system.mjs](../xjzl-system.mjs) 约 1015–1116 行）；`renderCombatTracker` 双绑只留 HTML 变体 | V14 无 AppV1 渲染流程；现有代码已兼容 HTMLElement，主体逻辑不动 |
| B5 | 移除 V1 Sheet 注销（`foundry.applications.sheets.ActorSheet/ItemSheet` 引用，xjzl-system.mjs 约 325/351 行） | V14 核心表已全 V2；我们为所有类型注册了 `makeDefault` 的 V2 表，注销行直接删除（实机确认） |
| B6 | 删除 `-=` 特殊键相关检测：actor.mjs `_changesResourceScriptSources` 中 `"-=ignoreArmorEffects"` 判断 | V14 已移除 `-=`/`==` 更新键（替代物 `foundry.data.operators`）；已确认 data/ 无实际写入方 |
| B7 | CSS 旧变量族替换：`--color-border-light-*`（8）、`--color-text-dark-primary`（4）、`--color-text-light-primary`、`--color-text-light-highlight`、`--color-shadow-highlight`、`--color-border-dark` | 共 17 处，分布在 item-equipment/trait/general.css 等；按 V14 变量表映射，聊天样式注意新 `--chat-*` 变量 |

---

## 6. 数据与合集包迁移

1. **data/ 源 JSON 全量转 V14 格式**：`changes` → `system.changes`（约 3045 处 `"mode": 数字` → `"type": 字符串`；`icon` → `img`；duration 结构对齐）。涉及 armor/consumables/neigong/wuxue/qizhen/origins/traits 等全部源文件。
2. **脚本字符串批量替换**（D3）：约 478 处 `CONFIG.statusEffects.find` → 新辅助函数；约 71 处脚本内联 `mode: 数字` 与 163 处 `duration` 构造由 D2 兼容层承接，可不迁移（保持脚本可读性 vs 全量迁移，随 Q2 一并定）。
3. **合集包重建**：data/ 与 seed-*.mjs 更新后 GM 端 `game.xjzl.seed.all()`。
4. **世界数据**：ActiveEffect 文档 schema 由核心自动迁移；系统私有 flags（baseChanges 等）按 Q1 决策处理。
5. **宏包**：utility.json 跟随光环宏改写（并入 §3.3）。
6. **文档同步**：`CLAUDE.md`（V13 引用与不变量描述）、`SCRIPT_ENGINE.md`（mode→type、changes 格式、状态访问新方式）、`SEEDING_GUIDELINES.md`（若录入格式变化）、`README.md`、`PROJECT_MAP.md`（若入口变化）。

---

## 7. 实机验证清单（V14 未标破坏，但我们踩在内部 API 上）

**画布原型劫持**：`SquareGrid.prototype.measurePath`（1-2-2-2 计费）；`rulerClass.prototype._getWaypointLabelContext`（标尺）；`Token.prototype._refreshTurnMarker`/`_animateTurnMarker`（[combat-turn-marker.mjs](../module/combat-turn-marker.mjs)）。

**画布 API**：`canvas.interface.createScrollingText`；`CONST.TEXT_ANCHOR_POINTS`；`actor.getActiveTokens`；`canvas.tokens.hover/controlled`。

**特效行为**：`isSuppressed` override；`_displayScrollingStatus` override；`{scrollingStatusText: false}` 选项；`new XJZLActiveEffect(data, {parent})` 临时实例化（叠层计算用）；`isTemporary`/`duration.remaining` 新语义；`transfer` 字段行为。

**杂项**：`CONFIG.specialStatusEffects.BLIND`（目盲屏蔽）；`CONFIG.time.roundTime`；`getSceneControlButtons` 注入结构（tools 对象/Map）与 `onChange` 按钮；`CONFIG.ui.pause` 替换（GamePause 类）；`hotbarDrop` 钩子（V14 调整了锁检查顺序）；`ClientDocument.fromDropData` 不再写 `_stats.compendiumSource`（影响拖拽查重）；附着 Region 是否随 Token 删除。

---

## 8. 建议实施顺序

| 里程碑 | 内容 | 出口标准 |
|--------|------|----------|
| M0 验证 spike | 在 V14 实机确认 Q3（AE 模型注册）、`CONFIG.ActiveEffect.phases`、Region 行为 API、§7 中劫持点存活情况 | 关键机制全部有结论，设计定稿 |
| M1 机械替换 | §4 全部 + B4/B5/B6/B7 | V14 下系统可加载，无废弃 API 警告 |
| M2 AE 链路 | §2 全部 + D2 兼容层 + Q1 迁移机制 | 叠层/抑制/飘字/时长规则全回归通过 |
| M3 Region/光环 | §3 全部（含 Q4 光环设计与脚本引擎触发器） | AOE 工具与光环可用，1-2-2-2 正常 |
| M4 数据迁移 | §6 全部（data/ 转换、脚本替换、packs 重建） | 空世界全流程可用 |
| M5 回归与文档 | §7 清单逐项回归 + 文档同步 | 完整战斗流程实测通过，文档更新完毕 |

M2 与 M3 可穿插进行；M0 是一切设计结论的前提，应最先做。
