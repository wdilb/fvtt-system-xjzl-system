# V14 升级执行计划

依据 [`V14_UPGRADE.md`](V14_UPGRADE.md) 拆解的分步执行清单；设计细节、文件定位与统计口径以升级方案文档为准。勾选表示该项代码改动完成，实机验收由对应里程碑单独记录，不能据此认定 V14 已可发布。

当前基线：`b2f3833` 完成首批 A 类替换，其后的提交修正了变更类型字面量并补齐窗口与聊天 API 替换。M0 与各里程碑的 V14 实机验收尚未完成；后续记录验收所用 Foundry 构建号和结果。

## M0 验证 spike（一切设计定稿的前提）

- [ ] S0.1 确认是否需要自定义 AE system 数据模型（Q3 已解：官方接口 `CONFIG.ActiveEffect.dataModels`、基础模型 `foundry.data.ActiveEffectTypeDataModel`；待验证派生字段如何应用变更）
- [ ] S0.2 验证内置 initial/final 阶段与本系统基础值、物品准备、派生值计算的先后关系，确保每条变更只在指定阶段应用；仅确有需要时注册并调用附加阶段
- [ ] S0.3 按官方契约保留状态条目的 `id`，验证对象键与条目 `id` 一致，以及 TokenHUD、状态选取器和状态创建流程
- [ ] S0.4 验证 Region 行为 API 与核心 Apply Active Effect 行为能力（光环设计 Q4 前置）
- [ ] S0.5 验证画布劫持点存活：`SquareGrid.measurePath`、`rulerClass._getWaypointLabelContext`、`Token._refreshTurnMarker`/`_animateTurnMarker`
- [ ] S0.6 确认 duration 新 schema 字段与 expiry 事件清单
- [ ] S0.7 验证数值字段、非 schema 派生字段与 flags 的 `add`/`multiply`/`override` 类型处理（见 M2 备注）

## M1 机械替换与启动解阻

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

验收：V14 空白测试世界可完成 init/ready；启动路径无未处理异常及本阶段涉及的弃用警告。AE、数据脚本和 AOE 的完整功能分别在 M2/M4/M3 验收。

## M2 ActiveEffect 链路（依赖 S0.1/S0.2/S0.6/S0.7）

- [ ] S2.1 落实 S0.1 的模型选择：核心模型足够则沿用；需要扩展时在 init 注册 `CONFIG.ActiveEffect.dataModels`，继承 `foundry.data.ActiveEffectTypeDataModel` 并保留 type/phase/priority；附加阶段按需注册并显式调用
- [ ] S2.2 `XJZLActiveEffect` 读写迁移：`system.changes`、字符串 `type`、`img`、`origin` UUID 校验
- [ ] S2.3 `addEffect`/`removeEffect` 入参归一化兼容层（D2，含 `icon→img` 映射；只处理已到达入口的数据，不能修复调用前的旧文档访问，见 S4.6）
- [ ] S2.4 时长引擎适配新 duration schema（叠加/刷新/锚点/转化规则保留）
- [ ] S2.5 `XJZLActiveEffectConfig` 重写（V2 规范 tab/partial，去除 jQuery 注入）
- [ ] S2.6 effects 构造与读取点迁移（personality / item / actor / sheets / seeding 代码侧）
- [ ] S2.7 世界数据迁移机制（Q1：baseChanges flags 等，覆盖 S4.7；独立世界设置记录迁移版本，支持重复执行与失败重试，仅全部成功后推进版本）
- [ ] S2.8 状态选取器与新 CONFIG 形态联调回归

> 备注（S0.7）：社区的字符串拼接案例仅作为测试线索，不能直接认定稳定版存在同样问题。验证数字/数字字符串、布尔 override、`@` 引用及派生字段；确需定制时使用静态 `ActiveEffect.applyChange()`/`applyChangeField()`，`shouldApplyChange()` 只负责是否应用的判定，详见总纲 §2.7。

## M3 Region / 光环（依赖 S0.4）

- [ ] S3.1 确认 S1.14 的旧模板依赖已摘除，明确 Region 数据、附着关系与旧功能的对应方案
- [ ] S3.2 AOE Creator 改 Region 实现（静态圆形 + `attachment.token` 跟随）
- [ ] S3.3 验证 Region 原生跟随；若 Token 删除不会自动清理附着区域，则补充 Region 清理逻辑
- [ ] S3.4 工具栏按钮迁移（templates 层已移除）
- [ ] S3.5 1-2-2-2 网格高亮方案（`GridShapeData` 或降级）
- [ ] S3.6 Q4 产品范围与光环架构定稿；选择完整光环后再实现自定义 RegionBehavior，若仅恢复旧 AOE 则记录暂缓项
- [ ] S3.7 若 Q4 选择完整光环，接入脚本引擎触发器（`SCRIPT_TRIGGERS`/本地化/文档联动）；否则随 S3.6 记录暂缓
- [ ] S3.8 标尺与移动劫持重适配（依赖 S0.5）

## M4 数据迁移（依赖 M2；光环宏另依赖 M3）

- [ ] S4.1 data/ 源 JSON 中的 AE 数据转 V14 格式（`system.changes`、`type`、`img`、duration；按 AE 结构遍历，避免误改其他 mode 字段）
- [ ] S4.2 脚本内 `CONFIG.statusEffects.find` 替换为辅助函数（当前 script/command 字段共 500 个调用，D3；按谓词核对，不能仅按文本全局替换）
- [ ] S4.3 `data/macros/utility.json` 光环宏改写（或并入 S3.6）
- [ ] S4.4 所有 data/ 与 seeding 修改及 S4.8 审计完成后，重建合集包（`game.xjzl.seed.all()`），验证包内数据及导入行为
- [ ] S4.5 `measureDistance` → `measurePath` 脚本迁移（2 处，验证取点坐标与距离单位）
- [ ] S4.6 文档访问类脚本迁移：约 98 处 `eff/effect/thisEffect/ae` 的 `.changes` 访问逐项区分（内联构造保留走兼容层；读取文档/修改导出对象必须迁移）
- [ ] S4.7 世界侧副本迁移：世界物品、角色内嵌物品、非关联 Token 的 Actor、AE 脚本、已导入宏中的旧格式数据与脚本（含状态查询、文档 changes 访问、聊天 author、距离 API、光环宏）；在备份的 V13 世界副本验证首次迁移、重复启动和中断重试，无法自动处理的自定义脚本须报告定位
- [ ] S4.8 对照[官方 #13436](https://github.com/foundryvtt/foundryvtt/issues/13436)审计 data/ 脚本字符串中的已移除 API

验收：新世界导入和既有世界升级均可用；二次迁移无重复数据或效果叠加；世界内用户改动保留，待人工处理项有清单。

## M5 回归与文档

- [ ] S5.1 §7 画布 API 验证清单回归
- [ ] S5.2 §7 特效行为验证清单回归
- [ ] S5.3 §7 杂项验证清单回归（含聊天作者与 public/gm/blind/self 可见性、审计日志重复打开、TextEditor 配置实现兼容性）
- [ ] S5.4 完整战斗流程实测（出招/对抗/伤害/状态/战局）
- [ ] S5.5 文档同步（CLAUDE.md / SCRIPT_ENGINE.md / SEEDING_GUIDELINES.md / README / PROJECT_MAP.md）
