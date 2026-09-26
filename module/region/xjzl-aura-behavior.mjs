/**
 * xjzlAura Region 行为的临时事件探针。
 * 仅记录事件，不执行光环结算；完整行为接入时替换日志处理。
 */

/** 限制保留条数，避免长会话持续占用内存。 */
const SPIKE_LOG_LIMIT = 500;

/** @type {object[]} 可通过 game.xjzl.auraSpike.log 查看。 */
const spikeLog = [];

/**
 * 保存并打印 Region 事件，供核对派发端和事件粒度。
 * @param {RegionEvent} event  核心 Region 事件
 */
function recordEvent(event) {
    const token = event.data?.token;
    const combatant = event.data?.combatant;
    const record = {
        name: event.name,
        time: new Date().toISOString(),
        worldTime: game.time?.worldTime ?? null,
        user: event.user?.name ?? event.user?.id ?? null,
        isSelf: event.user?.isSelf ?? null,
        isGM: event.user?.isGM ?? null,
        region: event.region?.name ?? null,
        scene: event.region?.parent?.name ?? null,
        token: token ? {name: token.name, id: token.id} : null,
        combatant: combatant ? {name: combatant.name, id: combatant.id} : null,
        combatRound: combatant ? combatant.combat?.round ?? null : game.combat?.round ?? null,
        combatTurn: combatant ? combatant.combat?.turn ?? null : game.combat?.turn ?? null,
        movement: describeMovement(event.data?.movement)
    };
    spikeLog.push(record);
    if (spikeLog.length > SPIKE_LOG_LIMIT) spikeLog.shift();
    console.log(`XJZL | [aura-spike] ${event.name}`, JSON.stringify(record));
}

/**
 * 保存移动数据快照；超长内容截断，避免单条日志过大。
 * @param {object|undefined} movement  Region 事件携带的 movement 数据
 * @returns {object|null} 快照，movement 为空时返回 null
 */
function describeMovement(movement) {
    if (!movement) return null;
    const waypoints = movement.passed?.waypoints;
    const snapshot = {
        typeof: typeof movement,
        keys: Object.keys(movement),
        id: movement.id ?? null,
        interrupted: movement.interrupted ?? null,
        hasPassed: movement.passed != null,
        passedKeys: movement.passed ? Object.keys(movement.passed) : null,
        waypointCount: Array.isArray(waypoints) ? waypoints.length : null,
        firstWaypoint: Array.isArray(waypoints) && waypoints.length ? JSON.stringify(waypoints[0]) : null,
        lastWaypoint: Array.isArray(waypoints) && waypoints.length ? JSON.stringify(waypoints.at(-1)) : null
    };
    try {
        const json = JSON.stringify(movement);
        snapshot.json = json.length > 2000 ? `${json.slice(0, 2000)}…(截断)` : json;
    } catch (err) {
        // movement 可能含不可序列化引用；记录失败原因并保留上面的逐字段快照
        snapshot.jsonError = String(err);
    }
    return snapshot;
}

/**
 * xjzlAura 临时行为模型。静态事件处理器无需行为实例的 events 字段订阅。
 */
export class XJZLAuraRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {

    /** @override 探针无需业务配置字段。 */
    static defineSchema() {
        return {};
    }

    /** @override */
    static events = {
        [CONST.REGION_EVENTS.TOKEN_ENTER]: recordEvent,
        [CONST.REGION_EVENTS.TOKEN_EXIT]: recordEvent,
        [CONST.REGION_EVENTS.TOKEN_MOVE_WITHIN]: recordEvent,
        [CONST.REGION_EVENTS.TOKEN_TURN_START]: recordEvent,
        [CONST.REGION_EVENTS.TOKEN_TURN_END]: recordEvent,
        [CONST.REGION_EVENTS.TOKEN_ROUND_START]: recordEvent,
        [CONST.REGION_EVENTS.TOKEN_ROUND_END]: recordEvent,
        [CONST.REGION_EVENTS.BEHAVIOR_ACTIVATED]: recordEvent,
        [CONST.REGION_EVENTS.BEHAVIOR_DEACTIVATED]: recordEvent
    };
}

/**
 * 在 init 阶段注册 xjzlAura 模型和配置页图标。
 * 类型还须在 system.json 声明；模型须先于本地化扫描注册。
 */
export function registerAuraBehaviorSpike() {
    CONFIG.RegionBehavior.dataModels.xjzlAura = XJZLAuraRegionBehaviorType;
    // 配置页直接读取 typeIcons，需为自定义类型提供图标。
    CONFIG.RegionBehavior.typeIcons.xjzlAura = "fas fa-hurricane";
    console.log("XJZL | [aura-spike] xjzlAura 行为类型已注册");
}

/**
 * 提供临时事件日志的读取和清空入口。
 * @returns {{log: object[], clear: () => void}}
 */
export function getAuraSpikeApi() {
    return {
        log: spikeLog,
        clear: () => {
            spikeLog.length = 0;
            console.log("XJZL | [aura-spike] 日志已清空");
        }
    };
}
