// ---------------------------------------------------------------------------
// CSV serialization of record datasets
// ---------------------------------------------------------------------------

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'object') {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function recordsToCsv(records: unknown[]): string {
  if (records.length === 0) return '';
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    if (typeof rec !== 'object' || rec === null) continue;
    for (const k of Object.keys(rec as Record<string, unknown>)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  if (keys.length === 0) return '';
  const lines: string[] = [keys.map(escapeCell).join(',')];
  for (const rec of records) {
    if (typeof rec !== 'object' || rec === null) continue;
    const row = rec as Record<string, unknown>;
    lines.push(keys.map((k) => escapeCell(row[k])).join(','));
  }
  return lines.join('\r\n');
}

export function downloadTextFile(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
