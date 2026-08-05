const MAX_LENGTH = 128;
const MAX_TOKENS = 128;

export class EncounterFormulaError extends Error {
  constructor(message) {
    super(message);
    this.name = "EncounterFormulaError";
  }
}

function message(key, fallback, data = {}) {
  const i18n = globalThis.game?.i18n;
  return i18n ? i18n.format(`XJZL.Encounter.FormulaErrors.${key}`, data) : fallback;
}

/**
 * 安全计算战局数值公式；唯一允许的变量是有限数值 `@round`。
 * @param {string|number} expression 固定值或四则运算表达式
 * @param {number} round 当前轮次
 * @returns {number} 有限数值结果
 */
export function evaluateEncounterFormula(expression, round) {
  const source = String(expression ?? "").trim();
  if (!source) throw new EncounterFormulaError(message("Empty", "公式不能为空"));
  if (source.length > MAX_LENGTH) throw new EncounterFormulaError(message("TooLong", `公式不能超过 ${MAX_LENGTH} 个字符`, { max: MAX_LENGTH }));

  const tokens = tokenize(source);
  let cursor = 0;
  const current = () => tokens[cursor];
  const consume = (type, value) => {
    const token = current();
    if (!token || token.type !== type || (value !== undefined && token.value !== value)) {
      throw new EncounterFormulaError(message("Expected", `应为 ${value ?? type}`, { token: value ?? type }));
    }
    cursor++;
    return token;
  };

  const primary = () => {
    if (current().type === "number") return consume("number").value;
    if (current().type === "variable") {
      consume("variable");
      const value = Number(round);
      if (!Number.isFinite(value)) throw new EncounterFormulaError(message("RoundFinite", "变量 @round 不是有限数值"));
      return value;
    }
    if (current().value === "(") {
      consume("paren", "(");
      const value = additive();
      consume("paren", ")");
      return value;
    }
    throw new EncounterFormulaError(message("Unexpected", `意外的符号 ${current().value || "公式结尾"}`, { token: current().value || message("End", "公式结尾") }));
  };
  const unary = () => {
    if (current().type === "operator" && ["+", "-"].includes(current().value)) {
      const operator = consume("operator").value;
      const value = unary();
      return operator === "-" ? -value : value;
    }
    return primary();
  };
  const multiplicative = () => {
    let value = unary();
    while (current().type === "operator" && ["*", "/"].includes(current().value)) {
      const operator = consume("operator").value;
      const right = unary();
      if (operator === "/" && right === 0) throw new EncounterFormulaError(message("DivideZero", "不能除以 0"));
      value = operator === "*" ? value * right : value / right;
      if (!Number.isFinite(value)) throw new EncounterFormulaError(message("NonFinite", "公式结果不是有限数值"));
    }
    return value;
  };
  const additive = () => {
    let value = multiplicative();
    while (current().type === "operator" && ["+", "-"].includes(current().value)) {
      const operator = consume("operator").value;
      const right = multiplicative();
      value = operator === "+" ? value + right : value - right;
      if (!Number.isFinite(value)) throw new EncounterFormulaError(message("NonFinite", "公式结果不是有限数值"));
    }
    return value;
  };

  const result = additive();
  consume("eof");
  return result;
}

/** 将白名单表达式切分为有限 token，非法变量和字符在进入解析器前即拒绝。 */
function tokenize(source) {
  const tokens = [];
  let cursor = 0;
  const push = (type, value) => {
    tokens.push({ type, value });
    if (tokens.length > MAX_TOKENS) throw new EncounterFormulaError(message("TooComplex", "公式过于复杂"));
  };
  while (cursor < source.length) {
    const rest = source.slice(cursor);
    const char = source[cursor];
    if (/\s/.test(char)) { cursor++; continue; }
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) { push("number", Number(number[0])); cursor += number[0].length; continue; }
    const variable = rest.match(/^@([A-Za-z][A-Za-z0-9]*)/);
    if (variable) {
      if (variable[1] !== "round") throw new EncounterFormulaError(message("UnsupportedVariable", `不支持变量 @${variable[1]}`, { variable: variable[1] }));
      push("variable", "round"); cursor += variable[0].length; continue;
    }
    if ("+-*/".includes(char)) { push("operator", char); cursor++; continue; }
    if (char === "(" || char === ")") { push("paren", char); cursor++; continue; }
    throw new EncounterFormulaError(message("UnsupportedCharacter", `不支持字符 ${char}`, { character: char }));
  }
  push("eof", "");
  return tokens;
}
