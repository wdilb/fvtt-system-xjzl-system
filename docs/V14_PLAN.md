# V14 升级执行计划

依据 [`V14_UPGRADE.md`](V14_UPGRADE.md) 拆解的分步执行清单，只列目标不列做法；设计细节、文件定位与数量以升级方案文档为准。完成一项勾选一项，提交信息在勾选时同步更新。

## M0 验证 spike（一切设计定稿的前提）

- [ ] S0.1 确认 ActiveEffect system 数据模型的注册机制（Q3）
- [ ] S0.2 确认 `CONFIG.ActiveEffect.phases` 注册要求与最小配置
- [ ] S0.3 确认 `CONFIG.statusEffects` 对象形态的字段要求（键即 id？条目是否保留 id 字段）
- [ ] S0.4 验证 Region 行为 API 与核心 Apply Active Effect 行为能力（光环设计 Q4 前置）
- [ ] S0.5 验证画布劫持点存活：`SquareGrid.measurePath`、`rulerClass._getWaypointLabelContext`、`Token._refreshTurnMarker`/`_animateTurnMarker`
- [ ] S0.6 确认 duration 新 schema 字段与 expiry 事件清单
- [ ] S0.7 验证 `add`/`multiply` 变更值的字符串拼接问题及应对（见 M2 备注）

## M1 机械替换

- [x] S1.1 A1：`game.i18n.format(key, data)` → `game.i18n.localize(key, data)`（73 处）
- [x] S1.2 A2：`TextEditor.implementation.enrichHTML` → 顶层 `TextEditor.enrichHTML`（8 处 / 6 文件）
- [x] S1.3 A3：数字 `mode` → 字符串 `type`（`CONST.ACTIVE_EFFECT_CHANGE_TYPES`；active-effect.mjs、personality.mjs、config.mjs 状态定义）
- [x] S1.4 A4：特效数据 `icon` → `img`（personality.mjs）
- [x] S1.5 A5：`CONFIG.statusEffects` 数组 → 按 id 键对象（定义在 CONFIG 赋值处转换，调用侧约 16 处改对象访问）
- [x] S1.6 A6：`rollMode` 设置 → `messageMode`；`ChatMessage.applyRollMode` → `ChatMessage.applyMode`（3 处）
- [x] S1.7 A7：`system.json` 兼容版本 13 → 14
- [ ] S1.8 B4：渲染钩子迁 `*HTML` 变体（renderTokenHUD / renderItemDirectory / renderActorDirectory / renderCompendiumDirectory；renderCombatTracker 去掉双绑）
- [ ] S1.9 B5：移除 V1 Sheet 注销逻辑
- [ ] S1.10 B6：删除 `-=` 特殊键防御性检测
- [ ] S1.11 B7：CSS 旧变量族替换（17 处 / 6 个变量族）

## M2 ActiveEffect 链路（依赖 S0.1/S0.2/S0.6/S0.7）

- [ ] S2.1 init 注册 AE phases 与 system 数据模型
- [ ] S2.2 `XJZLActiveEffect` 读写迁移：`system.changes`、字符串 `type`、`img`、`origin` UUID 校验
- [ ] S2.3 `addEffect`/`removeEffect` 入参归一化兼容层（D2）
- [ ] S2.4 时长引擎适配新 duration schema（叠加/刷新/锚点/转化规则保留）
- [ ] S2.5 `XJZLActiveEffectConfig` 重写（V2 规范 tab/partial，去除 jQuery 注入）
- [ ] S2.6 effects 构造与读取点迁移（personality / item / actor / sheets / seeding 代码侧）
- [ ] S2.7 世界数据迁移机制（Q1：baseChanges flags 等）
- [ ] S2.8 状态选取器与新 CONFIG 形态联调回归

> 备注（S0.7）：V14 `DataField.applyChange()` 对 `add`/`multiply` 可能按字符串拼接（`"0"+"1"="01"`，DCC 为此 override）。我们的叠层乘算引擎与数值类变更需实测确认，必要时在 `ActiveEffect#apply()` 或变更判定接口处理。

## M3 Region / 光环（依赖 S0.4）

- [ ] S3.1 删除 `module/measured-template.mjs` 与 `CONFIG.MeasuredTemplate` 注册
- [ ] S3.2 AOE Creator 改 Region 实现（静态圆形 + `attachment.token` 跟随）
- [ ] S3.3 删除 `updateToken` 粘性同步；`deleteToken` 清理按附着行为重定
- [ ] S3.4 工具栏按钮迁移（templates 层已移除）
- [ ] S3.5 1-2-2-2 网格高亮方案（`GridShapeData` 或降级）
- [ ] S3.6 光环架构定稿（Q4）与实现（自定义 RegionBehavior 方向）
- [ ] S3.7 脚本引擎光环触发器接入（`SCRIPT_TRIGGERS`/本地化/文档联动）
- [ ] S3.8 标尺与移动劫持重适配（依赖 S0.5）

## M4 数据迁移

- [ ] S4.1 data/ 源 JSON 转 V14 格式（`system.changes`、`type`、`img`、duration；约 3045 处 mode）
- [ ] S4.2 脚本内 `CONFIG.statusEffects.find` 批量替换为辅助函数（约 478 处，D3）
- [ ] S4.3 `data/macros/utility.json` 光环宏改写（或并入 S3.6）
- [ ] S4.4 合集包重建（`game.xjzl.seed.all()`）

## M5 回归与文档

- [ ] S5.1 §7 画布 API 验证清单回归
- [ ] S5.2 §7 特效行为验证清单回归
- [ ] S5.3 §7 杂项验证清单回归
- [ ] S5.4 完整战斗流程实测（出招/对抗/伤害/状态/战局）
- [ ] S5.5 文档同步（CLAUDE.md / SCRIPT_ENGINE.md / SEEDING_GUIDELINES.md / README / PROJECT_MAP.md）
