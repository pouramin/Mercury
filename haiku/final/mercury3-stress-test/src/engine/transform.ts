import type { DataRecord, TransformOp } from '../types';
import { evaluateExpression, parseExpression } from './expression';

export interface TransformResult {
  record: DataRecord;
  /** Number of problems (missing fields, invalid math) encountered while transforming. */
  warnings: number;
}

type Step = (record: DataRecord) => TransformResult;

/** Returns a problem with a transform operation, or null when it is valid. */
export function validateTransformOp(op: TransformOp): string | null {
  switch (op.type) {
    case 'rename':
      if (op.from.trim() === '' || op.to.trim() === '') return 'Rename needs both a source and a target field.';
      return null;
    case 'compute': {
      if (op.target.trim() === '') return 'Compute needs a target field name.';
      try {
        parseExpression(op.expression);
        return null;
      } catch (err) {
        return `Invalid expression "${op.expression}": ${(err as Error).message}`;
      }
    }
    case 'set':
      if (op.target.trim() === '') return 'Set needs a target field name.';
      if (op.valueType === 'number' && Number.isNaN(Number(op.value))) return `"${op.value}" is not a valid number.`;
      return null;
    case 'remove':
      return op.field.trim() === '' ? 'Remove needs a field name.' : null;
    case 'case':
      return op.field.trim() === '' ? 'Case change needs a field name.' : null;
  }
}

function compileOp(op: TransformOp): Step {
  const problem = validateTransformOp(op);
  if (problem) throw new Error(problem);

  switch (op.type) {
    case 'rename':
      return (record) => {
        if (!Object.prototype.hasOwnProperty.call(record, op.from)) {
          return { record, warnings: 1 };
        }
        const next: DataRecord = { ...record };
        next[op.to] = record[op.from];
        if (op.from !== op.to) delete next[op.from];
        return { record: next, warnings: 0 };
      };
    case 'compute': {
      const expr = parseExpression(op.expression);
      return (record) => {
        const value = evaluateExpression(expr, record);
        return { record: { ...record, [op.target]: value }, warnings: value === null ? 1 : 0 };
      };
    }
    case 'set': {
      const value = literalValue(op.value, op.valueType);
      return (record) => ({ record: { ...record, [op.target]: value }, warnings: 0 });
    }
    case 'remove':
      return (record) => {
        if (!Object.prototype.hasOwnProperty.call(record, op.field)) return { record, warnings: 0 };
        const next: DataRecord = { ...record };
        delete next[op.field];
        return { record: next, warnings: 0 };
      };
    case 'case':
      return (record) => {
        const current = record[op.field];
        if (typeof current !== 'string') return { record, warnings: current === undefined ? 1 : 0 };
        const converted = op.mode === 'upper' ? current.toUpperCase() : current.toLowerCase();
        return { record: { ...record, [op.field]: converted }, warnings: 0 };
      };
  }
}

function literalValue(raw: string, valueType: 'string' | 'number' | 'boolean' | 'null'): unknown {
  switch (valueType) {
    case 'number':
      return Number(raw);
    case 'boolean':
      return raw.trim().toLowerCase() === 'true';
    case 'null':
      return null;
    case 'string':
      return raw;
  }
}

/** Compiles transform operations into a pure function. Inputs are never mutated. */
export function compileTransform(ops: TransformOp[]): (record: DataRecord) => TransformResult {
  const steps = ops.map(compileOp);
  return (input) => {
    let record: DataRecord = input;
    let warnings = 0;
    for (const step of steps) {
      const result = step(record);
      record = result.record;
      warnings += result.warnings;
    }
    return { record: record === input ? { ...input } : record, warnings };
  };
}
