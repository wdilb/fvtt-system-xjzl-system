/**
 * 目标管理器：维护原生 ALT 瞄准，以及人工出招时的本地目标选择会话。
 * 选择会话只在本地绘制预览；确认后由调用方在进入脚本/扣费前同步原生目标。
 */

/**
 * 判断一次调用应走哪种目标来源。`skipTargetSelection` 的源数据值优先；
 * 招式缺省该字段时，架招按 true、其他招式按 false 处理。
 * @param {object} options - 出招选项；`targets` 即使为空数组也表示显式来源。
 * @param {object|null} move - 当前招式，用于识别 `stance` 架招类型。
 * @returns {"explicit"|"current"|"skip"|"interactive"} 目标来源模式
 */
export function getTargetSelectionMode(options = {}, move = null) {
    if (Object.prototype.hasOwnProperty.call(options, "targets")) return "explicit";
    if (options.skipDialog === true) return "current";
    const skip = options.skipTargetSelection ?? move?.skipTargetSelection ?? (move?.type === "stance");
    return skip ? "skip" : "interactive";
}

/**
 * 目标 Token 的最小结构校验。显式程序调用允许跨场景文档继续由原有权限代理结算，
 * 但必须是能提供 Token Document UUID 的对象，避免后续卡片写入静默生成坏快照。
 * @param {object} token - 预期为 Canvas Token
 * @returns {boolean} 是否能作为显式目标
 */
export function isExplicitTarget(token) {
    return Boolean(token?.document?.uuid && token?.actor);
}

/**
 * 校验并复制显式目标数组。
 * @param {unknown} targets - 调用方提供的 Token 数组
 * @returns {object[]} 去重后的 Token 数组
 * @throws {TypeError} 参数不是数组或包含非法目标
 */
export function normalizeExplicitTargets(targets) {
    if (!Array.isArray(targets)) {
        throw new TypeError("XJZL | options.targets 必须是 Token 数组（空数组表示明确无目标）。");
    }
    const result = [];
    const seen = new Set();
    for (const token of targets) {
        if (!isExplicitTarget(token)) {
            throw new TypeError("XJZL | options.targets 包含无效目标；目标必须有 actor 和 document.uuid。");
        }
        const uuid = token.document.uuid;
        if (seen.has(uuid)) continue;
        seen.add(uuid);
        result.push(token);
    }
    return result;
}

/**
 * 判断 Token 是否可以出现在人工目标选择器中。
 * 范围、目标说明和敌友关系不参与此判断；这里只过滤当前可感知且有 Actor 的 Token。
 * @param {object} token - Canvas Token
 * @param {object} scene - 当前场景
 * @returns {boolean} 是否可选
 */
export function isSelectableTarget(token, scene) {
    if (!token?.document || !token.actor || token.actor.type === "container") return false;
    if (scene && token.document.parent && token.document.parent !== scene) return false;
    if (token.isVisible === false || token.visible === false) return false;
    return true;
}

export class TargetManager {
    static _initialized = false;
    static _activeSelection = null;

    static init() {
        if (this._initialized) return;
        this._initialized = true;
        this._boundPointerDown = this._onPointerDown.bind(this);
        this._boundPointerUp = this._onSelectionPointerUp.bind(this);
        this._boundClick = this._onSelectionClick.bind(this);
        this._boundDoubleClick = this._onSelectionDoubleClick.bind(this);
        this._boundKeyDown = this._onSelectionKeyDown.bind(this);
        this._boundKeyUp = this._onSelectionKeyUp.bind(this);
        this._boundPointerMove = this._onSelectionPointerMove.bind(this);
        this._boundContextMenu = this._onSelectionContextMenu.bind(this);
        window.addEventListener("pointerdown", this._boundPointerDown, { capture: true });
        window.addEventListener("pointerup", this._boundPointerUp, { capture: true });
        window.addEventListener("click", this._boundClick, { capture: true });
        window.addEventListener("dblclick", this._boundDoubleClick, { capture: true });
        window.addEventListener("keydown", this._boundKeyDown, { capture: true });
        window.addEventListener("keyup", this._boundKeyUp, { capture: true });
        window.addEventListener("pointermove", this._boundPointerMove, { capture: true });
        window.addEventListener("contextmenu", this._boundContextMenu, { capture: true });
    }

    /**
     * 将出招调用统一解析为显式目标、旧的当前瞄准、跳过目标或人工会话。
     * @param {object} params - actor/sourceToken/display/options 等上下文
     * @returns {Promise<{targets: object[], resolved: boolean}|null>} null 表示取消或中止
     */
    static async resolveActionTargets({ actor, sourceToken = null, display = {}, options = {}, move = null } = {}) {
        const mode = getTargetSelectionMode(options, move);

        if (mode === "explicit") {
            return { targets: normalizeExplicitTargets(options.targets), resolved: true };
        }
        if (mode === "current") {
            // skipDialog 是既有无人值守契约：保留调用前的原生瞄准，不新增等待或同步。
            return { targets: this.getCurrentTargets(), resolved: false };
        }
        if (mode === "skip") {
            await this.syncTargets([]);
            return { targets: [], resolved: true };
        }

        const targets = await this.selectTargets({ actor, sourceToken, ...display });
        if (targets === null) return null;
        await this.syncTargets(targets);
        return { targets, resolved: true };
    }

    /** 获取当前用户原生瞄准的 Token 快照。 */
    static getCurrentTargets() {
        return Array.from(game.user?.targets ?? []);
    }

    /**
     * 以 replace 模式写入当前用户的原生目标。
     * @param {object[]} tokens - 已确认的 Token 数组
     * @returns {Promise<void>}
     */
    static async syncTargets(tokens) {
        if (!canvas?.tokens?.setTargets) return;
        const normalized = normalizeExplicitTargets(tokens);
        canvas.tokens.setTargets(normalized.map(token => token.id), { mode: "replace" });
    }

    /**
     * 开启人工选择会话。候选从空集合开始，不读取也不修改已有原生瞄准。
     * @param {object} params - 展示信息与来源 Actor/Token
     * @returns {Promise<object[]|null>} 确认目标、明确空数组，或取消的 null
     */
    static async selectTargets({ actor, sourceToken = null, name = "", range = "", targetInfo = "", description = "" } = {}) {
        if (this._activeSelection) {
            ui.notifications.warn(game.i18n.localize("XJZL.TargetSelection.Busy"));
            return null;
        }
        if (!canvas?.ready || !canvas.tokens || !canvas.scene) {
            ui.notifications.warn(game.i18n.localize("XJZL.TargetSelection.NoCanvas"));
            return null;
        }

        const state = {
            actor,
            scene: canvas.scene,
            sceneId: canvas.scene.id,
            sourceToken: this._resolveSourceToken(actor, sourceToken),
            name,
            range,
            targetInfo,
            selected: [],
            mode: "single",
            enteredMulti: false,
            hovered: null,
            shiftCodes: new Set(),
            settled: false,
            overlay: null,
            backdrop: null,
            preview: null,
            resolve: null,
            frame: null,
            lastFrameAt: performance.now(),
            pointer: null,
            edgeScroll: { x: 0, y: 0 },
            rightPointer: null,
            rightDragMoved: false,
            previewSignature: "",
            hookHandlers: []
        };
        this._activeSelection = state;
        const promise = new Promise(resolve => { state.resolve = resolve; });

        try {
            state.descriptionHtml = await this._enrichDescription(description);
            if (state.settled) return null;
            this._suspendSourceSheet(state);
            if (state.settled) return null;
            state.candidates = this._getCandidates(state.scene);
            state.backdrop = this._createBackdrop(state);
            state.overlay = this._createOverlay(state);
            state.preview = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            state.preview.classList.add("xjzl-target-selection-preview");
            state.preview.setAttribute("aria-hidden", "true");
            document.body.appendChild(state.preview);
            this._attachSelectionListeners(state);
            this._renderSelection(state);
            // 以屏幕坐标绘制，不依赖 Token 渲染子节点；移动、缩放画布后也保持贴合。
            // 边缘滚屏放在同一帧内推进，避免另起定时器与 Foundry 的画布生命周期竞速。
            const draw = timestamp => {
                if (state.settled) return;
                const elapsed = Math.min(50, Math.max(0, timestamp - state.lastFrameAt));
                state.lastFrameAt = timestamp;
                this._panSelectionAtEdge(state, elapsed);
                this._drawPreview(state);
                state.frame = requestAnimationFrame(draw);
            };
            this._drawPreview(state);
            state.frame = requestAnimationFrame(draw);
            return await promise;
        } catch (error) {
            console.error("XJZL | 目标选择会话启动失败：", error);
            await this._finishSelection(state, null);
            ui.notifications.error(game.i18n.localize("XJZL.TargetSelection.Failed"));
            return null;
        }
    }

    static _getCandidates(scene) {
        return (canvas.tokens.placeables ?? []).filter(token => isSelectableTarget(token, scene));
    }

    static _resolveSourceToken(actor, explicitToken) {
        const direct = explicitToken?.object ?? explicitToken;
        if (direct?.document && isSelectableTarget(direct, canvas.scene)) return direct;
        if (actor?.isToken && actor.token?.object?.document) return actor.token.object;

        const matches = (canvas.tokens.placeables ?? []).filter(token =>
            isSelectableTarget(token, canvas.scene) && token.actor?.uuid === actor?.uuid
        );
        const controlled = matches.filter(token => token.controlled);
        if (controlled.length === 1) return controlled[0];
        return matches.length === 1 ? matches[0] : null;
    }

    /** 创建只在题签和操作条上接受点击的全屏交互根节点。 */
    static _createOverlay(state) {
        const root = document.createElement("section");
        root.className = "xjzl-target-selection";
        root.setAttribute("role", "dialog");
        root.setAttribute("aria-label", game.i18n.localize("XJZL.TargetSelection.Title"));
        root.addEventListener("click", event => {
            const button = event.target.closest("[data-target-action]");
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();
            this._onOverlayAction(state, button.dataset.targetAction, button.dataset.uuid);
        });
        document.body.appendChild(root);
        return root;
    }

    /**
     * 创建不拦截画布事件的阶段遮罩，让目标选择成为明确的临时交互状态。
     * @param {object} state - 当前选择会话
     * @returns {HTMLElement} 遮罩根节点
     */
    static _createBackdrop(state) {
        const root = document.createElement("div");
        root.className = "xjzl-target-selection-backdrop";
        root.setAttribute("aria-hidden", "true");
        document.body.appendChild(root);
        return root;
    }

    /** 将会话绑定到当前场景，并在 Token 删除时移除对应预览与候选。 */
    static _attachSelectionListeners(state) {
        const canvasReady = scene => {
            if (scene?.id !== state.sceneId) void this._finishSelection(state, null);
        };
        const canvasTearDown = () => void this._finishSelection(state, null);
        const deleteToken = token => {
            const doc = token?.document ?? token;
            const uuid = doc?.uuid;
            if (!uuid) return;
            state.candidates = state.candidates.filter(target => target.document.uuid !== uuid);
            if (state.hovered?.document.uuid === uuid) state.hovered = null;
            if (state.sourceToken?.document?.uuid === uuid) {
                void this._finishSelection(state, null);
                return;
            }
            if (state.selected.some(target => target.document.uuid === uuid)) {
                state.selected = state.selected.filter(target => target.document.uuid !== uuid);
                ui.notifications.warn(game.i18n.localize("XJZL.TargetSelection.TargetRemoved"));
                this._renderSelection(state);
                this._drawPreview(state);
            }
        };
        if (typeof Hooks?.on === "function") {
            Hooks.on("canvasReady", canvasReady);
            Hooks.on("canvasTearDown", canvasTearDown);
            Hooks.on("deleteToken", deleteToken);
            state.hookHandlers.push(["canvasReady", canvasReady], ["canvasTearDown", canvasTearDown], ["deleteToken", deleteToken]);
        }
    }

    /** 会话中左键更新候选；右键单击取消，右键拖拽交给 Foundry 平移画布。 */
    static _onPointerDown(event) {
        const state = this._activeSelection;
        if (state && !state.settled) {
            if (event.button === 2) {
                const token = state.candidates
                    ? this._tokenAtPoint({ x: event.clientX, y: event.clientY }, state.candidates)
                    : null;
                if (isSelectableTarget(token, state.scene)) {
                    // Token 的 Pixi clickRight 在同一个 pointerdown 阶段就会控制 Token/打开 HUD；
                    // 这里必须在事件到达 Canvas 前截断，右键 Token 仍按“取消选择”处理。
                    this._suppressContextMenuUntil = Date.now() + 1000;
                    this._suppressClickUntil = Date.now() + 350;
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    void this._finishSelection(state, null);
                    return;
                }
                // 不能在 pointerdown 吃掉右键，否则 Foundry 的 Canvas._onDragRightMove
                // 永远收不到空白画布上的后续事件；空白处仍由 contextmenu 区分单击取消和拖拽平移。
                state.rightPointer = { x: event.clientX, y: event.clientY, moved: false };
                state.rightDragMoved = false;
                return;
            }
            if (event.target?.closest?.(".xjzl-target-selection")) return;
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            this._suppressClickUntil = Date.now() + 350;
            if (!this._isCanvasEvent(event) || !state.candidates) return;
            const token = this._tokenAtPoint({ x: event.clientX, y: event.clientY }, state.candidates);
            if (isSelectableTarget(token, state.scene)) this._toggleSelectionToken(state, token);
            return;
        }

        if (!game.settings.get("xjzl-system", "enableAltTargeting")) return;
        if (!event.altKey || event.button !== 0) return;
        if (!canvas?.ready || !canvas.tokens) return;
        const hoveredToken = canvas.tokens.hover;
        if (!isSelectableTarget(hoveredToken, canvas.scene)) return;

        event.preventDefault();
        event.stopPropagation();
        this._toggleTarget(hoveredToken);
    }

    static _onSelectionPointerUp(event) {
        const state = this._activeSelection;
        if (state && !state.settled && event.button === 2 && state.rightPointer) {
            const moved = state.rightPointer.moved;
            state.rightPointer = null;
            if (moved) {
                // 右拖已经完成平移；阻止松开后的原生菜单，但不要终结选择会话。
                state.rightDragMoved = true;
                this._suppressContextMenuUntil = Date.now() + 250;
            }
            return;
        }
        if (!state && Date.now() >= (this._suppressClickUntil ?? 0)) return;
        if (event.target?.closest?.(".xjzl-target-selection")) return;
        if (event.button !== 0 && event.button !== 2) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    static _onSelectionClick(event) {
        if (!this._activeSelection && Date.now() >= (this._suppressClickUntil ?? 0)) return;
        if (event.target?.closest?.(".xjzl-target-selection")) return;
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    static _onSelectionDoubleClick(event) {
        if (!this._activeSelection && Date.now() >= (this._suppressClickUntil ?? 0)) return;
        if (event.target?.closest?.(".xjzl-target-selection")) return;
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    /** 右键单击退出；右键拖拽只吃掉后续 contextmenu，避免打开 Token HUD 或浏览器菜单。 */
    static _onSelectionContextMenu(event) {
        if (!this._activeSelection && Date.now() >= (this._suppressContextMenuUntil ?? 0)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!this._activeSelection) return;
        if (this._activeSelection.rightDragMoved) {
            this._activeSelection.rightDragMoved = false;
            return;
        }
        void this._finishSelection(this._activeSelection, null);
    }

    /** 只在画布上保留鼠标引导，并计算屏幕边缘的连续滚屏方向。 */
    static _onSelectionPointerMove(event) {
        const state = this._activeSelection;
        if (!state || state.settled || !state.candidates) return;
        if (state.rightPointer && (event.buttons === undefined || (event.buttons & 2))) {
            const dx = event.clientX - state.rightPointer.x;
            const dy = event.clientY - state.rightPointer.y;
            if (Math.hypot(dx, dy) > 5) state.rightPointer.moved = true;
        }
        if (!this._isCanvasEvent(event)) {
            state.pointer = null;
            state.edgeScroll = { x: 0, y: 0 };
            return;
        }
        state.pointer = { x: event.clientX, y: event.clientY };
        const view = canvas.app?.view;
        const rect = view?.getBoundingClientRect?.();
        state.edgeScroll = this._getEdgeScrollVector(event.clientX, event.clientY, rect);
    }

    /**
     * 将靠近视口边缘的距离转成 -1 到 1 的相机方向；中心区域保持 0，避免误触滚屏。
     * @param {number} x - 指针屏幕 X
     * @param {number} y - 指针屏幕 Y
     * @param {DOMRect|object|null} rect - 画布视口矩形
     * @param {number} margin - 边缘感应宽度（CSS px）
     * @returns {{x: number, y: number}} 归一化滚屏方向
     */
    static _getEdgeScrollVector(x, y, rect, margin = 72) {
        if (!rect || !Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
        const edge = (position, start, end) => {
            if (position < start + margin) return -Math.min(1, (start + margin - position) / margin);
            if (position > end - margin) return Math.min(1, (position - (end - margin)) / margin);
            return 0;
        };
        return { x: edge(x, rect.left, rect.right ?? rect.left + rect.width), y: edge(y, rect.top, rect.bottom ?? rect.top + rect.height) };
    }

    /**
     * 用 Foundry 原生 pan 更新相机中心；速度按帧时长推进，且受当前缩放比例修正。
     * @param {object} state - 当前选择会话
     * @param {number} elapsed - 上一帧至今的毫秒数
     */
    static _panSelectionAtEdge(state, elapsed) {
        const { x, y } = state.edgeScroll ?? {};
        if ((!x && !y) || !canvas?.stage?.pivot || typeof canvas.pan !== "function") return;
        const scale = Math.max(0.1, Number(canvas.stage.scale?.x) || 1);
        const step = (elapsed / 16.667) * 10 / scale;
        canvas.pan({
            x: canvas.stage.pivot.x + (x * step),
            y: canvas.stage.pivot.y + (y * step)
        });
    }

    static _isCanvasEvent(event) {
        return event.target === canvas.app?.view || event.target?.id === "board";
    }

    static _onSelectionKeyDown(event) {
        const state = this._activeSelection;
        if (!state || this._isTextInput(event)) return;
        if (event.isComposing || event.keyCode === 229) return;

        if (event.key === "Shift") {
            if (event.repeat) return;
            const before = state.shiftCodes.size;
            state.shiftCodes.add(event.code || event.key);
            if (before === 0) this._toggleMode(state);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            this._confirmSelection(state, false);
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            void this._finishSelection(state, null);
        }
    }

    static _onSelectionKeyUp(event) {
        const state = this._activeSelection;
        if (!state || event.key !== "Shift") return;
        state.shiftCodes.delete(event.code || event.key);
    }

    static _isTextInput(event) {
        const target = event.target;
        if (!target?.matches) return false;
        return target.matches("input, textarea, select, [contenteditable='true']")
            || Boolean(target.closest?.("input, textarea, select, [contenteditable='true']"));
    }

    static _toggleMode(state) {
        state.mode = state.mode === "single" ? "multi" : "single";
        if (state.mode === "multi") state.enteredMulti = true;
        this._renderSelection(state);
    }

    static _onOverlayAction(state, action, uuid) {
        if (state.settled) return;
        switch (action) {
            case "mode":
                this._toggleMode(state);
                break;
            case "confirm":
                this._confirmSelection(state, false);
                break;
            case "empty":
                this._confirmSelection(state, true);
                break;
            case "clear":
                state.selected = [];
                this._renderSelection(state);
                this._drawPreview(state);
                break;
            case "remove":
                state.selected = state.selected.filter(token => token.document.uuid !== uuid);
                this._renderSelection(state);
                this._drawPreview(state);
                break;
            case "cancel":
                void this._finishSelection(state, null);
                break;
            default:
                break;
        }
    }

    static _toggleSelectionToken(state, token) {
        if (!state.candidates.includes(token)) return;
        if (state.mode === "multi") {
            const uuid = token.document.uuid;
            const exists = state.selected.some(target => target.document.uuid === uuid);
            state.selected = exists
                ? state.selected.filter(target => target.document.uuid !== uuid)
                : [...state.selected, token];
            this._renderSelection(state);
            this._drawPreview(state);
            return;
        }

        state.selected = [token];
        if (!state.enteredMulti) {
            void this._finishSelection(state, [token]);
            return;
        }
        // 从多选退回单选后的点击只替换候选，必须再次确认，避免误施展。
        this._renderSelection(state);
        this._drawPreview(state);
    }

    static _confirmSelection(state, allowEmpty) {
        const valid = state.selected.filter(token => isSelectableTarget(token, state.scene));
        if (valid.length !== state.selected.length) {
            state.selected = valid;
            ui.notifications.warn(game.i18n.localize("XJZL.TargetSelection.TargetRemoved"));
            this._renderSelection(state);
            this._drawPreview(state);
            return;
        }
        if (!allowEmpty && valid.length === 0) {
            ui.notifications.warn(game.i18n.localize("XJZL.TargetSelection.SelectFirst"));
            return;
        }
        if (state.actor && state.actor.isOwner === false) {
            ui.notifications.warn(game.i18n.localize("XJZL.TargetSelection.PermissionLost"));
            void this._finishSelection(state, null);
            return;
        }
        void this._finishSelection(state, allowEmpty ? [] : [...valid]);
    }

    static _tokenAtPoint(point, candidates) {
        if (!point) return null;
        for (let i = candidates.length - 1; i >= 0; i--) {
            const token = candidates[i];
            if (!isSelectableTarget(token, canvas.scene)) continue;
            const bounds = this._getScreenBounds(token);
            if (bounds && point.x >= bounds.x && point.x <= bounds.x + bounds.width
                && point.y >= bounds.y && point.y <= bounds.y + bounds.height) return token;
        }
        return null;
    }

    /** 更新招式题签和已选目标操作条；不触碰当前用户的原生目标。 */
    static _renderSelection(state) {
        if (!state.overlay) return;
        const detailsOpen = state.overlay.querySelector("details")?.open ?? false;
        const focus = state.overlay.contains(document.activeElement) ? document.activeElement?.dataset : null;
        const esc = value => this._escape(value);
        const label = key => esc(game.i18n.localize(`XJZL.TargetSelection.${key}`));
        const portrait = token => esc(token?.document?.texture?.src || token?.actor?.img || "icons/svg/mystery-man.svg");
        const chips = state.selected.length > 0
            ? state.selected.map((token, index) => `<button type="button" class="xjzl-target-chip" data-target-action="remove" data-uuid="${esc(token.document.uuid)}" aria-label="${label("Remove")} ${esc(token.name)}">
                <span class="xjzl-target-chip-number">${index + 1}</span><img src="${portrait(token)}" alt=""><span>${esc(token.name || token.actor?.name)}</span><i class="fas fa-xmark" aria-hidden="true"></i></button>`).join("")
            : `<span class="xjzl-target-selection-empty">${label("None")}</span>`;
        const meta = [
            state.range ? `<span><b>${esc(game.i18n.localize("XJZL.TargetSelection.Range"))}</b>${esc(state.range)}</span>` : "",
            state.targetInfo ? `<span><b>${esc(game.i18n.localize("XJZL.TargetSelection.TargetInfo"))}</b>${esc(state.targetInfo)}</span>` : ""
        ].filter(Boolean).join("");
        const description = state.descriptionHtml
            ? `<details class="xjzl-target-selection-description" ${detailsOpen ? "open" : ""}><summary>${label("Description")}<i class="fas fa-angle-down" aria-hidden="true"></i></summary><div>${state.descriptionHtml}</div></details>`
            : "";
        const instruction = state.mode === "single" && !state.enteredMulti ? "SingleHint" : "MultiHint";
        state.overlay.innerHTML = `
            <div class="xjzl-target-selection-console">
            <header class="xjzl-target-selection-head">
                <div class="xjzl-target-selection-heading"><span class="xjzl-target-selection-seal" aria-hidden="true">${label("Seal")}</span>
                    <div><span class="xjzl-target-selection-kicker">${label("Stage")}</span><h2>${esc(state.name || game.i18n.localize("XJZL.TargetSelection.Action"))}</h2></div>
                    <button type="button" class="xjzl-target-selection-close" data-target-action="cancel" aria-label="${esc(game.i18n.localize("XJZL.UI.Cancel"))}"><i class="fas fa-xmark" aria-hidden="true"></i></button>
                </div>
                <div class="xjzl-target-selection-info">
                    <span class="xjzl-target-selection-source"><img src="${portrait(state.sourceToken)}" alt="">${esc(state.sourceToken?.name || state.actor?.name || "")}</span>
                    ${meta}${description}
                </div>
            </header>
            <footer class="xjzl-target-selection-dock">
                <div class="xjzl-target-selection-picked"><span>${label("Selected")}<b>${state.selected.length}</b></span><div aria-live="polite">${chips}</div>
                    <button type="button" class="xjzl-target-selection-clear" data-target-action="clear" ${state.selected.length ? "" : "disabled"}>${label("Clear")}</button>
                </div>
                <div class="xjzl-target-selection-actions">
                    <button type="button" class="xjzl-target-selection-mode" data-target-action="mode" aria-pressed="${state.mode === "multi"}" aria-label="${label("SwitchMode")}"><i class="fas fa-${state.mode === "single" ? "crosshairs" : "layer-group"}" aria-hidden="true"></i>${label(state.mode === "single" ? "Single" : "Multi")}<kbd>Shift</kbd></button>
                    <span class="xjzl-target-selection-instruction">${label(instruction)}</span>
                    <button type="button" data-target-action="empty">${label("NoTarget")}</button>
                    <button type="button" class="primary" data-target-action="confirm" ${state.selected.length ? "" : "disabled"}>${label("Confirm")}<i class="fas fa-arrow-right" aria-hidden="true"></i></button>
                </div>
                <div class="xjzl-target-selection-shortcuts"><span><kbd>Enter</kbd>${label("ConfirmKey")}</span><span><i class="fas fa-computer-mouse" aria-hidden="true"></i>${label("RightCancel")}<kbd>Esc</kbd></span></div>
            </footer>
            </div>`;
        // 替换内容后恢复同一操作的键盘焦点，避免切换模式或移除目标打断 Tab 操作。
        if (focus?.targetAction) {
            const buttons = state.overlay.querySelectorAll("[data-target-action]");
            [...buttons].find(button => button.dataset.targetAction === focus.targetAction
                && button.dataset.uuid === focus.uuid)?.focus({ preventScroll: true });
        }
    }

    /** 绘制屏幕上的来源标记、全部已选箭头与悬停引导；坐标未变化时不重建 SVG。 */
    static _drawPreview(state) {
        if (!state.preview) return;
        state.hovered = this._tokenAtPoint(state.pointer, state.candidates);
        const source = state.sourceToken && isSelectableTarget(state.sourceToken, state.scene)
            ? this._getScreenBounds(state.sourceToken) : null;
        const targets = state.selected.filter(token => isSelectableTarget(token, state.scene))
            .map(token => this._getScreenBounds(token));
        const hovered = state.hovered && !state.selected.includes(state.hovered)
            ? this._getScreenBounds(state.hovered) : null;
        const signature = JSON.stringify([source, targets, hovered, state.pointer]);
        if (signature === state.previewSignature) return;
        state.previewSignature = signature;
        const center = bounds => ({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
        const parts = [];
        if (source) {
            const point = center(source);
            const radius = Math.min(source.width, source.height) / 2 + 7;
            parts.push(`<g class="xjzl-target-source-ring"><circle cx="${point.x}" cy="${point.y}" r="${radius}"/><circle cx="${point.x}" cy="${point.y}" r="${radius + 5}"/><text x="${point.x}" y="${source.y - 16}">${this._escape(game.i18n.localize("XJZL.TargetSelection.Source"))}</text></g>`);
            for (const bounds of targets) {
                if (bounds) parts.push(this._arrowMarkup(source, bounds, false));
            }
            if (hovered) parts.push(this._arrowMarkup(source, hovered, true));
            else if (state.pointer && !state.hovered) {
                parts.push(this._arrowMarkup(source, { ...state.pointer, width: 0, height: 0 }, true));
            }
        }
        targets.forEach((bounds, index) => {
            if (bounds) parts.push(this._reticleMarkup(bounds, index + 1));
        });
        if (hovered) parts.push(this._reticleMarkup(hovered, null));
        state.preview.innerHTML = parts.join("");
    }

    /** 剑气从来源边缘发出，在目标处收成剑锋；自身目标使用回环，避免零长度线。 */
    static _arrowMarkup(source, target, pending) {
        const sx = source.x + source.width / 2;
        const sy = source.y + source.height / 2;
        const tx = target.x + target.width / 2;
        const ty = target.y + target.height / 2;
        const dx = tx - sx;
        const dy = ty - sy;
        const distance = Math.hypot(dx, dy);
        const radius = Math.min(source.width, source.height) / 2 + 6;
        let path;
        let wisp = "";
        let ex;
        let ey;
        let angle;
        if (distance < 1) {
            ex = sx + radius;
            ey = sy;
            path = `M ${sx} ${sy - radius} C ${sx + radius * 2.5} ${sy - radius * 2.2} ${sx + radius * 2.5} ${sy + radius * 1.6} ${ex} ${ey}`;
            angle = Math.atan2(-radius * 1.6, -radius * 1.5);
        } else {
            const ux = dx / distance;
            const uy = dy / distance;
            // 相邻 Token 的间距有限，按距离收窄端点留白，防止短线反向。
            const startGap = Math.min(radius, distance * 0.28);
            let endGap;
            // 悬停箭头要停在 Token 外沿，且给剑锋留出自己的视觉空间；
            // 短距离时退让到可用长度，避免箭头反向穿过出招者。
            if (pending && target.width > 0 && target.height > 0) {
                const edgeDistance = Math.min(
                    target.width / (2 * Math.max(Math.abs(ux), 0.001)),
                    target.height / (2 * Math.max(Math.abs(uy), 0.001))
                );
                const pendingClearance = edgeDistance + 16;
                endGap = Math.min(pendingClearance, Math.max(0, distance - startGap - 16));
            } else {
                endGap = Math.min(Math.min(target.width, target.height) / 2 + 7, distance * 0.28);
            }
            const ax = sx + ux * startGap;
            const ay = sy + uy * startGap;
            ex = tx - ux * endGap;
            ey = ty - uy * endGap;
            // 用屏幕位置分桶决定弧线方向和幅度，路线稳定但不会所有目标都朝同一侧弯。
            const routeSeed = Math.abs(
                Math.floor((sx + tx) / 48) * 31
                + Math.floor((sy + ty) / 48) * 17
                + (dx > 0 ? 7 : 0)
                + (dy > 0 ? 11 : 0)
            );
            const bendSign = routeSeed % 2 ? 1 : -1;
            const bendFactor = 0.075 + (routeSeed % 3) * 0.018;
            const bend = Math.min(30, distance * bendFactor) * bendSign;
            const cx = (ax + ex) / 2 - uy * bend;
            const cy = (ay + ey) / 2 + ux * bend;
            path = `M ${ax} ${ay} Q ${cx} ${cy} ${ex} ${ey}`;
            // 一道错开的细气痕沿主线收束，保留地图可读性，不堆叠发光滤镜。
            wisp = `<path class="link-wisp" d="M ${ax - uy * 4} ${ay + ux * 4} Q ${cx - uy * 7} ${cy + ux * 7} ${ex} ${ey}"/>`;
            angle = Math.atan2(ey - cy, ex - cx);
        }
        const size = pending ? 15 : 17;
        const bx = ex - Math.cos(angle) * size;
        const by = ey - Math.sin(angle) * size;
        const wing = pending ? 4.2 : 3.2;
        const notchX = ex - Math.cos(angle) * size * 0.76;
        const notchY = ey - Math.sin(angle) * size * 0.76;
        const arrow = `${ex},${ey} ${bx - Math.sin(angle) * wing},${by + Math.cos(angle) * wing} ${notchX},${notchY} ${bx + Math.sin(angle) * wing},${by - Math.cos(angle) * wing}`;
        return `<g class="xjzl-target-link ${pending ? "is-pending" : "is-selected"}">${pending ? "" : wisp}<path class="link-shadow" d="${path}"/><path class="link-line" d="${path}"/>${pending ? "" : `<path class="link-core" d="${path}"/>`}<polygon points="${arrow}"/></g>`;
    }

    /** 四角瞄准标记只框住 Token 占地，不包含姓名和状态图标。 */
    static _reticleMarkup(bounds, index) {
        const x = bounds.x - 4;
        const y = bounds.y - 4;
        const r = bounds.x + bounds.width + 4;
        const b = bounds.y + bounds.height + 4;
        const arm = Math.min(13, bounds.width / 3, bounds.height / 3);
        const path = `M ${x} ${y + arm} V ${y} H ${x + arm} M ${r - arm} ${y} H ${r} V ${y + arm} M ${r} ${b - arm} V ${b} H ${r - arm} M ${x + arm} ${b} H ${x} V ${b - arm}`;
        return `<g class="xjzl-target-reticle ${index ? "is-selected" : "is-hovered"}"><path d="${path}"/>${index ? `<rect x="${r - 9}" y="${y - 9}" width="18" height="18" rx="2" transform="rotate(45 ${r} ${y})"/><text x="${r}" y="${y}">${index}</text>` : ""}</g>`;
    }

    /**
     * 将 V14 Token.bounds（场景占地）转换到 CSS 屏幕坐标。getBounds() 会包含
     * 状态图标和姓名，不能用作 Token 的中心、命中框或连线端点。
     */
    static _getScreenBounds(token) {
        const bounds = token?.bounds;
        if (!bounds || !canvas.stage) return null;
        const view = canvas.app?.view;
        const rect = view?.getBoundingClientRect?.();
        const screen = canvas.app?.renderer?.screen;
        const scaleX = rect && screen?.width ? rect.width / screen.width : 1;
        const scaleY = rect && screen?.height ? rect.height / screen.height : 1;
        const a = canvas.stage.toGlobal({ x: bounds.x, y: bounds.y });
        const b = canvas.stage.toGlobal({ x: bounds.x + bounds.width, y: bounds.y + bounds.height });
        return {
            x: (rect?.left ?? 0) + Math.min(a.x, b.x) * scaleX,
            y: (rect?.top ?? 0) + Math.min(a.y, b.y) * scaleY,
            width: Math.abs(b.x - a.x) * scaleX,
            height: Math.abs(b.y - a.y) * scaleY
        };
    }

    static async _enrichDescription(description) {
        if (!description) return "";
        try {
            return await foundry.applications.ux.TextEditor.enrichHTML(String(description), { async: true });
        } catch (error) {
            console.warn("XJZL | 目标选择说明富文本解析失败，已降级为纯文本：", error);
            return this._escape(description);
        }
    }

    /**
     * 暂时隐藏已展开的来源角色卡，保留其布局与滚动状态。
     * V14 的最小化/展开动画会参与窗口尺寸钳制，临时阶段无需触发该定位流程。
     */
    static _suspendSourceSheet(state) {
        const sheet = state.actor?.sheet;
        if (!sheet?.rendered || sheet.minimized || !sheet.element) return;
        state.sheet = sheet;
        sheet.element.classList.add("xjzl-target-source-sheet-suspended");
    }

    /** 终结本地会话并恢复角色卡；null 表示取消，空数组表示明确无目标。 */
    static async _finishSelection(state, result) {
        if (!state || state.settled) return;
        state.settled = true;
        if (state.frame !== null) cancelAnimationFrame(state.frame);
        for (const [hookName, handler] of state.hookHandlers) Hooks.off?.(hookName, handler);
        state.preview?.remove();
        state.backdrop?.remove();
        state.overlay?.remove();
        state.sheet?.element?.classList.remove("xjzl-target-source-sheet-suspended");
        if (this._activeSelection === state) this._activeSelection = null;
        state.resolve?.(result);
    }

    static _escape(value) {
        if (globalThis.foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(String(value ?? ""));
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    /** 兼容原有 ALT + 左键目标切换。 */
    static _toggleTarget(token) {
        token.setTarget(!token.isTargeted, { releaseOthers: false });
    }
}
