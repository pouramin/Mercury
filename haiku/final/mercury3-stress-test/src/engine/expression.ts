// A small, safe arithmetic expression language used by Transform nodes.
// It is parsed into an AST and interpreted; user text is never passed to eval()
// or the Function constructor.

import type { DataRecord } from '../types';
import { getField } from './fields';

export class ExpressionError extends Error {}

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'field'; name: string }
  | { kind: 'neg'; arg: Expr }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/' | '%'; left: Expr; right: Expr }
  | { kind: 'call'; name: string; args: Expr[] };

interface FunctionSpec {
  min: number;
  max: number;
  apply: (args: number[]) => number;
}

const FUNCTIONS: Record<string, FunctionSpec> = {
  round: {
    min: 1,
    max: 2,
    apply: ([x, digits = 0]) => {
      const factor = 10 ** digits;
      return Math.round(x * factor) / factor;
    },
  },
  floor: { min: 1, max: 1, apply: ([x]) => Math.floor(x) },
  ceil: { min: 1, max: 1, apply: ([x]) => Math.ceil(x) },
  abs: { min: 1, max: 1, apply: ([x]) => Math.abs(x) },
  min: { min: 1, max: 32, apply: (args) => Math.min(...args) },
  max: { min: 1, max: 32, apply: (args) => Math.max(...args) },
};

export const MAX_EXPRESSION_LENGTH = 300;

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'id'; name: string }
  | { kind: 'op'; value: string }
  | { kind: 'end' };

const NUMBER_RE = /\d+(\.\d+)?/y;
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_.]*/y;
const OP_RE = /[+\-*/%(),]/y;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    NUMBER_RE.lastIndex = i;
    const num = NUMBER_RE.exec(source);
    if (num) {
      tokens.push({ kind: 'num', value: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    IDENT_RE.lastIndex = i;
    const ident = IDENT_RE.exec(source);
    if (ident) {
      tokens.push({ kind: 'id', name: ident[0] });
      i += ident[0].length;
      continue;
    }
    OP_RE.lastIndex = i;
    const op = OP_RE.exec(source);
    if (op) {
      tokens.push({ kind: 'op', value: op[0] });
      i += 1;
      continue;
    }
    throw new ExpressionError(`Unexpected character "${ch}" at position ${i + 1}.`);
  }
  tokens.push({ kind: 'end' });
  return tokens;
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Expr {
    const expr = this.parseSum();
    const next = this.peek();
    if (next.kind !== 'end') {
      throw new ExpressionError(`Unexpected ${describe(next)} after complete expression.`);
    }
    return expr;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    this.pos++;
    return token;
  }

  private isOp(token: Token, values: string[]): token is { kind: 'op'; value: string } {
    return token.kind === 'op' && values.includes(token.value);
  }

  private parseSum(): Expr {
    let left = this.parseProduct();
    while (this.isOp(this.peek(), ['+', '-'])) {
      const op = (this.advance() as { value: string }).value as '+' | '-';
      const right = this.parseProduct();
      left = { kind: 'bin', op, left, right };
    }
    return left;
  }

  private parseProduct(): Expr {
    let left = this.parseUnary();
    while (this.isOp(this.peek(), ['*', '/', '%'])) {
      const op = (this.advance() as { value: string }).value as '*' | '/' | '%';
      const right = this.parseUnary();
      left = { kind: 'bin', op, left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.isOp(this.peek(), ['-'])) {
      this.advance();
      return { kind: 'neg', arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const token = this.advance();
    if (token.kind === 'num') return { kind: 'num', value: token.value };
    if (token.kind === 'id') {
      if (this.isOp(this.peek(), ['('])) {
        return this.parseCall(token.name);
      }
      return { kind: 'field', name: token.name };
    }
    if (this.isOp(token, ['('])) {
      const inner = this.parseSum();
      const closing = this.advance();
      if (!this.isOp(closing, [')'])) {
        throw new ExpressionError('Missing closing parenthesis ")".');
      }
      return inner;
    }
    throw new ExpressionError(`Expected a number, field or "(" but found ${describe(token)}.`);
  }

  private parseCall(name: string): Expr {
    if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, name)) {
      throw new ExpressionError(`Unknown function "${name}". Supported: ${Object.keys(FUNCTIONS).join(', ')}.`);
    }
    this.advance(); // consume "("
    const args: Expr[] = [];
    if (!this.isOp(this.peek(), [')'])) {
      args.push(this.parseSum());
      while (this.isOp(this.peek(), [','])) {
        this.advance();
        args.push(this.parseSum());
      }
    }
    const closing = this.advance();
    if (!this.isOp(closing, [')'])) {
      throw new ExpressionError(`Missing closing parenthesis in call to ${name}().`);
    }
    const spec = FUNCTIONS[name];
    if (args.length < spec.min || args.length > spec.max) {
      throw new ExpressionError(`${name}() expects ${spec.min === spec.max ? spec.min : `${spec.min}-${spec.max}`} argument(s), got ${args.length}.`);
    }
    return { kind: 'call', name, args };
  }
}

function describe(token: Token): string {
  switch (token.kind) {
    case 'num':
      return `number ${token.value}`;
    case 'id':
      return `identifier "${token.name}"`;
    case 'op':
      return `"${token.value}"`;
    case 'end':
      return 'end of expression';
  }
}

export function parseExpression(source: string): Expr {
  if (source.trim() === '') {
    throw new ExpressionError('Expression is empty.');
  }
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new ExpressionError(`Expression is longer than ${MAX_EXPRESSION_LENGTH} characters.`);
  }
  return new Parser(tokenize(source)).parse();
}

function toNumeric(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Evaluates an expression against one record. Returns null when any referenced
 * field is missing or non-numeric, or when the result is not a finite number.
 */
export function evaluateExpression(expr: Expr, record: DataRecord): number | null {
  const result = evaluateNode(expr, record);
  return result !== null && Number.isFinite(result) ? result : null;
}

function evaluateNode(expr: Expr, record: DataRecord): number | null {
  switch (expr.kind) {
    case 'num':
      return expr.value;
    case 'field':
      return toNumeric(getField(record, expr.name));
    case 'neg': {
      const value = evaluateNode(expr.arg, record);
      return value === null ? null : -value;
    }
    case 'bin': {
      const left = evaluateNode(expr.left, record);
      const right = evaluateNode(expr.right, record);
      if (left === null || right === null) return null;
      switch (expr.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return right === 0 ? null : left / right;
        case '%':
          return right === 0 ? null : left % right;
      }
      return null;
    }
    case 'call': {
      const values: number[] = [];
      for (const arg of expr.args) {
        const value = evaluateNode(arg, record);
        if (value === null) return null;
        values.push(value);
      }
      return FUNCTIONS[expr.name].apply(values);
    }
  }
}
