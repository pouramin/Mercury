import type { NodeConfigs, NodeType, PortId, WorkflowNode } from '../types';

export interface NodeDef<T extends NodeType = NodeType> {
  type: T;
  label: string;
  description: string;
  hasInput: boolean;
  outputs: PortId[];
  defaultConfig: () => NodeConfigs[T];
}

export const NODE_TYPES: NodeType[] = ['start', 'dataSource', 'filter', 'transform', 'condition', 'delay', 'output'];

export const SAMPLE_JSON = `[
  { "orderId": "A-1", "customer": "Ada", "quantity": 2, "unitPrice": 19.5 },
  { "orderId": "A-2", "customer": "Ben", "quantity": 1 }
]`;

export const NODE_DEFS: { [K in NodeType]: NodeDef<K> } = {
  start: {
    type: 'start',
    label: 'Start',
    description: 'Begins workflow execution. Exactly one is required.',
    hasInput: false,
    outputs: ['out'],
    defaultConfig: () => ({}),
  },
  dataSource: {
    type: 'dataSource',
    label: 'Data Source',
    description: 'Generates 300+ sample orders deterministically, or accepts a JSON array of records.',
    hasInput: true,
    outputs: ['out'],
    defaultConfig: () => ({ source: 'generated', count: 300, seed: 20250, json: SAMPLE_JSON }),
  },
  filter: {
    type: 'filter',
    label: 'Filter',
    description: 'Keeps only records that match the configured conditions.',
    hasInput: true,
    outputs: ['out'],
    defaultConfig: () => ({
      combinator: 'all',
      conditions: [{ id: 'c_status', field: 'status', operator: 'neq', value: 'Cancelled' }],
    }),
  },
  transform: {
    type: 'transform',
    label: 'Transform',
    description: 'Renames, computes, sets, removes or re-cases fields on every record.',
    hasInput: true,
    outputs: ['out'],
    defaultConfig: () => ({
      operations: [{ id: 'op_total', type: 'compute', target: 'orderTotal', expression: 'round(quantity * unitPrice, 2)' }],
    }),
  },
  condition: {
    type: 'condition',
    label: 'Condition',
    description: 'Routes each record to the True or False output based on one condition.',
    hasInput: true,
    outputs: ['true', 'false'],
    defaultConfig: () => ({ condition: { id: 'c_value', field: 'orderTotal', operator: 'gte', value: '250' } }),
  },
  delay: {
    type: 'delay',
    label: 'Delay',
    description: 'Pauses execution for a configurable time, then passes records through.',
    hasInput: true,
    outputs: ['out'],
    defaultConfig: () => ({ ms: 150 }),
  },
  output: {
    type: 'output',
    label: 'Output',
    description: 'Collects the final dataset and shows it as a table and JSON.',
    hasInput: true,
    outputs: [],
    defaultConfig: () => ({ title: 'Results', maxRows: 500 }),
  },
};

export function outputPorts(type: NodeType): PortId[] {
  return NODE_DEFS[type].outputs;
}

export function defaultNodeName(type: NodeType): string {
  return NODE_DEFS[type].label;
}

/** One-line description of a node's configuration, shown on the canvas card. */
export function summarizeNode(node: WorkflowNode): string {
  switch (node.type) {
    case 'start':
      return 'Begin execution';
    case 'dataSource':
      return node.config.source === 'generated'
        ? `${node.config.count} generated orders (seed ${node.config.seed})`
        : 'JSON records';
    case 'filter': {
      const n = node.config.conditions.length;
      return n === 0 ? 'No conditions (passes all)' : `${n} condition${n === 1 ? '' : 's'} · match ${node.config.combinator}`;
    }
    case 'transform':
      return `${node.config.operations.length} operation${node.config.operations.length === 1 ? '' : 's'}`;
    case 'condition': {
      const c = node.config.condition;
      return `${c.field || '?'} ${c.operator} ${c.value}`;
    }
    case 'delay':
      return `Wait ${node.config.ms} ms`;
    case 'output':
      return `${node.config.title || 'Untitled'} · up to ${node.config.maxRows} rows`;
  }
}
