/**
 * 光环快建工具：区域工具栏按钮、配置弹窗和画布格心吸附放置。
 *
 * 默认只标记范围；自动结算可在 Region 行为配置中启用。
 * 显示名由自绘标签渲染（Signika 白字黑边、点击穿透）。
 *
 * 入口：
 * - 工具栏按钮（getSceneControlButtons 注入，regions 工具组）；
 * - game.xjzl.auraQuick.open()（工具栏按钮与光环宏共用）。
 * - game.xjzl.auraQuick.place(params)（招式脚本触发画布选点）。
 */

import {drawAuraCircle, isParticlesEnabled, refreshAuraFx, startAuraParticles, stopAuraParticles} from "./xjzl-aura-fx.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** 快建光环的默认颜色（与 AuraManager 默认一致，用户可在弹窗改）。 */
const DEFAULT_COLOR = "#40d0c0";

/* -------------------------------------------- */
/*  显示名标签：子类化 Region placeable           */
/* -------------------------------------------- */

/**
 * 光环 Region 的画布对象：叠加自绘显示名标签与视觉增强（圆轮廓＋粒子，
 * 见 xjzl-aura-fx.mjs）。核心不渲染区域名；跟随光环平移时
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
        // 外圈常驻；可选底幕、粒子、标签分别排序；Region 核心的格子高亮在独立容器内。
        this.sortableChildren = true;
        // PixiJS 7+：eventMode none 使点击穿透文字，直接命中下方交互对象
        this.labelDetails.eventMode = "none";
        this.labelDetails.interactive = false;
        this.#updateLabel();
        // AURA-07 视觉增强是可选层；任何绘制/纹理失败都不能阻断 Region 核心绘制。
        try {
            const circle = drawAuraCircle(this);
            if (circle && isParticlesEnabled()) startAuraParticles(this, circle);
        } catch (err) {
            stopAuraParticles(this);
            console.warn("XJZL | 光环视觉初始化失败，已保留核心 Region。", err);
        }
    }

    /** @override 每次 refresh 重定位标签（跟随光环整格平移后中心随 bounds 移动）。 */
    _applyRenderFlags(flags) {
        super._applyRenderFlags(flags);
        this.#updateLabel();
        // 圆轮廓位置与粒子锚点随 bounds 同步；半径/颜色热更新时在此重画
        refreshAuraFx(this);
    }

    /** @override 重画前解绑粒子 ticker；核心会销毁子节点，须同步清空我们的缓存引用。 */
    _clear() {
        stopAuraParticles(this);
        this._auraCircle = null;
        this._auraCircleKey = "";
        this._auraCoverageMesh = null;
        this.labelDetails = null;
        super._clear();
    }

    /** @override 销毁时释放文本资源与粒子生成器。 */
    async _destroy(options) {
        stopAuraParticles(this);
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
 * @type {{params: object, preview: PIXI.Graphics, onMove: Function, onDown: Function, onDownCapture: Function, onKey: Function, cancel: Function, cleanup: Function}|null}
 */
let placement = null;

/**
 * 进入画布放置模式，供快建窗口和公共选点 API 共用。
 * @param {object} params - 传给 AuraManager.create 的参数（label/radius/color 等）
 * @returns {Promise<RegionDocument|null>} 创建的 Region；取消、无网格或创建失败时为 null
 *   已提交但未同步时抛出带 regionUuid 的 AURA_SYNC_PENDING 异常
 */
function beginPlacement(params) {
    cancelPlacement();
    if (!canvas.scene?.grid || canvas.scene.grid.isGridless) {
        ui.notifications.warn(game.i18n.localize("XJZL.Aura.NoGrid"));
        return Promise.resolve(null);
    }

    return new Promise((resolve, reject) => {
        const grid = canvas.scene.grid;
        const radiusPx = (params.radius ?? 0) * (canvas.dimensions.size ?? 100);
        const preview = new PIXI.Graphics();
        canvas.regions.addChild(preview);
        let settled = false;

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

        const cleanup = () => {
            canvas.stage.off("pointermove", onMove);
            canvas.stage.off("pointerdown", onDown);
            canvas.stage.off("pointerdown", onDownCapture);
            window.removeEventListener("keydown", onKey);
            preview.destroy({children: true});
            if (placement?.cleanup === cleanup) placement = null;
        };
        const cancel = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(null);
        };
        const onMove = event => {
            if (settled) return;
            const local = canvas.stage.toLocal(event.global);
            drawPreview(local);
        };
        const onDown = async event => {
            // 只接受左键：右键交给取消回调（PixiJS 右键同样派发 pointerdown，
            // 不拦会在取消前误入创建流程）
            if (event.button !== 0 || settled) return;
            const local = canvas.stage.toLocal(event.global);
            const center = drawPreview(local);
            // 先结束交互，避免创建异步 Region 时重复点击或 Esc 再次触发。
            settled = true;
            cleanup();
            let region = null;
            try {
                region = await game.xjzl.aura.create(
                    {scene: canvas.scene, x: center.x, y: center.y},
                    {...params, follow: false}
                );
            } catch (error) {
                // 提交已成功的异常须保留 UUID，不能让批量放置按 null 回滚或重试。
                if (error.code === "AURA_SYNC_PENDING") {
                    reject(error);
                    return;
                }
                console.error("XJZL | auraQuick.place failed", error);
                ui.notifications.error(game.i18n.localize("XJZL.Aura.CreateFailed"));
            }
            resolve(region ?? null);
        };
        const onKey = event => {
            if (event.key === "Escape") cancel();
        };
        // 右键取消：pointerdown 的 button===2 分支
        const onDownCapture = event => {
            if (event.button === 2) cancel();
        };
        canvas.stage.on("pointermove", onMove);
        canvas.stage.on("pointerdown", onDown);
        window.addEventListener("keydown", onKey);
        canvas.stage.on("pointerdown", onDownCapture);

        placement = {params, preview, onMove, onDown, onDownCapture, onKey, cancel, cleanup};
        ui.notifications.info(game.i18n.localize("XJZL.UI.AuraQuick.PlaceHint"), {localize: false});
    });
}

/**
 * 取消放置模式并清理预览与监听。
 */
function cancelPlacement() {
    if (!placement) return;
    placement.cancel();
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
     * @override 弹窗数据：跟随或同源替换时选择来源 Token，默认允许同名光环并存。
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
            defaultUniqueness: "none",
            allTokens,
            selectedTokenId: defaultToken?.document?.id ?? allTokens[0]?.id ?? "",
            modes: {
                static: game.i18n.localize("XJZL.UI.AuraQuick.StaticMode"),
                follow: game.i18n.localize("XJZL.UI.AuraQuick.FollowMode")
            },
            uniquenessModes: {
                none: game.i18n.localize("XJZL.UI.AuraQuick.UniquenessNone"),
                source: game.i18n.localize("XJZL.UI.AuraQuick.UniquenessSource"),
                scene: game.i18n.localize("XJZL.UI.AuraQuick.UniquenessScene")
            }
        };
    }

    /**
     * 表单提交：跟随模式直接创建，固定模式选点；同源替换必须选择来源 Token。
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
        const uniqueness = String(read("uniqueness") || "none");
        if (!["none", "source", "scene"].includes(uniqueness)) {
            return ui.notifications.warn(game.i18n.localize("XJZL.UI.AuraQuick.UniquenessInvalid"));
        }
        // mark 模式零结算：显式关闭全部结算开关（管理器默认 enterEnabled
        // 为 true，不显式传会带出进入结算），需要结算的经核心 Region
        // 配置页在行为中后补。
        // 同名手动光环共用业务标签，替换模式才能找到旧实例；默认 none
        // 保留并存行为，前缀避免与招式脚本的标签混用。
        const params = {
            label: `aura-quick-${displayName}`,
            displayName,
            uniqueness,
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
        let token = null;
        if (params.follow || uniqueness === "source") {
            const tokenId = String(read("tokenId") || "");
            token = canvas.scene.tokens.get(tokenId);
            if (!token) return ui.notifications.warn(game.i18n.localize("XJZL.UI.AuraQuick.InvalidToken"));
        }
        if (params.follow) {
            // 管理器返回 null 表示未创建；保留弹窗供重试，异常另行提示。
            try {
                const region = await game.xjzl.aura.create(token, params);
                if (!region) return;
                ui.notifications.info(game.i18n.localize("XJZL.UI.AuraQuick.Created", {name: displayName}));
                this.close();
            } catch (error) {
                console.error("XJZL | auraQuick follow create failed", error);
                if (error.code === "AURA_SYNC_PENDING") {
                    ui.notifications.warn(game.i18n.localize("XJZL.Aura.SyncPending"));
                    this.close();
                    return;
                }
                ui.notifications.error(game.i18n.localize("XJZL.Aura.CreateFailed"));
            }
        } else {
            if (token) params.source = token;
            // 固定模式进入画布放置：弹窗立即关闭，避免遮挡画布视野
            this.close();
            placeAura(params).catch(error => {
                console.error("XJZL | auraQuick placement failed", error);
                if (error.code === "AURA_SYNC_PENDING") ui.notifications.warn(game.i18n.localize("XJZL.Aura.SyncPending"));
                else ui.notifications.error(game.i18n.localize("XJZL.Aura.CreateFailed"));
            });
        }
    }

    /** @override 跟随或同源替换需要 Token；其他固定区域不要求来源。 */
    _onRender(context, options) {
        super._onRender(context, options);
        const modeSelect = this.element.querySelector('select[name="mode"]');
        const uniquenessSelect = this.element.querySelector('select[name="uniqueness"]');
        const tokenGroup = this.element.querySelector("#aura-token-select-group");
        if (!modeSelect || !uniquenessSelect || !tokenGroup) return;
        const toggle = () => {
            tokenGroup.style.display = modeSelect.value === "follow" || uniquenessSelect.value === "source" ? "flex" : "none";
        };
        toggle();
        modeSelect.addEventListener("change", toggle);
        uniquenessSelect.addEventListener("change", toggle);
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

/**
 * 打开固定光环的画布选点流程，供招式脚本复用。
 * @param {object} params - AuraManager.create 的参数；位置由玩家点击选择，follow 会被固定为 false
 * @returns {Promise<RegionDocument|null>} 创建的 Region；取消、无网格或创建失败时为 null
 *   已提交但未同步时抛出带 regionUuid 的 AURA_SYNC_PENDING 异常
 */
export function placeAura(params) {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
        throw new TypeError("game.xjzl.auraQuick.place(params) requires an object");
    }
    return beginPlacement(params);
}
