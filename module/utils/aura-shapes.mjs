/**
 * 生成以源格为原点的光环格偏移。圆形范围采用单段 1-2-2-2 距离，
 * 规则中的米按格计算，不读取场景的 grid.distance。
 * 半径仅接受非负整数，避免小数边界与旧模板判定不一致。
 * 本模块的 i 为列、j 为行，返回相对偏移；写入 GridShapeData.offsets 时
 * 须叠加锚格坐标，并转换为核心的 i=行、j=列。
 */

/**
 * 计算从 (0,0) 格到 (di,dj) 格"中心到中心"单段路径的 1-2-2-2 距离（单位：格）。
 * 与 measurePath 劫持的单段计费一致（首斜扣 1 只对该段自身的第一个斜步生效）。
 * 入参应为整数格偏移；非整数按截断处理。
 * @param {number} di  列偏移（向东为正）
 * @param {number} dj  行偏移（向南为正）
 * @returns {number} 格距离
 */
export function gridStepDistance(di, dj) {
    // 直行步数 = |absI - absJ| 与斜行步数 = min(absI, absJ) 的组合
    // 与系统 measurePath 的横向、纵向步数分解一致
    const absI = Math.abs(Math.trunc(di));
    const absJ = Math.abs(Math.trunc(dj));
    const diagonal = Math.min(absI, absJ);
    const straightSteps = Math.abs(absI - absJ);
    return straightSteps + diagonal * 2 - (diagonal > 0 ? 1 : 0);
}

/**
 * 生成圆形光环的覆盖格偏移集合（主体形态，约 99% 条目使用）。
 * 覆盖判据：gridStepDistance(i, j) <= radius；
 * 中心格 (0,0) 恒在集合内（半径 0 时仅含中心格）。
 * 返回按行优先（先 j 后 i 升序）排序的去重数组，保证序列化稳定、可 diff。
 * @param {number} radius  半径（格，非负整数）
 * @returns {{i: number, j: number}[]}
 */
export function generateCircleOffsets(radius) {
    assertValidRadius(radius);
    const offsets = [];
    for (let j = -radius; j <= radius; j++) {
        for (let i = -radius; i <= radius; i++) {
            if (gridStepDistance(i, j) <= radius) {
                // -radius 在 radius=0 时产生 -0，入列前归一化保证序列化稳定
                offsets.push({i: normZero(i), j: normZero(j)});
            }
        }
    }
    return sortOffsets(offsets);
}

/**
 * 生成矩形光环的覆盖格偏移集合（W×H 格，如剑气白云 3×1、刀气旋风 3×3）。
 * 矩形以"锚格"为参考：anchorX/anchorY 指明矩形内落在锚格（源 token 所在格或指定格）
 * 上的格位（0 起算），其余格相对锚格给出偏移；默认锚在角上（向东南方向展开），
 * 奇数尺寸可用 anchorX=(width-1)/2 居中；偶数尺寸须明确选择锚格。
 * 朝向由 rotateOffsets90 变换。
 * @param {object} params
 * @param {number} params.width   宽（格，≥1）
 * @param {number} params.height  高（格，≥1）
 * @param {number} [params.anchorX=0]  锚格在矩形内的列位（0 ≤ anchorX < width）
 * @param {number} [params.anchorY=0]  锚格在矩形内的行位（0 ≤ anchorY < height）
 * @returns {{i: number, j: number}[]}
 */
export function generateRectangleOffsets({width, height, anchorX = 0, anchorY = 0}) {
    if (!Number.isInteger(width) || width < 1) throw new Error(`矩形宽度必须为 ≥1 的整数，收到：${width}`);
    if (!Number.isInteger(height) || height < 1) throw new Error(`矩形高度必须为 ≥1 的整数，收到：${height}`);
    if (!Number.isInteger(anchorX) || anchorX < 0 || anchorX >= width) throw new Error(`锚格列位越界：${anchorX}`);
    if (!Number.isInteger(anchorY) || anchorY < 0 || anchorY >= height) throw new Error(`锚格行位越界：${anchorY}`);
    const offsets = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            offsets.push({i: x - anchorX, j: y - anchorY});
        }
    }
    return sortOffsets(offsets);
}

/**
 * 将偏移集合绕锚格 (0,0) 顺时针旋转 quarterTurns 个 90°（90° 吸附旋转）。
 * 整数格偏移旋转后仍为整数，天然满足格吸附；锚格自身位置不变。
 * 屏幕坐标约定：i 向东、j 向南，顺时针 90° 变换为 (i, j) → (-j, i)。
 * @param {{i: number, j: number}[]} offsets
 * @param {number} quarterTurns  顺时针 90° 的个数（负数逆时针，自动按 4 归一化）
 * @returns {{i: number, j: number}[]}  旋转后的新数组（不修改入参）
 */
export function rotateOffsets90(offsets, quarterTurns) {
    const turns = ((Math.trunc(quarterTurns) % 4) + 4) % 4;
    if (turns === 0) return offsets.map(o => ({i: o.i, j: o.j}));
    const rotated = offsets.map(o => {
        switch (turns) {
            case 1: return {i: normZero(-o.j), j: normZero(o.i)};
            case 2: return {i: normZero(-o.i), j: normZero(-o.j)};
            default: return {i: normZero(o.j), j: normZero(-o.i)};
        }
    });
    return sortOffsets(rotated);
}

/**
 * 将源 token 的朝向角度吸附为最近的 90° 转数（顺时针，0~3）。
 * 仅做数值吸附；角度零点与实际朝向的对应关系由调用方确定。
 * @param {number} direction  朝向角度（度，任意实数，如 token.direction）
 * @returns {number} 0~3 的顺时针 90° 转数
 */
export function snapDirectionToQuarterTurns(direction) {
    const normalized = ((direction % 360) + 360) % 360;
    return Math.round(normalized / 90) % 4;
}

/* -------------------------------------------- */
/*  内部工具                                     */
/* -------------------------------------------- */

/**
 * 校验半径：仅接受非负整数，避免小数边界的覆盖口径歧义。
 * @param {number} radius
 */
function assertValidRadius(radius) {
    if (!Number.isInteger(radius) || radius < 0) {
        throw new Error(`光环半径必须为 ≥0 的整数（格），收到：${radius}`);
    }
}

/**
 * 将取负产生的 -0 归一化为 0，保证 offsets 序列化与相等比较的稳定性。
 * @param {number} v
 * @returns {number}
 */
function normZero(v) {
    return v === 0 ? 0 : v;
}

/**
 * 按行优先（先 j 后 i 升序）排序并按 "i.j" 键去重。
 * @param {{i: number, j: number}[]} offsets
 * @returns {{i: number, j: number}[]}
 */
function sortOffsets(offsets) {
    const seen = new Set();
    const unique = [];
    for (const o of offsets) {
        const key = `${o.i}.${o.j}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(o);
    }
    unique.sort((a, b) => (a.j - b.j) || (a.i - b.i));
    return unique;
}
