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

- [x] AE-01（S2.2；S2.1 已由 M0 结论关闭）审计 `XJZLActiveEffect` 的 `_preCreate`、`calculateChangesForStacks`、`isSuppressed`、`_displayScrollingStatus`。把快照及读写改为 `system.changes`，保留字符串 `type`，清理 `legacyTransferral` 过时注释，核对 `origin` 的合法 UUID。→ **已完成（14.368 实测）**：对照本机 V14 源码核实契约——`_displayScrollingStatus(enabled)` 签名不变，override 继续屏蔽核心飘字；核心 `isSuppressed` 现为 `system.isSuppressed ?? duration.expired`（基础模型无 isSuppressed 字段，默认即"过期则抑制"），叠加装备/破衣判定的 override 语义成立；创建数据到达 `_preCreate` 前已经过核心 `migrateData`（旧顶层 `changes` 迁入 `system.changes`、数字 `mode` 转字符串 `type`），`_preCreate` 快照改读 `data.system?.changes`；`legacyTransferral` 注释改为 V14 事实（内嵌 AE 恒留 Item 上，`transfer` 仅决定应用目标）；`calculateChangesForStacks` 回退分支已读 `this.system.changes` 无需再改。实测（testsystem 世界，临时 Actor 已清理）：V14 格式创建后 slug/stacks/scripts/baseChanges 全部正确（快照不含 prepareBaseData 补的 priority，干净）；`calculateChangesForStacks(3)` 按快照 5×3 乘算且保留字符串 `type`；旧格式入站（顶层 `changes`+`mode:2`）快照亦为 V14 结构；未装备 `transfer` 护甲特效 isSuppressed=true、装备后 false；创建/更新全程控制台无报错。origin：本文件无 origin 读写；V14 `origin` 为 `DocumentUUIDField(relative:true)` 自校验，非法值由核心迁移转 `flags.core.originText` 并置 null，业务侧 origin 写入/比较点归 AE-02/AE-06 核对。**备查（与 AE-02/AE-12 相关）**：核心 `migrateData` 对旧格式字符串 value 做 JSON.parse（如 `"10"`→数字 10），存量 V13 数据在加载清洗后 value 可能已是数字，本系统叠层乘算走 `Number()` 不受影响，世界迁移与门面归一化须知该清洗可能已发生；旧格式入站数据上 `"mode" in change` 命中的是核心非枚举兼容 shim（until:16），实际读取会触发弃用警告
- [x] AE-02（S2.3/S2.6）逐个迁移 `ActiveEffectManager`、`module/config.mjs`、`personality.mjs`、`item.mjs`、`actor.mjs`、各 Sheet、seeding 的 AE 构造和读取，并审计 `chat-manager.mjs` 破防的两处直接建 AE、Actor 内的 `toggleStatusEffect`、消耗品替换和性格自动 AE。门面入口归一化已到达的旧 `{changes, mode, icon, duration}` 普通数据，输出 V14 格式；不能把旧格式回写数据库，也不能用兼容层掩盖调用前的 `effect.changes` 读取错误。明确哪些核心直建入口有业务理由，迁移格式并保持其既有可见行为；其余施加入口走门面。叠层基准 `baseChanges` 随世界迁移处理。→ **代码完成并 API 实测（14.368，testsystem 临时数据已清理）**：①门面新增 `#normalizeEffectData`（icon→img、顶层 changes→system.changes、数字 mode→字符串 type、旧 duration→`{value,units,expiry}`；补丁对象的顶层 changes 整体替换底板已迁移数组；seconds 置 expiry:null、rounds/turns 默认 turnStart）；②manager 内部读写全迁 `system.changes`（叠层快照/乘算/减层/覆盖），`updateData` 用 `"system.changes"` 键；③`config.mjs` 62 个状态条目 `changes` 包入 `system`（`dead` 条目 changes 本为注释，62/62 实际包裹），逐条目补 `showIcon: 2`（见 AE-13）；④`actor.mjs` 破衣扫描、`item.mjs`/`personality.mjs` 性格 AE 构造与同步、`effect-interactions.mjs`/`effect-selection-dialog.mjs` 时长标签改走 manager `getDurationLabel`、6 个 Sheet 建特效 `icon:`→`img:`（V14 无此字段，残留会被核心清洗丢图标）、7 个 seed 文件 `img:` 兼容回退 + `system.changes` 包裹 + seed-origins 数字 `mode:2`→`type:"add"`；⑤审计结论：破防两处直建是展开 `CONFIG.statusEffects.pofang`，随条目迁移自动 V14（保留直建业务理由：不走叠层/飘字门面，行为不变）；核心 `toggleStatusEffect`（dead/dying/prone）走 `fromStatusEffect` 整体克隆条目并自动 `showIcon ??= ALWAYS`，无需改动；消耗品替换走 `toObject()`+门面自动 V14；character-wizard/customModifiers 的 `changes` 是系统数据非 AE。实测：旧格式入站经门面创建出的文档为完整 V14 结构（img/type/duration/slug）；一次性 3 层创建 stacks=3/数值 15/快照 5，再叠 2 层满层 5/数值 25，减层回 10；同单位延长 rounds 2+3=5 且 `start` 锚点保持不变；`getStatus`/性格 AE/常显传播均正常；全程控制台零错误零弃用警告。**注意**：调用方用扁平点号键 `"flags.xjzl-system": {...}`（而非嵌套 `flags:{}`）时 `getProperty` 读不到叠层标记，属 V13 以来既有行为，脚本录入规范不变。待验：战斗内颤手/心火/破防联调归 AE-05/AE-06 阶段。**审阅复核（第二轮）修正三项**：①seed 曾把旧数字 mode 原样包入 system.changes——核心 `migrateData` 只在迁移顶层 changes 时转换 mode，`mode:5` 会按默认 add 处理丢失覆盖语义（blade.json 实有 mode:5），新增 `module/utils/seeding/effect-data.mjs#normalizeLegacyChanges` 并接入 6 个 seed 文件（node 直测 mode:5→override、mode:2→add、新格式直通、空入参→[]）；②`#normalizeDuration` 曾在 value 为数值时提前返回，补丁与 V14 底板（如 pofang 的 `{value:1}`）深合并后旧单位键被忽略，现旧单位键存在时按其覆盖 value/units；③同单位延长分支曾对 `旧value+null` 求和（JS 中 5+null=5）并以 isDurationExtended 跳过刷新，限时效果无法被补丁改为无限，现要求两侧均为有限数值才延长。复验（14.368 实测）：pofang 底板+`{rounds:2}` 补丁→`{value:2,units:"rounds"}` 且真实可枚举键干净；限时→无限补丁生效；无限效果再施加有限时长不被缩短。**审阅复核（第三轮）修正**：seed-consumables 调用了 `normalizeLegacyChanges` 却缺 import（文件头无标记注释致上轮 sed 只插入调用未插入 import；`node --check` 查不出未定义引用，运行 seedConsumables 将在清空旧合集后报错）——已补 import，六个 seed 文件逐一做"调用/导入"配对检查，并以 node 直接 import seed-consumables 模块验证可加载
- [x] AE-03（S2.9）提供并验证 `game.xjzl.api.effects.getStatus(id)`：同步查询、未命中返回 `undefined`、命中返回可安全修改的 V14 格式副本；接口说明同步到 `SCRIPT_ENGINE.md`。这是 S4.2/S4.7 状态脚本迁移的前置。→ **已完成（14.368 实测）**：`ActiveEffectManager` 新增静态 `getStatus(id)`（`CONFIG.statusEffects[id]` 深拷贝，未命中返回 `undefined`），经 `game.xjzl.api.effects` 自动暴露；实测命中返回 V14 结构副本（id/name/img/showIcon/flags/system.changes，type 为字符串）、修改副本不污染 `CONFIG.statusEffects`、未命中返回 `undefined`。`SCRIPT_ENGINE.md` 已新增「查询状态定义」小节并注明脚本内不要直查 `CONFIG.statusEffects`
- [ ] AE-12（S2.7）建立 AE 世界迁移框架：独立 world setting 记录已完成版本；遍历 Actor/Item AE、世界物品和非关联 Token 合成 Actor；对旧结构与 `baseChanges` 做可重试转换，仅全部成功后推进版本。V13 备份样本和实际世界迁移验收归 AE-14，不阻塞 M2。
- [ ] AE-13（S2.2/S2.6/S5.2）核对 V14 `showIcon` 三态：默认 `CONDITIONAL` 只显示有临时时长的 AE；系统希望始终显示图标的通用状态明确设 `ALWAYS`，其他 AE 按现有可见性选择，避免永久状态图标消失。核对 `origin` 的 Document UUID、字符串 `type`/`phase` 与 `@` 值引用；只回归本系统实际用到的变更。`token.*` 变更与 `subtract` 是可选新能力，不作为迁移旧效果的前置。→ **进行中**：`config.mjs` 全部 63 个通用状态条目已显式 `showIcon: 2`（常显），实测经 `addEffect` 创建的特效携带 `showIcon:2` 且图标可见语义与 V13 一致；核心 `toggleStatusEffect`/HUD 路径由核心自动 `showIcon ??= ALWAYS` 无需处理。origin 与字符串 type/phase 核对已随 AE-01/AE-02 完成（实测 `type` 字符串、`phase` 默认 initial 生效）。剩余：装备被动等 Item 内嵌 AE 的图标显隐逐项核对（默认 CONDITIONAL 下永久被动图标是否需要显式 ALWAYS）归 M2 出口前的回归；`@` 引用只回归实际用到的变更归验收矩阵执行时

### B. 持续时间与架招

- [x] AE-04（S2.4）把添加、满层刷新、非叠层延长、手动时长修改、忍耐减免剧痛、颤手→缴械并卸武器、心火→走火入魔改用 `{value,units,expiry,expired}`。刷新重置顶层 `start`，同单位延长保持旧锚点；比较“更长”时考虑单位和事件，不沿用旧 `rounds*100+turns` 评分。角色/生物卡和状态选取器的剩余时长标签与 `promptEffectDuration` 同步迁移；保留 UI 的 `0=无限`。→ **代码完成并 API 实测（14.368）**：与 AE-02 同批实施（manager 内部时长读写强耦合，无法拆分）。添加/满层刷新重置顶层 `start`（`XJZLActiveEffect.getEffectStart()` 取当前世界时间与战斗位置，替代旧 startTime/startRound/startTurn 手写）并显式 `expired:false`；同单位延长仅累加 `duration.value` 保持旧锚点（实测 rounds 2+3=5 且 start 不变），不同单位交回比较逻辑整体刷新；`compareDurations`/`getDurationScore` 改按秒比较（rounds/turns 依 `CONFIG.time.roundTime` 折算、seconds 原值、日历单位经核心日历换算、不可折算视为无限）；忍耐减剧痛改读 `duration.units==="rounds" && value>0`、颤手/心火转化的缴械/走火入魔直接写 V14 结构；`promptEffectDuration` 读写 V14 结构、默认值取派生 `remaining`（排除无限 Infinity）、`0` 映射为 `{value:null, expiry:null}`（真无限，不写 0 回合）、锚点重置写顶层 `start`；角色/生物卡与选取器标签统一走 `getDurationLabel`（战斗内用核心派生 remaining，战斗外按秒回推回合）。实测：旧格式 `{rounds:2}` 入站后文档为 `{value:2,units:"rounds",expiry:"turnStart"}`；战斗外 5 回合标签显示 `10s`；永久特效标签为 null；全程无弃用警告。待验：忍耐>0 减回合与满层/转化的战斗内实机联调并入 AE-05/AE-06 与验收矩阵场景。**审阅复核（第二轮）修正三项**：①`promptEffectDuration` 默认值曾直接取派生 remaining——战斗外核心把回合时长折算为秒计时（实测 5 回合 remaining=10s），秒数填进"回合"输入框再保存会放大时长，现战斗外与秒制单位按 roundTime 回推回合数（复验弹窗默认显示 5 而非 10），战斗内回合/轮单位直接用 remaining；②同单位延长要求两侧均为有限数值（配合 AE-02 第③项修复限时改无限）；③`compareDurations` 在数值折算等长时增加到期事件排序（turnEnd 晚于 turnStart 到期，实测等值 turnEnd vs turnStart → 1、同 expiry → 0、短 turnEnd vs 长 turnStart → -1），不再让等值但更早到期的效果覆盖现有效果；其余事件对系统未用、视为等价。**审阅复核（第三轮）修正三项**：①到期事件排序曾只覆盖 turnEnd/turnStart，`expiry:null`（秒制归一化的产物）与 turnStart 被视为等价，等时长秒制效果仍可替换较晚到期的回合效果——改为全排序 `null < turnStart < turnEnd`（复验等值 6 秒：turnStart vs null → 1、null vs turnStart → -1、秒 vs 秒 → 0），`getDurationScore` 文档中"到期事件差异不影响比较"的旧注释同步修正为"事件排序见 compareDurations"；②`promptEffectDuration` 曾把战斗内剩余 N 轮的 turns 效果保存为 N rounds 改变到期语义——现保持原单位（弹窗标签同步显示"轮"，保存写 `units:"turns"`，复验输入 3 后 `{value:3,units:"turns",expiry:"turnStart"}`），单位判定回读 `_source` 兜底战斗外派生改写，rounds 效果回归仍为"(回合)"口径。**审阅复核（第四轮）修正**：上轮"战斗外核心把 turns 派生数据改写为秒制"的表述不准确——系统此前只设 `roundTime=2` 未设 `turnTime`（核心缺省 0），战斗外 turns 根本无法折算为秒，核心不走秒制改写而是给出 `secondsRemaining: Infinity`，后果是弹窗把 Infinity 填入输入框（确认时 parseInt→NaN→0，按"0=无限"语义把 1 回合效果误存为无限）、时长标签显示"Infinity 轮"（data/neigong/jiangjunying.json 确有 1 turn 效果）。修正：init 显式 `CONFIG.time.turnTime = 1`（轮次按 1 秒折算，战斗外核心可正常换算）；`getDurationScore` 的 turns 折算同步改用 turnTime（1 秒/轮次）；弹窗默认值与时长标签对非有限剩余量增加"回退总时长"防御，杜绝 Infinity 进入输入框或标签
- [ ] AE-05（S2.4/Q5）以 V14 registry + `expiryAction: "delete"` 作为首选清理方式；联调指定目标的 `turnStart`、战斗外每 2 秒一回合、跳回合和 GM 操作，确认不会重复删除或抛错后撤下旧 `updateCombat` 扫描。核心与回合脚本的先后只记录，不单独改调度；若全局 `expiryAction` 引起实际兼容问题，改用 `"update"` 加一个系统清理入口。保留 `cleanExpiredEffects(actor)` 公开兼容语义。
- [ ] AE-06（S2.4）保留并回归 `tiedToStance` 业务清理；验证同武学豁免依赖的 Item `origin`、架招切换/解除/被破除。拖放绑定 AE 时先确认来源与目标 Actor 当前使用同一架招，确认后复制，保留 flag、原 `origin`、`duration` 与 `start`，交由目标架招清理；不相同或无法确认就结束此次施加，不创建目标 AE，也不新增时长或解绑特例。

### C. 编辑器、拖放和状态选取器

- [ ] AE-07（S2.5）将 `XJZLActiveEffectConfig` 迁至 V14 ApplicationV2 的 `PARTS`/`TABS`/`actions`，保留核心 details/duration/changes 页签与 `showIcon`、`transfer`、`statuses`、新变更字段；加入“侠界配置”页，完整保留 slug、可叠层、最大层数、`tiedToStance`、脚本标签/时机/启停/代码、增删和变更 key 的 datalist。兼容对象形态的旧 scripts；验证跨页签未保存字段、物品/Actor 内嵌及合集包独立 AE 的保存与重开。
- [ ] AE-08（S2.10/S2.11）在武学、内功、装备、特性、身世、通用物品六类现有 AE 模板上，为可施加的 AE 行加入 V14 识别的 `.draggable`、`data-effect-id`；角色/生物卡的非物品被动 AE 行也使用核心拖拽。Item 内嵌 `transfer:true` 被动 AE 在物品页与 Actor 页均不可拖。角色卡接收 AE 走 `_onDropActiveEffect` → 门面，画布 Token 在 `dropCanvasData` 阶段拦截核心直建并走门面，均不得重复创建；Item 卡接收可拖 AE 仍复制模板。对 `tiedToStance` 施加先执行 AE-06 的双方架招判定，失败时中止而不触发叠层、脚本、飘字或聊天。检查角色卡现有 Item 拖拽监听不吞 AE 事件。用临时独立 AE 合集包验证原生打开、编辑、拖放，不建立正式 AE 包；覆盖绑定 AE 的同架招成功、异架招/无架招/无来源失败，成功时 flag/origin/start/duration 保留，以及独立 AE 不按 `transfer` 误挡、权限、合成 Actor 与来源名回退。
- [ ] AE-09（S2.8）状态选取器继续以 `CONFIG.statusEffects` 展示标准状态，并保留场上物品 AE；回归分类计数、搜索、最近、收藏、已生效态、左右键叠层/时长、撤除、受控/瞄准目标和多目标。同步回归 TokenHUD 点击、overlay 与 `actor.statuses` 判断；更新旧 `duration.rounds` 读取。**不新增必须维护的合集包 AE 分类**。

### D. 源数据、合集包与世界迁移（与 M4 共用工作项，不因 M2 完成而提前勾选）

- [ ] AE-10（S4.1/S4.2/S4.6，及 S4.8 的 AE 相关脚本审计）按 AE 对象结构遍历 `data/**/*.json`：`changes→system.changes`、数字 `mode→type`、`icon→img`、duration、`origin`、`showIcon` 的实际需要；按脚本字段和变量来源迁移动态构造、`effect.changes`、状态查询和时长读取。既有约 500 处 `CONFIG.statusEffects.find`、98 处 AE `.changes` 只是检索基线，需按谓词/变量来源分类并补查其他别名。检查 `module/config.mjs` 的通用状态模板；不对整个 JSON 文件盲目替换。同步更新 `SCRIPT_ENGINE.md` 中旧时长和状态 API 示例，并按录入格式变化更新 `SEEDING_GUIDELINES.md`。→ **M2 期间实测盘点基线（2026-09-24，供实施时对照）**：data/ 共 1815 处 `addEffect` 调用（660 处带内联 `duration:{rounds}`），全部经门面、由归一化承接，**无需迁移**；需迁移的是约 101 处旧文档路径读取（`effect.changes`、`thisEffect.duration.rounds` 等，含 `eff.changes` 别名）与约 478 处 `CONFIG.statusEffects` 直查（改 `getStatus`）；未发现绕过门面直建 AE 的调用（无 `createEmbeddedDocuments("ActiveEffect")`/`new ActiveEffect`/`ActiveEffect.create`）
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
