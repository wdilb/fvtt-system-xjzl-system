/**
 * 光环管理器：光环 Region 的创建、销毁、查询与源生命周期。
 *
 * 职责划分：区域行为（xjzl-aura-behavior.mjs）只管"谁在范围内、何时结算"；
 * 源侧生命周期归本管理器——时限递减、维持消耗、脱战清理、孤儿校验，
 * 维持消耗仅在本管理器结算，区域行为不扣取资源。
 *
 * 生命周期入口：
 * ① 数据脚本时机（正常流，直接调 create/dismiss）；
 * ② 系统级 Foundry 钩子兜底（updateItem/deleteItem/updateActor 按
 *    region flags 的源映射清理；架招光环由 stopStance 直调）；
 * ③ 战斗结束清理绑定光环，ready 时校验孤儿实例。
 *
 * region flags `xjzl-system.aura` 持久化：label、lifecycle、源物品/Actor/Token
 * uuid、战斗 ID、到期轮次、维持状态与创建参数快照（refreshAura 重建依据）；
 * 施加账本与节流记录由 AuraLedger 维护。
 */

import {AuraLedger} from "./xjzl-aura-ledger.mjs";
import {generateCircleOffsets, generateRectangleOffsets, rotateOffsets90, snapDirectionToQuarterTurns, toCoreOffsets} from "../utils/aura-shapes.mjs";
import {xjzlSocket} from "../socket.mjs";

const FLAG_SCOPE = "xjzl-system";
const FLAG_AURA = "aura";
/** 光环默认颜色（核心 ColorField 初始值是随机色，业务上给可预期的默认）。 */
const DEFAULT_COLOR = "#40d0c0";
/** Token 坐标更新后的对账去抖窗口。 */
const RECONCILE_DEBOUNCE_MS = 500;

export class AuraManager {

    /** @type {Map<string, number>} updateToken 对账去抖计时器（按 token id）。 */
    static #reconcileTimers = new Map();
    /** @type {Set<string>} 维持消耗去重键 {combatId}:{round}:{turn}。 */
    static #consumedMaintenance = new Set();
    /** @type {Map<string, string|null>} 各战斗最近一次钩子观测的行动者 combatantId（维持扣取依据）。 */
    static #currentActors = new Map();
    /** @type {boolean} 钩子只注册一次。 */
    static #initialized = false;
    /** @type {Promise<void>} 并行创建会覆盖 Region 的 Token 包含跟踪，故串行创建。 */
    static #createChain = Promise.resolve();

    /* -------------------------------------------- */
    /*  钩子注册                                     */
    /* -------------------------------------------- */

    /**
     * 注册系统级钩子（主入口 init 调用一次）。
     * 所有钩子内部先做活动 GM 门控：region 的创建/删除与 flags 写入需要
     * GM 权限，且多 GM 在线时只允许活动 GM 单端结算。
     */
    static init() {
        if (this.#initialized) return;
        this.#initialized = true;

        // ---- 来源生命周期兜底 ----
        Hooks.on("updateItem", async (item, changes) => {
            if (!game.users.activeGM?.isSelf) return;
            // 装备光环卸下即毁；装备穿上的翻转不销毁
            if (foundry.utils.getProperty(changes, "system.equipped") === false) {
                await this.dismissBySource({sourceItemUuid: item.uuid, lifecycle: "equip"});
            }
        });
        Hooks.on("deleteItem", async item => {
            if (!game.users.activeGM?.isSelf) return;
            await this.dismissBySource({sourceItemUuid: item.uuid});
        });
        Hooks.on("updateActor", async (actor, changes) => {
            if (!game.users.activeGM?.isSelf) return;
            // 运功光环切换即毁：active_neigong 变化即视为切换/解除。
            // 运功光环的创建由数据脚本时机负责，此处只兜底销毁。
            if (foundry.utils.getProperty(changes, "system.martial.active_neigong") !== undefined) {
                await this.dismissBySource({sourceActorUuid: actor.uuid, lifecycle: "yungong"});
            }
        });

        // ---- 时限递减 / 维持消耗 / 战斗期清理 / 回合对账 ----
        // 滚轮推进至新轮时 combat.previous 可能为 null；保存上次观测的
        // combatantId，以便在 round 或 turn 变化时扣取推进前行动者的维持。
        Hooks.on("createCombat", combat => {
            if (!game.users.activeGM?.isSelf) return;
            this.#currentActors.set(combat.id, combat.combatant?.id ?? null);
        });
        Hooks.on("updateCombat", async (combat, updateData) => {
            if (!game.users.activeGM?.isSelf) return;
            const roundChanged = "round" in updateData;
            const turnChanged = "turn" in updateData;
            const prevActorId = this.#currentActors.get(combat.id) ?? null;
            if (roundChanged) await this.#tickDurations(combat);
            // 扣取触发用 round 或 turn 任一变化：单人（或连续行动者）回合
            // 轮转时核心只 update {round}、turn 键缺省，仅看 turn 会漏扣。
            if (turnChanged || roundChanged) await this.#consumeMaintenance(combat, prevActorId);
            // 轮边界补扫；事件已即时补正时无需写入
            if (roundChanged && (combat.round ?? 0) >= 1) await this.reconcileCombat(combat);
            // round 回 0（战斗面板关闭）也清战斗期光环
            if (roundChanged && (combat.round ?? 0) === 0) await this.#clearCombatAuras(combat.id);
            this.#currentActors.set(combat.id, combat.combatant?.id ?? null);
        });
        Hooks.on("deleteCombat", async combat => {
            if (!game.users.activeGM?.isSelf) return;
            this.#currentActors.delete(combat.id);
            await this.#clearCombatAuras(combat.id);
        });

        // ---- Token 坐标更新后的对账兜底 ----
        // 去抖比对覆盖与账本，补正未派发进出事件的更新路径。
        Hooks.on("updateToken", (tokenDoc, change) => {
            if (!game.users.activeGM?.isSelf) return;
            if (!("x" in change) && !("y" in change)) return;
            const timers = this.#reconcileTimers;
            clearTimeout(timers.get(tokenDoc.id));
            timers.set(tokenDoc.id, setTimeout(() => {
                timers.delete(tokenDoc.id);
                AuraLedger.reconcileToken(tokenDoc)
                    .catch(err => console.error("XJZL | 传送对账失败:", err));
            }, RECONCILE_DEBOUNCE_MS));
        });

        // ---- ready 孤儿校验 ----
        Hooks.once("ready", async () => {
            if (!game.user.isGM) return;
            await this.validateOrphans();
        });
    }

    /* -------------------------------------------- */
    /*  实例 API（公开，挂 game.xjzl.aura）           */
    /* -------------------------------------------- */

    /**
     * 创建光环 region（单实例标签：同 label 先删旧再建新）。
     * @param {TokenDocument|Token|Actor|{scene: Scene, x: number, y: number}} source
     *   光环源：跟随/定位型传 Token（或 Actor 取其活动 Token），放置型传场景像素坐标。
     * @param {object} params - 光环参数（形状同行为 schema 平铺字段，另有管理器字段）：
     *   {label(必填), displayName?, color?, follow?, radius, shapeKind, rectWidth, rectHeight,
     *    anchorX, anchorY, quarterTurns(number|"auto"), faction, includeSelf,
     *    payloadItemUuid?, payloadEffectName?, enterAction?, moveWithin?, throttlePerRound?,
     *    roundTiming?, roundAction?, exitClear?, enterEnabled?, roundEnabled?,
     *    durationRounds?, maintain?, lifecycle?, sourceActorUuid?, sourceItemUuid?, levelIds?}
     *   maintain: {resource("mp"/"hp"/…), amount(每回合固定), perTarget(每名覆盖敌人的追加消耗,
     *   如 20 表达"按人数×20")}
     * @returns {Promise<RegionDocument|null>} 创建的 region；无网格/参数非法返回 null
     */
    static create(source, params) {
        // 并发调用串行执行：核心 Region 的 token→region 跟踪在两个创建
        // 操作并发完成时会互相覆盖（实测先建者 tokens 恒空、不结算、
        // 对账也不可达），逐个创建消除该窗口。
        const run = this.#createChain.catch(err => console.error("XJZL | 前序光环创建失败:", err))
            .then(() => this.#createImpl(source, params));
        this.#createChain = run.then(() => undefined, () => undefined);
        return run;
    }

    /**
     * create 的实际执行体（经 #createChain 串行调用）。
     * @param {TokenDocument|Token|Actor|{scene: Scene, x: number, y: number}} source - 光环源
     * @param {object} params - 光环参数（见 create）
     * @returns {Promise<RegionDocument|null>}
     */
    static async #createImpl(source, params) {
        if (!params?.label || typeof params.label !== "string") {
            console.warn("XJZL | 光环创建被拒绝：label 必填。", params);
            return null;
        }
        const resolved = await this.#resolveSource(source, params);
        const scene = resolved.scene;
        if (!scene) return null;
        if (scene.grid?.isGridless || !scene.grid) {
            ui.notifications?.warn(game.i18n.localize("XJZL.Aura.NoGrid"));
            console.warn(`XJZL | 场景「${scene.name}」无网格，已禁用光环创建。`);
            return null;
        }
        // 半径以格计；拒绝小数，避免范围被静默截断。
        const radius = params.radius ?? 0;
        if (params.shapeKind !== "rect" && (!Number.isInteger(radius) || radius < 0)) {
            console.warn(`XJZL | 光环半径必须为 ≥0 的整数（格），收到：${radius}，创建被拒绝。`);
            return null;
        }

        // 生成器输出相对偏移（i=列、j=行），写入时按核心 GridShapeData
        // 约定做轴映射并叠加锚格（核心 i=行(y)、j=列(x)）。
        // quarterTurns "auto" 按源 Token 朝向（rotation）吸附 90°。
        const quarterTurns = params.quarterTurns === "auto"
            ? snapDirectionToQuarterTurns(resolved.tokenDoc?._source?.rotation ?? 0)
            : Math.trunc(params.quarterTurns ?? 0);
        const offsets = this.#buildOffsets(params, quarterTurns, resolved.anchorOffset, scene);
        if (!offsets.length) return null;

        // 单实例标签替换：先删旧建新。核心对旧 region 补发 exit 完成清理，
        // 新 region 的行为创建时对在场 token 补发 enter，状态对称收敛。
        await this.dismiss(params.label, {scene});

        const meta = this.#buildMeta(params, resolved);
        const regionData = {
            name: params.displayName || params.label,
            color: params.color || DEFAULT_COLOR,
            // 区域本体对所有人可见。
            visibility: CONST.REGION_VISIBILITY.ALWAYS,
            shapes: [{
                type: "grid",
                offsets,
                // 显式写 origin（锚格格心）：核心兜底取 offsets[0] 格心
                // （西北角附近），配置页改半径时的热更新会以它反推锚格，
                // 缺失会导致范围整体偏移；跟随平移时核心同步更新
                origin: resolved.anchorPoint
            }],
            // 不做高度限制：光环按 2D 地面格判定，bottom/top 给足量程
            elevation: {bottom: -10000, top: 10000, topInclusive: false},
            levels: this.#resolveLevels(resolved, params),
            attachment: resolved.follow && resolved.tokenDoc ? {token: resolved.tokenDoc.id} : null,
            behaviors: [{
                name: params.label,
                type: "xjzlAura",
                system: this.#behaviorSystem(params, quarterTurns)
            }],
            flags: {[FLAG_SCOPE]: {[FLAG_AURA]: meta}}
        };

        const created = game.users.activeGM?.isSelf
            ? await foundry.documents.RegionDocument.create(regionData, {parent: scene})
            : await xjzlSocket.executeAsGM("createEmbedded", scene.uuid, "Region", [regionData]);
        return Array.isArray(created) ? created[0] : created;
    }

    /**
     * 消除光环：按 label 或 regionId 删除 region。
     * 删除前预提交区域内 token 的 exit，确保在 region 消失前取得账目快照。
     * 核心删除事件可能再次提交 exit；账目清除和条目 eid 防止重复摘除。
     * @param {string} labelOrRegionId - 光环标签或 region 文档 id
     * @param {object} [options] - {scene?: Scene}（默认 canvas.scene）
     * @returns {Promise<number>} 删除的 region 数
     */
    static async dismiss(labelOrRegionId, options = {}) {
        const scene = options.scene ?? canvas.scene;
        if (!scene || !labelOrRegionId) return 0;
        const ids = [];
        if (scene.regions.has(labelOrRegionId)) {
            ids.push(labelOrRegionId);
        } else {
            for (const region of scene.regions) {
                if (region.getFlag(FLAG_SCOPE, FLAG_AURA)?.label === labelOrRegionId) ids.push(region.id);
            }
        }
        if (!ids.length) return 0;
        const regions = ids.map(id => scene.regions.get(id)).filter(Boolean);
        for (const region of regions) this.#preDeleteExits(region);
        if (game.users.activeGM?.isSelf) {
            await scene.deleteEmbeddedDocuments("Region", ids);
        } else {
            await xjzlSocket.executeAsGM("deleteEmbedded", scene.uuid, "Region", ids);
        }
        return ids.length;
    }

    /**
     * 按标签查询场上光环实例（脚本编排用：碧火检定消耗、暗刻引爆等）。
     * @param {string} label - 光环标签
     * @param {object} [options] - {scene?: Scene}
     * @returns {RegionDocument[]} 同标签的全部 region（通常为单实例）
     */
    static query(label, options = {}) {
        const scene = options.scene ?? canvas.scene;
        if (!scene || !label) return [];
        return scene.regions.filter(r => r.getFlag(FLAG_SCOPE, FLAG_AURA)?.label === label);
    }

    /**
     * 列出场景上全部光环标签（去重）。
     * @param {object} [options] - {scene?: Scene}
     * @returns {string[]}
     */
    static queryLabels(options = {}) {
        const scene = options.scene ?? canvas.scene;
        if (!scene) return [];
        const labels = new Set();
        for (const region of scene.regions) {
            const label = region.getFlag(FLAG_SCOPE, FLAG_AURA)?.label;
            if (label) labels.add(label);
        }
        return [...labels];
    }

    /**
     * 按档位/半径变化重建光环：读旧实例持久化参数，删旧建新。
     * @param {string} label - 光环标签
     * @param {object} [overrides] - 覆盖参数（如升级后的 radius/payloadEffectName）
     * @param {object} [options] - {scene?: Scene}
     * @returns {Promise<RegionDocument|null>} 新 region
     */
    static async refreshAura(label, overrides = {}, options = {}) {
        const regions = this.query(label, options);
        if (!regions.length) return null;
        const meta = regions[0].getFlag(FLAG_SCOPE, FLAG_AURA);
        const scene = regions[0].parent;
        if (!meta?.params) {
            console.warn(`XJZL | 光环「${label}」缺少创建参数快照，无法刷新。`);
            return null;
        }
        // 跟随型以源 Token 重建（源已删除时落空）；固定型保留锚点，
        // 同时在参数中保留原源身份，供阵营和自身过滤使用。
        const source = meta.follow && meta.sourceTokenUuid
            ? await fromUuid(meta.sourceTokenUuid)
            : {scene, x: meta.params.anchorPoint?.x ?? 0, y: meta.params.anchorPoint?.y ?? 0};
        if (!source) {
            console.warn(`XJZL | 光环「${label}」的源已失效，无法刷新。`);
            return null;
        }
        // 结算参数以行为 system 的当前值为准：配置页修改半径/
        // 形状/payload/动作后快照不会自动同步，重建必须读最新值，否则
        // 会退回创建时的旧配置——行为 system 与 create 的 params 平铺
        // 字段一一对应，直接整体覆盖。
        const behavior = regions[0].behaviors.find(b => b.type === "xjzlAura");
        const liveParams = behavior ? {...behavior.system} : {};
        // "auto" 朝向在 schema 中已固化为数字，重建时恢复源语义以便
        // 按源 Token 当前朝向重新吸附（overrides 显式给值时尊重调用方）
        if (meta.params.quarterTurns === "auto" && overrides.quarterTurns === undefined) {
            liveParams.quarterTurns = "auto";
        }
        await this.dismiss(label, {scene});
        return this.create(source, {
            ...meta.params, ...liveParams,
            sourceTokenUuid: meta.sourceTokenUuid,
            sourceActorUuid: meta.sourceActorUuid,
            ...overrides
        });
    }

    /**
     * 无实例范围查询：按生成器现算 offsets 对候选 Token 做
     * 包含判定，返回 Actor 列表，不创建任何文档（五雷等 attack 触发用）。
     * 判定显式传文档**源**位置与尺寸调用 getContainmentTestPoints——
     * 无参调用取 prepared 值可能处于动画中，而 Region 判定使用 source 值；
     * 1×1 测中心、多格测足迹任一点，与 Region 判定同口径。
     * @param {TokenDocument|Token|Actor|{scene: Scene, x: number, y: number}} source - 查询中心
     * @param {object} opts - {radius 或 offsets(生成器相对输出), shapeKind?, rectWidth?, rectHeight?,
     *   anchorX?, anchorY?, quarterTurns?, faction?, includeSelf?, scene?}
     * @returns {Promise<Actor[]>} 命中的 Actor 列表（每个命中 Token 对应一个 Actor）
     */
    static async queryTokens(source, opts = {}) {
        const resolved = await this.#resolveSource(source, opts);
        const scene = resolved.scene;
        if (!scene?.grid || scene.grid.isGridless) return [];
        // 半径以格计；拒绝小数，避免范围被静默截断。
        if (opts.shapeKind !== "rect" && !Array.isArray(opts.offsets)
            && (!Number.isInteger(opts.radius ?? 0) || (opts.radius ?? 0) < 0)) {
            console.warn(`XJZL | queryTokens 半径必须为 ≥0 的整数（格），收到：${opts.radius}。`);
            return [];
        }
        // 直接给 offsets 时用调用方现成集合（生成器相对输出，已含旋转）；
        // 否则按 radius/shapeKind 现算。
        let offsets;
        if (Array.isArray(opts.offsets) && opts.offsets.length) {
            offsets = opts.offsets.map(o => ({i: resolved.anchorOffset.i + o.j, j: resolved.anchorOffset.j + o.i}));
        } else {
            const quarterTurns = opts.quarterTurns === "auto"
                ? snapDirectionToQuarterTurns(resolved.tokenDoc?._source?.rotation ?? 0)
                : Math.trunc(opts.quarterTurns ?? 0);
            offsets = this.#buildOffsets(opts, quarterTurns, resolved.anchorOffset, scene);
        }
        if (!offsets.length) return [];
        const keys = new Set(offsets.map(o => `${o.i}.${o.j}`));
        const grid = scene.grid;

        const actors = [];
        for (const token of scene.tokens) {
            if (!token.actor) continue;
            const data = {
                x: token._source.x, y: token._source.y,
                width: token._source.width, height: token._source.height,
                shape: token._source.shape
            };
            const points = token.getContainmentTestPoints(data);
            const inside = points.some(point => {
                const {i, j} = grid.getOffset(point);
                return keys.has(`${i}.${j}`);
            });
            if (!inside) continue;
            actors.push(token.actor);
        }
        return this.#filterActors(actors, resolved, opts, scene);
    }

    /**
     * 按覆盖状态与账本补正失配。传 TokenDocument 对单个 Token 对账；传 Scene（或缺省当前
     * 场景）对全场 Token 补扫。
     * @param {TokenDocument|Scene|null} [target]
     * @returns {Promise<void>}
     */
    static async reconcile(target = null) {
        if (!game.users.activeGM?.isSelf) {
            console.warn("XJZL | 光环对账仅由活动 GM 执行。");
            return;
        }
        if (target?.documentName === "Token") return AuraLedger.reconcileToken(target);
        const scene = target ?? canvas.scene;
        if (!scene) return;
        for (const token of scene.tokens) await AuraLedger.reconcileToken(token);
    }

    /**
     * 战斗内回合边界对账：对本战斗每个战斗员 Token 补扫。
     * @param {Combat} combat - 战斗文档
     */
    static async reconcileCombat(combat) {
        for (const combatant of combat.combatants) {
            if (!combatant.token) continue;
            await AuraLedger.reconcileToken(combatant.token);
        }
    }

    /**
     * 按源映射销毁光环（生命周期兜底与脚本编排共用）。
     * @param {object} criteria - {sourceItemUuid?, sourceActorUuid?, lifecycle?}
     */
    static async dismissBySource(criteria = {}) {
        for (const region of this.#iterateAuraRegions()) {
            const meta = region.getFlag(FLAG_SCOPE, FLAG_AURA);
            if (!meta) continue;
            if (criteria.lifecycle && meta.lifecycle !== criteria.lifecycle) continue;
            if (criteria.sourceItemUuid && meta.sourceItemUuid !== criteria.sourceItemUuid) continue;
            if (criteria.sourceActorUuid && meta.sourceActorUuid !== criteria.sourceActorUuid) continue;
            if (!criteria.sourceItemUuid && !criteria.sourceActorUuid) continue;
            await this.#deleteRegion(region);
        }
    }

    /**
     * ready 孤儿校验：战斗已结束、源物品失效的光环清理并警告；
     * payload 不可解析（源物品在但效果名匹配不到）仅记录
     * 警告——光环可能仍有直接动作或仅标记价值，保留区域，施加时再降级。
     * @returns {Promise<void>}
     */
    static async validateOrphans() {
        for (const region of this.#iterateAuraRegions()) {
            const meta = region.getFlag(FLAG_SCOPE, FLAG_AURA);
            if (!meta) continue;
            let orphan = false;
            if (meta.lifecycle === "combat" && !meta.combatId) orphan = true;
            else if (meta.combatId && !game.combats.get(meta.combatId)) orphan = true;
            else if (meta.sourceItemUuid && !(await fromUuid(meta.sourceItemUuid))) orphan = true;
            if (orphan) {
                console.warn(`XJZL | 清理失效光环 region「${region.name}」(label: ${meta.label})。`);
                await this.#deleteRegion(region);
                continue;
            }
            // payload 校验读行为 system 的当前值：配置页改过
            // payload 后 meta.params 快照过时，按快照校验会误报/漏报
            const behavior = region.behaviors.find(b => b.type === "xjzlAura");
            const payloadUuid = behavior?.system?.payloadItemUuid;
            const payloadName = behavior?.system?.payloadEffectName;
            if (payloadUuid && payloadName) {
                const item = await fromUuid(payloadUuid);
                if (!item?.effects?.some(e => e.name === payloadName)) {
                    console.warn(`XJZL | 光环「${meta.label}」的 payload 不可解析（${payloadUuid} / "${payloadName}"），已降级：进出挂摘失效，保留直接结算动作与范围显示。`);
                }
            }
        }
    }

    /* -------------------------------------------- */
    /*  内部实现                                     */
    /* -------------------------------------------- */

    /**
     * 解析光环源为 {scene, tokenDoc, anchorOffset, anchorPoint, follow}。
     * 锚格一律吸附格心：跟随/定位型以源 Token 左上格为锚
     * （多格 Token 少见，取左上格保证可预期），放置型按传入点取格。
     * @param {object} source - 光环源
     * @param {object} params - 光环参数
     * @returns {Promise<{scene: Scene|null, tokenDoc: TokenDocument|null,
     *   anchorOffset: {i: number, j: number}, anchorPoint: {x: number, y: number}|null,
     *   follow: boolean}>}
     */
    static async #resolveSource(source, params = {}) {
        let tokenDoc = null;
        let scene = null;
        let point = null;

        if (!source) return {scene: null, tokenDoc: null, anchorOffset: {i: 0, j: 0}, anchorPoint: null, follow: false};
        if (source.documentName === "Token") {
            tokenDoc = source;
        } else if (source instanceof foundry.canvas.placeables.Token) {
            tokenDoc = source.document;
        } else if (source.documentName === "Actor" || source instanceof foundry.documents.Actor) {
            // Actor：取当前场景的活动 Token；无 Token 的 Actor 无法定环
            const tokens = source.getActiveTokens?.(false) ?? [];
            tokenDoc = tokens[0]?.document ?? null;
            if (!tokenDoc) {
                console.warn(`XJZL | 光环源 Actor「${source.name}」在当前场景没有 Token。`);
                return {scene: null, tokenDoc: null, anchorOffset: {i: 0, j: 0}, anchorPoint: null, follow: false};
            }
        } else if (source.scene && Number.isFinite(source.x) && Number.isFinite(source.y)) {
            scene = source.scene;
            point = {x: source.x, y: source.y};
        }
        if (tokenDoc) scene = tokenDoc.parent;

        if (!scene) return {scene: null, tokenDoc: null, anchorOffset: {i: 0, j: 0}, anchorPoint: null, follow: false};
        const sizeX = scene.grid?.sizeX ?? scene.grid?.size ?? 100;
        const sizeY = scene.grid?.sizeY ?? scene.grid?.size ?? 100;
        const px = point ?? {x: tokenDoc._source.x, y: tokenDoc._source.y};
        const anchorOffset = {i: Math.floor(px.y / sizeY), j: Math.floor(px.x / sizeX)};
        // 放置型重建锚点吸附格心，保证 refreshAura 与首次创建口径一致
        const anchorPoint = {
            x: anchorOffset.j * sizeX + sizeX / 2,
            y: anchorOffset.i * sizeY + sizeY / 2
        };
        const follow = Boolean(tokenDoc) && params.follow !== false;
        return {scene, tokenDoc, anchorOffset, anchorPoint, follow};
    }

    /**
     * 由参数生成核心 GridShapeData offsets（绝对格坐标）。
     * @param {object} params - 形状参数
     * @param {number} quarterTurns - 已解析的 90° 转数（0~3，"auto" 由调用方吸附为数字）
     * @param {{i: number, j: number}} anchorOffset - 锚格（核心格式 i=行 j=列）
     * @param {Scene} scene - 目标场景
     * @returns {{i: number, j: number}[]}
     */
    static #buildOffsets(params, quarterTurns, anchorOffset, scene) {
        let rel;
        if (params.shapeKind === "rect") {
            rel = generateRectangleOffsets({
                width: params.rectWidth ?? 3,
                height: params.rectHeight ?? 3,
                anchorX: params.anchorX ?? 0,
                anchorY: params.anchorY ?? 0
            });
        } else {
            // 半径整数契约由调用方（create/queryTokens）先行校验，
            // 生成器对非法值仍会抛错兜底
            rel = generateCircleOffsets(params.radius ?? 0);
        }
        if (quarterTurns) rel = rotateOffsets90(rel, quarterTurns);
        // 生成器 i=列、j=行，核心 i=行、j=列。
        return toCoreOffsets(rel, anchorOffset);
    }

    /**
     * 组装行为 system 数据（与 xjzlAura schema 字段一一对应）。
     * @param {object} params - 光环参数
     * @param {number} quarterTurns - 已解析的转数（schema 存数字，"auto" 不入 schema）
     * @returns {object}
     */
    static #behaviorSystem(params, quarterTurns) {
        return {
            enterEnabled: params.enterEnabled ?? true,
            roundEnabled: params.roundEnabled ?? false,
            radius: Math.trunc(params.radius ?? 0),
            shapeKind: params.shapeKind ?? "circle",
            rectWidth: params.rectWidth ?? 3,
            rectHeight: params.rectHeight ?? 3,
            anchorX: params.anchorX ?? 0,
            anchorY: params.anchorY ?? 0,
            quarterTurns: quarterTurns ?? 0,
            faction: params.faction ?? "all",
            includeSelf: params.includeSelf ?? true,
            payloadItemUuid: params.payloadItemUuid ?? "",
            payloadEffectName: params.payloadEffectName ?? "",
            enterAction: {...(params.enterAction ?? {})},
            moveWithin: params.moveWithin ?? false,
            throttlePerRound: params.throttlePerRound ?? false,
            roundTiming: params.roundTiming ?? "tokenRoundEnd",
            roundAction: {...(params.roundAction ?? {})},
            exitClear: params.exitClear ?? false
        };
    }

    /**
     * 组装 region flags 持久化元数据；params 全量快照供 refreshAura 重建。
     * @param {object} params - 光环参数
     * @param {object} resolved - 源解析结果
     * @returns {object} meta
     */
    static #buildMeta(params, resolved) {
        const combat = game.combat;
        const lifecycle = params.lifecycle || "manual";
        // 时限以创建时轮次为基准，每轮开始由 updateCombat 统一递减；
        // 时限锚定创建时的战斗（combatId）：普通生命周期光环设了
        // durationRounds 必须记战斗，否则无法按该战斗轮次到期；
        // 维持消耗只在该战斗内的源角色回合末结算。
        const duration = (params.durationRounds > 0 && combat?.round)
            ? {rounds: params.durationRounds, startedRound: combat.round}
            : null;
        const meta = {
            label: params.label,
            version: 1,
            lifecycle,
            follow: resolved.follow,
            // 固定型刷新按坐标重建，沿用原源 Token UUID 才能保持阵营/自身过滤。
            sourceTokenUuid: resolved.tokenDoc?.uuid ?? params.sourceTokenUuid ?? null,
            sourceActorUuid: params.sourceActorUuid ?? resolved.tokenDoc?.actor?.uuid ?? null,
            sourceItemUuid: params.sourceItemUuid ?? null,
            combatId: params.combatId ?? ((lifecycle === "combat" || duration || params.maintain) && combat ? combat.id : null),
            duration,
            maintain: params.maintain ? {...params.maintain} : null,
            params: {
                ...foundry.utils.deepClone(params),
                // 放置型重建锚点：跟随型 params.anchorPoint 置空
                anchorPoint: resolved.follow ? null : resolved.anchorPoint,
                quarterTurns: params.quarterTurns
            }
        };
        return meta;
    }

    /**
     * levels 判定：跟随型贴源 Token 所在层；空数组语义为"所有层"，
     * 单层场景（2D 常态）安全；多层场景由 params.levelIds 显式指定。
     * @param {object} resolved - 源解析结果
     * @param {object} params - 光环参数
     * @returns {string[]}
     */
    static #resolveLevels(resolved, params) {
        if (Array.isArray(params.levelIds)) return params.levelIds;
        const level = resolved.tokenDoc?._source?.level;
        return level ? [level] : [];
    }

    /**
     * queryTokens 的阵营/自身过滤；关联 Actor 的多个 Token 按 Actor 过滤自身。
     * @param {Actor[]} actors - 命中覆盖的 Actor
     * @param {object} resolved - 源解析结果
     * @param {object} opts - 过滤选项
     * @param {Scene} scene - 场景
     * @returns {Actor[]}
     */
    static #filterActors(actors, resolved, opts, scene) {
        const faction = opts.faction ?? "all";
        const includeSelf = opts.includeSelf ?? true;
        const sourceActor = resolved.tokenDoc?.actor ?? null;
        const sourceDisp = resolved.tokenDoc?.disposition;
        return actors.filter(actor => {
            if (!includeSelf && sourceActor && actor.uuid === sourceActor.uuid) return false;
            if (faction === "all") return true;
            // 从 Actor 反查其 Token disposition（同场景内可能多 Token，取首个）
            const token = scene.tokens.find(t => t.actor?.uuid === actor.uuid);
            const disp = token?.disposition;
            if (faction === "ally") return disp === sourceDisp;
            const hostileDisp = sourceDisp === CONST.TOKEN_DISPOSITIONS.HOSTILE
                ? CONST.TOKEN_DISPOSITIONS.FRIENDLY
                : CONST.TOKEN_DISPOSITIONS.HOSTILE;
            return disp === hostileDisp;
        });
    }

    /**
     * 遍历所有场景上带光环 flags 的 Region；直接线性查找，避免维护跨场景缓存。
     * @yields {RegionDocument}
     */
    static *#iterateAuraRegions() {
        for (const scene of game.scenes) {
            for (const region of scene.regions) {
                if (region.getFlag(FLAG_SCOPE, FLAG_AURA)) yield region;
            }
        }
    }

    /**
     * 删除单个光环 region 前预提交区域内所有 token 的 exit（快照在
     * region 完好时读取；机理见 dismiss 注释）。
     * @param {RegionDocument} region - 待删除的光环 region
     */
    static #preDeleteExits(region) {
        const behaviorId = region.behaviors.find(b => b.type === "xjzlAura")?.id ?? null;
        for (const token of [...region.tokens]) {
            if (!token.actor) continue;
            const entries = Object.entries(AuraLedger.getEntriesOfToken(region, token.id))
                .filter(([, entry]) => entry?.active)
                .map(([key, entry]) => ({key, entry}));
            if (!entries.length) continue;
            AuraLedger.submitExit({
                behaviorId,
                regionUuid: region.uuid,
                tokenUuid: token.uuid,
                actorUuid: token.actor.uuid,
                // 队列键取首条 key 保证与对应 enter 同组；摘除按快照执行
                payloadKey: entries[0].key
            }, entries, xjzlSocket);
        }
    }

    /**
     * 删除单个光环 region（本类调用点均已在活动 GM 端）。
     * @param {RegionDocument} region - 光环 region
     */
    static async #deleteRegion(region) {
        const scene = region.parent;
        if (!scene) return;
        this.#preDeleteExits(region);
        if (game.users.activeGM?.isSelf) {
            await scene.deleteEmbeddedDocuments("Region", [region.id]);
        } else {
            await xjzlSocket.executeAsGM("deleteEmbedded", scene.uuid, "Region", [region.id]);
        }
    }

    /**
     * 时限递减：每轮开始对 combatId 匹配的光环检查到期（GM 端单一入口，
     * 与 AE registry 无耦合）。N 回合光环存活创建轮整轮后消散。
     * @param {Combat} combat - 战斗文档
     */
    static async #tickDurations(combat) {
        const round = combat.round ?? 0;
        if (round < 1) return;
        for (const region of this.#iterateAuraRegions()) {
            const meta = region.getFlag(FLAG_SCOPE, FLAG_AURA);
            if (meta?.combatId !== combat.id || !meta.duration?.rounds) continue;
            if (round - meta.duration.startedRound >= meta.duration.rounds) {
                await this.#deleteRegion(region);
            }
        }
    }

    /**
     * 维持消耗：源角色回合末结算，单一归属本管理器（区域行为不扣钱，
     * 避免重复扣取）。实际扣取不足即散。
     * 消耗构成：`amount`（固定每回合）＋ `perTarget × 覆盖内敌人数`
     * （`perTarget` 为每名敌人的追加消耗）。
     * 行动者由 updateCombat 钩子传入的**推进前记录**定位，previous 为
     * null 的滚轮推进同样覆盖。
     * @param {Combat} combat - 战斗文档
     * @param {string|null} prevActorCombatantId - 推进前行动者的 combatant id
     */
    static async #consumeMaintenance(combat, prevActorCombatantId) {
        if (!prevActorCombatantId) return;
        const prevActor = combat.combatants.get(prevActorCombatantId)?.actor;
        if (!prevActor) return;
        // 幂等键：updateCombat 可能重入（快速切回合），同一 turn 只结算一次
        const dedupKey = `${combat.id}:${combat.round ?? combat.previous?.round}:${prevActorCombatantId}`;
        if (this.#consumedMaintenance.has(dedupKey)) return;
        this.#consumedMaintenance.add(dedupKey);
        if (this.#consumedMaintenance.size > 256) this.#consumedMaintenance.clear();

        for (const region of this.#iterateAuraRegions()) {
            const meta = region.getFlag(FLAG_SCOPE, FLAG_AURA);
            if (meta?.combatId !== combat.id || !meta.maintain) continue;
            if (meta.sourceActorUuid !== prevActor.uuid) continue;
            const enemyCount = meta.maintain.perTarget > 0
                ? this.#countEnemies(region, prevActor) : 0;
            const cost = (meta.maintain.amount || 0)
                + (meta.maintain.perTarget || 0) * enemyCount;
            if (!cost) continue;
            const result = await prevActor.applyHealing({
                amount: -cost,
                type: meta.maintain.resource || "mp",
                healer: prevActor
            });
            // actualHeal 为实际变动（负数）；扣取不足（资源见底）即散
            const actual = Math.abs(result?.actualHeal ?? cost);
            if (actual < cost) {
                console.warn(`XJZL | 光环「${meta.label}」维持不足（需 ${cost}，实扣 ${actual}），消散。`);
                await this.#deleteRegion(region);
            }
        }
    }

    /**
     * 统计覆盖内敌方 Token 数（perTarget 维持消耗用）。
     * 敌方口径与行为结算一致：与源 Token disposition 对置且非中立。
     * 源 Token 在光环所在场景内查找（战斗场景），不依赖当前画布。
     * @param {RegionDocument} region - 光环 region
     * @param {Actor} sourceActor - 源 Actor
     * @returns {number}
     */
    static #countEnemies(region, sourceActor) {
        const sourceToken = region.parent?.tokens.find(t => t.actor?.uuid === sourceActor.uuid) ?? null;
        const sourceDisp = sourceToken?.disposition ?? CONST.TOKEN_DISPOSITIONS.FRIENDLY;
        const hostileDisp = sourceDisp === CONST.TOKEN_DISPOSITIONS.HOSTILE
            ? CONST.TOKEN_DISPOSITIONS.FRIENDLY
            : CONST.TOKEN_DISPOSITIONS.HOSTILE;
        let count = 0;
        for (const token of region.tokens) {
            if (token.actor?.uuid === sourceActor.uuid) continue;
            if (token.disposition === hostileDisp) count++;
        }
        return count;
    }

    /**
     * 清空指定战斗的光环：只清 combatId 匹配的实例；
     * 多场景并行战斗时其他战斗的 lifecycle:"combat" 光环保留，
     * 其到期随各自战斗的轮边界与结束清理。
     * @param {string} combatId - 结束的战斗 id
     */
    static async #clearCombatAuras(combatId) {
        for (const region of this.#iterateAuraRegions()) {
            const meta = region.getFlag(FLAG_SCOPE, FLAG_AURA);
            if (!meta) continue;
            if (combatId && meta.combatId === combatId) {
                await this.#deleteRegion(region);
            }
        }
    }
}
