/**
 * 侠界之旅 - 自定义测量模板
 */
export class XJZLMeasuredTemplate extends foundry.canvas.placeables.MeasuredTemplate {

    /**
     * 重写 _draw：初始化文字对象
     */
    async _draw() {
        await super._draw(); // 必须先画出父类的东西

        // 创建文字对象 (如果不存在)
        if (!this.labelName) {
            this.labelName = this.addChild(new PIXI.Text("", {
                fontFamily: "Signika",
                fontWeight: "bold",
                fontSize: 32,
                fill: "#FFFFFF",
                stroke: "#000000",
                strokeThickness: 6,
                align: "center",
                dropShadow: true,
                dropShadowColor: "#000000",
                dropShadowBlur: 4,
                dropShadowAngle: Math.PI / 6,
                dropShadowDistance: 2,
            }));

            this.labelName.anchor.set(0.5, 0.5);
            // V13/Pixi 技巧：开启排序并设置极高的 zIndex，确保文字永远在形状上面
            this.sortableChildren = true;
            this.labelName.zIndex = 1000;
        }
    }

    /**
     * 重写 _refresh：更新文字内容与位置
     */
    _refresh() {
        super._refresh();

        // 1. 获取名字 (兼容多种写法)
        const flags = this.document.flags;
        const labelText = flags?.xjzl?.label || flags?.mySystem?.label || "";

        // 2. 更新文字可见性和内容
        if (this.labelName) {
            this.labelName.text = labelText;
            this.labelName.visible = !!labelText;

            // 3. 计算位置
            // 圆形 (circle) 的中心在本地坐标系 (0,0)
            // 锥形/射线 (cone/ray) 的中心我们取中点
            if (this.document.t === "circle") {
                this.labelName.position.set(0, 0);
            } else if (this.ray) {
                this.labelName.position.set(this.ray.dx / 2, this.ray.dy / 2);
            }
        }
    }

    /**
     * =====================================================
     * 核心功能：重写高亮算法 (1-2-2-2 规则)
     * =====================================================
     * 这个方法决定了哪些网格会被高亮显示
     */
    _getGridHighlightPositions() {
        // 如果不是圆形，或者没有距离，就退回系统默认算法（比如锥形先不改）
        if (this.document.t !== "circle") {
            return super._getGridHighlightPositions();
        }

        const grid = canvas.grid;
        const d = canvas.dimensions;
        const { x, y, distance } = this.document; // 模板原点和半径(尺)

        // 1. 确定扫描范围 (Bounding Box)
        // 为了性能，我们只扫描半径矩形内的格子
        // 将距离转换为像素
        const distPixels = (distance / d.distance) * d.size;

        // 获取模板中心所在的格子坐标 (Row, Col)
        const [centerRow, centerCol] = grid.grid.getGridPositionFromPixels(x, y);

        // 计算覆盖的格子半径 (向上取整，多扫一圈以防万一)
        const gridRadius = Math.ceil(distance / d.distance);

        const positions = [];

        // 2. 遍历周围的格子
        for (let r = -gridRadius; r <= gridRadius; r++) {
            for (let c = -gridRadius; c <= gridRadius; c++) {

                // 目标格子的偏移量 (绝对值)
                const dx = Math.abs(c);
                const dy = Math.abs(r);

                // === 你的 1-2-2-2 算法实现 ===
                // 逻辑：直行步数 + 斜行步数
                const diagonalSteps = Math.min(dx, dy);
                const straightSteps = Math.abs(dy - dx);

                let gridCost = straightSteps;

                // 模拟那个 for 循环：第1步斜行算1，后面算2
                // 公式化：如果 diagonalSteps > 0，则 cost = 1 + (diagonalSteps - 1) * 2
                // 等价于：2 * diagonalSteps - 1
                if (diagonalSteps > 0) {
                    gridCost += (1 + (diagonalSteps - 1) * 2);
                }

                // 计算总距离
                const totalDistance = gridCost * d.distance;

                // 3. 判定是否在范围内
                // 使用 <= 是因为包含边界
                if (totalDistance <= distance) {
                    // 获取该格子的像素坐标 (左上角)
                    const [gx, gy] = grid.grid.getPixelsFromGridPosition(centerRow + r, centerCol + c);

                    // 创建一个唯一标识符 (color 用于区分不同层级，这里没啥用，给个默认值)
                    positions.push({ x: gx, y: gy, color: this.document.fillColor });
                }
            }
        }

        return positions;
    }
}