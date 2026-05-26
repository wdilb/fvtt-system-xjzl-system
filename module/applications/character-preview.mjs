const { ApplicationV2 } = foundry.applications.api;
const { HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * 角色卡预览导出模块
 * =======================================================
 * 核心职责：
 * 1. 提供「A4大小分页打包导出」功能
 * 2. 提供「高清完整长图导出」功能
 */
export class XJZLCharacterPreviewApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        classes: ["xjzl-character-preview-app"],
        position: { width: 1250, height: 950 }, // 预览窗口默认尺寸
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
            options.window.title = `【${options.actor.name}】 - 角色卡预览模块`;
        }
        super(options);
        this.actor = options.actor;
    }

    /**
     * 注入头部导出按钮
     */
    _getHeaderControls() {
        const controls = super._getHeaderControls();

        // 长图导出按钮
        controls.unshift({
            action: "exportImage",
            label: "导出长图",
            icon: "fas fa-image",
            onClick: this._onExportImage.bind(this)
        });

        // A4分页图册导出按钮
        controls.unshift({
            action: "exportA4Image",
            label: "导出A4图",
            icon: "fas fa-file-invoice",
            onClick: this._onExportA4Image.bind(this)
        });

        return controls;
    }

    /* ==================================================== */
    /*                   导出引擎核心逻辑                   */
    /* ==================================================== */

    /**
     * 导出 A4 双列排版分页图册 (核心物理算法)
     */
    async _onExportA4Image(event) {
        event.preventDefault();

        await this._loadExportEngines(true); // 加载截图与ZIP引擎
        ui.notifications.info("正在排版高清A4图，请稍候...");

        // 克隆并清理 DOM
        const sourceElement = this.element.querySelector(".xjzl-preview-content");
        const cloneElement = sourceElement.cloneNode(true);
        this._stripEditables(cloneElement);

        // --- 物理排版参数 (基于测试完美的边距) ---
        const COL_WIDTH = 940;       // 单列宽度
        const COL_GAP = 120;         // 栏间隙

        const PADDING_TOP = 220;     // 避让右上楼阁
        const PADDING_BOTTOM = 260;  // 避让右下断剑
        const PADDING_LEFT = 220;    // 避让左侧竹林
        const PADDING_RIGHT = 160;   // 避让右侧边缘

        const A4_ASPECT = 1.4142;
        const CANVAS_WIDTH = COL_WIDTH * 2 + COL_GAP + PADDING_LEFT + PADDING_RIGHT; // 2380px
        const CANVAS_HEIGHT = Math.round(CANVAS_WIDTH * A4_ASPECT);                  // 3366px
        const INNER_WIDTH = CANVAS_WIDTH - PADDING_LEFT - PADDING_RIGHT;             // 2000px
        const INNER_HEIGHT = CANVAS_HEIGHT - PADDING_TOP - PADDING_BOTTOM;           // 2886px

        const SHIFT_STEP = COL_WIDTH + COL_GAP;
        const BG_IMAGE_URL = "url('systems/xjzl-system/assets/picture/preview-bg-1.png')";

        // --- 构建离屏渲染树 ---
        const offScreenContainer = document.createElement('div');
        offScreenContainer.className = "xjzl-character-preview-app";
        Object.assign(offScreenContainer.style, {
            position: 'absolute', left: '-9999px', top: '-9999px', zIndex: '-999',
            width: `${CANVAS_WIDTH}px`
        });

        const windowContent = document.createElement('div');
        windowContent.className = "window-content print-export-mode";
        Object.assign(windowContent.style, {
            width: `${CANVAS_WIDTH}px`, height: `${CANVAS_HEIGHT}px`,
            padding: `${PADDING_TOP}px ${PADDING_RIGHT}px ${PADDING_BOTTOM}px ${PADDING_LEFT}px`,
            boxSizing: 'border-box', position: 'relative',
            backgroundImage: BG_IMAGE_URL, backgroundSize: '100% 100%',
            backgroundRepeat: 'no-repeat', backgroundColor: '#eae0c8'
        });

        // 绝对遮罩层：框死排版区防溢出
        const maskWrapper = document.createElement('div');
        Object.assign(maskWrapper.style, {
            width: `${INNER_WIDTH}px`, height: `${INNER_HEIGHT}px`,
            position: 'relative', overflow: 'hidden'
        });

        const shiftWrapper = document.createElement('div');
        Object.assign(shiftWrapper.style, { width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 });

        const layoutContainer = document.createElement('div');
        Object.assign(layoutContainer.style, {
            height: `${INNER_HEIGHT}px`, columnWidth: `${COL_WIDTH}px`,
            columnGap: `${COL_GAP}px`, columnFill: 'auto',
            position: 'absolute', top: '0', left: '0', transition: 'none'
        });

        // 挂载
        layoutContainer.appendChild(cloneElement);
        shiftWrapper.appendChild(layoutContainer);
        maskWrapper.appendChild(shiftWrapper);
        windowContent.appendChild(maskWrapper);
        offScreenContainer.appendChild(windowContent);
        document.body.appendChild(offScreenContainer);

        // 字体与图标加载等待
        await document.fonts.ready;
        await this._replaceIconsWithImages(offScreenContainer);
        await new Promise(resolve => setTimeout(resolve, 800));

        // --- 执行分页截图与打包 ---
        try {
            const scrollW = layoutContainer.scrollWidth;
            const totalPages = Math.max(1, Math.ceil(scrollW / (SHIFT_STEP * 2)));
            const zip = new JSZip();

            for (let i = 0; i < totalPages; i++) {
                layoutContainer.style.left = `-${i * SHIFT_STEP * 2}px`;
                layoutContainer.getBoundingClientRect(); // 强制重绘
                await new Promise(resolve => setTimeout(resolve, 400));

                const dataUrl = await htmlToImage.toPng(windowContent, {
                    quality: 1.0, pixelRatio: 1.0, skipFonts: true,
                    filter: (node) => node.tagName !== 'SCRIPT'
                });

                const fileName = totalPages > 1 ? `${this.actor.name}-A4图-第${i + 1}页.png` : `${this.actor.name}-A4图.png`;
                zip.file(fileName, dataUrl.split(',')[1], { base64: true });
            }

            const zipBlob = await zip.generateAsync({ type: "blob" });
            const objectUrl = URL.createObjectURL(zipBlob);

            new Dialog({
                title: "✅ A4图制作完成",
                content: `
                    <div style="padding: 10px; text-align: center;">
                        <p style="font-size: 1.1em; margin-bottom: 5px;">角色 <strong>${this.actor.name}</strong> 的A4图已印制打包！</p>
                        <p>本次合成了 <strong>${totalPages}</strong> 页实体A4图。</p>
                    </div>
                `,
                buttons: {
                    download: {
                        label: "下载 ZIP",
                        icon: '<i class="fas fa-file-download"></i>',
                        callback: () => {
                            const link = document.createElement("a");
                            link.download = `${this.actor.name}-高清A4图.zip`;
                            link.href = objectUrl;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);

                            setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
                            ui.notifications.info("下载已开始！");
                        }
                    }
                },
                default: "download"
            }).render(true);

        } catch (err) {
            console.error("A4印制失败:", err);
            ui.notifications.error("打包失败！请查阅控制台。");
        } finally {
            offScreenContainer.remove();
        }
    }

    /**
     * 导出单页瀑布流长图
     */
    async _onExportImage(event) {
        event.preventDefault();

        await this._loadExportEngines(false); // 仅需截图引擎
        ui.notifications.info("正在印制长图，请稍候...");

        const sourceElement = this.element.querySelector(".xjzl-preview-content");
        const cloneElement = sourceElement.cloneNode(true);
        this._stripEditables(cloneElement);

        // 长图参数：单列展平
        const CONTENT_WIDTH = 940;
        const PADDING_X = 160;      // 左右边距
        const CANVAS_WIDTH = CONTENT_WIDTH + PADDING_X * 2; // 1260px

        const offScreenContainer = document.createElement('div');
        offScreenContainer.className = "xjzl-character-preview-app";
        Object.assign(offScreenContainer.style, {
            position: 'absolute', left: '-9999px', top: '-9999px', zIndex: '-999',
            width: `${CANVAS_WIDTH}px`
        });

        const BG_IMAGE_URL = "url('systems/xjzl-system/assets/picture/preview-bg-2.png')";

        const windowContent = document.createElement('div');
        windowContent.className = "window-content";
        Object.assign(windowContent.style, {
            width: `${CANVAS_WIDTH}px`, height: 'auto', // 高度自适应
            padding: `140px ${PADDING_X}px`,
            boxSizing: 'border-box',
            backgroundImage: BG_IMAGE_URL,
            backgroundSize: 'cover', // 铺满整个长图
            backgroundPosition: 'top center',
            backgroundColor: '#eae0c8'
        });

        // 解除内容原本的最大宽度限制
        cloneElement.style.maxWidth = 'none';
        cloneElement.style.width = `${CONTENT_WIDTH}px`;

        windowContent.appendChild(cloneElement);
        offScreenContainer.appendChild(windowContent);
        document.body.appendChild(offScreenContainer);

        await document.fonts.ready;
        await this._replaceIconsWithImages(offScreenContainer);
        await new Promise(resolve => setTimeout(resolve, 800));

        try {
            // 执行截图渲染
            const dataUrl = await htmlToImage.toPng(windowContent, {
                quality: 1.0,
                pixelRatio: 1.2,
                skipFonts: true, // 忽略字体跨域报错（已通过图标替换解决）
                filter: (node) => {
                    if (node.tagName === 'SCRIPT') return false;
                    return true;
                }
            });

            // 触发图片下载
            const link = document.createElement("a");
            link.download = `${this.actor.name}-档案长图.png`;
            link.href = dataUrl;
            link.click();

            ui.notifications.info("长图导出成功！");

        } catch (err) {
            console.error("生成图片失败:", err);
            ui.notifications.error("图片生成失败！请按 F12 查看控制台。");
        } finally {
            // 销毁离屏容器，释放内存
            offScreenContainer.remove();
        }
    }


    /* ==================================================== */
    /*                   辅助工具与数据准备                 */
    /* ==================================================== */

    /**
     * 动态加载外部依赖引擎 (htmlToImage / JSZip)
     */
    async _loadExportEngines(needZip = false) {
        const loadScript = async (src, globalVar) => {
            if (typeof window[globalVar] === "undefined") {
                if (!document.querySelector(`script[src*="${src}"]`)) {
                    await new Promise((res, rej) => {
                        const script = document.createElement('script');
                        script.src = src; script.onload = res; script.onerror = rej;
                        document.head.appendChild(script);
                    });
                } else {
                    await new Promise(r => setTimeout(r, 500));
                }
            }
        };
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js", "htmlToImage");
        if (needZip) {
            await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", "JSZip");
        }
    }

    /**
     * 移除 DOM 中的编辑属性
     */
    _stripEditables(element) {
        element.querySelectorAll('[contenteditable]').forEach(el => {
            el.removeAttribute('contenteditable');
            el.removeAttribute('spellcheck');
        });

        // 处理操作备注：如果是默认提示文本，则清空文字但保留打印手写用的空行
        const notesContent = element.querySelector('.notes-content');
        if (notesContent) {
            const currentText = notesContent.textContent || "";
            if (currentText.includes("可在此处输入该角色的特殊机制、行动优先级、特殊装备或操作指南等信息...")) {
                // 替换为纯换行，保留原有的高度供玩家手写
                notesContent.innerHTML = "<br><br><br>";
            }
        }
    }

    /**
     * 字体图标转 Canvas 图像 (解决跨域丢失与截图渲染 Bug)
     */
    async _replaceIconsWithImages(container) {
        const icons = container.querySelectorAll('i.fas, i.far, i.fab, i.fal, i.fad, i.fa');
        for (let icon of icons) {
            const compStyle = window.getComputedStyle(icon, '::before');
            const content = compStyle.content;
            if (!content || content === 'none' || content === 'normal') continue;

            let charCode;
            try { charCode = JSON.parse(content); } catch (e) { charCode = content.replace(/['"]/g, ''); }

            const fontSize = parseFloat(compStyle.fontSize) || 16;
            const size = fontSize * 1.25;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;

            const ctx = canvas.getContext('2d');
            ctx.font = `${compStyle.fontWeight} ${fontSize}px ${compStyle.fontFamily}`;
            ctx.fillStyle = compStyle.color;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(charCode, size / 2, size / 2);

            const img = document.createElement('img');
            img.src = canvas.toDataURL('image/png');
            Object.assign(img.style, {
                width: `${size}px`, height: `${size}px`,
                display: 'inline-block', verticalAlign: 'middle'
            });

            const parentStyle = window.getComputedStyle(icon);
            const offset = (size - fontSize) / 2;
            img.style.margin = `0 -${offset}px`;
            img.style.marginLeft = `calc(${parentStyle.marginLeft} - ${offset}px)`;
            img.style.marginRight = `calc(${parentStyle.marginRight} - ${offset}px)`;

            icon.replaceWith(img);
        }
    }

    _cleanRichText(htmlStr) {
        if (!htmlStr) return "";
        let res = htmlStr;
        res = res.replace(/<prose-mirror[^>]*>/gi, '').replace(/<\/prose-mirror>/gi, '');
        res = res.replace(/^(<p>\s*(<br\s*\/?>|&nbsp;|\s)*<\/p>\s*)+/gi, "");
        res = res.replace(/(<p>\s*(<br\s*\/?>|&nbsp;|\s)*<\/p>\s*)+$/gi, "");
        return res.trim();
    }

    _capitalize(str) {
        return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
    }

    /**
     * 核心数据组装
     */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const actor = this.actor;
        const system = actor.system;

        // 1. 门派与境界
        let sectKey = system.info.sect || "无门派";
        let sectDisplay = sectKey;
        if (CONFIG.XJZL?.sects?.[sectKey]) sectDisplay = game.i18n.localize(CONFIG.XJZL.sects[sectKey]);
        else {
            const locTry = game.i18n.localize(`XJZL.Sects.${this._capitalize(sectKey)}`);
            sectDisplay = !locTry.startsWith("XJZL") ? locTry : game.i18n.localize(sectKey);
        }

        const realmMap = { 0: "未入门", 1: "不堪一击", 2: "初窥门径", 3: "略有小成", 4: "融会贯通", 5: "炉火纯青", 6: "登峰造极", 7: "撼天动地" };
        const getAttitude = (val) => {
            if (!val || val === "none") return "无视";
            const fallback = { "zhonshi": "重视", "wushi": "无视" };
            let locKey = CONFIG.XJZL?.attitudes?.[val] || `XJZL.Attitudes.${this._capitalize(val)}`;
            let translated = game.i18n.localize(locKey);
            return (!translated.startsWith("XJZL")) ? translated : (fallback[val] || val);
        };

        // 2. 基础档案组装
        context.basic = {
            name: actor.name, img: actor.img, sect: sectDisplay,
            realmLevel: realmMap[system.cultivation.realmLevel || 0] || `境界 ${system.cultivation.realmLevel || 0}`,
            background: actor.itemTypes.background?.[0]?.name || "无",
            personality: actor.itemTypes.personality?.[0]?.name || "无",
            xiayi: system.social.xiayi || 0, exing: system.social.exing || 0,
            shalu: system.resources.shalu?.value || 0, shanie: system.resources.shanie || 0,
            repWulin: system.social.rep_wulin || 0, repChaoting: system.social.rep_chaoting || 0,
            attWulin: getAttitude(system.social.attitude_wulin),
            attChaoting: getAttitude(system.social.attitude_chaoting),
            attShisu: getAttitude(system.social.attitude_shisu),
            hpMax: system.resources.hp.max, mpMax: system.resources.mp.max
        };

        // 3. 核心七维属性
        const statKeys = ["liliang", "shenfa", "tipo", "wuxing", "neixi", "qigan", "shencai"];
        context.stats = statKeys.map(key => ({
            label: game.i18n.localize(`XJZL.Stats.${this._capitalize(key)}`),
            value: system.stats[key].total
        }));

        // 4. 战斗面板与普攻估算
        let basicAttackDamage = 0;
        try {
            const weapon = actor.itemTypes.weapon.find(i => i.system.equipped);
            const calcRes = actor._calculateBasicAttackDamage(
                { name: "普通攻击", type: "basic", damageType: "waigong", weaponType: weapon ? weapon.system.type : "unarmed" },
                weapon ? (weapon.system.damage || 0) : 0,
                { bonusDamage: 0 }, "basic", 0, { id: "basic", flags: {} }
            );
            basicAttackDamage = calcRes ? calcRes.damage : 0;
        } catch (e) { }

        context.combat = [
            { label: "移动速度", value: system.combat.speedTotal }, { label: "先攻", value: system.combat.initiativeTotal },
            { label: "闪避", value: system.combat.dodgeTotal }, { label: "格挡", value: system.combat.blockTotal },
            { label: "外功命中", value: system.combat.hitWaigongTotal }, { label: "外功防御", value: system.combat.defWaigongTotal },
            { label: "外功暴击", value: system.combat.critWaigongTotal }, { label: "看破", value: system.combat.kanpoTotal },
            { label: "内功命中", value: system.combat.hitNeigongTotal }, { label: "内功防御", value: system.combat.defNeigongTotal },
            { label: "内功暴击", value: system.combat.critNeigongTotal }, { label: "普攻伤害", value: basicAttackDamage }
        ];

        // 5. 江湖技能
        const allSkillGroups = [
            { key: "wuxing", label: "悟性", skills: ["wuxue", "jianding", "bagua", "shili"] },
            { key: "liliang", label: "力量", skills: ["jiaoli", "zhengtuo", "paozhi", "qinbao"] },
            { key: "shenfa", label: "身法", skills: ["qianxing", "qiaoshou", "qinggong", "mashu"] },
            { key: "tipo", label: "体魄", skills: ["renxing", "biqi", "rennai", "ningxue"] },
            { key: "neixi", label: "内息", skills: ["liaoshang", "chongxue", "lianxi", "duqi"] },
            { key: "qigan", label: "气感", skills: ["dianxue", "zhuizong", "tancha", "dongcha"] },
            { key: "shencai", label: "神采", skills: ["jiaoyi", "qiman", "shuofu", "dingli"] }
        ];
        context.skillGroups = allSkillGroups.map(g => ({
            label: g.label,
            skills: g.skills.map(sk => ({ name: game.i18n.localize(CONFIG.XJZL.skills[sk] || sk), value: system.skills[sk]?.total || 0 }))
        }));

        // 6. 技艺与内功
        context.arts = Object.entries(system.arts || {}).filter(([, d]) => d.total > 0).map(([k, d]) => ({
            name: game.i18n.localize(CONFIG.XJZL?.arts?.[k] || `XJZL.Arts.${this._capitalize(k)}`), value: d.total
        }));

        const formatTitle = (name) => name.includes("《") ? name : `《${name}》`;

        context.activeNeigong = null;
        if (system.martial.active_neigong) {
            const ng = actor.items.get(system.martial.active_neigong);
            if (ng) {
                const stageConf = ng.system.config[`stage${Math.max(1, ng.system.stage || 0)}`];
                // 智能应用书名号
                context.activeNeigong = { name: formatTitle(ng.name), effect: this._cleanRichText(stageConf?.description) || "暂无特效" };
            }
        }

        // 7. 常用武学与招式组装
        const pinnedSet = new Set(actor.getFlag("xjzl-system", "pinnedMoves") || []);
        const levelNames = ["未入门", "领悟", "掌握", "精通", "合一"];
        const tierMap = { 1: "人级", 2: "地级", 3: "天级" };

        context.wuxueGroups = [];
        for (const wuxue of (actor.itemTypes.wuxue || [])) {
            const pinnedMoves = (wuxue.system.moves || []).filter(m => pinnedSet.has(`${wuxue.id}.${m.id}`));
            if (!pinnedMoves.length) continue;

            const catKey = wuxue.system.category || 'wuxue';
            let catDisplay = CONFIG.XJZL?.wuxueCategories?.[catKey] ? game.i18n.localize(CONFIG.XJZL.wuxueCategories[catKey]) : game.i18n.localize(`XJZL.Wuxue.Category.${this._capitalize(catKey)}`);

            context.wuxueGroups.push({
                // 智能应用书名号
                name: formatTitle(wuxue.name), category: catDisplay,
                tierName: tierMap[wuxue.system.tier] || `${wuxue.system.tier}级`,
                moves: pinnedMoves.map(m => {
                    const derived = wuxue.calculateMoveDamage(m.id) || { damage: 0 };
                    const lvl = Math.max(1, m.computedLevel || 1);
                    const mTier = m.computedTier || wuxue.system.tier || 1;

                    let blockValue = m.type === "stance" ? ((m.calculation?.base || 0) + (m.calculation?.growth || 0) * (lvl - 1)) : 0;
                    let feintValue = m.baseFeint || 0;

                    if (m.type === "feint") {
                        let wRankVal = (m.weaponType && actor.system.combat?.weaponRanks) ? (actor.system.combat.weaponRanks[m.weaponType]?.total || 0) : 0;
                        feintValue += wRankVal + (actor.system.combat.xuzhaoTotal || 0);
                    }

                    return {
                        name: m.name,
                        tierName: tierMap[mTier] || `${mTier}级`,
                        levelName: levelNames[Math.min(4, Math.max(0, m.effectiveStage ?? m.computedLevel ?? 0))],
                        type: m.type, typeLabel: game.i18n.localize(`XJZL.Wuxue.Type.${m.type}`),
                        isUltimate: m.isUltimate, actionCost: m.actionCost || "主要动作", range: m.range, isStance: m.type === "stance", isFeint: m.type === "feint",
                        blockValue, feintValue, damage: derived.damage, description: this._cleanRichText(m.description) || "暂无描述",
                        cost: {
                            hp: m.costs.hp?.[Math.max(0, m.computedLevel - 1)] || 0,
                            mp: m.costs.mp?.[Math.max(0, m.computedLevel - 1)] || 0,
                            rage: m.costs.rage?.[Math.max(0, m.computedLevel - 1)] || 0
                        }
                    };
                })
            });
        }
        return context;
    }
}