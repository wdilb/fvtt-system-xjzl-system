/**
 *  目标选择管理器 (Target Manager)
 * 优化原生繁琐的目标选择逻辑，实现 "Alt + 左键" 快速标记
 */
export class TargetManager {
    static init() {
        // 1. 监听鼠标按下事件 (使用 capture: true 确保在 Foundry 画布逻辑之前拦截)
        window.addEventListener("pointerdown", this._onPointerDown.bind(this), { capture: true });
    }

    /**
     * 核心逻辑：拦截点击
     */
    static _onPointerDown(event) {
        // 检查设置：如果关闭，直接忽略，不拦截
        if (!game.settings.get("xjzl-system", "enableAltTargeting")) return;

        // 1. 基本检查
        // event.button === 0 是左键
        // 必须按住 Alt
        if (!event.altKey || event.button !== 0) return;

        // 2. 确保 Canvas 就绪
        if (!canvas.ready || !canvas.tokens) return;

        // 3. 获取鼠标下的 Token
        // V13 标准获取方式
        const hoveredToken = canvas.tokens.hover;

        // 如果没有 Token，或者 Token 不可见，不拦截，交给 Foundry 处理（比如框选）
        if (!hoveredToken || !hoveredToken.isVisible) return;

        // 3. 【拦截】阻止 Foundry 默认行为 (比如默认的左键选择 Token)
        // 阻止默认行为（防止文本选择等）
        event.preventDefault();
        
        // 阻止冒泡（防止事件向上传递）
        event.stopPropagation();
        
        // 阻止同层监听器（防止同一节点上的其他监听器执行）
        // 这能有效防止 Foundry 绑定在 Window 或 Canvas 上的其他 PointerDown 事件，暂时来看不需要
        // event.stopImmediatePropagation();

        // 4. 执行我们自己的逻辑：切换瞄准
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
}