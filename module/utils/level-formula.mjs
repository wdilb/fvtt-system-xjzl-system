/**
 * 武学等级公式解析器
 *
 * 持久化字段可以使用形如 @{1 + @up|1} 的占位符：
 * - 左侧为受限数值公式
 * - 右侧为公式无效时显示的回退文本
 *
 * 这里刻意不使用 eval / Function，避免让数据字段变成任意脚本入口。
 */

const FORMULA_START = "@{";
const MAX_EXPRESSION_LENGTH = 256;
const MAX_TOKENS = 256;
const MAX_DEPTH = 32;

const ACTION_COSTS = Object.freeze({
  1: "简要动作",
  2: "次要动作",
  3: "主要动作",
  4: "蓄力动作",
  5: "全回合动作"
});

const ALLOWED_VARIABLES = new Set(["level", "up", "maxLevel"]);
const ALLOWED_FUNCTIONS = new Set(["min", "max", "clamp", "floor", "ceil", "round", "abs", "if"]);
const AST_CACHE = new Map();
const WARNED_ERRORS = new Set();

class FormulaError extends Error {
  constructor(message) {
    super(message);
    this.name = "FormulaError";
  }
}

/**
 * 判断字符串中是否包含等级公式。
 * @param {*} value
 * @returns {boolean}
 */
export function hasLevelFormula(value) {
  return typeof value === "string" && value.includes(FORMULA_START);
}

/**
 * 解析描述、距离等可混排文本中的全部等级公式。
 * @param {*} value 原始字段
 * @param {object} variables 公式变量
 * @param {object} [options]
 * @returns {*} 不含公式时原样返回
 */
export function resolveLevelFormulaText(value, variables, options = {}) {
  if (!hasLevelFormula(value)) return value;

  let output = "";
  let cursor = 0;

  while (cursor < value.length) {
    const start = value.indexOf(FORMULA_START, cursor);
    if (start === -1) {
      output += value.slice(cursor);
      break;
    }

    output += value.slice(cursor, start);
    const token = readFormulaToken(value, start);

    if (!token) {
      warnOnce(value.slice(start), "缺少结束符 }", options);
      output += value.slice(start);
      break;
    }

    output += resolveTokenText(token, variables, options);
    cursor = token.end;
  }

  return output;
}

/**
 * 解析动作字段。动作公式必须占据整个字段，结果取整后限制在 1..5。
 * 普通文本（包括“反应动作”“无”）保持不变。
 * @param {*} value
 * @param {object} variables
 * @param {object} [options]
 * @returns {*}
 */
export function resolveActionCostFormula(value, variables, options = {}) {
  if (!hasLevelFormula(value)) return value;

  const leadingLength = value.length - value.trimStart().length;
  const start = leadingLength;
  const token = readFormulaToken(value, start);

  if (!token || start !== value.indexOf(FORMULA_START) || value.slice(token.end).trim() !== "") {
    const fallback = token?.fallback ?? value;
    warnOnce(value, "动作公式必须占据整个字段", options);
    return fallback;
  }

  if (token.invalidReason) {
    warnOnce(token.expression, token.invalidReason, options);
    return token.fallback;
  }

  try {
    const result = evaluateFormula(token.expression, variables);
    if (!Number.isInteger(result)) {
      throw new FormulaError("动作公式结果必须是整数");
    }

    const level = Math.min(5, Math.max(1, result));
    return ACTION_COSTS[level];
  } catch (error) {
    warnOnce(token.expression, error.message, options);
    return token.fallback;
  }
}

/**
 * 计算单条受限数值公式，主要供数据校验和测试使用。
 * @param {string} expression
 * @param {object} variables
 * @returns {number}
 */
export function evaluateLevelFormula(expression, variables) {
  return evaluateFormula(expression, variables);
}

function resolveTokenText(token, variables, options) {
  if (token.invalidReason) {
    warnOnce(token.expression, token.invalidReason, options);
    return token.fallback;
  }

  try {
    const result = evaluateFormula(token.expression, variables);
    return formatNumber(result);
  } catch (error) {
    warnOnce(token.expression, error.message, options);
    return token.fallback;
  }
}

function readFormulaToken(value, start) {
  if (!value.startsWith(FORMULA_START, start)) return null;

  let separator = -1;
  let escaped = false;

  for (let i = start + FORMULA_START.length; i < value.length; i++) {
    const char = value[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|" && separator === -1) {
      separator = i;
      continue;
    }
    if (char === "}") {
      if (separator === -1) {
        return {
          expression: value.slice(start + FORMULA_START.length, i).trim(),
          fallback: value.slice(start, i + 1),
          end: i + 1,
          invalidReason: "缺少回退值分隔符 |"
        };
      }

      return {
        expression: unescapeTokenPart(value.slice(start + FORMULA_START.length, separator)).trim(),
        fallback: unescapeTokenPart(value.slice(separator + 1, i)),
        end: i + 1
      };
    }
  }

  return null;
}

function unescapeTokenPart(value) {
  return value.replace(/\\([\\|}])/g, "$1");
}

function evaluateFormula(expression, variables = {}) {
  if (typeof expression !== "string" || expression.trim() === "") {
    throw new FormulaError("公式不能为空");
  }
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new FormulaError(`公式长度不能超过 ${MAX_EXPRESSION_LENGTH} 个字符`);
  }

  let ast = AST_CACHE.get(expression);
  if (!ast) {
    ast = new Parser(tokenize(expression)).parse();
    AST_CACHE.set(expression, ast);
  }

  const context = normalizeVariables(variables);
  return assertFinite(evaluateNode(ast, context), "公式结果不是有限数值");
}

function normalizeVariables(variables) {
  const level = normalizeVariable(variables.level, "level");
  const up = normalizeVariable(variables.up, "up");
  const maxLevel = normalizeVariable(variables.maxLevel, "maxLevel");
  return { level, up, maxLevel };
}

function normalizeVariable(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new FormulaError(`变量 @${name} 不是有限数值`);
  }
  return number;
}

function tokenize(expression) {
  const tokens = [];
  let cursor = 0;

  const push = (type, value) => {
    tokens.push({ type, value });
    if (tokens.length > MAX_TOKENS) throw new FormulaError("公式过于复杂");
  };

  while (cursor < expression.length) {
    const rest = expression.slice(cursor);
    const char = expression[cursor];

    if (/\s/.test(char)) {
      cursor++;
      continue;
    }

    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) {
      push("number", Number(number[0]));
      cursor += number[0].length;
      continue;
    }

    const variable = rest.match(/^@([A-Za-z][A-Za-z0-9]*)/);
    if (variable) {
      if (!ALLOWED_VARIABLES.has(variable[1])) {
        throw new FormulaError(`不支持变量 @${variable[1]}`);
      }
      push("variable", variable[1]);
      cursor += variable[0].length;
      continue;
    }

    const identifier = rest.match(/^[A-Za-z][A-Za-z0-9]*/);
    if (identifier) {
      if (!ALLOWED_FUNCTIONS.has(identifier[0])) {
        throw new FormulaError(`不支持函数 ${identifier[0]}`);
      }
      push("identifier", identifier[0]);
      cursor += identifier[0].length;
      continue;
    }

    const twoCharacterOperator = rest.slice(0, 2);
    if ([">=", "<=", "==", "!="].includes(twoCharacterOperator)) {
      push("operator", twoCharacterOperator);
      cursor += 2;
      continue;
    }

    if ("+-*/%><".includes(char)) {
      push("operator", char);
      cursor++;
      continue;
    }
    if (char === "(" || char === ")") {
      push("paren", char);
      cursor++;
      continue;
    }
    if (char === ",") {
      push("comma", char);
      cursor++;
      continue;
    }

    throw new FormulaError(`不支持字符 ${char}`);
  }

  push("eof", "");
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.cursor = 0;
    this.depth = 0;
  }

  parse() {
    const node = this.parseEquality();
    if (this.current.type !== "eof") {
      throw new FormulaError(`意外的符号 ${this.current.value}`);
    }
    return node;
  }

  get current() {
    return this.tokens[this.cursor];
  }

  consume(type, value) {
    if (this.current.type !== type || (value !== undefined && this.current.value !== value)) {
      throw new FormulaError(`应为 ${value ?? type}`);
    }
    return this.tokens[this.cursor++];
  }

  match(type, values) {
    if (this.current.type !== type || !values.includes(this.current.value)) return null;
    return this.tokens[this.cursor++];
  }

  parseEquality() {
    let node = this.parseComparison();
    let operator;
    while ((operator = this.match("operator", ["==", "!="]))) {
      node = { type: "binary", operator: operator.value, left: node, right: this.parseComparison() };
    }
    return node;
  }

  parseComparison() {
    let node = this.parseAdditive();
    let operator;
    while ((operator = this.match("operator", [">", ">=", "<", "<="]))) {
      node = { type: "binary", operator: operator.value, left: node, right: this.parseAdditive() };
    }
    return node;
  }

  parseAdditive() {
    let node = this.parseMultiplicative();
    let operator;
    while ((operator = this.match("operator", ["+", "-"]))) {
      node = { type: "binary", operator: operator.value, left: node, right: this.parseMultiplicative() };
    }
    return node;
  }

  parseMultiplicative() {
    let node = this.parseUnary();
    let operator;
    while ((operator = this.match("operator", ["*", "/", "%"]))) {
      node = { type: "binary", operator: operator.value, left: node, right: this.parseUnary() };
    }
    return node;
  }

  parseUnary() {
    const operator = this.match("operator", ["+", "-"]);
    if (operator) return { type: "unary", operator: operator.value, operand: this.parseUnary() };
    return this.parsePrimary();
  }

  parsePrimary() {
    if (++this.depth > MAX_DEPTH) throw new FormulaError("公式嵌套过深");

    try {
      if (this.current.type === "number") {
        return { type: "number", value: this.consume("number").value };
      }
      if (this.current.type === "variable") {
        return { type: "variable", name: this.consume("variable").value };
      }
      if (this.current.type === "identifier") {
        return this.parseFunctionCall();
      }
      if (this.current.type === "paren" && this.current.value === "(") {
        this.consume("paren", "(");
        const node = this.parseEquality();
        this.consume("paren", ")");
        return node;
      }
      throw new FormulaError(`意外的符号 ${this.current.value || "公式结尾"}`);
    } finally {
      this.depth--;
    }
  }

  parseFunctionCall() {
    const name = this.consume("identifier").value;
    this.consume("paren", "(");
    const args = [];

    if (!(this.current.type === "paren" && this.current.value === ")")) {
      do {
        args.push(this.parseEquality());
        if (this.current.type !== "comma") break;
        this.consume("comma");
      } while (true);
    }

    this.consume("paren", ")");
    validateArgumentCount(name, args.length);
    return { type: "call", name, args };
  }
}

function validateArgumentCount(name, count) {
  const exactCounts = { clamp: 3, floor: 1, ceil: 1, round: 1, abs: 1, if: 3 };
  if ((name === "min" || name === "max") && count < 1) {
    throw new FormulaError(`${name} 至少需要 1 个参数`);
  }
  if (name in exactCounts && count !== exactCounts[name]) {
    throw new FormulaError(`${name} 需要 ${exactCounts[name]} 个参数`);
  }
}

function evaluateNode(node, variables) {
  switch (node.type) {
    case "number":
      return node.value;
    case "variable":
      return variables[node.name];
    case "unary": {
      const value = evaluateNode(node.operand, variables);
      return node.operator === "-" ? -value : value;
    }
    case "binary":
      return evaluateBinary(node, variables);
    case "call":
      return evaluateFunction(node, variables);
    default:
      throw new FormulaError("未知公式节点");
  }
}

function evaluateBinary(node, variables) {
  const left = evaluateNode(node.left, variables);
  const right = evaluateNode(node.right, variables);

  switch (node.operator) {
    case "+": return assertFinite(left + right);
    case "-": return assertFinite(left - right);
    case "*": return assertFinite(left * right);
    case "/":
      if (right === 0) throw new FormulaError("不能除以 0");
      return assertFinite(left / right);
    case "%":
      if (right === 0) throw new FormulaError("不能对 0 取余");
      return assertFinite(left % right);
    case ">": return Number(left > right);
    case ">=": return Number(left >= right);
    case "<": return Number(left < right);
    case "<=": return Number(left <= right);
    case "==": return Number(left === right);
    case "!=": return Number(left !== right);
    default: throw new FormulaError(`不支持运算符 ${node.operator}`);
  }
}

function evaluateFunction(node, variables) {
  // if 采用惰性分支，未选中的表达式不会产生除零等无关错误。
  if (node.name === "if") {
    const condition = evaluateNode(node.args[0], variables);
    return evaluateNode(condition !== 0 ? node.args[1] : node.args[2], variables);
  }

  const args = node.args.map(arg => evaluateNode(arg, variables));
  switch (node.name) {
    case "min": return Math.min(...args);
    case "max": return Math.max(...args);
    case "clamp": return Math.min(args[2], Math.max(args[1], args[0]));
    case "floor": return Math.floor(args[0]);
    case "ceil": return Math.ceil(args[0]);
    case "round": return Math.round(args[0]);
    case "abs": return Math.abs(args[0]);
    default: throw new FormulaError(`不支持函数 ${node.name}`);
  }
}

function assertFinite(value, message = "运算结果不是有限数值") {
  if (!Number.isFinite(value)) throw new FormulaError(message);
  return value;
}

function formatNumber(value) {
  if (Object.is(value, -0)) return "0";
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(10)));
}

function warnOnce(expression, reason, options) {
  const label = options.label ? `（${options.label}）` : "";
  const key = `${expression}\u0000${reason}\u0000${label}`;
  if (WARNED_ERRORS.has(key)) return;
  WARNED_ERRORS.add(key);
  console.warn(`XJZL | 武学等级公式无效${label}：${expression}；${reason}`);
}
