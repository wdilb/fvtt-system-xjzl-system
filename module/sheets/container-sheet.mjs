/**
 * 侠界之旅 - 容器/战利品表单
 */

const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

// 引入 Socket 实例 (确保路径正确)
import { xjzlSocket } from "../socket.mjs";

export class XJZLContainerSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

    /** @override 基础配置 */
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "actor", "container", "theme-dark"],
        position: { width: 560, height: 650 },
        window: {
            resizable: true,
            title: "XJZL.Sheet.Container",
            controls: []
        },
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        },
        // 拖拽配置：只定义来源选择器，放置由 _onDrop 处理
        dragDrop: [{
            dragSelector: ".item-grid-card[draggable='true']",
            dropSelector: ".inventory-grid-container"
        }],
        actions: {
            editItem: XJZLContainerSheet.prototype._onEditItem,
            deleteItem: XJZLContainerSheet.prototype._onDeleteItem,
            editImage: XJZLContainerSheet.prototype._onEditImage,
            lootAll: XJZLContainerSheet.prototype._onLootAll,
            // 合并金钱操作：拿取与存入
            currencyAction: XJZLContainerSheet.prototype._onCurrencyAction
        }
    };

    /** @override 模板定义 */
    static PARTS = {
        main: {
            template: "systems/xjzl-system/templates/actor/container/sheet.hbs",
            scrollable: [".inventory-grid-container"]
        }
    };

    /** @override 数据准备 */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const actor = this.document;
        const system = actor.system;

        context.isOwner = actor.isOwner;
        // 权限判断：即使不是 Owner，如果是 Observer 且未上锁，或者 GM，就可以互动
        context.canLoot = (actor.testUserPermission(game.user, "OBSERVER") && !system.locked) || game.user.isGM;
        // 如果是 Owner，且未上锁（或者就是 GM），则可以存钱
        context.canDeposit = context.isOwner && !system.locked;

        context.currency = system.currency || 0;
        context.actorName = actor.name;
        context.actorImg = actor.img;
        context.system = system;

        // --- 物品分类初始化 ---
        const sections = {
            weapon: { label: "TYPES.Item.weapon", items: [] },
            armor: { label: "TYPES.Item.armor", items: [] },
            qizhen: { label: "TYPES.Item.qizhen", items: [] },
            consumable: { label: "TYPES.Item.consumable", items: [] },
            manual: { label: "TYPES.Item.manual", items: [] },
            art_book: { label: "TYPES.Item.art_book", items: [] },
            wuxue: { label: "TYPES.Item.wuxue", items: [] },
            neigong: { label: "TYPES.Item.neigong", items: [] },
            misc: { label: "TYPES.Item.misc", items: [] }
        };

        // 获取并排序物品
        const items = Array.from(actor.items).sort((a, b) => (a.sort || 0) - (b.sort || 0));

        for (const item of items) {
            const sys = item.system;
            const quality = sys.quality ?? 0;
            const tier = sys.tier ?? 0;
            const type = item.type;

            // 简单的颜色分类逻辑
            const isSkill = ["wuxue", "neigong"].includes(type);
            let colorClass = isSkill ? `tier-${tier}` : `quality-${quality}`;

            // =========================================================
            // 处理数据，防止注入导致 DOM 结构断裂
            // =========================================================

            // 1. 提取原始文本，加上 String() 确保万一数据损坏时不会报错
            const rawName = String(item.name || "未知");
            const rawDesc = String(sys.description || "暂无描述");

            // 2. 核心防御：将双引号替换为 &quot;
            // 这样当它被放入 data-tooltip="..." 时，浏览器就不会认为属性结束了
            const safeName = rawName.replace(/"/g, '&quot;');
            const safeDesc = rawDesc.replace(/"/g, '&quot;');

            const itemData = {
                ...item.toObject(),
                id: item.id,
                img: item.img,
                colorClass: colorClass,
                quantity: sys.quantity || 1,
                isStackable: (sys.quantity || 1) > 1,

                // 3. 使用安全变量 (safeName/safeDesc) 构建 Tooltip
                // 外层用反引号，里面原本的 class 必须严格使用单引号 ('xjzl-tooltip')
                tooltip: `<div class='xjzl-tooltip'><div class='header'>${safeName}</div><div class='body'>${safeDesc}</div></div>`
            };

            if (sections[type]) sections[type].items.push(itemData);
            else sections.misc.items.push(itemData);
        }

        // 过滤掉空分类
        context.inventory = Object.values(sections).filter(s => s.items.length > 0);
        context.hasItems = items.length > 0;

        return context;
    }

    /* -------------------------------------------- */
    /*  核心交互逻辑 (Drag & Drop)                  */
    /* -------------------------------------------- */

    /** @override 渲染后绑定 */
    _onRender(context, options) {
        super._onRender(context, options);

        // 手动绑定拖拽开始事件
        const draggables = this.element.querySelectorAll(".item-grid-card[draggable='true']");
        draggables.forEach(el => {
            el.addEventListener("dragstart", (event) => this._onDragStart(event));
        });

        // 绑定搜索
        const searchInput = this.element.querySelector(".container-search-input");
        if (searchInput) {
            searchInput.addEventListener("input", (event) => this._onSearch(event));
        }

        // -----------------------------------------------------------
        // 强制接管 Drop 事件 (解决无权限时不触发 _onDrop 的问题)
        // -----------------------------------------------------------
        const dropZone = this.element.querySelector(".inventory-grid-container");
        if (dropZone) {
            // A. 必须允许 dragover，否则 drop 事件根本不会触发
            dropZone.addEventListener("dragover", (event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
            });

            // B. 强制绑定 drop，绕过 Foundry 的 isEditable 检查
            dropZone.addEventListener("drop", (event) => this._onDrop(event));
        }
    }

    /**
     * 前端即时搜索
     */
    _onSearch(event) {
        event.preventDefault();
        const query = event.target.value.toLowerCase().trim();
        const html = this.element;

        // 1. 筛选所有物品卡片
        const items = html.querySelectorAll(".item-grid-card");
        items.forEach(card => {
            const nameEl = card.querySelector(".name");
            // 获取文本内容并转小写
            const name = nameEl ? nameEl.innerText.toLowerCase() : "";

            // 包含搜索词则显示，否则隐藏
            if (name.includes(query)) {
                card.style.display = "flex";
            } else {
                card.style.display = "none";
            }
        });

        // 2. 自动隐藏空分类
        // 如果一个分类下所有物品都被搜索隐藏了，把分类标题也隐藏
        const sections = html.querySelectorAll(".grid-section");
        sections.forEach(section => {
            // 查找该分类下当前可见的物品
            const visibleItems = section.querySelectorAll(".item-grid-card:not([style*='display: none'])");

            if (visibleItems.length > 0) {
                section.style.display = "block";
            } else {
                section.style.display = "none";
            }
        });
    }

    /**
     * [拖拽开始] 从容器往外拖
     */
    _onDragStart(event) {
        event.stopPropagation();

        const card = event.currentTarget;
        const itemId = card.dataset.itemId;
        if (!itemId) return;

        const item = this.document.items.get(itemId);
        if (!item) return;

        // 再次检查权限 (防止HTML被篡改)
        const canLoot = (this.document.testUserPermission(game.user, "OBSERVER") && !this.document.system.locked) || game.user.isGM;
        if (!canLoot) {
            ui.notifications.warn("箱子已上锁或无权限，无法拿取。");
            event.preventDefault();
            return;
        }

        // 构建数据
        const dragData = {
            type: "Item",
            uuid: item.uuid,
            data: item.toObject(),
            xjzlSource: "container", // 标记来源
            containerUuid: this.document.uuid
        };

        event.dataTransfer.setData("text/plain", JSON.stringify(dragData));

        const img = card.querySelector("img");
        if (img) event.dataTransfer.setDragImage(img, 20, 20);
    }

    /**
     * [拖拽放下] 处理物品存入
     * 只有 Owner 且未上锁才能放入
     */
    async _onDrop(event) {
        // 阻止默认行为
        event.preventDefault();
        event.stopPropagation();
        // 1. 检查所有权 (只有 Owner 能放)
        if (!this.document.isOwner) {
            ui.notifications.warn("你只能从这里拿取，不能往里存放物品。");
            return false;
        }

        // 2. 检查锁状态
        if (this.document.system.locked) {
            ui.notifications.warn("容器已上锁，无法放入物品。");
            return false;
        }

        // 2. 解析数据
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (err) { return false; }

        if (data.type !== "Item") return false;

        // 3. 解析 ItemData
        let itemData;
        try {
            itemData = await Item.implementation.fromDropData(data);
        } catch (e) { itemData = data.data; }

        if (!itemData) return false;

        // 4. 获取源对象 (用于判断来源类型)
        let sourceItem = null;
        if (data.uuid) {
            try { sourceItem = await fromUuid(data.uuid); } catch (e) { }
        }

        // ==========================================================
        // 核心逻辑：来源判定
        // ==========================================================

        // 情况 A: 来源不是 Actor (如物品栏、合集包)，直接允许创建
        if (!sourceItem || !(sourceItem.parent instanceof Actor)) {
            return this.document.createEmbeddedDocuments("Item", [itemData]);
        }

        const sourceActor = sourceItem.parent;

        // 情况 B: 禁止自我拖拽
        if (sourceActor === this.document) return false;

        // 情况 C: 来源是 "Character" 或 "NPC" -> 执行严格限制
        if (sourceActor.type === "character" || sourceActor.type === "npc") {

            // 1. 检查是否装备
            if (sourceItem.system.equipped) {
                ui.notifications.warn(`无法存放已装备的物品：${sourceItem.name}`);
                return false;
            }

            // 2. 检查禁止放入的类型 (修炼相关)
            const bannedTypes = {
                neigong: "内功",
                wuxue: "武学",
                art_book: "技艺书籍",
                background: "身世背景",
                personality: "性格特质"
            };

            if (bannedTypes[sourceItem.type]) {
                ui.notifications.warn(`无法存放【${bannedTypes[sourceItem.type]}】，角色修炼数据禁止放入公共容器。`);
                return false;
            }
        }

        // 情况 D: 来源是 "Container" -> 允许所有类型 (包括内功武学)
        // (代码执行到这里，只要不是 bannedTypes 拦截的，或者来源是 container，都允许通过)

        // ==========================================================
        // 执行存入 (移动逻辑)
        // ==========================================================

        // a. 在容器中创建
        const createdItems = await this.document.createEmbeddedDocuments("Item", [itemData]);

        // b. 删除源物品 (移动操作)
        if (createdItems && createdItems.length > 0) {
            try {
                // 使用 GM 权限删除源，确保权限无碍
                await xjzlSocket.executeAsGM("deleteEmbedded", sourceActor.uuid, "Item", [sourceItem.id]);
                // 可选: ui.notifications.info(`已存入: ${sourceItem.name}`);
            } catch (err) {
                console.error("XJZL | 存入物品删除源失败:", err);
            }
        }

        return true;
    }

    /* -------------------------------------------- */
    /*  动作处理 (Actions)                          */
    /* -------------------------------------------- */

    async _onEditImage(event, target) {
        const current = this.document.img;
        const fp = new FilePicker({
            type: "image",
            current: current,
            callback: path => this.document.update({ img: path })
        });
        return fp.browse();
    }

    async _onEditItem(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        item?.sheet.render(true);
    }

    async _onDeleteItem(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;
        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: "销毁物品" },
            content: `<p>确定要销毁 <b>${item.name}</b> 吗？</p>`,
            rejectClose: false
        });
        if (confirm) await item.delete();
    }

    /**
     * 全部拿取 (Loot All)
     */
    async _onLootAll(event) {
        if (this._looting) return;
        this._looting = true;

        // 阻止默认行为（虽然 button type="button" 通常不需要，但保险起见）
        event.preventDefault();
        event.stopPropagation();

        try {
            // 1. 获取 Loot 目标
            const looter = canvas.tokens.controlled[0]?.actor;

            // 2. 这里的提示现在应该能正常弹出了
            if (!looter) {
                ui.notifications.warn("请先控制 Token。");
                return;
            }

            const items = this.document.items.map(i => i.toObject());
            const currency = this.document.system.currency;

            // 3. 空箱子提示
            if (items.length === 0 && currency <= 0) {
                ui.notifications.info("箱子里什么都没有。");
                return;
            }

            // 4. 执行转移
            if (items.length > 0) {
                await xjzlSocket.executeAsGM("createEmbedded", looter.uuid, "Item", items);
                const ids = this.document.items.map(i => i.id);
                await xjzlSocket.executeAsGM("deleteEmbedded", this.document.uuid, "Item", ids);
            }

            if (currency > 0) {
                const newLooterSilver = (looter.system.resources?.silver || 0) + currency;
                await xjzlSocket.executeAsGM("updateDocument", looter.uuid, { "system.resources.silver": newLooterSilver });
                await xjzlSocket.executeAsGM("updateDocument", this.document.uuid, { "system.currency": 0 });
            }

            // 5. 成功提示
            ui.notifications.info(`已全部拾取到: ${looter.name}`);

        } catch (err) {
            console.error(err);
        } finally {
            this._looting = false;
        }
    }

    /**
     * 金钱操作：拿取 / 存入
     * data-type: "loot" | "deposit"
     */
    async _onCurrencyAction(event, target) {
        const type = target.dataset.type; // loot 或 deposit
        const actor = this.document;
        const looter = canvas.tokens.controlled[0]?.actor;

        if (!looter) {
            ui.notifications.warn("请先控制角色以进行金钱交互。");
            return;
        }

        if (type === "loot") {
            // --- 拿取逻辑 ---
            const amount = actor.system.currency;
            if (amount <= 0) return;

            // 简单弹窗确认金额 (默认全部)
            const takeAmount = await foundry.applications.api.DialogV2.prompt({
                window: { title: "拿取银两" },
                content: `<label>金额 (最大 ${amount}):</label><input type="number" name="amount" value="${amount}" min="1" max="${amount}" autofocus>`,
                ok: { label: "拿取", callback: (event, button) => button.form.elements.amount.valueAsNumber }
            });

            if (!takeAmount || takeAmount <= 0) return;

            // 执行交易
            const newLooterSilver = (looter.system.resources?.silver || 0) + takeAmount;
            const newContainerSilver = amount - takeAmount;

            await xjzlSocket.executeAsGM("updateDocument", looter.uuid, { "system.resources.silver": newLooterSilver });
            await xjzlSocket.executeAsGM("updateDocument", actor.uuid, { "system.currency": newContainerSilver });

            ui.notifications.info(`已拿取 ${takeAmount} 银两`);

        } else if (type === "deposit") {
            // --- 存入逻辑 ---
            const userSilver = looter.system.resources?.silver || 0;
            if (userSilver <= 0) {
                ui.notifications.warn("你身上没有银两。");
                return;
            }

            const storeAmount = await foundry.applications.api.DialogV2.prompt({
                window: { title: "存入银两" },
                content: `<label>金额 (持有 ${userSilver}):</label><input type="number" name="amount" value="${userSilver}" min="1" max="${userSilver}" autofocus>`,
                ok: { label: "存入", callback: (event, button) => button.form.elements.amount.valueAsNumber }
            });

            if (!storeAmount || storeAmount <= 0) return;

            // 执行交易
            const newLooterSilver = userSilver - storeAmount;
            const newContainerSilver = (actor.system.currency || 0) + storeAmount;

            await xjzlSocket.executeAsGM("updateDocument", looter.uuid, { "system.resources.silver": newLooterSilver });
            await xjzlSocket.executeAsGM("updateDocument", actor.uuid, { "system.currency": newContainerSilver });

            ui.notifications.info(`已存入 ${storeAmount} 银两`);
        }
    }
}