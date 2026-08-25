# 脚本引擎手册

本手册面向物品、招式、特性和 Active Effect（AE）脚本作者，描述当前系统公开的脚本契约。本手册只描述运行时脚本契约；源数据录入还需遵循项目内部的录入规范。下文明确列出的上下文字段、可写字段和公共方法才是可依赖接口，未列出的内部变量不要作为 API 使用。

## 事实源与兼容边界

文档与代码不一致时，以以下实现为准：

- 触发器和脚本字段：`module/data/common.mjs`（`SCRIPT_TRIGGERS`、`TRIGGER_CHOICES`、`makeScriptEffectSchema`）
- 脚本来源、执行顺序和沙盒：`module/documents/actor.mjs`
- 招式前置流程：`module/documents/item.mjs`
- 攻击卡、治疗卡和命中后流程：`module/managers/chat-manager.mjs`
- 宏工具：`module/utils/macros.mjs`
- 状态与枚举：`module/config.mjs`

`scripts` 中的代码是受系统注入变量约束的 JavaScript 字符串，不是安全隔离的权限沙盒。只运行可信数据中的脚本。

## 快速开始

脚本条目由四个字段组成：

```json
{
  "label": "命中施加点穴",
  "trigger": "hit",
  "script": "if (!args.isHit) return;\nawait game.xjzl.api.effects.addEffect(args.target, 'dianxue');",
  "active": true
}
```

| 字段 | 类型/默认值 | 说明 |
|---|---|---|
| `label` | `string`，默认“新特效” | 管理和报错时显示的名称。 |
| `trigger` | `string`，默认 `passive` | 必须是下文列出的触发器。 |
| `script` | `string`，默认空字符串 | JavaScript 源码；可信数据才可以执行。 |
| `active` | `boolean`，默认 `true` | 是否参与收集和执行。 |

- 武器、防具、奇珍和特性的脚本位于 `system.scripts`。
- 武学脚本位于具体招式的 `system.moves[].scripts`。
- 内功脚本位于阶段配置中，运行时读取 `system.current.scripts`。
- AE 脚本位于 `flags.xjzl-system.scripts`。

`trigger` 必须来自 `module/data/common.mjs#SCRIPT_TRIGGERS`。Item、招式和内功脚本受 Schema 选项约束；AE 脚本虽然存放在普通 flags 中，标准编辑界面也只提供这些选项。未知触发器不会被系统的标准流程调用，不应写入任何脚本来源。

## 执行模型

### 同步与异步

`passive` 和 `calc` 同步执行，因为它们参与派生数据和面板计算。同步脚本禁止使用 `await`、Dialog、文档写入以及任何依赖稍后完成的 Promise。角色卡预览、重开角色卡和数据刷新都可能重复触发这些计算；同步脚本必须无持久化副作用，并且不能把面板计算当成“一次出招”事件。

其余触发器异步串行执行。异步脚本中的文档写入、伤害、治疗、状态和宏调用都应 `await`。

同步脚本异常会写入控制台；异步脚本异常还会向操作者显示错误通知。单个脚本失败不会回滚此前脚本或数据库操作。

### 脚本来源与生效范围

`XJZLActor.collectScripts()` 按以下来源收集并依次执行：

1. 当前激活内功的当前阶段脚本。
2. 已装备的武器、防具和奇珍脚本；`ignoreArmorEffects` 会屏蔽头、衣、裤、鞋部位的防具脚本。
3. Actor 拥有的全部特性脚本。
4. 当前已开启架招的后台脚本，但仅响应架招白名单。
5. `passive` 时，已领悟轻功、散手和阵法招式的被动脚本。
6. 当前上下文招式的脚本。
7. 当前生效 AE 的脚本。
8. `combatStart`、`turnStart`、`turnEnd` 时，全部已领悟武学招式的对应脚本。

当前实现按收集顺序串行执行，并共享本次触发的 `args` 对象。可以在同一业务的一组脚本中写入事件标记，但不要让不同物品暗中依赖彼此的执行顺序。

“已领悟招式”指 `move.computedLevel > 0`。第 5、8 类是额外的武学遍历规则，不影响内功、装备、特性和 AE 等通用来源。

### 架招后台白名单

架招被主动开启时，它作为当前招式参与 `preAttack` 和 `attack`，随后直接进入架招开启分支，不执行 `check`、`hit`、`hit_once`。架招强度在专用面板分支中提前返回，因此架招自身的 `calc` 也不会执行。开启后作为后台状态时，只收集以下触发器：

`passive`、`avoided`、`preDefense`、`preTake`、`damaged`、`dying`、`death`、`resourceChanged`。

因此，“开启架招后增强后续攻击”不能只写在架招的 `attack` 脚本中；应使用 `passive` 修改派生值，或在开启时添加 `tiedToStance` AE。

## 注入变量

以下变量始终注入：

| 变量 | 含义 |
|---|---|
| `actor` | 当前执行脚本的宿主 Actor。攻击侧触发器通常是攻击者，防御侧触发器是受击者。 |
| `system` / `S` | `actor.system` 的同一引用。 |
| `args` | 本次触发的上下文对象；脚本修改其中约定的可写字段来影响后续流程。 |
| `trigger` | 当前触发器字符串。 |
| `thisItem` | 当前脚本来源。Item 脚本指向 Item；AE 脚本为了兼容也指向该 AE。 |
| `thisEffect` | 当前脚本来自 AE 时指向该 AE，否则为 `null`。 |
| `Macros` | `XJZLMacros` 公共工具类。 |
| `game`、`ui`、`console` | Foundry 游戏对象、通知对象和控制台。 |

脚本仍运行在 Foundry 客户端环境中，因此也能访问 `foundry`、`canvas`、`CONFIG`、`CONST`、`ChatMessage`、`Roll`、`fromUuid` 等 V13 全局对象。它们属于 Foundry API，不是脚本引擎额外封装；使用前仍要检查当前场景、画布或文档是否存在。

触发开始时已有的 `args` 字段也会展开成同名顶层变量，但只有对应触发器实际传入的字段才存在。脚本运行中新增的 `args.myFlag` 不会自动生成新的顶层变量。推荐业务代码始终从 `args` 读取条件字段，并对 `args.target`、`args.attacker`、`args.move`、`args.item` 做空值检查。

同一次触发收集到的脚本共享同一个 `args` 引用；修改文档或公共 API 时使用 `await`，修改上下文标记时使用命名空间明确的字段，避免与其他脚本冲突。

除非触发器参考明确标为可写，否则上下文字段按只读处理。对于 `args.output`、`args.config`、`args.costConfig`、`args.flags` 等可写容器，应修改其中约定的属性，不要替换整个对象；许多调用流程会继续持有原对象引用。`args.baseData`、`args.outcome` 等“只读”对象当前没有冻结，但修改它们不属于公开契约，也不保证影响结算。

后台武学或架招脚本会按来源临时注入 `args.move` 和顶层 `move`，脚本结束后恢复原值。这只用于标识脚本所属招式，不代表角色正在出招；只有 `preAttack`、`attack`、`check`、`preDamage`、`hit`、`hit_once` 属于主动招式资源溯源阶段。

## 触发流程

一次普通角色的常规攻击大致按以下顺序运行：

```text
passive / calc（派生值与面板）
  → preAttack（余额检查和扣费前）
  → 扣除资源，派发 resourceChanged
  → attack（基础面板已计算，掷骰前）
  → check（逐目标修正）
  → 确定命中、暴击、破架
  → preDamage（攻击者逐目标修改伤害配置，仅命中时）
  → 目标 applyDamage：avoided 或 preDefense → preTake → 扣资源
  → dying / death → damaged → resourceChanged
  → hit（攻击者逐目标后效，未命中也执行）
  → hit_once（整次招式后效）
```

治疗和 Buff 招式同样执行 `attack`、`check`、`hit`、`hit_once`，但 `hit` 会提供兼容字段：`actionType` 为 `heal` 或 `buff`，`damageType/type` 为 `none`，并把它们视为命中、非暴击、未破架。

`creature` 使用独立的体力伤害分支，不经过上述标准防御触发链；具体边界见“公共结算 API → 伤害”。`container` 不参与脚本、伤害或治疗生命周期。

### 如何选择触发器

| 需求 | 优先使用 |
|---|---|
| 来源生效期间修改角色卡派生值或系统状态标记 | `passive` |
| 修改当前招式或普攻的面板伤害、虚招值和说明 | `calc` |
| 扣费前调整消耗或阻止出招 | `preAttack` |
| 修改本次动作的全局命中参数，或逐目标修改检定参数 | `attack` / `check` |
| 攻击者在逐目标伤害应用前修改伤害类型、数值或穿透 | `preDamage` |
| 防御者在减伤前修改防御配置，或在减伤后修改最终伤害 | `preDefense` / `preTake` |
| 防御者响应未命中，或阻止濒死/死亡状态 | `avoided` / `dying` / `death` |
| 攻击者处理逐目标后效或整次动作后效 | `hit` / `hit_once` |
| 防御者在资源提交后处理受击后效 | `damaged` |
| 只关心资源的数据库实际差值 | `resourceChanged` |
| 处理进战、回合开始或回合结束 | `combatStart` / `turnStart` / `turnEnd` |

## 触发器参考

### 派生值与面板

| 触发器 | 时机 | 主要上下文和可写字段 |
|---|---|---|
| `passive` | 第一遍基础派生值和状态 flags 解析完成后，第二遍重算前 | 没有面板 `output`；修改 `system` 中供重算使用的临时派生输入/修正字段，或修改 `actor.xjzlStatuses`。随后执行 `system.recalculate()`。 |
| `calc` | 支持该流程的招式或普攻面板计算时 | 读取 `args.move`、`args.item`、只读 `args.baseData`；修改 `args.output.damage`、`args.output.feint`、`args.output.bonusDesc`、`args.output.feintBonusDesc`。 |

#### `passive` 范围与示例

对于武学招式来源，`passive` 会收集当前已开启架招，以及已领悟的轻功、散手和阵法招式；其他类别的武学招式只有作为当前架招时才会被收集。当前内功、已装备物品、特性和 AE 仍按前述通用规则参与。

`passive` 应修改会被第二遍 `recalculate()` 消费的修正字段，而不是写入 `args.output`。例如，根据第一遍计算得到的内息增加招式伤害派生修正：

```javascript
const bonus = Math.floor(Math.max(0, S.stats.neixi.total) / 20);
S.combat.damages.skill.mod += bonus;
```

`actor.xjzlStatuses` 位于 Actor Document 上，不在 `system` DataModel 内。需要设置系统状态标记时必须写 `actor.xjzlStatuses.someFlag`，不能写 `S.xjzlStatuses`。

#### `calc` 范围与示例

以下代码是 `calc` 示例：它只增加当前面板的伤害，并把说明追加到伤害详情中。

```javascript
const bonus = Math.max(0, S.stats.neixi.total);
args.output.damage += bonus;
args.output.bonusDesc.push(`内息加成 +${bonus}`);
```

`calc` 的面板执行边界如下：

- 架招：使用专用强度计算并提前返回，不执行 `calc`。
- 常规有系数招式：按通用来源顺序收集 `calc`，包括当前内功、装备、特性、当前招式和 AE。
- 无系数且 `move.calculation.isFixed` 为 `true`：只执行当前招式自身的 `calc`；内功、装备、特性和 AE 的全局 `calc` 不参与。
- 无系数且 `isFixed` 不为 `true`：直接按固定值返回，不执行 `calc`。

普攻会执行通用 `calc`。`args.baseData` 的稳定字段为 `base`、`weapon`、`isWeaponMatch`；招式面板另有 `level`，普攻面板另有 `rank`。它是参考快照，修改它不会直接改变最终结果。

### 出招与检定

| 触发器 | 时机 | 主要上下文和可写字段 |
|---|---|---|
| `preAttack` | 计算基础消耗后、余额检查和扣除前 | 读取 `args.move`、`args.item`、`args.attacker`；修改 `args.costConfig.mp`、`args.costConfig.hp`、`args.costConfig.rage`、`args.abort`、`args.abortReason`。 |
| `attack` | 已扣资源、基础面板已计算、掷骰前 | 读取 `args.actionType`、`args.damageType`、`args.type`、`args.element`、`args.costConsumed`；修改 `args.flags` 的约定字段。 |
| `check` | 对每个目标计算命中/虚招上下文时 | 读取 `args.target`、`args.attacker`、`args.item`、`args.move`；修改目标专属 `args.flags`。 |

`attack` 的主要 `flags`：

| 字段 | 作用 |
|---|---|
| `level` / `feintLevel` | 本次命中/虚招优劣势计数。正数为优势，负数为劣势。 |
| `bonusHit` / `bonusFeint` | 本次命中值/虚招值加成。 |
| `critThresholdMod` | 暴击阈值修正，正数表示更容易暴击。 |
| `forceHit` | 跳过投掷的必中。 |
| `alwaysHit` | 仍投掷、仍可暴击的必定命中。 |
| `damageResult` | 当前面板结果，可修改 `damage`、`feint`、`breakdown` 和 `feintBreakdown`。 |
| `abort` / `abortReason` | 中止出招及操作者提示。资源和动作已在 `attack` 前消耗，脚本如需退款或返还动作必须显式处理。 |

`check` 的主要 `flags`：`grantLevel`、`grantFeintLevel`、`grantHit`、`grantFeint`、`critThresholdMod`、`ignoreBlock`、`ignoreDefense`、`ignoreStance`、`forceHit`、`alwaysHit`。

`preAttack` 的完整上下文是 `move`、`item`、`attacker`、`costConfig`、`abort`、`abortReason`；`args.abort = true` 会在扣费前阻止出招。普通攻击没有资源消耗前置流程，因此不会触发 `preAttack`。`attack` 还提供 `args.flags.autoApplied`；`args.flags.damageResult` 可修改当前面板结果。

### 攻击者结算

| 触发器 | 时机 | 主要上下文和可写字段 |
|---|---|---|
| `preDamage` | 命中、暴击和破架确定后，调用目标 `applyDamage()` 前 | 读取 `args.attacker`、`args.target`、`args.item`、`args.move`、`args.element` 和只读 `args.outcome`；修改 `args.config.amount`、`args.config.type`、`args.config.element`、`args.config.ignoreBlock`、`args.config.ignoreDefense`、`args.config.ignoreStance`、`args.config.applyCritDamage`、`args.config.ignoreMinDamage`。手动结算另有 `args.isManual`。 |
| `hit` | 每个目标结算后；攻击未命中时也执行 | 攻击提供 `args.attacker`、`args.target`、`args.item`、`args.move`、`args.actionType`、`args.damageType`、`args.type`、`args.element`、`args.isHit`、`args.isCrit`、`args.isBroken`、`args.finalDamage`、`args.hpLost`、`args.mpLost`、`args.hutiLost`、`args.isDying`、`args.isDead`；手动结算另有 `args.isManual`。治疗/Buff 另有 `args.baseAmount`、`args.finalAmount`、`args.healAmount`、`args.isHeal`、`args.isBuff`、`args.isBuffOnly`。 |
| `hit_once` | 全部目标完成后执行一次 | 通用字段为 `args.targets`、`args.hitCount`、`args.attacker`、`args.item`、`args.move`、`args.actionType`。攻击另有 `args.baseDamage`、`args.damageType`、`args.type`、`args.element`；自动攻击和治疗/Buff 提供 `args.costConsumed`；自动攻击另有 `args.hasCrit`，治疗/Buff 另有 `args.totalHealAmount`；手动攻击另有 `args.isManual`。 |

攻击 `hit` 和 `hit_once` 的 `damageType/type/element` 保留招式或卡片的原始值。如果 `preDamage` 改写了单个目标的 `args.config.type` 或 `args.config.element`，这些后效字段不会同步改写。防御侧需要最终值时可读取 `preTake`、`damaged` 或 `resourceChanged` 的具体结算上下文。

攻击侧 `hit` 和 `hit_once.targets[].isCrit` 保留攻击方判定出的暴击状态；如果目标的 `preDefense` 后续修改了 `args.config.isCrit`，最终防御侧暴击状态应从目标的 `damaged` 上下文读取。

`hit_once.targets` 的元素结构取决于动作类型：

- 攻击：每项包含 `target`、`isHit`、`isCrit`、`isBroken`、`baseDamage`、`finalDamage`、`hpLost`、`hutiLost`、`mpLost`、`isDying`、`isDead` 和原始 `damageResult`。
- 治疗/Buff：每项包含 `name`、`amount`、`baseAmount`、`isHeal`、`isBlocked`。当前汇总项不包含目标 Actor；需要逐目标 Actor 时在 `hit` 中处理。

未命中、免疫、容器或其他提前返回路径可能只提供部分伤害结果字段。读取损失值时使用 `args.hpLost ?? 0` 等空值兜底。

### 防御者结算

| 触发器 | 时机 | 主要上下文和可写字段 |
|---|---|---|
| `avoided` | 标准 `applyDamage()` 收到 `isHit: false` 时 | 读取 `args.attacker`、`args.target`、`args.type`、`args.baseDamage`、`args.move`、`args.item` 和只读 `args.outcome`。 |
| `preDefense` | 命中后、暴击倍率和防御/格挡/抗性计算前 | 修改 `args.config.ignoreBlock`、`args.config.ignoreDefense`、`args.config.ignoreStance`、`args.config.isCrit`、`args.config.applyCritDamage`、`args.config.element`。 |
| `preTake` | 防御和抗性完成后、资源扣除前 | 读取 `args.baseDamage`、`args.calcDamage`；修改 `args.output.damage`，或设置 `args.output.abort = true` 完全免疫。 |
| `dying` | 首次进入濒死，或 `source` 为 `move/basic/both` 的攻击继续伤害已濒死目标时 | 读取 `args.attacker`、`args.target`、`args.damage`；设置 `args.preventDying = true`。 |
| `death` | 死亡条件成立、挂死亡状态前 | 与 `dying` 共享上下文；设置 `args.preventDeath = true`。 |
| `damaged` | 资源已提交且濒死/死亡判定完成后 | 读取 `args.finalDamage`、`args.hpLost`、`args.mpLost`、`args.hutiLost`、`args.isCrit`、`args.isBroken`、`args.isDying`、`args.isDead`、`args.config`。适合反伤和受击后效。 |

`hpLost`、`mpLost`、`hutiLost` 是标准伤害部分的实际损失。`finalDamage` 是进入资源分配前的最终伤害值，两者含义不同。

`preventDying` 和 `preventDeath` 只阻止本次各自对应的状态处理，不会自动撤销已经提交的资源损失，也不会移除目标原本已有的濒死状态。`preventDying` 不等于 `preventDeath`；如果死亡条件同时成立，`death` 仍会继续执行。脚本如果还需要恢复气血、内力或移除既有状态，必须显式调用相应公共 API。以上标准防御触发器不适用于 `creature` 的体力伤害分支。

### 资源实际变动

`resourceChanged` 在数据库提交并完成上限或禁疗等裁剪后触发。支持 `hp`、`mp`、`rage`、`huti`、`tili`、`morale`；银两和休息次数不触发。

普通角色实际跟踪 `hp`、`mp`、`rage`、`huti`、`morale`；`creature` 实际跟踪 `tili`、`rage`。只有该 Actor 持久化且适用的资源会出现在事件中。

| 字段 | 含义 |
|---|---|
| `changes` | 本次事务的变化数组。每项包含 `resource`、`path`、`oldValue`、`newValue`、`delta`。 |
| `byResource` | 按资源名索引的同一批变化，例如 `args.byResource.hp.delta`。 |
| `cause` | 来源类别；未提供时为 `update`。 |
| `sourceActor`、`attacker`、`healer`、`target`、`item`、`move`、`source` | 调用链能够确定时提供的溯源信息。 |
| `chainId` / `depth` | 连锁资源事务标识和当前深度。 |

没有实际差值时不触发。脚本再次修改资源会继承 `chainId`；允许的 `depth` 为 `0..7`，准备进入深度 `8` 时终止派发。业务脚本仍必须通过来源标记或其他条件自行防循环。

```javascript
const hp = args.byResource?.hp;
if (!hp || hp.delta <= 0 || args.source === "double-heal") return;

await actor.applyHealing({
  amount: hp.delta,
  type: "hp",
  healer: args.healer || actor,
  item: args.item,
  move: args.move,
  source: "double-heal"
});
```

伤害与治疗为了保持后效顺序，会先完成 `dying/death/damaged` 或治疗统计，再派发对应的 `resourceChanged`。

### 战斗与回合

| 触发器 | 时机 | 上下文 |
|---|---|---|
| `combatStart` | 战斗开始时，每个 Combatant 执行一次 | `args.combatant`、`args.combat`。 |
| `turnStart` | Actor 回合开始，自动回复/消耗完成后 | 当前没有额外业务字段。 |
| `turnEnd` | Actor 回合结束，自动回复/消耗完成后 | 当前没有额外业务字段。 |

这三个触发器会遍历该 Actor 全部已领悟武学招式；每个招式脚本执行时仍会临时注入所属 `args.move`。执行由活动 GM 统筹并路由给在线 owner，无在线玩家 owner 时由 GM 执行；脚本不要自行假设执行客户端一定是 GM。

## 公共结算 API

### 伤害

```javascript
const result = await args.target.applyDamage({
  amount: 20,
  type: "poison",
  attacker: actor,
  isHit: true,
  item: args.item,
  move: args.move,
  source: "extra"
});
```

| 参数 | 类型/默认值 | 说明 |
|---|---|---|
| `amount` | `number` | 原始面板伤害。 |
| `type` | `string`，默认 `waigong` | 伤害类型；以 `CONFIG.XJZL.damageTypes` 为准。 |
| `element` | `string`，默认 `none` | 伤害属性。 |
| `attacker` | `Actor`，默认 `null` | 攻击来源；能确定时应传入。 |
| `isHit` / `isCrit` / `isBroken` | `boolean`，默认 `true` / `false` / `false` | 命中、暴击和破防状态。普通角色未命中时只触发防御侧 `avoided`；`creature` 例外见下文。 |
| `applyCritDamage` | `boolean`，默认 `true` | 是否应用暴击倍率；不影响 `isCrit` 标记。 |
| `ignoreBlock` / `ignoreDefense` / `ignoreStance` / `ignoreMinDamage` | `boolean`，默认 `false` | 穿透格挡、防御、架招和最低 1 点伤害。 |
| `targetKanpo` | `number`，默认 `0` | 战斗统计使用的看破值。 |
| `isSkill` | `boolean`，默认 `true` | 是否按招式伤害计入技能抗性。 |
| `move` / `item` | `Object` / `Item`，默认 `null` | 资源溯源上下文。 |
| `source` | `string`，默认 `extra` | 常用值：`move`、`basic`、`both`、`dot`、`extra`；影响部分后效。 |

返回 `Promise<object>`，普通角色的常规结果包含 `finalDamage`、`hpLost`、`hutiLost`、`mpLost`、`tiliLost`、`isDying`、`isDead`、`rageGained`、`isHit`；未命中、免疫或其他提前返回路径可能只返回部分字段。容器 Actor 不受伤害，只返回 `{ finalDamage: 0 }`。

`creature` 使用独立体力结算：伤害超过防护后扣除 `system.resources.tili.value`，可触发 `resourceChanged` 并在体力归零时直接添加死亡状态；它不执行 `avoided`、`preDefense`、`preTake`、`dying`、`death`、`damaged`。返回结果以 `tiliLost` 为主要实际损失字段。需要让野兽响应这些标准防御触发器时，必须先扩展代码流程，不能只添加脚本数据。

伤害类型以 `CONFIG.XJZL.damageTypes` 为准。环境伤害可以把 `attacker` 设为 `null`；能确定来源时必须传入，以保留统计和反伤语义。

`source` 还影响部分标准角色后效：`move`、`basic`、`both`、`dot` 会参与易伤/流失附加伤害，`extra` 不参与；对已经濒死的目标继续触发 `dying` 只接受 `move`、`basic`、`both`。需要这些语义时使用约定值，不要随意自创新字符串替代它们。

### 治疗与直接资源增减

```javascript
const result = await args.target.applyHealing({
  amount: 15,
  type: "mp",
  healer: actor,
  showScrolling: true,
  item: args.item,
  move: args.move,
  source: "move"
});
```

| 参数 | 类型/默认值 | 说明 |
|---|---|---|
| `amount` | `number`，默认 `0` | 正数恢复，负数直接流失，`0` 不产生变化。 |
| `type` | `string`，默认 `hp` | `hp`、`mp`/`neili`、`huti`、`tili`、`rage`。 |
| `showScrolling` | `boolean`，默认 `true` | 是否显示飘字。 |
| `healer` | `Actor` 或 `null`，默认当前目标 Actor | 治疗/流失来源，用于溯源和统计。跨 Actor 治疗时应显式传入脚本宿主，例如 `healer: actor`。 |
| `move` / `item` | `Object` / `Item`，默认 `null` | 显式参数优先；如果 `healer`（未传时为目标）当前正在执行动作脚本，则从其脚本栈继承。 |
| `source` | `string`，默认 `extra` | 显式值优先；同一脚本栈能够确定主动招式来源时可继承为 `move`。 |

常规返回 `Promise<object>`，包含 `actualHeal`、`type`、`oldVal`、`newVal`、`overflow`、`isBlocked`。正向治疗可能受满值、禁疗或上限影响；负数是直接资源流失。`amount: 0`、容器或部分不适用资源的安全返回可能只包含 `actualHeal` 等少数字段，调用方应对可选字段做空值处理。

负数 `applyHealing` 是直接资源事务，不经过防御、抗性、护体分配，也不触发 `avoided`、`preDefense`、`preTake`、`dying`、`death`、`damaged`。即使负数气血变化把目标降到 `0`，它也不会自动执行濒死/死亡流程；需要标准致伤和濒死语义时应使用 `applyDamage`。

跨 Actor 调用如果省略 `healer`，系统无法从 JavaScript 方法调用本身推断调用者，会把目标 Actor 当作来源。为了保留正确的统计、权限代理和 `resourceChanged` 溯源，攻击者、治疗者或 Buff 宿主已知时必须显式传入。

### 资源事务

需要设置绝对值或一次修改多个资源时使用：

```javascript
await actor.changeResources({
  "system.resources.rage.value": 0,
  "system.resources.mp.value": nextMp
}, {
  cause: "script",
  sourceActor: actor,
  item: args.item,
  move: args.move,
  source: "my-effect"
});
```

`changeResources(updates, context)` 的 `updates` 是 Foundry 更新路径到绝对值的对象；`context` 可包含 `cause`、`sourceActor`、`attacker`、`healer`、`target`、`item`、`move`、`source`。返回底层 Actor 更新结果。它会串行提交同一 Actor 的事务，并按实际差值派发 `resourceChanged`；不要用它模拟需要防御、抗性、护体、禁疗或统计语义的正常伤害/治疗。

这 6 类资源字段——`system.resources.hp.value`、`system.resources.mp.value`、`system.resources.rage.value`、`system.resources.huti`（旧世界兼容 `system.resources.huti.value`）、`system.resources.tili.value`、`system.resources.morale.value`——在脚本中必须通过 `changeResources`（或语义匹配的 `applyDamage` / `applyHealing`）写入，不要直接 `actor.update()` / `args.target.update()` 修改这些路径。直接 `update` 只有兼容兜底，新脚本统一使用资源事务入口，以保留非 owner 的 GM socket 委托和按实际差值触发的 `resourceChanged` 语义。

### 资源事务错误

`changeResources`、`applyDamage`、`applyHealing` 及其跨权限代理在资源事务失败时可能抛出 `XJZLResourceCommitError`。该错误包含 `committed`、`phase`、`cause`、`actorUuid`、`resourceChanges` 和 `originalError`，用于判断能否安全重试：

- `committed: true`：数据库主更新已经提交，禁止自动重试，否则会造成二次伤害、治疗或重复资源变动。
- `committed: false`：已确认主更新未提交，可以按业务规则重试。
- `committed: "unknown"`：无法确认是否提交，默认禁止自动重试；需要人工核对 Actor 当前值后再决定。
- `phase` 标识失败阶段，例如 `database` 或 `resourceIntegrity`。
- `resourceChanges` 为 `null` 表示失败时未能可靠计算变化数组；它不能用于判断资源是否已经变更。

单个 `resourceChanged` 脚本错误仍由脚本执行器隔离并记录，不会抛出为 `XJZLResourceCommitError`。

## 状态 API

### 添加和移除

```javascript
await game.xjzl.api.effects.addEffect(args.target, "prone");
await game.xjzl.api.effects.removeEffect(args.target, "prone", 1);
```

`addEffect(actor, effectDataOrId, count = 1)` 接受系统状态 ID 或 AE 数据，负责权限委托、本地化、slug 匹配、叠层和刷新，返回 `Promise<ActiveEffect|undefined>`。`removeEffect(actor, effectIdOrSlug, amount = 1)` 按文档 ID 或 slug 移除/减层；成功删除时返回删除结果，减层时通常返回 `undefined`。

从来源 Item 复制 AE 时先转为普通对象并清除 `_id`：

```javascript
const effectData = thisItem.effects.getName("中毒").toObject();
delete effectData._id;
effectData.origin = thisItem.uuid;
await game.xjzl.api.effects.addEffect(args.target, effectData);
```

需要随架招解除的效果设置：

```json
{
  "flags": {
    "xjzl-system": {
      "slug": "wuxue_example_guard",
      "tiedToStance": true
    }
  }
}
```

解除架招使用 `await actor.stopStance()`，以同时清理绑定效果。

### 状态 flags

完整有效键以 `module/config.mjs#XJZL.statusFlags` 和 `#XJZL.checkFlags` 为准。常见分组如下：

- 优劣势：`attackLevel`、`grantAttackLevel`、`feintLevel`、`defendFeintLevel`、`globalCheckLevel`、`<属性或技能>CheckLevel`。
- 资源封锁：`noRecoverRage`、`noRecoverNeili`、`noRecoverHP`、`noRageOnHit`。
- 行为限制：`blockShiZhao`、`blockXuZhao`、`blockQiZhao`、`blockCounter`、`blockUltimate`、`blockStance`、`forceUnarmed`、`silence`、`stun`。
- 穿透与防御：`ignoreBlock`、`ignoreDefense`、`ignoreStance`、`passiveBlock`、`brokenDefense`、`ignoreArmorEffects`。
- 自动资源变化：`regenHp/Mp/Rage` 加 `TurnStart`、`TurnEnd` 或 `Attack` 后缀。

数值计数器通常使用 AE mode `2`（`CONST.ACTIVE_EFFECT_MODES.ADD`）；布尔覆盖通常使用 mode `5`（`CONST.ACTIVE_EFFECT_MODES.OVERRIDE`）。新增键必须先进入 `CONFIG.XJZL.statusFlags`，不能只在数据中自创系统状态键。

## Macros API

### 单向检定

```javascript
await Macros.requestSave({
  target: args.target,
  attacker: actor,
  type: "tipo",
  dc: 15,
  label: "抵抗点穴",
  onFail: "dianxue",
  failureText: "体魄检定失败，陷入点穴。"
});
```

`requestSave(options)` 的参数：

| 参数 | 类型/默认值 | 说明 |
|---|---|---|
| `target` | `Actor`，必填 | 接受检定的目标。 |
| `type` | `string`，必填 | 属性、技能、技艺或武器类型键。 |
| `dc` | `number`，必填 | 难度；调用方应传入有效数值。 |
| `attacker` / `label` | `Actor` / `string`，可选 | 来源 Actor 和卡片标题。 |
| `level` / `bonus` | `number`，默认 `0` | 临时优劣势层级和数值修正。 |
| `onSuccess` / `onFail` | 状态 ID、AE 数据或数组，可选 | 结果状态；不能传函数，函数会被忽略并警告。 |
| `damageOnSuccess` / `damageOnFail` | `{ value, type }`，可选 | `value` 使用正数；伤害类型走标准 `applyDamage` 并保留防御/抗性，资源类型走负数 `applyHealing` 直接流失。 |
| `successText` / `failureText` | `string`，可选 | 结果说明。 |
| `removeStanceOnSuccess` / `removeStanceOnFail` | `boolean`，默认 `false` | 对应结果出现时解除检定者架招。 |

返回创建聊天卡片的 `Promise<ChatMessage>`。结果执行顺序为：状态 → 伤害或资源变化 → 解除架招。

### 双方对抗

```javascript
await Macros.requestContest({
  attacker: actor,
  defender: args.target,
  type: "neixi",
  defType: "dingli",
  label: "内息压制",
  outcome: {
    win: { text: "压制成功。", targetEffect: "qixu" },
    lose: { text: "对方抵住了压制。", selfDamage: { value: 10, type: "mp" } }
  }
});
```

`requestContest(options)` 中 `attacker`、`defender`、`type` 必填；`defType` 默认等于 `type`，`attBonus`/`defBonus` 默认 `0`。`outcome.win/lose` 从发起者视角定义，单独传入的 `winText`/`loseText` 会覆盖对应 `outcome` 文本。

| `outcome.win/lose` 字段 | 类型与作用 |
|---|---|
| `text` | 结果说明字符串。 |
| `selfEffect` / `targetEffect` | 单个状态 ID 或 AE 数据对象。当前对抗助手不支持数组；需要多个状态时应由其他脚本逐个调用状态 API。 |
| `selfRecovery` | `{ value, type }`；给发起者恢复资源，`type` 应为 `applyHealing` 支持的资源类型。 |
| `targetDamage` / `selfDamage` | `{ value, type }`；伤害类型走 `applyDamage`，无视格挡、架招和基础防御但保留抗性；资源类型走负数 `applyHealing` 直接流失。 |

自动化执行顺序为：发起者状态 → 对抗者状态 → 发起者恢复 → 对抗者伤害/流失 → 发起者反噬。返回创建聊天卡片的 `Promise<ChatMessage>`，平局判发起者获胜。

### 架招判断

```javascript
if (!Macros.checkStance(actor, args)) return;
```

`checkStance()` 要求架招已开启、攻击未被判定为闪避、伤害类型为 `waigong` 或 `neigong`，且 `args.config.ignoreStance` 不为真。适用于 `preTake`、`damaged` 等防御侧脚本。

## 常用安全模式

### 反伤

```javascript
if (!Macros.checkStance(actor, args)) return;
if (!args.attacker || args.attacker.uuid === actor.uuid) return;
if (actor.isReceivingReflection) return;

const defenderToken = actor.token?.object || actor.getActiveTokens()[0];
const attackerToken = args.attacker.token?.object || args.attacker.getActiveTokens()[0];
if (!defenderToken || !attackerToken) {
  return ui.notifications.warn("无法检测反伤距离，请手动处理。");
}

const distance = canvas.grid.measurePath([defenderToken.center, attackerToken.center]).distance;
if (distance > 1.1) return;

args.attacker.isReceivingReflection = true;
try {
  await args.attacker.applyDamage({
    amount: 10,
    type: "liushi",
    attacker: actor,
    isHit: true,
    source: "extra"
  });
} finally {
  args.attacker.isReceivingReflection = false;
}
```

### 共享事件去重

同一次触发的脚本共享 `args`。套装中多件装备可能响应同一事件时，可设置业务专属标记：

```javascript
if (args.ruanweiProcessed) return;
args.ruanweiProcessed = true;
```

不要使用过于通用的 `args.processed`，避免与其他脚本冲突。

### 玩家决策

已有检定或对抗能力时使用 `Macros`。确实需要简单选择时使用 V13 命名空间：

```javascript
const confirmed = await foundry.applications.api.DialogV2.confirm({
  window: { title: "是否消耗状态？" },
  content: "<p>消耗一层状态，使本次伤害 +10。</p>",
  yes: { label: "消耗" },
  no: { label: "保留" }
});
```

Dialog 只能出现在异步触发器中。取消操作后的资源退款、状态恢复等行为必须由脚本明确处理。

## 招式等级公式

等级公式不是任意 JavaScript。`description`、`range` 可嵌入 `@{表达式|回退文本}`，`actionCost` 公式必须占据整个字段。支持变量 `@level`、`@up`、`@maxLevel`，以及 `min`、`max`、`clamp`、`floor`、`ceil`、`round`、`abs`、`if`。描述中的 `action(...)` 把整数 `1..5` 映射为动作名称。

完整录入约束由项目内部的种子数据录入规范维护。解析行为以 `module/utils/level-formula.mjs` 为准。

## 调试与验收

- 在脚本中临时使用 `console.log({ trigger, args, thisItem, thisEffect })` 检查上下文，确认后删除调试输出。
- 观察控制台的 `XJZL |` 日志和“特效脚本执行失败”通知。
- 分别验证命中/未命中、单体/多目标、自动/手动结算、普通角色/野兽、owner/非 owner、满资源/空资源和禁疗/资源上限等边界。
- 修改同步脚本后刷新并重新打开角色卡，确认派生数据没有 Promise、重复累加或计算循环；反复打开面板，确认 `calc` 没有持久化副作用。
- 修改源 JSON 后重新 seed 对应合集包；只编辑 JSON 不会自动更新现有世界中的 Compendium 文档。
