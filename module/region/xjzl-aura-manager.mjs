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
 *    region flags 的源映射清理；架招光环由 stopStance（解除/被破/濒死）
 *    与 item.mjs 切换架招路径直调）；
 * ③ 战斗结束清理绑定光环，ready 时校验孤儿实例。
 *
 * region flags `xjzl-system.aura` 持久化：label、lifecycle、源物品/Actor/Token
 * uuid、战斗 ID、到期轮次、维持状态与创建参数快照（refreshAura 重建依据）；
 * 施加账本与节流记录由 AuraLedger 维护。
 *
 * sourceTokenUuid 是归属与源过滤的唯一标识；uniqueness 决定同标签
 * 实例的替换范围，避免同模板的非关联 Token 因 actor.id 相同互相覆盖。
 */

import {AuraLedger} from "./xjzl-aura-ledger.mjs";
import {generateCircleOffsets, generateRectangleOffsets, rotateOffsets90, snapDirectionToQuarterTurns, toCoreOffsets} from "../utils/aura-shapes.mjs";
import {xjzlSocket} from "../socket.mjs";

const FLAG_SCOPE = "xjzl-system";
const FLAG_AURA = "aura";
/** 光环默认颜色（核心 ColorField 初始值是随机色，业务上给可预期的默认）。 */
const DEFAULT_COLOR = "#40d0c0";

export class AuraManager {

    /** @type {Set<string>} 维持消耗去重键 {combatId}:{round}:{turn}。 */
    static #consumedMaintenance = new Set();
    /** @type {Map<string, string|null>} 各战斗最近一次钩子观测的行动者 combatantId（维持扣取依据）。 */
    static #currentActors = new Map();
    /** @type {boolean} 钩子只注册一次。 */
    static #initialized = false;
    /** @type {Promise<void>} GM 文档写入串行链；账本清理须在链外等待，
     *  否则结算脚本反向 await 光环 API 时会形成循环等待。 */
    static #mutationChain = Promise.resolve();

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

        // ---- 时限递减 / 维持消耗 / 战斗期清理 ----
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
            // round 回 0（战斗面板关闭）也清战斗期光环
            if (roundChanged && (combat.round ?? 0) === 0) await this.#clearCombatAuras(combat.id);
            this.#currentActors.set(combat.id, combat.combatant?.id ?? null);
        });
        Hooks.on("deleteCombat", async combat => {
            if (!game.users.activeGM?.isSelf) return;
            this.#currentActors.delete(combat.id);
            await this.#clearCombatAuras(combat.id);
        });

        // ---- ready 孤儿校验 ----
        Hooks.once("ready", async () => {
            // 多 GM 在线时只允许活动 GM 执行（写 flags 的删除路径）
            if (!game.users.activeGM?.isSelf) return;
            // 恢复各进行中战斗的行动者记录：刷新页面后 #currentActors 为空，
            // 不初始化会导致第一次推进回合漏扣维持消耗
            for (const combat of game.combats) {
                this.#currentActors.set(combat.id, combat.combatant?.id ?? null);
            }
            await this.validateOrphans();
        });
    }

    /* -------------------------------------------- */
    /*  实例 API（公开，挂 game.xjzl.aura）           */
    /* -------------------------------------------- */

    /**
     * 创建光环；同标签实例按 uniqueness 的 source、scene 或 none 模式处理。
     * @param {TokenDocument|Token|Actor|{scene: Scene, x: number, y: number}} source - 位置源
     * @param {object} params - 形状、结算及生命周期参数；坐标放置可用 source 声明来源
     * @returns {Promise<RegionDocument|null>} 无网格、非法半径或来源不可用时返回 null；
     *   矩形参数和文档写入异常向调用方抛出；已提交但未同步抛出
     *   code 为 AURA_SYNC_PENDING、带 regionUuid 的异常
     */
    static create(source, params) {
        return this.#createImpl(source, params);
    }

    /**
     * 在发起端解析位置和参数，再交由活动 GM 串行替换与创建。
     * @param {object} source - 位置源
     * @param {object} params - 创建参数
     * @param {object|null} [replacement] - 刷新目标 {id, sourceTokenUuid, sourceActorUuid}
     * @returns {Promise<RegionDocument|null>}
     */
    static async #createImpl(source, params, replacement = null) {
        if (!params?.label || typeof params.label !== "string") {
            console.warn("XJZL | 光环创建被拒绝：label 必填。", params);
            return null;
        }
        const resolved = await this.#resolveSource(source, params);
        const scene = resolved.scene;
        if (!scene) return null;
        if (scene.grid?.isGridless || !scene.grid) {
            ui.notifications?.warn(game.i18n.localize("XJZL.Aura.NoGrid"));
            return null;
        }
        const radius = params.radius ?? 0;
        if (params.shapeKind !== "rect" && (!Number.isInteger(radius) || radius < 0)) {
            console.warn("XJZL | 光环半径必须为非负整数：", radius);
            return null;
        }
        const sourceInfo = await this.#resolveSourceInfo(resolved, params, replacement);
        if (!sourceInfo) return null;
        const uniqueness = params.uniqueness ?? (sourceInfo.sourceTokenUuid ? "source" : "scene");
        if (!["source", "scene", "none"].includes(uniqueness)
            || (uniqueness === "source" && !sourceInfo.sourceTokenUuid)) {
            console.warn("XJZL | 光环唯一性模式无效或缺少源 Token：", params.label, uniqueness);
            return null;
        }
        const quarterTurns = params.quarterTurns === "auto"
            ? snapDirectionToQuarterTurns(resolved.tokenDoc?._source?.rotation ?? 0)
            : Math.trunc(params.quarterTurns ?? 0);
        const offsets = this.#buildOffsets(params, quarterTurns, resolved.anchorOffset, scene);
        if (!offsets.length) return null;
        const regionData = {
            name: params.displayName || params.label,
            color: params.color || DEFAULT_COLOR,
            visibility: CONST.REGION_VISIBILITY.ALWAYS,
            shapes: [{type: "grid", offsets, origin: resolved.anchorPoint}],
            // 结算只判断平面覆盖；origin 必须是锚格格心，配置页热更新才不会偏移。
            elevation: {bottom: -10000, top: 10000, topInclusive: false},
            levels: this.#resolveLevels(resolved, params),
            attachment: resolved.follow && resolved.tokenDoc ? {token: resolved.tokenDoc.id} : null,
            behaviors: [{name: params.label, type: "xjzlAura", system: this.#behaviorSystem(params, quarterTurns)}],
            flags: {[FLAG_SCOPE]: {[FLAG_AURA]: this.#buildMeta(params, resolved, sourceInfo, uniqueness)}}
        };
        if (game.users.activeGM?.isSelf) return this.#enqueueCreate(scene, regionData, replacement);
        const uuid = await this.#callGM("auraCreate", scene.uuid, regionData, replacement);
        return uuid ? this.#awaitRegionSync(uuid) : null;
    }

    /**
     * socketlib 只传 UUID；短暂等待本地同步，避免把普通 JSON 当作文档返回。
     * @param {string} uuid - GM 创建的 Region UUID
     * @returns {Promise<RegionDocument>} 同步未完成时抛出带已提交 UUID 的异常
     */
    static async #awaitRegionSync(uuid) {
        let cause;
        try {
            for (let attempt = 0; attempt < 10; attempt++) {
                const region = await fromUuid(uuid);
                if (region) return region;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        } catch (error) {
            cause = error;
        }
        // UUID 是 GM 的提交收据；本地解析失败不能退化为“未创建”。
        throw Object.assign(new Error("XJZL | 光环已创建，但本地文档同步未完成：" + uuid, {cause}), {
            code: "AURA_SYNC_PENDING", regionUuid: uuid
        });
    }

    /**
     * 明确路由到活动 GM；executeAsGM 在其他 GM 客户端会本地执行。
     * @param {string} method - 已注册的光环 socket 方法
     * @param {...*} args - 可序列化参数
     * @returns {Promise<*>}
     */
    static #callGM(method, ...args) {
        const gm = game.users.activeGM;
        if (!gm) throw new Error("XJZL | 无活动 GM，无法处理光环。");
        return xjzlSocket.executeAsUser(method, gm.id, ...args);
    }

    /**
     * GM 创建入口，返回可跨 socket 传输的 UUID。
     * @param {Scene} scene - 目标场景
     * @param {object} regionData - 已构造的 Region 数据
     * @param {object|null} [replacement] - 刷新目标及原来源
     * @returns {Promise<string|null>}
     */
    static async createOnGM(scene, regionData, replacement = null) {
        const region = await this.#enqueueCreate(scene, regionData, replacement);
        return region?.uuid ?? null;
    }

    /**
     * GM 创建：队列外清账，队列内重新检查目标与冲突后提交文档写入。
     * 清账期间新增的冲突须重新清理，不能带着新账目删除 Region。
     * @param {Scene} scene - 目标场景
     * @param {object} regionData - 新 Region 数据
     * @param {object|null} replacement - 选定的刷新实例；创建时为 null
     * @returns {Promise<RegionDocument|null>}
     */
    static async #enqueueCreate(scene, regionData, replacement) {
        if (!game.users.activeGM?.isSelf) throw new Error("XJZL | 光环创建只能由活动 GM 执行。");
        const meta = regionData.flags?.[FLAG_SCOPE]?.[FLAG_AURA];
        if (!scene || !meta?.label || !["source", "scene", "none"].includes(meta.uniqueness)
            || (meta.uniqueness === "source" && !meta.sourceTokenUuid)) {
            throw new Error("XJZL | 无效的光环创建请求。");
        }
        if (meta.follow && scene.tokens.get(regionData.attachment?.token)?.uuid !== meta.sourceTokenUuid) return null;
        const selectTargets = () => {
            const target = replacement ? scene.regions.get(replacement.id) : null;
            if (replacement && (!target || target.getFlag(FLAG_SCOPE, FLAG_AURA)?.sourceTokenUuid !== replacement.sourceTokenUuid)) {
                return null;
            }
            const conflicts = meta.uniqueness === "none" ? [] : this.query(meta.label, {
                scene, ...(meta.uniqueness === "source" ? {source: meta.sourceTokenUuid} : {})
            });
            return [...new Set(target ? [target, ...conflicts] : conflicts)];
        };
        for (;;) {
            const targets = selectTargets();
            if (!targets) return null;
            const cleaned = new Map(await Promise.all(targets.map(async region => [region, await this.#preDeleteCleanup(region)])));
            const result = await this.#enqueueWrite(async () => {
                const current = selectTargets();
                if (!current) return null;
                // 清账期间其他请求可写入；释放队列后补清新冲突，再重试提交。
                if (current.some(region => !cleaned.has(region) || AuraLedger.allEntriesOfRegion(region)
                    .some(({entry}) => !cleaned.get(region).has(entry.eid)))) return undefined;
                if (meta.follow) {
                    const token = scene.tokens.get(regionData.attachment?.token);
                    if (!token || token.uuid !== meta.sourceTokenUuid) return null;
                    const behavior = regionData.behaviors[0].system;
                    const turns = meta.params.quarterTurns === "auto"
                        ? snapDirectionToQuarterTurns(token._source.rotation ?? 0) : behavior.quarterTurns;
                    const sizeX = scene.grid.sizeX ?? scene.grid.size;
                    const sizeY = scene.grid.sizeY ?? scene.grid.size;
                    const anchor = {i: Math.floor(token._source.y / sizeY), j: Math.floor(token._source.x / sizeX)};
                    const origin = {x: anchor.j * sizeX + sizeX / 2, y: anchor.i * sizeY + sizeY / 2};
                    const shape = regionData.shapes[0];
                    // 排队期间源可能移动或转向；只在锚点变化时重算，固定区域保持选定落点。
                    if (shape.origin.x !== origin.x || shape.origin.y !== origin.y || behavior.quarterTurns !== turns) {
                        shape.offsets = this.#buildOffsets(behavior, turns, anchor, scene);
                        shape.origin = origin;
                        behavior.quarterTurns = turns;
                    }
                }
                if (current.length) await scene.deleteEmbeddedDocuments("Region", current.map(region => region.id));
                return foundry.documents.RegionDocument.create(regionData, {parent: scene});
            });
            if (result !== undefined) return result;
        }
    }

    /**
     * 仅串行提交文档写入，回调不得等待账本或调用光环公共 API。
     * @param {Function} write - 已完成清账的写入回调
     * @returns {Promise<*>} 本次结果或异常；失败不阻塞后续提交
     */
    static #enqueueWrite(write) {
        const operation = this.#mutationChain.then(() => {
            if (!game.users.activeGM?.isSelf) throw new Error("XJZL | 光环写入只能由活动 GM 执行。");
            return write();
        });
        // 错误仍由本次调用接收；仅让内部队列恢复，后续请求不会被一并拒绝。
        this.#mutationChain = operation.then(() => undefined, () => undefined);
        return operation;
    }

    /**
     * 按标签或 Region ID 删除；source 可限定来源，无法解析时返回 0。
     * @param {string} labelOrRegionId - 业务标签或 Region ID（ID 优先）
     * @param {object} [options] - {scene?, source?}
     * @returns {Promise<number>} 实际删除数量
     */
    static async dismiss(labelOrRegionId, options = {}) {
        const scene = options.scene ?? canvas.scene;
        if (!scene || !labelOrRegionId) return 0;
        const sourceTokenUuid = this.#sourceFilter(options);
        if (sourceTokenUuid === null) return 0;
        if (!game.users.activeGM?.isSelf) {
            return this.#callGM("auraDismiss", scene.uuid, labelOrRegionId, sourceTokenUuid ?? null);
        }
        return this.dismissOnGM(scene, labelOrRegionId, sourceTokenUuid ?? null);
    }

    /**
     * GM 删除入口；队列外清账，实际删除串行提交，避免重复消费。
     * 清理失败会中止删除。
     * @param {Scene} scene - 目标场景
     * @param {string} labelOrRegionId - 标签或 Region ID
     * @param {string|null} [sourceTokenUuid] - null 表示不限制来源
     * @returns {Promise<number>}
     */
    static async dismissOnGM(scene, labelOrRegionId, sourceTokenUuid = null) {
        if (!game.users.activeGM?.isSelf) throw new Error("XJZL | 光环删除只能由活动 GM 执行。");
        if (!scene) return 0;
        const direct = scene.regions.get(labelOrRegionId);
        const regions = direct ? [direct] : this.query(labelOrRegionId, {scene});
        let count = 0;
        for (const region of regions) {
            if (sourceTokenUuid && region.getFlag(FLAG_SCOPE, FLAG_AURA)?.sourceTokenUuid !== sourceTokenUuid) continue;
            if (await this.#deleteRegion(region)) count++;
        }
        return count;
    }

    /**
     * 返回指定标签的实例；提供 source 时只匹配该源 Token。
     * @param {string} label - 业务标签
     * @param {object} [options] - {scene?, source?}
     * @returns {RegionDocument[]}
     */
    static query(label, options = {}) {
        const scene = options.scene ?? canvas.scene;
        if (!scene || !label) return [];
        const sourceTokenUuid = this.#sourceFilter(options);
        if (sourceTokenUuid === null) return [];
        return scene.regions.filter(region => {
            const meta = region.getFlag(FLAG_SCOPE, FLAG_AURA);
            return meta?.label === label
                && (sourceTokenUuid === undefined || meta.sourceTokenUuid === sourceTokenUuid);
        });
    }

    /**
     * 检查是否已有实例，供“已建则跳过”的补建脚本使用。
     * @param {string} label - 业务标签
     * @param {TokenDocument|Token|Actor|string|null} [source] - 省略或 null 时不限来源
     * @param {object} [options] - {scene?}
     * @returns {boolean}
     */
    static exists(label, source, options = {}) {
        return this.query(label, source == null ? options : {...options, source}).length > 0;
    }

    /**
     * 枚举标签并去重；多实例数量应通过 query 的结果计算。
     * @param {object} [options] - {scene?, source?}
     * @returns {string[]}
     */
    static queryLabels(options = {}) {
        const scene = options.scene ?? canvas.scene;
        if (!scene) return [];
        const sourceTokenUuid = this.#sourceFilter(options);
        if (sourceTokenUuid === null) return [];
        const labels = new Set();
        for (const region of scene.regions) {
            const meta = region.getFlag(FLAG_SCOPE, FLAG_AURA);
            if (meta?.label && (sourceTokenUuid === undefined || meta.sourceTokenUuid === sourceTokenUuid)) labels.add(meta.label);
        }
        return [...labels];
    }

    /**
     * 重建选定实例；跟随源失效时返回 null，固定区域沿用保存的来源和锚点。
     * @param {string} labelOrRegionId - 标签或 Region ID；多实例建议用 ID
     * @param {object} [overrides] - 创建参数的覆盖项
     * @param {object} [options] - {scene?, source?}；标签只定位首个匹配实例
     * @returns {Promise<RegionDocument|null>} 并发目标已失效时返回 null；
     *   已提交但未同步的异常与 create 相同，携带新 Region UUID
     */
    static async refreshAura(labelOrRegionId, overrides = {}, options = {}) {
        const scene = options.scene ?? canvas.scene;
        if (!scene || !labelOrRegionId) return null;
        const sourceTokenUuid = this.#sourceFilter(options);
        if (sourceTokenUuid === null) return null;
        const direct = scene.regions.get(labelOrRegionId);
        const region = direct?.getFlag(FLAG_SCOPE, FLAG_AURA) ? direct : this.query(labelOrRegionId, options)[0];
        const meta = region?.getFlag(FLAG_SCOPE, FLAG_AURA);
        if (!meta?.params || (sourceTokenUuid !== undefined && meta.sourceTokenUuid !== sourceTokenUuid)) return null;
        const source = meta.follow
            ? await fromUuid(meta.sourceTokenUuid)
            : {scene, x: meta.params.anchorPoint.x, y: meta.params.anchorPoint.y};
        if (!source) return null;
        const behavior = region.behaviors.find(b => b.type === "xjzlAura");
        const liveParams = behavior ? {...behavior.system} : {};
        if (meta.params.quarterTurns === "auto" && overrides.quarterTurns === undefined) liveParams.quarterTurns = "auto";
        return this.#createImpl(source, {
            ...meta.params, ...liveParams, sourceActorUuid: meta.sourceActorUuid,
            uniqueness: meta.uniqueness, ...overrides
        }, {id: region.id, sourceTokenUuid: meta.sourceTokenUuid, sourceActorUuid: meta.sourceActorUuid});
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
            // 跟随型光环随源 Token 平移，Token 已删则失去锚定意义（放置型
            // 如暗刻在场上独立存在，源 Token 删除不构成孤儿）。
            else if (meta.follow && meta.sourceTokenUuid && !(await fromUuid(meta.sourceTokenUuid))) orphan = true;
            if (orphan) {
                console.warn(`XJZL | 清理失效光环 region「${region.name}」(label: ${meta.label})。`);
                await this.#deleteRegion(region);
                continue;
            }
            // meta.params 只保存创建时快照；payload 校验必须读取每个行为的
            // 当前 system，避免配置修改或多行为组合造成误报、漏报。
            for (const behavior of region.behaviors.filter(b => b.type === "xjzlAura")) {
                const payloadUuid = behavior.system?.payloadItemUuid;
                const payloadName = behavior.system?.payloadEffectName;
                const payloadStatusId = behavior.system?.payloadStatusId;
                if (payloadStatusId) {
                    if (!CONFIG.statusEffects?.[payloadStatusId]) {
                        console.warn(`XJZL | 光环「${meta.label}」的系统状态 payload 不可解析（${payloadStatusId}）。`);
                    }
                    continue;
                }
                if (!payloadUuid || !payloadName) continue;
                const item = await fromUuid(payloadUuid);
                if (!item?.effects?.some(e => e.name === payloadName)) {
                    console.warn(`XJZL | 光环「${meta.label}」的 payload 不可解析（${payloadUuid} / "${payloadName}"），已降级：进出挂摘失效，保留直接结算动作与范围显示。`);
                }
            }
        }
    }

    /**
     * 将实体解析为 Token 文档；世界 Actor 与定位逻辑共用首个活动 Token。
     * @param {TokenDocument|Token|Actor} source - 已解析的源实体
     * @returns {TokenDocument|null}
     */
    static #tokenOfSource(source) {
        if (source?.documentName === "Token") return source;
        if (source instanceof foundry.canvas.placeables.Token) return source.document;
        if (source?.documentName === "Actor" || source instanceof foundry.documents.Actor) {
            return source.token ?? source.getActiveTokens?.(false)?.[0]?.document ?? null;
        }
        return null;
    }

    /**
     * 解析一次查询来源；字符串是持久化 Token UUID，允许源已删除的固定区域。
     * @param {object} options - source 省略时不限制，显式无效值不能退化为不限来源
     * @returns {string|undefined|null} undefined 为不限来源，null 为无效来源
     */
    static #sourceFilter(options) {
        if (!("source" in options)) return undefined;
        const source = options.source;
        const uuid = typeof source === "string" ? source : this.#tokenOfSource(source)?.uuid;
        if (uuid) return uuid;
        console.warn("XJZL | 光环源过滤参数无法解析为 Token：", source);
        return null;
    }

    /**
     * 创建时只接受实际来源；固定区域刷新可沿用保存的 Token UUID，不反推身份。
     * @param {object} resolved - 位置解析结果
     * @param {object} params - source 或 sourceActorUuid 声明坐标区域的来源
     * @param {object|null} saved - 刷新时保存的来源
     * @returns {Promise<object|null>} {sourceTokenUuid, sourceActorUuid}；显式无效来源返回 null
     */
    static async #resolveSourceInfo(resolved, params, saved) {
        let token = null;
        try {
            if (params.source !== undefined) {
                const entity = typeof params.source === "string" ? await fromUuid(params.source) : params.source;
                token = typeof params.source === "string"
                    ? (entity?.documentName === "Token" ? entity : null) : this.#tokenOfSource(entity);
                if (!token) {
                    console.warn("XJZL | 光环 source 无法解析为 Token：", params.label, params.source);
                    return null;
                }
            } else if (!resolved.tokenDoc && !saved && params.sourceActorUuid) {
                token = this.#tokenOfSource(await fromUuid(params.sourceActorUuid));
                if (!token) {
                    console.warn("XJZL | 光环 sourceActorUuid 没有活动 Token：", params.label, params.sourceActorUuid);
                    return null;
                }
            }
        } catch (error) {
            console.warn("XJZL | 光环来源解析失败：", params.label, params.source ?? params.sourceActorUuid, error);
            return null;
        }
        token = resolved.tokenDoc ?? token;
        if (token && token.parent?.tokens?.get(token.id) !== token) {
            console.warn("XJZL | 光环来源 Token 已不在场景中：", params.label, token.uuid);
            return null;
        }
        return {
            sourceTokenUuid: token?.uuid ?? saved?.sourceTokenUuid ?? null,
            sourceActorUuid: params.sourceActorUuid ?? token?.actor?.uuid ?? saved?.sourceActorUuid ?? null
        };
    }

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
        tokenDoc = this.#tokenOfSource(source);
        if (source.documentName === "Actor" || source instanceof foundry.documents.Actor) {
            if (!tokenDoc) {
                console.warn(`XJZL | 光环源 Actor「${source.name}」在当前场景没有 Token。`);
                return {scene: null, tokenDoc: null, anchorOffset: {i: 0, j: 0}, anchorPoint: null, follow: false};
            }
        } else if (!tokenDoc && source.scene && Number.isFinite(source.x) && Number.isFinite(source.y)) {
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
            payloadStatusId: params.payloadStatusId ?? "",
            enterAction: {...(params.enterAction ?? {})},
            moveWithin: params.moveWithin ?? false,
            throttlePerRound: params.throttlePerRound ?? false,
            oncePerRound: params.oncePerRound ?? false,
            roundTiming: params.roundTiming ?? "tokenRoundEnd",
            roundAction: {...(params.roundAction ?? {})},
            cleanupOnExit: params.cleanupOnExit ?? true
        };
    }

    /**
     * 组装 region flags 持久化元数据；params 全量快照供 refreshAura 重建。
     * @param {object} params - 光环参数
     * @param {object} resolved - 源解析结果
     * @param {object} sourceInfo - 已解析的 {sourceTokenUuid, sourceActorUuid}
     * @param {string} uniqueness - 唯一性模式（refreshAura 重建沿用）
     * @returns {object} meta
     */
    static #buildMeta(params, resolved, sourceInfo, uniqueness) {
        const combat = game.combat;
        const lifecycle = params.lifecycle || "manual";
        // 时限以创建时轮次为基准，每轮开始由 updateCombat 统一递减；
        // 时限锚定创建时的战斗（combatId）：普通生命周期光环设了
        // durationRounds 必须记战斗，否则无法按该战斗轮次到期；
        // 维持消耗只在该战斗内的源角色回合末结算。
        const duration = (params.durationRounds > 0 && combat?.round)
            ? {rounds: params.durationRounds, startedRound: combat.round}
            : null;
        // 来源文档不进入参数快照，避免把实体引用带入 flags 序列化。
        const {source: _sourceEntity, ...snapshot} = params;
        const meta = {
            label: params.label,
            version: 1,
            lifecycle,
            follow: resolved.follow,
            sourceTokenUuid: sourceInfo.sourceTokenUuid,
            sourceActorUuid: sourceInfo.sourceActorUuid,
            sourceItemUuid: params.sourceItemUuid ?? null,
            uniqueness,
            combatId: params.combatId ?? ((lifecycle === "combat" || duration || params.maintain) && combat ? combat.id : null),
            duration,
            maintain: params.maintain ? {...params.maintain} : null,
            params: {
                ...foundry.utils.deepClone(snapshot),
                uniqueness,
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
     * 删除光环 region 前预提交清理：枚举账本条目（账目自带
     * actorUuid/tokenUuid，不依赖 region.tokens——Token 可能已删除而账目
     * 仍在），每条账目按独立 owner 提交一次释放；await 全部完成后再删除，
     * 核心 delete 补发的 exit 到达时账目已清、空转（eid 幂等兜底重复快照）。
     * 预清理必须先于删除完成，否则 Region 文档可能在读取快照或清账前消失。
     * 任一清理失败时抛出 AggregateError 并中止删除：region 存活时账目
     * 仍在、可重试；此时坚持删除会让清理账目随文档消失，AE 永久残留且
     * 失去重试凭据。
     * @param {RegionDocument} region - 待删除的光环 region
     * @returns {Promise<Set<string>>} 已提交清理的账目 eid；Actor 已不存在时无法释放
     */
    static async #preDeleteCleanup(region) {
        const pending = [];
        const entries = AuraLedger.allEntriesOfRegion(region);
        for (const {key, tokenId, entry} of entries) {
            pending.push(AuraLedger.submitExit({
                behaviorId: key,
                regionUuid: region.uuid,
                tokenUuid: entry.tokenUuid,
                actorUuid: entry.actorUuid
            }, [{key, tokenId, entry}], xjzlSocket));
        }
        const results = await Promise.allSettled(pending);
        const rejected = results.filter(r => r.status === "rejected");
        if (rejected.length) {
            throw new AggregateError(rejected.map(r => r.reason),
                `XJZL | 光环 region「${region.name}」预清理失败，已中止删除（region 保留可重试）`);
        }
        return new Set(entries.map(({entry}) => entry.eid));
    }

    /**
     * 删除单个光环；非活动 GM 将整次清账与删除委托活动 GM。
     * @param {RegionDocument} region - 光环 region
     * @returns {Promise<boolean>} 仅实际删除者返回 true
     */
    static async #deleteRegion(region) {
        const scene = region.parent;
        if (!scene || scene.regions.get(region.id) !== region) return false;
        if (!game.users.activeGM?.isSelf) {
            return (await this.dismiss(region.id, {scene})) > 0;
        }
        for (;;) {
            const cleaned = await this.#preDeleteCleanup(region);
            const deleted = await this.#enqueueWrite(async () => {
                if (scene.regions.get(region.id) !== region) return false;
                if (AuraLedger.allEntriesOfRegion(region).some(({entry}) => !cleaned.has(entry.eid))) return undefined;
                await scene.deleteEmbeddedDocuments("Region", [region.id]);
                return true;
            });
            if (deleted !== undefined) return deleted;
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
