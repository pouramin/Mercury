import type { DataRecord } from '../types';

function escapeCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serializes records to RFC 4180-style CSV. Columns are the union of keys in first-seen order. */
export function toCsv(records: DataRecord[]): string {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  const lines = [columns.map(escapeCell).join(',')];
  for (const record of records) {
    lines.push(columns.map((column) => escapeCell(record[column])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
