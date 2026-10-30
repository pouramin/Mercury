import { create } from 'zustand';
import type { ExecutionIssue, ExecutionResult, NodeRunState, NodeStatus, TimelineEntry } from '../engine/types';
import type { NodeType, Pos, ViewTransform, Workflow, WorkflowEdge, WorkflowNode } from '../types';
import {
  canConnect,
  cloneWorkflow,
  defaultConfig,
  makeId,
  NODE_SIZE,
  validateGraph,
  NODE_PORTS,
} from '../engine/graph';
import { executeWorkflow } from '../engine/execute';
import { createDemoWorkflow, createEmptyWorkflow } from '../engine/demoWorkflow';
import { parseWorkflowJson } from '../utils/workflowIO';

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'flowforge.studio.v1';

interface Persisted {
  workflows: Workflow[];
  activeId: string | null;
}

interface Snapshot {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

interface History {
  past: Snapshot[];
  future: Snapshot[];
}

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error' | 'warning';
  title: string;
  message?: string;
}

export interface LiveRun {
  nodeStates: Record<string, NodeRunState>;
  timelines: TimelineEntry[];
}

interface WorkspaceState {
  workflows: Workflow[];
  activeId: string | null;

  view: ViewTransform;
  selectedIds: string[];
  lastKnownFields: string[];

  executing: boolean;
  execution: ExecutionResult | null;
  live: LiveRun | null;
  validationIssues: ExecutionIssue[] | null;

  inspectorMode: 'properties' | 'analytics';
  wfListOpen: boolean;
  paletteOpen: boolean;

  toasts: Toast[];
  histories: Record<string, History>;
  historyOpen: boolean;
  historyOpenKey: string | null;
  pendingSnapshot: Snapshot | null;
}

function snapshotOf(wf: Workflow): Snapshot {
  return {
    nodes: JSON.parse(JSON.stringify(wf.nodes)),
    edges: JSON.parse(JSON.stringify(wf.edges)),
  };
}

function isShapeOfWorkflow(v: unknown): v is Workflow {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.nodes) && Array.isArray(o.edges) && typeof o.name === 'string';
}

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { workflows: [], activeId: null };
    const p = JSON.parse(raw) as Persisted;
    if (!Array.isArray(p.workflows)) return { workflows: [], activeId: null };
    const workflows = p.workflows.filter(isShapeOfWorkflow);
    const activeId = p.activeId && workflows.some((w) => w.id === p.activeId) ? p.activeId : workflows[0]?.id ?? null;
    return { workflows, activeId };
  } catch {
    return { workflows: [], activeId: null };
  }
}

function seedInitial() {
  const persisted = loadPersisted();
  if (persisted.workflows.length > 0) return persisted;
  const demo = createDemoWorkflow();
  return { workflows: [demo], activeId: demo.id };
}

const initial = seedInitial();

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(getState: () => WorkspaceState): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const s = getState();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ workflows: s.workflows, activeId: s.activeId }));
    } catch {
      /* storage unavailable */
    }
  }, 350);
}

let currentAbort: AbortController | null = null;
const configCommitTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  workflows: initial.workflows,
  activeId: initial.activeId,

  view: { x: 40, y: 60, k: 1 },
  selectedIds: [],
  lastKnownFields: [],

  executing: false,
  execution: null,
  live: null,
  validationIssues: null,

  inspectorMode: 'properties',
  wfListOpen: true,
  paletteOpen: true,

  toasts: [],
  histories: {},
  historyOpen: false,
  historyOpenKey: null,
  pendingSnapshot: null,
}));

// ---------------------------------------------------------------------------
// Internal helpers (module scope, used by actions below)
// ---------------------------------------------------------------------------

function activeWf(getState: () => WorkspaceState): Workflow | null {
  const s = getState();
  return s.workflows.find((w) => w.id === s.activeId) ?? null;
}

/** Push a pre-change snapshot unless the same edit session recorded one. */
function recordBefore(getState: () => WorkspaceState, setState: (p: Partial<WorkspaceState>) => void, opts?: { key?: string; force?: boolean }): void {
  const s = getState();
  const wf = activeWf(getState);
  if (!wf) return;
  if (!opts?.force && s.historyOpen && opts?.key && s.historyOpenKey === opts.key) return;
  const snap = snapshotOf(wf);
  const hist = s.histories[s.activeId!] ?? { past: [], future: [] };
  const past = [...hist.past, snap].slice(-100);
  setState({
    histories: { ...s.histories, [s.activeId!]: { past, future: [] } },
    historyOpen: true,
    historyOpenKey: opts?.key ?? null,
    pendingSnapshot: opts?.key?.startsWith('cfg:') && !opts.force ? snap : s.pendingSnapshot,
  });
}

function updateActive(
  getState: () => WorkspaceState,
  setState: (p: Partial<WorkspaceState>) => void,
  mutate: (wf: Workflow) => void,
  also?: Partial<WorkspaceState>,
): void {
  const s = getState();
  const wf = activeWf(getState);
  if (!wf) return;
  mutate(wf);
  wf.updatedAt = Date.now();
  const workflows = s.workflows.map((w) => (w.id === wf.id ? wf : w));
  setState({ workflows, ...also });
  schedulePersist(getState);
}

function selectOnly(getState: () => WorkspaceState, setState: (p: Partial<WorkspaceState>) => void, ids: string[]): void {
  setState({ selectedIds: ids, historyOpenKey: null });
  void getState;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const get = () => useWorkspace.getState();
const set = (p: Partial<WorkspaceState> | ((s: WorkspaceState) => Partial<WorkspaceState>)) => {
  useWorkspace.setState(p as never);
};

export const actions = {
  // ---- navigation / workflows ----
  selectWorkflow(id: string) {
    set((s) => ({ activeId: id, selectedIds: [], execution: null, live: null, validationIssues: null }));
    schedulePersist(get);
  },
  createWorkflow(name = 'Untitled workflow') {
    const wf = createEmptyWorkflow(name);
    set((s) => ({ workflows: [...s.workflows, wf], activeId: wf.id, selectedIds: [], execution: null, live: null }));
    schedulePersist(get);
    actions.toast('success', 'Workflow created', `"${name}" created.`);
  },
  duplicateWorkflow(id: string) {
    const wf = get().workflows.find((w) => w.id === id);
    if (!wf) return;
    const copy = cloneWorkflow(wf);
    copy.id = makeId();
    copy.name = wf.name + ' (copy)';
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    set((s) => ({ workflows: [...s.workflows, copy], activeId: copy.id }));
    actions.toast('success', 'Workflow duplicated', `"${copy.name}" created.`);
  },
  deleteWorkflow(id: string) {
    const s = get();
    const wf = s.workflows.find((w) => w.id === id);
    if (!wf) return;
    const workflows = s.workflows.filter((w) => w.id !== id);
    let activeId = s.activeId;
    if (activeId === id) activeId = workflows[0]?.id ?? null;
    set({ workflows, activeId, selectedIds: [], execution: null, live: null });
    actions.toast('info', 'Workflow deleted', `"${wf.name}" removed.`);
  },
  renameWorkflow(id: string, name: string) {
    if (!name.trim()) return;
    updateActive(get, set, (wf) => {
      if (wf.id === id) wf.name = name.trim();
    });
  },
  loadDemo() {
    const demo = createDemoWorkflow();
    set((s) => ({ workflows: [...s.workflows, demo], activeId: demo.id, selectedIds: [], execution: null, live: null }));
    actions.toast('success', 'Demo loaded', 'E-commerce order processing workflow ready to run.');
  },
  resetDemo() {
    const demo = createDemoWorkflow();
    const s = get();
    const workflows = s.workflows.map((w) => (w.id === s.activeId ? demo : w));
    set({ workflows, selectedIds: [], execution: null, live: null });
    actions.toast('success', 'Demo reset', 'The demonstration workflow has been restored.');
  },
  importWorkflow(text: string): boolean {
    const parsed = parseWorkflowJson(text);
    if (!parsed.ok) {
      actions.toast('error', 'Import failed', parsed.error);
      return false;
    }
    set((s) => ({ workflows: [...s.workflows, parsed.workflow], activeId: parsed.workflow.id, selectedIds: [], execution: null, live: null }));
    actions.toast('success', 'Workflow imported', `"${parsed.workflow.name}" imported successfully.`);
    return true;
  },

  // ---- canvas ----
  setView(patch: Partial<ViewTransform>) {
    set((s) => ({ view: { ...s.view, ...patch } }));
  },
  zoomBy(factor: number, center?: Pos) {
    set((s) => {
      const k = Math.min(3, Math.max(0.25, s.view.k * factor));
      let x = s.view.x;
      let y = s.view.y;
      if (center) {
        x = center.x - ((center.x - s.view.x) * k) / s.view.k;
        y = center.y - ((center.y - s.view.y) * k) / s.view.k;
      }
      return { view: { x, y, k } };
    });
  },
  setFit(view: ViewTransform) {
    set({ view });
  },

  // ---- selection ----
  selectSingle(id: string, additive = false) {
    set((s) => {
      const selectedIds = additive
        ? s.selectedIds.includes(id)
          ? s.selectedIds.filter((x) => x !== id)
          : [...s.selectedIds, id]
        : [id];
      return { selectedIds };
    });
  },
  selectMany(ids: string[]) {
    set({ selectedIds: ids });
  },
  clearSelection() {
    set({ selectedIds: [] });
  },

  // ---- nodes ----
  addNode(type: NodeType, position: Pos) {
    const node: WorkflowNode = { id: makeId(), type, position, config: defaultConfig(type) };
    recordBefore(get, set, { force: true });
    updateActive(get, set, (wf) => {
      wf.nodes.push(node);
    }, { selectedIds: [node.id] });
    return node.id;
  },
  beginNodeDrag() {
    recordBefore(get, set, { key: 'drag' });
  },
  endNodeDrag() {
    set({ historyOpen: false, historyOpenKey: null });
  },
  updateNodePosition(id: string, position: Pos) {
    updateActive(get, set, (wf) => {
      const n = wf.nodes.find((x) => x.id === id);
      if (n) n.position = position;
    });
  },
  updateNodeConfig(id: string, patch: Record<string, unknown>) {
    recordBefore(get, set, { key: `cfg:${id}` });
    updateActive(get, set, (wf) => {
      const n = wf.nodes.find((x) => x.id === id);
      if (n) n.config = { ...n.config, ...patch };
    });
    // close the history entry after an idle period
    const prev = configCommitTimers.get(id);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      set((s) => (s.historyOpen && s.historyOpenKey === `cfg:${id}` ? { historyOpen: false, historyOpenKey: null } : {}));
      configCommitTimers.delete(id);
    }, 650);
    configCommitTimers.set(id, timer);
  },
  setNodeConfig(id: string, patch: Record<string, unknown>) {
    actions.updateNodeConfig(id, patch);
  },
  connectEdge(source: string, sourcePort: string, target: string, targetPort: string): { ok: boolean; reason?: string } {
    const wf = activeWf(get);
    if (!wf) return { ok: false, reason: 'No active workflow.' };
    const check = canConnect(wf.nodes, wf.edges, source, sourcePort, target, targetPort);
    if (!check.ok) return check;
    recordBefore(get, set, { force: true });
    const edge: WorkflowEdge = { id: makeId(), source, sourcePort, target, targetPort };
    updateActive(get, set, (w) => {
      w.edges.push(edge);
    });
    return { ok: true };
  },
  disconnectEdge(edgeId: string) {
    recordBefore(get, set, { force: true });
    updateActive(get, set, (wf) => {
      wf.edges = wf.edges.filter((e) => e.id !== edgeId);
    });
  },
  removeNodes(ids: string[]) {
    const idSet = new Set(ids);
    recordBefore(get, set, { force: true });
    updateActive(get, set, (wf) => {
      wf.nodes = wf.nodes.filter((n) => !idSet.has(n.id));
      wf.edges = wf.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target));
    }, { selectedIds: [] });
  },
  duplicateNodes(ids: string[]) {
    const wf = activeWf(get);
    if (!wf) return;
    const originals = wf.nodes.filter((n) => ids.includes(n.id));
    if (originals.length === 0) return;
    recordBefore(get, set, { force: true });
    const idMap = new Map<string, string>();
    const copies: WorkflowNode[] = originals.map((n) => {
      const id = makeId();
      idMap.set(n.id, id);
      const copy: WorkflowNode = JSON.parse(JSON.stringify(n));
      copy.id = id;
      copy.position = { x: n.position.x + 36, y: n.position.y + 36 };
      return copy;
    });
    updateActive(get, set, (w) => {
      w.nodes.push(...copies);
      const newEdges: WorkflowEdge[] = [];
      for (const e of w.edges) {
        if (idMap.has(e.source) && idMap.has(e.target)) {
          newEdges.push({ ...e, id: makeId(), source: idMap.get(e.source)!, target: idMap.get(e.target)! });
        }
      }
      w.edges.push(...newEdges);
    }, { selectedIds: copies.map((c) => c.id) });
  },

  // ---- history ----
  undo() {
    const s = get();
    if (s.pendingSnapshot) {
      // revert an in-progress config edit
      const before = s.pendingSnapshot;
      updateActive(get, set, (wf) => {
        wf.nodes = JSON.parse(JSON.stringify(before.nodes));
        wf.edges = JSON.parse(JSON.stringify(before.edges));
      }, { pendingSnapshot: null, historyOpen: false, historyOpenKey: null });
      return;
    }
    const hist = s.histories[s.activeId!];
    if (!hist || hist.past.length === 0) return;
    const wf = activeWf(get);
    if (!wf) return;
    const prev = hist.past[hist.past.length - 1];
    const current = snapshotOf(wf);
    const past = hist.past.slice(0, -1);
    updateActive(get, set, (w) => {
      w.nodes = JSON.parse(JSON.stringify(prev.nodes));
      w.edges = JSON.parse(JSON.stringify(prev.edges));
    }, {
      histories: { ...s.histories, [s.activeId!]: { past, future: [current, ...hist.future].slice(0, 100) } },
      historyOpen: false,
      historyOpenKey: null,
    });
  },
  redo() {
    const s = get();
    const hist = s.histories[s.activeId!];
    if (!hist || hist.future.length === 0) return;
    const wf = activeWf(get);
    if (!wf) return;
    const next = hist.future[0];
    const current = snapshotOf(wf);
    updateActive(get, set, (w) => {
      w.nodes = JSON.parse(JSON.stringify(next.nodes));
      w.edges = JSON.parse(JSON.stringify(next.edges));
    }, {
      histories: {
        ...s.histories,
        [s.activeId!]: { past: [...hist.past, current].slice(-100), future: hist.future.slice(1) },
      },
      historyOpen: false,
      historyOpenKey: null,
    });
  },
  canUndo(): boolean {
    const s = get();
    if (s.pendingSnapshot) return true;
    return !!s.histories[s.activeId!]?.past.length;
  },
  canRedo(): boolean {
    const s = get();
    return !!s.histories[s.activeId!]?.future.length;
  },

  // ---- execution ----
  async runWorkflow(opts?: { animate?: boolean }) {
    const s = get();
    const wf = activeWf(get);
    if (!wf) {
      actions.toast('warning', 'No workflow', 'Create or open a workflow first.');
      return;
    }
    if (s.executing) return;
    const abort = new AbortController();
    currentAbort = abort;

    const pendingStates: Record<string, NodeRunState> = {};
    for (const n of wf.nodes) pendingStates[n.id] = { status: 'pending' };
    set({ executing: true, execution: null, live: { nodeStates: pendingStates, timelines: [] }, validationIssues: null });

    const animate = opts?.animate ?? true;
    try {
      const result = await executeWorkflow({
        workflow: wf,
        options: { animate, nodeDelayMs: 240 },
        signal: abort.signal,
        onProgress: (nodeId, status, info) => {
          set((st) => {
            if (!st.live) return {};
            const prev = st.live.nodeStates[nodeId] ?? {};
            const nodeStates = {
              ...st.live.nodeStates,
              [nodeId]: { ...prev, ...info, status },
            };
            const timelines = [...st.live.timelines, { t: Date.now(), nodeId, status }];
            return { live: { nodeStates, timelines } };
          });
        },
      });
      set({ executing: false, execution: result, live: null });
      const outKeys = Object.keys(result.outputs);
      if (result.status === 'completed') {
        actions.toast('success', 'Execution completed', `${result.processedRecords.toLocaleString()} records processed in ${result.durationMs} ms.`);
      } else if (result.status === 'cancelled') {
        actions.toast('warning', 'Execution cancelled', 'The run was cancelled before finishing.');
      } else {
        actions.toast('error', 'Execution failed', result.errors[0]?.message ?? 'One or more nodes failed.');
      }
      if (result.status === 'completed') {
        // surface field suggestions from real output data
        const fields: string[] = [];
        const seen = new Set<string>();
        for (const key of outKeys) {
          const rec = result.outputs[key].records[0];
          if (rec && typeof rec === 'object') {
            for (const k of Object.keys(rec as Record<string, unknown>)) {
              if (!seen.has(k)) {
                seen.add(k);
                fields.push(k);
              }
            }
          }
        }
        if (fields.length) set({ lastKnownFields: fields });
      }
    } catch (err) {
      set({ executing: false, live: null });
      actions.toast('error', 'Execution error', err instanceof Error ? err.message : String(err));
    }
  },
  cancelExecution() {
    if (currentAbort) currentAbort.abort();
  },
  resetExecution() {
    set({ execution: null, live: null });
  },

  // ---- validation ----
  validateActive() {
    const wf = activeWf(get);
    if (!wf) return;
    const issues = validateGraph(wf.nodes, wf.edges);
    set({ validationIssues: issues, inspectorMode: 'properties' });
    if (issues.length === 0) {
      actions.toast('success', 'Workflow valid', 'No problems found.');
    } else {
      const errs = issues.filter((i) => i.level === 'error').length;
      actions.toast(errs ? 'error' : 'warning', 'Validation results', `${issues.length} issue(s): ${errs} error(s), ${issues.length - errs} warning(s).`);
    }
  },

  // ---- UI panels ----
  setInspectorMode(mode: 'properties' | 'analytics') {
    set({ inspectorMode: mode });
  },
  toggleWfList() {
    set((s) => ({ wfListOpen: !s.wfListOpen }));
  },
  togglePalette() {
    set((s) => ({ paletteOpen: !s.paletteOpen }));
  },
  toast(kind: Toast['kind'], title: string, message?: string) {
    const id = makeId();
    set((s) => ({ toasts: [...s.toasts, { id, kind, title, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4600);
  },
  dismissToast(id: string) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
};

// Attach actions to the store so components can consume them through selectors.
useWorkspace.setState(actions as unknown as Partial<WorkspaceState>);

export type WorkspaceApi = WorkspaceState & typeof actions;
export const useFF = useWorkspace as unknown as import('zustand').UseBoundStore<
  import('zustand').StoreApi<WorkspaceApi>
>;

export const tbl = {
  activeWorkflow: (s: WorkspaceState) => s.workflows.find((w) => w.id === s.activeId) ?? null,
  nodeById: (wf: Workflow | null, id: string) => wf?.nodes.find((n) => n.id === id) ?? null,
  nodeSizeFor: (type: NodeType) => NODE_SIZE[type],
  portsFor: (type: NodeType) => NODE_PORTS[type],
};
