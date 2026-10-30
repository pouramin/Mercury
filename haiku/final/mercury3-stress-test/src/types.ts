// Core domain types shared by the engine, state layer and UI.

export type DataRecord = Record<string, unknown>;

export type NodeType = 'start' | 'dataSource' | 'filter' | 'transform' | 'condition' | 'delay' | 'output';

export type PortId = 'in' | 'out' | 'true' | 'false';

export type Operator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'startsWith'
  | 'in'
  | 'exists'
  | 'matches';

export interface Condition {
  id: string;
  field: string;
  operator: Operator;
  value: string;
}

export type TransformOp =
  | { id: string; type: 'rename'; from: string; to: string }
  | { id: string; type: 'compute'; target: string; expression: string }
  | { id: string; type: 'set'; target: string; value: string; valueType: 'string' | 'number' | 'boolean' | 'null' }
  | { id: string; type: 'remove'; field: string }
  | { id: string; type: 'case'; field: string; mode: 'upper' | 'lower' };

export interface NodeConfigs {
  start: Record<string, never>;
  dataSource: { source: 'generated' | 'json'; count: number; seed: number; json: string };
  filter: { combinator: 'all' | 'any'; conditions: Condition[] };
  transform: { operations: TransformOp[] };
  condition: { condition: Condition };
  delay: { ms: number };
  output: { title: string; maxRows: number };
}

export type WorkflowNode = {
  [K in NodeType]: {
    id: string;
    type: K;
    name: string;
    x: number;
    y: number;
    config: NodeConfigs[K];
  };
}[NodeType];

export interface WorkflowEdge {
  id: string;
  source: string;
  sourcePort: PortId;
  target: string;
  targetPort: 'in';
}

export interface WorkflowDoc {
  format: 'flowforge-workflow';
  version: 1;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type RunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface NodeRunState {
  status: NodeStatus;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  inputCount: number;
  outputCounts: Record<string, number>;
  warnings: number;
  message: string;
}

export interface RunIssue {
  nodeId?: string;
  message: string;
}

export interface ExecutionResult {
  runId: string;
  status: RunStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs: number;
  order: string[];
  nodes: Record<string, NodeRunState>;
  /** Records emitted per port, keyed `${nodeId}:${port}`. */
  portRecords: Record<string, DataRecord[]>;
  issues: RunIssue[];
}

export interface RunSummary {
  runId: string;
  startedAt: number;
  durationMs: number;
  status: RunStatus;
  inputRecords: number;
  processed: number;
  filtered: number;
  trueCount: number;
  falseCount: number;
  errorCount: number;
}

export interface Workflow {
  id: string;
  doc: WorkflowDoc;
  updatedAt: string;
  runs: RunSummary[];
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  /** structure errors block execution; config errors fail only their node. */
  kind: 'structure' | 'config' | 'graph';
  message: string;
  nodeId?: string;
  edgeId?: string;
}
