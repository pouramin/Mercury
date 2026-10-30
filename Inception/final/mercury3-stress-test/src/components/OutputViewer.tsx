import { useState } from 'react';
import { Download } from 'lucide-react';
import { recordsToCsv, downloadTextFile } from '../utils/csv';

interface Props {
  title: string;
  records: unknown[];
  maxRows: number;
  prettyJson: boolean;
}

export function OutputViewer({ title, records, maxRows, prettyJson }: Props) {
  const [tab, setTab] = useState<'table' | 'json'>('table');
  const shown = records.slice(0, Math.max(1, maxRows || 200));

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const rec of shown) {
    if (typeof rec !== 'object' || rec === null) continue;
    for (const k of Object.keys(rec as Record<string, unknown>)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }

  const exportCsv = () => {
    downloadTextFile(`${title.replace(/[^\w-]+/g, '_')}.csv`, recordsToCsv(records), 'text/csv');
  };

  return (
    <div className="output-viewer">
      <div className="ov-tabs">
        <button className={`ov-tab${tab === 'table' ? ' active' : ''}`} onClick={() => setTab('table')}>
          Table
        </button>
        <button className={`ov-tab${tab === 'json' ? ' active' : ''}`} onClick={() => setTab('json')}>
          JSON
        </button>
        <span style={{ flex: 1 }} />
        <button className="mini-btn" title="Export dataset as CSV" onClick={exportCsv} style={{ margin: '3px 6px' }}>
          <Download size={14} />
        </button>
      </div>

      {records.length === 0 ? (
        <div className="ov-empty">This dataset is empty — no records reached this output.</div>
      ) : tab === 'table' ? (
        <div className="ov-table-wrap">
          <table className="ov-table">
            <thead>
              <tr>
                {keys.map((k) => (
                  <th key={k}>{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((rec, i) => {
                const row = rec as Record<string, unknown>;
                return (
                  <tr key={i}>
                    {keys.map((k) => {
                      const val = row[k];
                      return (
                        <td key={k} title={typeof val === 'object' ? JSON.stringify(val) : String(val ?? '')}>
                          {val === null || val === undefined ? <span style={{ color: 'var(--text-3)' }}>∅</span> : String(val)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="ov-json">
          {prettyJson ? JSON.stringify(shown, null, 2) : JSON.stringify(shown)}
        </div>
      )}

      <div className="ov-count">
        <span>
          {shown.length.toLocaleString()} shown of {records.length.toLocaleString()} records
        </span>
        <span style={{ opacity: 0.7 }}>{keys.length} columns</span>
      </div>
    </div>
  );
}
