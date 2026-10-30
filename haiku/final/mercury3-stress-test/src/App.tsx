import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { DataRecord, ExecutionResult, NodeType, WorkflowDoc, WorkflowEdge, WorkflowNode } from './types';
import { activeWorkflow, createInitialState, persistState, reducer } from './state/store';
import { runWorkflow } from './engine/executor';
import { computeAnalytics, summarizeRun } from './engine/analytics';
import { validateWorkflow } from './engine/graph';
import { NODE_DEFS } from './engine/nodeDefs';
import { createDemoDoc, DEMO_WORKFLOW_ID } from './engine/demo';
import { MAX_IMPORT_BYTES, parseWorkflowText, serializeWorkflow } from './engine/serialization';
import { toCsv } from './engine/csv';
import { newId } from './utils/ids';
import { downloadText, slugify } from './utils/download';
import { Canvas, DEFAULT_VIEW, type View, NODE_W } from './components/Canvas';
import { Sidebar } from './components/Sidebar';
import { Inspector, ValidationList } from './components/Inspector';
import { BottomPanel, type BottomTab } from './components/BottomPanel';
import { Icon } from './components/Icons';

type Dialog =
  | { kind: 'shortcuts' }
  | { kind: 'errors'; title: string; errors: string[] }
  | null;

const SHORTCUTS: [string, string][] = [
  ['Ctrl + Enter / F5', 'Run workflow'],
  ['Esc', 'Cancel run (or clear selection)'],
  ['Delete / Backspace', 'Delete selected nodes or connection'],
  ['Ctrl + D', 'Duplicate selection'],
  ['Ctrl + C / Ctrl + V', 'Copy and paste nodes'],
  ['Ctrl + A', 'Select all nodes'],
  ['Ctrl + Z', 'Undo'],
  ['Ctrl + Y or Ctrl + Shift + Z', 'Redo'],
  ['Arrow keys', 'Nudge selected nodes (Shift = 8×)'],
  ['F', 'Fit workflow to screen'],
  ['Ctrl + = / Ctrl + -', 'Zoom in / out'],
  ['Mouse wheel', 'Zoom at cursor'],
  ['Space + drag, or middle mouse', 'Pan the canvas'],
  ['Drag on empty canvas', 'Rubber-band select (Shift adds to selection)'],
  ['?', 'Show this list'],
];

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const workflow = activeWorkflow(state);
  const doc = workflow.doc;

  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [fitSignal, setFitSignal] = useState(1);
  const [selection, setSelection] = useState<string[]>([]);
  const [run, setRun] = useState<ExecutionResult | null>(null);
  const [running, setRunning] = useState(false);
  const [snap, setSnap] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [bottomTab, setBottomTab] = useState<BottomTab>('analytics');
  const [outputNodeId, setOutputNodeId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const abortRef = useRef<AbortController | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const importRef = useRef<HTMLInputElement>(null);
  const clipboardRef = useRef<{ nodes: WorkflowNode[]; edges: WorkflowEdge[] } | null>(null);

  // Automatic local persistence, debounced; flushed when the page is closed.
  useEffect(() => {
    const timer = window.setTimeout(() => persistState(state), 250);
    return () => window.clearTimeout(timer);
  }, [state]);
  useEffect(() => {
    const flush = () => persistState(state);
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [state]);

  const issues = useMemo(() => validateWorkflow(doc), [doc]);
  const issuesByNode = useMemo(() => {
    const map: Record<string, 'error' | 'warning'> = {};
    for (const issue of issues) {
      if (!issue.nodeId) continue;
      if (issue.level === 'error' || map[issue.nodeId] !== 'error') map[issue.nodeId] = issue.level;
    }
    return map;
  }, [issues]);
  const runStates = run ? run.nodes : null;
  const errorCount = issues.filter((i) => i.level === 'error').length;

  const selectedNode = selection.length === 1 ? doc.nodes.find((n) => n.id === selection[0]) : undefined;
  const selectedEdge = selection.length === 1 ? doc.edges.find((e) => e.id === selection[0]) : undefined;

  const showToast = (text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  };

  const guardEdit = (): boolean => {
    if (running) {
      showToast('Editing is locked while the workflow runs. Press Cancel to stop it.');
      return false;
    }
    return true;
  };

  const commit = (next: WorkflowDoc, key?: string) => {
    if (!guardEdit()) return;
    dispatch({ type: 'commit', doc: next, key });
  };

  const addNode = (type: NodeType, x: number, y: number) => {
    if (!guardEdit()) return;
    if (type === 'start' && doc.nodes.some((n) => n.type === 'start')) {
      showToast('A workflow can have only one Start node.');
      return;
    }
    const id = newId(type);
    const node = { id, type, name: NODE_DEFS[type].label, x, y, config: NODE_DEFS[type].defaultConfig() } as WorkflowNode;
    commit({ ...doc, nodes: [...doc.nodes, node] });
    setSelection([id]);
  };

  const addFromPalette = (type: NodeType) => {
    const rightmost = doc.nodes.reduce<WorkflowNode | null>((best, n) => (!best || n.x > best.x ? n : best), null);
    const x = rightmost ? rightmost.x + NODE_W + 60 : 40;
    const y = rightmost ? rightmost.y : 200;
    addNode(type, x, y);
  };

  /** Copies the given nodes (and connections between them), giving them fresh ids. */
  const cloneSubgraph = (ids: string[], dx: number, dy: number) => {
    const map = new Map<string, string>();
    const nodes: WorkflowNode[] = [];
    for (const node of doc.nodes) {
      if (!ids.includes(node.id) || node.type === 'start') continue;
      const id = newId(node.type);
      map.set(node.id, id);
      nodes.push({ ...structuredClone(node), id, name: `${node.name} copy`, x: node.x + dx, y: node.y + dy });
    }
    const edges: WorkflowEdge[] = doc.edges
      .filter((e) => map.has(e.source) && map.has(e.target))
      .map((e) => ({ ...e, id: newId('e'), source: map.get(e.source) ?? e.source, target: map.get(e.target) ?? e.target }));
    return { nodes, edges };
  };

  const duplicateSelection = () => {
    if (!guardEdit()) return;
    const { nodes, edges } = cloneSubgraph(selection, 40, 40);
    if (nodes.length === 0) {
      showToast('Select one or more nodes to duplicate (Start cannot be duplicated).');
      return;
    }
    commit({ ...doc, nodes: [...doc.nodes, ...nodes], edges: [...doc.edges, ...edges] });
    setSelection(nodes.map((n) => n.id));
  };

  const copySelection = () => {
    const { nodes, edges } = cloneSubgraph(selection, 0, 0);
    if (nodes.length === 0) return;
    clipboardRef.current = { nodes, edges };
    showToast(`Copied ${nodes.length} node${nodes.length === 1 ? '' : 's'}`);
  };

  const pasteClipboard = () => {
    const clip = clipboardRef.current;
    if (!clip || !guardEdit()) return;
    const idMap = new Map<string, string>();
    const nodes = clip.nodes.map((node) => {
      const id = newId(node.type);
      idMap.set(node.id, id);
      return { ...structuredClone(node), id, x: node.x + 40, y: node.y + 40 } as WorkflowNode;
    });
    const edges = clip.edges.map((e) => ({ ...e, id: newId('e'), source: idMap.get(e.source) ?? e.source, target: idMap.get(e.target) ?? e.target }));
    commit({ ...doc, nodes: [...doc.nodes, ...nodes], edges: [...doc.edges, ...edges] });
    setSelection(nodes.map((n) => n.id));
  };

  const deleteSelection = () => {
    if (!guardEdit() || selection.length === 0) return;
    const ids = new Set(selection);
    const removed = new Set(doc.nodes.filter((n) => ids.has(n.id)).map((n) => n.id));
    const nodes = doc.nodes.filter((n) => !removed.has(n.id));
    const edges = doc.edges.filter((e) => !ids.has(e.id) && !removed.has(e.source) && !removed.has(e.target));
    if (nodes.length === doc.nodes.length && edges.length === doc.edges.length) return;
    commit({ ...doc, nodes, edges });
    setSelection([]);
  };

  const nudgeSelection = (dx: number, dy: number) => {
    if (!guardEdit() || selection.length === 0) return;
    const ids = new Set(selection);
    const nodes = doc.nodes.map((n) => (ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n));
    commit({ ...doc, nodes }, `nudge:${[...ids].sort().join(',')}`);
  };

  const updateNode = (next: WorkflowNode, key: string) => {
    commit({ ...doc, nodes: doc.nodes.map((n) => (n.id === next.id ? next : n)) }, key);
  };

  const undo = () => {
    if (!guardEdit()) return;
    dispatch({ type: 'undo' });
    setSelection([]);
  };
  const redo = () => {
    if (!guardEdit()) return;
    dispatch({ type: 'redo' });
    setSelection([]);
  };

  const startRun = async () => {
    if (running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const snapshot = doc;
    const workflowId = workflow.id;
    setRunning(true);
    setBottomOpen(true);
    try {
      const result = await runWorkflow(snapshot, {
        signal: controller.signal,
        stepDelayMs: 260,
        onUpdate: (partial) => setRun(partial),
      });
      setRun(result);
      const analytics = computeAnalytics(snapshot, result);
      dispatch({ type: 'addRun', id: workflowId, run: summarizeRun(result, analytics) });
      const firstOutput = snapshot.nodes.find((n) => n.type === 'output' && result.nodes[n.id]?.status === 'completed');
      if (firstOutput) setOutputNodeId(firstOutput.id);
      showToast(
        result.status === 'completed'
          ? `Completed in ${Math.round(result.durationMs)} ms`
          : result.status === 'cancelled'
            ? 'Run cancelled'
            : `Run finished with ${result.issues.length} error${result.issues.length === 1 ? '' : 's'}`,
      );
    } catch (err) {
      showToast(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancelRun = () => abortRef.current?.abort();

  const switchWorkflow = (id: string) => {
    if (running) {
      showToast('Wait for the run to finish or cancel it before switching workflows.');
      return;
    }
    dispatch({ type: 'select', id });
    setRun(null);
    setSelection([]);
    setOutputNodeId(null);
    setFitSignal((s) => s + 1);
  };

  const createWorkflow = () => {
    if (!guardEdit()) return;
    const id = newId('wf');
    const name = `Untitled workflow ${state.workflows.length + 1}`;
    const start: WorkflowNode = { id: newId('start'), type: 'start', name: 'Start', x: 60, y: 200, config: {} };
    dispatch({
      type: 'create',
      workflow: { id, doc: { format: 'flowforge-workflow', version: 1, name, nodes: [start], edges: [] }, updatedAt: new Date().toISOString(), runs: [] },
    });
    setRun(null);
    setSelection([]);
    setFitSignal((s) => s + 1);
  };

  const deleteWorkflow = (id: string) => {
    if (running) return;
    const target = state.workflows.find((w) => w.id === id);
    if (!target || !window.confirm(`Delete "${target.doc.name}"? This cannot be undone.`)) return;
    dispatch({ type: 'remove', id });
    if (id === state.activeId) {
      setRun(null);
      setSelection([]);
      setFitSignal((s) => s + 1);
    }
  };

  const resetDemo = () => {
    if (running) return;
    if (!window.confirm('Reset the demo workflow to its original design? Your changes to it will be replaced.')) return;
    dispatch({ type: 'resetDoc', id: DEMO_WORKFLOW_ID, doc: createDemoDoc() });
    setRun(null);
    setSelection([]);
    setOutputNodeId(null);
    setFitSignal((s) => s + 1);
    showToast('Demo workflow restored');
  };

  const importFile = async (file: File) => {
    if (!guardEdit()) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setDialog({ kind: 'errors', title: 'Import rejected', errors: [`The file is ${Math.round(file.size / 1024)} KB; the limit is ${MAX_IMPORT_BYTES / 1_000_000} MB.`] });
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setDialog({ kind: 'errors', title: 'Import failed', errors: ['The file could not be read.'] });
      return;
    }
    const parsed = parseWorkflowText(text);
    if (!parsed.ok) {
      setDialog({ kind: 'errors', title: `"${file.name}" is not a valid workflow`, errors: parsed.errors });
      return;
    }
    dispatch({
      type: 'create',
      workflow: { id: newId('wf'), doc: parsed.doc, updatedAt: new Date().toISOString(), runs: [] },
    });
    setRun(null);
    setSelection([]);
    setFitSignal((s) => s + 1);
    showToast(`Imported "${parsed.doc.name}"`);
  };

  const exportWorkflow = () => {
    downloadText(`${slugify(doc.name)}.flowforge.json`, serializeWorkflow(doc), 'application/json');
  };

  const exportCsv = (records: DataRecord[], filename: string) => {
    if (records.length === 0) {
      showToast('There are no rows to export');
      return;
    }
    downloadText(filename, toCsv(records), 'text/csv');
    showToast(`Exported ${records.length.toLocaleString()} rows to CSV`);
  };

  // Global keyboard shortcuts. Registered on every render so handlers see fresh state.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (typing) {
        if (e.key === 'Escape') target?.blur();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'enter') {
        e.preventDefault();
        void startRun();
      } else if (e.key === 'F5') {
        e.preventDefault();
        void startRun();
      } else if (e.key === 'Escape') {
        if (running) cancelRun();
        else setSelection([]);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && key === 'c') {
        copySelection();
      } else if (mod && key === 'v') {
        e.preventDefault();
        pasteClipboard();
      } else if (mod && key === 'a') {
        e.preventDefault();
        setSelection(doc.nodes.map((n) => n.id));
      } else if (mod && key === 's') {
        e.preventDefault();
        showToast('Workflows are saved automatically in this browser');
      } else if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        setDialog({ kind: 'shortcuts' });
      } else if (e.key.startsWith('Arrow') && selection.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 8 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        nudgeSelection(dx, dy);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const outputs = doc.nodes.filter((n) => n.type === 'output');
  const hasStart = doc.nodes.some((n) => n.type === 'start');
  const runLabel = running ? 'Running…' : 'Run';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="workflow" size={16} />
          </span>
          <span className="brand-name">FlowForge Studio</span>
        </div>

        <div className="wf-name">
          <input
            type="text"
            value={doc.name}
            maxLength={80}
            aria-label="Workflow name"
            disabled={running}
            onChange={(e) => commit({ ...doc, name: e.target.value }, 'wfname')}
          />
          <span className="muted small">{workflow.runs.length} runs · saved locally</span>
        </div>

        <div className="toolbar-group">
          <button type="button" className={`btn primary${running ? ' busy' : ''}`} onClick={() => void startRun()} disabled={running} title="Run workflow (Ctrl+Enter)">
            <Icon name="play" size={14} /> {runLabel}
          </button>
          <button type="button" className="btn danger-ghost" onClick={cancelRun} disabled={!running} title="Cancel run (Esc)">
            <Icon name="stop" size={14} /> Cancel
          </button>
        </div>

        <div className="toolbar-group">
          <button type="button" className="icon-btn" onClick={undo} disabled={running || state.past.length === 0} title="Undo (Ctrl+Z)">
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-btn" onClick={redo} disabled={running || state.future.length === 0} title="Redo (Ctrl+Y)">
            <Icon name="redo" />
          </button>
          <button type="button" className="icon-btn" onClick={duplicateSelection} disabled={running || selection.length === 0} title="Duplicate (Ctrl+D)">
            <Icon name="copy" />
          </button>
          <button type="button" className="icon-btn" onClick={deleteSelection} disabled={running || selection.length === 0} title="Delete (Del)">
            <Icon name="trash" />
          </button>
        </div>

        <div className="toolbar-group end">
          <button type="button" className="btn ghost" onClick={() => importRef.current?.click()} disabled={running} title="Import workflow JSON">
            <Icon name="upload" size={14} /> Import
          </button>
          <button type="button" className="btn ghost" onClick={exportWorkflow} title="Export workflow JSON">
            <Icon name="download" size={14} /> Export
          </button>
          <button type="button" className="icon-btn" onClick={() => setDialog({ kind: 'shortcuts' })} title="Keyboard shortcuts (?)">
            <Icon name="keyboard" />
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importFile(file);
            }}
          />
        </div>
      </header>

      <div className="workspace">
        <Sidebar
          hasStart={hasStart}
          locked={running}
          onAdd={addFromPalette}
          workflows={state.workflows}
          activeId={state.activeId}
          onSelectWorkflow={switchWorkflow}
          onNewWorkflow={createWorkflow}
          onDeleteWorkflow={deleteWorkflow}
          onResetDemo={resetDemo}
        />

        <main className="center">
          <div className="canvas-wrap">
            <Canvas
              doc={doc}
              view={view}
              onViewChange={setView}
              selection={selection}
              onSelectionChange={setSelection}
              runStates={runStates}
              issues={issuesByNode}
              locked={running}
              snap={snap}
              onSnapChange={setSnap}
              fitSignal={fitSignal}
              onPreview={(next) => dispatch({ type: 'preview', doc: next })}
              onCheckpoint={(before) => dispatch({ type: 'checkpoint', doc: before })}
              onCommit={(next) => commit(next)}
              onAddNode={addNode}
              onHint={showToast}
            />
            {running && (
              <div className="running-banner">
                <span className="pulse-dot" /> Executing workflow — editing is locked
              </div>
            )}
          </div>
          <BottomPanel
            doc={doc}
            run={run}
            history={workflow.runs}
            tab={bottomTab}
            onTab={setBottomTab}
            open={bottomOpen}
            onToggle={() => setBottomOpen((o) => !o)}
            outputNodeId={outputNodeId ?? outputs[0]?.id ?? null}
            onOutputNode={setOutputNodeId}
            onExportCsv={exportCsv}
          />
        </main>

        <aside className="inspector-panel" aria-label="Inspector">
          {selectedNode ? (
            <Inspector
              node={selectedNode}
              locked={running}
              onChange={updateNode}
              onDelete={deleteSelection}
              onDuplicate={duplicateSelection}
            />
          ) : selectedEdge ? (
            <EdgeInspector
              edge={selectedEdge}
              names={new Map(doc.nodes.map((n) => [n.id, n.name]))}
              locked={running}
              onDelete={deleteSelection}
            />
          ) : (
            <div className="inspector-empty">
              <Icon name="workflow" size={26} />
              <h4>Select a node</h4>
              <p>Click a node to configure it. Shift-click or drag a rectangle to select several nodes.</p>
            </div>
          )}

          <section className="validation">
            <div className="side-title-row">
              <div className="side-title">Validation</div>
              <span className={`count-badge${errorCount ? ' error' : ''}`}>
                {errorCount ? `${errorCount} error${errorCount === 1 ? '' : 's'}` : `${issues.length} note${issues.length === 1 ? '' : 's'}`}
              </span>
            </div>
            <ValidationList
              issues={issues}
              doc={doc}
              onSelect={(id) => setSelection([id])}
            />
          </section>
        </aside>
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            {dialog.kind === 'shortcuts' ? (
              <>
                <div className="modal-head">
                  <h3>Keyboard shortcuts</h3>
                  <button type="button" className="icon-btn" onClick={() => setDialog(null)} aria-label="Close"><Icon name="x" /></button>
                </div>
                <table className="shortcut-table">
                  <tbody>
                    {SHORTCUTS.map(([keys, action]) => (
                      <tr key={keys}>
                        <td><kbd>{keys}</kbd></td>
                        <td>{action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <>
                <div className="modal-head">
                  <h3><Icon name="alert" size={16} /> {dialog.title}</h3>
                  <button type="button" className="icon-btn" onClick={() => setDialog(null)} aria-label="Close"><Icon name="x" /></button>
                </div>
                <ul className="error-list">
                  {dialog.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
                <p className="muted small">No changes were made. Fix the file and import it again.</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EdgeInspector({
  edge,
  names,
  locked,
  onDelete,
}: {
  edge: WorkflowEdge;
  names: Map<string, string>;
  locked: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="inspector">
      <div className="inspector-head">
        <span className="node-icon"><Icon name="workflow" size={16} /></span>
        <div className="inspector-titles">
          <div className="inspector-type">Connection</div>
          <div className="inspector-desc">
            {names.get(edge.source)} ({edge.sourcePort}) → {names.get(edge.target)}
          </div>
        </div>
      </div>
      <p className="muted small">Records flow along this connection. Delete it to disconnect the nodes.</p>
      <div className="inspector-actions">
        <button type="button" className="btn danger" onClick={onDelete} disabled={locked}>
          <Icon name="trash" size={14} /> Delete connection
        </button>
      </div>
    </div>
  );
}
