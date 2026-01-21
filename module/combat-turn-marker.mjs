/**
 * 侠界之旅 - 战斗标记管理器
 */
export class XJZLTurnMarkerManager {
    // 模块 ID，用于设置键的前缀
    static ID = "xjzl-system";

    // 本地静态缓存
    // 用于在渲染循环(Render Loop)中直接读取配置，避免反复调用 game.settings.get 造成的性能损耗
    static _cache = {
        enabled: true,
        scale: 1.3,
        imgBottom: "",
        imgTop: "",
        alphaBottom: 0.8,
        alphaTop: 0.3
    };

    /**
     * 1. 注册系统设置 (入口方法)
     * 建议在 init 钩子中调用
     */
    static registerSettings() {
        const settings = [
            // 1. 总开关
            {
                key: "enableTurnMarker",
                name: "启用系统战斗标记",
                hint: "如果关闭，将使用 FVTT 默认标记或您安装的其他模组标记。",
                type: Boolean,
                default: true,
                scope: "client", // 客户端级设置，玩家可自行决定是否开启
                config: true,
                onChange: () => this._onSettingChange()
            },
            // 2. 缩放比例
            {
                key: "turnMarkerScale",
                name: "战斗标记缩放比例",
                hint: "标记相对于 Token 尺寸的大小 (默认 1.5 倍)",
                type: Number,
                default: 1.3,
                range: { min: 0.5, max: 3.0, step: 0.1 },
                scope: "client",
                config: true,
                onChange: () => this._onSettingChange()
            },
            // 3. 底图路径
            {
                key: "turnMarkerImgBottom",
                name: "战斗标记-底图路径",
                type: String,
                default: "systems/xjzl-system/assets/picture/pause-bg2.png",
                scope: "world", // 世界级设置，由 GM 统一控制样式
                config: true,
                filePicker: "image",
                onChange: () => this._onSettingChange()
            },
            // 4. 底图透明度
            {
                key: "turnMarkerAlphaBottom",
                name: "战斗标记-底图透明度",
                hint: "0.0 为全透明，1.0 为不透明",
                type: Number,
                default: 0.8,
                range: { min: 0.0, max: 1.0, step: 0.1 },
                scope: "client",
                config: true,
                onChange: () => this._onSettingChange()
            },
            // 5. 顶图路径
            {
                key: "turnMarkerImgTop",
                name: "战斗标记-顶图路径",
                type: String,
                default: "systems/xjzl-system/assets/picture/pause-bg1.png",
                scope: "world",
                config: true,
                filePicker: "image",
                onChange: () => this._onSettingChange()
            },
            // 6. 顶图透明度
            {
                key: "turnMarkerAlphaTop",
                name: "战斗标记-顶图透明度",
                hint: "0.0 为全透明，1.0 为不透明",
                type: Number,
                default: 0.3,
                range: { min: 0.0, max: 1.0, step: 0.1 },
                scope: "client",
                config: true,
                onChange: () => this._onSettingChange()
            }
        ];

        // 批量注册设置
        settings.forEach(s => {
            game.settings.register(this.ID, s.key, s);
        });

        // 初始化缓存并挂载钩子
        this._updateCache();
        this._registerHooks();
    }

    /**
     * 处理设置变更
     * 更新策略：不销毁 Token，只销毁标记 Sprite 并重置状态。
     * 解决了使用 token.draw() 导致重绘瞬间系统图标回退的问题。
     */
    static _onSettingChange() {
        // 1. 同步最新设置到缓存
        this._updateCache();

        // 2. 遍历当前场景所有 Token
        canvas.tokens.placeables.forEach(token => {
            // 获取 Token 内部的 TurnMarker 容器 (V13 API)
            const turnMarker = token.children.find(c => c.constructor.name === "TokenTurnMarker");

            if (turnMarker) {
                // A. 清理旧资源：防止内存泄漏
                if (turnMarker._xjzlSprites) {
                    if (turnMarker._xjzlSprites.bottom) turnMarker._xjzlSprites.bottom.destroy();
                    if (turnMarker._xjzlSprites.top) turnMarker._xjzlSprites.top.destroy();
                    turnMarker._xjzlSprites = null;
                }

                // B. 重置状态：强制触发 _initCustomSprites 重新加载
                turnMarker._xjzlInitDone = false;

                // C. 临时恢复可见性：确保系统 refresh 逻辑能正常运行
                // (随后我们的 handleTurnMarker 会再次接管并隐藏它们)
                turnMarker.children.forEach(c => c.visible = true);
            }

            // 3. 轻量级刷新：触发 _refreshTurnMarker 钩子
            token.refresh();
        });
    }

    /**
     * 更新本地缓存
     */
    static _updateCache() {
        this._cache.enabled = game.settings.get(this.ID, "enableTurnMarker");
        this._cache.scale = game.settings.get(this.ID, "turnMarkerScale");
        this._cache.imgBottom = game.settings.get(this.ID, "turnMarkerImgBottom");
        this._cache.imgTop = game.settings.get(this.ID, "turnMarkerImgTop");
        this._cache.alphaBottom = game.settings.get(this.ID, "turnMarkerAlphaBottom");
        this._cache.alphaTop = game.settings.get(this.ID, "turnMarkerAlphaTop");
        // console.log("XJZL | 战斗标记缓存已更新", this._cache);
    }

    /**
     * 注册钩子与补丁
     */
    static _registerHooks() {
        const TokenClass = CONFIG.Token.objectClass;
        // 保存原始方法引用
        this._originalRefresh = TokenClass.prototype._refreshTurnMarker;
        const self = this;

        // 覆写 _refreshTurnMarker
        // 注意：必须使用 function() 而非箭头函数，以保持 `this` 指向 Token 实例
        TokenClass.prototype._refreshTurnMarker = function (...args) {
            // 1. 快速检查开关 (读取缓存，极快)
            if (!self._cache.enabled) {
                return self._originalRefresh.apply(this, args);
            }

            // 2. 执行系统原始逻辑 (确保容器被创建)
            self._originalRefresh.apply(this, args);

            // 3. 接管控制权，应用自定义效果
            self.handleTurnMarker(this);
        };

        console.log("XJZL | 战斗标记管理器已挂载 (V13 优化版)");
    }

    /**
     * 处理单个 Token 的标记逻辑
     * @param {Token} token - 当前正在刷新的 Token 对象
     */
    static handleTurnMarker(token) {
        // === A. 基础状态判断 ===
        const combatant = game.combat?.combatant;
        // 判定条件：当前有战斗 & 轮到该 Combatant & Token ID 匹配
        const isActive = combatant && (token.id === combatant.token?.id);

        // 查找系统生成的 TurnMarker 容器
        const turnMarker = token.children.find(c => c.constructor.name === "TokenTurnMarker");

        // 容器不存在或不是当前行动者，直接退出
        if (!turnMarker) return;
        if (!isActive) return;

        // === B. 视觉控制 ===
        // 1. 强力隐藏系统自带圆环 (防止系统在 refresh 中重置 visible 属性)
        this._hideSystemRing(turnMarker);

        // 2. 分支逻辑
        if (!turnMarker._xjzlInitDone) {
            // 情况一：尚未初始化 -> 执行异步加载
            this._initCustomSprites(turnMarker, token);
        } else if (turnMarker._xjzlSprites) {
            // 情况二：已初始化 -> 检查路径一致性 (防止缓存意外变更)
            const { imgBottom, imgTop } = this._cache;
            if (turnMarker._xjzlSprites.pathBottom !== imgBottom || turnMarker._xjzlSprites.pathTop !== imgTop) {
                // 路径不匹配，强制重置并刷新
                turnMarker._xjzlInitDone = false;
                token.refresh();
                return;
            }

            // 路径一致 -> 仅更新属性 (大小/透明度)
            this._updateAttributes(turnMarker, token);
        }
    }

    /**
     * 隐藏系统自带的子元素 (虚线圆环)
     * 使用 for...of 循环以获得最佳性能
     */
    static _hideSystemRing(turnMarker) {
        for (const child of turnMarker.children) {
            // 逻辑：只要它是可见的，且没有打上我们的自定义标记 (_isXJZLSprite)，就视为系统元素并隐藏
            if (child.visible && !child._isXJZLSprite) {
                child.visible = false;
            }
        }
    }

    /**
     * 异步加载纹理并创建 Sprite
     */
    static async _initCustomSprites(turnMarker, token) {
        // 抢占标记，防止在异步等待期间被重复调用
        turnMarker._xjzlInitDone = true;

        try {
            const { imgBottom, imgTop } = this._cache;

            // 再次确保系统圆环被隐藏 (因为 await 之前的一帧可能发生过渲染)
            this._hideSystemRing(turnMarker);

            // 并行加载纹理
            const [texBottom, texTop] = await Promise.all([
                foundry.canvas.loadTexture(imgBottom),
                foundry.canvas.loadTexture(imgTop)
            ]);

            // 【关键安全检查】异步回来后，Token 可能已被销毁或重绘
            if (!turnMarker || turnMarker.destroyed) return;

            // 创建 PIXI Sprite
            const spriteBottom = new PIXI.Sprite(texBottom);
            const spriteTop = new PIXI.Sprite(texTop);

            // 设置锚点居中
            spriteBottom.anchor.set(0.5);
            spriteBottom._isXJZLSprite = true; // 打上自定义标记，防止被误伤

            spriteTop.anchor.set(0.5);
            spriteTop._isXJZLSprite = true;

            // 添加到容器
            turnMarker.addChild(spriteBottom);
            turnMarker.addChild(spriteTop);

            // 保存引用 (用于 updateAttributes) 和路径 (用于变更检测)
            turnMarker._xjzlSprites = {
                bottom: spriteBottom,
                top: spriteTop,
                pathBottom: imgBottom,
                pathTop: imgTop
            };

            // 创建完毕后立即应用一次属性
            this._updateAttributes(turnMarker, token);

        } catch (err) {
            console.error("XJZL | 战斗标记图片加载失败:", err);
            // 加载失败，重置标记允许重试
            turnMarker._xjzlInitDone = false;
        }
    }

    /**
     * 实时更新属性 (大小、透明度、颜色)
     * 此方法开销极低，可在每一帧调用
     */
    static _updateAttributes(turnMarker, token) {
        const { bottom, top } = turnMarker._xjzlSprites;
        const { scale, alphaBottom, alphaTop } = this._cache;

        // 计算目标尺寸
        const targetSize = token.w * scale;

        // 再次隐藏系统圆环 (多重保险)
        this._hideSystemRing(turnMarker);

        // 应用到底图
        if (bottom && !bottom.destroyed) {
            bottom.visible = true;
            bottom.width = targetSize;
            bottom.height = targetSize;
            bottom.alpha = alphaBottom;
            bottom.tint = 0xFFFFFF; // 清除系统可能染上的颜色 (Team Color)
        }

        // 应用到顶图
        if (top && !top.destroyed) {
            top.visible = true;
            top.width = targetSize;
            top.height = targetSize;
            top.alpha = alphaTop;
            top.tint = 0xFFFFFF;
        }
    }
}