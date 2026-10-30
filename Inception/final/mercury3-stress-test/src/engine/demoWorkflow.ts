import type { Workflow } from '../types';
import { makeId } from './graph';

// ---------------------------------------------------------------------------
// Built-in demonstration workflow: E-commerce order processing
// ---------------------------------------------------------------------------

export function createDemoWorkflow(): Workflow {
  const now = Date.now();
  const wf: Workflow = {
    id: makeId(),
    name: 'Demo · E-commerce order processing',
    nodes: [
      {
        id: 'n-start',
        type: 'start',
        position: { x: 60, y: 260 },
        config: { label: 'Start' },
      },
      {
        id: 'n-source',
        type: 'dataSource',
        position: { x: 320, y: 240 },
        config: {
          label: 'Sample orders',
          dataSourceMode: 'generate',
          sampleSchema: 'orders',
          recordCount: 300,
          seed: 20241001,
          pastedJson: '',
        },
      },
      {
        id: 'n-filter',
        type: 'filter',
        position: { x: 600, y: 240 },
        config: {
          label: 'Only completed orders',
          cond: {
            combinator: 'and',
            rows: [
              { id: makeId(), field: 'status', op: 'eq', value: 'completed' },
            ],
          },
        },
      },
      {
        id: 'n-transform',
        type: 'transform',
        position: { x: 880, y: 240 },
        config: {
          label: 'Order totals',
          transformOps: [
            {
              id: makeId(),
              type: 'calculate',
              toField: 'totalValue',
              formula: 'round($quantity * $unitPrice, 2)',
            },
            {
              id: makeId(),
              type: 'calculate',
              toField: 'totalFormatted',
              formula: 'currency($totalValue)',
            },
          ],
        },
      },
      {
        id: 'n-condition',
        type: 'condition',
        position: { x: 1160, y: 240 },
        config: {
          label: 'High value ≥ $200',
          cond: {
            combinator: 'and',
            rows: [
              { id: makeId(), field: 'totalValue', op: 'gte', value: '200' },
            ],
          },
        },
      },
      {
        id: 'n-high',
        type: 'output',
        position: { x: 1440, y: 80 },
        config: { label: 'High-value orders', outputLabel: 'High-value orders', maxRows: 200, prettyJson: true },
      },
      {
        id: 'n-regular',
        type: 'output',
        position: { x: 1440, y: 400 },
        config: { label: 'Regular orders', outputLabel: 'Regular orders', maxRows: 200, prettyJson: true },
      },
    ],
    edges: [
      { id: makeId(), source: 'n-start', sourcePort: 'out', target: 'n-source', targetPort: 'in' },
      { id: makeId(), source: 'n-source', sourcePort: 'out', target: 'n-filter', targetPort: 'in' },
      { id: makeId(), source: 'n-filter', sourcePort: 'out', target: 'n-transform', targetPort: 'in' },
      { id: makeId(), source: 'n-transform', sourcePort: 'out', target: 'n-condition', targetPort: 'in' },
      { id: makeId(), source: 'n-condition', sourcePort: 'true', target: 'n-high', targetPort: 'in' },
      { id: makeId(), source: 'n-condition', sourcePort: 'false', target: 'n-regular', targetPort: 'in' },
    ],
    createdAt: now,
    updatedAt: now,
    demo: true,
  };
  // Note: START outputs no records, so the data-source node runs regardless.
  return wf;
}

export function createEmptyWorkflow(name: string): Workflow {
  const now = Date.now();
  return {
    id: makeId(),
    name,
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
}
