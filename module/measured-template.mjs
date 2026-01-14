/**
 * 侠界之旅 - 自定义测量模板
 */
export class XJZLMeasuredTemplate extends foundry.canvas.placeables.MeasuredTemplate {

    /**
     * 初始化绘制
     */
    async _draw() {
        await super._draw(); // 先画父类的东西

        // 创建文字对象
        if (!this.labelName) {
            this.labelName = this.addChild(new PIXI.Text("", {
                fontFamily: "Signika",
                fontWeight: "bold",
                fontSize: 48,           // 字体再调大一点
                fill: "#FFFFFF",        // 纯白
                stroke: "#000000",      // 黑色描边
                strokeThickness: 6,
                align: "center",
                dropShadow: true,
                dropShadowColor: "#000000",
                dropShadowBlur: 4,
                dropShadowAngle: Math.PI / 6,
                dropShadowDistance: 2,
            }));

            this.labelName.anchor.set(0.5, 0.5);
            // 开启排序
            this.sortableChildren = true;
            this.labelName.zIndex = 9999;
        }
    }

    /**
     * 刷新逻辑
     */
    _refresh() {
        super._refresh(); // 父类刷新形状

        // 1. 获取 Flag
        const flags = this.document.flags;

        // Debug: 把所有 flag 打印出来看看，到底存哪了
        console.log("XJZL Debug | Flags:", flags);

        // 尝试读取 xjzl-system (这是你的系统真正ID)
        // 兼容之前的 xjzl
        const labelText = flags?.["xjzl-system"]?.label || flags?.xjzl?.label || ""

        // 2. 调试日志 (请在控制台查看)
        if (labelText) {
            console.log(`XJZL | 正在刷新模板，检测到名字: "${labelText}"`);
        }

        if (this.labelName) {
            // 设置内容
            this.labelName.text = labelText;
            this.labelName.visible = !!labelText;

            if (labelText) {
                // 3. 坐标修正
                // 在 V13 中，Template (0,0) 即为原点
                // 圆形：原点即圆心
                if (this.document.t === "circle") {
                    this.labelName.position.set(0, 0);
                } else if (this.ray) {
                    this.labelName.position.set(this.ray.dx / 2, this.ray.dy / 2);
                }

                // 4. 强制置顶
                // 为了防止被 super._refresh() 重绘的图形覆盖，
                // 我们在刷新的一刻，把 labelName 重新移到 children 数组的最后面 (Top)
                this.addChild(this.labelName);
            }
        }
    }

    /**
     * 1-2-2-2 高亮算法 (V13)
     */
    _getGridHighlightPositions() {
        if (this.document.t !== "circle") return super._getGridHighlightPositions();

        // 兼容 V13 isHexagonal
        const grid = canvas.grid;
        if (grid.isHexagonal) return super._getGridHighlightPositions();

        const d = canvas.dimensions;
        const { x, y, distance } = this.document;

        // V13 API
        const centerOffset = grid.getOffset({ x, y });
        const centerI = centerOffset.i;
        const centerJ = centerOffset.j;

        // 计算半径 (按你的设定，distance 就是格子数，所以 distance / 1 = 格子数)
        // 假设你的 d.distance 是 1。如果 d.distance 是 5，这里就是 distance/5。
        // 为了稳妥，直接用 distance / d.distance
        const gridRadius = Math.ceil(distance / d.distance);

        const positions = [];

        for (let i = -gridRadius; i <= gridRadius; i++) {
            for (let j = -gridRadius; j <= gridRadius; j++) {
                const dx = Math.abs(i);
                const dy = Math.abs(j);

                // 1-2-2-2 逻辑
                const diagonalSteps = Math.min(dx, dy);
                const straightSteps = Math.abs(dy - dx);

                let gridCost = straightSteps;
                if (diagonalSteps > 0) {
                    gridCost += (2 * diagonalSteps - 1);
                }

                const totalDistance = gridCost * d.distance;

                if (totalDistance <= distance) {
                    const targetI = centerI + i;
                    const targetJ = centerJ + j;
                    const dest = grid.getTopLeftPoint({ i: targetI, j: targetJ });

                    positions.push({ x: dest.x, y: dest.y, color: this.document.fillColor });
                }
            }
        }
        return positions;
    }
}