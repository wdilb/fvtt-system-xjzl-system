/**
 * 侠界之旅 - 自定义测量模板 (V13 RenderFlags 版)
 */
const MeasuredTemplate = foundry.canvas.placeables.MeasuredTemplate;

export class XJZLMeasuredTemplate extends MeasuredTemplate {

    /* -------------------------------------------- */
    /*  渲染层：显示名字                            */
    /* -------------------------------------------- */

    /**
     * V13: 初始化绘制 (只执行一次)
     */
    async _draw() {
        // 必须等待父类绘制完成
        await super._draw();

        // 创建文本对象 (如果还没创建)
        if (!this.labelDetails) {
            this.labelDetails = this.addChild(new PIXI.Text("", {
                fontFamily: "Signika", // 建议与系统字体保持一致
                fontSize: 24,
                fill: "#FFFFFF",
                stroke: "#000000",
                strokeThickness: 4,
                align: "center",
                fontWeight: "bold",
                dropShadow: true,
                dropShadowColor: "#000000",
                dropShadowBlur: 2,
                dropShadowAngle: 0,
                dropShadowDistance: 0
            }));

            // 确保文字层级很高，盖住模板颜色
            this.labelDetails.zIndex = 100;
            // 居中锚点
            this.labelDetails.anchor.set(0.5, 0.5);
        }
    }

    /**
     * V13: 渲染标志处理 (核心更新逻辑)
     * 替代了旧版的 _refresh
     */
    _applyRenderFlags(flags) {
        // 先让父类处理它的逻辑 (画圆、画尺子等)
        super._applyRenderFlags(flags);

        // 如果涉及到了 refreshState (状态改变) 或 refreshTemplate (形状改变)，我们更新文字
        // 这是一个比较宽泛的判断，确保文字能刷出来
        if (flags.refreshState || flags.refreshTemplate || flags.refreshPosition) {
            this._updateLabel();
        }
    }

    /**
     * 自定义方法：更新标签内容和位置
     */
    _updateLabel() {
        if (!this.labelDetails) return;

        // 获取 Flag 数据
        const labelText = this.document.getFlag("xjzl-system", "label");

        if (labelText) {
            this.labelDetails.text = labelText;
            this.labelDetails.visible = true;

            // 这里的 (0,0) 是模板容器的相对中心，无论模板怎么移动，文字始终在模板中心
            // V13 中，Template 内部的子对象坐标是相对于 Template 原点的
            this.labelDetails.position.set(0, 0);
        } else {
            this.labelDetails.visible = false;
        }
    }

    /* -------------------------------------------- */
    /*  核心逻辑：自定义距离高亮 (通用网格版)        */
    /* -------------------------------------------- */

    _getGridHighlightPositions() {
        // 只有圆形才使用我们的自定义格子逻辑
        if (this.document.t !== "circle") {
            return super._getGridHighlightPositions();
        }

        const grid = canvas.grid;
        const d = canvas.dimensions;
        const { x, y, distance } = this.document;

        // 1. 获取中心 Offset (网格坐标 i, j)
        const originOffset = grid.getOffset({ x, y });
        // 2. 获取精确的像素中心点 (用于计算距离)
        const originCenter = grid.getCenterPoint(originOffset);

        // 3. 确定遍历范围
        // 无论方形还是六边形，算出大概涉及多少个格子
        const rangeGrid = Math.ceil(distance / d.distance);

        const highlights = [];

        // 4. 遍历包围盒 (Bounding Box Loop)
        // 这个循环对六边形也是安全的，canvas.grid.getOffset 会处理坐标转换
        // 虽然六边形是斜的，但正方形包围盒能覆盖住它，多余的格子会在距离判断中被剔除
        for (let i = -rangeGrid; i <= rangeGrid; i++) {
            for (let j = -rangeGrid; j <= rangeGrid; j++) {

                // 计算目标格子的 Offset
                const targetOffset = { i: originOffset.i + i, j: originOffset.j + j };

                // 获取目标格子的像素中心
                const targetCenter = grid.getCenterPoint(targetOffset);

                // 5. 核心：调用 grid.measurePath
                // 这里的妙处在于：如果场景是方形，它调用的就是你重写过的 SquareGrid.measurePath
                // 如果场景是六边形，它调用的是系统默认的 HexagonalGrid.measurePath (通常是正确的1格=1距)
                const result = grid.measurePath([
                    { x: originCenter.x, y: originCenter.y },
                    { x: targetCenter.x, y: targetCenter.y }
                ]);

                // 6. 距离判断 (加 0.1 容差)
                if (result.distance <= distance + 0.1) {
                    // 获取左上角坐标用于高亮绘制
                    const targetTopLeft = grid.getTopLeftPoint(targetOffset);
                    highlights.push({ x: targetTopLeft.x, y: targetTopLeft.y });
                }
            }
        }

        return highlights;
    }
}