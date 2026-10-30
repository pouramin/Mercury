import type { Condition, DataRecord, Operator } from '../types';
import { getField, hasField } from './fields';

export interface OperatorInfo {
  value: Operator;
  label: string;
  needsValue: boolean;
  numeric: boolean;
}

export const OPERATORS: OperatorInfo[] = [
  { value: 'eq', label: 'equals', needsValue: true, numeric: false },
  { value: 'neq', label: 'does not equal', needsValue: true, numeric: false },
  { value: 'gt', label: 'greater than', needsValue: true, numeric: true },
  { value: 'gte', label: 'at least (>=)', needsValue: true, numeric: true },
  { value: 'lt', label: 'less than', needsValue: true, numeric: true },
  { value: 'lte', label: 'at most (<=)', needsValue: true, numeric: true },
  { value: 'contains', label: 'contains text', needsValue: true, numeric: false },
  { value: 'startsWith', label: 'starts with', needsValue: true, numeric: false },
  { value: 'in', label: 'is one of (comma list)', needsValue: true, numeric: false },
  { value: 'matches', label: 'matches regex', needsValue: true, numeric: false },
  { value: 'exists', label: 'exists', needsValue: false, numeric: false },
];

export type Predicate = (record: DataRecord) => boolean;

/** Returns a human-readable problem with a condition, or null when it is valid. */
export function validateCondition(condition: Condition): string | null {
  if (condition.field.trim() === '') return 'Field name is required.';
  const info = OPERATORS.find((op) => op.value === condition.operator);
  if (!info) return `Unknown operator "${String(condition.operator)}".`;
  if (info.numeric && condition.value.trim() !== '' && Number.isNaN(Number(condition.value))) {
    return `"${info.label}" on field "${condition.field}" needs a numeric value, got "${condition.value}".`;
  }
  if (info.numeric && condition.value.trim() === '') {
    return `"${info.label}" on field "${condition.field}" needs a numeric value.`;
  }
  if (condition.operator === 'matches') {
    try {
      new RegExp(condition.value, 'i');
    } catch {
      return `Invalid regular expression "${condition.value}".`;
    }
  }
  return null;
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Compiles a validated condition into a predicate. Missing fields never satisfy a
 * positive condition; they satisfy "does not equal".
 */
export function compileCondition(condition: Condition): Predicate {
  const problem = validateCondition(condition);
  if (problem) throw new Error(problem);

  const { field, value } = condition;
  const target = value;
  const targetLower = value.toLowerCase();
  const targetNumber = Number(value);
  const list = value.split(',').map((item) => item.trim());
  const regex = condition.operator === 'matches' ? new RegExp(value, 'i') : null;

  switch (condition.operator) {
    case 'exists':
      return (record) => hasField(record, field);
    case 'neq':
      return (record) => {
        if (!hasField(record, field)) return true;
        return !equalsValue(getField(record, field), target);
      };
    case 'eq':
      return (record) => hasField(record, field) && equalsValue(getField(record, field), target);
    case 'gt':
      return (record) => compareNumeric(record, field, (n) => n > targetNumber);
    case 'gte':
      return (record) => compareNumeric(record, field, (n) => n >= targetNumber);
    case 'lt':
      return (record) => compareNumeric(record, field, (n) => n < targetNumber);
    case 'lte':
      return (record) => compareNumeric(record, field, (n) => n <= targetNumber);
    case 'contains':
      return (record) => hasField(record, field) && String(getField(record, field)).toLowerCase().includes(targetLower);
    case 'startsWith':
      return (record) => hasField(record, field) && String(getField(record, field)).toLowerCase().startsWith(targetLower);
    case 'in':
      return (record) => hasField(record, field) && list.some((item) => equalsValue(getField(record, field), item));
    case 'matches':
      return (record) => hasField(record, field) && regex !== null && regex.test(String(getField(record, field)));
  }
}

function equalsValue(raw: unknown, target: string): boolean {
  const asNumber = toNumber(raw);
  const targetNumber = toNumber(target);
  if (asNumber !== null && targetNumber !== null && typeof raw !== 'string') {
    return asNumber === targetNumber;
  }
  return String(raw) === target;
}

function compareNumeric(record: DataRecord, field: string, test: (n: number) => boolean): boolean {
  const n = toNumber(getField(record, field));
  return n !== null && test(n);
}

export type Combinator = 'all' | 'any';

export function compileConditionGroup(combinator: Combinator, conditions: Condition[]): Predicate {
  const predicates = conditions.map(compileCondition);
  if (predicates.length === 0) return () => true;
  if (combinator === 'any') return (record) => predicates.some((p) => p(record));
  return (record) => predicates.every((p) => p(record));
}
