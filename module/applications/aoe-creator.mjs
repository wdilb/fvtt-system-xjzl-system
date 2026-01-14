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
    const controlledToken = canvas.tokens.controlled[0];
    
    return {
      label: "新效果区域",
      distance: 3, // 默认3格
      color: "#FF0000",
      // 如果有选中 Token，默认模式为 follow
      defaultMode: controlledToken ? "follow" : "static",
      hasToken: !!controlledToken,
      tokenName: controlledToken ? controlledToken.name : "",
      // 下拉菜单选项
      modes: {
        static: "静态放置 (屏幕中心/鼠标)",
        follow: "跟随当前选中 Token"
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

    // 1. 获取表单数据
    const label = formData.get("label") || "未命名区域";
    // 处理距离：假设 distance 输入的是“格子数”，在你的系统里直接用即可
    // 如果想要更严谨，可以 * canvas.dimensions.distance
    const rawDistance = parseFloat(formData.get("distance")) || 1;
    const finalDistance = rawDistance * (canvas.dimensions.distance || 1);
    
    const color = formData.get("color");
    const mode = formData.get("mode");

    // 2. 确定位置和 Token 绑定
    let x = 0;
    let y = 0;
    let sourceTokenId = null;
    let isSticky = false;

    // 获取当前选中的 Token (用于验证)
    const controlledToken = canvas.tokens.controlled[0];

    if (mode === "follow") {
      if (!controlledToken) {
        return ui.notifications.warn("跟随模式需要先选中一个 Token。");
      }
      // 使用 Token 中心点
      const { center } = controlledToken;
      x = center.x;
      y = center.y;
      sourceTokenId = controlledToken.id;
      isSticky = true;
    } else {
      // 静态模式：优先尝试获取鼠标在 Canvas 上的位置
      // V13 中 canvas.mousePosition 返回的是当前鼠标相对于 Canvas 的坐标
      const mousePos = canvas.mousePosition;
      
      if (mousePos) {
        // 对齐到网格中心
        const offset = canvas.grid.getOffset(mousePos);
        const center = canvas.grid.getCenterPoint(offset);
        x = center.x;
        y = center.y;
      } else {
        // 如果鼠标不在画布内（罕见），这就放到视图中心
        const { x: cx, y: cy } = canvas.stage.pivot;
        x = cx; 
        y = cy;
      }
    }

    // 3. 构建模板数据
    const templateData = {
      t: "circle",
      user: game.user.id,
      distance: finalDistance,
      direction: 0,
      x: x,
      y: y,
      fillColor: color,
      // 默认给一点透明度，别太实了
      flags: {
        "xjzl-system": {
          label: label,
          sourceToken: sourceTokenId,
          sticky: isSticky
        }
      }
    };

    // 4. 创建文档
    await scene.createEmbeddedDocuments("MeasuredTemplate", [templateData]);

    ui.notifications.info(`已创建区域: ${label}`);
    
    // 可选：创建完是否关闭窗口？
    // this.close(); 
  }
}