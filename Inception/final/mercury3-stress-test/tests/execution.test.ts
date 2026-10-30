import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowEdge, WorkflowNode } from '../src/types';
import { makeId } from '../src/engine/graph';
import { executeWorkflow } from '../src/engine/execute';
import { createDemoWorkflow } from '../src/engine/demoWorkflow';

function node(type: WorkflowNode['type'], id: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, config };
}
function edge(source: string, sourcePort: string, target: string, targetPort: string): WorkflowEdge {
  return { id: makeId(), source, sourcePort, target, targetPort };
}
function wf(nodes: WorkflowNode[], edges: WorkflowEdge[]): Workflow {
  return { id: 'wf-' + makeId(), name: 'test', nodes, edges, createdAt: Date.now(), updatedAt: Date.now() };
}

const RECORDS = [
  { id: 1, qty: 2, price: 10, cat: 'a', status: 'ok' },
  { id: 2, qty: 0, price: 5, cat: 'b', status: 'bad' },
  { id: 3, qty: 5, price: 100, cat: 'a', status: 'ok' },
];

function sourceNode(id = 'src'): WorkflowNode {
  return node('dataSource', id, { dataSourceMode: 'paste', pastedJson: JSON.stringify(RECORDS) });
}

const run = (workflow: Workflow) =>
  executeWorkflow({ workflow, options: { animate: false, nodeDelayMs: 0 } });

describe('workflow execution', () => {
  it('applies filters accurately', async () => {
    const w = wf(
      [
        sourceNode(),
        node('filter', 'f', { cond: { combinator: 'and', rows: [{ id: makeId(), field: 'status', op: 'eq', value: 'ok' }] } }),
        node('output', 'o'),
      ],
      [edge('src', 'out', 'f', 'in'), edge('f', 'out', 'o', 'in')],
    );
    const r = await run(w);
    expect(r.status).toBe('completed');
    expect(r.errors).toHaveLength(0);
    const out = r.outputs['o'].records;
    expect(out).toHaveLength(2);
    expect(out.map((x) => (x as { id: number }).id).sort()).toEqual([1, 3]);
    expect(r.filteredRecords).toBe(1);
    expect(r.totalInputRecords).toBe(3);
    expect(r.processedRecords).toBe(2);
  });

  it('calculates transformed values accurately', async () => {
    const w = wf(
      [
        sourceNode(),
        node('transform', 't', {
          transformOps: [
            { id: makeId(), type: 'calculate', toField: 'total', formula: 'round($qty * $price, 2)' },
            { id: makeId(), type: 'calculate', toField: 'totalFmt', formula: 'currency($total)' },
          ],
        }),
        node('output', 'o'),
      ],
      [edge('src', 'out', 't', 'in'), edge('t', 'out', 'o', 'in')],
    );
    const r = await run(w);
    expect(r.status).toBe('completed');
    const out = r.outputs['o'].records;
    expect(out).toHaveLength(3);
    const first = out[0] as { total: number; totalFmt: string };
    expect(first.total).toBe(20);
    expect(first.totalFmt).toBe('$20');
    const third = out[2] as { total: number };
    expect(third.total).toBe(500);
  });

  it('routes condition branches correctly', async () => {
    const w = wf(
      [
        sourceNode(),
        node('transform', 't', {
          transformOps: [{ id: makeId(), type: 'calculate', toField: 'total', formula: '$qty * $price' }],
        }),
        node('condition', 'c', {
          cond: { combinator: 'and', rows: [{ id: makeId(), field: 'total', op: 'gte', value: '200' }] },
        }),
        node('output', 'high'),
        node('output', 'reg'),
      ],
      [
        edge('src', 'out', 't', 'in'),
        edge('t', 'out', 'c', 'in'),
        edge('c', 'true', 'high', 'in'),
        edge('c', 'false', 'reg', 'in'),
      ],
    );
    const r = await run(w);
    expect(r.status).toBe('completed');
    const high = r.outputs['high'].records.map((x) => (x as { id: number }).id);
    const reg = r.outputs['reg'].records.map((x) => (x as { id: number }).id);
    expect(high).toEqual([3]);
    expect(reg).toEqual([1, 2]);
    expect(r.branchDistribution['condition · True']).toBe(1);
    expect(r.branchDistribution['condition · False']).toBe(2);
    expect(r.processedRecords).toBe(3);
  });

  it('handles empty datasets gracefully', async () => {
    const w = wf(
      [
        node('dataSource', 'src', { dataSourceMode: 'generate', recordCount: 0, seed: 1 }),
        node('filter', 'f', { cond: { combinator: 'and', rows: [{ id: makeId(), field: 'status', op: 'eq', value: 'ok' }] } }),
        node('output', 'o'),
      ],
      [edge('src', 'out', 'f', 'in'), edge('f', 'out', 'o', 'in')],
    );
    const r = await run(w);
    expect(r.status).toBe('completed');
    expect(r.totalInputRecords).toBe(0);
    expect(r.processedRecords).toBe(0);
    expect(r.outputs['o'].records).toEqual([]);
    expect(r.filteredRecords).toBe(0);
  });

  it('does not crash on missing fields and produces null results', async () => {
    const recs = [{ id: 1, price: 10 }, { id: 2, qty: 3, price: 4 }];
    const w = wf(
      [
        node('dataSource', 'src', { dataSourceMode: 'paste', pastedJson: JSON.stringify(recs) }),
        node('transform', 't', {
          transformOps: [{ id: makeId(), type: 'calculate', toField: 'total', formula: '$qty * $price' }],
        }),
        node('output', 'o'),
      ],
      [edge('src', 'out', 't', 'in'), edge('t', 'out', 'o', 'in')],
    );
    const r = await run(w);
    expect(r.status).toBe('completed');
    const out = r.outputs['o'].records as Array<{ total: number | null }>;
    expect(out[0].total).toBeNull();
    expect(out[1].total).toBe(12);
  });

  it('fails clearly on invalid transformation formulas', async () => {
    const w = wf(
      [
        sourceNode(),
        node('transform', 't', {
          transformOps: [{ id: makeId(), type: 'calculate', toField: 'x', formula: 'qty *' }],
        }),
        node('output', 'o'),
      ],
      [edge('src', 'out', 't', 'in'), edge('t', 'out', 'o', 'in')],
    );
    const r = await run(w);
    expect(r.status).toBe('failed');
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0].message).toMatch(/formula|Expected|Unexpected|trailing/i);
    expect(r.nodeStates['t'].status).toBe('failed');
    expect(r.nodeStates['o'].status).toBe('skipped');
  });

  it('fails clearly on invalid filter conditions', async () => {
    const w = wf(
      [
        sourceNode(),
        node('filter', 'f', { cond: { combinator: 'and', rows: [{ id: makeId(), field: 'qty', op: 'gt', value: '' }] } }),
        node('output', 'o'),
      ],
      [edge('src', 'out', 'f', 'in'), edge('f', 'out', 'o', 'in')],
    );
    const r = await run(w);
    expect(r.status).toBe('failed');
    expect(r.errors[0].message).toMatch(/Filter conditions are invalid/i);
  });

  it('merges multiple input branches', async () => {
    const w = wf(
      [
        node('dataSource', 'a', { dataSourceMode: 'paste', pastedJson: '[{"n":1}]' }),
        node('dataSource', 'b', { dataSourceMode: 'paste', pastedJson: '[{"n":2},{"n":3}]' }),
        node('output', 'o'),
      ],
      [edge('a', 'out', 'o', 'in'), edge('b', 'out', 'o', 'in')],
    );
    const r = await run(w);
    expect(r.status).toBe('completed');
    const ns = r.outputs['o'].records.map((x) => (x as { n: number }).n).sort();
    expect(ns).toEqual([1, 2, 3]);
  });

  it('starts are non-emitting but complete', async () => {
    const w = wf(
      [node('start', 's'), node('output', 'o')],
      [edge('s', 'out', 'o', 'in')],
    );
    const r = await run(w);
    expect(r.status).toBe('completed');
    expect(r.nodeStates['s'].status).toBe('completed');
    expect(r.outputs['o'].records).toEqual([]);
    expect(r.processedRecords).toBe(0);
  });
});

describe('determinism and scale', () => {
  it('produces identical results across runs for the demo workflow', async () => {
    const demoA = createDemoWorkflow();
    const demoB = createDemoWorkflow();
    const ra = await run(demoA);
    const rb = await run(demoB);
    expect(JSON.stringify(ra.outputs)).toBe(JSON.stringify(rb.outputs));
    // Sanity: demo should generate 300 records and both branches should be populated
    expect(ra.totalInputRecords).toBe(300);
    expect(ra.processedRecords).toBeGreaterThan(0);
    expect(Object.keys(ra.outputs)).toHaveLength(2);
  });

  it('demo output math is correct (totals and branch threshold)', async () => {
    const demo = createDemoWorkflow();
    const r = await run(demo);
    expect(r.status).toBe('completed');
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const high = r.outputs['n-high'].records as Array<{ quantity: number; unitPrice: number; totalValue: number }>;
    const reg = r.outputs['n-regular'].records as Array<{ quantity: number; unitPrice: number; totalValue: number }>;
    expect(high.length).toBeGreaterThan(0);
    expect(reg.length).toBeGreaterThan(0);
    for (const rec of high) {
      expect(rec.totalValue).toBe(round2(rec.quantity * rec.unitPrice));
      expect(rec.totalValue).toBeGreaterThanOrEqual(200);
    }
    for (const rec of reg) {
      expect(rec.totalValue).toBe(round2(rec.quantity * rec.unitPrice));
      expect(rec.totalValue).toBeLessThan(200);
    }
    expect(high.length + reg.length).toBe(r.processedRecords);
  });

  it('handles a large dataset (5000 records)', async () => {
    const w = wf(
      [
        node('dataSource', 'src', { dataSourceMode: 'generate', recordCount: 5000, seed: 7 }),
        node('transform', 't', {
          transformOps: [{ id: makeId(), type: 'calculate', toField: 'total', formula: 'round($quantity * $unitPrice, 2)' }],
        }),
        node('output', 'o'),
      ],
      [edge('src', 'out', 't', 'in'), edge('t', 'out', 'o', 'in')],
    );
    const r = await run(w);
    expect(r.status).toBe('completed');
    expect(r.totalInputRecords).toBe(5000);
    expect(r.outputs['o'].records).toHaveLength(5000);
  });
});

describe('cancellation', () => {
  it('cancels a running workflow mid-delay', async () => {
    const w = wf(
      [
        sourceNode('src'),
        node('delay', 'd', { delayMs: 3000 }),
        node('output', 'o'),
      ],
      [edge('src', 'out', 'd', 'in'), edge('d', 'out', 'o', 'in')],
    );
    const ac = new AbortController();
    const started = Date.now();
    const promise = executeWorkflow({ workflow: w, options: { animate: false }, signal: ac.signal });
    setTimeout(() => ac.abort(), 30);
    const r = await promise;
    expect(r.status).toBe('cancelled');
    expect(Date.now() - started).toBeLessThan(2500);
    expect(r.nodeStates['d'].status).toBe('failed');
    expect(r.nodeStates['d'].error).toMatch(/cancel/i);
    expect(r.nodeStates['o'].status).toBe('skipped');
  });

  it('cancelling during animation pacing keeps finished nodes completed', async () => {
    const w = wf(
      [
        node('dataSource', 'a', { dataSourceMode: 'paste', pastedJson: '[{"n":1}]' }),
        node('dataSource', 'b', { dataSourceMode: 'paste', pastedJson: '[{"n":2}]' }),
        node('output', 'oa'),
        node('output', 'ob'),
      ],
      [edge('a', 'out', 'oa', 'in'), edge('b', 'out', 'ob', 'in')],
    );
    const ac = new AbortController();
    const promise = executeWorkflow({ workflow: w, options: { animate: true, nodeDelayMs: 20000 }, signal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    const r = await promise;
    expect(r.status).toBe('cancelled');
    expect(r.nodeStates['a'].status).toBe('completed');
    expect(r.nodeStates['b'].status).toBe('skipped');
    expect(r.nodeStates['oa'].status).toBe('skipped');
    expect(r.nodeStates['ob'].status).toBe('skipped');
  });

  it('aborts before starting when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const w = wf([sourceNode(), node('output', 'o')], [edge('src', 'out', 'o', 'in')]);
    const r = await executeWorkflow({ workflow: w, options: { animate: false }, signal: ac.signal });
    expect(r.status).toBe('cancelled');
    expect(r.nodeStates['src'].status).toBe('skipped');
  });
});
