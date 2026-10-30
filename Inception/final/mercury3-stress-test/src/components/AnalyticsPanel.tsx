import { Play, CheckCircle2, XCircle, Ban, Activity } from 'lucide-react';
import { actions, useFF } from '../state/store';
import type { NodeStatus } from '../engine/types';
import { OutputViewer } from './OutputViewer';

const STATUS_COLOR: Record<NodeStatus, string> = {
  pending: '#6f7890',
  running: 'var(--accent)',
  completed: 'var(--green)',
  failed: 'var(--red)',
  skipped: '#3a4157',
};

function StatCard(props: { label: string; value: string; cls?: string }) {
  return (
    <div className={`stat-card ${props.cls ?? ''}`}>
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
    </div>
  );
}

function Bars(props: { data: Array<{ label: string; value: number; color?: string }>; max: number; suffix?: string }) {
  const { data, max } = props;
  return (
    <div className="bar-chart">
      {data.map((d) => (
        <div key={d.label} className="bar-row">
          <div className="bar-label" title={d.label}>{d.label}</div>
          <div className="bar-track">
            <div
              className={`bar-fill ${d.color ?? ''}`}
              style={{ width: `${max > 0 ? Math.max(2, (d.value / max) * 100) : 2}%` }}
            />
          </div>
          <div className="bar-value">{d.value.toLocaleString()}{props.suffix ?? ''}</div>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsPanel() {
  const execution = useFF((s) => s.execution);
  const executing = useFF((s) => s.executing);
  const wf = useFF((s) => s.workflows.find((w) => w.id === s.activeId) ?? null);
  const live = useFF((s) => s.live);

  if (!wf) {
    return <div className="insp-scroll"><div className="hint">Open a workflow to see analytics.</div></div>;
  }

  if (!execution && !executing) {
    return (
      <div className="insp-scroll">
        <div className="empty-state" style={{ position: 'relative', inset: 'auto', padding: '48px 10px' }}>
          <div className="es-icon"><Activity size={30} /></div>
          <h3>No execution yet</h3>
          <p>Run this workflow to see real metrics: record counts, branch distribution, timing and history.</p>
          <button className="btn primary" onClick={() => actions.runWorkflow()}>
            <Play size={14} fill="currentColor" /> Run now
          </button>
        </div>
      </div>
    );
  }

  if (executing && live) {
    const timeline = live.timelines;
    return (
      <div className="insp-scroll">
        <div className="stat-card blue" style={{ marginBottom: 12 }}>
          <div className="stat-label">Execution in progress</div>
          <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="spinner" /> {timeline.length} / {wf.nodes.length} nodes started
          </div>
        </div>
        <div className="insp-section">
          <div className="insp-section-title">Live timeline</div>
          <Timeline timeline={timeline} wf={wf} />
        </div>
      </div>
    );
  }

  const ex = execution!;
  const nodeOrder = ex.order;
  const durationBars = nodeOrder
    .filter((id) => ex.nodeStates[id]?.durationMs !== undefined)
    .map((id) => {
      const st = ex.nodeStates[id];
      const label = wf.nodes.find((n) => n.id === id)?.config.label ?? id;
      return { label: String(label), value: st?.durationMs ?? 0, color: st?.status === 'failed' ? 'red' : '' };
    })
    .sort((a, b) => b.value - a.value);

  const maxDur = Math.max(1, ...durationBars.map((d) => d.value));

  const branchData = Object.entries(ex.branchDistribution).map(([k, v]) => ({ label: k, value: v, color: 'orange' }));

  const nodeLabel = (id: string) => wf.nodes.find((n) => n.id === id)?.config.label ?? id;

  return (
    <div className="insp-scroll">
      <div className="stat-grid">
        <StatCard label="Input records" value={ex.totalInputRecords.toLocaleString()} cls="blue" />
        <StatCard label="Processed" value={ex.processedRecords.toLocaleString()} cls="green" />
        <StatCard label="Filtered out" value={ex.filteredRecords.toLocaleString()} cls="orange" />
        <StatCard
          label="Duration"
          value={`${(ex.durationMs ?? 0).toLocaleString()} ms`}
          cls={ex.status === 'completed' ? 'green' : ex.status === 'failed' ? 'red' : 'orange'}
        />
      </div>

      <div className="insp-section">
        <div className="insp-section-title">Run status</div>
        <div className="issue-item" style={{ borderColor: ex.status === 'failed' ? 'rgba(255,93,108,.5)' : ex.status === 'cancelled' ? 'rgba(242,193,78,.5)' : 'rgba(62,207,142,.5)' }}>
          {ex.status === 'completed' ? <CheckCircle2 size={15} color="var(--green)" /> : ex.status === 'failed' ? <XCircle size={15} color="var(--red)" /> : <Ban size={15} color="var(--yellow)" />}
          <div>
            <b style={{ textTransform: 'uppercase' }}>{ex.status}</b>
            <div className="hint">{new Date(ex.startedAt).toLocaleTimeString()}</div>
          </div>
        </div>
      </div>

      {ex.errors.length > 0 ? (
        <div className="insp-section">
          <div className="insp-section-title">Errors ({ex.errors.length})</div>
          {ex.errors.map((err, i) => (
            <div key={i} className="issue-item error">
              <XCircle size={14} />
              <div>
                {err.nodeId ? <div className="issue-code">{nodeLabel(err.nodeId)}</div> : null}
                {err.message}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {Object.keys(ex.branchDistribution).length > 0 ? (
        <div className="insp-section">
          <div className="insp-section-title">Branch distribution</div>
          <Bars data={branchData} max={Math.max(1, ...branchData.map((d) => d.value))} />
        </div>
      ) : null}

      <div className="insp-section">
        <div className="insp-section-title">Per-node processing time</div>
        {durationBars.length === 0 ? (
          <div className="hint">No timing data available.</div>
        ) : (
          <Bars data={durationBars} max={maxDur} suffix=" ms" />
        )}
      </div>

      <div className="insp-section">
        <div className="insp-section-title">Execution history</div>
        <Timeline timeline={ex.timelines} wf={wf} />
      </div>

      <div className="insp-section">
        <div className="insp-section-title">Output datasets</div>
        {Object.keys(ex.outputs).length === 0 ? (
          <div className="hint">No OUTPUT nodes produced data.</div>
        ) : (
          Object.entries(ex.outputs).map(([nodeId, out]) => {
            const node = wf.nodes.find((n) => n.id === nodeId);
            const title = String(node?.config.outputLabel ?? node?.config.label ?? 'Results');
            return (
              <div key={nodeId} style={{ marginBottom: 12 }}>
                <OutputViewer title={title} records={out.records} maxRows={Number(node?.config.maxRows) || 200} prettyJson={!!node?.config.prettyJson} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Timeline(props: { timeline: Array<{ t: number; nodeId: string; status: NodeStatus }>; wf: NonNullable<ReturnType<typeof useFF.getState>['workflows'][number]> }) {
  const { timeline, wf } = props;
  if (timeline.length === 0) {
    return <div className="hint">No events recorded.</div>;
  }
  return (
    <div className="timeline">
      {timeline.map((entry, i) => {
        const label = wf.nodes.find((n) => n.id === entry.nodeId)?.config.label ?? entry.nodeId;
        return (
          <div key={i} className="tl-row">
            <div className="tl-dot" style={{ background: STATUS_COLOR[entry.status] }} />
            <div className="tl-name">{String(label)}</div>
            <div className="tl-state" style={{ color: STATUS_COLOR[entry.status] }}>{entry.status}</div>
            <div className="tl-time">{new Date(entry.t).toLocaleTimeString([], { hour12: false })}</div>
          </div>
        );
      })}
    </div>
  );
}
