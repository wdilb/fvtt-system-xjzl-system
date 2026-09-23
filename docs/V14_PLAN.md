# V14 升级执行计划

本文件是 V14 升级的进度事实源，记录工作项、依赖和验证结果；范围、设计、API 依据及验收标准见 [`V14_UPGRADE.md`](V14_UPGRADE.md)。复杂工作另建专项计划，并在对应工作项后附链接，本清单不展开实现细节。

**当前下一步：M1 已验收通过（S1.1–S1.16 全部完成，启动无报错、无弃用警告），进入 M2（AE 链路迁移，从 S2.2 开始，机制结论见 M0 记录）。**

## 使用方式与状态约定

1. 先读“当前下一步”和文末验收记录，再选取**依赖已满足、未完成且未明确暂缓**的工作项；编号用于引用，不代表强制执行顺序。实施前读总纲对应章节，并按文件与函数名核对当前代码，避免重复实施。
2. 若单项复杂，先建立专项计划，关联原 S 编号并写明范围、子步骤和验收；整体清单只同步状态、链接与关键结论。发现新任务追加编号，不重排已有编号；已完成项不因拆计划被重新打开，除非发现实际遗漏。
3. 实施后先做验证，再更新工作项、待验信息和阶段记录。可自动执行的必要验证必须完成：改动 `.mjs` 后逐文件 `node --check`，改动 `data/*.json` 后逐文件 `JSON.parse` 校验；重要的实机或交互验证无法由会话执行时，整理操作步骤与预期结果输出给用户手工验证，并如实记录待验范围与原因，不臆断通过。收尾时更新“当前下一步”；待定决策的结论写回总纲，接口变更同步公共文档，不能等到 M5 才补接口说明。
4. 提交信息用中文自然语言说明具体改动及目的，不只写任务编号或“完成某阶段”。每次收尾可给出提交信息建议；仅用户明确要求提交时才执行 `git commit`，不自动提交。

代码项 `[x]` 表示本项实现及可执行检查完成；未实机覆盖的内容须注明对应待验阶段。验证项（如 S0.*、S5.1–S5.4）只有实际验证通过并记录结果才能勾选。阶段是否验收通过以文末记录为准，不能由代码项勾选推定；历史已勾选的 A 类代码项统一待 M1/M5 实机验收。

可选项若经明确决策暂缓，保留 `[ ]` 并标注“暂缓：原因/决策位置”，不伪装成已实现，也不阻塞已确认范围内的验收。下次会话跳过暂缓项；必要工作因环境或前置项未满足而受阻时，记录阻塞原因，不能按可选项处理。

## M0 机制验证（优先取得影响实现的结论）

依据：总纲 §0、§2、§3、§7。记录每项的构建号、验证场景和结论；机制试验可在独立最小环境进行，后续仍须完成系统集成验收。

- [x] S0.1 确认是否需要自定义 AE system 数据模型（Q3 已解：官方接口 `CONFIG.ActiveEffect.dataModels`、基础模型 `foundry.data.ActiveEffectTypeDataModel`；待验证派生字段如何应用变更）→ **已验证（14.368 实测）**：`dataModels` 仅注册 `{base: ActiveEffectTypeDataModel}`，基础模型 schema 仅含 `changes` ArrayField；我方 `documentClass=XJZLActiveEffect` 在 V14 正常加载。结论：核心模型足够，无需自定义；派生字段应用行为归 S0.7
- [x] S0.2 验证内置 initial/final 阶段与本系统基础值、物品准备、派生值计算的先后关系，确保每条变更只在指定阶段应用；仅确有需要时注册并调用附加阶段 → **已验证（核心源码确认）**：`initial` 在 `prepareEmbeddedDocuments` 内应用（早于 `prepareDerivedData`），`final` 在 `prepareData` 末尾应用（晚于派生计算）；`applyActiveEffects(phase)` 必须显式传阶段字符串（V14 新契约，缺省仅发兼容警告），`_completedActiveEffectPhases` 防同阶段重复；变更默认 `phase="initial"`。我方不自行调用该钩子，保持现状即等价 V13 时序，无需附加阶段
- [x] S0.3 按官方契约保留状态条目的 `id`，验证对象键与条目 `id` 一致，以及 TokenHUD、状态选取器和状态创建流程 → **已验证（14.368 实测）**：①数据层：V14 将 `CONFIG.statusEffects` 包装为原生混合结构（Proxy：可数组迭代 63 项无双重计数、`CONFIG.statusEffects[slug]` 直查命中、键=id 一致）；我方 `Object.fromEntries` 转换（xjzl-system.mjs:282）不报错但已无意义（V14 原生提供同等能力），列入 S5.7 冗余代码清理；②TokenHUD：HUD 正常打开（`canvas.hud.token.bind`），63 个状态图标全部渲染且 `data-status-id` 与状态表一致；左键点击创建带完整 slug 语义的特效（name/img/slug/stacks 来自 CONFIG），不可叠层状态二次点击保持 1 层，系统 `renderTokenHUD` 改造在 V14 的 HUD 三栏结构下工作正常；③状态选取器：**`getSceneControlButtons` 钩子在 V14 正常触发**，damage-tool/effect-picker/combat-meter 三个按钮均注入成功（V14 控制栏 DOM 从 `#controls` 改为 `#scene-controls` ApplicationV2，按钮带 `data-tool`，注入数据结构兼容）；选取器窗口完整渲染（分类/计数/最近/常用/场上特效分组），状态网格点击经 slug→addEffect 链路成功施加到受控 token，“身上状态”面板与网格 active 态同步正确。备注：测试时用户自研 TokenHUD mod 处于开启状态，mod 兼容性回归按用户要求推迟到系统升级完成后（S5.x）；可叠层状态的 HUD 加层细化归 S2.8 联调。测试数据已全部清理
- [x] S0.4 验证 Region 行为 API 与核心 Apply Active Effect 行为能力（光环设计 Q4 前置）→ **已验证（14.368 实测，含完整进出周期）**：①区域形状字段为 `shapes` 数组，元素为 `{type: "circle", radius, x, y}`（判别字段是 `type` 不是 `kind`，错误键会被静默丢弃）；②行为条目 `{name, type: "applyActiveEffect", system: {effects: [uuid]}}`；③核心行为语义：tokenEnter 时 `fromUuid` 解析特效并复制到 `token.actor`（`origin=behavior.uuid`），tokenExit 按 origin 清理，实测“出→0 个、进→恰好 1 个”；④**事件仅由官方移动驱动派发**（`tokenDocument.move()`/`scene.moveTokens`），裸 update x/y 传送不触发 enter/exit（但 `region.tokens` 包含性跟踪仍更新）；⑤派发按 `event.user.isSelf` 门控，仅移动发起者的客户端执行施加/清理；⑥**非链接 token 的 `token.actor` 是合成 Actor**，特效落在合成实例而非 world Actor——M3 光环的自研 addEffect/removeEffect 与权限代理必须处理该分支；⑦`region.testPoint` 需带 elevation 属性；`RegionDocument.createTokenEmanation` 为静态方法；`attachment.token` 字段存在（跟随光环基础）；`attachment`/`restriction`/`displayMeasurements` 等字段齐备。测试数据已全部清理
- [x] S0.5 验证画布劫持点存活：`SquareGrid.measurePath`、`rulerClass._getWaypointLabelContext`、`Token._refreshTurnMarker`/`_animateTurnMarker` → **已验证（14.368 实测）**：measurePath 劫持存活且计费正确（直行1+首斜1=2；三连斜=1+2+2=5）；`CONFIG.Canvas.rulerClass=Ruler`，`_getWaypointLabelContext` 存活；`Token._refreshTurnMarker` 存活；**`_animateTurnMarker` 已被 V14 移除**——我方 combat-turn-marker.mjs 有 if 守卫不会崩，仅“顶底图交错旋转”装饰失效，重适配或放弃由 S3.8 决定
- [x] S0.6 确认 duration 新 schema 字段与 expiry 事件清单 → **已验证（实例清洗实测）**：新文档级 schema 为 `{units, value, expiry, expired}` + 派生 `{seconds, remaining, secondsRemaining, label, _worldTime}`；V13 的 `rounds/turns` 在清洗时按 `CONFIG.time.roundTime` 折算为 seconds（3轮×2s=6s 实测），`startRound/startTurn/startTime` 不复存在（改由 worldTime 锚定）；`expiry` 缺省 `"turnStart"`；`CONFIG.ActiveEffect.expiryEvents` 启动时为空表（可注册）；`ActiveEffect.registry` 存在（启动时为空）。战斗中逐轮递减与 registry 清理分工归 M2/S2.4 实测（Q5 依据）
- [x] S0.7 验证数值字段、非 schema 派生字段与 flags 的 `add`/`multiply`/`override` 类型处理（见 M2 备注）→ **已验证（14.368 实测，临时 Actor 全类型变更）**：①`add`/`multiply`/`subtract`/`override` 全部生效，`subtract` 无下限钳制、`multiply` 按当前值计算；②**变更到派生字段（`stats.*.total`、`resources.*.max`）会被 `prepareDerivedData` 重算覆盖**（initial 阶段先于派生计算，语义与 V13 一致，变更 key 必须指向原始字段——与现有设计一致）；③`@` 引用按应用时点的 rollData 解析（initial 阶段取派生前基础值）；④`value:"true"` 在 DB 写入、模型清洗、flags 应用全链路保持字符串，布尔 override 语义安全；⑤`flags.xjzl-xxx.key` 路径 override 正常写入；⑥标准数据准备中 initial 与 final 两阶段均完成；清洗层结论：字符串 `type` 生效、`priority` 按类型默认（add=20/override=50/custom=0）、`phase` 默认 `"initial"`；静态 `ActiveEffect.applyChange/applyChangeField` 与原型 `shouldApplyChange/getReplacementData` 均存在。**结论：现有变更模型无需 `applyChange` 定制即可迁移**

## M1 机械替换与启动解阻

依据：总纲 §4、§5、§3.2。优先 S1.14 与启动路径审计，再做依赖系统运行的钩子、表单及样式验证；已勾选的首批替换以现代码为基础继续推进。

- [x] S1.1 A1：`game.i18n.format(key, data)` → `game.i18n.localize(key, data)`（`b2f3833` 实际替换 73 处）
- [x] S1.2 A2：`TextEditor.implementation.enrichHTML` → 顶层 `TextEditor.enrichHTML`（10 处 / 8 文件；可选改动，编辑器替换模块兼容性待 S5.3 验证）
- [x] S1.3 A3：数字 `mode` → 字符串 `type` 字面量，如 `"add"`/`"override"`（active-effect.mjs、personality.mjs、config.mjs；`CONST.ACTIVE_EFFECT_CHANGE_TYPES` 的值是优先级数字，不能用作类型；其余构造点由 S2.6/S4.1 承接）
- [x] S1.4 A4：特效数据 `icon` → `img`（personality.mjs）
- [x] S1.5 A5：`CONFIG.statusEffects` 数组 → 按 id 键对象（定义在 CONFIG 赋值处转换，调用侧约 16 处改对象访问）
- [x] S1.6 A6：`rollMode` 设置 → `messageMode`；`ChatMessage.applyRollMode` → `ChatMessage.applyMode`（3 处设置读取 + 1 处固定 public，共 4 个调用点）
- [x] S1.7 A7：`system.json` 兼容版本 13 → 14（声明已改；`verified` 的发布依据仍需 M5 完整回归）
- [x] S1.8 B4：逐钩子实测 V14 渲染钩子派发形态 → **已验证（14.368 实测，探针捕获参数）**：目录三钩子 `renderActorDirectory/renderItemDirectory/renderCompendiumDirectory` 正常派发，参数 `(App实例, HTMLElement, context, options)`，现有 HTMLElement 兼容写法有效，万卷阁按钮注入位置正确（`header.directory-header`）；`renderChatMessageHTML` 以 `(ChatMessage, HTMLElement, context)` 正常派发；`renderTokenHUD` 已由 S0.3 验证（图标渲染+点击链路正常）；**`renderCombatTrackerHTML` 在 V14 不派发，已删除冗余双绑**，仅留 `renderCombatTracker`；战局控制条空置源于无进行中战斗（函数 `!combat` 早退），锚点 `header.combat-tracker-header` 在 V14 存在；`renderXJZLActiveEffectConfig`（自有 AppV1 钩子）归 S2.5 重写处理。**注意：目录在启动时渲染一次，切标签不触发重渲染钩子**，验证需 force render
- [x] S1.9 B5：核查 V14 核心默认表注册形态与继承链后，再处理 V1 Sheet 注销逻辑 → **已验证（14.368 实测 + 审阅复核后修正）**：V14 移除了 `CONFIG.Actors.sheetClasses`，注册表改挂文档类（`CONFIG.Actor.sheetClasses`）；`Actors/Items.registerSheet/unregisterSheet` 是兼容 shim，自动转发 `DocumentSheetConfig.registerSheet(文档类, ...)`——我方全部注册生效（character/npc→XJZLCharacterSheet、creature→XJZLCreatureSheet、container→XJZLLootWorkbenchSheet），Actor/Item 的 core 注销调用（传类）有效；**AE 注销调用原第三参传字符串 id 而静默无效，已修正为传 `foundry.applications.sheets.ActiveEffectConfig`（apps 命名空间下无导出）**；世界已保存的默认表设置（`updateDefaultSheets`）对未注册 id 不生效，注销后解析回落到我们的 makeDefault，刷新实测 `core.ActiveEffectConfig` 已从注册表移除、系统表为唯一默认——V13 独占语义在 V14 保持
- [x] S1.10 B6：`-=`/`==` 更新键审计与迁移评估 → **审计完成（14.368 实测），代码保持现状**：全库（module/入口/data 脚本）确认**无 `-=`/`==` 写入方**，无需迁移 operators；`_changesResourceScriptSources` 的 `-=ignoreArmorEffects` 检测分支保留——实测 V14 仍在钩子前归一化掉 `-=` 键（updateActor 收到的 changes 无 `-=`），但 `update()` 覆写与内部快路径收到的是**调用方原始数据**，外部调用者仍可用 `-=` 删除 flag（V14 实测有效），检测分支在该路径承重；V14 operators API 为 `foundry.data.operators.{ForcedDeletion, ForcedReplacement, ...}`；**V16 移除 `-=` 时需复查本项**
- [x] S1.11 B7：CSS 旧变量族替换（实测 16 处，原记 17）→ **已完成**：旧变量在 V14 从 `:root` 缩小作用域到 `body.game .app` 兼容层（V13 表过渡保留）；映射（固定色底元素选**稳定色阶**而非主题感知变量，避免用户切主题后对比度反转）：`--color-border-light-2`→`--color-dark-6`（8）、`--color-text-dark-primary`→`--color-dark-1`（4）、`--color-text-light-highlight`→`--color-light-1`（1）、`--color-text-light-primary`→`--color-light-5`（1）、`--color-shadow-highlight`→`--color-warm-1`（1，V14 官方 highlight 即 warm-1）、`--color-border-dark`→`--color-dark-1`（1）；涉及 _encounter/_roll-config/item-trait/item-equipment/item-art-book/item-general 共 6 文件，残留检查为 0
- [x] S1.12 A8：`bringToTop()` → `bringToFront()`（character-sheet.mjs，V14 已移除）
- [x] S1.13 A9：ChatMessage 数据 `user:` → `author:`（模块 27 处 + data/ 脚本 88 处；世界内脚本副本由 S4.7 迁移）
- [x] S1.14 摘除 MeasuredTemplate 启动依赖（应用户要求以注释方式停用、保留代码供 M3 光环/Region 重建参考，未删除文件）；`node --check` 通过，AOE 按钮已消失 → **理由修正（审阅复核 + 14.368 实测）**：V14 保留 MeasuredTemplate 弃用兼容层（类、`CONFIG.MeasuredTemplate`、`scene.templates` 可用），旧代码在兼容层下仍可运行，**停用并非启动所必需，而是不基于弃用 API 继续开发**（兼容层未来移除，届时再摘即为启动阻断）；按计划提前下线 AOE、M3 迁移 Region 的决策不变。相关注释与文档表述已同步修正
  - 注释位置明细（M3 重建完成后，全局搜索 `【V14 升级 S1.14 停用，代码仅注释未删除】` 标记即可定位全部注释块并删除）：
    1. `xjzl-system.mjs` 顶部：`XJZLMeasuredTemplate`、`AOECreator` 两条 import
    2. `xjzl-system.mjs` init 内：`CONFIG.MeasuredTemplate.objectClass` 注册
    3. `xjzl-system.mjs` getSceneControlButtons 钩子：“4·注入 AOE Creator 按钮”整段（V14 已移除 templates 控制层）
    4. `xjzl-system.mjs` updateToken 钩子：粘性模板同步算法（保留名称/阵营→战局刷新；注释内含中心点计算、1px 去抖、无权限走 socket 委托的完整原逻辑）
    5. `xjzl-system.mjs` deleteToken 钩子：整体（该钩子仅负责 autoDelete 模板清理）
    6. `module/measured-template.mjs`：代码本身未注释（不再被 import 即不求值，可安全保留），文件头标注 M3 参考要点——1-2-2-2 圆形网格高亮算法、`tokens` 范围查询接口、标签绘制与点击穿透
    7. `module/applications/aoe-creator.mjs`：类整体保留可正常加载，仅 `_onCreate` 创建逻辑注释并加守卫返回；文件头标注 M3 参考要点——跟随/静态取点、GM 代创时所有权移交、`flags.sticky/sourceToken/label` 约定
- [x] S1.15 对照[官方 #13436](https://github.com/foundryvtt/foundryvtt/issues/13436)审计入口、module 与模板代码 → **审计完成，1 处命中已修复**：`item.mjs` 秘籍查重读/写 `flags.core.sourceId`（V14 已移除）→ 改为官方字段 `_stats.compendiumSource`（旧世界数据由 name+type 兜底比对，无需迁移）。其余类别全部干净：Handlebars `colorPicker`/`select` helper、`CONST.CHAT_MESSAGE_TYPES`、`Math.clamped/roundDecimals`、`_on*Documents` 旧集合钩子、Token 旧 API（getCenter/updateSource/toggle*）、Scene 雾与全局光旧字段、GridLayer 旧属性（`canvas.grid.size` 仅存于 S1.14 注释块）、裸全局引用（SquareGrid 等均走 foundry.* 命名空间）、`advanceTime`/`temporary` 选项、`PerceptionManager#refresh` 等；`updateSource` 两处命中为 `_preCreate` 中改 `_source` 的官方现行 API，非被移除的 Token#updateSource。data/ 脚本字符串的对照审计归 S4.8（M4）
- [x] S1.16 V14 启动路径修复：`XJZLActor.getRollData` 对缺失资源兜底。V14 的 `applyActiveEffects` 与 `TokenDocument._getReplacementData` 在 prepareEmbeddedDocuments 阶段即调用 getRollData 解析变更中的 @ 引用，早于 creature 在 prepareDerivedData 补建鸭子类型 `hp/mp`，直接读取使该 Actor 数据准备中断（构建 14.368 实机报错）→ **审阅复核后精化**：`hp` 缺失时映射 creature 真实体力 `tili.value`（避免初始阶段 `@hp` 取 0），`mp`/`rage` 按 mock 语义兜底 0；`@resources.hp.value` 当前无脚本使用，不做二级支持；character 的 schema 自带 hp/mp/rage 不受影响；`node --check` 通过，用户刷新复验启动路径无报错

## M2 ActiveEffect 链路（依赖 S0.1/S0.2/S0.6/S0.7）

依据：总纲 §2；运行联调依赖 M1 启动可用。S2.7 落实 Q1，S2.4 落实 Q5；S2.9 的查询 API 必须先于 S4.2/S4.7 的脚本迁移。

- [ ] S2.1 落实 S0.1 的模型选择：核心模型足够则沿用；需要扩展时在 init 注册 `CONFIG.ActiveEffect.dataModels`，继承 `foundry.data.ActiveEffectTypeDataModel` 并保留 type/phase/priority；附加阶段按需注册并显式调用
- [ ] S2.2 `XJZLActiveEffect` 剩余读写迁移：`system.changes`、字符串 `type`、`img`、`origin` UUID 校验；沿用 S1.3 已修正的类型判断，同步清理 `isSuppressed` 中 `legacyTransferral` 过时注释
- [ ] S2.3 `addEffect`/`removeEffect` 入参归一化兼容层（D2，含 `icon→img` 映射；只处理已到达入口的数据，不能修复调用前的旧文档访问，见 S4.6）
- [ ] S2.4 时长引擎适配新 duration schema（叠加/刷新/锚点/转化规则保留）；落实 Q5 的自研过期清理与核心 registry 分工并验证不重复处理
- [ ] S2.5 `XJZLActiveEffectConfig` 重写（V2 规范 tab/partial，去除 jQuery 注入）
- [ ] S2.6 effects 构造与读取点迁移（personality / item / actor / sheets / config / seeding 代码侧）；`XJZL.statusEffects` 源容器保持数组，仅迁移条目字段；seeding 与 Q2 的转换方式保持一致
- [ ] S2.7 世界数据迁移机制（Q1：baseChanges flags 等，覆盖 S4.7；独立世界设置记录迁移版本，支持重复执行与失败重试，仅全部成功后推进版本）
- [ ] S2.8 状态选取器与新 CONFIG 形态联调回归（依据 S0.3 结论，S1.5 的对象访问替换已完成）
- [ ] S2.9 在 `ActiveEffectManager` 实现并暴露 `game.xjzl.api.effects.getStatus(id)`（D3、总纲 §2.3）：同步按 id 查询、未命中返回 `undefined`、返回副本可修改而不污染 CONFIG；验证契约并同步 `SCRIPT_ENGINE.md`，供 S4.2/S4.7 使用

> 备注（S0.7）：社区的字符串拼接案例仅作为测试线索，不能直接认定稳定版存在同样问题。验证数字/数字字符串、布尔 override、`@` 引用及派生字段；确需定制时使用静态 `ActiveEffect.applyChange()`/`applyChangeField()`，`shouldApplyChange()` 只负责是否应用的判定，详见总纲 §2.7。

## M3 Region / 光环（依赖 S0.4）

依据：总纲 §3；运行联调依赖 M1。先完成 S3.6 中的 Q4 范围与架构决策，再安排区域和光环实现；S3.8 另依赖 S0.5。

- [ ] S3.1 确认 S1.14 的旧模板依赖已摘除，明确 Region 数据、附着关系与旧功能的对应方案
- [ ] S3.2 AOE Creator 改 Region 实现（静态圆形 + `attachment.token` 跟随）
- [ ] S3.3 验证 Region 原生跟随；若 Token 删除不会自动清理附着区域，则补充 Region 清理逻辑
- [ ] S3.4 工具栏按钮迁移（templates 层已移除）
- [ ] S3.5 1-2-2-2 网格高亮方案（`GridShapeData` 或降级）
- [ ] S3.6 Q4 产品范围与光环架构定稿；选择完整光环后再实现自定义 RegionBehavior，若仅恢复旧 AOE 则记录暂缓项
- [ ] S3.7 若 Q4 选择完整光环，接入脚本引擎触发器（`SCRIPT_TRIGGERS`/本地化/文档联动）；否则随 S3.6 记录暂缓
- [ ] S3.8 标尺与移动劫持重适配（依赖 S0.5）

## M4 数据迁移（依赖 M2；光环宏另依赖 M3）

依据：总纲 §6。先完成 S4.1/S4.2/S4.3/S4.5/S4.6 与 S4.8 审计，再做 S4.4 合集重建和 S4.7 世界迁移验收；世界迁移实现可与源脚本迁移同步推进，但须复用同一套转换规则。

- [ ] S4.1 落实 Q2 后，将 data/ 源 JSON 中的 AE 数据转 V14 格式（`system.changes`、`type`、`img`、duration；按 AE 结构遍历，避免误改其他 mode 字段）
- [ ] S4.2 S2.9 完成后，将脚本内按 id 查询的 `CONFIG.statusEffects.find` 替换为 `getStatus`（检索基线为 script/command 字段中 500 个调用，D3；其他谓词保留语义，不能仅按文本全局替换）
- [ ] S4.3 `data/macros/utility.json` 光环宏改写（或并入 S3.6）
- [ ] S4.4 所有 data/ 与 seeding 修改及 S4.8 审计完成后，重建合集包（`game.xjzl.seed.all()`），验证包内数据及导入行为
- [ ] S4.5 `measureDistance` → `measurePath` 脚本迁移（2 处，验证取点坐标与距离单位）
- [ ] S4.6 文档访问类脚本迁移：以约 98 处 `eff/effect/thisEffect/ae.changes` 为检索起点并检查其他别名；普通数据经门面传入的可由 S2.3 承接，文档/导出对象访问及绕过门面的核心 API 调用必须迁移
- [ ] S4.7 基于 S2.7 框架及 S2.9 查询 API 迁移世界副本：世界物品、角色内嵌物品、非关联 Token 的 Actor、AE 脚本、已导入宏中的旧格式数据与脚本（含状态查询、文档 changes 访问、聊天 author、距离 API、光环宏）；在备份的 V13 世界副本验证首次迁移、重复启动和中断重试，无法自动处理的自定义脚本须报告定位并解决后再验收
- [ ] S4.8 对照[官方 #13436](https://github.com/foundryvtt/foundryvtt/issues/13436)审计 data/ 脚本字符串中的已移除 API

## M5 回归与文档

依据：总纲 §7、§8；完整回归依赖 M1–M4 在已确认范围内完成。各项公共接口文档应随实现同步，S5.5 负责最终一致性核查。

- [ ] S5.1 §7 画布 API 验证清单回归
- [ ] S5.2 §7 特效行为验证清单回归
- [ ] S5.3 §7 杂项验证清单回归（含聊天作者与 public/gm/blind/self 可见性、审计日志重复打开、TextEditor 配置实现兼容性）
- [ ] S5.4 完整战斗流程实测（出招/对抗/伤害/状态/战局）
- [ ] S5.5 文档同步（CLAUDE.md / SCRIPT_ENGINE.md / SEEDING_GUIDELINES.md / README / PROJECT_MAP.md）
- [ ] S5.6 发布前核验：各阶段必需项与验收记录齐全、未解决问题已关闭或明确排除在本次范围外，确认 `system.json` 的兼容声明与 download 链接；本项不包含自动提交或发布
- [ ] S5.7 升级遗留冗余代码清理（不报错但已失去意义的代码，收尾时以最简正确形态过一遍）：
  1. `xjzl-system.mjs` init 的 `CONFIG.statusEffects = Object.fromEntries(...)` 转换：S0.3 实测 V14 原生包装已提供数组迭代与 slug 直查，改为直接赋值 `CONFIG.XJZL.statusEffects` 数组，删除转换层；
  2. `getSceneControlButtons` 中为旧构建保留的 Array/Object 多形态兼容分支：V14 实测按钮注入成功，先确认 `tools` 实际类型后精简为单一路径；
  3. 复审升级期间新增的防御性代码：S1.16 的 getRollData `?.` 兜底经确认为 V14 数据准备时序的必要修复（creature 鸭子类型晚于 AE 应用），须保留；其余临时防御代码确认无必要时删除；
  4. 通读 M2–M4 改动，删除数据迁移完成后失去意义的旧格式检测与转换分支；D2 入参归一化层是否长期保留属产品决策，在总纲 §2.7 红线内单独评估，不计入冗余。

## 阶段验收记录

验收标准以总纲 §8 为准。状态使用“待验 / 通过 / 未通过”；记录“Foundry 构建号、场景或用例、结果、剩余项”，可链接专项计划的证据，避免重复抄写。每次勾选验证项时就追加对应 S 编号的简要结论，不必等整个阶段结束；没有实际结果不得标为通过。

| 阶段 | 验收状态 | 验证记录 / 专项计划 |
|---|---|---|
| M0 | **通过** | 2026-09-23 构建 14.368 实机验证（浏览器自动化，GM 身份）：S0.1–S0.7 全部通过并记录结论。关键结论：无需自定义 AE 数据模型；initial/final 阶段契约确认（initial 先于派生计算，变更必须指向原始字段）；1-2-2-2 劫持存活且计费正确（`_animateTurnMarker` 已被 V14 移除，装饰损失）；duration 全新 `{units,value,expiry,expired}` 结构；Region 行为完整进出周期通过（事件仅由官方移动驱动派发；非链接 token 落合成 Actor）；AE 变更全类型应用与“true”字符串语义安全；TokenHUD/选取器/工具栏注入全链路正常。写入型验证用临时数据已全部清理。影响实现的待定问题：无阻塞项（Q4/Q5 依据已收集，分别在 S3.6/S2.4 定稿） |
| M1 | **通过** | 2026-09-23 构建 14.368 实机验证：启动路径无报错（S1.16 修复 creature 数据准备，用户复验）；**用户确认刷新后控制台无本阶段涉及的弃用警告**；S1.1–S1.16 全部完成并记录结论（含审阅复核修正：S1.14 停用理由改为“弃用兼容层提前下线”、S1.9 AE 注销修正为传类并实测生效、S1.16 hp 兜底映射 tili）。AE/脚本等功能行为分别留待 M2/M3/M5 验收 |
| M2 | 待验 | — |
| M3 | 待验 | — |
| M4 | 待验 | — |
| M5 | 待验 | — |
