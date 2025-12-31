// module/pause.js
const GamePause = foundry.applications.ui.GamePause;

export class XJZLPause extends GamePause {
    async _onRender(context, options) {
        // 1. 先执行父类渲染
        await super._onRender(context, options);

        // 【优化】如果当前并不是暂停状态（比如是取消暂停的过程），直接退出，不改字
        if (!game.paused) return;

        // 2. 找到容器
        const figcaption = this.element.querySelector("figcaption");
        if (!figcaption) return;

        // 3. 准备骚话
        const flavorList = CONFIG.XJZL?.pauseFlavorText;
        let flavorText = "";
        if (flavorList && flavorList.length > 0) {
            flavorText = flavorList[Math.floor(Math.random() * flavorList.length)];
        }

        // 4. 修改 HTML
        const originalTitle = game.i18n.localize("GAME.Paused");
        figcaption.innerHTML = `${originalTitle}<small class="pause-flavor">${flavorText}</small>`;
    }
}