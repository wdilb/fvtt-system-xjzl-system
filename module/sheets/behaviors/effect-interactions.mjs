/**
 * 特效（Active Effect）卡片交互的共享逻辑
 * ==========================================
 * 人物卡与野兽卡共用：显示非被动 AE、左键加层 / 右键减层、
 * 设置持续时间、删除。原本内联在 XJZLCharacterSheet 中，此处抽出为
 * 普通函数，两张 Sheet 以委托方式调用，避免重复实现。
 */
import { ActiveEffectManager } from "../../managers/active-effect-manager.mjs";
import { XJZLActiveEffect } from "../../documents/active-effect.mjs";

/**
 * 准备特效数据，把 AE 分为 temporary（非被动）与 passive（被动）两类。
 * @param {object} sheet  Sheet 实例（取 sheet.actor）
 * @param {object} context  模板上下文（写入 temporaryEffects / passiveEffects）
 */
export function prepareEffects(sheet, context) {
    const temporaryEffects = [];
    const passiveEffects = [];

    // 1. 使用 appliedEffects (包含装备衍生的特效)
    const effects = sheet.actor.appliedEffects;

    for (const e of effects) {
        // 过滤掉被禁用的
        if (e.disabled) continue;

        // 2. 准备显示数据
        // 核心 sourceName 解析 origin；无法解析时回退到内嵌物品名。
        let source = e.sourceName;
        if (source === "Unknown" || !source) {
            if (e.parent instanceof Item) source = e.parent.name;
            else source = "未知来源";
        }

        // 在页面处理了叠层的显示，所以这里直接用 e.name
        const displayName = e.name;

        // 计算持续时间简写：V14 统一走管理器的派生数据标签（支持 轮/回合/秒）
        const durationLabel = ActiveEffectManager.getDurationLabel(e);

        const effectData = {
            id: e.id,
            name: displayName,
            img: e.img,
            description: e.description,
            sourceName: source,
            isItemEffect: (e.parent instanceof Item) && e.transfer,
            // 核心 Actor 卡拖拽只查询 actor.effects；物品衍生效果必须保持不可拖。
            isActorEffect: e.parent instanceof Actor,
            isStackable: e.isStackable,
            stacks: e.stacks,
            durationLabel: durationLabel,
            duration: e.duration
        };

        // 3. 核心分类逻辑
        const isTemp = e.isTemporary;
        const isActiveBuff = e.transfer === false;

        if (isTemp || isActiveBuff) {
            temporaryEffects.push(effectData);
        } else {
            passiveEffects.push(effectData);
        }
    }

    context.temporaryEffects = temporaryEffects;
    context.passiveEffects = passiveEffects;
}

/**
 * 统一处理特效交互（委托模式）
 * @param {object} sheet  Sheet 实例
 * @param {Event} event
 * @param {Number} change  1(左键/增加) 或 -1(右键/减少)
 */
export async function onEffectAction(sheet, event, change) {
    const chip = event.target.closest(".interactive-effect");
    if (!chip) return;

    // 排除删除按钮等带 data-action 的元素
    if (event.target.closest(".effect-delete") || event.target.closest("[data-action]")) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    // 防抖锁：防止狂点导致数据库请求阻塞
    if (sheet._effectProcessing) return;

    const effectId = chip.dataset.effectId;
    const effect = sheet.actor.effects.get(effectId);
    if (!effect) return;

    sheet._effectProcessing = true;

    try {
        const isStackable = effect.isStackable;
        const currentStacks = effect.stacks || 1;

        if (change > 0) {
            // 增加层数
            if (!isStackable) {
                await promptEffectDuration(sheet, effect);
            } else {
                await ActiveEffectManager.addEffect(sheet.actor, effect.toObject(), 1);
            }
        } else {
            // 减少层数
            if (!isStackable) return;

            if (currentStacks > 1) {
                await ActiveEffectManager.removeEffect(sheet.actor, effect.id, 1);
            } else {
                ui.notifications.info(`"${effect.name}" 当前只有 1 层。如需移除请点击删除按钮。`);
            }
        }
    } catch (err) {
        console.error(err);
    } finally {
        sheet._effectProcessing = false;
    }
}

/**
 * 修改特效持续时间的弹窗
 * @param {object} sheet  Sheet 实例（保留参数以便未来扩展，当前未使用）
 * @param {ActiveEffect} effect
 */
export async function promptEffectDuration(sheet, effect) {
    // 1. 默认显示值统一换算成“回合”口径（输入框写入的也是 rounds）：
    //    战斗内的回合/轮时长，核心派生 remaining 就是剩余回合/轮数，可直接用；
    //    战斗外的回合时长与秒制时长都被核心折算成秒计时（remaining 为秒数），
    //    必须按 roundTime 回推回合数，否则会把秒数当回合数填入而放大时长；
    //    无限特效（value 非有限）回退 0，对应界面“0=无限”语义
    const d = effect.duration;
    let defaultVal = 0;
    if (d && Number.isFinite(d.value)) {
        const roundTime = CONFIG.time?.roundTime || 2; // 侠界默认2秒一轮
        const inCombat = (d.units === "rounds" || d.units === "turns") && game.combat?.round;
        defaultVal = inCombat
            ? Math.max(0, Math.floor(d.remaining ?? 0))
            : Math.max(0, Math.ceil((d.secondsRemaining ?? 0) / roundTime));
        // 防御：折算源异常导致剩余量为 Infinity 时回退总时长，
        // 避免 Infinity 进入输入框后被 parseInt 归零而把效果误存为无限
        if (!Number.isFinite(defaultVal)) defaultVal = d.value;
    }

    // 保持原时长单位：turns 单位的效果保存后仍是 turns（轮），弹窗标签同步切换，
    // 否则会把“剩余 N 轮”保存成 N 回合而改变到期语义；其余单位统一按回合写入。
    // 战斗外核心把 turns 的派生数据改写为秒制展示，须回读 _source 才能识别原单位
    const useTurns = d?.units === "turns" || effect._source?.duration?.units === "turns";
    const unitLabel = useTurns ? "轮" : "回合";

    const content = `
        <div class="form-group" style="display:flex; align-items:center; gap:10px; margin-bottom:15px;">
            <label style="flex: 0 0 auto; white-space: nowrap; font-weight:bold;">持续时间 (${unitLabel}):</label>
            <div style="flex: 1;">
                <input type="number" name="rounds" value="${defaultVal}" min="0" step="1" autofocus style="text-align:center; width: 100%;">
            </div>
        </div>

        <div style="background: rgba(0, 0, 0, 0.05); padding: 8px; border-radius: 4px; font-size: 0.85em; color: #555; line-height: 1.4;">
            <p style="margin-bottom: 5px;">
                <i class="fas fa-exclamation-circle"></i> <b>机制说明：</b><br>
                点击更新将<b>重置</b>该状态的开始时间。<br>
                设定为 <b>X</b>，意味着<b>从当前时刻起</b>，该状态还将持续 X 回合。
            </p>
            <p style="margin: 0;">
                <i class="fas fa-clock"></i> <b>结束时机：</b><br>
                将在当前角色的第 X 个回合<b>开始时</b>自动移除。
            </p>
            <p style="margin-top: 5px; color: #888;">(设为 0 代表无限持续)</p>
        </div>
    `;

    const result = await foundry.applications.api.DialogV2.wait({
        window: {
            title: `调整: ${effect.name}`,
            icon: "fas fa-stopwatch",
            width: 320
        },
        content: content,
        buttons: [{
            action: "ok",
            label: "更新时长",
            icon: "fas fa-check",
            default: true,
            callback: (event, button, dialog) => {
                const input = button.form.elements.rounds;
                return parseInt(input.value) || 0;
            }
        }],
        rejectClose: false
    });

    if (result === null) return;

    // V14 duration 结构：0 是界面上的"无限"语义，必须写 value:null + expiry:null，
    // 不能把 0 直接当作 0 回合时长写入；回合/轮时长依 turnStart 到期事件结算
    const updateData = {
        duration: result > 0
            ? { value: result, units: useTurns ? "turns" : "rounds", expiry: "turnStart", expired: false }
            : { value: null, units: useTurns ? "turns" : "rounds", expiry: null, expired: false },
        // 修改时间时必须重置开始锚点，否则按旧开始时间计算会刚改完就过期。
        // V14 锚点在顶层 start（世界时间 + 当前战斗位置），由核心静态方法取当前值
        start: XJZLActiveEffect.getEffectStart()
    };

    await effect.update(updateData);

    if (result > 0) {
        ui.notifications.info(`${effect.name} 剩余时间已重置为 ${result} ${unitLabel}。`);
    } else {
        ui.notifications.info(`${effect.name} 已设为无限持续。`);
    }
}

/**
 * 删除特效
 * @param {object} sheet  Sheet 实例
 * @param {Event} event
 * @param {HTMLElement} target
 */
export async function onDeleteEffect(sheet, event, target) {
    const effect = sheet.document.effects.get(target.dataset.id);
    if (effect) {
        await effect.delete();
        ui.notifications.info(`已移除状态: ${effect.name}`);
    }
}
