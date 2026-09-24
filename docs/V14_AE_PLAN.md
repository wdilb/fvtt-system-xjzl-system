# V14 ActiveEffect 专项开发计划

**本文件是 [`V14_PLAN.md`](V14_PLAN.md) 中 M2/S2.2–S2.11 与 M4 中 AE 子项的唯一开发和验收依据。**总计划只镜像里程碑与跨阶段依赖；V14 总体范围及公开 API 约束仍见 [`V14_UPGRADE.md`](V14_UPGRADE.md)。`[ ]` 表示代码尚未完成并验收。每项完成后在此记录 Foundry 构建号、场景、结果，再同步总计划；待决项取得结论前不得把相关工作标为完成。

## 目标与边界

1. 保留物品内嵌 AE：武学、内功、装备等仍可在自己的页面配置被动效果或可施加的效果。V14 允许 AE 作为合集包中的独立文档；**没有世界级 AE 集合**。现有通用状态继续以 `CONFIG.statusEffects` 定义，内容特有 AE 继续在武学、内功、物品等来源中定义，不批量复制到 AE 合集包。
2. 让物品页面中**可施加的 AE**作为标准文档拖出；装备等物品内嵌的 `transfer: true` 被动 AE 不允许拖出。角色卡、Token 可接收可施加的物品 AE 和合集包 AE。这里的“转移”指**拖放复制并施加**：目标 Actor 得到副本，源 AE 保留，不是把文档从原处移走。拖放 `tiedToStance` AE 时另须双方当前架招相同；不相同或无法确认则直接结束此次施加。
3. 保留 `game.xjzl.api.effects` 的叠层、slug、来源、飘字、聊天卡片和 GM 权限语义；新增的“施加到 Actor”入口经过门面。可拖出的 AE 在物品之间拖放时是模板复制，不触发施加规则。
4. 以 V14 `duration`、`start` 和过期事件表达“持续 X 回合”；到期时清理且不重复结算，不强制规定核心 registry 与本系统回合脚本的先后。战斗外按 `CONFIG.time.roundTime = 2` 秒/回合计时。架招解绑继续由 `tiedToStance` 的业务清理负责；双方当前架招相同时允许复制此类 AE，交由目标架招的现有生命周期清理，不为它另改持续时间。
5. 状态选取器继续支持现有通用状态和场上物品 AE。V14 独立 AE 合集包可按核心能力打开、编辑和拖放，但本次不要求把所有 AE 搬入合集包，也不要求把 AE 合集包加入系统选取器。

## 已核对的 V14 契约

- [官方 Document 说明](https://foundryvtt.com/api/v14/modules/foundry.documents.html)：AE 可独立放在合集包，也可嵌入 Actor/Item；没有 `game.effects` 这样的世界集合。合集包中的 AE UUID 可用 `fromUuid` 解析。
- [官方源数据结构](https://foundryvtt.com/api/v14/interfaces/foundry.documents.types.EffectDurationData.html)：持久化 `duration` 是 `{value, units, expiry, expired}`；`remaining`/`secondsRemaining` 是准备后的派生数据，不写入源 JSON。开始锚点是 AE 顶层 `start`，不是旧版 `duration.startRound/startTurn/startTime`。`expiry` 存事件 ID，如 `"turnStart"`，不是中文显示名称。**达到时长且发生指定事件**才到期；`value: null, expiry: null` 才是真正无限。
- [官方事件表](https://foundryvtt.com/api/v14/variables/CONST.ACTIVE_EFFECT_EXPIRY_EVENTS.html)含 `turnStart`、`turnEnd`、`roundStart` 等；本机 14.368 源码的 `isExpiryEvent` 对 `turnStart` 限定为该 AE 所属 Actor 的当前 Combatant。角色无战斗参与者、战斗外计时以及多战斗切换仍须实机验收。
- [官方 registry API](https://foundryvtt.com/api/v14/classes/foundry.helpers.ActiveEffectRegistry.html)根据事件刷新并执行 `CONFIG.ActiveEffect.expiryAction`。本机 14.368 默认动作是 `"update"`（仅标记 `duration.expired`），不会物理删除；`"delete"` 才删除。核心战斗流程已在回合开始调用 registry。
- [ActorSheetV2](https://foundryvtt.com/api/v14/classes/foundry.applications.sheets.ActorSheetV2.html)和[ItemSheetV2](https://foundryvtt.com/api/v14/classes/foundry.applications.sheets.ItemSheetV2.html)内置 `_onDragStart`、`_onDropActiveEffect`，但默认落点会直接复制文档。本机 14.368 画布 Token 落点也直接创建 AE。这些默认路径不经过本系统 `addEffect`。
- 本机 14.368 的 `ActiveEffect#toCompendium` 默认清除 `origin` 与 `start`，适合把副本存为独立模板；`sourceName` 同步解析不了合集包内的 `origin` 时会显示 Unknown。拖放后要验来源 UUID 的合法性，也要验角色卡的来源名称回退显示。

建议使用下列源数据表达最常见的三回合效果：

```json
{ "duration": { "value": 3, "units": "rounds", "expiry": "turnStart", "expired": false } }
```

新建的模板不保存 `start`，施加到 Actor 时由 V14 初始化；从已生效 AE 拖放复制时保留其 `duration` 和 `start`，沿用当前剩余时间，不额外刷新或重置。若目标已存在同 slug AE，仍按现有 `addEffect` 叠层、延长或刷新规则处理。界面原有“0 代表无限”的输入语义须映射为 `value: null, expiry: null`，不能把 `0` 直接写为无限。`turns`、`seconds` 等少数旧数据按原业务意义逐条迁移，不能一律换算成 `rounds`。系统已设置 `CONFIG.time.roundTime = 2`。

V14 还增加 `showIcon`（状态图标显隐）、以 `token.` 为前缀的 Token 属性变更、变更应用阶段、`@` Actor 数据引用及 `subtract` 类型。**本次必须处理既有图标与数据格式的兼容**；Token 覆写和新类型本身按需使用，不为升级而重写现有业务脚本。详情见[官方 V14 发布说明](https://foundryvtt.com/releases/14.353)、[AE schema](https://foundryvtt.com/api/v14/classes/foundry.documents.ActiveEffect.html)和总纲 M0 机制结论。

| V14 改动 | 本系统需要配合的部分 |
|---|---|
| `showIcon: 0/1/2` | 核心默认 `1` 只给临时 AE 显示图标；`addEffect` 直接创建的永久通用状态不能只依赖默认值。逐项核对系统状态与装备被动图标，应常显的明确设 `2`；AE 编辑窗保留核心选项。 |
| `token.*` 变更 | 核心可把 `token.light`、视野等变化应用到 Token。本系统当前未定义此类 AE 变更，不为升级新建 Token 覆写数据模型；只检查现有 Token 自定义逻辑不被影响。核心暂不处理网格尺寸变更。 |
| `system.changes[].type/phase/value` | 旧数字 `mode` 要改字符串 `type`；默认 `initial` 早于系统派生计算，`final` 晚于派生计算。现有变更按目标字段核对阶段，叠层快照和编辑窗也同步新结构；`@` 引用和 `subtract` 只在原效果确有需求时采用。 |
| `origin` UUID | 核对 UUID 格式（包括 V14 允许的相对 UUID）及来源展示；来源文档暂时无法解析时不擅自改写合法值。复制时保留原合法来源，原值缺失才补源 Item/AE UUID。检查消耗品、架招同源豁免和旧世界脏数据。 |

## 设计决定与待验边界

| 主题 | 实施方案 | 需要验证的边界 |
|---|---|---|
| 拖放语义 | 可拖的 Item AE、Actor AE、独立 AE 使用 V14 文档拖放；目标端复制，源文档保留。只去掉与新父级冲突的文档 `_id`/位置字段；原有 `flags`、脚本、`system.changes`、`statuses`、`duration`、`start` 和合法 `origin` 原样保留。模板没有 `start` 时由核心在 Actor 上初始化；没有 `origin` 时才补源 Item/AE UUID。 | Actor 内嵌 Item、非关联 Token、合集包 UUID；已有时长的 AE 拖放后沿用剩余时间。来源名称需正确回退显示。 |
| 施加入口 | 复用 V14 `ActorSheetV2`/`ItemSheetV2` 的 `.draggable` + `data-effect-id` 与原生 `toDragData()`；角色卡和画布 Token 的接收改走 `ActiveEffectManager.addEffect`，复用叠层、权限和提示；拦截核心默认创建，保证一次拖放只施加一次。Item 卡接收可沿用核心模板复制。 | 角色卡已有 Item 拖拽监听、自定义 `_onDrop` 与核心 `.draggable` 的冲突；GM/玩家、合成 Actor、同 slug 重施加。画布 Token 默认直建，需在核心落点前接入门面。 |
| 被动效果 | **Item 内嵌、`transfer: true` 的被动 AE 不提供拖出**，包括装备页和 Actor 页展示的物品被动 AE；它留在 Item 上，继续按装备状态和破衣规则抑制。目标端也拒绝通过其他入口落入的此类拖放数据。可施加的 Item AE 允许拖出与施加。不能仅凭 `transfer: true` 拦截独立 AE，因为 V14 的该字段默认值也是 `true`。 | 逐项检查现有 Item AE 的 `transfer` 用法；其他被动来源若适用同一规则，一并禁止拖出。可施加模板的 Item→Item 复制仍可用。 |
| 时长到期 | `duration.value/units/expiry/expired` 与顶层 `start` 替换旧字段。优先采用核心 registry 的 `expiryAction: "delete"` 物理清理，再撤下系统的重复过期扫描；保留架招业务清理。既有回合脚本与核心到期处理的先后不作为产品约束，只要求结果正确、不会重复清理或抛错。 | 确认指定到期事件、目标 Actor、战斗外每 2 秒一回合、GM 与模块 AE；若全局 `expiryAction` 不适合世界中的其他效果，再改为核心 `"update"` 加单一系统清理。 |
| 架招绑定 | 保留 `flags.xjzl-system.tiedToStance`、`clearStanceTiedEffects` 和 `stopStance`。拖放绑定 AE 前，解析来源 Actor 与目标 Actor **当前已启用**的武学和架招；确认是同一架招才复制，并保留 flag、`origin`、`duration`、`start`，由目标架招现有的结束/切换逻辑清理。任一方未启用架招、无法取得来源 Actor/招式、或架招不同，直接结束施加，目标不创建 AE、源 AE 保留；不新增时长规则。 | `stanceItemId` 是各 Actor 本地 Item ID，招式 ID 也可能在重新录入后变化，不能直接跨角色比较。优先比较双方武学的相同合集包来源与架招名称；来源信息缺失时以武学名称和架招名称回退，若同名招式无法唯一定位则视为无法确认。同武学重开、跨武学切换、主动解除、濒死解除仍按目标既有清理路径。 |
| AE 编辑窗 | 保留 V14 核心 details/duration/changes 页签，包括 `showIcon`、`transfer`、`statuses`、`origin` 和新变更格式；另加“侠界配置”页签，保留 slug、可叠层、最大层数、架招绑定、脚本增删/启停/时机/代码及变更 key 自动补全。 | 切换页签、添加/删除脚本和保存时不能丢弃其他页签未保存字段；物品、Actor、独立合集包 AE 均能编辑。 |
| 状态来源 | `CONFIG.statusEffects` 继续提供通用状态与 TokenHUD；状态选取器继续保留现有分类、搜索、最近、收藏、场上物品特效、多目标和已生效管理。独立 AE 合集包可按 V14 原生能力作为额外模板来源，不强制接入该选取器。 | Item AE 数量随内容增长；不建立需与各 Item 同步的第二份状态目录。 |

### 实施时核对的边界

1. 核心 registry 与系统回合脚本的先后**不阻塞实施**；只做一轮正常到期、跳回合与不重复删除的联调。若 `expiryAction: "delete"` 的全局影响造成实际冲突，再走表中的回退方案。
2. 旧世界时长字段在 V14 清洗后可能无法完整恢复；迁移阶段用 V13 备份样本核对，无法还原的个例记录清楚，不阻塞 M2 的 AE 代码升级。
3. `tiedToStance` AE 的来源和目标 Actor 必须都正在使用同一架招；来源为 Actor 上的 AE 或其内嵌 Item AE 时按所属 Actor 取当前架招。独立 AE 或世界物品 AE 若无法确定来源 Actor，则本次不施加；来源或目标无活动架招、架招不同、身份无法唯一确认时也不施加。成功复制时保持原 `origin` 与剩余时长，由目标架招清理。

## 工作项与依赖

### A. 基线和核心数据链路

- [ ] AE-01（S2.2；S2.1 已由 M0 结论关闭）审计 `XJZLActiveEffect` 的 `_preCreate`、`calculateChangesForStacks`、`isSuppressed`、`_displayScrollingStatus`。把快照及读写改为 `system.changes`，保留字符串 `type`，清理 `legacyTransferral` 过时注释，核对 `origin` 的合法 UUID。
- [ ] AE-02（S2.3/S2.6）逐个迁移 `ActiveEffectManager`、`module/config.mjs`、`personality.mjs`、`item.mjs`、`actor.mjs`、各 Sheet、seeding 的 AE 构造和读取，并审计 `chat-manager.mjs` 破防的两处直接建 AE、Actor 内的 `toggleStatusEffect`、消耗品替换和性格自动 AE。门面入口归一化已到达的旧 `{changes, mode, icon, duration}` 普通数据，输出 V14 格式；不能把旧格式回写数据库，也不能用兼容层掩盖调用前的 `effect.changes` 读取错误。明确哪些核心直建入口有业务理由，迁移格式并保持其既有可见行为；其余施加入口走门面。叠层基准 `baseChanges` 随世界迁移处理。
- [ ] AE-03（S2.9）提供并验证 `game.xjzl.api.effects.getStatus(id)`：同步查询、未命中返回 `undefined`、命中返回可安全修改的 V14 格式副本；接口说明同步到 `SCRIPT_ENGINE.md`。这是 S4.2/S4.7 状态脚本迁移的前置。
- [ ] AE-12（S2.7）建立 AE 世界迁移框架：独立 world setting 记录已完成版本；遍历 Actor/Item AE、世界物品和非关联 Token 合成 Actor；对旧结构与 `baseChanges` 做可重试转换，仅全部成功后推进版本。V13 备份样本和实际世界迁移验收归 AE-14，不阻塞 M2。
- [ ] AE-13（S2.2/S2.6/S5.2）核对 V14 `showIcon` 三态：默认 `CONDITIONAL` 只显示有临时时长的 AE；系统希望始终显示图标的通用状态明确设 `ALWAYS`，其他 AE 按现有可见性选择，避免永久状态图标消失。核对 `origin` 的 Document UUID、字符串 `type`/`phase` 与 `@` 值引用；只回归本系统实际用到的变更。`token.*` 变更与 `subtract` 是可选新能力，不作为迁移旧效果的前置。

### B. 持续时间与架招

- [ ] AE-04（S2.4）把添加、满层刷新、非叠层延长、手动时长修改、忍耐减免剧痛、颤手→缴械并卸武器、心火→走火入魔改用 `{value,units,expiry,expired}`。刷新重置顶层 `start`，同单位延长保持旧锚点；比较“更长”时考虑单位和事件，不沿用旧 `rounds*100+turns` 评分。角色/生物卡和状态选取器的剩余时长标签与 `promptEffectDuration` 同步迁移；保留 UI 的 `0=无限`。
- [ ] AE-05（S2.4/Q5）以 V14 registry + `expiryAction: "delete"` 作为首选清理方式；联调指定目标的 `turnStart`、战斗外每 2 秒一回合、跳回合和 GM 操作，确认不会重复删除或抛错后撤下旧 `updateCombat` 扫描。核心与回合脚本的先后只记录，不单独改调度；若全局 `expiryAction` 引起实际兼容问题，改用 `"update"` 加一个系统清理入口。保留 `cleanExpiredEffects(actor)` 公开兼容语义。
- [ ] AE-06（S2.4）保留并回归 `tiedToStance` 业务清理；验证同武学豁免依赖的 Item `origin`、架招切换/解除/被破除。拖放绑定 AE 时先确认来源与目标 Actor 当前使用同一架招，确认后复制，保留 flag、原 `origin`、`duration` 与 `start`，交由目标架招清理；不相同或无法确认就结束此次施加，不创建目标 AE，也不新增时长或解绑特例。

### C. 编辑器、拖放和状态选取器

- [ ] AE-07（S2.5）将 `XJZLActiveEffectConfig` 迁至 V14 ApplicationV2 的 `PARTS`/`TABS`/`actions`，保留核心 details/duration/changes 页签与 `showIcon`、`transfer`、`statuses`、新变更字段；加入“侠界配置”页，完整保留 slug、可叠层、最大层数、`tiedToStance`、脚本标签/时机/启停/代码、增删和变更 key 的 datalist。兼容对象形态的旧 scripts；验证跨页签未保存字段、物品/Actor 内嵌及合集包独立 AE 的保存与重开。
- [ ] AE-08（S2.10/S2.11）在武学、内功、装备、特性、身世、通用物品六类现有 AE 模板上，为可施加的 AE 行加入 V14 识别的 `.draggable`、`data-effect-id`；角色/生物卡的非物品被动 AE 行也使用核心拖拽。Item 内嵌 `transfer:true` 被动 AE 在物品页与 Actor 页均不可拖。角色卡接收 AE 走 `_onDropActiveEffect` → 门面，画布 Token 在 `dropCanvasData` 阶段拦截核心直建并走门面，均不得重复创建；Item 卡接收可拖 AE 仍复制模板。对 `tiedToStance` 施加先执行 AE-06 的双方架招判定，失败时中止而不触发叠层、脚本、飘字或聊天。检查角色卡现有 Item 拖拽监听不吞 AE 事件。用临时独立 AE 合集包验证原生打开、编辑、拖放，不建立正式 AE 包；覆盖绑定 AE 的同架招成功、异架招/无架招/无来源失败，成功时 flag/origin/start/duration 保留，以及独立 AE 不按 `transfer` 误挡、权限、合成 Actor 与来源名回退。
- [ ] AE-09（S2.8）状态选取器继续以 `CONFIG.statusEffects` 展示标准状态，并保留场上物品 AE；回归分类计数、搜索、最近、收藏、已生效态、左右键叠层/时长、撤除、受控/瞄准目标和多目标。同步回归 TokenHUD 点击、overlay 与 `actor.statuses` 判断；更新旧 `duration.rounds` 读取。**不新增必须维护的合集包 AE 分类**。

### D. 源数据、合集包与世界迁移（与 M4 共用工作项，不因 M2 完成而提前勾选）

- [ ] AE-10（S4.1/S4.2/S4.6，及 S4.8 的 AE 相关脚本审计）按 AE 对象结构遍历 `data/**/*.json`：`changes→system.changes`、数字 `mode→type`、`icon→img`、duration、`origin`、`showIcon` 的实际需要；按脚本字段和变量来源迁移动态构造、`effect.changes`、状态查询和时长读取。既有约 500 处 `CONFIG.statusEffects.find`、98 处 AE `.changes` 只是检索基线，需按谓词/变量来源分类并补查其他别名。检查 `module/config.mjs` 的通用状态模板；不对整个 JSON 文件盲目替换。同步更新 `SCRIPT_ENGINE.md` 中旧时长和状态 API 示例，并按录入格式变化更新 `SEEDING_GUIDELINES.md`。
- [ ] AE-11（S4.4）源 JSON、seeding 和脚本审计完成后重建现有 Item 等合集包并检查导入结果；不为每个内容专属 AE 建独立合集包。若未来要建立固定 AE 模板包，先明确唯一素材事实源和 seed 规则。
- [ ] AE-14（S4.7）在备份的 V13 世界副本实施并验收 AE-12 的迁移：Actor/Item/非关联 Token AE、世界物品、导入宏和用户脚本；核对 `baseChanges`、duration、变更与图片字段、既有数值和可恢复的剩余时长。验证首次执行、重启、重复运行及中断重试；用户改过的脚本只做可确认的定点转换，无法识别的记录 UUID/字段位置和处理方案，不整项覆盖。

### 实施顺序与出口

1. M2 先完成 AE-01/AE-02/AE-03 的数据与公开入口，AE-13 同步核对 V14 契约；以测试数据让 AE 可正确创建、修改和生效。
2. AE-04 改完时长读写后实施 AE-05 的核心过期清理，AE-06 保留架招业务清理；检查到期目标、2 秒/回合及不重复删除，脚本与 registry 的先后不是通过条件。
3. 完成 AE-07/AE-08/AE-09 的编辑、拖放与状态选取器回归；M2 出口不依赖正式 AE 合集包或旧世界迁移。
4. M4 按 AE-10 → AE-11 迁移源数据并重建现有合集包，再以 AE-14 验收旧世界副本；AE-12 迁移框架在 M2 建立。非 AE 的 M4 工作仍按总计划执行。

## 验收矩阵与完成标准

| 场景 | 必须看到的结果 |
|---|---|
| 三回合状态，在 A 回合给 A 施加 | 到期只在 A 的指定回合开始处理一次，不重复触发、漏删或报错；其他角色回合不提前移除。记录实际起点与回合脚本顺序即可。 |
| A 回合前/后由他人施加；战斗外施加再进战 | 记录起点和实际剩余时长；战斗外世界时间每推进 2 秒抵 1 回合，到期清理与进战衔接正确。 |
| 叠层、满层刷新、非叠层重施加、延长与手动改时长 | `stacks/maxStacks/baseChanges` 与数值乘算正确；来源、覆盖、延长和刷新规则保持；角色/选取器显示剩余时长正确，`0=无限` 不会立刻过期。 |
| 忍耐、颤手、心火 | 剧痛减回合和完全豁免提示、颤手满层转缴械并卸武器、心火满层转走火入魔的时长/飘字/聊天卡片与旧规则一致。 |
| AE 挂载脚本、飘字与聊天设置 | `flags.scripts` 的 `passive`、回合等既有触发器照常收集并执行；创建、叠层、减层、删除的飘字不重播；`showEffectChatCards` 开/关分别符合设置且不重复发卡。 |
| 被动装备、破衣抑制、性格自动 AE、消耗品 AE、破防与死亡/濒死状态 | 既有创建、抑制、替换、删除、状态图标和脚本结果保持；核心直接创建的路径也使用 V14 数据格式。 |
| 物品、角色/生物卡和独立 AE 拖放 | Item 内嵌被动 `transfer:true` 在物品页与 Actor 页均不可拖出，也不能通过目标端施加；可施加 Item AE、普通 Actor AE、独立 AE 能落到角色/Token，可施加 AE 在物品间能复制。绑定架招的 AE 仅在来源/目标 Actor 当前架招相同时能施加；否则目标没有副本或任何施加副作用。成功复制时源文档保留、目标只有一份副本，flags/脚本/changes/原 `origin`/原 `duration` 与 `start` 按来源保留。 |
| 状态选取器、特效卡片和编辑器 | 分类、搜索、最近、收藏、场上特效、多目标、左右键加减层/改时长、删除、TokenHUD/overlay、页签和脚本编辑均可用；`actor.statuses` 与变更 key 自动补全仍正确。 |
| 玩家、GM、非关联 Token | 权限委托成功且操作落在正确的 Actor；不重复施加/飘字/聊天卡片，也不能绕过目标权限。 |
| 架招结束或切换 | 来源和目标都启用同一架招时，拖放副本由目标角色现有 `tiedToStance` 清理规则处理；异架招、缺架招或来源无法确认时不创建副本。既有同武学豁免不误删，自身时长到期也不漏删。 |
| V13 世界副本迁移、重启、重试 | 旧 AE 数值与可恢复的剩余时长不意外变化；不可恢复的锚点有明确记录；第二次执行不重复创建或叠层，失败保留定位和重试能力。 |

每个改动的 `.mjs` 执行 `node --check`，每个改动的源 JSON 执行 `JSON.parse`；实机记录使用的 Foundry 构建号、操作步骤、结果和未覆盖项。**M2 出口**是代码链路、编辑器、拖放和状态选取器在 V14 测试数据上通过；**M4 出口**才包括源 JSON、合集包及旧世界副本迁移。未通过实机验证的项保持 `[ ]`，不以源码推断代替验收。
