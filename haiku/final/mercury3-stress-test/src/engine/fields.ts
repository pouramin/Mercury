import type { DataRecord } from '../types';

/** Reads a field by literal key first, then by dot path ("customer.name"). */
export function getField(record: DataRecord, field: string): unknown {
  if (Object.prototype.hasOwnProperty.call(record, field)) return record[field];
  if (!field.includes('.')) return undefined;
  let current: unknown = record;
  for (const part of field.split('.')) {
    if (current !== null && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, part)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

export function hasField(record: DataRecord, field: string): boolean {
  const value = getField(record, field);
  return value !== undefined && value !== null;
}
