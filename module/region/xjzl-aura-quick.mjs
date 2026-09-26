/**
 * 光环快建工具：区域工具栏按钮、配置弹窗和画布格心吸附放置。
 *
 * 默认只标记范围；自动结算可在 Region 行为配置中启用。
 * 显示名由自绘标签渲染（Signika 白字黑边、点击穿透）。
 *
 * 入口：
 * - 工具栏按钮（getSceneControlButtons 注入，regions 工具组）；
 * - game.xjzl.auraQuick.open()（工具栏按钮与光环宏共用）。
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** 快建光环的默认颜色（与 AuraManager 默认一致，用户可在弹窗改）。 */
const DEFAULT_COLOR = "#40d0c0";

/* -------------------------------------------- */
/*  显示名标签：子类化 Region placeable           */
/* -------------------------------------------- */

/**
 * 光环 Region 的画布对象：叠加自绘显示名标签。
 * 核心不渲染区域名；跟随光环平移时
 * 核心会 refresh，标签在 _applyRenderFlags 中跟随 bounds 中心更新。
 */
export class XJZLAuraRegionObject extends CONFIG.Region.objectClass {

    /** @override 绘制完成后叠加显示名文本（点击穿透，不挡交互）。 */
    async _draw(options) {
        await super._draw(options);
        this.labelDetails = this.addChild(new PIXI.Text("", {
            fontFamily: "Signika",
            fontSize: 24,
            fill: "#FFFFFF",
            stroke: "#000000",
            strokeThickness: 4,
            align: "center",
            fontWeight: "bold",
            dropShadow: true,
            dropShadowColor: "#000000",
            dropShadowBlur: 2
        }));
        this.labelDetails.zIndex = 100;
        this.labelDetails.anchor.set(0.5, 0.5);
        // zIndex 需显式开启子节点排序，否则 shapes 容器在后续 refresh
        // 重排时会盖住标签（实测文字被色块网格遮挡不可见）
        this.sortableChildren = true;
        // PixiJS 7+：eventMode none 使点击穿透文字，直接命中下方交互对象
        this.labelDetails.eventMode = "none";
        this.labelDetails.interactive = false;
        this.#updateLabel();
    }

    /** @override 每次 refresh 重定位标签（跟随光环整格平移后中心随 bounds 移动）。 */
    _applyRenderFlags(flags) {
        super._applyRenderFlags(flags);
        this.#updateLabel();
    }

    /** @override 销毁时释放文本资源。 */
    async _destroy(options) {
        this.labelDetails?.destroy();
        this.labelDetails = null;
        await super._destroy(options);
    }

    /**
     * 仅为带光环标记的 Region 绘制名称；objectClass 替换会作用于全部 Region。
     */
    #updateLabel() {
        if (!this.labelDetails) return;
        const text = this.document?.getFlag("xjzl-system", "aura") ? this.document?.name : null;
        const bounds = this.bounds;
        if (text && bounds && Number.isFinite(bounds.x + bounds.y + bounds.width + bounds.height)) {
            this.labelDetails.text = text;
            this.labelDetails.visible = true;
            // 放在区域上边缘内侧：跟随光环的中心即源 Token 位置，放中心会被
            // 源 Token 头像遮挡
            this.labelDetails.position.set(bounds.x + bounds.width / 2, bounds.y + 20);
        } else {
            this.labelDetails.visible = false;
        }
    }
}

/* -------------------------------------------- */
/*  画布放置模式                                  */
/* -------------------------------------------- */

/**
 * 固定光环的画布放置状态：指针移动显示格心吸附预览，左键创建，Esc/右键取消。
 * @type {{params: object, preview: PIXI.Graphics, onMove: Function, onDown: Function, onKey: Function}|null}
 */
let placement = null;

/**
 * 进入画布放置模式（弹窗确认后调用）。
 * @param {object} params - 传给 AuraManager.create 的参数（label/radius/color 等）
 */
function beginPlacement(params) {
    cancelPlacement();
    if (!canvas.scene?.grid || canvas.scene.grid.isGridless) {
        ui.notifications.warn(game.i18n.localize("XJZL.Aura.NoGrid"));
        return;
    }
    const grid = canvas.scene.grid;
    const radiusPx = (params.radius ?? 0) * (canvas.dimensions.size ?? 100);
    const preview = new PIXI.Graphics();
    canvas.regions.addChild(preview);

    const drawPreview = point => {
        const offset = grid.getOffset(point);
        const center = grid.getCenterPoint(offset);
        const r = Math.max(radiusPx, 4);
        const colorNum = params.color ? Number.parseInt(params.color.slice(1), 16) : 0x40d0c0;
        preview.clear();
        preview.beginFill(colorNum, 0.15);
        preview.drawCircle(center.x, center.y, r);
        preview.endFill();
        preview.lineStyle(2, 0xffffff, 0.8);
        preview.drawCircle(center.x, center.y, r);
        // 格心十字标记
        preview.lineStyle(1, 0xffffff, 0.9);
        preview.moveTo(center.x - 8, center.y);
        preview.lineTo(center.x + 8, center.y);
        preview.moveTo(center.x, center.y - 8);
        preview.lineTo(center.x, center.y + 8);
        return center;
    };

    const onMove = event => {
        const local = canvas.stage.toLocal(event.global);
        drawPreview(local);
    };
    const onDown = async event => {
        // 只接受左键：右键交给取消回调（PixiJS 右键同样派发 pointerdown，
        // 不拦会在取消前误入创建流程）
        if (event.button !== 0) return;
        const local = canvas.stage.toLocal(event.global);
        const center = drawPreview(local);
        cancelPlacement();
        await game.xjzl.aura.create({scene: canvas.scene, x: center.x, y: center.y}, params);
    };
    const onKey = event => {
        if (event.key === "Escape") cancelPlacement();
    };
    canvas.stage.on("pointermove", onMove);
    canvas.stage.on("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    // 右键取消：pointerdown 的 button===2 分支
    const onDownCapture = event => {
        if (event.button === 2) cancelPlacement();
    };
    canvas.stage.on("pointerdown", onDownCapture);

    placement = {params, preview, onMove, onDown, onDownCapture, onKey};
    ui.notifications.info(game.i18n.localize("XJZL.UI.AuraQuick.PlaceHint"), {localize: false});
}

/**
 * 取消放置模式并清理预览与监听。
 */
function cancelPlacement() {
    if (!placement) return;
    canvas.stage.off("pointermove", placement.onMove);
    canvas.stage.off("pointerdown", placement.onDown);
    canvas.stage.off("pointerdown", placement.onDownCapture);
    window.removeEventListener("keydown", placement.onKey);
    placement.preview.destroy({children: true});
    placement = null;
}

/* -------------------------------------------- */
/*  快建弹窗                                      */
/* -------------------------------------------- */

export class AuraQuickCreator extends HandlebarsApplicationMixin(ApplicationV2) {

    /** @override 窗口配置。 */
    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "xjzl-aura-quick",
        classes: ["standard-form"],
        position: {width: 340, height: "auto"},
        window: {title: "XJZL.UI.AuraQuick.Title", icon: "fas fa-hurricane", resizable: false},
        form: {submitOnChange: false, closeOnSubmit: true},
        actions: {confirm: AuraQuickCreator.prototype._onConfirm}
    };

    /** @override 表单模板。 */
    static PARTS = {
        form: {template: "systems/xjzl-system/templates/apps/aura-quick.hbs"}
    };

    /**
     * @override 弹窗数据：token 列表（跟随模式选择源）、默认当前选中 token。
     * @param {object} _options
     * @returns {Promise<object>}
     */
    async _prepareContext(_options) {
        const allTokens = canvas.tokens?.placeables
            .filter(t => t.actor)
            .map(t => ({id: t.document.id, name: t.name || t.actor.name})) ?? [];
        const controlled = canvas.tokens?.controlled?.[0];
        const targeted = game.user.targets.first();
        const defaultToken = controlled ?? targeted;
        return {
            displayName: game.i18n.localize("XJZL.UI.AuraQuick.DefaultName"),
            radius: 3,
            duration: 0,
            color: DEFAULT_COLOR,
            defaultMode: defaultToken ? "follow" : "static",
            allTokens,
            selectedTokenId: defaultToken?.document?.id ?? allTokens[0]?.id ?? "",
            modes: {
                static: game.i18n.localize("XJZL.UI.AuraQuick.StaticMode"),
                follow: game.i18n.localize("XJZL.UI.AuraQuick.FollowMode")
            }
        };
    }

    /**
     * 表单提交：跟随模式以所选 Token 为源直接创建；固定模式进入画布放置。
     * @param {Event} event
     * @param {HTMLElement} target
     */
    async _onConfirm(event, target) {
        event?.preventDefault?.();
        const form = target.closest("form") ?? this.element;
        const read = name => new FormData(form).get(name);
        const displayName = String(read("displayName") || "").trim() || game.i18n.localize("XJZL.UI.AuraQuick.DefaultName");
        // 使用 Number 保留完整输入语义，再按非负整数校验，避免截断小数。
        const radius = Number(read("radius"));
        if (!Number.isInteger(radius) || radius < 0) {
            return ui.notifications.warn(game.i18n.localize("XJZL.UI.AuraQuick.RadiusInvalid"));
        }
        const durationRaw = Number(read("duration"));
        // 0/空 = 不自动消失（合法）；其余必须是正整数，非法值拒绝而非静默改 0
        if (durationRaw !== 0 && (!Number.isInteger(durationRaw) || durationRaw < 0)) {
            return ui.notifications.warn(game.i18n.localize("XJZL.UI.AuraQuick.DurationInvalid"));
        }
        const duration = durationRaw > 0 ? durationRaw : 0;
        // mark 模式零结算：显式关闭全部结算开关（管理器默认 enterEnabled
        // 为 true，不显式传会带出进入结算），需要结算的经核心 Region
        // 配置页在行为中后补。
        // label 是单实例替换键（同 label 先删旧再建新）——手动创建必须
        // 互不覆盖，用内部唯一值；用户输入只作 displayName（画布标签与
        // 区域名）。"替换"语义留给数据脚本按业务 label 精确控制。
        const params = {
            label: `aura-quick-${foundry.utils.randomID(8)}`,
            displayName,
            radius,
            color: String(read("color") || DEFAULT_COLOR),
            follow: read("mode") === "follow",
            enterEnabled: false
        };
        if (duration > 0) {
            // 时限需以进行中的战斗轮次为锚点；round 0 与战斗外保持手动
            // 生命周期，并提示本次不会自动消失。
            if (game.combat && (game.combat.round ?? 0) >= 1) {
                params.durationRounds = duration;
                params.lifecycle = "combat";
            } else {
                ui.notifications.warn(game.i18n.localize("XJZL.UI.AuraQuick.DurationNoCombat"));
            }
        }
        if (params.follow) {
            const tokenId = String(read("tokenId") || "");
            const token = canvas.scene.tokens.get(tokenId);
            if (!token) return ui.notifications.warn(game.i18n.localize("XJZL.UI.AuraQuick.InvalidToken"));
            await game.xjzl.aura.create(token, params);
            ui.notifications.info(game.i18n.format("XJZL.UI.AuraQuick.Created", {name: displayName}));
            this.close();
        } else {
            // 固定模式进入画布放置：弹窗立即关闭，避免遮挡画布视野
            this.close();
            beginPlacement(params);
        }
    }

    /** @override 模式切换显隐 token 选择。 */
    _onRender(context, options) {
        super._onRender(context, options);
        const modeSelect = this.element.querySelector('select[name="mode"]');
        const tokenGroup = this.element.querySelector("#aura-token-select-group");
        if (!modeSelect || !tokenGroup) return;
        const toggle = () => {
            tokenGroup.style.display = modeSelect.value === "follow" ? "flex" : "none";
        };
        toggle();
        modeSelect.addEventListener("change", toggle);
    }
}

/* -------------------------------------------- */
/*  注册                                          */
/* -------------------------------------------- */

/**
 * init 阶段调用：替换 Region placeable 类为带标签的子类，并注册工具栏按钮。
 * objectClass 须在场景 placeable 构建前替换（init 足够）。
 */
export function registerAuraQuick() {
    if (CONFIG.Region.objectClass !== XJZLAuraRegionObject) {
        CONFIG.Region.objectClass = XJZLAuraRegionObject;
    }
    Hooks.on("getSceneControlButtons", controls => {
        // 挂区域控件组：光环本质是 Region，编辑入口（双击区域 → 行为页）在
        // 同一控件组下，使用者的操作动线一致。
        // 按区域工具组注册；同时接受对象和数组形态的 controls。
        const group = controls?.regions ?? (Array.isArray(controls) ? controls.find(c => c.name === "regions") : null);
        if (!group?.tools) return;
        group.tools.auraQuick = {
            name: "auraQuick",
            title: "XJZL.UI.AuraQuick.Title",
            icon: "fas fa-hurricane",
            button: true,
            onChange: () => game.xjzl.auraQuick.open()
        };
    });
}

/**
 * 打开快建弹窗（供工具栏按钮与光环宏调用）。
 * @returns {AuraQuickCreator}
 */
export function openAuraQuick() {
    return new AuraQuickCreator().render({force: true});
}
