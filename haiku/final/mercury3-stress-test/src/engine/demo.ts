import type { WorkflowDoc, WorkflowEdge, WorkflowNode } from '../types';
import { SAMPLE_JSON } from './nodeDefs';

export const DEMO_WORKFLOW_ID = 'demo-order-processing';

/**
 * The built-in e-commerce order pipeline:
 * Start -> Generate 300 orders -> Filter active -> Compute totals -> Route by value -> Output.
 */
export function createDemoDoc(): WorkflowDoc {
  const nodes: WorkflowNode[] = [
    { id: 'start', type: 'start', name: 'Start', x: 40, y: 200, config: {} },
    {
      id: 'source',
      type: 'dataSource',
      name: 'Generate Orders',
      x: 330,
      y: 200,
      config: { source: 'generated', count: 300, seed: 20250, json: SAMPLE_JSON },
    },
    {
      id: 'filter',
      type: 'filter',
      name: 'Active Orders',
      x: 620,
      y: 200,
      config: {
        combinator: 'all',
        conditions: [
          { id: 'f_cancelled', field: 'status', operator: 'neq', value: 'Cancelled' },
          { id: 'f_returned', field: 'status', operator: 'neq', value: 'Returned' },
        ],
      },
    },
    {
      id: 'transform',
      type: 'transform',
      name: 'Calculate Totals',
      x: 910,
      y: 200,
      config: {
        operations: [{ id: 't_total', type: 'compute', target: 'orderTotal', expression: 'round(quantity * unitPrice, 2)' }],
      },
    },
    {
      id: 'condition',
      type: 'condition',
      name: 'High Value?',
      x: 1200,
      y: 200,
      config: { condition: { id: 'c_high', field: 'orderTotal', operator: 'gte', value: '250' } },
    },
    { id: 'delay', type: 'delay', name: 'Priority Queue', x: 1490, y: 90, config: { ms: 150 } },
    {
      id: 'out_high',
      type: 'output',
      name: 'High-Value Orders',
      x: 1780,
      y: 90,
      config: { title: 'High-value orders', maxRows: 500 },
    },
    {
      id: 'out_regular',
      type: 'output',
      name: 'Regular Orders',
      x: 1490,
      y: 320,
      config: { title: 'Regular orders', maxRows: 500 },
    },
  ];

  const edges: WorkflowEdge[] = [
    { id: 'e1', source: 'start', sourcePort: 'out', target: 'source', targetPort: 'in' },
    { id: 'e2', source: 'source', sourcePort: 'out', target: 'filter', targetPort: 'in' },
    { id: 'e3', source: 'filter', sourcePort: 'out', target: 'transform', targetPort: 'in' },
    { id: 'e4', source: 'transform', sourcePort: 'out', target: 'condition', targetPort: 'in' },
    { id: 'e5', source: 'condition', sourcePort: 'true', target: 'delay', targetPort: 'in' },
    { id: 'e6', source: 'delay', sourcePort: 'out', target: 'out_high', targetPort: 'in' },
    { id: 'e7', source: 'condition', sourcePort: 'false', target: 'out_regular', targetPort: 'in' },
  ];

  return { format: 'flowforge-workflow', version: 1, name: 'Order Processing (Demo)', nodes, edges };
}
