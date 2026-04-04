const { ApplicationV2 } = foundry.applications.api;
const { HandlebarsApplicationMixin } = foundry.applications.api;

export class XJZLCharacterPreviewApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        classes: ["xjzl-character-preview-app", "theme-dark"],
        position: { width: 900, height: 800 },
        window: {
            resizable: true,
            icon: "fas fa-scroll"
        }
    };

    static PARTS = {
        main: {
            template: "systems/xjzl-system/templates/apps/character-preview.hbs",
            scrollable: [".preview-scroll-container"]
        }
    };

    constructor(options = {}) {
        if (options.actor) {
            options.id = `character-preview-${options.actor.id}`;
            options.window = options.window || {};
            options.window.title = `【${options.actor.name}】 - 角色档案`;
        }
        super(options);
        this.actor = options.actor;
    }

    _getHeaderControls() {
        const controls = super._getHeaderControls();
        controls.unshift({
            action: "exportImage",
            label: "导出长图",
            icon: "fas fa-camera",
            onClick: this._onExportImage.bind(this)
        });
        return controls;
    }

    /**
     * 永久剥离截图法（100%解决报错与错位）
     */
    async _onExportImage(event) {
        event.preventDefault();

        if (typeof html2canvas === "undefined") {
            ui.notifications.info("正在初次加载图像引擎，请稍候...");
            try {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            } catch (err) {
                return ui.notifications.error("加载截图插件失败，请检查网络环境。");
            }
        }

        ui.notifications.info("正在生成图片，请保持窗口打开...");

        const targetElement = this.element.querySelector(".xjzl-preview-content");

        // 1. 【终极必杀】在活体 DOM 上永久剥离所有可编辑属性！
        const editables = targetElement.querySelectorAll('[contenteditable]');
        editables.forEach(el => {
            el.removeAttribute('contenteditable');
            el.removeAttribute('spellcheck');
            el.blur(); // 失去焦点，消除发光边框
        });

        // 2. 强制休眠 100ms，让浏览器完全重新计算失去 contenteditable 后的稳固排版
        await new Promise(resolve => setTimeout(resolve, 100));

        // 3. 执行截图
        try {
            const canvas = await html2canvas(targetElement, {
                backgroundColor: "#111111",
                scale: 2,
                useCORS: true,
                logging: false
            });

            // 下载图片
            const link = document.createElement("a");
            link.download = `${this.actor.name}-角色档案.png`;
            link.href = canvas.toDataURL("image/png");
            link.click();
            ui.notifications.info("图片导出成功！(预览已锁定，如需修改请重新打开本窗口)");

        } catch (err) {
            console.error(err);
            ui.notifications.error("图片生成失败！");
        }
        // 注意：这里不再把 contenteditable 加回去了，直接锁定。
    }

    // 强力清洗器：挫骨扬灰掉 V13 自动生成的 prose-mirror 标签和空段落
    _cleanRichText(htmlStr) {
        if (!htmlStr) return "";
        let res = htmlStr;
        // 抹除 prose-mirror 标签 (保留内部文本)
        res = res.replace(/<prose-mirror[^>]*>/gi, '');
        res = res.replace(/<\/prose-mirror>/gi, '');
        // 抹除开头和结尾的空段落
        res = res.replace(/^(<p>\s*(<br\s*\/?>|&nbsp;|\s)*<\/p>\s*)+/gi, "");
        res = res.replace(/(<p>\s*(<br\s*\/?>|&nbsp;|\s)*<\/p>\s*)+$/gi, "");
        return res.trim();
    }

    _capitalize(str) {
        if (!str) return "";
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const actor = this.actor;
        const system = actor.system;

        let sectKey = system.info.sect || "无门派";
        let sectDisplay = sectKey;
        if (CONFIG.XJZL?.sects?.[sectKey]) {
            sectDisplay = game.i18n.localize(CONFIG.XJZL.sects[sectKey]);
        } else {
            const locTry = game.i18n.localize(`XJZL.Sects.${this._capitalize(sectKey)}`);
            sectDisplay = !locTry.startsWith("XJZL") ? locTry : game.i18n.localize(sectKey);
        }

        const realmMap = { 0: "未入门", 1: "人级领悟", 2: "人级小成", 3: "人级圆满", 4: "地级小成", 5: "地级圆满", 6: "天级小成", 7: "天级圆满" };
        const rLevel = system.cultivation.realmLevel || 0;

        context.basic = {
            name: actor.name,
            img: actor.img,
            sect: sectDisplay,
            realmLevel: realmMap[rLevel] || `境界 ${rLevel}`,
            background: actor.itemTypes.background?.[0]?.name || "无",
            personality: actor.itemTypes.personality?.[0]?.name || "无",
            xiayi: system.social.xiayi || 0,
            exing: system.social.exing || 0,
            hpMax: system.resources.hp.max,
            mpMax: system.resources.mp.max
        };

        const statKeys = ["liliang", "shenfa", "tipo", "wuxing", "neixi", "qigan", "shencai"];
        context.stats = statKeys.map(key => ({
            label: game.i18n.localize(`XJZL.Stats.${this._capitalize(key)}`),
            value: system.stats[key].total
        }));

        context.combat = [
            { label: "移动速度", value: system.combat.speedTotal },
            { label: "先攻", value: system.combat.initiativeTotal },
            { label: "闪避", value: system.combat.dodgeTotal },
            { label: "格挡", value: system.combat.blockTotal },
            { label: "看破", value: system.combat.kanpoTotal },
            { label: "外功命中", value: system.combat.hitWaigongTotal },
            { label: "内功命中", value: system.combat.hitNeigongTotal },
            { label: "外功防御", value: system.combat.defWaigongTotal },
            { label: "内功防御", value: system.combat.defNeigongTotal },
            { label: "外功暴击", value: system.combat.critWaigongTotal },
            { label: "内功暴击", value: system.combat.critNeigongTotal }
        ];

        const allSkillGroups = [
            { key: "wuxing", label: "悟", skills: ["wuxue", "jianding", "bagua", "shili"] },
            { key: "liliang", label: "力", skills: ["jiaoli", "zhengtuo", "paozhi", "qinbao"] },
            { key: "shenfa", label: "身", skills: ["qianxing", "qiaoshou", "qinggong", "mashu"] },
            { key: "tipo", label: "体", skills: ["renxing", "biqi", "rennai", "ningxue"] },
            { key: "neixi", label: "息", skills: ["liaoshang", "chongxue", "lianxi", "duqi"] },
            { key: "qigan", label: "感", skills: ["dianxue", "zhuizong", "tancha", "dongcha"] },
            { key: "shencai", label: "神", skills: ["jiaoyi", "qiman", "shuofu", "dingli"] }
        ];
        context.skillGroups = allSkillGroups.map(group => ({
            label: group.label,
            skills: group.skills.map(sk => ({
                name: game.i18n.localize(CONFIG.XJZL.skills[sk] || sk),
                value: system.skills[sk]?.total || 0
            }))
        }));

        const artsList = [];
        for (const [key, artData] of Object.entries(system.arts || {})) {
            if (artData.total > 0) {
                const labelKey = CONFIG.XJZL?.arts?.[key] || `XJZL.Arts.${this._capitalize(key)}`;
                artsList.push({ name: game.i18n.localize(labelKey), value: artData.total });
            }
        }
        context.arts = artsList;

        context.activeNeigong = null;
        if (system.martial.active_neigong) {
            const ng = actor.items.get(system.martial.active_neigong);
            if (ng) {
                const currentStage = Math.max(1, ng.system.stage || 0);
                const stageConfig = ng.system.config[`stage${currentStage}`];
                context.activeNeigong = {
                    name: ng.name,
                    effect: this._cleanRichText(stageConfig?.description) || "暂无特效描述"
                };
            }
        }

        const pinnedList = actor.getFlag("xjzl-system", "pinnedMoves") || [];
        const pinnedSet = new Set(pinnedList);
        const wuxueGroups = [];

        for (const wuxue of (actor.itemTypes.wuxue || [])) {
            const pinnedMoves = (wuxue.system.moves || []).filter(m => pinnedSet.has(`${wuxue.id}.${m.id}`));
            if (pinnedMoves.length > 0) {
                const catKey = wuxue.system.category || 'wuxue';
                let catDisplay = CONFIG.XJZL?.wuxueCategories?.[catKey]
                    ? game.i18n.localize(CONFIG.XJZL.wuxueCategories[catKey])
                    : game.i18n.localize(`XJZL.Wuxue.Category.${this._capitalize(catKey)}`);

                wuxueGroups.push({
                    name: wuxue.name,
                    category: catDisplay,
                    moves: pinnedMoves.map(m => {
                        const derived = wuxue.calculateMoveDamage(m.id) || { damage: 0 };
                        let blockValue = 0;
                        if (m.type === "stance") {
                            const lvl = Math.max(1, m.computedLevel || 1);
                            const base = m.calculation?.base || 0;
                            const growth = m.calculation?.growth || 0;
                            blockValue = base + growth * (lvl - 1);
                        }

                        return {
                            name: m.name,
                            type: m.type,
                            typeLabel: game.i18n.localize(`XJZL.Wuxue.Type.${m.type}`),
                            isUltimate: m.isUltimate,
                            range: m.range,
                            cost: {
                                hp: m.costs.hp?.[Math.max(0, m.computedLevel - 1)] || 0,
                                mp: m.costs.mp?.[Math.max(0, m.computedLevel - 1)] || 0,
                                rage: m.costs.rage?.[Math.max(0, m.computedLevel - 1)] || 0
                            },
                            isStance: m.type === "stance",
                            blockValue: blockValue,
                            isFeint: m.type === "feint",
                            feintValue: m.baseFeint || 0,
                            damage: derived.damage,
                            // 调用强力清空行正则
                            description: this._cleanRichText(m.description) || "暂无描述"
                        };
                    })
                });
            }
        }
        context.wuxueGroups = wuxueGroups;

        return context;
    }
}