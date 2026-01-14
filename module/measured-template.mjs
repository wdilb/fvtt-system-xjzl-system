export class XJZLMeasuredTemplate extends MeasuredTemplate {

  /**
   * 重写 _draw 方法，在绘制模板时额外创建一个文本对象
   */
  async _draw() {
    // 1. 调用父类方法，确保基础的形状、外框都能画出来
    await super._draw();

    // 2. 创建用于显示名字的 Text 对象
    // 我们把它挂在 this 上，方便后续更新
    if (!this.labelName) {
      this.labelName = this.addChild(new PIXI.Text("", {
        fontFamily: "Signika", // FVTT 默认字体，也可以换其他的
        fontSize: 24,
        fill: "#FFFFFF",
        stroke: "#000000",
        strokeThickness: 4,
        align: "center"
      }));
      
      // 把它居中锚点
      this.labelName.anchor.set(0.5, 0.5);
    }
  }

  /**
   * 重写 _refresh 方法，每次模板数据变化（移动、缩放）时都会调用
   * 我们在这里更新文字的内容和位置
   */
  _refresh() {
    // 1. 调用父类刷新形状
    super._refresh();

    // 2. 获取我们要显示的文本
    // 这里的逻辑是：优先读取 flag 里的名字，如果没有，就暂时不显示
    const labelText = this.document.flags?.mySystem?.label || "";

    // 3. 更新文本内容
    if (this.labelName) {
      this.labelName.text = labelText;
      
      // 4. 更新位置
      // 这里的 this.ray 是模板的核心射线，我们把字放在模板的中心点
      // 对于圆形/方形，中心点通常是射线的终点或几何中心，这里简单处理，先放在形状的几何中心
      // 注意：MeasuredTemplate 的坐标系原点是模板的起始点
      
      if (this.document.t === "cone") {
        // 锥形特殊处理，稍微往外放一点，或者放在射线中点
        this.labelName.position.set(this.ray.dx / 2, this.ray.dy / 2);
      } else {
        // 圆形、矩形通常可以用 shape 的中心
        // 但简单起见，对于圆形(circle)，中心点就是 (0,0) 的偏移量吗？
        // FVTT 的 Template 渲染逻辑里，Circle 的中心就在 (0,0)
        this.labelName.position.set(this.ray.dx / 2, this.ray.dy / 2); 
        
        // 修正：上面的 ray.dx/dy 是对于锥形或射线有用的。
        // 对于圆形 (circle)，实际上它的位置在绘制时可能有些偏移。
        // 让我们先简单地设置为 (0,0)，看看效果，通常 Circle 的中心就在 Template 的 transform 原点
        if (this.document.t === "circle") {
           this.labelName.position.set(0, 0);
        }
      }
      
      // 确保文字可见且在最上层
      this.labelName.visible = !!labelText;
    }
  }
}