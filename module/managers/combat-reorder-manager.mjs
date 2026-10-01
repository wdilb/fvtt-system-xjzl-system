/**
 *  先攻拖拽重排管理器 (Combat Reorder Manager)
 * 在战斗追踪器中直接拖拽条目来调整先攻顺序（V14 核心不支持，替代已失效的第三方模块）。
 *
 * 取值规则（整数方案，不产生小数）：
 * - 插入点上下邻差 >= 2：取中间偏下的整数，只改拖拽者。
 * - 差 == 1：没有整数空隙，把链短的一侧挤开（下方链 -1 / 上方链 +1），
 *   等长时向下挤，保住顶部高先攻。
 * - 上下邻并列：两侧各挤 1 点，拖拽者取原值。
 * - 挤开级联沿"相邻差 <= 1 的连续链"传播（并列差 0 与差 1 都会反序，必须继续），
 *   遇到自然空隙（差 >= 2）即停止，最坏改动约半个列表。
 * - 分组条目折叠为单一虚拟条目参与计算，移动时整组移动（只改组先攻值，
 *   成员先攻在 prepare 时自动继承组值，无需逐个更新）。
 *
 * 权限：仅 GM 可拖拽。战斗中改先攻不会误触系统的回合结算管线：
 * 成员变更走 updateEmbeddedDocuments 单文档操作路径，核心
 * Combatant._preUpdateOperation 会锁定当前行动者并以 turnEvents:false 执行；
 * 组先攻走父级 combat.update（groups 集合更新无重排、无回合事件），均不携带
 * turn 语义，系统的 updateCombat 钩子（依赖 updateData 含 turn/round）不会被触发。
 */
export class CombatReorderManager {

    /**
     * 注册战斗追踪器渲染钩子，为 GM 装配拖拽能力。
     */
    static init() {
        Hooks.on("renderCombatTracker", (app, element) => this._wireTracker(element));
        // 本管理器在 ready 钩子才注册，而核心侧边栏在此之前可能已完成首次渲染；
        // 补装配已存在的追踪器，否则首次加载后要等下一次重渲染才有拖拽能力。
        const element = ui.combat?.element;
        if (element) this._wireTracker(element);
    }

    /* -------------------------------------------- */
    /*  纯算法（不触碰 DOM，供测试直接调用）          */
    /* -------------------------------------------- */

    /**
     * 把 Combat.turns 折叠为有序条目列表：组及其成员折叠为单一虚拟条目。
     * 条目按核心排序语义排列（先攻降序，null 视为 -Infinity 沉底）。
     * @param {Combat} combat                      目标战斗
     * @returns {{key: string, kind: "combatant"|"group", id: string, initiative: number|null}[]}
     *   key 形如 `c:<combatantId>` / `g:<groupId>`，id 为对应文档 id。
     */
    static collectUnits(combat) {
        const units = [];
        const seenGroups = new Set();
        for (const c of combat.turns) {
            // prepare 后组内成员的 group 属性指向 CombatantGroup 文档，先攻已被组值覆盖。
            const group = c.group;
            if (group) {
                // 同组成员可能在排序中相邻出现，组条目只收集一次。
                if (seenGroups.has(group.id)) continue;
                seenGroups.add(group.id);
                units.push({
                    key: `g:${group.id}`,
                    kind: "group",
                    id: group.id,
                    initiative: Number.isFinite(group.initiative) ? group.initiative : c.initiative
                });
            } else {
                units.push({key: `c:${c.id}`, kind: "combatant", id: c.id, initiative: c.initiative});
            }
        }
        return units;
    }

    /**
     * 计算拖拽重排结果。
     * @param {object[]} units            collectUnits 产出的折叠条目（当前顺序）
     * @param {string} draggedKey         被拖拽条目的 key
     * @param {string|null} aboveKey      插入点上方条目的 key；拖到最顶为 null
     * @param {string|null} belowKey      插入点下方条目的 key；拖到最底为 null
     * @returns {{units: object[], updates: {kind: string, id: string, initiative: number}[]}|null}
     *   updates 含拖拽者与被挤开条目的新先攻；无需变更（原地、组内部、null 区等）返回 null。
     */
    static computeReorder(units, draggedKey, aboveKey, belowKey) {
        const dragged = units.find(u => u.key === draggedKey);
        if (!dragged) return null;
        // 拖回自己原位置（插入点紧贴拖拽者任一侧）：位置不变。
        if (aboveKey === draggedKey || belowKey === draggedKey) return null;
        // 插入点落在同组成员之间：组内顺序不可控，视为无操作。
        if (aboveKey !== null && aboveKey === belowKey) return null;

        // 在移除拖拽者后的虚拟列表中验证落点：折叠列表中组条目占据组首个成员
        // 的位置，而显示顺序里被散人穿插开的同组成员会让拖拽者的原位落在该组
        // 条目"内部"，保留拖拽者做相邻性检查会把合法落点误判为不相邻。
        const list = units.filter(u => u.key !== draggedKey);
        // aboveKey/belowKey 为 null 表示拖到列表顶部/底部，属合法输入，不能用 falsy 判断。
        const aboveIdx = aboveKey !== null ? list.findIndex(u => u.key === aboveKey) : -1;
        const belowIdx = belowKey !== null ? list.findIndex(u => u.key === belowKey) : -1;
        if (aboveKey !== null && aboveIdx < 0) return null;
        if (belowKey !== null && belowIdx < 0) return null;
        // 防御：上下邻在虚拟列表里必须相邻。
        if (aboveIdx >= 0 && belowIdx >= 0 && belowIdx !== aboveIdx + 1) return null;

        const val = u => Number.isFinite(u.initiative) ? u.initiative : null;
        const A = aboveIdx >= 0 ? val(list[aboveIdx]) : null;
        const B = belowIdx >= 0 ? val(list[belowIdx]) : null;
        const updates = [];

        if (A !== null && B !== null) {
            const diff = A - B;
            if (diff >= 2) {
                // 正常空隙：取中间值四舍五入（24/21 中间取 23），严格落在 (B, A) 内。
                // max 兜底历史小数先攻：B 为小数时取整可能落到 B 之下，破坏排序。
                updates.push({...dragged, initiative: Math.max(B + 1, Math.round((A + B) / 2))});
            } else if (diff > 0) {
                // 无整数空隙（整数差 1，或历史小数造成的窄缝）：挤开链短的一侧，
                // 等长向下挤（少动顶部高先攻）。
                const downChain = this._buildChain(list, belowIdx, +1);
                const upChain = this._buildChain(list, aboveIdx, -1);
                if (downChain.length <= upChain.length) {
                    updates.push({...dragged, initiative: B});
                    for (const u of downChain) updates.push({...u, initiative: val(u) - 1});
                } else {
                    updates.push({...dragged, initiative: A});
                    for (const u of upChain) updates.push({...u, initiative: val(u) + 1});
                }
            } else {
                // 并列（差 0；差为负不可能，仅防御）：两侧各挤 1 点，拖拽者取原值。
                const downChain = this._buildChain(list, belowIdx, +1);
                const upChain = this._buildChain(list, aboveIdx, -1);
                updates.push({...dragged, initiative: A});
                for (const u of downChain) updates.push({...u, initiative: val(u) - 1});
                for (const u of upChain) updates.push({...u, initiative: val(u) + 1});
            }
        } else if (A !== null && B === null) {
            // 下方是未掷先攻的 null 区（或列表底部）：直接排到上邻之下。
            updates.push({...dragged, initiative: A - 1});
        } else if (A === null && B !== null) {
            // 拖到列表顶部（下方首位先攻有限值）：排到其上。
            updates.push({...dragged, initiative: B + 1});
        } else {
            // 上下都是 null：null 区内部或全列表无先攻，顺序按 ID 不可控，无操作。
            return null;
        }

        // 拖拽者新值与旧值相同（如并列区取原值且两侧无链）时无需写入。
        const changed = updates.filter(u => u.initiative !== units.find(x => x.key === u.key)?.initiative);
        return changed.length ? {units, updates: changed} : null;
    }

    /**
     * 从插入点邻位开始，沿某方向收集需要级联挤开的连续"紧贴链"。
     * 折叠列表为先攻降序（索引 0 最高），"向下"（先攻更低方向）即索引增大。
     * 链的终止条件：先攻为 null（未掷），或与链内前一个条目相差 >= 2（自然空隙）。
     * 相邻差 0（并列）与差 1 都必须继续级联，否则挤开后会反序或并序。
     * @param {object[]} list       移除拖拽者后的折叠条目列表
     * @param {number} startIndex   链起点索引（插入点的邻位）
     * @param {number} step         方向：+1 向下收集（索引增大），-1 向上收集
     * @returns {object[]}          需要挤开的条目（含起点），按距插入点由近到远排序
     */
    static _buildChain(list, startIndex, step) {
        const chain = [];
        let prev = list[startIndex];
        if (finiteOrNull(prev) === null) return chain;
        chain.push(prev);
        for (let i = startIndex + step; i >= 0 && i < list.length; i += step) {
            const v = finiteOrNull(list[i]);
            if (v === null) break;
            // 向下时 prev 在上方：prev - v <= 1 继续；向上时 v 在上方：v - prev <= 1 继续。
            if (Math.abs(v - finiteOrNull(prev)) <= 1) {
                chain.push(list[i]);
                prev = list[i];
            } else break;
        }
        return chain;
    }

    /* -------------------------------------------- */
    /*  执行更新                                     */
    /* -------------------------------------------- */

    /**
     * 把计算结果提交为两次更新，顺序不可交换：
     * 1. 组先攻变更单独走父级 combat.update——groups 集合更新不会触发核心重排
     *    （Combat._onUpdate 只认 combatants 键）也不会触发回合事件，列表顺序与
     *    当前行动者此刻均未被扰动；
     * 2. 成员变更走 updateEmbeddedDocuments 单文档操作路径——只有这条路径会触发
     *    核心 Combatant._preUpdateOperation：按完整成员列表模拟新顺序，把当前
     *    回合锁定在第 1 步未扰动的原行动者上并以 turnEvents:false 执行。父级
     *    combat.update({combatants}) 不做该预处理（自定义选项也不可靠地到达各
     *    客户端），直接提交会让 Combat.turn 停在旧索引、当前行动者漂移；也不能
     *    改为在更新数据里携带 turn——系统 updateCombat 监听不检查 turnEvents，
     *    会误触发回合脚本。
     * 成员更新只含散人条目，不写组值：核心仅在派生阶段（_prepareGroup）让成员
     * 继承组值，把组值写进成员保存数据会破坏退组后恢复原先攻的语义。组位移的
     * 重排与模拟可见性由第 1 步先行提交的组值提供——本步的顺序模拟在 clone 中
     * prepare 成员时继承的已是新组值。纯组移动（无散人变更）时没有任何真实
     * combatant 变更，追加组内首个成员的 no-op 更新（写回其自身保存值）以触发
     * 全端重排与回合锁定；diff:false 保证它不被 diff 判空吞掉，写回自身值对
     * 保存数据零语义影响。
     * @param {Combat} combat   目标战斗（仅 GM 调用）
     * @param {object} result   computeReorder 的返回值 {units, updates}
     */
    static async applyReorder(combat, result) {
        const updates = result.updates;
        if (!updates.length) return;

        // 第 1 步：组先攻（惰性提交，不重排、不触发回合事件）。
        const groupUpdates = updates.filter(u => u.kind === "group")
            .map(u => ({_id: u.id, initiative: u.initiative}));
        if (groupUpdates.length) await combat.update({groups: groupUpdates});

        // 第 2 步：散人变更走嵌入文档操作路径，由核心锁定当前行动者。
        const memberUpdates = updates.filter(u => u.kind === "combatant")
            .map(u => ({_id: u.id, initiative: u.initiative}));
        if (!memberUpdates.length) {
            // 纯组移动：no-op 更新驱动重排（值 = 成员自身保存值，非组值）。
            const groupUpdate = updates.find(u => u.kind === "group");
            const member = [...(combat.groups.get(groupUpdate?.id)?.members ?? [])][0];
            if (!member) return;
            // null 是合法保存值（表示未独立掷过先攻），必须原样写回；不能用 ??
            // 回退到成员从组继承的显示值，否则未掷成员的保存数据会被污染成已掷。
            memberUpdates.push({_id: member.id, initiative: member._source.initiative});
        }
        await combat.updateEmbeddedDocuments("Combatant", memberUpdates, {diff: false});
    }

    /* -------------------------------------------- */
    /*  拖拽交互（DOM）                              */
    /* -------------------------------------------- */

    /**
     * 为战斗追踪器列表装配 HTML5 拖拽（仅 GM：核心允许 owner 修改自己的先攻，
     * 玩家端装配会获得可用的拖拽入口，先攻取值却按 GM 视野计算）。渲染钩子
     * 可能对同一元素重复触发，用 dataset 标记防止监听器叠加（drop 重复提交
     * 会造成多次更新）。
     * @param {HTMLElement} element   CombatTracker 根元素
     */
    static _wireTracker(element) {
        if (!game.user.isGM) return;
        const tracker = element.querySelector("ol.combat-tracker");
        if (!tracker || tracker.dataset.xjzlReorderWired) return;
        tracker.dataset.xjzlReorderWired = "true";
        for (const li of tracker.querySelectorAll("li.combatant")) {
            li.draggable = true;
            // 行内头像默认可独立拖拽，会抢先发起图片拖拽而非整行。
            const img = li.querySelector("img.token-image");
            if (img) img.draggable = false;
        }
        tracker.addEventListener("dragstart", event => this._onDragStart(event));
        tracker.addEventListener("dragover", event => this._onDragOver(event));
        tracker.addEventListener("dragleave", event => this._onDragLeave(event));
        tracker.addEventListener("drop", event => this._onDrop(event));
        tracker.addEventListener("dragend", event => this._onDragEnd(event));
    }

    /**
     * 计算当前指针位置对应的插入边界。
     * @param {DragEvent} event
     * @returns {{above: HTMLLIElement|null, below: HTMLLIElement|null}|null}
     *   插入点紧邻的两个 li；拖到列表顶部 above 为 null，底部 below 为 null。
     */
    static _findBoundary(event) {
        const lis = [...event.currentTarget.querySelectorAll("li.combatant")];
        if (!lis.length) return null;
        let below = null;
        for (const li of lis) {
            const rect = li.getBoundingClientRect();
            if (event.clientY < rect.top + rect.height / 2) {
                below = li;
                break;
            }
        }
        if (!below) return {above: lis[lis.length - 1], below: null};
        const idx = lis.indexOf(below);
        return {above: idx > 0 ? lis[idx - 1] : null, below};
    }

    /**
     * 把 li 解析为折叠条目 key；找不到对应 combatant（渲染间隙）返回 null。
     */
    static _liKey(li) {
        const combat = ui.combat.viewed;
        const c = combat?.combatants.get(li.dataset.combatantId);
        if (!c) return null;
        return c.group ? `g:${c.group.id}` : `c:${c.id}`;
    }

    static _onDragStart(event) {
        const li = event.target.closest?.("li.combatant");
        if (!li) return;
        // 先攻输入框内的文字选择拖拽是浏览器文本拖拽，不能当作条目重排处理。
        if (event.target.closest("input, textarea")) return;
        const key = this._liKey(li);
        if (!key) return;
        event.dataTransfer.setData("text/plain", key);
        event.dataTransfer.effectAllowed = "move";
        dragContext = {key};
        // 激活态类驱动整组降调样式，让落点指示成为拖拽中的视觉焦点。
        event.currentTarget.classList.add("xjzl-reorder-active");
        li.classList.add("xjzl-reorder-dragging");
    }

    static _onDragOver(event) {
        if (!dragContext) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const boundary = this._findBoundary(event);
        this._showIndicator(event.currentTarget, boundary);
    }

    static _onDragLeave(event) {
        if (!dragContext) return;
        // 相关目标仍在列表内（子元素间移动）时不清理，避免指示线闪烁。
        if (event.currentTarget.contains(event.relatedTarget)) return;
        this._clearIndicator(event.currentTarget);
    }

    static async _onDrop(event) {
        const context = dragContext;
        if (!context) return;
        event.preventDefault();
        const tracker = event.currentTarget;
        this._clearIndicator(tracker);
        dragContext = null;

        const combat = ui.combat.viewed;
        if (!combat) return;
        const boundary = this._findBoundary(event);
        if (!boundary) return;
        const aboveKey = boundary.above ? this._liKey(boundary.above) : null;
        const belowKey = boundary.below ? this._liKey(boundary.below) : null;
        // 上邻解析失败（如指向同组条目被折叠）时视为无操作。
        if ((boundary.above && !aboveKey) || (boundary.below && !belowKey)) return;

        const units = this.collectUnits(combat);
        const result = this.computeReorder(units, context.key, aboveKey, belowKey);
        if (result) await this.applyReorder(combat, result);
    }

    static _onDragEnd(event) {
        // drop 成功后 dragContext 已清空，此处只负责兜底清理视觉状态。
        const tracker = event.currentTarget;
        tracker.classList.remove("xjzl-reorder-active");
        tracker.querySelector("li.xjzl-reorder-dragging")?.classList.remove("xjzl-reorder-dragging");
        this._clearIndicator(tracker);
        dragContext = null;
    }

    /**
     * 在插入边界处显示指示线；边界两侧解析为同一折叠条目（同组内部）时不显示。
     */
    static _showIndicator(tracker, boundary) {
        this._clearIndicator(tracker);
        if (!boundary) return;
        const aboveKey = boundary.above ? this._liKey(boundary.above) : null;
        const belowKey = boundary.below ? this._liKey(boundary.below) : null;
        if (aboveKey && aboveKey === belowKey) return;
        if (boundary.below) boundary.below.classList.add("xjzl-reorder-line-top");
        else if (boundary.above) boundary.above.classList.add("xjzl-reorder-line-bottom");
    }

    static _clearIndicator(tracker) {
        for (const li of tracker.querySelectorAll("li.combatant")) {
            li.classList.remove("xjzl-reorder-line-top", "xjzl-reorder-line-bottom");
        }
    }
}

/**
 * 一次进行中的拖拽上下文；模块级持有，跨渲染钩子与事件回调共享。
 * @type {{key: string}|null}
 */
let dragContext = null;

/**
 * 读取条目的数值先攻；未掷先攻（null/undefined/NaN）统一归一为 null。
 * @param {{initiative: number|null}} unit
 * @returns {number|null}
 */
function finiteOrNull(unit) {
    return Number.isFinite(unit.initiative) ? unit.initiative : null;
}
