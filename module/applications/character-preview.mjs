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
     * 导出角色长图
     * 采用离屏克隆与 Canvas 图标转换技术，避免与FVTT底层机制冲突
     */
    async _onExportImage(event) {
        event.preventDefault();

        // 1. 动态加载 html-to-image 截图引擎
        if (typeof htmlToImage === "undefined") {
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