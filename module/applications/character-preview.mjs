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

        controls.unshift({
            action: "exportA4Image",
            label: "导出A4图",
            icon: "fas fa-file-invoice",
            onClick: this._onExportA4Image.bind(this)
        });
        return controls;
    }

    /**
     * 导出竖向 A4 双列的分页截图
     */
    async _onExportA4Image(event) {
        event.preventDefault();
        if (typeof htmlToImage === "undefined") {
            if (!document.querySelector('script[src*="html-to-image.min.js"]')) {
                ui.notifications.info("正在加载截图引擎，请稍候...");
                try {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = "https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js";
                        script.onload = resolve;
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                } catch (err) {
                    return ui.notifications.error("加载截图插件失败。");
                }
            } else {
                // 脚本标签已存在但还没执行完，让程序等一下并阻止后续并发
                await new Promise(resolve => setTimeout(resolve, 500));
                if (typeof htmlToImage === "undefined") return ui.notifications.warn("插件正在努力下载中，请稍后再试。");
            }
        }
        if (typeof JSZip === "undefined") {
            if (!document.querySelector('script[src*="jszip.min.js"]')) {
                ui.notifications.info("正在加载压缩打包引擎，请稍候...");
                try {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
                        script.onload = resolve;
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                } catch (err) {
                    return ui.notifications.error("加载ZIP插件失败。");
                }
            } else {
                await new Promise(resolve => setTimeout(resolve, 500));
                if (typeof JSZip === "undefined") return ui.notifications.warn("插件正在努力下载中，请稍后再试。");
            }
        }
        ui.notifications.info("正在生成 A4比例的 图片，请耐心等待...");
        // 克隆源数据并去除可编辑属性
        const sourceElement = this.element.querySelector(".xjzl-preview-content");
        const cloneElement = sourceElement.cloneNode(true);
        cloneElement.querySelectorAll('[contenteditable]').forEach(el => {
            el.removeAttribute('contenteditable');
            el.removeAttribute('spellcheck');
        });
        // ==========================================
        // 物理比例双列截断运算
        // ==========================================
        const COL_WIDTH = 900;       // 单列完全保持原长图的 900px
        const COL_GAP = 60;          // 两列中间留 60px 缝隙 (缩放后相当于30px)
        const PADDING = 40;          // A4 纸边缘留 40px 白边 (缩放后相当于20px)

        const A4_ASPECT = 1.4142;    // A4 标准长宽比
        // A4 画布总宽度 = 2个900px的列 + 中间大缝隙 + 左右边距
        const CANVAS_WIDTH = COL_WIDTH * 2 + COL_GAP + PADDING * 2;   // 1940px
        // A4 画布总高度 = 宽度 * 1.4142
        const CANVAS_HEIGHT = Math.round(CANVAS_WIDTH * A4_ASPECT);   // 2744px

        // 内容实际可以延展高度 = 大画布高度 - 上下边距
        const INNER_HEIGHT = CANVAS_HEIGHT - PADDING * 2;             // 2664px

        // 每次翻页，镜头往右平移"两列+两缝"的距离
        const SHIFT_STEP = (COL_WIDTH + COL_GAP) * 2;                 // 1920px
        const offScreenContainer = document.createElement('div');
        offScreenContainer.className = "xjzl-character-preview-app theme-dark";
        Object.assign(offScreenContainer.style, {
            position: 'absolute',
            left: '-9999px',
            top: '-9999px',
            zIndex: '-999',
            width: `${CANVAS_WIDTH}px`
        });
        const windowContent = document.createElement('div');
        windowContent.className = "window-content";
        Object.assign(windowContent.style, {
            width: `${CANVAS_WIDTH}px`,
            height: `${CANVAS_HEIGHT}px`,
            padding: `${PADDING}px`,
            background: 'radial-gradient(circle at 50% 0%, #2a2a2a 0%, #111111 80%)',
            boxSizing: 'border-box',
            overflow: 'hidden',
            position: 'relative'
        });
        // 为推拉平移提供图层
        const shiftWrapper = document.createElement('div');
        Object.assign(shiftWrapper.style, {
            width: '100%',
            height: '100%',
            position: 'relative'
        });
        // 核心截断发生器：这会让长图在 2664 高度的地方硬折断到旁边生成第二列
        const layoutContainer = document.createElement('div');
        Object.assign(layoutContainer.style, {
            height: `${INNER_HEIGHT}px`,
            columnWidth: `${COL_WIDTH}px`,  // 不允许挤压，强制按900px排版
            columnGap: `${COL_GAP}px`,
            columnFill: 'auto',
            position: 'absolute',
            top: '0',
            left: '0',
            transition: 'none'
        });
        layoutContainer.appendChild(cloneElement);
        shiftWrapper.appendChild(layoutContainer);
        windowContent.appendChild(shiftWrapper);
        offScreenContainer.appendChild(windowContent);
        document.body.appendChild(offScreenContainer);
        await document.fonts.ready;
        await this._replaceIconsWithImages(offScreenContainer);
        await new Promise(resolve => setTimeout(resolve, 400));
        try {
            // 测量排版后总共蔓延出了多宽
            const scrollW = layoutContainer.scrollWidth;
            const totalPages = Math.max(1, Math.ceil(scrollW / SHIFT_STEP));
            const zip = new JSZip();
            for (let i = 0; i < totalPages; i++) {
                // 向左抽拉图层进行分页截图
                layoutContainer.style.left = `-${i * SHIFT_STEP}px`;
                layoutContainer.getBoundingClientRect(); // 强制重绘
                await new Promise(resolve => setTimeout(resolve, 350));
                // 因为底宽就是1940px，已经是超巨幅了，不需要 pixelRatio: 2 (以免爆内存导致空图)
                const dataUrl = await htmlToImage.toPng(windowContent, {
                    quality: 1.0,
                    pixelRatio: 1.0,
                    skipFonts: true,
                    filter: (node) => node.tagName !== 'SCRIPT'
                });
                const base64Data = dataUrl.split(',')[1];
                const fileName = totalPages > 1 ? `${this.actor.name}-A4图册-第${i + 1}幅.png` : `${this.actor.name}-A4图册.png`;
                zip.file(fileName, base64Data, { base64: true });
            }
            // 等待截图生成并压缩完毕
            const zipBlob = await zip.generateAsync({ type: "blob" });
            const objectUrl = URL.createObjectURL(zipBlob);
            // 友好弹窗 - 解除浏览器保护限制
            new Dialog({
                title: "✅ 档案打包完成",
                content: `
            <div style="padding: 10px; text-align: center;">
                <p style="font-size: 1.1em; margin-bottom: 5px;">角色 <strong>${this.actor.name}</strong> 的A4比例图片已装订打包！</p>
                <p>本次合成了 <strong>${totalPages}</strong> 幅 A4 图片。</p>
            </div>
        `,
                buttons: {
                    download: {
                        label: "保存 ZIP 压缩包",
                        icon: '<i class="fas fa-file-download"></i>',
                        callback: () => {
                            const link = document.createElement("a");
                            link.download = `${this.actor.name}-A4角色档案图册.zip`;
                            link.href = objectUrl;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);

                            setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
                            ui.notifications.info("A4图册下载已开始！");
                        }
                    }
                },
                default: "download"
            }).render(true);
        } catch (err) {
            console.error("A4 图片打包生成失败:", err);
            ui.notifications.error("A4 图片打包失败！请查阅控制台。");
        } finally {
            offScreenContainer.remove();
        }
    }

    /**
     * 导出角色长图
     * 采用离屏克隆与 Canvas 图标转换技术，避免与FVTT底层机制冲突
     */
    async _onExportImage(event) {
        event.preventDefault();

        // 1. 动态加载 html-to-image 截图引擎
        if (typeof htmlToImage === "undefined") {
            if (!document.querySelector('script[src*="html-to-image.min.js"]')) {
                ui.notifications.info("正在加载高精度图像引擎，请稍候...");
                try {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = "https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js";
                        script.onload = resolve;
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                } catch (err) {
                    return ui.notifications.error("加载截图插件失败，请检查网络环境。");
                }
            } else {
                await new Promise(resolve => setTimeout(resolve, 500));
                if (typeof htmlToImage === "undefined") return ui.notifications.warn("插件正在努力下载中，请稍后再试。");
            }
        }

        ui.notifications.info("正在生成高清档案图，这可能需要几秒钟...");

        const sourceElement = this.element.querySelector(".xjzl-preview-content");

        // 2. 创建 DOM 克隆，剥离可编辑属性以防止 Foundry 编辑器报错
        const cloneElement = sourceElement.cloneNode(true);
        const editables = cloneElement.querySelectorAll('[contenteditable]');
        editables.forEach(el => {
            el.removeAttribute('contenteditable');
            el.removeAttribute('spellcheck');
        });

        // 3. 构建离屏渲染容器，继承应用原有样式，避免干扰当前视口
        const offScreenContainer = document.createElement('div');
        offScreenContainer.className = "xjzl-character-preview-app theme-dark";
        Object.assign(offScreenContainer.style, {
            position: 'absolute',
            left: '-9999px',
            top: '-9999px',
            zIndex: '-999',
            width: `${this.element.offsetWidth}px`
        });

        // 还原窗口的渐变背景与内边距
        const windowContent = document.createElement('div');
        windowContent.className = "window-content";
        Object.assign(windowContent.style, {
            padding: '20px',
            background: 'radial-gradient(circle at 50% 0%, #2a2a2a 0%, #111111 80%)',
            height: 'auto'
        });

        windowContent.appendChild(cloneElement);
        offScreenContainer.appendChild(windowContent);

        // 必须挂载至 body 下，才能使 getComputedStyle 正常解析伪元素
        document.body.appendChild(offScreenContainer);

        // 4. 等待字体加载完成并执行图标替换处理
        await document.fonts.ready;
        await this._replaceIconsWithImages(offScreenContainer);

        // 预留短暂时延，确保 DOM 布局及图片替换完全稳定
        await new Promise(resolve => setTimeout(resolve, 150));

        try {
            // 5. 执行截图渲染
            const dataUrl = await htmlToImage.toPng(windowContent, {
                quality: 1.0,
                pixelRatio: 2,
                skipFonts: true, // 忽略字体跨域报错（已通过图标替换解决）
                filter: (node) => {
                    if (node.tagName === 'SCRIPT') return false;
                    return true;
                }
            });

            // 6. 触发图片下载
            const link = document.createElement("a");
            link.download = `${this.actor.name}-角色档案.png`;
            link.href = dataUrl;
            link.click();
            ui.notifications.info("图片导出成功！");

        } catch (err) {
            console.error("生成图片失败:", err);
            ui.notifications.error("图片生成失败！请按 F12 查看控制台。");
        } finally {
            // 7. 销毁离屏容器，释放内存
            offScreenContainer.remove();
        }
    }

    /**
     * 将容器内的 FontAwesome 字体图标转换为真实 <img> 标签
     * 解决由于跨域或 CSS 路径解析失败导致的截图图标丢失问题
     */
    async _replaceIconsWithImages(container) {
        const icons = container.querySelectorAll('i.fas, i.far, i.fab, i.fal, i.fad, i.fa');

        for (let icon of icons) {
            const compStyle = window.getComputedStyle(icon, '::before');
            const content = compStyle.content;

            if (!content || content === 'none' || content === 'normal') continue;

            let charCode;
            try {
                // 解析 CSS content 返回的 unicode 字符串 (例如 '"\\f02d"')
                charCode = JSON.parse(content);
            } catch (e) {
                charCode = content.replace(/['"]/g, '');
            }

            const fontSize = parseFloat(compStyle.fontSize) || 16;
            const color = compStyle.color;
            const fontFamily = compStyle.fontFamily;
            const fontWeight = compStyle.fontWeight;

            // 创建临时画布绘制图标
            const canvas = document.createElement('canvas');
            const size = fontSize * 1.25; // 预留安全区防止裁切边界
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(charCode, size / 2, size / 2);

            // 将画布转化为图片节点
            const img = document.createElement('img');
            img.src = canvas.toDataURL('image/png');
            img.style.width = `${size}px`;
            img.style.height = `${size}px`;
            img.style.display = 'inline-block';
            img.style.verticalAlign = 'middle';

            const parentStyle = window.getComputedStyle(icon);
            const offset = (size - fontSize) / 2;

            // 使用负边界抵消画布留白，确保文字排版流不受影响
            img.style.margin = `0 -${offset}px`;
            img.style.marginLeft = `calc(${parentStyle.marginLeft} - ${offset}px)`;
            img.style.marginRight = `calc(${parentStyle.marginRight} - ${offset}px)`;

            // 节点替换
            icon.replaceWith(img);
        }
    }

    /**
     * 清洗富文本数据，移除 FVTT 的隐藏标签和首尾空行
     */
    _cleanRichText(htmlStr) {
        if (!htmlStr) return "";
        let res = htmlStr;
        res = res.replace(/<prose-mirror[^>]*>/gi, '');
        res = res.replace(/<\/prose-mirror>/gi, '');
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

        // 基础信息
        let sectKey = system.info.sect || "无门派";
        let sectDisplay = sectKey;
        if (CONFIG.XJZL?.sects?.[sectKey]) {
            sectDisplay = game.i18n.localize(CONFIG.XJZL.sects[sectKey]);
        } else {
            const locTry = game.i18n.localize(`XJZL.Sects.${this._capitalize(sectKey)}`);
            sectDisplay = !locTry.startsWith("XJZL") ? locTry : game.i18n.localize(sectKey);
        }

        const realmMap = { 0: "未入门", 1: "不堪一击", 2: "初窥门径", 3: "略有小成", 4: "融会贯通", 5: "炉火纯青", 6: "登峰造极", 7: "撼天动地" };
        const rLevel = system.cultivation.realmLevel || 0;

        const getAttitude = (val) => {
            if (!val || val === "none") return "无视";
            const fallback = { "zhonshi": "重视", "wushi": "无视" };
            let locKey = CONFIG.XJZL?.attitudes?.[val] || `XJZL.Attitudes.${this._capitalize(val)}`;
            let translated = game.i18n.localize(locKey);
            return (!translated.startsWith("XJZL")) ? translated : (fallback[val] || val);
        };

        // 1. 基础信息
        context.basic = {
            name: actor.name,
            img: actor.img,
            sect: sectDisplay,
            realmLevel: realmMap[rLevel] || `境界 ${rLevel}`,
            background: actor.itemTypes.background?.[0]?.name || "无",
            personality: actor.itemTypes.personality?.[0]?.name || "无",
            xiayi: system.social.xiayi || 0,
            exing: system.social.exing || 0,
            shalu: system.resources.shalu?.value || 0,
            shanie: system.resources.shanie || 0,
            repWulin: system.social.rep_wulin || 0,
            repChaoting: system.social.rep_chaoting || 0,
            attWulin: getAttitude(system.social.attitude_wulin),
            attChaoting: getAttitude(system.social.attitude_chaoting),
            attShisu: getAttitude(system.social.attitude_shisu),
            hpMax: system.resources.hp.max,
            mpMax: system.resources.mp.max
        };

        // 核心属性
        const statKeys = ["liliang", "shenfa", "tipo", "wuxing", "neixi", "qigan", "shencai"];
        context.stats = statKeys.map(key => ({
            label: game.i18n.localize(`XJZL.Stats.${this._capitalize(key)}`),
            value: system.stats[key].total
        }));

        // 通过借用 Actor 的方法直接测算普攻伤害
        let basicAttackDamage = 0;
        try {
            const weapon = actor.itemTypes.weapon.find(i => i.system.equipped);
            const weaponType = weapon ? weapon.system.type : "unarmed";
            const baseDamage = weapon ? (weapon.system.damage || 0) : 0;
            // 构建虚拟招式对象喂给测算函数
            const mockMove = { name: "普通攻击", type: "basic", damageType: "waigong", weaponType: weaponType };
            const mockItem = { id: "basic", name: "普通攻击", type: "basic", getFlag: () => null, flags: {} };
            const calcRes = actor._calculateBasicAttackDamage(mockMove, baseDamage, { bonusDamage: 0 }, "basic", 0, mockItem);
            basicAttackDamage = calcRes ? calcRes.damage : 0;
        } catch (e) {
            console.warn("预览计算普攻伤害失败:", e);
        }

        // 2. 战斗属性 (修改为3行4列排版顺序，并加入普攻伤害)
        context.combat = [
            { label: "移动速度", value: system.combat.speedTotal },
            { label: "先攻", value: system.combat.initiativeTotal },
            { label: "闪避", value: system.combat.dodgeTotal },
            { label: "格挡", value: system.combat.blockTotal },

            { label: "外功命中", value: system.combat.hitWaigongTotal },
            { label: "外功防御", value: system.combat.defWaigongTotal },
            { label: "外功暴击", value: system.combat.critWaigongTotal },
            { label: "看破", value: system.combat.kanpoTotal },

            { label: "内功命中", value: system.combat.hitNeigongTotal },
            { label: "内功防御", value: system.combat.defNeigongTotal },
            { label: "内功暴击", value: system.combat.critNeigongTotal },
            { label: "普攻伤害", value: basicAttackDamage }
        ];

        // 生活技能
        const allSkillGroups = [
            { key: "wuxing", label: "悟性", skills: ["wuxue", "jianding", "bagua", "shili"] },
            { key: "liliang", label: "力量", skills: ["jiaoli", "zhengtuo", "paozhi", "qinbao"] },
            { key: "shenfa", label: "身法", skills: ["qianxing", "qiaoshou", "qinggong", "mashu"] },
            { key: "tipo", label: "体魄", skills: ["renxing", "biqi", "rennai", "ningxue"] },
            { key: "neixi", label: "内息", skills: ["liaoshang", "chongxue", "lianxi", "duqi"] },
            { key: "qigan", label: "气感", skills: ["dianxue", "zhuizong", "tancha", "dongcha"] },
            { key: "shencai", label: "神采", skills: ["jiaoyi", "qiman", "shuofu", "dingli"] }
        ];

        context.skillGroups = allSkillGroups.map(group => ({
            label: group.label,
            skills: group.skills.map(sk => ({
                name: game.i18n.localize(CONFIG.XJZL.skills[sk] || sk),
                value: system.skills[sk]?.total || 0
            }))
        }));

        // 技艺
        const artsList = [];
        for (const [key, artData] of Object.entries(system.arts || {})) {
            if (artData.total > 0) {
                const labelKey = CONFIG.XJZL?.arts?.[key] || `XJZL.Arts.${this._capitalize(key)}`;
                artsList.push({ name: game.i18n.localize(labelKey), value: artData.total });
            }
        }
        context.arts = artsList;

        // 运行内功
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

        // 常用招式梳理
        const pinnedList = actor.getFlag("xjzl-system", "pinnedMoves") || [];
        const pinnedSet = new Set(pinnedList);
        const wuxueGroups = [];
        // 招式等级映射表
        const levelNames = ["未入门", "领悟", "掌握", "精通", "合一"];

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

                        let feintValue = m.baseFeint || 0;

                        if (m.type === "feint") {
                            // 武器等级加成 (同上逻辑)
                            let wRankVal = 0;
                            if (m.weaponType && actor.system.combat?.weaponRanks) {
                                wRankVal = actor.system.combat.weaponRanks[m.weaponType]?.total || 0;
                            }

                            const actorBonus = actor.system.combat.xuzhaoTotal || 0;
                            feintValue = feintValue + wRankVal + actorBonus;
                        }

                        // 安全获取招式等级对应名称 (防止越界)
                        const stageIndex = Math.min(4, Math.max(0, m.computedLevel || 0));

                        return {
                            name: m.name,
                            levelName: levelNames[stageIndex],
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
                            feintValue: feintValue,
                            damage: derived.damage,
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