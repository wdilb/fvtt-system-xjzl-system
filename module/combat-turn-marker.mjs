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
                hint: "标记相对于 Token 尺寸的大小 (默认 1.3 倍)",
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
     * 更新策略：摧毁我们独立的容器，强制重绘
     */
    static _onSettingChange() {
        // 1. 同步最新设置到缓存
        this._updateCache();

        // 2. 遍历当前场景所有 Token
        canvas.tokens.placeables.forEach(token => {
            // 如果存在我们自定义的独立容器，彻底销毁它以便重新生成
            if (token._xjzlTurnMarker && !token._xjzlTurnMarker.destroyed) {
                token._xjzlTurnMarker.destroy({ children: true });
                token._xjzlTurnMarker = null;
            }

            // 如果关闭了总开关，释放系统的标记，让难看的圈回来
            if (!this._cache.enabled && token.turnMarker) {
                token.turnMarker.renderable = true;
                token.turnMarker.alpha = 1;
            }

            // 3. 轻量级刷新
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
    }

    /**
     * 注册钩子与补丁 (核心解耦逻辑)
     */
    static _registerHooks() {
        const TokenClass = CONFIG.Token.objectClass;
        this._originalRefresh = TokenClass.prototype._refreshTurnMarker;
        const self = this;

        // 接管刷新逻辑
        TokenClass.prototype._refreshTurnMarker = function (...args) {
            // 1. 让 FVTT 跑完它自己的重绘 (无论它怎么挣扎画黄圈，都在这一步完成)
            self._originalRefresh.apply(this, args);

            // 2. 检查开关
            if (!self._cache.enabled) return;

            // 3. 降维打击：直接在 PIXI 底层阻断系统标记的渲染
            // 无论系统刚才怎么重绘了几何图形，renderable = false 让它立刻在这个宇宙消失
            if (this.turnMarker) {
                this.turnMarker.renderable = false;
                this.turnMarker.visible = false;
                this.turnMarker.alpha = 0;
            }

            // 4. 操作我们自己脱钩的独立容器
            self.handleTurnMarker(this);
        };

        // 接管旋转动画 (可选，但加上会让顶底图有极佳的交错旋转效果)
        if (TokenClass.prototype._animateTurnMarker) {
            this._originalAnimate = TokenClass.prototype._animateTurnMarker;
            TokenClass.prototype._animateTurnMarker = function (...args) {
                self._originalAnimate.apply(this, args); // 让系统去算旋转角度

                if (self._cache.enabled && this._xjzlTurnMarker && this.isTurn) {
                    if (this._xjzlTurnMarker._xjzlSprites) {
                        const { bottom, top } = this._xjzlTurnMarker._xjzlSprites;
                        const angle = this.turnMarker ? this.turnMarker.rotation : 0;
                        
                        // 底图顺时针，顶图逆时针旋转
                        if (bottom) bottom.rotation = angle;
                        if (top) top.rotation = -angle; 
                    }
                }
            };
        }

        console.log("XJZL | 战斗标记管理器已挂载 (独立容器抗干扰版)");
    }

    /**
     * 处理单个 Token 的标记逻辑
     * @param {Token} token - 当前正在刷新的 Token 对象
     */
    static handleTurnMarker(token) {
        const combatant = game.combat?.combatant;
        // 判定条件：当前有战斗 & 轮到该 Combatant & Token ID 匹配
        const isActive = combatant && (token.id === combatant.token?.id);

        // 如果不是当前行动者，隐藏我们的独立容器
        if (!isActive) {
            if (token._xjzlTurnMarker && !token._xjzlTurnMarker.destroyed) {
                token._xjzlTurnMarker.visible = false;
            }
            return;
        }

        // 如果独立容器不存在，创建一个全新的脱钩容器
        if (!token._xjzlTurnMarker || token._xjzlTurnMarker.destroyed) {
            token._xjzlTurnMarker = token.addChild(new PIXI.Container());
            token._xjzlTurnMarker.zIndex = -1; // -1 确保它在 Token 角色贴图的下方
            
            // 关键：将容器的坐标轴固定在 Token 的正中心
            token._xjzlTurnMarker.position.set(token.w / 2, token.h / 2);
            
            this._initCustomSprites(token);
        } else {
            // 时刻修正坐标（以防 Token 的宽高在游戏过程中动态改变）
            token._xjzlTurnMarker.position.set(token.w / 2, token.h / 2);

            // 检查路径一致性，如果不一致，炸掉里面的子元素重新加载
            const currentPaths = this._cache.imgBottom + "|" + this._cache.imgTop;
            if (token._xjzlTurnMarker._xjzlPaths !== currentPaths) {
                token._xjzlTurnMarker.removeChildren().forEach(c => c.destroy());
                token._xjzlTurnMarker._xjzlSprites = null;
                this._initCustomSprites(token);
                return;
            }

            token._xjzlTurnMarker.visible = true;
            this._updateAttributes(token);
        }
    }

    /**
     * 异步加载纹理并创建 Sprite
     */
    static async _initCustomSprites(token) {
        const container = token._xjzlTurnMarker;
        if (!container) return;

        const { imgBottom, imgTop } = this._cache;
        // 记录当前的路径签名
        container._xjzlPaths = imgBottom + "|" + imgTop;

        try {
            // 并行加载纹理
            const [texBottom, texTop] = await Promise.all([
                foundry.canvas.loadTexture(imgBottom),
                foundry.canvas.loadTexture(imgTop)
            ]);

            // 异步回来后，Token 可能已被删除，容器可能已销毁
            if (container.destroyed) return;

            // 创建 PIXI Sprite
            const spriteBottom = new PIXI.Sprite(texBottom);
            const spriteTop = new PIXI.Sprite(texTop);

            // 设置锚点居中
            spriteBottom.anchor.set(0.5);
            spriteTop.anchor.set(0.5);

            // 添加到我们自己的独立容器
            container.addChild(spriteBottom);
            container.addChild(spriteTop);

            container._xjzlSprites = {
                bottom: spriteBottom,
                top: spriteTop
            };

            // 创建完毕后立即应用一次属性
            this._updateAttributes(token);

        } catch (err) {
            console.error("XJZL | 战斗标记图片加载失败:", err);
            container._xjzlPaths = null; // 允许重试
        }
    }

    /**
     * 实时更新属性 (大小、透明度、颜色)
     * 此方法开销低，可在每一帧调用
     */
    static _updateAttributes(token) {
        const container = token._xjzlTurnMarker;
        if (!container || container.destroyed || !container._xjzlSprites) return;

        const { bottom, top } = container._xjzlSprites;
        const { scale, alphaBottom, alphaTop } = this._cache;

        // 计算目标尺寸 (FVTT V13 中，Token的真实宽度是 token.w)
        const targetSize = token.w * scale;

        // 应用到底图
        if (bottom && !bottom.destroyed) {
            bottom.width = targetSize;
            bottom.height = targetSize;
            bottom.alpha = alphaBottom;
            bottom.tint = 0xFFFFFF; // 清除系统可能染上的颜色
        }

        // 应用到顶图
        if (top && !top.destroyed) {
            top.width = targetSize;
            top.height = targetSize;
            top.alpha = alphaTop;
            top.tint = 0xFFFFFF;
        }
    }
}