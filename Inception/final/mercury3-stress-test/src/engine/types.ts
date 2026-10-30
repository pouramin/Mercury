import type { WorkflowNode } from '../types';

// ---------------------------------------------------------------------------
// Execution engine types
// ---------------------------------------------------------------------------

export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface NodeRunState {
  status: NodeStatus;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  inputCount?: number;
  outputCount?: number;
  filteredCount?: number;
  branchCounts?: Record<string, number>;
  error?: string;
}

export interface NodeOutputs {
  [portId: string]: unknown[];
}

export interface NodeMeta {
  filteredCount?: number;
  branchCounts?: Record<string, number>;
  /** Captured records for OUTPUT (sink) nodes. */
  outRecords?: unknown[];
}

export interface RunOptions {
  /** True to animate (add small pacing delay between node stages). */
  animate: boolean;
  /** Base pacing delay between nodes when animating. */
  nodeDelayMs: number;
}

export interface RunContext {
  node: WorkflowNode;
  inputs: Record<string, unknown[]>;
  mergedInput: unknown[];
  signal: AbortSignal;
  opts: RunOptions;
}

export type NodeProcessor = (
  ctx: RunContext,
) => Promise<{ outputs: NodeOutputs; meta?: NodeMeta }>;

export interface ExecutionIssue {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface TimelineEntry {
  t: number;
  nodeId: string;
  status: NodeStatus;
  label?: string;
}

export interface ExecutionResult {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  /** Node ids in topological execution order. */
  order: string[];
  nodeStates: Record<string, NodeRunState>;
  issues: ExecutionIssue[];
  errors: { nodeId?: string; message: string }[];
  totalInputRecords: number;
  processedRecords: number;
  filteredRecords: number;
  branchDistribution: Record<string, number>;
  timelines: TimelineEntry[];
  /** Dataset sink for OUTPUT nodes: portId -> records. */
  outputs: Record<string, { nodeId: string; portId: string; records: unknown[] }>;
}
