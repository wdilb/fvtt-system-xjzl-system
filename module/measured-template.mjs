/**
 * 侠界之旅 - 自定义测量模板 (V13 修正版)
 */

// V13 中，MeasuredTemplate 被移动到了 foundry.canvas.placeables 命名空间下
const MeasuredTemplate = foundry.canvas.placeables.MeasuredTemplate;

export class XJZLMeasuredTemplate extends MeasuredTemplate {

    /* -------------------------------------------- */
    /*  渲染层：显示名字                            */
    /* -------------------------------------------- */

    async _draw() {
        await super._draw();

        // 创建文本对象
        this.labelDetails = this.addChild(new PIXI.Text("", {
            fontFamily: "Signika",
            fontSize: 24,
            fill: "#FFFFFF",
            stroke: "#000000",
            strokeThickness: 4,
            align: "center",
            fontWeight: "bold"
        }));

        this.labelDetails.visible = false;
        // 确保文字层级在最上面
        this.labelDetails.zIndex = 10;
    }

    _refresh() {
        super._refresh();

        const labelText = this.document.getFlag("xjzl-system", "label");
        if (labelText) {
            this.labelDetails.text = labelText;
            this.labelDetails.visible = true;

            // 这里的 position 是相对于 Template 自身的 (0,0 就是中心)
            this.labelDetails.position.set(0, 0);
            this.labelDetails.anchor.set(0.5, 0.5);
        } else {
            this.labelDetails.visible = false;
        }
    }

    /* -------------------------------------------- */
    /*  核心逻辑：自定义 V13 高亮算法               */
    /* -------------------------------------------- */

    _getGridHighlightPositions() {
        // 只有圆形才使用我们的自定义格子逻辑，其他的(锥形、射线)还是用系统的几何计算比较好
        if (this.document.t !== "circle") {
            return super._getGridHighlightPositions();
        }

        const grid = canvas.grid;
        const d = canvas.dimensions;
        const { x, y, distance } = this.document;

        // 1. 获取模板中心所在的 网格坐标 (i, j)
        // getOffset 替代了 getGridPositionFromPixels
        const originOffset = grid.getOffset({ x, y });

        // 2. 为了保证计算精确，我们将起点强制修正为“该格子的正中心”
        // 这样避免因为鼠标点击位置稍微偏了一点点，导致距离计算跨格
        const originCenter = grid.getCenterPoint(originOffset);

        // 3. 计算遍历范围 (格子数)
        // distance 是尺数 (如 30)，d.distance 是每格尺数 (如 5)
        // 我们多遍历一圈，确保边缘格子被包含，然后在循环内筛选
        const rangeGrid = Math.ceil(distance / d.distance);

        const highlights = [];

        // 4. 遍历以中心为原点的正方形区域
        for (let i = -rangeGrid; i <= rangeGrid; i++) {
            for (let j = -rangeGrid; j <= rangeGrid; j++) {

                // 目标格子的网格坐标
                const targetOffset = { i: originOffset.i + i, j: originOffset.j + j };

                // 目标格子的像素中心点 (V13 API: getCenterPoint)
                const targetCenter = grid.getCenterPoint(targetOffset);

                // 5. 调用你的自定义 measurePath
                // 你的 measurePath 期望的是像素点数组
                const waypoints = [
                    { x: originCenter.x, y: originCenter.y },
                    { x: targetCenter.x, y: targetCenter.y }
                ];

                // 调用 Grid 的 measurePath (它会去调你在 init 里重写的 SquareGrid.prototype.measurePath)
                const result = grid.measurePath(waypoints);

                // 6. 判定
                // 使用 <= distance。加个微小的 epsilon (0.01) 防止浮点数精度误差
                if (result.distance <= distance + 0.01) {
                    // V13 需要返回 {x, y, color}，这里的 x,y 是像素坐标
                    // 注意：highlight grid 还是需要左上角坐标或者中心坐标，V13 内部会自动处理
                    // 我们直接给 grid 计算出的左上角最稳妥，或者直接传 targetCenter 也行，
                    // 但为了兼容 _getGridHighlightPositions 的预期返回，通常是 Grid 对象的坐标点。
                    // 最安全的做法是将 grid offset 转换回 point。

                    // 获取该格子的左上角 (用于绘制高亮块)
                    const targetTopLeft = grid.getTopLeftPoint(targetOffset);

                    highlights.push({ x: targetTopLeft.x, y: targetTopLeft.y });
                }
            }
        }

        return highlights;
    }
}