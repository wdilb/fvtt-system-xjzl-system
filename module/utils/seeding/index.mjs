/* module/utils/seeding/index.mjs */

import { seedOrigins } from "./seed-origins.mjs";
import { seedConsumables } from "./seed-consumables.mjs";
// import { seedWuxue } from "./seed-wuxue.mjs"; // 未来扩展

export const SeedingManager = {
    // 模块化导出
    origins: seedOrigins,
    consumables: seedConsumables,
    // wuxue: seedWuxue,

    /**
     * 一键生成所有 (全量重置)
     */
    all: async function() {
        const confirm = await Dialog.confirm({
            title: "全量重置合集包",
            content: "<p>这将清空并重新生成所有系统预设合集包。确定吗？</p>"
        });
        
        if (confirm) {
            await this.origins();
            await this.consumables();
            // await this.wuxue();
            ui.notifications.info("XJZL | 全量种子数据生成完成。");
        }
    }
};