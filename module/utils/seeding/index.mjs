/* module/utils/seeding/index.mjs */

import { seedOrigins } from "./seed-origins.mjs";
import { seedConsumables } from "./seed-consumables.mjs";
import { seedArtBooks } from "./seed-artbooks.mjs";
import { seedMisc } from "./seed-misc.mjs";
import { seedArmor } from "./seed-armor.mjs";
// import { seedWuxue } from "./seed-wuxue.mjs"; // 未来扩展

const { DialogV2 } = foundry.applications.api;

export const SeedingManager = {
    // 模块化导出
    origins: seedOrigins,
    consumables: seedConsumables,
    artbooks: seedArtBooks,
    misc: seedMisc,
    armor: seedArmor,
    // wuxue: seedWuxue,

    /**
     * 一键生成所有 (全量重置)
     */
    all: async function () {
        // 使用 V13 的 DialogV2.confirm
        const confirm = await DialogV2.confirm({
            window: { title: "全量重置合集包" },
            content: "<p>这将清空并重新生成所有系统预设合集包。确定吗？</p>",
            rejectClose: false, // 允许点X关闭，返回 null/false
            modal: true
        });

        if (confirm) {
            await this.origins();
            await this.consumables();
            await this.artbooks();
            await this.misc();
            await this.armor();
            // await this.wuxue();
            ui.notifications.info("XJZL | 全量种子数据生成完成。");
        }
    }
};