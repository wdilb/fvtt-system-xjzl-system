/**
 * ==============================================================================
 *  自定义 AOE 区域创建工具 (AOE Creator)
 * ==============================================================================
 *  Tech Stack: ApplicationV2 (V13 Standard)
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class AOECreator extends HandlebarsApplicationMixin(ApplicationV2) {

    /**
     * 核心配置
     */
    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "xjzl-aoe-creator",
        classes: ["aoe-creator"],
        position: {
            width: 320,
            height: "auto"
        },
        window: {
            title: "创建效果区域",
            icon: "fas fa-bullseye",
            resizable: false
        },
        actions: {
            create: AOECreator.prototype._onCreate
        }
    };

    /**
     * 模板路径
     */
    static PARTS = {
        form: {
            template: "systems/xjzl-system/templates/apps/aoe-creator.hbs"
        }
    };

    /**
     * 数据准备
     */
    async _prepareContext(options) {
        // 获取当前选中的 Token (如果有)
        // 1. 获取当前场景所有有效的 Token (排除没有名字的)
        const allTokens = canvas.tokens.placeables
            .filter(t => t.actor)
            .map(t => ({ id: t.id, name: t.name || t.actor.name }));

        // 2. 尝试智能锁定一个目标
        // 优先级: 已选中(Controlled) > 已目标(Targeted) > 列表第一个
        const controlled = canvas.tokens.controlled[0];
        const targeted = game.user.targets.first();
        const defaultToken = controlled || targeted;

        return {
            label: "新效果区域",
            distance: 3,
            color: "#FF0000",
            defaultMode: defaultToken ? "follow" : "static",

            // 传递 Token 列表给前端下拉框
            allTokens: allTokens,
            // 默认选中的 Token ID
            selectedTokenId: defaultToken?.id || "",

            modes: {
                static: "静态放置 (屏幕视野中心)", // 改个文案
                follow: "跟随指定 Token"
            }
        };
    }

    /* -------------------------------------------- */
    /*  交互逻辑                                    */
    /* -------------------------------------------- */

    /**
     * 点击 "生成" 按钮触发
     */
    async _onCreate(event, target) {
        // 阻止表单默认提交刷新页面
        event.preventDefault();
        const formData = new FormData(this.element);
        const scene = canvas.scene;
        if (!scene) return;

        // 获取基础数据
        const label = formData.get("label") || "未命名区域";
        const rawDistance = parseFloat(formData.get("distance")) || 1;
        const finalDistance = rawDistance * (canvas.dimensions.distance || 1);
        const color = formData.get("color");
        const mode = formData.get("mode");
        const selectedTokenId = formData.get("tokenId"); // 获取下拉框选中的 ID

        let x = 0;
        let y = 0;
        let sourceTokenId = null;
        let isSticky = false;

        if (mode === "follow") {
            // --- 模式 A: 跟随 ---
            // 从场景中查找 ID 对应的 Token
            const targetToken = scene.tokens.get(selectedTokenId)?.object;

            if (!targetToken) {
                return ui.notifications.warn("请选择一个有效的 Token 进行跟随。");
            }

            const { center } = targetToken;
            x = center.x;
            y = center.y;
            sourceTokenId = targetToken.id;
            isSticky = true;

        } else {
            // --- 模式 B: 静态 (视野中心) ---
            // 不再使用鼠标位置，改用当前视野中心 (Pivot)
            // canvas.stage.pivot 存储的是当前屏幕中心点在 Canvas 坐标系下的位置
            const { x: cx, y: cy } = canvas.stage.pivot;

            // 为了美观，对齐到最近的网格交点/中心
            const offset = canvas.grid.getOffset({ x: cx, y: cy });
            const center = canvas.grid.getCenterPoint(offset);

            x = center.x;
            y = center.y;
        }

        const templateData = {
            t: "circle",
            user: game.user.id,
            distance: finalDistance,
            direction: 0,
            x: x,
            y: y,
            fillColor: color,
            flags: {
                "xjzl-system": {
                    label: label,
                    sourceToken: sourceTokenId,
                    sticky: isSticky
                }
            }
        };

        await scene.createEmbeddedDocuments("MeasuredTemplate", [templateData]);
        ui.notifications.info(`已创建区域: ${label}`);
        this.close(); // 创建后自动关闭窗口，方便查看
    }

    /**
     * 渲染后触发，处理 DOM 交互
     */
    _onRender(context, options) {
        super._onRender(context, options);

        // 获取 DOM 元素
        const modeSelect = this.element.querySelector('select[name="mode"]');
        const tokenGroup = this.element.querySelector('#token-select-group'); // 需要你在 hbs 里给那个 div 加 id

        if (!modeSelect || !tokenGroup) return;

        // 定义切换逻辑
        const toggleTokenSelect = () => {
            if (modeSelect.value === "follow") {
                tokenGroup.style.display = "flex";
            } else {
                tokenGroup.style.display = "none";
            }
        };

        // 初始化执行一次
        toggleTokenSelect();

        // 绑定事件
        modeSelect.addEventListener("change", toggleTokenSelect);
    }
}