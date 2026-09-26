# V14 升级执行计划

本文件是 V14 升级的总进度事实源，记录里程碑、跨阶段依赖和验证结果；范围与既定接口约束见 [`V14_UPGRADE.md`](V14_UPGRADE.md)。**AE 相关实施步骤、工作项状态和验收以 [`V14_AE_PLAN.md`](V14_AE_PLAN.md) 为唯一执行依据**；本文件仅同步其里程碑与跨阶段依赖，不再作为 AE 施工清单。

**当前进度**：M0～M2 已通过；M4 的源数据与合集包已通过，AE-14 首跑演练完成，正式迁移待执行。M3 专项计划已定稿（[`V14_AURA_PLAN.md`](V14_AURA_PLAN.md) 第 7 节，Q4/S3.6 已关闭），AURA-01 机制 spike 与 AURA-02 形状生成器已完成（2026-09-26，14.368 实测，结论见专项计划第 7.2 节对应条目与决策 39），AURA-03～05 框架主线可开工；M5 尚未完成。

**下一步**：正式迁移前备份世界，在 V13 运行 [`v13-ae-preprocess.js`](migration/v13-ae-preprocess.js) 并确认报告中的 `unverified`、`errors` 均为 0，再按 AE-14 清单验收旧特效与持久化；M3 按 [`V14_AURA_PLAN.md`](V14_AURA_PLAN.md) 第 7 节推进（AURA-01/02 已完成，主线 AURA-03→04→05，框架出口为 AURA-01～06+08）；完成 M5 回归及文档核对。S5.5 的 AE 文档已随 AE-10 更新。本轮回归结果及待处理项见文末记录。

## 使用方式与状态约定

1. 先读“当前进度”“下一步”和文末验收记录，再选取**依赖已满足、未完成且未明确暂缓**的工作项；编号用于引用，不代表强制执行顺序。实施前读总纲对应章节，并按文件与函数名核对当前代码，避免重复实施。
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
- [x] S0.4 验证 Region 行为 API 与核心 Apply Active Effect 行为能力（光环设计 Q4 前置）→ **已验证（14.368 实测，含完整进出周期）**：①区域形状字段为 `shapes` 数组，元素为 `{type: "circle", radius, x, y}`（判别字段是 `type` 不是 `kind`，错误键会被静默丢弃）；②行为条目 `{name, type: "applyActiveEffect", system: {effects: [uuid]}}`；③核心行为语义：tokenEnter 时 `fromUuid` 解析特效并复制到 `token.actor`（`origin=behavior.uuid`），tokenExit 按 origin 清理，实测“出→0 个、进→恰好 1 个”；④**区域进出事件的派发口径（2026-09-26 AURA-01 复测修正，取代 M0 初测"仅官方移动派发"的误判，见专项计划决策 39）**：官方移动（`tokenDocument.move()`/`scene.moveTokens`）与 **`document.update` 裸传送 x/y** 均派发 enter/exit/moveWithin（复测含 `animate:false`/`noHook:true` 变体，movement 数据携带）；**`updateSource` 为纯内存数据模型更新——不产生数据库更新操作、不触发 updateToken 钩子与区域事件、`region.tokens` 包含性跟踪也不更新（AURA-01 复测），其漂移仅是单端内存态与数据库的暂时背离，不改变服务端权威状态，由后续真实同步自然收敛**；⑤派发按 `event.user.isSelf` 门控，仅移动发起者的客户端执行施加/清理；⑥**非链接 token 的 `token.actor` 是合成 Actor**，特效落在合成实例而非 world Actor——M3 光环的自研 addEffect/removeEffect 与权限代理必须处理该分支；⑦`region.testPoint` 需带 elevation 属性；`RegionDocument.createTokenEmanation` 为静态方法；`attachment.token` 字段存在（跟随光环基础）；`attachment`/`restriction`/`displayMeasurements` 等字段齐备。测试数据已全部清理
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
- [x] S1.9 B5：核查 V14 核心默认表注册形态与继承链后，再处理 V1 Sheet 注销逻辑 → **已验证（14.368 实测 + 三轮审阅复核）**：V14 移除了 `CONFIG.Actors.sheetClasses`，注册表改挂文档类（`CONFIG.Actor.sheetClasses`）；`Actors/Items.registerSheet/unregisterSheet` 是兼容 shim，自动转发 `DocumentSheetConfig.registerSheet(文档类, ...)`——我方全部注册生效，Actor/Item 的 core 注销调用（传类）有效；**AE 注销调用原第三参传字符串 id 而静默无效，已修正为传 `foundry.applications.sheets.ActiveEffectConfig`（apps 命名空间下无导出）**；**第二轮复核：`#registerSheet` 只要设置里存有任何已保存项（即使指向已注销表）就忽略 makeDefault（`isDefault = existingDefault === id`），旧世界保存过 core.ActiveEffectConfig 时系统表会注册成 default:false，解析回退“第一个可配置表”可能被其他模块抢走——ready 钩子新增陈旧项清理逻辑**；**第三轮复核细化：内存 default 修正先行、持久化写入独立 try/catch 仅记录错误（写入失败不中断 ready 初始化，下次会话自动重试），且逐子类型只修正实际陈旧项、不触碰指向有效表单的 base 选择（多子类型场景实测：base 保持原值与默认标记，幽灵子类型被改写）**
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

**直接执行 [`V14_AE_PLAN.md`](V14_AE_PLAN.md)；该文件的工作项、依赖、决策门槛和验收矩阵是 M2 的唯一施工与验收依据。**本节只记录总里程碑，不把旧 S2 条目当作第二套指令。运行联调依赖 M1；M2 的 `getStatus(id)` 可用后才能执行 M4 的状态查询脚本迁移。

- [x] S2.1 模型选择已由 M0 验证：沿用核心 `ActiveEffectTypeDataModel` 和内置 initial/final 阶段，无需自定义注册。
- [x] S2.2–S2.11 **已按 AE 专项计划中对应 S 编号的工作项完成并验收**（AE-01～09、AE-13、AE-12 的 M2 范围，实机记录见专项计划各条目）；世界迁移的真实旧世界端到端出口在 M4/AE-14，阶段 2 转换项随 AE-10 定稿后追加。

S2.11 在专项计划中只要求独立 AE 文档与合集包的原生互操作验收；内容专属 AE 继续放在各自物品中，不建立第二份 AE 目录，也不把合集包接入状态选取器作为本次升级必做项。

## M3 Region / 光环（依赖 S0.4）

**直接执行 [`V14_AURA_PLAN.md`](V14_AURA_PLAN.md)；该文件的实现框架（第 3 节）、决策记录（第 6 节）与专项开发计划（第 7 节，工作项 AURA-01～12）是 M3 的唯一施工与验收依据。**本节只记录总里程碑与 S 编号映射，不把旧 S3 条目当作第二套指令。S3.8（标尺与移动劫持重适配）不属光环专项，仍按本计划跟踪（依赖 S0.5）。

- [x] S3.6 Q4 已定稿并产出专项计划（2026-09-26，与数据作者讨论）：升级为完整光环系统——自定义 Region 行为类型 `xjzlAura` + 光环管理器，94 处 `x-xjzl-aura` 标记全量盘点归类（91 条有自动化路径、2 条保持手动、1 条待澄清），核心 `applyActiveEffect` 方案因绕过自研门面否决；决策与盘点见专项计划第 4/6 节
- [ ] S3.1–S3.5、S3.7 按专项计划 AURA 工作项执行并随其验收：S3.1→AURA-12；S3.2/S3.4→AURA-06；S3.3→AURA-01（**已完成**：核心 `TokenDocument._onDeleteOperation` 源码核实 + 14.368 运行时复验，源删除自动删区并补发 exit）；S3.5→AURA-02/03（**AURA-02 已完成**：形状生成器 `module/utils/aura-shapes.mjs` + Node 断言；S3.3 悬案随 AURA-01 关闭）；S3.7→按 2026-09-26 决策不新增脚本触发器（监听 AE 复用既有触发器），随 AURA 工作项关闭
- [ ] S3.8 标尺与移动劫持重适配（依赖 S0.5）

## M4 数据迁移（依赖 M2；光环宏另依赖 M3）

依据：总纲 §6。先完成 S4.1/S4.2/S4.3/S4.5/S4.6 与 S4.8 审计，再做 S4.4 合集重建和 S4.7 世界迁移验收；世界迁移实现可与源脚本迁移同步推进，但须复用同一套转换规则。

- [x] S4.1 落实 Q2 后，按 [`V14_AE_PLAN.md`](V14_AE_PLAN.md) 的 AE-10 执行并验收 data/ 源 JSON 的 AE 迁移
- [x] S4.2 S2.9 完成后，按 AE-10 执行并验收 data/ 脚本中的状态查询迁移（516 处 `CONFIG.statusEffects.find` → `getStatus`，字面量与变量形态全覆盖，见 AE-10 记录）
- [ ] S4.3 `data/macros/utility.json` 光环宏改写——并入 AURA-06（改写为指向快建工具的说明宏，不删除），随 M3 实施，不阻塞 M4 的 AE 出口
- [x] S4.4 所有 data/ 与 seeding 修改及 S4.8 审计完成后，重建合集包（`game.xjzl.seed.all()`）；AE 相关验收按 AE-11，其他数据按本计划验收 → **2026-09-25 实机重建并验收通过**（11 类合集包、2387 个内嵌 AE 全部 V14 结构、1438 个施加型模板 showIcon:2 透传、端到端常显画布确认，详见专项计划 AE-11）
- [x] S4.5 `measureDistance` → `measurePath` 脚本迁移（2 处）：`armor/top.json` 默认语义迁 `.euclidean`、`wuxue/xiaoyaopai.json` 的 `gridSpaces:true` 迁 `.cost`（官方弃用注释确认映射），取点改 `token.center`（V14 waypoints 需 {x,y}，Token.x/y 是左上角）；V14 `BaseGrid#measurePath` 的 euclidean 为场景距离、cost 为对角线规则折算网格步数，与 V13 两个语义逐一对等，14.368 实测三组路径验证
- [x] S4.6 文档访问类脚本迁移：AE 字段与入口按 AE-10 执行并验收；其他已移除 API 审计并入 S4.8
- [ ] S4.7 基于 S2.7 框架及 S2.9 查询 API 迁移 V13 世界副本：AE 数据、脚本及迁移安全性按 AE-14 执行并验收；聊天 author、距离 API、光环宏等非 AE 内容按本计划验收 → **移交用户手动验收（2026-09-25 用户确认）**：迁移的转换与版本机制已在受控注入环境实测（定位限定见 AE-12），真实 V13 世界的端到端验收需挂载/重启 Foundry 实例，由用户在正式世界升级时（或用 v13data 副本演练）按专项计划 AE-14 附带的 9 步手动验收清单执行（含升级前 V13 侧预处理宏 docs/migration/v13-ae-preprocess.js 与重启后持久化核对）
- [x] S4.8 对照[官方 #13436](https://github.com/foundryvtt/foundryvtt/issues/13436)审计 data/ 脚本字符串中的已移除 API → **审计完成（2026-09-25，全量 JSON 字符串值扫描）**：聊天 `user:` 0 残留（S1.13 批次已全部迁移 `author:`，31 文件）；`measureDistance` 2 处迁移（见 S4.5）；AE 相关旧字段读取 2 处修复（`blindData.label`→`name`、`${thisEffect.icon}`→`img`）。其余命中均为 V14 存活 API：`game.user.targets`（client User#targets=UserTargets 集合，24 处）、`canvas.tokens.placeables`（9 处）、`canvas.grid.size`（BaseGrid.size 现行属性，2 处）、选项对象 `.label`/表单 `.mode`/系统 flag `CONFIG.label`（UI 语义非 AE）。Math.clamped/CHAT_MESSAGE_TYPES/_on*Documents/getCenter/core.sourceId/data. 前缀等 S1.15 清单类别全部 0 命中

## M5 回归与文档

依据：总纲 §7、§8；完整回归依赖 M1–M4 在已确认范围内完成。各项公共接口文档应随实现同步，S5.5 负责最终一致性核查。

- [ ] S5.1 §7 画布 API 验证清单回归
- [ ] S5.2 §7 特效行为验证清单回归
- [ ] S5.3 §7 杂项验证清单回归（聊天作者及 public/gm/blind/self 可见性、TextEditor 配置实现兼容性）；修复审计日志重复打开和容器需求结果未刷新窗口：AppV2 从 `foundry.applications.instances` 查找，审计日志单例还需处理首次渲染及关闭中的实例
- [ ] S5.4 完整战斗流程实测（出招/对抗/伤害/状态/战局）
- [ ] S5.5 文档同步（CLAUDE.md / SCRIPT_ENGINE.md / SEEDING_GUIDELINES.md / README / PROJECT_MAP.md）
- [ ] S5.6 发布前核验：各阶段必需项与验收记录齐全、未解决问题已关闭或明确排除在本次范围外，确认 `system.json` 的兼容声明与 download 链接；本项不包含自动提交或发布
- [ ] S5.7 升级遗留冗余代码清理（不报错但已失去意义的代码，收尾时以最简正确形态过一遍）：
  1. `xjzl-system.mjs` init 的 `CONFIG.statusEffects = Object.fromEntries(...)` 转换：S0.3 实测 V14 原生包装已提供数组迭代与 slug 直查，改为直接赋值 `CONFIG.XJZL.statusEffects` 数组，删除转换层；
  2. `getSceneControlButtons` 中为旧构建保留的 Array/Object 多形态兼容分支：V14 实测按钮注入成功，先确认 `tools` 实际类型后精简为单一路径；
  3. 复审升级期间新增的防御性代码：S1.16 的 getRollData `?.` 兜底经确认为 V14 数据准备时序的必要修复（creature 鸭子类型晚于 AE 应用），须保留；其余临时防御代码确认无必要时删除；
  4. 通读 M2–M4 改动，删除数据迁移完成后失去意义的旧格式检测与转换分支；D2 入参归一化层长期保留属已定产品决策（2026-09-25：作为世界宏/玩家脚本等外部调用的兜底，系统自带 data/ 一律新写法，见专项计划 AE-10），不计入冗余；
  5. 复核仍使用 `.window-app` 前缀的窗口样式；按 V14 实际根元素类名保留或调整所需规则。

## 阶段验收记录

验收标准以总纲 §8 为准。状态使用“待验 / 通过 / 未通过”；记录“Foundry 构建号、场景或用例、结果、剩余项”，可链接专项计划的证据，避免重复抄写。每次勾选验证项时就追加对应 S 编号的简要结论，不必等整个阶段结束；没有实际结果不得标为通过。

| 阶段 | 验收状态 | 验证记录 / 专项计划 |
|---|---|---|
| M0 | **通过** | 2026-09-23 构建 14.368 实机验证（浏览器自动化，GM 身份）：S0.1–S0.7 全部通过并记录结论。关键结论：无需自定义 AE 数据模型；initial/final 阶段契约确认（initial 先于派生计算，变更必须指向原始字段）；1-2-2-2 劫持存活且计费正确（`_animateTurnMarker` 已被 V14 移除，装饰损失）；duration 全新 `{units,value,expiry,expired}` 结构；Region 行为完整进出周期通过（**裸 `document.update` 传送亦派发事件——2026-09-26 AURA-01 复测修正 M0 初测误判，见 S0.4 与专项计划决策 39**；非链接 token 落合成 Actor）；AE 变更全类型应用与“true”字符串语义安全；TokenHUD/选取器/工具栏注入全链路正常。写入型验证用临时数据已全部清理。影响实现的待定问题：无阻塞项（Q4/Q5 依据已收集，分别在 S3.6/S2.4 定稿） |
| M1 | **通过** | 2026-09-23 构建 14.368 实机验证：启动路径无报错（S1.16 修复 creature 数据准备，用户复验）；**用户确认刷新后控制台无本阶段涉及的弃用警告**；S1.1–S1.16 全部完成并记录结论（含审阅复核修正：S1.14 停用理由改为“弃用兼容层提前下线”、S1.9 AE 注销修正为传类并实测生效、S1.16 hp 兜底映射 tili）。AE/脚本等功能行为分别留待 M2/M3/M5 验收 |
| M2 | **通过** | 2026-09-25 构建 14.368 实机验收（testsystem 世界，写入型临时数据已全部清理）。AE-01～09（数据链路、时长与过期、架招绑定、编辑器 AppV2、拖放链路、状态选取器）与 AE-13（showIcon 三层分工：门面兜底 `??= 2` + 施加/拖放/消耗品三路径六用例实测 + 画布图标视觉确认与时长无关性）、AE-12（迁移框架：world setting 分阶段版本、幂等、失败不推进版本、非关联 Token 经合成 Actor 嵌入文档写回）全部完成并逐条记录于专项计划。M2 出口条件（代码链路、编辑器、拖放和状态选取器在 V14 测试数据上通过）达成；正式 AE 合集包与旧世界迁移按计划不在 M2 出口内。语义差异记录：核心 turnStart 到期锚定施加槽位而非目标槽位（AE-05，按 Q5 不作产品约束） |
| M3 | 待验 | — |
| M4 | **源数据/合集包通过；世界迁移待正式验收** | 2026-09-25 构建 14.368 实机验收：S4.1/S4.2/S4.6 随 AE-10 完成（data/ 源 JSON 全量迁 V14 新写法：2378 条模板 effects、516 处状态查询、约 750 处内联 duration、71 处 mode、169 处 changes 读取，4613 个脚本语法回归通过）；S4.4 随 AE-11 完成（11 类合集包重建、1438 个施加型模板 showIcon:2 透传、端到端常显画布确认）；S4.5 完成（2 处 measureDistance → measurePath，euclidean/cost 语义与 V13 逐一对等）；S4.8 审计完成（user: 0 残留、2 处旧字段读取修复、其余命中均为存活 API）。S4.3 已并入光环专项 AURA-06（改写为指向快建工具的说明宏，随 M3 实施）；S4.7 首跑演练（2026-09-25）：V13 世界数据在 V14 首次加载，阶段 1 迁移日志显示更新 50 条特效，未见报错，版本号为 1；旧特效时长、重启持久化及幂等性尚未验收。正式迁移须先在 V13 完成预处理并核对报告，再按 AE-14 清单复验。详见专项计划 AE-10/AE-11/AE-14 记录 |
| M5 | 待验 | — |

### 2026-09-25 手动回归记录（Foundry 14.368，testsystem 世界）

**已验证**：战斗流程、buff 持续时间、消耗品施加 buff、距离计算、AE 拖放（角色卡/画布/物品页）、AE 的回合开始脚本、非关联 Token 特效。

**修复记录**：

1. **AE 拖放转移**：Actor 内嵌 AE 拖放到其他 Actor 后删除来源；物品模板与合集包 AE 保留来源。GM 端实机复验通过。玩家无来源编辑权限时的 GM 删除委托、来源删除失败后的重复效果尚待修复并复验（S5.2）。
2. **窗口头部图标**：物资节点窗口的按钮字体规则已排除 `.header-control`；遭遇运行时、战况对话框、遭遇表单移除了覆盖图标字体的旧 Font Awesome 6 声明。浏览器加载系统 CSS 的复现页中，头部图标恢复正常。
3. **AE 配置窗口的 duration 标签**：窗口类补入 `active-effect-config`，并为标签文本设置 `min-width: max-content`；浏览器复现页中，中文标签恢复横排。新增样式沿用核心作用域 `active-effect-config` 而非限定 `xjzl-config`：它抵消的是核心同作用域规则，属性本身无害（英文下等价于无操作），且系统已注销核心 AE 表单，不存在受影响的其他编辑器。

**AE-14 首跑演练**：V13 世界数据在 V14 首次加载，阶段 1 迁移日志显示更新 50 条特效，未见报错，版本号为 1。旧特效的时长、重启持久化及幂等性尚未验收；正式迁移须先完成 V13 预处理。详见 [`V14_AE_PLAN.md`](V14_AE_PLAN.md) 的 AE-14 记录。

**待处理**：

1. **战斗标记旋转**：`Token#_animateTurnMarker` 在 V14 已移除，当前守卫使双层标记的交错旋转不再执行；标记仍可显示。重适配或放弃该装饰由 S3.8 决定。
2. **xjzl-token-hud mod 的“剩余 Infinityh”**：模组仍读取 V13 时长字段。适配 V14 `duration` 结构；永久效果单独显示为无限时长。`game.xjzl.api.effects.getDurationLabel(effect)` 对永久效果返回 `null`，调用方需处理。
3. **AE 编辑器的 `duration.expiry` 原始键**：汉化模组缺少 `EFFECT.FIELDS.duration.expiry.label`，需补充译文。
4. **旧窗口样式选择器**：`styles/base/_reset.css` 及部分应用样式仍使用 `.window-app` 前缀，在对应 V14 AppV2 窗口中可能失配；按 S5.7 逐条复核。
