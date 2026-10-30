import { useMemo, useState } from 'react';
import type { DataRecord, ExecutionResult, RunSummary, WorkflowDoc } from '../types';
import { computeAnalytics } from '../engine/analytics';
import { Icon } from './Icons';

export type BottomTab = 'analytics' | 'output' | 'log';

interface BottomPanelProps {
  doc: WorkflowDoc;
  run: ExecutionResult | null;
  history: RunSummary[];
  tab: BottomTab;
  onTab: (tab: BottomTab) => void;
  open: boolean;
  onToggle: () => void;
  outputNodeId: string | null;
  onOutputNode: (id: string) => void;
  onExportCsv: (records: DataRecord[], filename: string) => void;
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatClock(epoch: number): string {
  const d = new Date(epoch);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

const STATUS_TEXT: Record<string, string> = {
  completed: 'Completed',
  failed: 'Failed',
  skipped: 'Skipped',
  running: 'Running',
  pending: 'Pending',
};

export function BottomPanel(props: BottomPanelProps) {
  const { doc, run, tab, open, onTab, onToggle } = props;
  const analytics = useMemo(() => (run ? computeAnalytics(doc, run) : null), [doc, run]);

  const tabs: { id: BottomTab; label: string; icon: 'analytics' | 'table' | 'list' }[] = [
    { id: 'analytics', label: 'Analytics', icon: 'analytics' },
    { id: 'output', label: 'Output data', icon: 'table' },
    { id: 'log', label: 'Execution log', icon: 'list' },
  ];

  return (
    <section className={`bottom-panel${open ? '' : ' collapsed'}`} aria-label="Analytics and results">
      <header className="bottom-head">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tab${tab === t.id ? ' active' : ''}`}
              onClick={() => {
                onTab(t.id);
                if (!open) onToggle();
              }}
            >
              <Icon name={t.icon} size={14} /> {t.label}
            </button>
          ))}
        </div>
        <div className="bottom-head-right">
          {run && (
            <span className={`run-chip run-${run.status}`}>
              {run.status === 'running' ? 'Running…' : `${run.status[0].toUpperCase()}${run.status.slice(1)} in ${formatMs(run.durationMs)}`}
            </span>
          )}
          <button type="button" className="icon-btn" onClick={onToggle} title={open ? 'Collapse panel' : 'Expand panel'} aria-expanded={open}>
            <Icon name={open ? 'chevronDown' : 'chevronUp'} />
          </button>
        </div>
      </header>

      {open && (
        <div className="bottom-body">
          {tab === 'analytics' && <AnalyticsView doc={doc} run={run} analytics={analytics} history={props.history} />}
          {tab === 'output' && (
            <OutputView
              doc={doc}
              run={run}
              selectedId={props.outputNodeId}
              onSelect={props.onOutputNode}
              onExportCsv={props.onExportCsv}
            />
          )}
          {tab === 'log' && <LogView doc={doc} run={run} />}
        </div>
      )}
    </section>
  );
}

function AnalyticsView({
  doc,
  run,
  analytics,
  history,
}: {
  doc: WorkflowDoc;
  run: ExecutionResult | null;
  analytics: ReturnType<typeof computeAnalytics> | null;
  history: RunSummary[];
}) {
  if (!run || !analytics) {
    return (
      <div className="empty-state">
        <Icon name="analytics" size={30} />
        <h4>No run yet</h4>
        <p>Press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> or Run to execute this workflow. Metrics here are computed from the actual results.</p>
        {history.length > 0 && <RunHistory history={history} />}
      </div>
    );
  }

  const maxNodeTime = Math.max(1, ...analytics.nodeTimings.map((t) => t.durationMs));
  const total = Math.max(1, run.durationMs);
  const branchTotal = analytics.branches.reduce((sum, b) => sum + b.trueCount + b.falseCount, 0);

  return (
    <div className="analytics">
      <div className="stat-grid">
        <Stat label="Input records" value={analytics.totalInput.toLocaleString()} tone="blue" />
        <Stat label="Processed" value={analytics.processed.toLocaleString()} tone="green" hint="Records that reached an Output node" />
        <Stat label="Filtered out" value={analytics.filtered.toLocaleString()} tone="orange" hint="Removed by Filter nodes" />
        <Stat label="Execution time" value={formatMs(run.durationMs)} tone="blue" />
        <Stat label="Errors" value={String(analytics.errors.length)} tone={analytics.errors.length ? 'red' : 'muted'} />
        <Stat
          label="Nodes"
          value={`${analytics.completed} ok · ${analytics.failed} failed · ${analytics.skipped} skipped`}
          tone="muted"
        />
      </div>

      <div className="analytics-grid">
        <section className="panel-card">
          <h4>Branch distribution</h4>
          {analytics.branches.length === 0 ? (
            <p className="muted small">Add a Condition node to split records into True and False branches.</p>
          ) : (
            analytics.branches.map((b) => {
              const sum = Math.max(1, b.trueCount + b.falseCount);
              const truePct = (b.trueCount / sum) * 100;
              return (
                <div className="branch" key={b.nodeId}>
                  <div className="branch-title">
                    {b.name} <span className="muted small">{branchTotal ? `${b.trueCount + b.falseCount} records` : ''}</span>
                  </div>
                  <div className="split-bar" title={`True ${b.trueCount} · False ${b.falseCount}`}>
                    <span className="split-true" style={{ width: `${truePct}%` }} />
                    <span className="split-false" style={{ width: `${100 - truePct}%` }} />
                  </div>
                  <div className="legend">
                    <span><i className="dot dot-true" /> True {b.trueCount.toLocaleString()} ({truePct.toFixed(1)}%)</span>
                    <span><i className="dot dot-false" /> False {b.falseCount.toLocaleString()} ({(100 - truePct).toFixed(1)}%)</span>
                  </div>
                </div>
              );
            })
          )}
        </section>

        <section className="panel-card">
          <h4>Processing time per node</h4>
          {analytics.nodeTimings.map((t) => (
            <div className="bar-row" key={t.nodeId}>
              <span className="bar-label" title={t.name}>{t.name}</span>
              <div className="bar-track">
                <span className={`bar-fill status-${t.status}`} style={{ width: `${(t.durationMs / maxNodeTime) * 100}%` }} />
              </div>
              <span className="bar-value">{t.status === 'completed' || t.status === 'failed' ? formatMs(t.durationMs) : STATUS_TEXT[t.status]}</span>
            </div>
          ))}
        </section>

        <section className="panel-card wide">
          <h4>Execution timeline</h4>
          <div className="timeline">
            {analytics.nodeTimings
              .filter((t) => t.status !== 'pending' && t.status !== 'skipped')
              .map((t) => (
                <div className="timeline-row" key={t.nodeId}>
                  <span className="bar-label" title={t.name}>{t.name}</span>
                  <div className="timeline-track">
                    <span
                      className={`timeline-bar status-${t.status}`}
                      style={{
                        left: `${(t.startOffsetMs / total) * 100}%`,
                        width: `${Math.max(0.6, (t.durationMs / total) * 100)}%`,
                      }}
                      title={`${formatMs(t.durationMs)} starting at +${formatMs(t.startOffsetMs)}`}
                    />
                  </div>
                </div>
              ))}
            {analytics.nodeTimings.every((t) => t.status === 'skipped' || t.status === 'pending') && (
              <p className="muted small">No node completed in this run.</p>
            )}
          </div>
        </section>

        <section className="panel-card">
          <h4>Workflow errors</h4>
          {analytics.errors.length === 0 ? (
            <p className="muted small"><Icon name="check" size={13} /> No errors in the last run.</p>
          ) : (
            <ul className="error-list">
              {analytics.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel-card">
          <h4>Run history</h4>
          {history.length === 0 ? <p className="muted small">Runs of this workflow appear here.</p> : <RunHistory history={history} />}
        </section>
      </div>
    </div>
  );
}

function RunHistory({ history }: { history: RunSummary[] }) {
  const recent = history.slice(-15);
  const max = Math.max(1, ...recent.map((r) => r.durationMs));
  return (
    <div className="run-history-wrap">
      <div className="run-history">
        {recent.map((r) => (
          <div
            key={r.runId}
            className={`run-bar run-${r.status}`}
            style={{ height: `${Math.max(8, (r.durationMs / max) * 100)}%` }}
            title={`${new Date(r.startedAt).toLocaleTimeString()} · ${r.status} · ${formatMs(r.durationMs)} · ${r.processed} processed`}
          />
        ))}
      </div>
      <div className="run-history-caption muted small">Last {recent.length} run{recent.length === 1 ? '' : 's'} · bar height = duration</div>
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone: string; hint?: string }) {
  return (
    <div className={`stat tone-${tone}`} title={hint}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

const PAGE_SIZE = 100;
const JSON_PREVIEW = 200;

function OutputView({
  doc,
  run,
  selectedId,
  onSelect,
  onExportCsv,
}: {
  doc: WorkflowDoc;
  run: ExecutionResult | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onExportCsv: (records: DataRecord[], filename: string) => void;
}) {
  const outputs = doc.nodes.filter((n) => n.type === 'output');
  const current = outputs.find((n) => n.id === selectedId) ?? outputs[0];
  const [view, setView] = useState<'table' | 'json'>('table');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ column: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const state = current && run ? run.nodes[current.id] : undefined;
  const records = useMemo(() => (current && run ? run.portRecords[`${current.id}:in`] ?? [] : []), [current, run]);

  const columns = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const record of records.slice(0, 500)) {
      for (const key of Object.keys(record)) {
        if (!seen.has(key)) {
          seen.add(key);
          list.push(key);
        }
      }
    }
    return list;
  }, [records]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let rows = needle
      ? records.filter((r) => Object.values(r).some((v) => v !== null && v !== undefined && String(typeof v === 'object' ? JSON.stringify(v) : v).toLowerCase().includes(needle)))
      : records;
    if (sort) {
      const { column, dir } = sort;
      rows = [...rows].sort((a, b) => {
        const av = a[column];
        const bv = b[column];
        if (av === bv) return 0;
        if (av === undefined || av === null) return 1;
        if (bv === undefined || bv === null) return -1;
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }
    return rows;
  }, [records, query, sort]);

  if (!current) {
    return <div className="empty-state"><Icon name="table" size={28} /><h4>No Output node</h4><p>Add an Output node to collect results.</p></div>;
  }
  if (!run) {
    return <div className="empty-state"><Icon name="table" size={28} /><h4>No results yet</h4><p>Run the workflow to fill the output tables.</p></div>;
  }
  if (!state || state.status !== 'completed') {
    return (
      <div className="empty-state">
        <Icon name="alert" size={28} />
        <h4>{current.name} did not receive data</h4>
        <p>{state?.message || 'The node did not run in the last execution.'}</p>
      </div>
    );
  }

  const maxRows = current.config.maxRows;
  const pageCount = Math.max(1, Math.ceil(Math.min(filtered.length, maxRows) / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(0, maxRows).slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const toggleSort = (column: string) => {
    setSort((prev) => (prev?.column === column ? { column, dir: prev.dir === 1 ? -1 : 1 } : { column, dir: 1 }));
    setPage(0);
  };

  return (
    <div className="output">
      <div className="output-toolbar">
        <select value={current.id} onChange={(e) => { onSelect(e.target.value); setPage(0); }} aria-label="Output node">
          {outputs.map((o) => (
            <option key={o.id} value={o.id}>{o.name}{run.nodes[o.id]?.status === 'completed' ? ` (${run.portRecords[`${o.id}:in`]?.length ?? 0})` : ''}</option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search rows…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(0); }}
          aria-label="Search output rows"
        />
        <div className="segmented small">
          <button type="button" className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>Table</button>
          <button type="button" className={view === 'json' ? 'active' : ''} onClick={() => setView('json')}>JSON</button>
        </div>
        <span className="muted small">
          {filtered.length.toLocaleString()} matching · showing up to {maxRows.toLocaleString()}
        </span>
        <button
          type="button"
          className="btn"
          onClick={() => onExportCsv(records, `${current.name.replace(/\s+/g, '-').toLowerCase()}.csv`)}
          disabled={records.length === 0}
        >
          <Icon name="download" size={14} /> Export CSV
        </button>
      </div>

      {records.length === 0 ? (
        <div className="empty-state small"><p>This output received 0 records.</p></div>
      ) : view === 'table' ? (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="row-no">#</th>
                  {columns.map((c) => (
                    <th key={c} onClick={() => toggleSort(c)} className="sortable" title="Sort">
                      {c}
                      {sort?.column === c ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row, i) => (
                  <tr key={i}>
                    <td className="row-no">{safePage * PAGE_SIZE + i + 1}</td>
                    {columns.map((c) => (
                      <td key={c} className={typeof row[c] === 'number' ? 'num' : ''}>
                        {formatCell(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pageCount > 1 && (
            <div className="pager">
              <button type="button" className="btn ghost" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous</button>
              <span className="muted small">Page {safePage + 1} of {pageCount}</span>
              <button type="button" className="btn ghost" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Next</button>
            </div>
          )}
        </>
      ) : (
        <pre className="json-view">
          {JSON.stringify(filtered.slice(0, Math.min(JSON_PREVIEW, maxRows)), null, 2)}
          {filtered.length > JSON_PREVIEW ? `\n// ${filtered.length - JSON_PREVIEW} more rows — export CSV for the full set` : ''}
        </pre>
      )}
      {state.warnings > 0 && <p className="muted small">{state.warnings} records had missing or invalid values during processing.</p>}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function LogView({ doc, run }: { doc: WorkflowDoc; run: ExecutionResult | null }) {
  if (!run) {
    return <div className="empty-state"><Icon name="list" size={28} /><h4>No execution log</h4><p>Each node's status, timing and message is logged here after a run.</p></div>;
  }
  const names = new Map(doc.nodes.map((n) => [n.id, n.name]));
  return (
    <div className="log">
      <div className="log-head">
        <span>Run</span>
        <code>{run.runId}</code>
        <span>Order: {run.order.map((id) => names.get(id) ?? id).join(' → ')}</span>
      </div>
      <table className="data-table compact">
        <thead>
          <tr>
            <th>Started</th>
            <th>Node</th>
            <th>Status</th>
            <th className="num">Duration</th>
            <th className="num">In</th>
            <th>Out</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {run.order.map((id) => {
            const s = run.nodes[id];
            if (!s) return null;
            return (
              <tr key={id}>
                <td className="mono">{s.startedAt ? formatClock(s.startedAt) : '—'}</td>
                <td>{names.get(id) ?? id}</td>
                <td><span className={`status-pill status-${s.status}`}>{STATUS_TEXT[s.status]}</span></td>
                <td className="num">{s.durationMs !== undefined ? formatMs(s.durationMs) : '—'}</td>
                <td className="num">{s.inputCount}</td>
                <td className="mono small">{Object.entries(s.outputCounts).map(([p, c]) => `${p}: ${c}`).join(' · ') || '—'}</td>
                <td className={s.status === 'failed' ? 'error-text' : ''}>{s.message}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {run.issues.length > 0 && (
        <ul className="error-list">
          {run.issues.map((issue, i) => (
            <li key={i}>{issue.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
