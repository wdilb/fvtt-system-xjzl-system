import { xjzlSocket } from "../socket.mjs";

/**
 * 战斗统计数据管理器
 * 职责: 监听埋点数据、处理并发、内存聚合、网络同步与多场次管理
 */
export class CombatStatsManager {
    static _activeStats = null;   // 当前战斗统计的内存数据池 (平时 或 某场战斗)
    static _history = [];         // 历史战斗记录内存池 (最多保留5场)
    static _viewingId = "current";// UI当前正在查看的场次ID (默认 current)
    static _debouncedSync = null; // 防抖同步器 (节流网络与重绘开销)

    /**
     * 初始化系统监听
     */
    static init() {
        // 监听核心战斗流程与脚本产生的数据
        Hooks.on("xjzl.combatStatRecord", this.onCombatStatRecord.bind(this));
        Hooks.on("xjzl.scriptDamageDealt", this.onCombatStatRecord.bind(this));
        Hooks.on("xjzl.scriptHealingApplied", this.onCombatStatRecord.bind(this));

        // 监听战斗系统的生命周期
        Hooks.on("combatStart", this.onCombatStart.bind(this));
        Hooks.on("deleteCombat", this.onCombatDelete.bind(this));

        // 性能核心：建立 200ms 的防抖节流阀
        // 确保 AOE 瞬间产生的大量数据只引发一次全网广播和 UI 重绘
        this._debouncedSync = foundry.utils.debounce(() => {
            if (!this._activeStats) return;
            Hooks.callAll("xjzl.combatStatsUpdated"); // 触发本机UI刷新

            if (game.user.isGM && xjzlSocket) {
                // GM 将当前内存数据广播给所有玩家
                xjzlSocket.executeForOthers("broadcastCombatStats", this.exportSyncData());
            }
        }, 200);
    }

    /**
     * 处理重连与数据读取
     */
    static async ready() {
        console.log("XJZL Stats | 正在初始化战斗统计数据...");
        if (game.user.isGM) {
            // GM: 从本地设置中读取上次保存的统计数据
            const savedData = game.settings.get("xjzl-system", "combatStatsStorage") || null;
            if (savedData && savedData.active) {
                this._activeStats = savedData.active;
                this._history = savedData.history || [];
                console.log("XJZL Stats | 成功从数据库恢复战斗统计记录。");
            } else {
                this._resetActiveStats("平时 (非战斗)", "free-roam");
            }
        } else {
            // 玩家: 登录时向 GM 索要最新的内存数据
            if (xjzlSocket) {
                const data = await xjzlSocket.executeAsGM("requestCombatStats");
                if (data) {
                    this.importSyncData(data);
                    console.log("XJZL Stats | 成功从主机同步战斗统计记录。");
                }
            }
        }
        // 触发 UI 刷新
        Hooks.callAll("xjzl.combatStatsUpdated");
    }

    /* -------------------------------------------- */
    /*  多场次管理与同步                              */
    /* -------------------------------------------- */

    /** 
     * 初始化或重置当前活动数据 
     * @param {string} name - 场次名称
     * @param {string} id - 场次ID (战斗ID或 free-roam)
     */
    static _resetActiveStats(name, id = "current") {
        this._activeStats = {
            id: id,
            name: name,
            startTime: Date.now(),
            actors: {}
        };
    }

    /** 将当前 active 归档到 history 内存中，并保留最多5条 */
    static _archiveCurrentStats() {
        // 只有当产生过实际数据时，才值得归档
        if (this._activeStats && Object.keys(this._activeStats.actors).length > 0) {
            // 使用 JSON 深拷贝断开内存引用，防止后续修改污染历史数据
            this._history.unshift(foundry.utils.deepClone(this._activeStats));
            if (this._history.length > 5) this._history.pop();
        }
    }

    /** 
     * 将当前内存数据写入持久化数据库，防止刷新丢失
     * 此操作仅 GM 可执行
     */
    static async _saveToStorage() {
        if (!game.user.isGM) return;
        await game.settings.set("xjzl-system", "combatStatsStorage", {
            active: this._activeStats,
            history: this._history
        });
    }

    /** 导出用于 Socket 同步的数据包 */
    static exportSyncData() {
        return { active: this._activeStats, history: this._history };
    }

    /** 导入 Socket 数据包 (非 GM 玩家接收使用) */
    static importSyncData(data) {
        this._activeStats = data.active;
        this._history = data.history;
    }

    /** 获取当前 UI 应该渲染的数据源 (根据顶部下拉框选择) */
    static getViewingStats() {
        if (!this._activeStats) return null;
        if (this._viewingId === "current") return this._activeStats;
        return this._history.find(h => h.id === this._viewingId) || this._activeStats;
    }

    /* -------------------------------------------- */
    /*  生命周期控制                                  */
    /* -------------------------------------------- */

    static onCombatStart(combat, updateData) {
        if (!game.user.isGM || !game.settings.get("xjzl-system", "enableCombatStats")) return;

        console.log(`XJZL | 战斗统计引擎启动 [Combat ID: ${combat.id}]`);

        // 战斗开始：把刚刚的“平时”归档，开启新战斗
        this._archiveCurrentStats();
        const timeStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        this._resetActiveStats(`战斗 - ${timeStr}`, combat.id);

        this._viewingId = "current"; // 自动切回当前视角

        // 保存快照到数据库
        this._saveToStorage();
        if (this._debouncedSync) this._debouncedSync();
    }

    static async onCombatDelete(combat, options, userId) {
        if (!game.user.isGM || !this._activeStats || this._activeStats.id !== combat.id) return;

        console.log(`XJZL | 战斗结束，归档统计数据 [Combat ID: ${combat.id}]`);

        // 战斗结束：把刚刚的“战斗”归档，重新开启“平时”
        this._archiveCurrentStats();
        this._resetActiveStats("平时 (非战斗)", "free-roam");

        this._viewingId = "current"; // 保持查看当前状态

        // 保存快照到数据库，并等待完成
        await this._saveToStorage();
        if (this._debouncedSync) this._debouncedSync();
    }

    static clearData() {
        if (!game.user.isGM) return;

        // 清空内存数据
        this._history = [];
        this._resetActiveStats("平时 (非战斗)", "free-roam");
        this._viewingId = "current";

        // 覆盖清空数据库里的历史数据
        this._saveToStorage();

        if (this._debouncedSync) this._debouncedSync();
        console.log("XJZL Stats | 战斗统计数据已被 GM 手动清空。");
    }

    /* -------------------------------------------- */
    /*  数据接收与路由                                */
    /* -------------------------------------------- */

    static onCombatStatRecord(data) {
        if (!game.settings.get("xjzl-system", "enableCombatStats")) return;

        // 无权限客户端直接委托给 GM，利用 Socket 绕过数据库
        if (!game.user.isGM) {
            xjzlSocket.executeAsGM("recordCombatStat", data);
            return;
        }
        this.processStatRecord(data);
    }

    static processStatRecord(data) {
        // 兜底设计: 允许非战斗追踪器状态下 (如自由切磋) 的数据记录
        if (!this._activeStats) {
            this._resetActiveStats("平时 (非战斗)", "free-roam");
        }

        const sourceUuid = this._getUuid(data.attacker || data.healer, "env_unknown");
        const entity = this._getOrInitEntity(sourceUuid);

        switch (data.eventType) {
            case "damage": this._handleDamage(entity, data); break;
            case "healing": this._handleHealing(entity, data); break;
            case "cast": this._handleCast(entity, data); break;
            case "kanpo": this._handleKanpo(data); break;
            case "script_damage": this._handleScriptDamage(entity, data); break;
            case "script_healing": this._handleScriptHealing(entity, data); break;
        }

        if (this._debouncedSync) this._debouncedSync();
    }

    /* -------------------------------------------- */
    /*  私有辅助方法 (实体与技能获取)                 */
    /* -------------------------------------------- */

    /** 安全提取对象的 UUID */
    static _getUuid(target, fallback = null) {
        if (!target) return fallback;
        return typeof target === "string" ? target : target.uuid;
    }

    static _getOrInitEntity(actorUuid) {
        // 注意：底层记录永远写入 _activeStats，不受 UI 视角 _viewingId 影响
        if (!this._activeStats.actors[actorUuid]) {
            let name = "环境 / 未知来源";
            let img = "icons/svg/hazard.svg";
            let isEnv = true;

            if (actorUuid !== "env_unknown") {
                const doc = fromUuidSync(actorUuid);
                const actor = doc?.actor || doc;
                if (actor) {
                    name = actor.name;
                    img = actor.img;
                    isEnv = false;
                }
            }

            this._activeStats.actors[actorUuid] = {
                uuid: actorUuid,
                name: name,
                img: img,
                isEnvironment: isEnv,
                // 扩充了 summary 以支持更多维度的全局排行
                summary: {
                    damageDealt: 0,
                    healingDealt: 0,
                    damageTaken: 0,
                    hutiAbsorbed: 0,
                    brokenStanceDealt: 0, // 破架次数
                    mpSpent: 0,           // 内力消耗
                    rageSpent: 0,         // 怒气消耗
                    castsDealt: 0         // 施展次数
                },
                skills: {},
                defense: { dodges: 0, kanpoSuccess: 0, kanpoFailed: 0, brokenCount: 0, dyingCount: 0 }
            };
        }
        return this._activeStats.actors[actorUuid];
    }

    static _getOrInitSkill(entity, moveId, moveName, source, damageType, img = null) {
        // 将 damageType 编入唯一 Key，确保同名同源但不同伤害类型的招式被分开统计
        const safeMoveId = moveId || "unknown";
        const safeDamageType = damageType || "none";
        const finalKey = `${source}_${safeMoveId}_${safeDamageType}`;

        let finalName = moveName || "未知招式";
        let type = source;

        // 根据来源自动重构技能命名与分类
        if (source === "script") {
            // 确保特效的名称始终带上前缀，直接截断不再拼接冗长后缀
            finalName = `[特效] ${finalName}`;
        } else if (source === "extra" || source === "dot" || !moveId) {
            if (["hp", "mp", "neili", "rage", "huti"].includes(damageType)) {
                const labelMap = { hp: "气血", mp: "内力", neili: "内力", rage: "怒气", huti: "护体" };
                finalName = `基础恢复/消耗 (${labelMap[damageType] || damageType.toUpperCase()})`;
            } else {
                const typeLabel = game.i18n.localize(CONFIG.XJZL.damageTypes?.[damageType]) || damageType;
                finalName = `附加效果/状态 (${typeLabel})`;
            }
            type = "extra";
        }

        if (!entity.skills[finalKey]) {
            entity.skills[finalKey] = {
                id: finalKey,
                name: finalName,
                img: img,
                type: type,
                damageType: damageType,
                casts: 0, hits: 0, misses: 0, crits: 0, brokenStance: 0,
                damage: 0, healing: 0, overheal: 0,
                cost: { mp: 0, hp: 0, rage: 0, morale: 0 },
                targets: {}
            };
        }
        return entity.skills[finalKey];
    }

    static _getOrInitTarget(skill, targetUuid) {
        if (!skill.targets[targetUuid]) {
            let name = "未知目标";
            let img = "icons/svg/mystery-man.svg";
            const doc = fromUuidSync(targetUuid);
            const actor = doc?.actor || doc;
            if (actor) {
                name = actor.name;
                img = actor.img; // 抓取目标头像
            }

            skill.targets[targetUuid] = {
                name: name,
                img: img, // 保存头像
                damage: 0,
                healing: 0,
                overheal: 0, // 新增目标过量治疗
                hits: 0,
                crits: 0,
                broken: 0
            };
        }
        return skill.targets[targetUuid];
    }

    /* -------------------------------------------- */
    /*  核心事件聚合处理器                            */
    /* -------------------------------------------- */

    static _handleDamage(entity, data) {
        const img = data.item?.img || data.sourceItem?.img || null;
        const skill = this._getOrInitSkill(entity, data.move?.id, data.move?.name, data.source, data.damageType, img);
        const amount = Number(data.amount) || 0;

        // 如果是脚本特效或附加伤害，没有走_handleCast，会导致次数为0，在此处隐式补偿
        if (["script", "extra", "dot"].includes(data.source)) {
            skill.casts += 1;
            entity.summary.castsDealt += 1;
        }

        // 攻击方汇总
        entity.summary.damageDealt += amount;

        // 防御方汇总
        const defUuid = this._getUuid(data.defender);
        if (defUuid) {
            const defEntity = this._getOrInitEntity(defUuid);
            defEntity.summary.damageTaken += amount;
            defEntity.summary.hutiAbsorbed += (Number(data.hutiLost) || 0);
            if (data.isHit === false) defEntity.defense.dodges += 1;
            if (data.isDying) defEntity.defense.dyingCount += 1;

            // 目标被破防/破架
            if (data.isBroken) {
                defEntity.defense.brokenCount += 1;
                entity.summary.brokenStanceDealt += 1; // [新增统计] 施法者破架次数增加
                skill.brokenStance += 1; // 技能破架次数增加
            }
        }

        // 技能表现汇总
        if (data.isHit) {
            skill.hits += 1;
            skill.damage += amount;
            if (data.isCrit) skill.crits += 1;

            if (defUuid) {
                const targetRecord = this._getOrInitTarget(skill, defUuid);
                targetRecord.hits += 1;
                targetRecord.damage += amount;
                if (data.isCrit) targetRecord.crits += 1;
                if (data.isBroken) targetRecord.broken += 1;
            }
        } else {
            skill.misses += 1;
        }
    }

    static _handleHealing(entity, data) {
        const source = data.source || "extra";
        const img = data.item?.img || data.sourceItem?.img || null;
        const skill = this._getOrInitSkill(entity, data.move?.id, data.move?.name, source, data.healType, img);

        const amount = Number(data.amount) || 0;     // 有效治疗
        const overflow = Number(data.overflow) || 0; // 过量治疗
        const totalHeal = amount + overflow;         // 总治疗

        // 隐式补偿脚本和额外恢复的施展次数
        if (["script", "extra", "dot"].includes(source)) {
            skill.casts += 1;
            entity.summary.castsDealt += 1;
        }

        // 只要有总治疗产生，就予以记录
        if (totalHeal <= 0) return;

        entity.summary.healingDealt += amount; // 全局排行榜依然主要看“有效治疗”

        skill.healing += amount;
        skill.overheal += overflow;

        const tgtUuid = this._getUuid(data.target);
        if (tgtUuid) {
            const targetRecord = this._getOrInitTarget(skill, tgtUuid);
            targetRecord.healing += amount;
            targetRecord.overheal += overflow;
            targetRecord.hits += 1; // 治疗算必中
            skill.hits += 1;
        }
    }

    static _handleCast(entity, data) {
        const img = data.item?.img || null;

        // 从 move 数据中准确推断 source 和 damageType，以匹配伤害统计时的唯一 Key
        const source = (data.move?.type === "basic") ? "basic" : "move";
        const damageType = data.move?.damageType || "none";

        const skill = this._getOrInitSkill(entity, data.move?.id, data.move?.name, source, damageType, img);

        // 全局及技能施展次数
        skill.casts += 1;
        entity.summary.castsDealt += 1;

        if (data.cost) {
            const mpSpent = Number(data.cost.mp) || 0;
            const rageSpent = Number(data.cost.rage) || 0; // 解析怒气消耗

            skill.cost.mp += mpSpent;
            skill.cost.rage += rageSpent;
            skill.cost.hp += (Number(data.cost.hp) || 0);
            skill.cost.morale += (Number(data.cost.morale) || 0);

            entity.summary.mpSpent += mpSpent; // 全局蓝耗汇总
            entity.summary.rageSpent += rageSpent; // 全局怒气汇总
        }
    }

    static _handleKanpo(data) {
        const defUuid = this._getUuid(data.defender);
        if (!defUuid) return;

        const defEntity = this._getOrInitEntity(defUuid);
        if (data.isBroken) defEntity.defense.kanpoFailed += 1;
        else defEntity.defense.kanpoSuccess += 1;
    }

    static _handleScriptDamage(entity, data) {
        const normalizedData = {
            move: { id: data.sourceItem?.id || "script", name: data.sourceName || "脚本特效" },
            item: { img: data.sourceItem?.img },
            source: "script",
            damageType: data.damageType,
            amount: data.result?.finalDamage || 0,
            hutiLost: data.result?.hutiLost || 0,
            mpLost: data.result?.mpLost || 0,
            isHit: data.result?.isHit ?? true,
            isCrit: false,
            isBroken: false,
            isDying: data.result?.isDying || false,
            defender: data.defender
        };
        this._handleDamage(entity, normalizedData);
    }

    static _handleScriptHealing(entity, data) {
        const normalizedData = {
            move: { id: data.sourceItem?.id || "script", name: data.sourceName || "脚本特效" },
            item: { img: data.sourceItem?.img },
            source: "script",
            healType: data.healType,
            amount: data.result?.actualHeal || 0,
            overflow: data.result?.overflow || 0,
            isBlocked: data.result?.isBlocked || false,
            target: data.target
        };
        this._handleHealing(entity, normalizedData);
    }

    /* -------------------------------------------- */
    /*  视图数据输出接口 (Public Output)              */
    /* -------------------------------------------- */

    /** 根据伤害类型返回固定颜色 */
    static _getDamageTypeColor(damageType) {
        const colors = {
            waigong: "#f39c12", // 橙黄 (外功)
            neigong: "#2980b9", // 蓝色 (内功)
            bleed: "#c0392b", // 深红 (流血)
            poison: "#27ae60", // 绿色 (毒素)
            mental: "#8e44ad", // 紫色 (精神)
            fire: "#d35400", // 橙红 (火焰)
            liushi: "#8b0000", // 暗红 (流失/真实伤害)
            none: "#7f8c8d", // 灰色 (无/气招)
            hp: "#2ecc71", // 亮绿 (治疗气血)
            mp: "#3498db", // 亮蓝 (回复内力)
            huti: "#00ffff"  // 青色 (护体)
        };
        return colors[damageType] || "#95a5a6"; // 兜底灰色
    }

    /**
     * 获取用于渲染排行榜的结构化数据
     * 提供真正的比例计算，`barPercent` 算背景条，`textPercent` 算真实占比。
     */
    static getMeterData(metric = "damageDealt") {
        // 读取当前下拉框选中的场次
        const viewStats = this.getViewingStats();
        if (!viewStats) return [];

        const rows = [];
        let maxVal = 0;
        let totalSum = 0;

        for (const [uuid, entity] of Object.entries(viewStats.actors)) {
            const val = entity.summary[metric] || 0;
            if (val <= 0) continue;

            if (val > maxVal) maxVal = val;
            totalSum += val;

            rows.push({
                uuid: uuid,
                name: entity.name,
                img: entity.img,
                value: val,
                isEnv: entity.isEnvironment
            });
        }

        if (rows.length === 0) return [];
        rows.sort((a, b) => b.value - a.value);

        // 装饰与双轨百分比
        rows.forEach((row, index) => {
            // 背景填充比例：相对于最高者 (保证榜首视觉拉满)
            row.barPercent = maxVal > 0 ? Math.round((row.value / maxVal) * 100) : 0;
            // 文本显示比例：相对于全体总和 (保留一位小数)
            row.textPercent = totalSum > 0 ? ((row.value / totalSum) * 100).toFixed(1) : "0.0";

            row.rank = index + 1;
            if (row.isEnv) {
                row.color = "#7f8c8d";
            } else {
                const colors = ["#c0392b", "#d35400", "#f39c12", "#27ae60", "#2980b9", "#8e44ad"];
                row.color = colors[index % colors.length];
            }
        });

        return rows;
    }

    /**
     * 获取 Level 2: 某角色所有技能的数据排行
     */
    static getActorSkillsData(actorUuid, metric = "damageDealt") {
        const viewStats = this.getViewingStats();
        if (!viewStats) return null;

        const rows = [];
        let maxVal = 0;
        let totalSum = 0;
        let targetActorName = viewStats.actors[actorUuid]?.name || "未知";

        if (metric === "damageTaken") {
            for (const [atkUuid, attackerEntity] of Object.entries(viewStats.actors)) {
                for (const [skillKey, skill] of Object.entries(attackerEntity.skills)) {
                    const targetData = skill.targets[actorUuid];
                    if (targetData && targetData.damage > 0) {
                        const val = targetData.damage;
                        if (val > maxVal) maxVal = val;
                        totalSum += val;

                        rows.push({
                            id: `${atkUuid}_${skillKey}`,
                            name: `${attackerEntity.name} ➔ ${skill.name}`,
                            img: skill.img || attackerEntity.img,
                            value: val,
                            type: skill.type,
                            damageType: skill.damageType
                        });
                    }
                }
            }
        } else {
            const entity = viewStats.actors[actorUuid];
            if (!entity) return null;

            // 映射目标字段
            let targetField = "damage";
            if (metric === "healingDealt") targetField = "healing";
            else if (metric === "brokenStanceDealt") targetField = "brokenStance";
            else if (metric === "mpSpent") targetField = "cost.mp";
            else if (metric === "rageSpent") targetField = "cost.rage"; // 怒气映射
            else if (metric === "castsDealt") targetField = "casts";

            for (const [skillKey, skill] of Object.entries(entity.skills)) {
                // 处理嵌套字段 (如 cost.mp)
                const val = targetField.includes(".") ?
                    foundry.utils.getProperty(skill, targetField) : skill[targetField];

                if (!val || val <= 0) continue;
                if (val > maxVal) maxVal = val;
                totalSum += val;

                rows.push({
                    id: skillKey,
                    name: skill.name,
                    img: skill.img,
                    value: val,
                    type: skill.type,
                    damageType: skill.damageType
                });
            }
        }

        if (rows.length === 0) return null;
        rows.sort((a, b) => b.value - a.value);

        rows.forEach((row, index) => {
            row.barPercent = maxVal > 0 ? Math.round((row.value / maxVal) * 100) : 0;
            row.textPercent = totalSum > 0 ? ((row.value / totalSum) * 100).toFixed(1) : "0.0";
            row.rank = index + 1;
            // 采用固定颜色映射
            row.color = this._getDamageTypeColor(row.damageType);
        });

        return { actorName: targetActorName, rows: rows };
    }

    /**
     * 获取 Level 3: 特定技能的详细统计与目标分布
     */
    static getSkillDetailsData(actorUuid, skillId, metric = "damageDealt") {
        const viewStats = this.getViewingStats();
        if (!viewStats) return null;

        const entity = viewStats.actors[actorUuid];
        if (!entity) return null;

        const skill = entity.skills[skillId];
        if (!skill) return null;

        // 1. 核心数据推算
        const totalAttempts = skill.hits + skill.misses;
        const hitRate = totalAttempts > 0 ? Math.round((skill.hits / totalAttempts) * 100) : 0;
        const critRate = skill.hits > 0 ? Math.round((skill.crits / skill.hits) * 100) : 0;
        const avgDamage = skill.hits > 0 ? Math.round(skill.damage / skill.hits) : 0;

        // 2. 构造目标分布列表
        const targetRows = [];
        let maxVal = 0;
        let totalSum = 0;

        let targetField = "damage";
        if (metric === "healingDealt") targetField = "healing";
        else if (metric === "brokenStanceDealt") targetField = "broken";
        // 耗蓝、怒气等不统计目标，强制为空
        const skipTargets = ["mpSpent", "rageSpent", "castsDealt"].includes(metric);

        if (!skipTargets) {
            for (const [targetUuid, targetData] of Object.entries(skill.targets)) {
                const val = targetData[targetField] || 0;
                // 治疗时，如果总治疗>0也要展示，方便看过量治疗
                const totalHealForTarget = targetData.healing + targetData.overheal;
                if (val <= 0 && !(metric === "healingDealt" && totalHealForTarget > 0)) continue;

                const displayVal = metric === "healingDealt" ? totalHealForTarget : val;

                if (displayVal > maxVal) maxVal = displayVal;
                totalSum += displayVal;

                targetRows.push({
                    id: targetUuid,
                    name: targetData.name,
                    img: targetData.img, // 传入目标头像
                    value: val,          // 有效值
                    displayVal: displayVal, // 显示用总值
                    overheal: targetData.overheal, // 携带过量治疗
                    hits: targetData.hits,
                    crits: targetData.crits,
                    broken: targetData.broken
                });
            }

            targetRows.sort((a, b) => b.displayVal - a.displayVal);
            targetRows.forEach((row, index) => {
                row.barPercent = maxVal > 0 ? Math.round((row.displayVal / maxVal) * 100) : 0;
                row.textPercent = totalSum > 0 ? ((row.displayVal / totalSum) * 100).toFixed(1) : "0.0";
                row.rank = index + 1;
                row.color = "#7f8c8d"; // 目标层级统一颜色
            });
        }

        return {
            skillName: skill.name,
            img: skill.img,
            damageTypeLabel: game.i18n.localize(CONFIG.XJZL.damageTypes[skill.damageType] || skill.damageType),
            stats: {
                casts: skill.casts,
                hits: skill.hits,
                misses: skill.misses,
                hitRate: hitRate,
                critRate: critRate,
                totalBroken: skill.brokenStance,
                avgDamage: avgDamage,
                // 治疗专供数据
                healing: skill.healing,
                overheal: skill.overheal,
                totalHeal: skill.healing + skill.overheal
            },
            targets: targetRows
        };
    }
}