// ---------------------------------------------------------------------------
// Core domain types for FlowForge Studio
// ---------------------------------------------------------------------------

export type NodeType =
  | 'start'
  | 'dataSource'
  | 'filter'
  | 'transform'
  | 'condition'
  | 'delay'
  | 'output';

export interface Pos {
  x: number;
  y: number;
}

export type FieldOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'in'
  | 'notIn';

export interface ConditionRow {
  id: string;
  field: string;
  op: FieldOp;
  value: string;
}

export interface ConditionGroup {
  combinator: 'and' | 'or';
  rows: ConditionRow[];
}

export type TransformOpType =
  | 'rename'
  | 'setConstant'
  | 'calculate'
  | 'remove';

export interface TransformOp {
  id: string;
  type: TransformOpType;
  fromField?: string;
  toField?: string;
  value?: string;
  formula?: string;
}

export type DataSourceMode = 'generate' | 'paste';

/** Free-form per-node configuration. Validated by each node's controller. */
export interface NodeConfig {
  label?: string;
  dataSourceMode?: DataSourceMode;
  sampleSchema?: string;
  recordCount?: number;
  seed?: number;
  pastedJson?: string;
  cond?: ConditionGroup;
  transformOps?: TransformOp[];
  delayMs?: number;
  outputLabel?: string;
  maxRows?: number;
  prettyJson?: boolean;
  [k: string]: unknown;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: Pos;
  config: NodeConfig;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: number;
  updatedAt: number;
  demo?: boolean;
}

export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  updatedAt: number;
  demo?: boolean;
}
