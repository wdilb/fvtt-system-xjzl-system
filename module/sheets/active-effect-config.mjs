const { ActiveEffectConfig } = foundry.applications.sheets;
import { TRIGGER_CHOICES } from "../data/common.mjs";

/**
 * 逻辑层：负责数据准备与自定义按钮的保存逻辑
 * 继承 ActiveEffectConfig 以保留核心功能
 */
export class XJZLActiveEffectConfig extends ActiveEffectConfig {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["sheet", "active-effect-config", "xjzl-config"],
            width: 580,
            height: "auto",
            // 让核心管理 Tab 基础样式
            tabs: [{ navSelector: ".tabs", contentSelector: "form", initial: "details" }]
        });
    }

    /**
     * 准备数据供 Handlebars 模板使用
     * 覆盖父类方法以提供自定义数据结构
     */
    async getData(options = {}) {
        // 不调用 super.getData() 避免 V13 报错
        const effect = this.document;
        const flags = effect.flags["xjzl-system"] || {};

        let rawScripts = flags.scripts || [];
        // 容错处理：如果数据库里存的是对象，转为数组
        if (typeof rawScripts === 'object' && !Array.isArray(rawScripts)) {
            rawScripts = Object.values(rawScripts);
        }

        const scripts = rawScripts.map(s => ({ ...s, active: s.active !== false }));

        let maxStacks = flags.maxStacks;
        if (!Number.isFinite(maxStacks)) maxStacks = 0;

        return {
            xjzl: {
                slug: flags.slug || "",
                autoSlug: effect.name ? (typeof effect.name.slugify === 'function' ? effect.name.slugify() : effect.name) : "auto-slug",
                isStackable: !!flags.stackable,
                maxStacks: maxStacks,
                isTiedToStance: !!flags.tiedToStance, //是否随架招解除
                scripts: scripts,
                triggerChoices: TRIGGER_CHOICES
            }
        };
    }

    /**
     * 拦截系统默认的保存事件
     * 解决非关联 Token 的 flags 被 expandObject 深度覆写覆盖的 Bug
     */
    async _updateObject(event, formData) {
        // 1. 提取安全的扁平更新数据
        const flatUpdates = this._extractSafeFlatUpdates(formData);

        // 2. 让 Foundry 核心去处理基础字段 (name, icon, duration 等)
        await super._updateObject(event, formData);

        // 3. 使用扁平键 (Flat Keys) 独立精准更新我们的配置
        if (!foundry.utils.isEmpty(flatUpdates)) {
            await this.document.update(flatUpdates);
        }
    }

    /**
     * 自定义按钮保存逻辑 (点击添加/删除脚本时触发)
     * 这里必须手动抓取表单数据，否则会丢失用户在其他 Tab 修改但未保存的内容
     */
    async _onSaveXJZL(event) {
        event.preventDefault();
        const btn = event.currentTarget;
        const form = btn.closest("form");

        // 使用 V13 兼容的 FormDataExtended 获取当前页面所有输入值
        const FormDataClass = foundry.applications.ux?.FormDataExtended || FormDataExtended;
        const formData = new FormDataClass(form).object;

        const action = btn.dataset.action;

        // 1. 提取安全的扁平更新数据 (此时界面输入已同步到内存数组)
        const flatUpdates = this._extractSafeFlatUpdates(formData);

        // 2. 提取刚才处理好的脚本数组
        const currentScripts = flatUpdates["flags.xjzl-system.scripts"];

        // 3. 执行数组增删操作
        if (action === "add-script") {
            currentScripts.push({ label: "新特效", trigger: "passive", active: true, script: "" });
        } else if (action === "delete-script") {
            const index = parseInt(btn.dataset.index);
            currentScripts.splice(index, 1);
        }

        // 4. 提交扁平化更新
        await this.document.update(flatUpdates);
    }

    /**
     * 【辅助方法】将 formData 中的嵌套标志提取为 Flat Keys
     */
    _extractSafeFlatUpdates(formData) {
        const flatUpdates = {};

        // 深度拷贝当前的脚本数组
        let currentScripts = foundry.utils.deepClone(this.document.getFlag("xjzl-system", "scripts") || []);
        if (typeof currentScripts === 'object' && !Array.isArray(currentScripts)) {
            currentScripts = Object.values(currentScripts);
        }

        // 遍历提取我们自己的配置
        for (const key of Object.keys(formData)) {
            if (key.startsWith("flags.xjzl-system.")) {

                if (key.startsWith("flags.xjzl-system.scripts.")) {
                    // 同步界面上的数组元素输入到内存数组
                    const parts = key.split(".");
                    const index = parseInt(parts[3]);
                    const field = parts[4]; // 'label', 'trigger', 'script', 'active'
                    if (currentScripts[index]) {
                        currentScripts[index][field] = formData[key];
                    }
                } else {
                    // 其他基础开关属性 (如 tiedToStance, slug)，直接装入 flatUpdates
                    flatUpdates[key] = formData[key];
                }

                // 【绝杀】从 formData 中彻底剥离它，阻止 Foundry 核心对其执行灾难性的 expandObject
                delete formData[key];
            }
        }

        // 将组装好的数组也挂载上去
        flatUpdates["flags.xjzl-system.scripts"] = currentScripts;
        return flatUpdates;
    }
}

/**
 * 视图层：使用 Hook 强行注入 HTML
 * 这保证了无论核心如何重绘，我们的界面一定会出现
 */
Hooks.on("renderXJZLActiveEffectConfig", async (app, html, data) => {
    // 兼容性处理：将 html 转为 jQuery 对象
    const $html = $(html);

    // 查找关键容器
    const nav = $html.find("nav.sheet-tabs");
    const form = $html.is("form") ? $html : $html.find("form");

    if (!nav.length || !form.length) return;

    // 1. 注入导航按钮 (总是移除旧的添加新的，保证状态最新)
    nav.find('[data-tab="xjzl-config"]').remove();

    const tabBtn = $(`
        <a class="item" data-action="tab" data-group="sheet" data-tab="xjzl-config">
            <i class="fas fa-dragon"></i> <span>侠界配置</span>
        </a>
    `);
    nav.append(tabBtn);

    // 2. 渲染并注入内容
    form.find('section[data-tab="xjzl-config"]').remove();

    const context = await app.getData();
    // 使用 V13 推荐的渲染方法
    const renderFunc = foundry.applications.handlebars?.renderTemplate || renderTemplate;
    const templateHtml = await renderFunc("systems/xjzl-system/templates/apps/active-effect-xjzlconfig.hbs", context);

    // 插入位置逻辑：尝试插在最后一个 tab 后面
    const lastTab = form.find('section.tab').last();
    if (lastTab.length) lastTab.after(templateHtml);
    else form.append(templateHtml);

    // =====================================================
    // 3. 智能激活状态修正 (修复跳页与白屏的问题)
    // =====================================================
    const internalActive = app._tabs?.[0]?.active; // Foundry 内部记录
    const coreTabs = ["details", "duration", "changes", "effects"]; // 核心 Tab 列表

    if (coreTabs.includes(internalActive)) {
        // A. 如果 Foundry 明确在核心 Tab，什么都不做，防止跳页
    }
    else if (internalActive === "xjzl-config") {
        // B. 如果 Foundry 明确在我们的 Tab，强制激活
        _forceActivate(nav, form);
    }
    else {
        // C. 如果 Foundry 状态迷失 (undefined)，检查 DOM 上有没有亮着的 Tab
        const anyActive = nav.find('.active').length > 0;
        if (!anyActive) {
            // 如果一片漆黑 (白屏)，说明就是我们的 Tab 该显示了
            _forceActivate(nav, form);
        }
    }

    // 4. 重新计算高度
    app.setPosition({ height: "auto" });

    // 5. 绑定交互事件
    const newContent = form.find('section[data-tab="xjzl-config"]');
    // 使用 .off().on() 防止重复绑定，并绑定到 app 实例
    newContent.find('button[data-action="add-script"]').off("click").on("click", app._onSaveXJZL.bind(app));
    newContent.find('a[data-action="delete-script"]').off("click").on("click", app._onSaveXJZL.bind(app));

    // 6. 注入输入框自动补全 (Datalist)
    _injectDatalist(app, $html, form);
});

/**
 * 辅助：强制激活自定义 Tab
 */
function _forceActivate(nav, form) {
    nav.find('.item').removeClass("active");
    nav.find('a[data-action="tab"]').removeClass("active");
    form.find('section.tab').removeClass("active");

    nav.find('[data-tab="xjzl-config"]').addClass("active");
    form.find('section[data-tab="xjzl-config"]').addClass("active");
}

/**
 * 辅助：注入 Datalist
 */
function _injectDatalist(app, html, form) {
    const listId = `xjzl-status-list-${app.document.id}`;
    if (!html.find(`#${listId}`).length) {
        let optionsHtml = "";
        const statusFlags = CONFIG.XJZL?.statusFlags || {};
        for (const [key, label] of Object.entries(statusFlags)) {
            optionsHtml += `<option value="flags.xjzl-system.${key}">${game.i18n.localize(label)}</option>`;
        }
        const commonStats = [
            { val: "system.resources.hp.value", label: "气血 (HP)" },
            { val: "system.resources.mp.value", label: "内力 (MP)" },
            { val: "system.combat.speed", label: "速度" }
        ];
        optionsHtml += commonStats.map(o => `<option value="${o.val}">${o.label}</option>`).join("");
        form.append(`<datalist id="${listId}">${optionsHtml}</datalist>`);
    }

    html.on("focusin", 'input[name$="key"]', (ev) => {
        const target = ev.currentTarget;
        if (!target.hasAttribute("list")) {
            target.setAttribute("list", listId);
            target.setAttribute("placeholder", "flags...");
        }
    });
}