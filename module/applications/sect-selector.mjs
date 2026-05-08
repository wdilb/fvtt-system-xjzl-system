const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLSectSelectorApp extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(options) {
        super(options);
        this.currentSect = options.currentSect || "none";
        this.onSelect = options.onSelect; // 回调函数
    }

    static DEFAULT_OPTIONS = {
        id: "xjzl-sect-selector",
        classes: ["xjzl-window", "theme-dark", "sect-selector-app"],
        tag: "div",
        position: { width: 1000, height: 650 },
        window: {
            title: "选择门派",
            icon: "fas fa-yin-yang",
            resizable: false
        },
        actions: {
            selectSect: XJZLSectSelectorApp.prototype._onSelectSect,
            confirmSect: XJZLSectSelectorApp.prototype._onConfirmSect
        }
    };

    static PARTS = {
        main: {
            template: "systems/xjzl-system/templates/apps/character-wizard/sect-selector.hbs",
            scrollable: [".sect-grid-container"]
        }
    };

    /* -------------------------------------------- */
    /*  生命周期钩子：绑定鼠标滚轮横向滚动           */
    /* -------------------------------------------- */
    _onRender(context, options) {
        super._onRender(context, options);

        // 获取滚动容器
        const scrollContainer = this.element.querySelector("#mmo-sect-scroll");
        if (scrollContainer) {
            // 监听鼠标滚轮事件
            scrollContainer.addEventListener("wheel", (evt) => {
                // 如果鼠标正在上下滚动，将其转化为容器的横向滚动
                if (evt.deltaY !== 0) {
                    evt.preventDefault();
                    // 每次滚动的值适当放大/缩小，这里 1.5 是灵敏度
                    scrollContainer.scrollLeft += evt.deltaY * 1.5;
                }
            }, { passive: false });
        }
    }

    async _prepareContext(options) {
        const sectData = [];
        const sectConfig = CONFIG.XJZL.sects;
        const descConfig = CONFIG.XJZL.sectDescription;

        // 自定义未展开时的图片坐标字典
        // 在这里自由调整那些显示偏了的门派
        // 格式可以是 "left center", "right 20%", "60% 40%" 等
        // 没写在里面的门派，HBS 将不会生成数据，CSS 会使用默认值
        const customPositions = {
            "none": "40% top",
            "zhengqizong": "center 45px",
            "xiaoyaopai": "61% 30px",   
            "qingtianmen": "58% 30px",  
            "emeipai": "center -5px",   
            "huashanpai": "68% top", 
            "tangmen": "30% -40px", 
            "mingjiao": "center 10px",
            "gaibang": "center -15px",
            "fenghuayuan": "45% top",
            "liushanmen": "center 10px",
            "sihaibiaomeng":"center -60px",
            "wanshoushanzhuang":"center -30px",
            "jianghushili":"center 10px"
        };

        for (const [key, labelKey] of Object.entries(sectConfig)) {
            sectData.push({
                key: key,
                label: game.i18n.localize(labelKey),
                desc: game.i18n.localize(descConfig[key] || "XJZL.Sect.Desc.None"),
                // 如果找不到对应的图片，使用默认黑影占位图
                img: `systems/xjzl-system/assets/picture/sects/${key}.png`,
                isActive: this.currentSect === key,
                // 将字典里的坐标赋给数据
                bgPos: customPositions[key] || null 
            });
        }

        return {
            sects: sectData,
            activeSect: sectData.find(s => s.isActive) || sectData[0]
        };
    }

    /**
     * 点击卡片，展开门派画卷
     */
    async _onSelectSect(event, target) {
        const sectKey = target.closest(".mmo-sect-panel").dataset.key;

        // 如果点击的是已经展开的门派，无需重绘
        if (this.currentSect === sectKey) return;

        this.currentSect = sectKey;
        this.render(); // 重新渲染，触发 CSS 的 width 动画

        // 进阶交互：展开后，自动将该画卷滚动到视野舒适区 (可选)
        setTimeout(() => {
            if (this.element) {
                const activePanel = this.element.querySelector(".mmo-sect-panel.expanded");
                if (activePanel) {
                    activePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }
            }
        }, 100);
    }

    /**
     * 点击确认按钮，执行回调并关闭
     */
    async _onConfirmSect(event, target) {
        event.stopPropagation(); // 关键！阻止事件冒泡到外层的 _onSelectSect

        if (this.onSelect && typeof this.onSelect === "function") {
            this.onSelect(this.currentSect);
        }
        this.close();
    }
}