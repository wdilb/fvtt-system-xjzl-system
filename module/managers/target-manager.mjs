/**
 *  目标选择管理器 (Target Manager)
 * 优化原生繁琐的目标选择逻辑，实现 "Alt + 左键" 快速标记
 */
export class TargetManager {
    static init() {
        // 1. 监听鼠标按下事件 (使用 capture: true 确保在 Foundry 画布逻辑之前拦截)
        window.addEventListener("mousedown", this._onMouseDown.bind(this), { capture: true });

        // 2. 监听键盘事件 (用于改变鼠标样式)
        window.addEventListener("keydown", this._onKeyDown.bind(this));
        window.addEventListener("keyup", this._onKeyUp.bind(this));
    }

    /**
     * 核心逻辑：拦截点击
     */
    static _onMouseDown(event) {
        // 检查设置：如果关闭，直接忽略，不拦截
        if (!game.settings.get("xjzl-system", "enableAltTargeting")) return;

        // 1. 基本检查：必须按住 Alt，必须是左键(0)，画布必须就绪
        if (!event.altKey || event.button !== 0 || !canvas.ready) return;

        // 2. 获取当前鼠标下的 Token
        // canvas.tokens.hover 是 Foundry 提供的当前鼠标悬停的 Token
        const hoveredToken = canvas.tokens.hover;

        // 如果鼠标下没有 Token，或者该 Token 不可见/不可交互，直接返回
        if (!hoveredToken || !hoveredToken.isVisible) return;

        // 3. 【拦截】阻止 Foundry 默认行为 (比如默认的左键选择 Token)
        event.stopPropagation();
        event.preventDefault();

        // 4. 执行瞄准逻辑
        this._toggleTarget(hoveredToken);
    }

    /**
     * 切换目标状态
     */
    static _toggleTarget(token) {
        // 获取当前状态
        // isTargeted 是 Token 类的属性，表示是否被当前用户瞄准
        const isTargeted = token.isTargeted;

        // 执行切换
        // releaseOthers: false 是关键！这意味着不会清除之前的目标
        // 这样你就可以 Alt+点 A，再 Alt+点 B，实现同时瞄准 A 和 B
        // 如果想取消 A，再次 Alt+点 A 即可
        token.setTarget(!isTargeted, { releaseOthers: false });

        // 播放一个小音效反馈 (可选)
        // AudioHelper.play({src: "sounds/target.ogg", volume: 0.8, autoplay: true, loop: false}, false);
    }

    /* -------------------------------------------- */
    /*  视觉优化: 鼠标样式                          */
    /* -------------------------------------------- */

    static _onKeyDown(event) {
        // 检查设置
        if (!game.settings.get("xjzl-system", "enableAltTargeting")) return;
        // 如果用户正在输入框里打字，不要触发准星
        const targetTag = event.target.tagName;
        if (["INPUT", "TEXTAREA", "SELECT"].includes(targetTag)) return;
        // 当按下 Alt 键时，且当前鼠标在 Token 层上
        if (event.key === "Alt" && canvas.ready) {
            document.body.style.cursor = "crosshair"; // 变成十字准星
        }
    }

    static _onKeyUp(event) {
        // 这里不需要严格检查设置，为了防止关闭设置瞬间卡在十字准星上，只要松开 Alt，尝试重置一下 cursor 总是安全的
        // 松开 Alt 键，恢复默认
        if (event.key === "Alt") {
            document.body.style.cursor = "";
        }
    }
}