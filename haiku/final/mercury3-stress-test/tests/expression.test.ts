import { describe, expect, it } from 'vitest';
import { ExpressionError, evaluateExpression, parseExpression } from '../src/engine/expression';
import { compileCondition, validateCondition } from '../src/engine/conditions';
import { compileTransform, validateTransformOp } from '../src/engine/transform';
import type { DataRecord, TransformOp } from '../src/types';

const evalText = (text: string, record: DataRecord = {}) => evaluateExpression(parseExpression(text), record);

describe('expression language', () => {
  it('respects operator precedence and parentheses', () => {
    expect(evalText('1 + 2 * 3')).toBe(7);
    expect(evalText('(1 + 2) * 3')).toBe(9);
    expect(evalText('10 - 4 - 3')).toBe(3);
    expect(evalText('7 % 4')).toBe(3);
  });

  it('supports unary minus and functions', () => {
    expect(evalText('-2 * -3')).toBe(6);
    expect(evalText('round(1.236, 2)')).toBe(1.24);
    expect(evalText('min(3, 1, 2)')).toBe(1);
    expect(evalText('max(3, 1, 2)')).toBe(3);
    expect(evalText('abs(-5)')).toBe(5);
  });

  it('reads fields from the record, including dot paths', () => {
    const record = { quantity: 3, unitPrice: 19.99, customer: { credit: 50 } };
    expect(evalText('quantity * unitPrice', record)).toBeCloseTo(59.97, 5);
    expect(evalText('customer.credit / 2', record)).toBe(25);
  });

  it('returns null for missing or non-numeric fields instead of crashing', () => {
    expect(evalText('quantity * price', { quantity: 2 })).toBeNull();
    expect(evalText('quantity + 1', { quantity: 'many' })).toBeNull();
    expect(evalText('quantity + 1', { quantity: '4' })).toBe(5);
  });

  it('returns null for division by zero and for prototype-style names', () => {
    expect(evalText('1 / 0')).toBeNull();
    expect(evalText('constructor + 1')).toBeNull();
  });

  it('rejects malformed expressions with a meaningful message', () => {
    expect(() => parseExpression('1 +')).toThrow(ExpressionError);
    expect(() => parseExpression('(1 + 2')).toThrow(/closing parenthesis/);
    expect(() => parseExpression('2 $ 3')).toThrow(/Unexpected character/);
    expect(() => parseExpression('')).toThrow(/empty/);
  });

  it('rejects unknown functions instead of executing them', () => {
    expect(() => parseExpression('eval(1)')).toThrow(/Unknown function "eval"/);
    expect(() => parseExpression('constructor(1)')).toThrow(/Unknown function/);
    expect(() => parseExpression('round()')).toThrow(/expects/);
  });
});

describe('conditions', () => {
  it('validates operators, numeric values and regular expressions', () => {
    expect(validateCondition({ id: 'a', field: 'x', operator: 'gt', value: 'abc' })).toMatch(/numeric/);
    expect(validateCondition({ id: 'a', field: 'x', operator: 'gt', value: '' })).toMatch(/numeric/);
    expect(validateCondition({ id: 'a', field: 'x', operator: 'matches', value: '(' })).toMatch(/regular expression/);
    expect(validateCondition({ id: 'a', field: '', operator: 'eq', value: '1' })).toMatch(/Field name/);
    expect(validateCondition({ id: 'a', field: 'x', operator: 'gte', value: '10' })).toBeNull();
  });

  it('compares numbers numerically and strings textually', () => {
    expect(compileCondition({ id: 'a', field: 'n', operator: 'gte', value: '250' })({ n: 250 })).toBe(true);
    expect(compileCondition({ id: 'a', field: 'n', operator: 'gte', value: '250' })({ n: '249.99' })).toBe(false);
    expect(compileCondition({ id: 'a', field: 's', operator: 'eq', value: 'Shipped' })({ s: 'Shipped' })).toBe(true);
    expect(compileCondition({ id: 'a', field: 's', operator: 'contains', value: 'ship' })({ s: 'Shipped' })).toBe(true);
    expect(compileCondition({ id: 'a', field: 's', operator: 'in', value: 'Shipped, Delivered' })({ s: 'Delivered' })).toBe(true);
  });

  it('treats missing fields as non-matching, except for "does not equal"', () => {
    expect(compileCondition({ id: 'a', field: 'n', operator: 'gt', value: '1' })({})).toBe(false);
    expect(compileCondition({ id: 'a', field: 'n', operator: 'neq', value: '1' })({})).toBe(true);
    expect(compileCondition({ id: 'a', field: 'n', operator: 'exists', value: '' })({ n: null })).toBe(false);
  });
});

describe('transform operations', () => {
  const run = (ops: TransformOp[], record: DataRecord) => compileTransform(ops)(record);

  it('computes new fields from expressions without mutating the input', () => {
    const input = { quantity: 4, unitPrice: 12.5 };
    const result = run([{ id: 'a', type: 'compute', target: 'total', expression: 'quantity * unitPrice' }], input);
    expect(result.record.total).toBe(50);
    expect(result.warnings).toBe(0);
    expect(input).toEqual({ quantity: 4, unitPrice: 12.5 });
  });

  it('renames, removes and re-cases fields', () => {
    const result = run(
      [
        { id: 'a', type: 'rename', from: 'cust', to: 'customer' },
        { id: 'b', type: 'remove', field: 'secret' },
        { id: 'c', type: 'case', field: 'country', mode: 'upper' },
      ],
      { cust: 'Ava', secret: 'x', country: 'canada' },
    );
    expect(result.record).toEqual({ customer: 'Ava', country: 'CANADA' });
  });

  it('counts missing inputs as warnings and writes null', () => {
    const result = run([{ id: 'a', type: 'compute', target: 'total', expression: 'quantity * unitPrice' }], { quantity: 2 });
    expect(result.record.total).toBeNull();
    expect(result.warnings).toBe(1);
  });

  it('sets literal values with the requested type', () => {
    const result = run(
      [
        { id: 'a', type: 'set', target: 'n', value: '42', valueType: 'number' },
        { id: 'b', type: 'set', target: 'flag', value: 'true', valueType: 'boolean' },
      ],
      {},
    );
    expect(result.record).toEqual({ n: 42, flag: true });
  });

  it('validates operations before they run', () => {
    expect(validateTransformOp({ id: 'a', type: 'compute', target: 'x', expression: '1 +' })).toMatch(/Invalid expression/);
    expect(validateTransformOp({ id: 'a', type: 'compute', target: '', expression: '1' })).toMatch(/target/);
    expect(validateTransformOp({ id: 'a', type: 'rename', from: '', to: 'x' })).toMatch(/source and a target/);
    expect(() => compileTransform([{ id: 'a', type: 'compute', target: 'x', expression: '(' }])).toThrow();
  });
});
