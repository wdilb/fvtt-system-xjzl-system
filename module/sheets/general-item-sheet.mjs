/* module/sheets/general-item-sheet.mjs */
import { XJZL } from "../config.mjs";
import { localizeConfig } from "../utils/utils.mjs";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLGeneralItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        classes: ["xjzl-window", "item", "general"],
        position: { width: 800, height: 600 },
        window: { resizable: true },
        // 告诉 V13：“请帮我监听 Input 变化，并且在重绘时保持滚动位置”
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        },
        actions: {
            // 特效操作 (仅消耗品需要)
            createEffect: XJZLGeneralItemSheet.prototype._onCreateEffect,
            editEffect: XJZLGeneralItemSheet.prototype._onEditEffect,
            deleteEffect: XJZLGeneralItemSheet.prototype._onDeleteEffect,
            toggleEffect: XJZLGeneralItemSheet.prototype._onToggleEffect,
            // 移除秘籍关联
            removeManualTarget: XJZLGeneralItemSheet.prototype._onRemoveManualTarget,
            // 修改图片
            editImage: XJZLGeneralItemSheet.prototype._onEditImage
        }
    };

    static PARTS = {
        header: { template: "systems/xjzl-system/templates/item/general/header.hbs", scrollable: [".xjzl-sidebar__content"] },
        tabs: { template: "systems/xjzl-system/templates/item/general/tabs.hbs" },
        details: { template: "systems/xjzl-system/templates/item/general/tab-details.hbs", scrollable: [""] },
        effects: { template: "systems/xjzl-system/templates/item/general/tab-effects.hbs", scrollable: [""] }
    };

    tabGroups = { primary: "details" };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.system = this.document.system;
        context.tabs = this.tabGroups;

        context.isConsumable = this.document.type === "consumable";
        context.isManual = this.document.type === "manual";
        context.isMisc = this.document.type === "misc";

        // 1. 通用品质
        context.qualityChoices = localizeConfig(XJZL.qualities);

        // 2. 秘籍专用品阶
        if (context.isManual) {
            context.tierChoices = localizeConfig(XJZL.tiers);
        }

        // 仅消耗品需要类型选择
        if (context.isConsumable) {
            context.consumableTypes = localizeConfig(XJZL.consumableTypes);

            // 准备特效列表
            context.effects = this.document.effects.map(e => ({
                id: e.id, name: e.name, img: e.img, disabled: e.disabled,
                transfer: e.transfer
            }));
        }

        // 秘籍: 解析 UUID 对应的物品名字 (为了显示好看)
        if (context.isManual && context.system.learnItemUuid) {
            const targetItem = await fromUuid(context.system.learnItemUuid);
            context.targetItemName = targetItem ? targetItem.name : "未知物品 (可能已删除)";
        }

        return context;
    }

    /* 自动保存 */
    _onRender(context, options) {
        super._onRender(context, options);
        // 1. 注入基础类型类名
        this.element.classList.add(`type-${this.document.type}`);

        // 2. 清理旧的品级类名
        const allRanks = [
            "rank-fan", "rank-tong", "rank-yin", "rank-jin", "rank-yu",
            "rank-ren", "rank-di", "rank-tian"
        ];
        this.element.classList.remove(...allRanks);

        // 3. 注入新的品级类名
        if (this.document.type === "manual") {
            // === 秘籍 (Tiers: 1-3) ===
            const tierMap = {
                1: "ren",
                2: "di",
                3: "tian"
            };
            const val = this.document.system.tier;
            const targetClass = tierMap[val] || "ren"; // 默认为人级

            this.element.classList.add(`rank-${targetClass}`);

        } else {
            // === 消耗品/杂物 (Qualities: 0-4) ===
            const qualityMap = {
                0: "fan",  // 凡
                1: "tong", // 铜
                2: "yin",  // 银
                3: "jin",  // 金
                4: "yu"    // 玉
            };

            const val = this.document.system.quality;

            // 注意：这里不能用 || "fan"，因为 0 也是有效值
            // 如果 val 是 null/undefined，或者不在表中，才用默认值
            let targetClass = qualityMap[val];
            if (!targetClass) targetClass = "fan"; // 默认凡品

            this.element.classList.add(`rank-${targetClass}`);
        }

        // 4. 秘籍拖拽监听
        if (context.isManual) {
            const dropZone = this.element.querySelector(".manual-drop-zone");
            if (dropZone) {
                dropZone.addEventListener("drop", this._onDropManualTarget.bind(this));
                // 必须阻止 dragover 默认行为，否则 drop 不会触发
                dropZone.addEventListener("dragover", (e) => e.preventDefault());
            }
        }
    }

    /**
     * 图片点击更换逻辑
     */
    async _onEditImage(event, target) {
        const attr = target.dataset.edit || "img";
        const current = foundry.utils.getProperty(this.document, attr);
        const fp = new foundry.applications.apps.FilePicker({
            type: "image",
            current: current,
            callback: path => this.document.update({ [attr]: path })
        });
        return fp.browse();
    }

    /**
   * 处理秘籍目标拖拽
   */
    async _onDropManualTarget(event) {
        event.preventDefault();
        // 1. 解析拖拽数据 (V13 标准写法)
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (err) {
            return;
        }

        if (data.type !== "Item" || !data.uuid) return;

        // 2. 查找源物品 (使用 fromUuid，最轻量)
        const item = await fromUuid(data.uuid);
        if (!item) return;

        // 3. 类型检查
        if (!["neigong", "wuxue"].includes(item.type)) {
            return ui.notifications.warn("秘籍只能记载【内功】或【武学】。");
        }

        // 4. 数据清洗
        // 必须把要存的数据转为 字符串(String) 或 数字(Number)
        // 绝对不要直接把 item 对象传进 update，那样会引发 Semaphore 错误
        const updatePayload = {
            "system.learnItemUuid": String(item.uuid), // 强制转字符串
            "system.tier": Number(item.system.tier) || 1, // 强制转数字
            "img": String(item.img),
            "name": `${item.name} 秘籍`
        };

        // 5. 提交数据库
        try {
            await this.document.update(updatePayload);
            ui.notifications.info(`秘籍内容已更新: ${item.name}`);
        } catch (err) {
            console.error("秘籍更新失败:", err);
        }
    }

    /* 移除秘籍目标 */
    async _onRemoveManualTarget(event, target) {
        // 清空 UUID，为了安全起见，不自动重置名字和图片，防止误操作
        await this.document.update({
            "system.learnItemUuid": ""
        });
        ui.notifications.info("已清空秘籍记载的内容。");
    }

    /* 特效逻辑 (消耗品专用) */
    async _onCreateEffect(event, target) {
        return ActiveEffect.create({
            name: "新状态",
            icon: "icons/svg/aura.svg",
            origin: this.document.uuid,
            // 消耗品的特效通常不是 Transfer (被动)，而是使用时触发
            // 但也可以做成 Transfer (只要放在包里就生效？通常不是)
            // 按照逻辑，消耗品应该是 transfer: false (触发式)
            transfer: false
        }, { parent: this.document });
    }
    async _onEditEffect(event, target) {
        this.document.effects.get(target.dataset.id)?.sheet.render(true);
    }
    async _onDeleteEffect(event, target) {
        this.document.effects.get(target.dataset.id)?.delete();
    }
    async _onToggleEffect(event, target) {
        const effect = this.document.effects.get(target.dataset.id);
        if (effect) effect.update({ disabled: !effect.disabled });
    }
}