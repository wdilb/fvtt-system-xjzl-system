import { xjzlSocket } from "../socket.mjs";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ToneTracker extends HandlebarsApplicationMixin(ApplicationV2) {
    static instance = null;
    static debouncedRefresh = null;

    // --- 内存状态与锁 ---
    isExpanded = false;      // 是否为展开的卷轴状态
    _justDragged = false;    // 拖拽防误触标志：防止拖拽结束后触发点击事件
    _isActionLocked = false; // 动作节流锁：防止玩家狂点导致 Socket 并发写入和动画错乱
    _pendingPush = false;    // 动画标记：通知下一次渲染播放“推入”动画

    // --- 五音基础配置 ---
    static TONE_MAP = {
        gong: { key: "gong", label: "宫", color: "#e8c971", shadow: "rgba(232, 201, 113, 0.6)" },
        shang: { key: "shang", label: "商", color: "#e0e0e0", shadow: "rgba(224, 224, 224, 0.6)" },
        jue: { key: "jue", label: "角", color: "#74b592", shadow: "rgba(116, 181, 146, 0.6)" },
        zhi: { key: "zhi", label: "徵", color: "#db5a5a", shadow: "rgba(219, 90, 90, 0.6)" },
        yu: { key: "yu", label: "羽", color: "#5c799e", shadow: "rgba(92, 121, 158, 0.6)" }
    };

    // 音阶轮换顺序
    static TONE_CYCLE = [null, "gong", "shang", "jue", "zhi", "yu"];

    // --- AppV2 基础配置 ---
    static DEFAULT_OPTIONS = {
        id: "xjzl-tone-tracker",
        classes: ["xjzl-tone-tracker-window"],
        tag: "div",
        window: {
            title: "五声音阶",
            minimizable: false, // 禁用系统默认最小化，使用自建逻辑
            resizable: false,
            frame: false        // 关闭系统默认边框，使用无边框
        },
        position: {
            width: "auto",
            height: "auto"
        }
    };

    static PARTS = {
        main: {
            template: "systems/xjzl-system/templates/apps/tone-tracker.hbs"
        }
    };

    /**
     * 全局初始化入口
     */
    static init() {
        this.instance = new ToneTracker();

        // 挂载到全局方便测试和外部调用
        globalThis.xjzlToneTracker = this.instance;

        // 设置默认初始位置：左上角避开工具栏
        this.instance.position.left = 110;
        this.instance.position.top = 110;

        // 使用防抖(debounce)包装渲染函数，50ms内多次数据更新只会触发1次重绘，极大提升性能
        this.debouncedRefresh = foundry.utils.debounce(() => {
            if (canvas?.scene) {
                this.instance.render({ force: true }).catch(e => console.error("五声音阶渲染报错:", e));
            } else if (!canvas?.scene) {
                // 如果切换到一个不存在的场景，或者离开场景，自动关闭界面
                this.instance.close();
            }
        }, 50);

        // 监听画布和场景更新
        Hooks.on("canvasReady", () => this.debouncedRefresh());
        Hooks.on("updateScene", (scene, changes) => {
            // 只有当当前所在的场景，且 flags 中的 tones 发生变化时，才触发重绘
            if (scene.id === canvas.scene?.id && foundry.utils.hasProperty(changes, "flags.xjzl-system.tones")) {
                this.debouncedRefresh();
            }
        });

        // 如果代码执行时画布已经就绪，立刻渲染一次
        if (canvas?.ready) this.debouncedRefresh();
    }

    /**
     * 数据持久化：更新全场共享的五音队列
     * @param {Array} newTones - 长度为5的音阶数组
     */
    async _updateGlobalTones(newTones) {
        const scene = canvas.scene;
        if (!scene) return;

        // 权限分流：GM直接改，玩家走Socket委托GM改
        if (game.user.isGM) {
            await scene.setFlag("xjzl-system", "tones", newTones);
        } else {
            await xjzlSocket.executeAsGM("updateDocument", scene.uuid, { "flags.xjzl-system.tones": newTones });
        }
    }

    /**
     * 准备传递给 Handlebars 模板的数据
     */
    async _prepareContext(options) {
        if (!canvas?.scene) return {};

        // 安全获取 Flag，若无则初始化为 5 个 null
        let currentTones = canvas.scene.getFlag("xjzl-system", "tones");
        if (!Array.isArray(currentTones) || currentTones.length !== 5) {
            currentTones = [null, null, null, null, null];
        }

        // 提取并立刻重置动画状态，确保只有刚刚操作的那一次渲染带动画
        const isPushing = this._pendingPush;
        this._pendingPush = false;

        // 构造插槽数据
        const slots = currentTones.map((toneKey, index) => {
            let baseData = { index, isEmpty: true };
            if (toneKey && ToneTracker.TONE_MAP[toneKey]) {
                baseData = { index, isEmpty: false, ...ToneTracker.TONE_MAP[toneKey] };
            }

            // 动画核心逻辑：
            // 如果刚刚点击了推入，我们让新生成的前4个DOM拥有 slide-left 类(平滑左移)
            // 让第5个DOM拥有 pop-in 类(玉石闪现)，结合CSS实现完美的队列更替视觉错觉
            if (isPushing) {
                if (index === 4) baseData.isNew = true;
                else baseData.isSliding = true;
            }
            return baseData;
        });

        const hasTones = currentTones.some(t => t !== null);

        return {
            isExpanded: this.isExpanded,
            slots: slots,
            buttons: Object.values(ToneTracker.TONE_MAP),
            hasTones: hasTones
        };
    }

    /**
     * DOM 挂载后的事件绑定
     */
    _attachPartListeners(partId, htmlElement, options) {
        super._attachPartListeners(partId, htmlElement, options);

        // 1. 初始化拖拽逻辑
        this._setupDraggable(htmlElement);

        // 2. 展开/折叠面板
        const toggleBtn = htmlElement.querySelector(".toggle-btn");
        if (toggleBtn) {
            toggleBtn.addEventListener("click", (e) => {
                e.preventDefault();
                // 如果刚刚发生了拖拽，不触发折叠/展开
                if (this._justDragged) return;
                this.isExpanded = !this.isExpanded;
                this.render({ force: true });
            });
        }

        // 3. 插槽交互：左键轮换，右键清空
        const slots = htmlElement.querySelectorAll(".tone-slot");
        slots.forEach(slot => {
            slot.addEventListener("click", async (e) => {
                if (this._isActionLocked) return;
                e.preventDefault();
                const index = parseInt(e.currentTarget.dataset.index);
                await this._cycleSlot(index, 1);
            });

            slot.addEventListener("contextmenu", async (e) => {
                if (this._isActionLocked) return;
                e.preventDefault();
                const index = parseInt(e.currentTarget.dataset.index);
                await this._cycleSlot(index, 0, true);
            });
        });

        // 4. 底部推入按钮
        const addBtns = htmlElement.querySelectorAll(".add-tone-btn");
        addBtns.forEach(btn => {
            btn.addEventListener("click", async (e) => {
                if (this._isActionLocked) return;
                e.preventDefault();

                // 开启 300ms 的动作锁，防止疯狂连击
                this._isActionLocked = true;
                setTimeout(() => this._isActionLocked = false, 300);

                const newToneKey = e.currentTarget.dataset.tone;
                let currentTones = canvas.scene.getFlag("xjzl-system", "tones") || [null, null, null, null, null];

                // 挤出队列最前方，追加到末尾
                currentTones.shift();
                currentTones.push(newToneKey);

                // 标记此次更新需要附带推入动画
                this._pendingPush = true;
                await this._updateGlobalTones(currentTones);
            });
        });

        // 5. 一键清音
        const clearBtn = htmlElement.querySelector(".clear-tones-btn");
        if (clearBtn) {
            clearBtn.addEventListener("click", async (e) => {
                if (this._isActionLocked) return;
                e.preventDefault();
                await this._updateGlobalTones([null, null, null, null, null]);
            });
        }
    }

    /**
     * 自定义无边框拖拽引擎
     */
    _setupDraggable(htmlElement) {
        // 只有标题栏和小玉佩图标可以作为拖拽抓手
        const handles = htmlElement.querySelectorAll(".panel-header, .mini-jade");
        if (!handles.length) return;

        const appWindow = this.element;

        let isDragging = false;
        let startX, startY, initialLeft, initialTop;
        let hasMoved = false;

        // 定义鼠标移动和抬起的回调，保证即使重渲染也能被正确处理
        const onMouseMove = (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            // 位移阈值判定，过滤原地点击时的微小像素抖动
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                hasMoved = true;
            }

            appWindow.style.left = `${initialLeft + dx}px`;
            appWindow.style.top = `${initialTop + dy}px`;
        };

        const onMouseUp = () => {
            if (!isDragging) return;
            isDragging = false;

            // 移除硬件加速提示，归还 GPU 资源
            appWindow.style.willChange = 'auto';
            handles.forEach(h => h.style.cursor = "grab");

            // 将拖拽后的新坐标回写到 App 实例的内存中，防止重渲染时归位
            this.position.left = parseInt(appWindow.style.left) || 0;
            this.position.top = parseInt(appWindow.style.top) || 0;

            // 拦截器：如果发生过位移，说明是拖拽行为，锁定 50ms 阻止 click 事件触发
            if (hasMoved) {
                this._justDragged = true;
                setTimeout(() => this._justDragged = false, 50);
            }

            // 清理 Document 级别的监听器防止内存泄漏
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        handles.forEach(handle => {
            handle.addEventListener("mousedown", (e) => {
                // 如果点在“收起”小图标上，不触发拖拽
                if (e.target.closest('.toggle-btn') && !handle.classList.contains('mini-jade')) return;

                isDragging = true;
                hasMoved = false;
                startX = e.clientX;
                startY = e.clientY;

                const rect = appWindow.getBoundingClientRect();
                initialLeft = rect.left;
                initialTop = rect.top;

                // 剥离其他定位属性，转为纯固定绝对定位
                appWindow.style.right = 'auto';
                appWindow.style.bottom = 'auto';
                appWindow.style.left = `${initialLeft}px`;
                appWindow.style.top = `${initialTop}px`;
                appWindow.style.position = 'fixed';
                appWindow.style.margin = '0';

                // 开启硬件加速提示，让拖拽极致流畅
                appWindow.style.willChange = 'left, top';
                handle.style.cursor = "grabbing";

                document.addEventListener("mousemove", onMouseMove);
                document.addEventListener("mouseup", onMouseUp);
            });
        });
    }

    /**
     * 辅助：处理单一插槽的音阶轮换逻辑
     * @param {number} index - 插槽索引
     * @param {number} step  - 前进/后退步数
     * @param {boolean} forceClear - 是否强制清空
     */
    async _cycleSlot(index, step = 1, forceClear = false) {
        let currentTones = canvas.scene.getFlag("xjzl-system", "tones") || [null, null, null, null, null];
        const cycle = ToneTracker.TONE_CYCLE;

        if (forceClear) {
            currentTones[index] = null;
        } else {
            const currentTone = currentTones[index];
            const currentIndex = cycle.indexOf(currentTone);
            // 计算循环偏移索引
            const nextIndex = (currentIndex + step) % cycle.length;
            currentTones[index] = cycle[nextIndex];
        }
        await this._updateGlobalTones(currentTones);
    }
}