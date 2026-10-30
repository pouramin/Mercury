// Application state: named workflows, undo/redo history of the active graph, and
// local-first persistence through localStorage.

import type { RunSummary, Workflow, WorkflowDoc } from '../types';
import { createDemoDoc, DEMO_WORKFLOW_ID } from '../engine/demo';
import { parseWorkflowValue } from '../engine/serialization';

export const STORAGE_KEY = 'flowforge-studio.v1';
const HISTORY_LIMIT = 200;
const RUN_HISTORY_LIMIT = 25;

export interface AppState {
  workflows: Workflow[];
  activeId: string;
  past: WorkflowDoc[];
  future: WorkflowDoc[];
  /** Consecutive edits with the same key (e.g. typing in one field) share one undo step. */
  coalesceKey: string | null;
}

export type Action =
  | { type: 'commit'; doc: WorkflowDoc; key?: string }
  | { type: 'preview'; doc: WorkflowDoc }
  | { type: 'checkpoint'; doc: WorkflowDoc }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select'; id: string }
  | { type: 'create'; workflow: Workflow }
  | { type: 'resetDoc'; id: string; doc: WorkflowDoc }
  | { type: 'remove'; id: string }
  | { type: 'rename'; id: string; name: string }
  | { type: 'addRun'; id: string; run: RunSummary };

export function activeWorkflow(state: AppState): Workflow {
  return state.workflows.find((w) => w.id === state.activeId) ?? state.workflows[0];
}

function withActiveDoc(state: AppState, doc: WorkflowDoc): Workflow[] {
  const now = new Date().toISOString();
  return state.workflows.map((w) => (w.id === state.activeId ? { ...w, doc, updatedAt: now } : w));
}

function demoWorkflow(): Workflow {
  return { id: DEMO_WORKFLOW_ID, doc: createDemoDoc(), updatedAt: new Date().toISOString(), runs: [] };
}

export function reducer(state: AppState, action: Action): AppState {
  const current = activeWorkflow(state).doc;
  switch (action.type) {
    case 'commit': {
      if (action.doc === current) return state;
      const merging = action.key !== undefined && action.key === state.coalesceKey;
      if (merging) {
        return { ...state, workflows: withActiveDoc(state, action.doc) };
      }
      return {
        ...state,
        workflows: withActiveDoc(state, action.doc),
        past: [...state.past, current].slice(-HISTORY_LIMIT),
        future: [],
        coalesceKey: action.key ?? null,
      };
    }
    case 'preview':
      return { ...state, workflows: withActiveDoc(state, action.doc) };
    case 'checkpoint':
      return { ...state, past: [...state.past, action.doc].slice(-HISTORY_LIMIT), future: [], coalesceKey: null };
    case 'undo': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        workflows: withActiveDoc(state, previous),
        past: state.past.slice(0, -1),
        future: [current, ...state.future],
        coalesceKey: null,
      };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return {
        ...state,
        workflows: withActiveDoc(state, next),
        past: [...state.past, current],
        future: rest,
        coalesceKey: null,
      };
    }
    case 'select':
      if (!state.workflows.some((w) => w.id === action.id)) return state;
      return { ...state, activeId: action.id, past: [], future: [], coalesceKey: null };
    case 'create':
      return {
        ...state,
        workflows: [...state.workflows, action.workflow],
        activeId: action.workflow.id,
        past: [],
        future: [],
        coalesceKey: null,
      };
    case 'resetDoc': {
      const exists = state.workflows.some((w) => w.id === action.id);
      if (!exists) return reducer(state, { type: 'create', workflow: { id: action.id, doc: action.doc, updatedAt: new Date().toISOString(), runs: [] } });
      const next = { ...state, activeId: action.id, past: [], future: [], coalesceKey: null };
      return reducer(next, { type: 'commit', doc: action.doc });
    }
    case 'remove': {
      if (state.workflows.length <= 1) return state;
      const workflows = state.workflows.filter((w) => w.id !== action.id);
      const activeId = action.id === state.activeId ? workflows[0].id : state.activeId;
      return { ...state, workflows, activeId, past: [], future: [], coalesceKey: null };
    }
    case 'rename': {
      const now = new Date().toISOString();
      return {
        ...state,
        workflows: state.workflows.map((w) =>
          w.id === action.id ? { ...w, doc: { ...w.doc, name: action.name }, updatedAt: now } : w,
        ),
      };
    }
    case 'addRun':
      return {
        ...state,
        workflows: state.workflows.map((w) =>
          w.id === action.id ? { ...w, runs: [...w.runs, action.run].slice(-RUN_HISTORY_LIMIT) } : w,
        ),
      };
  }
}

interface StoredWorkflow {
  id: string;
  doc: unknown;
  updatedAt: string;
  runs: RunSummary[];
}

interface StoredState {
  version: 1;
  activeId: string;
  workflows: StoredWorkflow[];
}

export function createInitialState(): AppState {
  const fallback = (): AppState => {
    const demo = demoWorkflow();
    return { workflows: [demo], activeId: demo.id, past: [], future: [], coalesceKey: null };
  };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback();
    const stored = JSON.parse(raw) as StoredState;
    if (!stored || stored.version !== 1 || !Array.isArray(stored.workflows)) return fallback();

    const workflows: Workflow[] = [];
    for (const entry of stored.workflows) {
      if (typeof entry?.id !== 'string') continue;
      const parsed = parseWorkflowValue(entry.doc);
      if (!parsed.ok) continue;
      const runs = Array.isArray(entry.runs) ? entry.runs.filter(isRunSummary).slice(-RUN_HISTORY_LIMIT) : [];
      workflows.push({
        id: entry.id,
        doc: parsed.doc,
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
        runs,
      });
    }
    if (workflows.length === 0) return fallback();
    const activeId = workflows.some((w) => w.id === stored.activeId) ? stored.activeId : workflows[0].id;
    return { workflows, activeId, past: [], future: [], coalesceKey: null };
  } catch {
    return fallback();
  }
}

function isRunSummary(value: unknown): value is RunSummary {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as RunSummary).runId === 'string' &&
    typeof (value as RunSummary).startedAt === 'number'
  );
}

export function persistState(state: AppState): void {
  try {
    const stored: StoredState = {
      version: 1,
      activeId: state.activeId,
      workflows: state.workflows.map((w) => ({ id: w.id, doc: w.doc, updatedAt: w.updatedAt, runs: w.runs })),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage can be full or blocked; the app keeps working in memory.
  }
}
