import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { actions, useFF } from '../state/store';
import { NODE_LABEL } from '../engine/graph';
import { generateOrders } from '../engine/sampleOrders';
import { ConditionEditor, TransformEditor, FieldSuggestInput } from './controls';
import { OutputViewer } from './OutputViewer';
import { compileFormula } from '../engine/evaluator';

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{props.label}</label>
      {props.children}
    </div>
  );
}

function NumberField(props: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (n: number) => void }) {
  return (
    <Field label={props.label}>
      <input
        type="number"
        value={Number.isFinite(props.value) ? props.value : 0}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </Field>
  );
}

function DataSourceControls({ nodeId }: { nodeId: string }) {
  const node = useFF((s) => s.workflows.find((w) => w.id === s.activeId)?.nodes.find((n) => n.id === nodeId));
  const cfg = node?.config ?? {};
  const set = (patch: Record<string, unknown>) => actions.setNodeConfig(nodeId, patch);

  const mode = (cfg.dataSourceMode as string) ?? 'generate';
  const count = Number(cfg.recordCount) || 0;
  const seed = Number(cfg.seed) || 0;
  const preview = mode === 'generate' ? generateOrders(Math.min(count, 3), seed) : [];

  return (
    <>
      <Field label="Data mode">
        <div className="seg" style={{ width: '100%' }}>
          <button className={mode === 'generate' ? 'active' : ''} onClick={() => set({ dataSourceMode: 'generate' })}>
            Generate
          </button>
          <button className={mode === 'paste' ? 'active' : ''} onClick={() => set({ dataSourceMode: 'paste' })}>
            Paste JSON
          </button>
        </div>
      </Field>

      {mode === 'generate' ? (
        <>
          <NumberField label="Record count" value={count} min={0} max={50000} step={10} onChange={(v) => set({ recordCount: v })} />
          <NumberField label="Seed (deterministic)" value={seed} min={0} step={1} onChange={(v) => set({ seed: v })} />
          {count === 0 ? (
            <div className="err-hint">Count 0 produces an empty dataset (useful for testing empty states).</div>
          ) : (
            <div className="hint">
              Preview (first {Math.min(count, 3)} of {count.toLocaleString()}) — deterministic per seed:
            </div>
          )}
          {preview.length > 0 ? (
            <div className="output-viewer" style={{ marginTop: 6 }}>
              <div className="ov-json" style={{ maxHeight: 190 }}>
                {JSON.stringify(preview, null, 2)}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <Field label="Records as JSON array">
          <textarea
            rows={9}
            value={String(cfg.pastedJson ?? '')}
            placeholder='[{"id": 1, "name": "Ada"}, ...]'
            spellCheck={false}
            onChange={(e) => set({ pastedJson: e.target.value })}
          />
          <div className="hint">Parsed at run time; invalid JSON stops the run with a clear error.</div>
        </Field>
      )}
    </>
  );
}

export function PropertiesPanel() {
  const wf = useFF((s) => s.workflows.find((w) => w.id === s.activeId) ?? null);
  const selectedIds = useFF((s) => s.selectedIds);
  const execution = useFF((s) => s.execution);
  const issues = useFF((s) => s.validationIssues);

  const selectedNodes = wf?.nodes.filter((n) => selectedIds.includes(n.id)) ?? [];
  const edgeSel = selectedIds.filter((id) => !selectedNodes.some((n) => n.id === id));

  if (selectedNodes.length === 0 && edgeSel.length === 0) {
    return (
      <div className="insp-scroll">
        <div className="empty-state" style={{ position: 'relative', inset: 'auto', padding: '40px 10px' }}>
          <div className="es-icon">
            <svg width="26" height="26" viewBox="0 0 32 32" fill="none">
              <rect x="6" y="8" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="2.2" />
              <path d="M6 14h20" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </div>
          <h3>No selection</h3>
          <p>Select a node on the canvas to configure it, or open Analytics.</p>
        </div>
        {issues && <IssueList issues={issues} />}
      </div>
    );
  }

  if (selectedNodes.length > 1) {
    return (
      <div className="insp-scroll">
        <div className="insp-section">
          <div className="insp-section-title">{selectedNodes.length} nodes selected</div>
          <div className="hint">
            Use the toolbar or keyboard to duplicate or delete. Select a single node to edit its configuration.
          </div>
          {selectedNodes.map((n) => (
            <div key={n.id} className="issue-item info" style={{ marginTop: 8 }}>
              <Info size={14} />
              <div>
                <b>{NODE_LABEL[n.type]}</b> · {String(n.config.label ?? '')}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const node = selectedNodes[0];
  const cfg = node.config;
  const set = (patch: Record<string, unknown>) => actions.setNodeConfig(node.id, patch);

  const execOut = execution ? execution.outputs[node.id] : null;

  return (
    <div className="insp-scroll">
      <div className="insp-section">
        <div className="insp-section-title">{NODE_LABEL[node.type]} node</div>
        <Field label="Display name">
          <input value={String(cfg.label ?? '')} onChange={(e) => set({ label: e.target.value })} spellCheck={false} />
        </Field>
      </div>

      {node.type === 'dataSource' ? <DataSourceControls nodeId={node.id} /> : null}

      {(node.type === 'filter' || node.type === 'condition') && (
        <div className="insp-section">
          <div className="insp-section-title">
            {node.type === 'condition' ? 'Routing condition' : 'Filter conditions'}
          </div>
          <ConditionEditor value={(cfg.cond as never) ?? { combinator: 'and', rows: [] }} onChange={(cond) => set({ cond })} />
        </div>
      )}

      {node.type === 'transform' ? (
        <div className="insp-section">
          <div className="insp-section-title">Transform operations</div>
          <TransformEditor ops={(cfg.transformOps as never) ?? []} onChange={(ops) => set({ transformOps: ops })} />
        </div>
      ) : null}

      {node.type === 'delay' ? (
        <div className="insp-section">
          <NumberField label="Delay (ms)" value={Number(cfg.delayMs) || 0} min={0} max={60000} step={50} onChange={(v) => set({ delayMs: v })} />
          <div className="hint">Execution pauses here for the configured duration (cancellable).</div>
        </div>
      ) : null}

      {node.type === 'output' ? (
        <div className="insp-section">
          <Field label="Dataset label">
            <input value={String(cfg.outputLabel ?? '')} onChange={(e) => set({ outputLabel: e.target.value })} spellCheck={false} />
          </Field>
          <NumberField label="Max rows shown" value={Number(cfg.maxRows) || 200} min={1} max={2000} step={10} onChange={(v) => set({ maxRows: v })} />
          <Field label="Pretty JSON">
            <div className="seg">
              <button className={cfg.prettyJson ? 'active' : ''} onClick={() => set({ prettyJson: true })}>On</button>
              <button className={!cfg.prettyJson ? 'active' : ''} onClick={() => set({ prettyJson: false })}>Off</button>
            </div>
          </Field>
          {execOut ? (
            <div style={{ marginTop: 8 }}>
              <OutputViewer title={String(cfg.outputLabel ?? 'Results')} records={execOut.records} maxRows={Number(cfg.maxRows) || 200} prettyJson={!!cfg.prettyJson} />
            </div>
          ) : (
            <div className="hint" style={{ marginTop: 8 }}>Run the workflow to populate this output.</div>
          )}
        </div>
      ) : null}

      {node.type === 'start' ? (
        <div className="hint">START marks the entry point. It does not emit records itself.</div>
      ) : null}

      {node.type === 'transform' && (cfg.transformOps as Array<{ formula?: string }> | undefined)?.some((op) => {
        const ok = compileFormula(op.formula ?? '');
        return !ok.ok;
      }) ? (
        <div className="err-hint" style={{ marginTop: 6 }}>One or more formulas are invalid — the workflow will fail at run time.</div>
      ) : null}

      {issues && (
        <div style={{ marginTop: 10 }}>
          <IssueList issues={issues} />
        </div>
      )}
    </div>
  );
}

function IssueList({ issues }: { issues: ReturnType<typeof useFF.getState>['validationIssues'] }) {
  if (!issues) return null;
  const icons = { error: <XCircle size={14} />, warning: <AlertTriangle size={14} />, info: <Info size={14} /> };
  return (
    <div>
      <div className="insp-section-title" style={{ margin: '14px 0 8px' }}>Validation</div>
      {issues.length === 0 ? (
        <div className="issue-item info">
          <CheckCircle2 size={14} /> No problems found.
        </div>
      ) : (
        issues.map((issue, i) => (
          <div key={i} className={`issue-item ${issue.level}`}>
            <span style={{ marginTop: 1 }}>{icons[issue.level]}</span>
            <div>
              <div className="issue-code">{issue.code}</div>
              {issue.message}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
