// ---------------------------------------------------------------------------
// Safe expression evaluator for TRANSFORM formulas.
//
// Deliberately avoids eval()/new Function. A small hand-written lexer + Pratt
// parser turns the formula into an AST that is interpreted against a record.
// Supported syntax includes arithmetic, comparisons, boolean operators, field
// references ($field or {{field}}), literals and a curated function library.
// ---------------------------------------------------------------------------

export type Expr =
  | { type: 'lit'; value: unknown }
  | { type: 'field'; name: string }
  | { type: 'unary'; op: string; arg: Expr }
  | { type: 'binary'; op: string; left: Expr; right: Expr }
  | { type: 'call'; name: string; args: Expr[] };

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'field'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'eof' };

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}
function isIdStart(c: string): boolean {
  return /[A-Za-z_]/.test(c);
}
function isIdChar(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c);
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(input[i + 1] ?? ''))) {
      let j = i;
      while (j < n && isDigit(input[j])) j++;
      if (input[j] === '.' && isDigit(input[j + 1] ?? '')) {
        j++;
        while (j < n && isDigit(input[j])) j++;
      }
      tokens.push({ t: 'num', v: parseFloat(input.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      let out = '';
      while (j < n) {
        const ch = input[j];
        if (ch === '\\') {
          const nx = input[j + 1];
          if (nx === 'n') out += '\n';
          else if (nx === 't') out += '\t';
          else out += nx ?? '';
          j += 2;
          continue;
        }
        if (ch === quote) break;
        out += ch;
        j++;
      }
      if (j >= n) throw new Error(`Unterminated string literal at position ${i}.`);
      tokens.push({ t: 'str', v: out });
      i = j + 1;
      continue;
    }
    if (c === '$') {
      let j = i + 1;
      while (j < n && isIdChar(input[j])) j++;
      if (j === i + 1) throw new Error(`Expected field name after "$" at position ${i}.`);
      tokens.push({ t: 'field', v: input.slice(i + 1, j) });
      i = j;
      continue;
    }
    if (c === '{' && input[i + 1] === '{') {
      let j = i + 2;
      while (j < n && input[j] !== '}' && input[j + 1] !== '}') j++;
      const raw = input.slice(i + 2, j);
      if (!raw.trim()) throw new Error(`Empty field reference at position ${i}.`);
      tokens.push({ t: 'field', v: raw.trim() });
      i = j + 2;
      continue;
    }
    if (isIdStart(c)) {
      let j = i;
      while (j < n && isIdChar(input[j])) j++;
      tokens.push({ t: 'id', v: input.slice(i, j) });
      i = j;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (two === '**' || two === '==' || two === '!=' || two === '>=' || two === '<=' || two === '&&' || two === '||') {
      tokens.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/%<>(),'.includes(c)) {
      tokens.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${c}" at position ${i}.`);
  }
  tokens.push({ t: 'eof' });
  return tokens;
}

const PREC: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 3,
  '>': 3,
  '<=': 3,
  '>=': 3,
  '+': 4,
  '-': 4,
  '*': 5,
  '/': 5,
  '%': 5,
  '**': 6,
};

class Parser {
  private toks: Token[];
  private i = 0;
  constructor(toks: Token[]) {
    this.toks = toks;
  }
  private peek(): Token {
    return this.toks[this.i];
  }
  private next(): Token {
    return this.toks[this.i++];
  }
  private expectOp(v: string): void {
    const tok = this.next();
    if (tok.t !== 'op' || tok.v !== v) {
      throw new Error(`Expected "${v}" in expression.`);
    }
  }
  parse(): Expr {
    const e = this.parseExpr(0);
    const tok = this.peek();
    if (tok.t !== 'eof') throw new Error('Unexpected trailing tokens in expression.');
    return e;
  }
  private parseExpr(minPrec: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      const tok = this.peek();
      if (tok.t !== 'op') break;
      const op = tok.v;
      const prec = PREC[op];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const nextMin = op === '**' ? prec : prec + 1;
      const right = this.parseExpr(nextMin);
      left = { type: 'binary', op, left, right };
    }
    return left;
  }
  private parseUnary(): Expr {
    const tok = this.peek();
    if (tok.t === 'op' && (tok.v === '-' || tok.v === '+')) {
      this.next();
      return { type: 'unary', op: tok.v, arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }
  private parsePrimary(): Expr {
    const tok = this.next();
    if (tok.t === 'num' || tok.t === 'str') return { type: 'lit', value: tok.v };
    if (tok.t === 'field') return { type: 'field', name: tok.v };
    if (tok.t === 'id') {
      if (tok.v === 'true') return { type: 'lit', value: true };
      if (tok.v === 'false') return { type: 'lit', value: false };
      if (tok.v === 'null') return { type: 'lit', value: null };
      // function call
      if (this.peek().t === 'op' && (this.peek() as { v: string }).v === '(') {
        this.next();
        const args: Expr[] = [];
        if (this.peek().t === 'op' && (this.peek() as { v: string }).v === ')') {
          this.next();
        } else {
          for (;;) {
            args.push(this.parseExpr(0));
            const nxt = this.next();
            if (nxt.t === 'op' && nxt.v === ')') break;
            if (nxt.t === 'op' && nxt.v === ',') continue;
            throw new Error(`Expected "," or ")" in call to "${tok.v}".`);
          }
        }
        return { type: 'call', name: tok.v, args };
      }
      throw new Error(`Unknown identifier "${tok.v}".`);
    }
    if (tok.t === 'op' && tok.v === '(') {
      const e = this.parseExpr(0);
      this.expectOp(')');
      return e;
    }
    throw new Error('Unexpected token in expression.');
  }
}

// ---------------------------------------------------------------------------
// Evaluation helpers
// ---------------------------------------------------------------------------

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Coerce a value to number, or undefined when impossible. */
function toNum(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const x = Number(v);
    return Number.isFinite(x) ? x : undefined;
  }
  return undefined;
}

function fmtNum(x: number): string {
  return Number.isInteger(x)
    ? String(x)
    : String(Math.round(x * 1e6) / 1e6);
}

export function formatNumber(x: number): string {
  return fmtNum(x);
}

function seg(n: number): string {
  return n.toLocaleString('en-US');
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return fmtNum(v);
  return String(v);
}

function compareEq(a: unknown, b: unknown): boolean {
  const na = toNum(a);
  const nb = toNum(b);
  if (na !== undefined && nb !== undefined) return na === nb;
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a === null || a === undefined) && (b === null || b === undefined);
  }
  return toStr(a) === toStr(b);
}

function compareOrd(a: unknown, b: unknown, op: string): boolean {
  const na = toNum(a);
  const nb = toNum(b);
  let x: number | undefined;
  let y: number | undefined;
  if (na !== undefined && nb !== undefined) {
    x = na;
    y = nb;
  } else {
    const sa = toStr(a);
    const sb = toStr(b);
    x = sa < sb ? -1 : sa > sb ? 1 : 0;
    y = 0;
  }
  switch (op) {
    case '<':
      return x < y;
    case '>':
      return x > y;
    case '<=':
      return x <= y;
    case '>=':
      return x >= y;
  }
  return false;
}

const FUNCTIONS: Record<string, (...args: unknown[]) => unknown> = {
  round: (x: unknown, p: unknown = 0) => {
    const n = toNum(x);
    const digits = toNum(p) ?? 0;
    if (n === undefined) return null;
    const f = Math.pow(10, digits);
    return Math.round(n * f) / f;
  },
  floor: (x: unknown) => {
    const n = toNum(x);
    return n === undefined ? null : Math.floor(n);
  },
  ceil: (x: unknown) => {
    const n = toNum(x);
    return n === undefined ? null : Math.ceil(n);
  },
  abs: (x: unknown) => {
    const n = toNum(x);
    return n === undefined ? null : Math.abs(n);
  },
  min: (...args: unknown[]) => {
    const nums = args.map((a) => toNum(a)).filter((n) => n !== undefined) as number[];
    return nums.length ? Math.min(...nums) : null;
  },
  max: (...args: unknown[]) => {
    const nums = args.map((a) => toNum(a)).filter((n) => n !== undefined) as number[];
    return nums.length ? Math.max(...nums) : null;
  },
  upper: (s: unknown) => toStr(s).toUpperCase(),
  lower: (s: unknown) => toStr(s).toLowerCase(),
  trim: (s: unknown) => toStr(s).trim(),
  replace: (s: unknown, from: unknown, to: unknown) => toStr(s).split(toStr(from)).join(toStr(to)),
  substring: (s: unknown, start: unknown, len?: unknown) => {
    const str = toStr(s);
    const st = toNum(start) ?? 0;
    if (len === undefined) return str.substring(st);
    return str.substring(st, st + (toNum(len) ?? 0));
  },
  length: (v: unknown) => {
    if (typeof v === 'string') return v.length;
    if (Array.isArray(v)) return v.length;
    if (v === null || v === undefined) return 0;
    return toStr(v).length;
  },
  concat: (...args: unknown[]) => args.map((a) => toStr(a)).join(''),
  toString: (v: unknown) => toStr(v),
  toNumber: (v: unknown) => toNum(v) ?? null,
  currency: (x: unknown) => {
    const n = toNum(x);
    if (n === undefined) return '';
    return '$' + seg(Math.round(n * 100) / 100);
  },
  percent: (x: unknown, d: unknown = 0) => {
    const n = toNum(x);
    if (n === undefined) return '';
    const digits = toNum(d) ?? 0;
    const f = Math.pow(10, digits);
    return (Math.round(n * f) / f) + '%';
  },
  upperFirst: (s: unknown) => {
    const str = toStr(s);
    return str ? str[0].toUpperCase() + str.slice(1) : '';
  },
  if: (cond: unknown, a: unknown, b: unknown) => (cond === true ? a : b),
  coalesce: (...args: unknown[]) => args.find((a) => a !== null && a !== undefined) ?? null,
  date: (v: unknown) => {
    const s = toStr(v);
    if (!s) return '';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
  },
};

function evalExpr(e: Expr, record: Record<string, unknown>): unknown {
  switch (e.type) {
    case 'lit':
      return e.value;
    case 'field': {
      const v = record[e.name];
      return v === undefined ? null : v;
    }
    case 'unary': {
      const v = evalExpr(e.arg, record);
      if (e.op === '-') {
        const n = toNum(v);
        return n === undefined ? null : -n;
      }
      return v;
    }
    case 'binary': {
      const l = evalExpr(e.left, record);
      const r = evalExpr(e.right, record);
      switch (e.op) {
        case '&&':
          return l === true && r === true;
        case '||':
          return l === true || r === true;
        case '==':
          return compareEq(l, r);
        case '!=':
          return !compareEq(l, r);
        case '<':
        case '>':
        case '<=':
        case '>=':
          return compareOrd(l, r, e.op);
        case '+': {
          if (typeof l === 'string' || typeof r === 'string') {
            return toStr(l) + toStr(r);
          }
          const a = toNum(l);
          const b = toNum(r);
          return a === undefined || b === undefined ? null : a + b;
        }
        case '-': {
          const a = toNum(l);
          const b = toNum(r);
          return a === undefined || b === undefined ? null : a - b;
        }
        case '*': {
          const a = toNum(l);
          const b = toNum(r);
          return a === undefined || b === undefined ? null : a * b;
        }
        case '/': {
          const a = toNum(l);
          const b = toNum(r);
          if (a === undefined || b === undefined) return null;
          if (b === 0) throw new Error('Division by zero.');
          return a / b;
        }
        case '%': {
          const a = toNum(l);
          const b = toNum(r);
          if (a === undefined || b === undefined) return null;
          if (b === 0) throw new Error('Modulo by zero.');
          return a % b;
        }
        case '**': {
          const a = toNum(l);
          const b = toNum(r);
          return a === undefined || b === undefined ? null : Math.pow(a, b);
        }
      }
      return null;
    }
    case 'call': {
      const args = e.args.map((a) => evalExpr(a, record));
      const fn = FUNCTIONS[e.name];
      if (!fn) throw new Error(`Unknown function "${e.name}".`);
      return fn(...args);
    }
  }
}

export interface CompiledFormula {
  ok: boolean;
  error?: string;
  fn?: (record: Record<string, unknown>) => unknown;
}

export function compileFormula(formula: string): CompiledFormula {
  if (!formula || !formula.trim()) {
    return { ok: false, error: 'Formula is empty.' };
  }
  try {
    const tokens = tokenize(formula);
    const ast = new Parser(tokens).parse();
    return {
      ok: true,
      fn: (record) => evalExpr(ast, record),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function safeEvaluate(
  formula: string,
  record: Record<string, unknown>,
): { ok: boolean; value?: unknown; error?: string } {
  const compiled = compileFormula(formula);
  if (!compiled.ok || !compiled.fn) {
    return { ok: false, error: compiled.error };
  }
  try {
    return { ok: true, value: compiled.fn(record) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
