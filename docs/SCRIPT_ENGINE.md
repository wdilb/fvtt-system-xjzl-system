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

`trigger` 必须来自 `module/data/common.mjs#SCRIPT_TRIGGERS`。Item、招式和内功脚本受 Schema 选项约束；AE 脚本虽然存放在普通 flags 中，标准编辑界面也只提供这些选项。未知触发器不会在攻击、受伤或回合等标准时机执行，不应使用。

## 先看这里：参数分为两层

每段脚本能看到两类参数：

1. **公用注入变量**：每个触发器都存在，例如 `actor`、`S`、`args`、`thisItem`。
2. **阶段上下文**：存放在 `args` 中，由当前触发器决定，例如 `hit` 的 `args.target` 和 `args.hpLost`。

下文参数表使用以下标记：

- **只读**：仅供判断；修改不属于公开契约。
- **可写**：系统会在后续流程读取该值。
- **条件提供**：只在特定动作类型、结算方式或可确定来源时存在；读取时应使用 `?.` 或 `??`。

## 全脚本公用注入变量

以下变量在所有触发器中都可用，不需要从 `args` 读取：

| 变量 | 类型 | 含义 |
|---|---|---|
| `actor` | `Actor` | 当前脚本的宿主。攻击侧触发器通常是攻击者，防御侧触发器是受击者。 |
| `system` / `S` | `Actor.system` | `actor.system` 的同一引用；`S` 是便捷别名。 |
| `args` | `Object` | 本次触发的阶段上下文。只有后文对应触发器列出的字段才是稳定公开契约。 |
| `trigger` | `string` | 当前触发器名称。 |
| `thisItem` | `Item` / `ActiveEffect` / `null` | 当前脚本来源。Item 脚本指向该 Item；AE 脚本为兼容也指向该 AE。 |
| `thisEffect` | `ActiveEffect` / `null` | 当前脚本来自 AE 时指向该 AE，否则为 `null`。 |
| `Macros` | `XJZLMacros` | 系统公开宏工具，例如 `requestSave()`、`requestContest()` 和 `checkStance()`。 |
| `game` / `ui` / `console` | Foundry 全局对象 | 游戏对象、通知对象和控制台。 |

脚本仍运行在 Foundry 客户端环境中，因此也能访问 `foundry`、`canvas`、`CONFIG`、`CONST`、`ChatMessage`、`Roll`、`fromUuid` 等 V13 全局对象。它们属于 Foundry API，不是脚本引擎额外封装；使用前仍要检查当前场景、画布或文档是否存在。

### `args` 与同名顶层变量

触发开始时已有的 `args` 字段也会展开成同名顶层变量。例如 `args.target` 存在时，脚本也能读取顶层 `target`。

但是：

- 只有对应触发器实际传入的字段才存在。
- 脚本运行中新增 `args.myFlag` 不会同步新建顶层 `myFlag`。
- 业务代码推荐统一从 `args` 读取阶段参数，并对 `args.target`、`args.attacker`、`args.move`、`args.item` 做空值检查。

对 `args.output`、`args.config`、`args.costConfig`、`args.flags` 等可写容器，应修改后文列出的子字段，不要替换整个对象。`args.baseData`、`args.outcome` 等只读对象当前没有冻结，但修改它们不属于公开契约，也不保证影响结算。

后台武学、架招和战斗时机中的招式脚本会临时获得 `args.move` 和顶层 `move`，用来表示脚本所属的招式。它不代表角色正在施展该招式。只有 `preAttack`、`attack`、`check`、`preDamage`、`hit`、`hit_once` 会被系统记作当前主动招式，供后续伤害、治疗和资源变化判断来源。

## 执行模型

### 同步与异步

| 类型 | 触发器 | 约束 |
|---|---|---|
| 同步 | `passive`、`calc` | 禁止 `await`、Dialog、文档写入及任何 Promise 副作用。脚本必须可重复计算，不能把面板计算当成一次行动。 |
| 异步 | 其余全部触发器 | 文档写入、伤害、治疗、状态和宏调用都应 `await`。 |

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

因此，“开启架招后持续增强角色或后续攻击”不能只写在架招的 `attack` 脚本中；应使用 `passive` 提供持续生效的加成，或在开启时添加 `tiedToStance` AE。

## 触发流程与选择速查

一次普通角色的常规攻击大致按以下顺序运行：

```text
passive / calc（持续被动与面板计算）
  → preAttack（余额检查和扣除资源前）
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

治疗和 Buff 招式同样执行 `attack`、`check`、`hit`、`hit_once`，但不进入标准伤害防御链。`creature` 使用独立的体力伤害分支；`container` 不参与脚本、伤害或治疗生命周期。

| 需求 | 优先使用 |
|---|---|
| 持续增加属性、伤害修正或状态标记 | `passive` |
| 修改招式或普攻的面板数值与说明 | `calc` |
| 扣除资源前调整消耗或阻止出招 | `preAttack` |
| 修改整次动作的命中参数 | `attack` |
| 针对单个目标修改命中或穿透 | `check` |
| 攻击者在应用伤害前修改数值、类型或穿透 | `preDamage` |
| 防御者响应未命中 | `avoided` |
| 防御者在减伤前修改防御配置 | `preDefense` |
| 防御者在减伤后修改最终伤害 | `preTake` |
| 阻止濒死或死亡状态 | `dying` / `death` |
| 防御者在资源提交后处理受击后效 | `damaged` |
| 响应资源的数据库实际差值 | `resourceChanged` |
| 攻击者处理逐目标后效或整次动作后效 | `hit` / `hit_once` |
| 处理进战、回合开始或回合结束 | `combatStart` / `turnStart` / `turnEnd` |

## 触发器完整参数参考

除特别标注为“可写”的字段外，本节所有参数均按只读处理。

### `passive`（同步）

**时机：**角色完成第一轮派生计算后；所有 `passive` 完成后，系统再执行一次 `system.recalculate()`。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| 无固定阶段字段 | — | — | 通常 `args` 为空对象。 |
| `move` | `Object` | 条件提供 | 脚本来自架招、轻功、散手或阵法招式时，临时指向所属招式。 |

`passive` 不提供 `args.output`。应直接修改 `S` 中可重算的属性或修正字段（通常是 `mod`），也可修改 `actor.xjzlStatuses`。

```javascript
const bonus = Math.floor(Math.max(0, S.stats.neixi.total) / 20);
S.combat.damages.skill.mod += bonus;
```

`actor.xjzlStatuses` 位于 Actor Document 上，不在 `system` DataModel 内；不要写成 `S.xjzlStatuses`。写在武学招式上的 `passive` 只会从已开启架招，以及已领悟的轻功、散手和阵法招式中自动收集。

### `calc`（同步）

**时机：**计算招式或普攻面板时。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `move` | `Object` | 只读 | 当前招式；普攻时为虚拟招式。 |
| `item` | `Item` / `Object` | 只读 | 所属武学 Item；普攻时为虚拟物品。 |
| `baseData` | `Object` | 只读 | 计算前的参考快照；修改它不会直接改变结果。 |
| `baseData.base` | `number` | 只读 | 基础伤害。 |
| `baseData.weapon` | `number` | 只读 | 武器伤害。 |
| `baseData.isWeaponMatch` | `boolean` | 只读 | 当前武器是否匹配招式。 |
| `baseData.level` | `number` | 条件提供 | 招式面板的招式等级。 |
| `baseData.rank` | `number` | 条件提供 | 普攻面板的武器等级加成。 |
| `output.damage` | `number` | **可写** | 当前面板伤害。 |
| `output.feint` | `number` | **可写** | 当前虚招值。 |
| `output.bonusDesc` | `string[]` | **可写** | 伤害详情的附加说明，通常使用 `.push()`。 |
| `output.feintBonusDesc` | `string[]` | **可写** | 虚招详情的附加说明。 |

```javascript
const bonus = Math.max(0, S.stats.neixi.total);
args.output.damage += bonus;
args.output.bonusDesc.push(`内息加成 +${bonus}`);
```

`calc` 的执行边界：

- 架招使用专用强度计算，不执行 `calc`。
- 常规有系数招式会收集当前内功、装备、特性、当前招式和 AE 的 `calc`。
- 无系数且 `move.calculation.isFixed === true` 时，只执行当前招式自身的 `calc`。
- 无系数且 `isFixed` 不为 `true` 时，不执行 `calc`。

### `preAttack`（异步）

**时机：**系统计算出基础消耗后，余额检查和资源扣除前。普攻不触发。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `move` | `Object` | 只读 | 当前招式。 |
| `item` | `Item` | 只读 | 所属武学。 |
| `attacker` | `Actor` | 只读 | 出招者，通常与 `actor` 相同。 |
| `costConfig.mp` | `number` | **可写** | 本次内力消耗。 |
| `costConfig.hp` | `number` | **可写** | 本次气血消耗。 |
| `costConfig.rage` | `number` | **可写** | 本次怒气消耗。 |
| `abort` | `boolean` | **可写** | 设为 `true` 会在扣除资源前中止出招。 |
| `abortReason` | `string` | **可写** | 中止时向操作者显示的提示。 |

### `attack`（异步）

**时机：**资源已扣除、基础面板已计算，但尚未掷骰。攻击、治疗、Buff 和主动开启架招都可进入。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `move` / `item` / `attacker` | `Object` / `Item` / `Actor` | 只读 | 当前招式、所属武学和出招者。 |
| `actionType` | `string` | 只读 | 动作类型，例如 `attack`、`heal` 或 `buff`。 |
| `damageType` / `type` | `string` | 只读 | 原始伤害类型；两者同义。 |
| `element` | `string` | 只读 | 招式属性。 |
| `costConsumed` | `Object` | 只读 | 已实际消耗的 `mp`、`hp`、`rage`、`morale` 及 `desperateBonus`。 |
| `flags.level` / `flags.feintLevel` | `number` | **可写** | 本次命中/虚招优劣势计数；正数为优势，负数为劣势。 |
| `flags.bonusHit` / `flags.bonusFeint` | `number` | **可写** | 本次命中值/虚招值数值加成。 |
| `flags.critThresholdMod` | `number` | **可写** | 暴击阈值修正；正数表示更容易暴击。 |
| `flags.forceHit` | `boolean` | **可写** | 跳过投掷的必中。 |
| `flags.alwaysHit` | `boolean` | **可写** | 仍投掷、仍可暴击的必定命中。 |
| `flags.abort` / `flags.abortReason` | `boolean` / `string` | **可写** | 中止出招及提示。此时资源和动作已消耗，需要退款时必须显式处理。 |
| `flags.autoApplied` | `boolean` | **可写** | 标记本次流程是否已由脚本自动应用。 |
| `flags.damageResult` | `Object` | **可写** | 当前面板结果引用。 |
| `flags.damageResult.damage` / `.feint` | `number` | **可写** | 当前面板伤害和虚招值。 |
| `flags.damageResult.breakdown` / `.feintBreakdown` | `string` | **可写** | 面板详情文本。 |

### `check`（异步）

**时机：**对每个目标单独计算命中和虚招上下文时。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `target` | `Actor` | 只读 | 当前目标。 |
| `attacker` | `Actor` | 只读 | 出招者。 |
| `item` / `move` | `Item` / `Object` | 只读 | 所属武学和当前招式。 |
| `flags.grantLevel` / `flags.grantFeintLevel` | `number` | **可写** | 仅针对当前目标的命中/虚招优劣势计数。 |
| `flags.grantHit` / `flags.grantFeint` | `number` | **可写** | 仅针对当前目标的命中值/虚招值加成。 |
| `flags.critThresholdMod` | `number` | **可写** | 仅针对当前目标的暴击阈值修正。 |
| `flags.ignoreBlock` / `.ignoreDefense` / `.ignoreStance` | `boolean` | **可写** | 仅针对当前目标忽略格挡、防御或架招。 |
| `flags.forceHit` / `flags.alwaysHit` | `boolean` | **可写** | 仅针对当前目标的必中设置。 |

### `preDamage`（异步，攻击者侧）

**时机：**命中、暴击和破架已确定，但尚未调用目标的 `applyDamage()`。未命中时不执行。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `attacker` / `target` | `Actor` | 只读 | 攻击者和当前目标。 |
| `item` / `move` | `Item` / `Object` | 只读 | 所属武学和当前招式。 |
| `element` | `string` | 只读 | 招式原始属性。 |
| `outcome.isHit` / `.isCrit` / `.isBroken` | `boolean` | 只读 | 攻击方已确定的命中、暴击和破架结果。 |
| `config.amount` | `number` | **可写** | 即将传入伤害 API 的原始数值。 |
| `config.type` / `config.element` | `string` | **可写** | 对当前目标实际应用的伤害类型和属性。 |
| `config.ignoreBlock` / `.ignoreDefense` / `.ignoreStance` | `boolean` | **可写** | 对当前目标的穿透配置。 |
| `config.applyCritDamage` | `boolean` | **可写** | 是否应用暴击伤害倍率；不改变 `outcome.isCrit`。 |
| `config.ignoreMinDamage` | `boolean` | **可写** | 是否忽略最低 1 点伤害保底。 |
| `isManual` | `boolean` | 条件提供 | 手动伤害结算时为 `true`。 |

### `avoided`（异步，防御者侧）

**时机：**标准 `applyDamage()` 收到 `isHit: false` 时。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `attacker` / `target` | `Actor` / `null` | 只读 | 攻击来源和受击者；环境伤害的 `attacker` 可为 `null`。 |
| `type` | `string` | 只读 | 伤害类型。 |
| `baseDamage` | `number` | 只读 | 原始面板伤害。 |
| `isCrit` | `boolean` | 只读 | 调用方传入的暴击意图；即使未命中也会保留。 |
| `move` / `item` | `Object` / `Item` / `null` | 只读 | 系统能够确定时提供的招式和物品来源。 |
| `outcome.isHit` / `.isBroken` | `boolean` | 只读 | 未命中和破架结果快照。 |

### `preDefense`（异步，防御者侧）

**时机：**命中后，暴击倍率、防御、格挡和抗性计算前。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `attacker` / `target` | `Actor` / `null` | 只读 | 攻击来源和受击者。 |
| `type` / `damageType` | `string` | 只读 | 当前伤害类型；两者同义。 |
| `element` | `string` | 只读 | 当前伤害属性。 |
| `baseDamage` | `number` | 只读 | 原始面板伤害。 |
| `move` / `item` | `Object` / `Item` / `null` | 只读 | 招式和物品来源。 |
| `config.ignoreBlock` / `.ignoreDefense` / `.ignoreStance` | `boolean` | **可写** | 穿透配置。 |
| `config.isCrit` | `boolean` | **可写** | 防御侧最终暴击状态。 |
| `config.applyCritDamage` | `boolean` | **可写** | 是否应用暴击伤害倍率。 |
| `config.element` | `string` | **可写** | 进入抗性计算的最终属性。 |

### `preTake`（异步，防御者侧）

**时机：**防御、格挡和抗性计算完成后，资源扣除前。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `attacker` / `target` | `Actor` / `null` | 只读 | 攻击来源和受击者。 |
| `type` / `damageType` | `string` | 只读 | 当前伤害类型。 |
| `element` | `string` | 只读 | `preDefense` 完成后的伤害属性。 |
| `baseDamage` | `number` | 只读 | 原始面板伤害。 |
| `calcDamage` | `number` | 只读 | 系统完成减伤后的理论值。 |
| `isCrit` / `isBroken` | `boolean` | 只读 | 最终暴击和破架状态。 |
| `move` / `item` | `Object` / `Item` / `null` | 只读 | 招式和物品来源。 |
| `config` | `Object` | 只读 | 最终防御配置；可用于 `Macros.checkStance(actor, args)` 等判断。 |
| `output.damage` | `number` | **可写** | 即将进入资源分配的最终伤害。 |
| `output.abort` | `boolean` | **可写** | 设为 `true` 会完全免疫本次伤害。 |

### `dying`（异步，防御者侧）

**时机：**首次进入濒死，或 `source` 为 `move`、`basic`、`both` 的攻击继续伤害已濒死目标时。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `attacker` / `target` | `Actor` / `null` | 只读 | 攻击来源和受击者。 |
| `damage` | `number` | 只读 | 本次进入资源分配的最终伤害。 |
| `preventDying` | `boolean` | **可写** | 设为 `true` 阻止本次添加濒死状态。 |
| `preventDeath` | `boolean` | 只读 | 与 `death` 共享的初始标记；在本阶段修改不代替 `death` 阶段的判定。 |

### `death`（异步，防御者侧）

**时机：**死亡条件成立，添加死亡状态前。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `attacker` / `target` | `Actor` / `null` | 只读 | 攻击来源和受击者。 |
| `damage` | `number` | 只读 | 本次进入资源分配的最终伤害。 |
| `preventDying` | `boolean` | 只读 | 前序 `dying` 阶段留下的标记。 |
| `preventDeath` | `boolean` | **可写** | 设为 `true` 阻止本次添加死亡状态。 |

`preventDying` 和 `preventDeath` 只阻止本次状态处理，不会撤销已经提交的资源损失，也不会移除原本已有的濒死或死亡状态。`preventDying` 不等于 `preventDeath`；如果死亡条件同时成立，`death` 仍会执行。

### `damaged`（异步，防御者侧）

**时机：**资源已提交，濒死和死亡判定已完成；适合反伤与受击后效。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `attacker` / `target` | `Actor` / `null` | 只读 | 攻击来源和受击者。 |
| `type` / `damageType` | `string` | 只读 | 最终结算使用的伤害类型。 |
| `element` | `string` | 只读 | 最终结算使用的伤害属性。 |
| `finalDamage` | `number` | 只读 | 进入资源分配前的最终伤害。 |
| `hpLost` / `mpLost` / `hutiLost` | `number` | 只读 | 标准伤害部分造成的实际资源损失。 |
| `isCrit` / `isBroken` | `boolean` | 只读 | 防御侧最终暴击和破架状态。 |
| `isDying` / `isDead` | `boolean` | 只读 | 本次结算是否进入濒死或死亡。 |
| `move` / `item` | `Object` / `Item` / `null` | 只读 | 招式和物品来源。 |
| `config` | `Object` | 只读 | 最终防御配置；可检查 `ignoreStance`、`isCrit` 等字段。 |

`finalDamage` 与 `hpLost/mpLost/hutiLost` 含义不同：前者是资源分配前的伤害值，后者是实际差值。以上标准防御触发器均不适用于 `creature` 的独立体力伤害分支。

### `resourceChanged`（异步）

**时机：**资源数据库更新已提交，并完成上限、下限和禁疗等裁剪后。没有实际差值时不触发。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `changes` | `Object[]` | 只读 | 本次事务的全部实际变化。 |
| `changes[].resource` | `string` | 只读 | `hp`、`mp`、`rage`、`huti`、`tili` 或 `morale`。 |
| `changes[].path` | `string` | 只读 | 对应 Foundry 更新路径。 |
| `changes[].oldValue` / `.newValue` / `.delta` | `number` | 只读 | 旧值、新值和实际差值；增加为正，减少为负。 |
| `byResource` | `Object` | 只读 | 按资源名索引同一批变化，例如 `args.byResource.hp`。 |
| `cause` | `string` | 只读 | 资源事务来源类别；未提供时为 `update`。 |
| `sourceActor` | `Actor` / `null` | 只读 | 发起普通资源事务的 Actor，能够确定时提供。 |
| `attacker` / `healer` | `Actor` / `null` | 条件提供 | 伤害或治疗来源。 |
| `target` | `Actor` / `null` | 条件提供 | 资源实际发生变化的目标。 |
| `item` / `move` | `Item` / `Object` / `null` | 条件提供 | 物品和招式来源。 |
| `type` | `string` | 条件提供 | 伤害或治疗事务能够确定时提供的资源/伤害类型。 |
| `damageType` / `element` | `string` | 条件提供 | 伤害事务的伤害类型和属性。 |
| `source` | `string` | 条件提供 | 业务来源标记，例如 `move`、`dot` 或自定义去重值。 |
| `chainId` | `string` | 只读 | 连锁资源事务标识。 |
| `depth` | `number` | 只读 | 当前连锁深度，范围为 `0..7`。 |

普通角色实际跟踪 `hp`、`mp`、`rage`、`huti`、`morale`；`creature` 实际跟踪 `tili`、`rage`。银两和休息次数不触发。脚本再次修改资源会继承 `chainId`，准备进入深度 `8` 时系统终止派发；业务脚本仍必须自行防循环。

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

伤害会先完成 `dying`、`death`、`damaged`，治疗会先完成统计，然后才派发对应的 `resourceChanged`。

### `hit`（异步，攻击者侧）

**时机：**每个目标结算后执行一次。攻击未命中时也执行；治疗和 Buff 也使用该触发器。

**全部动作都提供：**

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `target` / `attacker` | `Actor` | 只读 | 当前目标和出招者。 |
| `item` / `move` | `Item` / `Object` | 只读 | 所属武学和当前招式。 |
| `actionType` | `string` | 只读 | `attack`、`heal` 或 `buff`。 |
| `damageType` / `type` | `string` | 只读 | 攻击保留招式原始伤害类型；治疗/Buff 为 `none`。 |
| `element` | `string` | 只读 | 招式原始属性。 |
| `isHit` / `isCrit` / `isBroken` | `boolean` | 只读 | 命中、攻击方暴击和破架结果。治疗/Buff 固定为 `true/false/false`。 |
| `hpLost` / `hutiLost` / `mpLost` | `number` | 只读 | 攻击的实际损失；治疗/Buff 固定为 `0`。 |

**攻击额外提供：**

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `baseDamage` | `number` | 只读 | 招式或卡片面板伤害。 |
| `finalDamage` | `number` | 条件提供 | 进入目标资源分配前的最终伤害。 |
| `isDying` / `isDead` | `boolean` | 条件提供 | 本次结算是否使目标进入濒死或死亡。 |
| `damageResult` | `Object` | 只读 | `applyDamage()` 返回的原始结果对象。 |
| `isAttack` / `isHeal` / `isBuff` | `boolean` | 条件提供 | 自动攻击结算会提供 `true/false/false`。 |
| `isManual` | `boolean` | 条件提供 | 自动结算为 `false`，手动结算为 `true`。 |

**治疗/Buff 额外提供：**

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `isAttack` / `isHeal` / `isBuff` | `boolean` | 只读 | 动作分类标记。 |
| `baseAmount` | `number` | 只读 | 原始治疗量或 Buff 强度。 |
| `finalAmount` | `number` | 只读 | 治疗时为实际恢复量；Buff 时为强度。 |
| `healAmount` | `number` | 只读 | 实际恢复量；Buff 时为 `0`。 |
| `ignoreBlock` / `ignoreDefense` | `boolean` | 只读 | 兼容字段，固定为 `false`。 |
| `isBuffOnly` | `boolean` | 只读 | 纯 Buff 或面板数值为 `0` 时为 `true`。 |

未命中、免疫、容器或其他提前返回路径可能只提供部分伤害结果字段。读取时使用 `args.hpLost ?? 0` 等空值兜底。`damageType/type/element` 保留招式或卡片原始值；`preDamage` 针对单个目标的改写不会回写这些字段。

### `hit_once`（异步，攻击者侧）

**时机：**本次动作的全部目标完成后执行一次。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `targets` | `Object[]` | 只读 | 全部目标的汇总结果，元素结构见下文。 |
| `hitCount` | `number` | 只读 | 命中目标数；治疗/Buff 视为全部命中。 |
| `attacker` / `item` / `move` | `Actor` / `Item` / `Object` | 只读 | 出招者、所属武学和当前招式。 |
| `actionType` | `string` | 只读 | `attack`、`heal` 或 `buff`。 |
| `damageType` / `type` | `string` | 只读 | 攻击保留原始伤害类型；治疗/Buff 为 `none`。 |
| `element` | `string` | 只读 | 招式原始属性。 |
| `baseDamage` | `number` | 条件提供 | 攻击的面板伤害。 |
| `hasCrit` | `boolean` | 条件提供 | 自动攻击中是否至少有一个目标被判定为暴击。 |
| `totalHealAmount` | `number` | 条件提供 | 治疗/Buff 的总实际治疗量。 |
| `isHeal` | `boolean` | 条件提供 | 治疗为 `true`，Buff 为 `false`。 |
| `costConsumed` | `Object` | 条件提供 | 自动攻击和治疗/Buff 的实际消耗。 |
| `isManual` | `boolean` | 条件提供 | 手动攻击结算时为 `true`。 |

`targets` 的元素结构：

- 攻击：`target`、`isHit`、`isCrit`、`isBroken`、`baseDamage`、`finalDamage`、`hpLost`、`hutiLost`、`mpLost`、`isDying`、`isDead`、`damageResult`。
- 治疗/Buff：`name`、`amount`、`baseAmount`、`isHeal`、`isBlocked`。当前汇总项不包含目标 Actor；需要逐目标 Actor 时应在 `hit` 中处理。

`hit` 和 `hit_once.targets[].isCrit` 保留攻击方判定的暴击状态。如果目标的 `preDefense` 改写了 `config.isCrit`，最终防御侧暴击状态应从 `damaged` 读取。

### `combatStart`（异步）

**时机：**战斗开始时，每个 Combatant 执行一次。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| `combatant` | `Combatant` | 只读 | 当前 Actor 对应的战斗单位。 |
| `combat` | `Combat` | 只读 | 当前战斗。 |
| `move` | `Object` | 条件提供 | 脚本来自已领悟武学招式时，临时指向所属招式。 |

### `turnStart`（异步）

**时机：** Actor 回合开始，自动回复或消耗完成后。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| 无回合专属字段 | — | — | 通常 `args` 为空对象。 |
| `move` | `Object` | 条件提供 | 脚本来自已领悟武学招式时，临时指向所属招式。 |

### `turnEnd`（异步）

**时机：** Actor 回合结束，自动回复或消耗完成后。

| `args` 字段 | 类型 | 访问 | 含义 |
|---|---|---|---|
| 无回合专属字段 | — | — | 通常 `args` 为空对象。 |
| `move` | `Object` | 条件提供 | 脚本来自已领悟武学招式时，临时指向所属招式。 |

`combatStart`、`turnStart`、`turnEnd` 会遍历该 Actor 全部已领悟武学招式。执行由活动 GM 统筹并路由给在线 owner，无在线玩家 owner 时由 GM 执行；脚本不要假设执行客户端一定是 GM。

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
| `move` / `item` | `Object` / `Item`，默认 `null` | 造成这次伤害的招式和物品，用于后续脚本与统计。 |
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
| `healer` | `Actor` 或 `null`，默认当前目标 Actor | 造成这次治疗或资源流失的 Actor，用于后续脚本与统计。跨 Actor 治疗时应显式传入脚本宿主，例如 `healer: actor`。 |
| `move` / `item` | `Object` / `Item`，默认 `null` | 显式参数优先；如果 `healer`（未传时为目标）当前正在执行动作脚本，则从其脚本栈继承。 |
| `source` | `string`，默认 `extra` | 显式值优先；同一脚本栈能够确定主动招式来源时可继承为 `move`。 |

常规返回 `Promise<object>`，包含 `actualHeal`、`type`、`oldVal`、`newVal`、`overflow`、`isBlocked`。正向治疗可能受满值、禁疗或上限影响；负数是直接资源流失。`amount: 0`、容器或部分不适用资源的安全返回可能只包含 `actualHeal` 等少数字段，调用方应对可选字段做空值处理。

负数 `applyHealing` 是直接资源事务，不经过防御、抗性、护体分配，也不触发 `avoided`、`preDefense`、`preTake`、`dying`、`death`、`damaged`。即使负数气血变化把目标降到 `0`，它也不会自动执行濒死/死亡流程；需要标准致伤和濒死语义时应使用 `applyDamage`。

跨 Actor 调用如果省略 `healer`，系统无法从 JavaScript 方法调用本身推断是谁发起了治疗，会把目标 Actor 当作来源。为了让统计、权限代理和 `resourceChanged` 获得正确的来源信息，攻击者、治疗者或 Buff 宿主已知时必须显式传入。

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

同一次触发的脚本共享 `args`。套装中多件装备可能响应同一事件时，可设置一个不易与其他脚本冲突的专用标记：

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
