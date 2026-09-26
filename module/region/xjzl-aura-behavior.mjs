/**
 * xjzlAura —— 侠界光环 Region 行为类型。
 *
 * 行为只回答"谁在范围内、何时进出、何时回合结算"：进出判定直接采用核心
 * 包含语义（1×1 测中心、多格测足迹）；结算经 AuraLedger 串行队列
 * 统一落在活动 GM 端。enter/round/moveWithin 均关闭时仅标记范围。
 *
 * 行为类型须同时完成以下注册：
 * ① system.json `documentTypes.RegionBehavior.xjzlAura`（服务端校验）；
 * ② init 钩子注册 CONFIG.RegionBehavior.dataModels（须早于本地化扫描）；
 * ③ zh-cn `TYPES.RegionBehavior.xjzlAura`（typeLabels 自动挂载）。
 */

import {AuraLedger, payloadKeyOf} from "./xjzl-aura-ledger.mjs";
import {generateCircleOffsets, generateRectangleOffsets, rotateOffsets90, toCoreOffsets} from "../utils/aura-shapes.mjs";
import {xjzlSocket} from "../socket.mjs";

/** 触发 offsets 重算的范围字段：任一变化都须重建 region.shapes。 */
const RANGE_FIELDS = ["radius", "shapeKind", "rectWidth", "rectHeight", "anchorX", "anchorY", "quarterTurns"];

/**
 * 光环行为数据模型。
 * 字段由自定义 RegionBehaviorConfig 配置页分组编辑；
 * 生命周期元数据（源物品、战斗 ID、账本、节流）在 region flags，不入 schema。
 */
export class XJZLAuraRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {

    /** @override 本地化前缀：字段 label/hint 用 XJZL.AuraBehavior.* 键。 */
    static LOCALIZATION_PREFIXES = ["XJZL.AuraBehavior"];

    /** @override 光环行为 schema 全字段。 */
    static defineSchema() {
        const fields = foundry.data.fields;
        // 结算动作子字段（enterAction/roundAction 共用同一组 label 键）。
        // type 的 Schema 包含伤害类型与恢复资源；配置页按 kind 筛选。
        // 气血流失属于伤害类型，不列入治疗资源。
        const actionField = (withEffect = false) => new fields.SchemaField({
            kind: new fields.StringField({required: true, initial: "none",
                choices: withEffect
                    ? {none: "XJZL.AuraBehavior.CHOICES.ActionNone",
                        damage: "XJZL.AuraBehavior.CHOICES.ActionDamage",
                        healing: "XJZL.AuraBehavior.CHOICES.ActionHealing",
                        effect: "XJZL.AuraBehavior.CHOICES.ActionEffect"}
                    : {none: "XJZL.AuraBehavior.CHOICES.ActionNone",
                        damage: "XJZL.AuraBehavior.CHOICES.ActionDamage",
                        healing: "XJZL.AuraBehavior.CHOICES.ActionHealing"},
                label: "XJZL.AuraBehavior.ACTION.kind.label"}),
            // 固定数值，或按光环主人属性计算的公式（如 "0.4*@neixi"）
            amount: new fields.StringField({required: true, blank: false, initial: "0",
                label: "XJZL.AuraBehavior.ACTION.amount.label",
                hint: "XJZL.AuraBehavior.ACTION.amount.hint"}),
            // damage: XJZL.damageTypes；healing: 恢复的资源
            type: new fields.StringField({required: true, blank: false, initial: "liushi",
                choices: {
                    waigong: "XJZL.Damage.Waigong",
                    neigong: "XJZL.Damage.Neigong",
                    bleed: "XJZL.Damage.Bleed",
                    poison: "XJZL.Damage.Poison",
                    mental: "XJZL.Damage.Mental",
                    fire: "XJZL.Damage.Fire",
                    liushi: "XJZL.Damage.Liushi",
                    hp: "XJZL.AuraBehavior.CHOICES.Resource.Hp",
                    mp: "XJZL.AuraBehavior.CHOICES.Resource.Mp",
                    tili: "XJZL.AuraBehavior.CHOICES.Resource.Tili",
                    rage: "XJZL.AuraBehavior.CHOICES.Resource.Rage",
                    huti: "XJZL.AuraBehavior.CHOICES.Resource.Huti"
                },
                label: "XJZL.AuraBehavior.ACTION.type.label",
                hint: "XJZL.AuraBehavior.ACTION.type.hint"}),
            // 必中且无视格挡/防御/最低伤害保底（水牢、万剑"必中无暴击"类条目用）
            pierce: new fields.BooleanField({initial: false,
                label: "XJZL.AuraBehavior.ACTION.pierce.label",
                hint: "XJZL.AuraBehavior.ACTION.pierce.hint"})
        });
        return {
            // ---- 结算开关 ----
            enterEnabled: new fields.BooleanField({initial: true,
                label: "XJZL.AuraBehavior.FIELDS.enterEnabled.label",
                hint: "XJZL.AuraBehavior.FIELDS.enterEnabled.hint"}),
            roundEnabled: new fields.BooleanField({initial: false,
                label: "XJZL.AuraBehavior.FIELDS.roundEnabled.label",
                hint: "XJZL.AuraBehavior.FIELDS.roundEnabled.hint"}),

            // ---- 范围生成参数（生成器输出写入 region.shapes.grid.offsets；
            //      此处保留生成参数供 refreshAura 重建与配置页调整）----
            radius: new fields.NumberField({required: true, nullable: false, integer: true, min: 0, initial: 5,
                label: "XJZL.AuraBehavior.FIELDS.radius.label",
                hint: "XJZL.AuraBehavior.FIELDS.radius.hint"}),
            shapeKind: new fields.StringField({required: true, initial: "circle",
                choices: {circle: "XJZL.AuraBehavior.CHOICES.Circle",
                    rect: "XJZL.AuraBehavior.CHOICES.Rect"},
                label: "XJZL.AuraBehavior.FIELDS.shapeKind.label"}),
            rectWidth: new fields.NumberField({required: true, nullable: false, integer: true, min: 1, initial: 3,
                label: "XJZL.AuraBehavior.FIELDS.rectWidth.label",
                hint: "XJZL.AuraBehavior.FIELDS.rectWidth.hint"}),
            rectHeight: new fields.NumberField({required: true, nullable: false, integer: true, min: 1, initial: 3,
                label: "XJZL.AuraBehavior.FIELDS.rectHeight.label",
                hint: "XJZL.AuraBehavior.FIELDS.rectHeight.hint"}),
            // 矩形锚格在矩形内的格位（0 起算）；奇数尺寸可取 (边-1)/2 居中
            anchorX: new fields.NumberField({required: true, nullable: false, integer: true, min: 0, initial: 0,
                label: "XJZL.AuraBehavior.FIELDS.anchorX.label",
                hint: "XJZL.AuraBehavior.FIELDS.anchorX.hint"}),
            anchorY: new fields.NumberField({required: true, nullable: false, integer: true, min: 0, initial: 0,
                label: "XJZL.AuraBehavior.FIELDS.anchorY.label",
                hint: "XJZL.AuraBehavior.FIELDS.anchorY.hint"}),            // 管理器可按源 Token 朝向吸附为 90° 转数，行为 schema 保存数值
            quarterTurns: new fields.NumberField({required: true, nullable: false, integer: true, min: 0, max: 3, initial: 0,
                label: "XJZL.AuraBehavior.FIELDS.quarterTurns.label",
                hint: "XJZL.AuraBehavior.FIELDS.quarterTurns.hint"}),

            // ---- 过滤条件 ----
            faction: new fields.StringField({required: true, initial: "all",
                choices: {all: "XJZL.AuraBehavior.CHOICES.FactionAll",
                    ally: "XJZL.AuraBehavior.CHOICES.FactionAlly",
                    enemy: "XJZL.AuraBehavior.CHOICES.FactionEnemy"},
                label: "XJZL.AuraBehavior.FIELDS.faction.label",
                hint: "XJZL.AuraBehavior.FIELDS.faction.hint"}),
            includeSelf: new fields.BooleanField({initial: true,
                label: "XJZL.AuraBehavior.FIELDS.includeSelf.label",
                hint: "XJZL.AuraBehavior.FIELDS.includeSelf.hint"}),

            // ---- payload 引用（源物品 UUID＋效果名）----
            payloadItemUuid: new fields.StringField({required: true, blank: true, initial: "",
                label: "XJZL.AuraBehavior.FIELDS.payloadItemUuid.label",
                hint: "XJZL.AuraBehavior.FIELDS.payloadItemUuid.hint"}),
            payloadEffectName: new fields.StringField({required: true, blank: true, initial: "",
                label: "XJZL.AuraBehavior.FIELDS.payloadEffectName.label",
                hint: "XJZL.AuraBehavior.FIELDS.payloadEffectName.hint"}),

            // ---- 进入结算动作 ----
            enterAction: actionField(),
            // 区域内格间移动复用 enterAction
            moveWithin: new fields.BooleanField({initial: false,
                label: "XJZL.AuraBehavior.FIELDS.moveWithin.label",
                hint: "XJZL.AuraBehavior.FIELDS.moveWithin.hint"}),
            // 每回合限一次；节流键由战斗 ID 与轮次构成
            throttlePerRound: new fields.BooleanField({initial: false,
                label: "XJZL.AuraBehavior.FIELDS.throttlePerRound.label",
                hint: "XJZL.AuraBehavior.FIELDS.throttlePerRound.hint"}),

            // ---- 回合结算动作 ----
            // choices 值必须与 CONST.REGION_EVENTS 的事件名一致（handler 按
            // event.name 匹配）；显示文案用我们自己的本地化键（核心无
            // REGION.EVENTS.* 键，实测原样回显）。
            roundTiming: new fields.StringField({required: true, initial: "tokenRoundEnd",
                choices: {tokenRoundStart: "XJZL.AuraBehavior.CHOICES.Timing.RoundStart",
                    tokenRoundEnd: "XJZL.AuraBehavior.CHOICES.Timing.RoundEnd",
                    tokenTurnStart: "XJZL.AuraBehavior.CHOICES.Timing.TurnStart",
                    tokenTurnEnd: "XJZL.AuraBehavior.CHOICES.Timing.TurnEnd"},
                label: "XJZL.AuraBehavior.FIELDS.roundTiming.label",
                hint: "XJZL.AuraBehavior.FIELDS.roundTiming.hint"}),
            roundAction: actionField(true),

            // ---- 退出摘除选项 ----
            // 退出时需移除整条 AE 的效果使用清空型
            exitClear: new fields.BooleanField({initial: false,
                label: "XJZL.AuraBehavior.FIELDS.exitClear.label",
                hint: "XJZL.AuraBehavior.FIELDS.exitClear.hint"})
        };
    }

    /**
     * 事件订阅：handler 以行为实例为绑定作用域（核心契约，见
     * RegionBehaviorType.events 注释），故实现为模块级函数。
     * 回合四事件共用一个 handler，按 event.name 匹配 roundTiming。
     * @type {Record<string, Function>}
     */
    static events = {
        [CONST.REGION_EVENTS.TOKEN_ENTER]: onTokenEnter,
        [CONST.REGION_EVENTS.TOKEN_EXIT]: onTokenExit,
        [CONST.REGION_EVENTS.TOKEN_MOVE_WITHIN]: onTokenMoveWithin,
        [CONST.REGION_EVENTS.TOKEN_TURN_START]: onTokenRoundTurn,
        [CONST.REGION_EVENTS.TOKEN_TURN_END]: onTokenRoundTurn,
        [CONST.REGION_EVENTS.TOKEN_ROUND_START]: onTokenRoundTurn,
        [CONST.REGION_EVENTS.TOKEN_ROUND_END]: onTokenRoundTurn
    };

    /**
     * 范围参数在配置页被修改时重算 region 的 grid offsets。
     * 以当前形状原点反推锚格——原地扩张/收缩，不迁移中心；跟随光环的
     * offsets 已被核心随源平移，origin 同步平移，重算不丢跟随位置。
     * 写回 region.shapes 会触发边界重算与进/出补发，账本随之收敛；
     * shapes 更新不改行为 system，不会递归触发本钩子。
     * 配置页修改 payload 不迁移已施加账本：
     * 配置页更换 payload 引用不影响已覆盖目标——旧效果保留至目标
     * 退出/重进（退出时按旧账本条目清理），需要即时切换的用管理器
     * refreshAura 整体重建（exit→enter 天然切换）。
     * @param {object} changed - 文档更新 diff
     * @override
     */
    _onUpdate(changed) {
        super._onUpdate(changed);
        const sys = changed?.system;
        if (!sys || !RANGE_FIELDS.some(f => f in sys)) return;
        // 数据库写操作只在活动 GM 端执行，其余端经文档同步自然收敛
        if (!game.users.activeGM?.isSelf) return;
        // 手动改朝向后同步参数快照：refreshAura 依赖快照的 "auto" 判断
        // 是否恢复按源朝向吸附——不同步的话，手动固定值会被重建覆盖
        if ("quarterTurns" in sys) {
            this.region?.update({"flags.xjzl-system.aura.params.quarterTurns": this.quarterTurns})
                ?.catch(err => console.error("XJZL | 光环朝向快照同步失败:", err));
        }
        this.#rebuildOffsets();
    }

    /**
     * 按当前 system 参数与现有形状原点重算并写回 grid offsets。
     * origin 必须显式存在（管理器创建时写入锚格格心）：缺失时无法区分
     * 生成器锚格与 offsets 首格（核心 origin 兜底取首格格心），猜测会
     * 造成范围偏移，故警告并跳过重算。
     */
    async #rebuildOffsets() {
        const region = this.region;
        const grid = region?.parent?.grid;
        if (!region || !grid || grid.isGridless) return;
        const shape = region.shapes.find(s => (s.type === "grid") || Array.isArray(s.offsets));
        const origin = shape?.origin ?? shape?._source?.origin;
        if (!shape?.offsets?.length || !origin) {
            console.warn(`XJZL | 光环 region「${region.name}」的 grid 形状缺少 origin，跳过范围重算（中心不可靠）。`);
            return;
        }
        if (this.shapeKind !== "rect" && (!Number.isInteger(this.radius) || this.radius < 0)) return;
        let rel = this.shapeKind === "rect"
            ? generateRectangleOffsets({
                width: this.rectWidth, height: this.rectHeight,
                anchorX: this.anchorX, anchorY: this.anchorY
            })
            : generateCircleOffsets(this.radius);
        if (this.quarterTurns) rel = rotateOffsets90(rel, this.quarterTurns);
        const offsets = toCoreOffsets(rel, grid.getOffset(origin));
        const key = o => `${o.i}.${o.j}`;
        const before = shape.offsets.map(key).sort().join();
        const after = offsets.map(key).sort().join();
        if (before === after) return;
        try {
            // origin 原样写回（改半径不移心）；丢失会使下次重算失去锚格
            await region.update({shapes: [{type: "grid", offsets, origin}]});
        } catch (err) {
            console.error("XJZL | 光环范围重算失败:", err);
        }
    }

    /**
     * 在 init 阶段注册数据模型与配置页图标。
     * 类型还须在 system.json 声明；模型必须先于本地化扫描注册。
     */
    static register() {
        CONFIG.RegionBehavior.dataModels.xjzlAura = XJZLAuraRegionBehaviorType;
        // 配置页直接读取 typeIcons，必须显式注册。
        CONFIG.RegionBehavior.typeIcons.xjzlAura = "fas fa-hurricane";
        // 配置页顶部的引导说明
        CONFIG.RegionBehavior.typeHints.xjzlAura = "XJZL.AuraBehavior.TYPE_HINT";
        // sheetClasses 按"类型"的条目由核心在数据类型就绪后生成，注册须等
        // 其存在：setup 兜底 ready 各执行一次（registerSheet 幂等）
        const registerWhenReady = () => {
            if (CONFIG.RegionBehavior.sheetClasses?.xjzlAura) XJZLAuraBehaviorConfig.registerSheet();
        };
        Hooks.once("setup", registerWhenReady);
        Hooks.once("ready", registerWhenReady);
        console.log("XJZL | xjzlAura 行为类型已注册");
    }
}

/**
 * 光环行为的配置页：覆盖核心的字段平铺逻辑，按使用动线分组——
 * 范围 → 对谁生效 → 自动挂载特效 → 进入生效 → 回合生效 → 离开时。
 * 核心把 SchemaField 递归平铺且不渲染节标题（#addSystemFields），
 * 嵌套的动作参数与开关混在一起无法阅读，故子类化重排。
 */
class XJZLAuraBehaviorConfig extends foundry.applications.sheets.RegionBehaviorConfig {

    /** 注册为 xjzlAura 的默认配置页（保留核心条目可切回）。 */
    static registerSheet() {
        const registry = CONFIG.RegionBehavior.sheetClasses.xjzlAura;
        const core = registry["core.RegionBehaviorConfig"];
        if (core) core.default = false;
        registry["xjzl.AuraBehaviorConfig"] = {
            id: "xjzl.AuraBehaviorConfig",
            label: "XJZL.AuraBehavior.SECTIONS.title",
            themes: core?.themes ?? {},
            canBeDefault: true,
            canConfigure: false,
            cls: XJZLAuraBehaviorConfig,
            default: true
        };
    }

    /**
     * @override 按使用动线把字段分入多个 fieldset。
     * 动作子字段（enterAction/roundAction）从我们数据模型的 SchemaField
     * 展开，取值路径与核心 #addSystemFields 一致。
     */
    _getFields() {
        const doc = this.document;
        const source = doc._source;
        // 行为自有字段在数据模型（xjzlAura）的 schema 上，不在 RegionBehavior
        // 文档 schema 上（后者只有 name/disabled/flags 等公共字段）
        const f = CONFIG.RegionBehavior.dataModels.xjzlAura.schema.fields;
        const pick = (field, path) => ({field, value: foundry.utils.getProperty(source, path)});
        const ea = f.enterAction.fields;
        const ra = f.roundAction.fields;

        return [
            // 行为本体
            {fieldset: true, legend: "BEHAVIOR.SECTIONS.identity", fields: [pick(doc.schema.fields.name, "name")]},
            {fieldset: true, legend: "BEHAVIOR.SECTIONS.status", fields: [pick(doc.schema.fields.disabled, "disabled")]},
            // 范围
            {fieldset: true, legend: "XJZL.AuraBehavior.SECTIONS.range", fields: [
                pick(f.radius, "system.radius"),
                pick(f.shapeKind, "system.shapeKind"),
                pick(f.rectWidth, "system.rectWidth"),
                pick(f.rectHeight, "system.rectHeight"),
                pick(f.anchorX, "system.anchorX"),
                pick(f.anchorY, "system.anchorY"),
                pick(f.quarterTurns, "system.quarterTurns")
            ]},
            // 对谁生效
            {fieldset: true, legend: "XJZL.AuraBehavior.SECTIONS.target", fields: [
                pick(f.faction, "system.faction"),
                pick(f.includeSelf, "system.includeSelf")
            ]},
            // 自动挂载特效（进入生效时挂；回合生效选"挂载特效"时也用它）
            {fieldset: true, legend: "XJZL.AuraBehavior.SECTIONS.effect", fields: [
                pick(f.payloadItemUuid, "system.payloadItemUuid"),
                pick(f.payloadEffectName, "system.payloadEffectName")
            ]},
            // 进入生效
            {fieldset: true, legend: "XJZL.AuraBehavior.SECTIONS.enter", fields: [
                pick(f.enterEnabled, "system.enterEnabled"),
                pick(ea.kind, "system.enterAction.kind"),
                pick(ea.amount, "system.enterAction.amount"),
                pick(ea.type, "system.enterAction.type"),
                pick(ea.pierce, "system.enterAction.pierce"),
                pick(f.moveWithin, "system.moveWithin"),
                pick(f.throttlePerRound, "system.throttlePerRound")
            ]},
            // 回合生效
            {fieldset: true, legend: "XJZL.AuraBehavior.SECTIONS.round", fields: [
                pick(f.roundEnabled, "system.roundEnabled"),
                pick(f.roundTiming, "system.roundTiming"),
                pick(ra.kind, "system.roundAction.kind"),
                pick(ra.amount, "system.roundAction.amount"),
                pick(ra.type, "system.roundAction.type"),
                pick(ra.pierce, "system.roundAction.pierce")
            ]},
            // 离开时
            {fieldset: true, legend: "XJZL.AuraBehavior.SECTIONS.exit", fields: [
                pick(f.exitClear, "system.exitClear")
            ]}
        ];
    }

    /**
     * 条件显隐：圆形隐藏矩形参数；动作选"无/挂载特效"隐藏数值与类型；
     * 类型下拉跟随动作切换（伤害类型 / 恢复资源）；"无视防御"仅伤害时有意义。
     * 纯前端显隐与选项过滤，不改变存储结构。
     */
    _onRender(context, options) {
        super._onRender(context, options);
        const root = this.element;
        const groupOf = name => root.querySelector(`[name="${name}"]`)?.closest(".form-group");

        // 形状 → 矩形参数显隐
        const shapeSel = root.querySelector('select[name="system.shapeKind"]');
        const rectGroups = ["system.rectWidth", "system.rectHeight", "system.anchorX", "system.anchorY", "system.quarterTurns"]
            .map(groupOf);
        const syncShape = () => {
            const isRect = shapeSel?.value === "rect";
            for (const g of rectGroups) if (g) g.style.display = isRect ? "" : "none";
        };
        shapeSel?.addEventListener("change", syncShape);
        syncShape();

        // 动作 → 参数显隐 + 类型选项过滤
        const DAMAGE_TYPES = ["waigong", "neigong", "bleed", "poison", "mental", "fire", "liushi"];
        const HEAL_RESOURCES = ["hp", "mp", "tili", "rage", "huti"];
        const syncAction = prefix => {
            const kindSel = root.querySelector(`select[name="${prefix}.kind"]`);
            const typeSel = root.querySelector(`select[name="${prefix}.type"]`);
            const typeG = groupOf(`${prefix}.type`);
            const amountG = groupOf(`${prefix}.amount`);
            const pierceG = groupOf(`${prefix}.pierce`);
            if (!kindSel) return;
            const sync = () => {
                const kind = kindSel.value;
                const showParams = kind === "damage" || kind === "healing";
                if (typeG) typeG.style.display = showParams ? "" : "none";
                if (amountG) amountG.style.display = showParams ? "" : "none";
                // 无视防御只有伤害有语义
                if (pierceG) pierceG.style.display = kind === "damage" ? "" : "none";
                if (typeSel && showParams) {
                    const allow = kind === "healing" ? HEAL_RESOURCES : DAMAGE_TYPES;
                    let currentValid = false;
                    for (const opt of typeSel.options) {
                        const allowed = allow.includes(opt.value);
                        opt.hidden = !allowed;
                        if (allowed && opt.selected) currentValid = true;
                    }
                    // 当前值不属于所选动作 → 自动切到该组第一项（仅表单层，未提交不写库）
                    if (!currentValid) typeSel.value = allow[0];
                }
            };
            kindSel.addEventListener("change", sync);
            sync();
        };
        syncAction("system.enterAction");
        syncAction("system.roundAction");
    }
}

/* -------------------------------------------- */
/*  事件 handler（this 绑定行为实例）              */
/* -------------------------------------------- */

/**
 * 进入结算：发起者端 isSelf 门控单端转发，结算经队列落活动 GM。
 * 无 Actor 的纯装饰 Token 不参与结算。
 * @param {RegionTokenEnterEvent} event - 核心 Region 事件
 * @this {XJZLAuraRegionBehaviorType}
 */
function onTokenEnter(event) {
    if (!event.user.isSelf || !this.enterEnabled) return;
    const token = event.data?.token;
    if (!token?.actor) return;
    AuraLedger.submitEnter(opBase(this, token), xjzlSocket);
}

/**
 * 退出结算：与 enter 对称；入队时快照账本条目——region 删除补发的 exit
 * 在 region 消失后才会被结算，快照是摘除凭据。退出摘除
 * 与 enterEnabled 无关：进入时挂上的 AE 在任何情况下都必须被摘除。
 * @param {RegionTokenExitEvent} event - 核心 Region 事件
 * @this {XJZLAuraRegionBehaviorType}
 */
function onTokenExit(event) {
    if (!event.user.isSelf) return;
    const token = event.data?.token;
    if (!token?.actor) return;
    // 快照该目标全部有效条目；条目自足（含 exitClear/slug），
    // region 删除后行为配置不可达时快照是摘除凭据；配置页更换 payload
    // 引用后旧键条目也随同一次退出清理。
    const snapshots = this.region
        ? Object.entries(AuraLedger.getEntriesOfToken(this.region, token.id))
            .filter(([, entry]) => entry?.active)
            .map(([key, entry]) => ({key, entry}))
        : [];
    AuraLedger.submitExit(opBase(this, token), snapshots, xjzlSocket);
}

/**
 * 区域内部移动结算：纯区域内移动的分流与 movement.id 去重
 * 在队列执行端判定，这里只转发精简后的移动数据（避免整份 movement 过 socket）。
 * @param {RegionTokenMoveWithinEvent} event - 核心 Region 事件
 * @this {XJZLAuraRegionBehaviorType}
 */
function onTokenMoveWithin(event) {
    if (!event.user.isSelf || !this.moveWithin) return;
    const token = event.data?.token;
    const movement = event.data?.movement;
    if (!token?.actor || !movement?.id) return;
    AuraLedger.submitMoveWithin(opBase(this, token), {
        id: movement.id,
        origin: movement.origin ? {x: movement.origin.x, y: movement.origin.y} : null,
        destination: movement.destination ? {x: movement.destination.x, y: movement.destination.y} : null
    }, xjzlSocket);
}

/**
 * 回合结算（tokenTurnStart/End、tokenRoundStart/End）。round>=1 的
 * 战斗开始边界门控与 timing 匹配在队列执行端判定。
 * @param {RegionEvent} event - 核心 Region 事件（data 携带 token/combatant/combat/round）
 * @this {XJZLAuraRegionBehaviorType}
 */
function onTokenRoundTurn(event) {
    if (!event.user.isSelf || !this.roundEnabled) return;
    const token = event.data?.token;
    if (!token?.actor) return;
    AuraLedger.submitRound({
        ...opBase(this, token),
        timing: event.name,
        combatId: event.data?.combat?.id ?? null,
        round: event.data?.round ?? null
    }, xjzlSocket);
}

/**
 * 构造队列入队参数。payloadKey 在本端（配置在手）计算并随操作携带，
 * 保证同一目标＋payload 的 enter/exit 落入同一条串行队列；串行键按目标
 * Actor——链接 Actor 的 uuid 跨 Token 一致，合成 Actor 的
 * uuid 即 Token uuid，因此同一 Actor 的多个 Token 落同一队列。
 * @param {XJZLAuraRegionBehaviorType} behavior - 行为实例
 * @param {TokenDocument} token - 事件目标 Token
 * @returns {object} {behaviorId, regionUuid, tokenUuid, actorUuid, payloadKey}
 */
function opBase(behavior, token) {
    const behaviorId = behavior.parent?.id ?? null;
    return {
        behaviorId,
        regionUuid: behavior.region?.uuid ?? null,
        tokenUuid: token.uuid,
        actorUuid: token.actor?.uuid ?? token.uuid,
        payloadKey: payloadKeyOf(behavior, behaviorId)
    };
}

/**
 * 在 init 阶段注册 xjzlAura 模型和配置页图标（模块级导出，供主入口调用）。
 * 类型还须在 system.json 声明；模型须先于本地化扫描注册。
 */
export function registerAuraBehavior() {
    XJZLAuraRegionBehaviorType.register();
}
