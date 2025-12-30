/* applications/modifier-picker.mjs */
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLModifierPicker extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        // 使用一个新的类名，不与 character sheet 混淆
        classes: ["xjzl-picker-window"],
        position: { width: 400, height: 600 },
        window: {
            title: "选择属性修正",
            icon: "fas fa-list-ul",
            resizable: true
        },
        form: {
            handler: XJZLModifierPicker.prototype._onSubmit,
            closeOnSubmit: true
        }
    };

    static PARTS = {
        form: {
            template: "systems/xjzl-system/templates/apps/modifier-picker.hbs",
            scrollable: [".picker-scroll"] // 对应 HBS 里的滚动容器
        }
    };

    constructor(options = {}) {
        super(options);
        this.choices = options.choices;
        this.selected = options.selected;
        this.callback = options.callback;
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);

        // 数据转换逻辑保持不变
        context.groups = Object.entries(this.choices).map(([groupLabel, items]) => {
            return {
                label: groupLabel,
                items: Object.entries(items).map(([key, label]) => ({
                    key,
                    label,
                    isSelected: key === this.selected
                }))
            };
        });

        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);

        // 搜索逻辑复用你参考代码里的思路
        const searchInput = this.element.querySelector("input[name='filter']");
        if (searchInput) {
            searchInput.addEventListener("input", (event) => {
                this._filterList(event.target.value.toLowerCase());
            });
            searchInput.focus();
        }

        // 绑定点击
        const buttons = this.element.querySelectorAll(".modifier-btn");
        buttons.forEach(btn => {
            btn.addEventListener("click", (ev) => {
                ev.preventDefault();
                // 停止冒泡，防止触发 details 的折叠
                ev.stopPropagation();

                // 按钮内部可能有子元素，向上查找最近的按钮
                const targetBtn = ev.currentTarget;
                const key = targetBtn.dataset.key;

                if (this.callback) this.callback(key);
                this.close();
            });
        });
    }

    _filterList(query) {
        const groups = this.element.querySelectorAll(".picker-group");
        groups.forEach(group => {
            const items = group.querySelectorAll(".modifier-btn");
            let hasVisibleItem = false;
            items.forEach(item => {
                const text = item.innerText.toLowerCase();
                const key = item.dataset.key.toLowerCase();
                const match = text.includes(query) || key.includes(query);
                item.style.display = match ? "flex" : "none"; // flex 布局
                if (match) hasVisibleItem = true;
            });

            // 处理分组显示/隐藏
            if (query === "") {
                group.style.display = "block";
            } else {
                group.style.display = hasVisibleItem ? "block" : "none";
                const details = group.querySelector("details");
                if (details && hasVisibleItem) details.open = true;
            }
        });
    }
}