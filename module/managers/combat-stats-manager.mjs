import { xjzlSocket } from "../socket.mjs";

/**
 * 战斗统计数据管理器 (Combat Stats Manager)
 * 职责: 监听埋点数据、处理并发、内存聚合、网络同步与数据库归档
 */
export class CombatStatsManager {
    static _activeStats = null;   // 当前战斗统计的内存数据池
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
                xjzlSocket.executeForOthers("broadcastCombatStats", this._activeStats);
            }
        }, 200);
    }

    /* -------------------------------------------- */
    /*  生命周期控制                                  */
    /* -------------------------------------------- */

    static onCombatStart(combat, updateData) {
        if (!game.user.isGM || !game.settings.get("xjzl-system", "enableCombatStats")) return;

        this._activeStats = {
            combatId: combat.id,
            startTime: Date.now(),
            actors: {}
        };
        console.log(`XJZL | 战斗统计引擎启动 [Combat ID: ${combat.id}]`);
    }

    static async onCombatDelete(combat, options, userId) {
        if (!game.user.isGM || !this._activeStats || this._activeStats.combatId !== combat.id) return;

        console.log(`XJZL | 战斗结束，归档统计数据 [Combat ID: ${combat.id}]`);
        await combat.setFlag("xjzl-system", "combatStats", this._activeStats);
        this._activeStats = null;
    }

    static clearData() {
        if (!game.user.isGM || !this._activeStats) return;

        this._activeStats.actors = {};
        this._activeStats.startTime = Date.now();
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
            this._activeStats = {
                combatId: "free-roam",
                startTime: Date.now(),
                actors: {}
            };
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
                summary: { damageDealt: 0, healingDealt: 0, damageTaken: 0, hutiAbsorbed: 0 },
                skills: {},
                defense: { dodges: 0, kanpoSuccess: 0, kanpoFailed: 0, brokenCount: 0, dyingCount: 0 }
            };
        }
        return this._activeStats.actors[actorUuid];
    }

    static _getOrInitSkill(entity, moveId, moveName, source, damageType) {
        let finalKey = moveId;
        let finalName = moveName || "未知招式";
        let type = source;

        // 根据来源自动重构技能命名与分类
        if (source === "script") {
            finalKey = `script_${moveId}`;
            finalName = `[特效] ${finalName} (${game.i18n.localize(CONFIG.XJZL.damageTypes[damageType] || damageType)})`;
        } else if (source === "extra" || source === "dot" || !moveId) {
            finalKey = `extra_${damageType}`;
            finalName = `附加效果/状态 (${game.i18n.localize(CONFIG.XJZL.damageTypes[damageType] || damageType)})`;
            type = "extra";
        }

        if (!entity.skills[finalKey]) {
            entity.skills[finalKey] = {
                id: finalKey,
                name: finalName,
                type: type,
                damageType: damageType,
                casts: 0, hits: 0, misses: 0, crits: 0,
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
            const doc = fromUuidSync(targetUuid);
            const actor = doc?.actor || doc;
            if (actor) name = actor.name;

            skill.targets[targetUuid] = {
                name: name,
                damage: 0,
                healing: 0,
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
        const skill = this._getOrInitSkill(entity, data.move?.id, data.move?.name, data.source, data.damageType);
        const amount = Number(data.amount) || 0;

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
            if (data.isBroken) defEntity.defense.brokenCount += 1;
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
        const skill = this._getOrInitSkill(entity, data.move?.id, data.move?.name, "move", data.healType);
        const amount = Number(data.amount) || 0;

        entity.summary.healingDealt += amount;
        skill.healing += amount;
        skill.overheal += (Number(data.overflow) || 0);

        const tgtUuid = this._getUuid(data.target);
        if (tgtUuid && amount > 0) {
            const targetRecord = this._getOrInitTarget(skill, tgtUuid);
            targetRecord.healing += amount;
            targetRecord.hits += 1; // 治疗算必中
            skill.hits += 1;
        }
    }

    static _handleCast(entity, data) {
        const skill = this._getOrInitSkill(entity, data.move?.id, data.move?.name, "move", null);
        skill.casts += 1;

        if (data.cost) {
            skill.cost.mp += (Number(data.cost.mp) || 0);
            skill.cost.hp += (Number(data.cost.hp) || 0);
            skill.cost.rage += (Number(data.cost.rage) || 0);
            skill.cost.morale += (Number(data.cost.morale) || 0);
        }
    }

    static _handleKanpo(data) {
        const defUuid = this._getUuid(data.defender);
        if (!defUuid) return;

        const defEntity = this._getOrInitEntity(defUuid);
        if (data.isBroken) defEntity.defense.kanpoFailed += 1;
        else defEntity.defense.kanpoSuccess += 1;
    }

    /* -------------------------------------------- */
    /*  脚本事件转接层                                */
    /* -------------------------------------------- */

    static _handleScriptDamage(entity, data) {
        const normalizedData = {
            move: { id: data.sourceItem?.id || "script", name: data.sourceName || "脚本特效" },
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

    /**
     * 获取用于渲染排行榜的结构化数据
     * @param {string} metric 统计维度 (damageDealt / healingDealt / damageTaken)
     */
    static getMeterData(metric = "damageDealt") {
        if (!this._activeStats) return [];

        const rows = [];
        let maxVal = 0;

        for (const [uuid, entity] of Object.entries(this._activeStats.actors)) {
            const val = entity.summary[metric] || 0;
            if (val > maxVal) maxVal = val;

            rows.push({
                uuid: uuid,
                name: entity.name,
                img: entity.img,
                value: val,
                isEnv: entity.isEnvironment
            });
        }

        if (rows.length === 0) return [];

        // 降序排列
        rows.sort((a, b) => b.value - a.value);

        // 装饰与排版
        rows.forEach((row, index) => {
            row.percent = maxVal > 0 ? Math.round((row.value / maxVal) * 100) : 0;
            row.rank = index + 1;

            // 环境伤害标识灰色，前排特殊颜色
            if (row.isEnv) {
                row.color = "#7f8c8d";
            } else {
                const colors = ["#c0392b", "#d35400", "#f39c12", "#27ae60", "#2980b9", "#8e44ad"];
                row.color = colors[index % colors.length];
            }
        });

        return rows;
    }
}