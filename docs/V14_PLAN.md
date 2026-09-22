# V14 升级执行计划

本文件是 V14 升级的进度事实源，记录工作项、依赖和验证结果；范围、设计、API 依据及验收标准见 [`V14_UPGRADE.md`](V14_UPGRADE.md)。复杂工作另建专项计划，并在对应工作项后附链接，本清单不展开实现细节。

**当前下一步：M0，从 S0.1 开始。** 先确认可用的 V14 验证环境并记录构建号；若机制验证依赖完整系统启动，先处理 S1.14 等必要启动修复，再返回验证。首批 A 类改动已完成，阶段实机验收均尚未完成。

## 使用方式与状态约定

1. 先读“当前下一步”和文末验收记录，再选取**依赖已满足、未完成且未明确暂缓**的工作项；编号用于引用，不代表强制执行顺序。实施前读总纲对应章节，并按文件与函数名核对当前代码，避免重复实施。
2. 若单项复杂，先建立专项计划，关联原 S 编号并写明范围、子步骤和验收；整体清单只同步状态、链接与关键结论。发现新任务追加编号，不重排已有编号；已完成项不因拆计划被重新打开，除非发现实际遗漏。
3. 实施后先做验证，再更新工作项、待验信息和阶段记录。可自动执行的必要验证必须完成：改动 `.mjs` 后逐文件 `node --check`，改动 `data/*.json` 后逐文件 `JSON.parse` 校验；重要的实机或交互验证无法由会话执行时，整理操作步骤与预期结果输出给用户手工验证，并如实记录待验范围与原因，不臆断通过。收尾时更新“当前下一步”；待定决策的结论写回总纲，接口变更同步公共文档，不能等到 M5 才补接口说明。
4. 提交信息用中文自然语言说明具体改动及目的，不只写任务编号或“完成某阶段”。每次收尾可给出提交信息建议；仅用户明确要求提交时才执行 `git commit`，不自动提交。

代码项 `[x]` 表示本项实现及可执行检查完成；未实机覆盖的内容须注明对应待验阶段。验证项（如 S0.*、S5.1–S5.4）只有实际验证通过并记录结果才能勾选。阶段是否验收通过以文末记录为准，不能由代码项勾选推定；历史已勾选的 A 类代码项统一待 M1/M5 实机验收。

可选项若经明确决策暂缓，保留 `[ ]` 并标注“暂缓：原因/决策位置”，不伪装成已实现，也不阻塞已确认范围内的验收。下次会话跳过暂缓项；必要工作因环境或前置项未满足而受阻时，记录阻塞原因，不能按可选项处理。

## M0 机制验证（优先取得影响实现的结论）

依据：总纲 §0、§2、§3、§7。记录每项的构建号、验证场景和结论；机制试验可在独立最小环境进行，后续仍须完成系统集成验收。

- [ ] S0.1 确认是否需要自定义 AE system 数据模型（Q3 已解：官方接口 `CONFIG.ActiveEffect.dataModels`、基础模型 `foundry.data.ActiveEffectTypeDataModel`；待验证派生字段如何应用变更）
- [ ] S0.2 验证内置 initial/final 阶段与本系统基础值、物品准备、派生值计算的先后关系，确保每条变更只在指定阶段应用；仅确有需要时注册并调用附加阶段
- [ ] S0.3 按官方契约保留状态条目的 `id`，验证对象键与条目 `id` 一致，以及 TokenHUD、状态选取器和状态创建流程
- [ ] S0.4 验证 Region 行为 API 与核心 Apply Active Effect 行为能力（光环设计 Q4 前置）
- [ ] S0.5 验证画布劫持点存活：`SquareGrid.measurePath`、`rulerClass._getWaypointLabelContext`、`Token._refreshTurnMarker`/`_animateTurnMarker`
- [ ] S0.6 确认 duration 新 schema 字段与 expiry 事件清单
- [ ] S0.7 验证数值字段、非 schema 派生字段与 flags 的 `add`/`multiply`/`override` 类型处理（见 M2 备注）

## M1 机械替换与启动解阻

依据：总纲 §4、§5、§3.2。优先 S1.14 与启动路径审计，再做依赖系统运行的钩子、表单及样式验证；已勾选的首批替换以现代码为基础继续推进。

- [x] S1.1 A1：`game.i18n.format(key, data)` → `game.i18n.localize(key, data)`（`b2f3833` 实际替换 73 处）
- [x] S1.2 A2：`TextEditor.implementation.enrichHTML` → 顶层 `TextEditor.enrichHTML`（10 处 / 8 文件；可选改动，编辑器替换模块兼容性待 S5.3 验证）
- [x] S1.3 A3：数字 `mode` → 字符串 `type` 字面量，如 `"add"`/`"override"`（active-effect.mjs、personality.mjs、config.mjs；`CONST.ACTIVE_EFFECT_CHANGE_TYPES` 的值是优先级数字，不能用作类型；其余构造点由 S2.6/S4.1 承接）
- [x] S1.4 A4：特效数据 `icon` → `img`（personality.mjs）
- [x] S1.5 A5：`CONFIG.statusEffects` 数组 → 按 id 键对象（定义在 CONFIG 赋值处转换，调用侧约 16 处改对象访问）
- [x] S1.6 A6：`rollMode` 设置 → `messageMode`；`ChatMessage.applyRollMode` → `ChatMessage.applyMode`（3 处设置读取 + 1 处固定 public，共 4 个调用点）
- [x] S1.7 A7：`system.json` 兼容版本 13 → 14（声明已改；`verified` 的发布依据仍需 M5 完整回归）
- [ ] S1.8 B4：逐钩子实测 V14 渲染钩子派发形态（ApplicationV2 通用钩子为 `render<ClassName>` + HTMLElement，**不批量改 `*HTML`**）；renderTokenHUD 单独核查选择器/按钮/事件委托；renderCombatTracker 双绑实测后清理冗余
- [ ] S1.9 B5：核查 V14 核心默认表注册形态与继承链后，再处理 V1 Sheet 注销逻辑（AppV1 仍在弃用命名空间）
- [ ] S1.10 B6：`-=`/`==` 更新键在 V14 弃用，移除期为 V16；审计写入方与钩子接收形态，迁移到 `foundry.data.operators`，验证删除/替换仍触发资源脚本重算后再精简旧键检测
- [ ] S1.11 B7：CSS 旧变量族替换（17 处 / 6 个变量族）
- [x] S1.12 A8：`bringToTop()` → `bringToFront()`（character-sheet.mjs，V14 已移除）
- [x] S1.13 A9：ChatMessage 数据 `user:` → `author:`（模块 27 处 + data/ 脚本 88 处；世界内脚本副本由 S4.7 迁移）
- [ ] S1.14 摘除 MeasuredTemplate 启动依赖并删除旧类文件：xjzl-system.mjs 静态 import、`CONFIG.MeasuredTemplate` 注册、updateToken/deleteToken 中 `scene.templates` 逻辑、AOE Creator 创建调用与工具栏按钮（模块求值期即阻断加载，功能暂下线待 M3 Region 重建）
- [ ] S1.15 对照[官方 #13436](https://github.com/foundryvtt/foundryvtt/issues/13436)审计入口、module 与模板代码，补录遗漏项

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

## 阶段验收记录

验收标准以总纲 §8 为准。状态使用“待验 / 通过 / 未通过”；记录“Foundry 构建号、场景或用例、结果、剩余项”，可链接专项计划的证据，避免重复抄写。每次勾选验证项时就追加对应 S 编号的简要结论，不必等整个阶段结束；没有实际结果不得标为通过。

| 阶段 | 验收状态 | 验证记录 / 专项计划 |
|---|---|---|
| M0 | 待验 | 尚无 V14 实机验证记录 |
| M1 | 待验 | 首批 A 类代码项已勾选，启动、钩子与界面行为待验 |
| M2 | 待验 | — |
| M3 | 待验 | — |
| M4 | 待验 | — |
| M5 | 待验 | — |
