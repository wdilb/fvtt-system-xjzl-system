# 脚本引擎手册

本手册面向物品、招式、特性和 Active Effect（AE）脚本作者，描述当前系统公开的脚本契约。本手册只描述运行时脚本契约；源数据录入还需遵循项目内部的录入规范。

## 事实源与兼容边界

文档与代码不一致时，以以下实现为准：

- 触发器和脚本字段：`module/data/common.mjs`
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

- 武器、防具、奇珍和特性的脚本位于 `system.scripts`。
- 武学脚本位于具体招式的 `system.moves[].scripts`。
- 内功脚本位于阶段配置中，运行时读取 `system.current.scripts`。
- AE 脚本位于 `flags.xjzl-system.scripts`。

`trigger` 必须来自 `module/data/common.mjs#SCRIPT_TRIGGERS`。未知值无法通过当前脚本 Schema。

## 执行模型

### 同步与异步

`passive` 和 `calc` 同步执行，因为它们参与派生数据和面板计算。同步脚本禁止使用 `await`、Dialog、文档写入以及任何依赖稍后完成的 Promise。

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

### 架招后台白名单

架招被主动开启时，它作为当前招式正常参与 `calc`、`preAttack`、`attack` 等流程。开启后作为后台状态时，只收集以下触发器：

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

`args` 的字段也会展开成同名顶层变量，但只有对应触发器传入的字段才存在。推荐业务代码从 `args` 读取条件字段，并对 `args.target`、`args.attacker`、`args.move`、`args.item` 做空值检查。

后台武学或架招脚本会按来源临时注入 `move`。这不代表角色正在出招；只有 `preAttack`、`attack`、`check`、`preDamage`、`hit`、`hit_once` 属于主动招式资源溯源阶段。

## 触发流程

一次常规攻击大致按以下顺序运行：

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

## 触发器参考

### 派生值与面板

| 触发器 | 时机 | 主要上下文和可写字段 |
|---|---|---|
| `passive` | Actor 派生数据第二遍计算前 | 直接修改 `system` 或 `actor.xjzlStatuses`；随后会执行 `system.recalculate()`。 |
| `calc` | 招式或普攻面板计算时 | `args.move`、`args.item`、只读 `args.baseData`；修改 `args.output.damage`、`feint`、`bonusDesc`、`feintBonusDesc`。 |

`passive` 仅遍历已领悟轻功、散手、阵法招式和当前架招。普通武学中未作为当前架招的招式 `passive` 不会全局运行。

```javascript
const bonus = Math.max(0, S.stats.neixi.total);
args.output.damage += bonus;
args.output.bonusDesc.push(`内息加成 +${bonus}`);
```

### 出招与检定

| 触发器 | 时机 | 主要上下文和可写字段 |
|---|---|---|
| `preAttack` | 计算基础消耗后、余额检查和扣除前 | `move`、`item`、`attacker`；修改 `costConfig.mp/hp/rage`、`abort`、`abortReason`。 |
| `attack` | 已扣资源、基础面板已计算、掷骰前 | `actionType`、`damageType/type`、`element`、`costConsumed`；修改 `flags`。 |
| `check` | 对每个目标计算命中/虚招上下文时 | `target`、`attacker`、`item`、`move`；修改目标专属 `flags`。 |

`attack` 的主要 `flags`：

| 字段 | 作用 |
|---|---|
| `level` / `feintLevel` | 本次命中/虚招优劣势计数。正数为优势，负数为劣势。 |
| `bonusHit` / `bonusFeint` | 本次命中值/虚招值加成。 |
| `critThresholdMod` | 暴击阈值修正，正数表示更容易暴击。 |
| `forceHit` | 跳过投掷的必中。 |
| `alwaysHit` | 仍投掷、仍可暴击的必定命中。 |
| `damageResult` | 当前面板结果，可修改 `damage`、`feint` 和 `breakdown`。 |
| `abort` / `abortReason` | 中止出招及操作者提示。资源已在 `attack` 前扣除，脚本如需退款必须显式处理。 |

`check` 的主要 `flags`：`grantLevel`、`grantFeintLevel`、`grantHit`、`grantFeint`、`critThresholdMod`、`ignoreBlock`、`ignoreDefense`、`ignoreStance`、`forceHit`、`alwaysHit`。

### 攻击者结算

| 触发器 | 时机 | 主要上下文和可写字段 |
|---|---|---|
| `preDamage` | 命中、暴击和破架确定后，调用目标 `applyDamage()` 前 | 只读 `outcome.isHit/isCrit/isBroken`；修改 `config.amount/type/element/ignoreBlock/ignoreDefense/ignoreStance/applyCritDamage/ignoreMinDamage`。 |
| `hit` | 每个目标结算后；攻击未命中时也执行 | `target`、`isHit`、`isCrit`、`isBroken`、`finalDamage`、各资源实际损失、`damageResult`；治疗/Buff 另有 `baseAmount`、`finalAmount`、`healAmount`。 |
| `hit_once` | 全部目标完成后执行一次 | `targets` 汇总、`hitCount`、`attacker`、`item`、`move`、`actionType`、`costConsumed`；攻击提供 `hasCrit`，治疗提供 `totalHealAmount`。 |

`hit` 的 `damageType/type` 当前保留招式原始伤害类型；如果 `preDamage` 改写了单个目标的 `config.type`，需要最终类型时从具体结算上下文自行确认，不要假设这两个字段已经同步改写。

### 防御者结算

| 触发器 | 时机 | 主要上下文和可写字段 |
|---|---|---|
| `avoided` | `applyDamage()` 收到 `isHit: false` 时 | `attacker`、`target`、`type`、`baseDamage`、`move`、`item`、只读 `outcome`。 |
| `preDefense` | 命中后、暴击倍率和防御/格挡/抗性计算前 | 修改 `config.ignoreBlock`、`ignoreDefense`、`ignoreStance`、`isCrit`、`applyCritDamage`、`element`。 |
| `preTake` | 防御和抗性完成后、资源扣除前 | `baseDamage`、`calcDamage`；修改 `output.damage`，或设置 `output.abort` 完全免疫。 |
| `dying` | 首次进入濒死，或有效来源攻击已濒死目标时 | `attacker`、`target`、`damage`；设置 `preventDying`。 |
| `death` | 死亡条件成立、挂死亡状态前 | 与 `dying` 共享上下文；设置 `preventDeath`。 |
| `damaged` | 资源已提交且濒死/死亡判定完成后 | `finalDamage`、`hpLost/mpLost/hutiLost`、`isCrit/isBroken/isDying/isDead`、`config`。适合反伤和受击后效。 |

`hpLost`、`mpLost`、`hutiLost` 是标准伤害部分的实际损失。`finalDamage` 是进入资源分配前的最终伤害值，两者含义不同。

### 资源实际变动

`resourceChanged` 在数据库提交并完成上限或禁疗等裁剪后触发。支持 `hp`、`mp`、`rage`、`huti`、`tili`、`morale`；银两和休息次数不触发。

| 字段 | 含义 |
|---|---|
| `changes` | 本次事务的变化数组。每项包含 `resource`、`path`、`oldValue`、`newValue`、`delta`。 |
| `byResource` | 按资源名索引的同一批变化，例如 `args.byResource.hp.delta`。 |
| `cause` | 来源类别；未提供时为 `update`。 |
| `sourceActor`、`attacker`、`healer`、`target`、`item`、`move`、`source` | 调用链能够确定时提供的溯源信息。 |
| `chainId` / `depth` | 连锁资源事务标识和当前深度。 |

没有实际差值时不触发。脚本再次修改资源会继承 `chainId`，最大深度为 8；业务脚本仍必须自行防循环。

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
| `combatStart` | 战斗开始时，每个 Combatant 执行一次 | `combatant`、`combat`。 |
| `turnStart` | Actor 回合开始，自动回复/消耗完成后 | 当前没有额外业务字段。 |
| `turnEnd` | Actor 回合结束，自动回复/消耗完成后 | 当前没有额外业务字段。 |

这三个触发器会遍历该 Actor 全部已领悟武学招式。执行由活动 GM 统筹并路由给在线 owner；脚本不要自行假设执行客户端一定是 GM。

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

常用输入包括 `amount`、`type`、`element`、`attacker`、`isHit`、`isCrit`、`applyCritDamage`、`isBroken`、`ignoreBlock`、`ignoreDefense`、`ignoreStance`、`ignoreMinDamage`、`item`、`move`、`source`。返回值包含 `finalDamage`、`hpLost`、`mpLost`、`hutiLost`、`tiliLost`、`isDying`、`isDead`、`rageGained`、`isHit`。

伤害类型以 `CONFIG.XJZL.damageTypes` 为准。环境伤害可以把 `attacker` 设为 `null`；能确定来源时必须传入，以保留统计和反伤语义。

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

`type` 支持 `hp`、`mp`/`neili`、`huti`、`tili`、`rage`。正数恢复，负数直接流失。返回值包含 `actualHeal`、`overflow`、`isBlocked`、`oldVal`、`newVal`。

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

`changeResources()` 会串行提交同一 Actor 的资源事务，并按实际差值派发 `resourceChanged`。不要用它模拟需要防御、抗性、护体、禁疗或统计语义的正常伤害/治疗。

## 状态 API

### 添加和移除

```javascript
await game.xjzl.api.effects.addEffect(args.target, "prone");
await game.xjzl.api.effects.removeEffect(args.target, "prone", 1);
```

`addEffect(actor, effectDataOrId, count = 1)` 接受系统状态 ID 或 AE 数据，负责权限委托、本地化、slug 匹配、叠层和刷新。`removeEffect(actor, effectIdOrSlug, amount = 1)` 按文档 ID 或 slug 移除/减层。

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

数值计数器通常使用 AE mode `2`（ADD）；布尔覆盖通常使用 mode `5`（OVERRIDE）。新增键必须先进入 `CONFIG.XJZL.statusFlags`，不能只在数据中自创系统状态键。

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

`requestSave(options)` 的主要参数：

| 参数 | 含义 |
|---|---|
| `target`、`type`、`dc` | 目标、属性/技能/技艺键和难度。`target`、`type` 必填。 |
| `attacker`、`label` | 来源 Actor 和卡片标题。 |
| `level`、`bonus` | 临时优劣势层级和数值修正。 |
| `onSuccess` / `onFail` | 系统状态 ID、AE 数据或数组。函数会被拒绝。 |
| `damageOnSuccess` / `damageOnFail` | `{ value, type }`。伤害类型走 `applyDamage`；资源类型走直接流失。 |
| `successText` / `failureText` | 结果说明。 |
| `removeStanceOnSuccess` / `removeStanceOnFail` | 对应结果出现时解除检定者架招。 |

结果执行顺序为：状态 → 伤害或资源变化 → 解除架招。

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

`requestContest(options)` 还支持 `attBonus`、`defBonus`、`winText`、`loseText`。`outcome.win/lose` 从发起者视角定义，可使用 `text`、`selfEffect`、`targetEffect`、`selfRecovery`、`selfDamage`、`targetDamage`。双方平局时当前实现判发起者获胜。

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
- 分别验证命中/未命中、单体/多目标、owner/非 owner、满资源/空资源和禁疗/资源上限等边界。
- 修改同步脚本后刷新并重新打开角色卡，确认派生数据没有 Promise、重复累加或计算循环。
- 修改源 JSON 后重新 seed 对应合集包；只编辑 JSON 不会自动更新现有世界中的 Compendium 文档。
