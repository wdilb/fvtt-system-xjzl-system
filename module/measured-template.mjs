/**
 * 侠界之旅 - 自定义测量模板
 *
 * 【V14 升级 S1.14 停用，代码仅注释未删除】按升级计划提前下线：14.368 实测仍提供
 * MeasuredTemplate 弃用兼容层（foundry.canvas.placeables.MeasuredTemplate / CONFIG.MeasuredTemplate /
 * scene.templates 可用），本文件在兼容层下可运行，但不再基于弃用 API 继续开发，入口已在
 * xjzl-system.mjs 中注释停用。文件整体保留，供 M3 Region/光环重建（docs/V14_UPGRADE.md §3）参考：
 * - _getGridHighlightPositions：圆形 1-2-2-2 按格覆盖算法（包围盒遍历 + 欧几里得剪枝 + measurePath 精确判定）
 * - get tokens：AoE 范围查询预留接口（同款距离判定）
 * - _draw/_updateLabel：模板标签绘制与点击穿透处理
 * 注意：网格 API 命名（getOffset/getCenterPoint/getTopLeftPoint/measurePath）已按 V14 预检一致，
 * 但行为需实机回归（总纲 §4/§7），恢复时不能直接照搬。
 */
const MeasuredTemplate = foundry.canvas.placeables.MeasuredTemplate;

export class XJZLMeasuredTemplate extends MeasuredTemplate {

    /* -------------------------------------------- */
    /*  渲染层：显示名字               */
    /* -------------------------------------------- */

    async _draw() {
        await super._draw();
        if (!this.labelDetails) {
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
            // V13 (PixiJS 7+) 使用 eventMode。设置为 'none' 表示忽略所有交互事件，
            // 鼠标点击会直接“穿透”文字，点到下面的 Control Icon。
            this.labelDetails.eventMode = "none";

            // 兼容旧版写法 (双重保险)
            this.labelDetails.interactive = false;
        }
    }

    _applyRenderFlags(flags) {
        super._applyRenderFlags(flags);
        if (flags.refreshState || flags.refreshTemplate || flags.refreshPosition) {
            this._updateLabel();
        }
    }

    _updateLabel() {
        if (!this.labelDetails) return;
        const labelText = this.document.getFlag("xjzl-system", "label");
        if (labelText) {
            this.labelDetails.text = labelText;
            this.labelDetails.visible = true;
            this.labelDetails.position.set(0, -30); //稍微上移一点，不要挡住我们的交互点
        } else {
            this.labelDetails.visible = false;
        }
    }

    /* -------------------------------------------- */
    /*  核心逻辑：自定义距离高亮 + 剪枝优化          */
    /* -------------------------------------------- */

    _getGridHighlightPositions() {
        if (this.document.t !== "circle") {
            return super._getGridHighlightPositions();
        }

        const grid = canvas.grid;
        const d = canvas.dimensions;
        const { x, y, distance } = this.document;

        // 1. 计算格子半径 (Grid Radius)
        // 这是为了确定我们要遍历多少个格子。
        // distance 是场景单位，d.distance 是每格单位。
        // 如果场景是 1格=1单位，那么 gridRadius = distance。
        const gridRadius = distance / d.distance;

        // 2. 转换为像素距离 (用于物理剪枝)
        // gridRadius * grid.size 得到的是物理像素半径
        const maxPixelDist = gridRadius * d.size;
        // 平方，避免后续开根号运算
        // 增加 d.size * 0.5 的容差，确保覆盖到格子的最远角
        const maxPixelDistSq = Math.pow(maxPixelDist + (d.size * 0.5), 2);

        // 3. 确定遍历范围 (向上取整)
        const rangeGrid = Math.ceil(gridRadius);

        // 准备数据
        const originOffset = grid.getOffset({ x, y });
        const originCenter = grid.getCenterPoint(originOffset);
        const highlights = [];

        // 4. 遍历包围盒
        for (let i = -rangeGrid; i <= rangeGrid; i++) {
            for (let j = -rangeGrid; j <= rangeGrid; j++) {

                const targetOffset = { i: originOffset.i + i, j: originOffset.j + j };
                const targetCenter = grid.getCenterPoint(targetOffset);

                // --- 欧几里得剪枝 ---
                const dx = targetCenter.x - originCenter.x;
                const dy = targetCenter.y - originCenter.y;
                const distSq = dx * dx + dy * dy;

                // 如果物理直线距离已经远超范围，直接跳过
                // 这样可以将正方形遍历优化为圆形遍历，大幅减少 measurePath 调用
                if (distSq > maxPixelDistSq) continue;
                // -----------------------------

                // 5. 精确计算 (调用我们写好的 1-2-2-2 算法)
                const result = grid.measurePath([
                    { x: originCenter.x, y: originCenter.y },
                    { x: targetCenter.x, y: targetCenter.y }
                ]);

                // 6. 距离判定
                // 使用 0.1 容差处理浮点数精度
                if (result.distance <= distance + 0.1) {
                    const targetTopLeft = grid.getTopLeftPoint(targetOffset);
                    highlights.push({ x: targetTopLeft.x, y: targetTopLeft.y });
                }
            }
        }

        return highlights;
    }

    /* -------------------------------------------- */
    /*  API：供脚本引擎调用的接口                    */
    /* -------------------------------------------- */

    /**
     * 获取当前模板覆盖范围内的所有 Token，为以后可能考虑实现的aoe自动化预留这个接口
     * @returns {Token[]} Token 对象数组
     */
    get tokens() {
        // 如果场景没加载，返回空
        if (!canvas.scene) return [];

        const grid = canvas.grid;
        const d = canvas.dimensions;
        const { x, y, distance } = this.document;

        // 1. 准备数据
        const originOffset = grid.getOffset({ x, y });
        const originCenter = grid.getCenterPoint(originOffset);

        // 物理距离剪枝参数 (同高亮逻辑)
        const gridRadius = distance / d.distance;
        const maxPixelDist = gridRadius * d.size;
        const maxPixelDistSq = Math.pow(maxPixelDist + (d.size * 0.5), 2);

        const targets = [];

        // 2. 遍历场景中的所有 Token
        // 性能优化：只遍历当前场景下的 Token
        for (const token of canvas.tokens.placeables) {
            if (!token.actor) continue; // 忽略没有 Actor 的装饰性 Token

            // 获取 Token 中心点
            const tokenCenter = token.center;

            // --- 剪枝检查 ---
            const dx = tokenCenter.x - originCenter.x;
            const dy = tokenCenter.y - originCenter.y;
            const distSq = dx * dx + dy * dy;

            if (distSq > maxPixelDistSq) continue; // 物理距离太远，直接跳过

            // --- 精确检查 (只有圆形需要特殊算法，其他形状用默认判定) ---
            if (this.document.t === "circle") {
                const result = grid.measurePath([
                    { x: originCenter.x, y: originCenter.y },
                    { x: tokenCenter.x, y: tokenCenter.y }
                ]);

                if (result.distance <= distance + 0.1) {
                    targets.push(token);
                }
            } else {
                // 如果不是圆形(比如锥形)，使用 FVTT 默认的图形包含判定
                // containsPixel 检查点是否在图形内
                if (this.shape.contains(tokenCenter.x - x, tokenCenter.y - y)) {
                    targets.push(token);
                }
            }
        }

        return targets;
    }
}