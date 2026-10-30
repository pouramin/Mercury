import type { ConditionGroup } from '../types';

// ---------------------------------------------------------------------------
// Condition matching for FILTER and CONDITION nodes
// ---------------------------------------------------------------------------

const NUMERIC_OPS = new Set(['gt', 'gte', 'lt', 'lte']);

export function toNumberMaybe(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const x = Number(v);
    return Number.isFinite(x) ? x : undefined;
  }
  return undefined;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  return String(v);
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * Match a single row against a record. Missing fields behave as null and
 * comparisons involving null are false unless explicitly checking emptiness.
 */
export function matchRow(field: string, op: string, rawValue: string, record: Record<string, unknown>): boolean {
  const actual = record[field] === undefined ? null : record[field];

  switch (op) {
    case 'isEmpty':
      return actual === null || actual === undefined || toStr(actual) === '';
    case 'isNotEmpty':
      return actual !== null && actual !== undefined && toStr(actual) !== '';
    case 'eq':
    case 'neq': {
      const target = actual === null ? null : rawValue;
      const a = toNumberMaybe(actual);
      const b = toNumberMaybe(rawValue);
      let equal: boolean;
      if (a !== undefined && b !== undefined) {
        equal = a === b;
      } else if (actual === null) {
        equal = rawValue.trim() === '';
      } else {
        equal = toStr(actual).toLowerCase() === String(rawValue).trim().toLowerCase();
      }
      return op === 'eq' ? equal : !equal;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = toNumberMaybe(actual);
      const b = toNumberMaybe(rawValue);
      if (a === undefined || b === undefined) {
        // String fallback comparison for non-numeric fields (e.g. ISO dates)
        const sa = toStr(actual);
        const sb = String(rawValue).trim();
        if (sa === '' && sb === '') return false;
        switch (op) {
          case 'gt':
            return sa > sb;
          case 'gte':
            return sa >= sb;
          case 'lt':
            return sa < sb;
          case 'lte':
            return sa <= sb;
        }
      }
      switch (op) {
        case 'gt':
          return a > b;
        case 'gte':
          return a >= b;
        case 'lt':
          return a < b;
        case 'lte':
          return a <= b;
      }
      return false;
    }
    case 'contains':
      return toStr(actual).toLowerCase().includes(String(rawValue).toLowerCase());
    case 'notContains':
      return !toStr(actual).toLowerCase().includes(String(rawValue).toLowerCase());
    case 'startsWith':
      return toStr(actual).toLowerCase().startsWith(String(rawValue).toLowerCase());
    case 'endsWith':
      return toStr(actual).toLowerCase().endsWith(String(rawValue).toLowerCase());
    case 'in': {
      const list = splitList(rawValue);
      const a = toNumberMaybe(actual);
      return list.some((item) => {
        const b = toNumberMaybe(item);
        if (a !== undefined && b !== undefined) return a === b;
        return toStr(actual).toLowerCase() === item.toLowerCase();
      });
    }
    case 'notIn': {
      const list = splitList(rawValue);
      const a = toNumberMaybe(actual);
      const hit = list.some((item) => {
        const b = toNumberMaybe(item);
        if (a !== undefined && b !== undefined) return a === b;
        return toStr(actual).toLowerCase() === item.toLowerCase();
      });
      return !hit;
    }
    default:
      return false;
  }
}

export function matchesConditionGroup(group: ConditionGroup, record: Record<string, unknown>): boolean {
  const rows = group?.rows ?? [];
  if (rows.length === 0) return true; // empty condition matches everything
  const combinator = group?.combinator === 'or' ? 'or' : 'and';
  if (combinator === 'or') {
    return rows.some((r) => matchRow(r.field, r.op, r.value, record));
  }
  return rows.every((r) => matchRow(r.field, r.op, r.value, record));
}

export interface ConditionValidity {
  ok: boolean;
  errors: string[];
}

export function validateConditionGroup(group: ConditionGroup): ConditionValidity {
  const errors: string[] = [];
  for (const r of group?.rows ?? []) {
    if (!r.field.trim()) errors.push('A condition is missing a field name.');
    if (NUMERIC_OPS.has(r.op) && r.value.trim() === '' && r.op !== 'isEmpty' && r.op !== 'isNotEmpty') {
      // numeric ops require a value
      errors.push(`Condition on "${r.field || '?'}" expects a numeric value.`);
    }
    if ((r.op === 'eq' || r.op === 'neq' || r.op === 'in' || r.op === 'notIn') && r.value.trim() === '') {
      errors.push(`Condition on "${r.field || '?'}" requires a value.`);
    }
  }
  return { ok: errors.length === 0, errors };
}
