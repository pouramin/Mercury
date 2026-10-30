import { describe, expect, it } from 'vitest';
import { runWorkflow } from '../src/engine/executor';
import { createDemoDoc } from '../src/engine/demo';
import { generateOrders } from '../src/engine/sampleOrders';
import { computeAnalytics } from '../src/engine/analytics';
import type { DataRecord, WorkflowDoc, WorkflowEdge, WorkflowNode } from '../src/types';

function docWith(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDoc {
  return { format: 'flowforge-workflow', version: 1, name: 'test', nodes, edges };
}

const start: WorkflowNode = { id: 'start', type: 'start', name: 'Start', x: 0, y: 0, config: {} };
const link = (id: string, source: string, target: string, sourcePort: WorkflowEdge['sourcePort'] = 'out'): WorkflowEdge => ({
  id,
  source,
  sourcePort,
  target,
  targetPort: 'in',
});

/** Independent reference implementation of the demo pipeline, used to verify engine output. */
function expectedDemo(threshold: number) {
  const orders = generateOrders(300, 20250);
  const active = orders.filter((o) => o.status !== 'Cancelled' && o.status !== 'Returned');
  const withTotals: Array<DataRecord & { orderTotal: number }> = active.map((o) => ({
    ...o,
    orderTotal: Math.round((o.quantity as number) * (o.unitPrice as number) * 100) / 100,
  }));
  const high = withTotals.filter((o) => o.orderTotal >= threshold);
  const regular = withTotals.filter((o) => o.orderTotal < threshold);
  return { active, high, regular };
}

describe('execution engine: built-in demo', () => {
  it('produces mathematically correct branch datasets', async () => {
    const result = await runWorkflow(createDemoDoc());
    const exp = expectedDemo(250);

    expect(result.status).toBe('completed');
    expect(result.nodes.source.outputCounts.out).toBe(300);
    expect(result.nodes.filter.outputCounts.out).toBe(exp.active.length);
    expect(result.nodes.condition.outputCounts.true).toBe(exp.high.length);
    expect(result.nodes.condition.outputCounts.false).toBe(exp.regular.length);
    expect(result.nodes.out_high.inputCount).toBe(exp.high.length);
    expect(result.nodes.out_regular.inputCount).toBe(exp.regular.length);
    expect(exp.high.length + exp.regular.length).toBe(exp.active.length);

    const highRows = result.portRecords['out_high:in'] as DataRecord[];
    expect(highRows.map((r) => r.orderId)).toEqual(exp.high.map((r) => r.orderId));
    expect(highRows.every((r) => (r.orderTotal as number) >= 250)).toBe(true);
    const regularRows = result.portRecords['out_regular:in'] as DataRecord[];
    expect(regularRows.every((r) => (r.orderTotal as number) < 250)).toBe(true);
  });

  it('changes results when a node setting changes', async () => {
    const doc = createDemoDoc();
    const condition = doc.nodes.find((n) => n.id === 'condition');
    if (!condition || condition.type !== 'condition') throw new Error('demo is missing its condition node');
    condition.config.condition.value = '500';

    const result = await runWorkflow(doc);
    const exp = expectedDemo(500);
    expect(result.nodes.condition.outputCounts.true).toBe(exp.high.length);
    expect(exp.high.length).not.toBe(expectedDemo(250).high.length);
  });

  it('is deterministic across runs', async () => {
    const first = await runWorkflow(createDemoDoc());
    const second = await runWorkflow(createDemoDoc());
    expect(first.portRecords['out_high:in']).toEqual(second.portRecords['out_high:in']);
    expect(first.order).toEqual(second.order);
  });

  it('computes analytics from the actual execution', async () => {
    const doc = createDemoDoc();
    const result = await runWorkflow(doc);
    const analytics = computeAnalytics(doc, result);
    const exp = expectedDemo(250);
    expect(analytics.totalInput).toBe(300);
    expect(analytics.filtered).toBe(300 - exp.active.length);
    expect(analytics.processed).toBe(exp.active.length);
    expect(analytics.branches).toEqual([
      { nodeId: 'condition', name: 'High Value?', trueCount: exp.high.length, falseCount: exp.regular.length },
    ]);
  });
});

describe('execution engine: branching and edge cases', () => {
  it('handles an empty dataset without errors', async () => {
    const doc = docWith(
      [start, { id: 'src', type: 'dataSource', name: 'Src', x: 0, y: 0, config: { source: 'generated', count: 0, seed: 1, json: '[]' } },
        { id: 'out', type: 'output', name: 'Out', x: 0, y: 0, config: { title: 'Out', maxRows: 10 } }],
      [link('e1', 'start', 'src'), link('e2', 'src', 'out')],
    );
    const result = await runWorkflow(doc);
    expect(result.status).toBe('completed');
    expect(result.nodes.out.inputCount).toBe(0);
    expect(result.nodes.out.status).toBe('completed');
  });

  it('routes records through the True and False branches', async () => {
    const records = [{ n: 1 }, { n: 5 }, { n: 10 }];
    const doc = docWith(
      [start,
        { id: 'src', type: 'dataSource', name: 'Src', x: 0, y: 0, config: { source: 'json', count: 0, seed: 1, json: JSON.stringify(records) } },
        { id: 'cond', type: 'condition', name: 'Cond', x: 0, y: 0, config: { condition: { id: 'c', field: 'n', operator: 'gte', value: '5' } } },
        { id: 'yes', type: 'output', name: 'Yes', x: 0, y: 0, config: { title: 'yes', maxRows: 10 } },
        { id: 'no', type: 'output', name: 'No', x: 0, y: 0, config: { title: 'no', maxRows: 10 } }],
      [link('e1', 'start', 'src'), link('e2', 'src', 'cond'), link('e3', 'cond', 'yes', 'true'), link('e4', 'cond', 'no', 'false')],
    );
    const result = await runWorkflow(doc);
    expect(result.portRecords['yes:in']).toEqual([{ n: 5 }, { n: 10 }]);
    expect(result.portRecords['no:in']).toEqual([{ n: 1 }]);
  });

  it('fails the node with a message for an invalid filter and skips downstream nodes', async () => {
    const doc = docWith(
      [start,
        { id: 'src', type: 'dataSource', name: 'Src', x: 0, y: 0, config: { source: 'generated', count: 20, seed: 3, json: '[]' } },
        { id: 'flt', type: 'filter', name: 'Bad Filter', x: 0, y: 0, config: { combinator: 'all', conditions: [{ id: 'c', field: 'quantity', operator: 'gt', value: 'lots' }] } },
        { id: 'out', type: 'output', name: 'Out', x: 0, y: 0, config: { title: 'Out', maxRows: 10 } }],
      [link('e1', 'start', 'src'), link('e2', 'src', 'flt'), link('e3', 'flt', 'out')],
    );
    const result = await runWorkflow(doc);
    expect(result.status).toBe('failed');
    expect(result.nodes.flt.status).toBe('failed');
    expect(result.issues.some((i) => /numeric value/.test(i.message))).toBe(true);
    expect(result.nodes.out.status).toBe('skipped');
  });

  it('propagates a runtime failure to every downstream node but keeps other branches running', async () => {
    const records = [{ n: 1 }];
    const doc = docWith(
      [start,
        { id: 'src', type: 'dataSource', name: 'Src', x: 0, y: 0, config: { source: 'json', count: 0, seed: 1, json: JSON.stringify(records) } },
        { id: 'bad', type: 'transform', name: 'Bad', x: 0, y: 0, config: { operations: [{ id: 'o', type: 'compute', target: 'x', expression: '1 +' }] } },
        { id: 'after', type: 'output', name: 'After', x: 0, y: 0, config: { title: 'after', maxRows: 10 } },
        { id: 'ok', type: 'output', name: 'Ok', x: 0, y: 0, config: { title: 'ok', maxRows: 10 } }],
      [link('e1', 'start', 'src'), link('e2', 'src', 'bad'), link('e3', 'bad', 'after'), link('e4', 'src', 'ok')],
    );
    const result = await runWorkflow(doc);
    expect(result.nodes.bad.status).toBe('failed');
    expect(result.nodes.after.status).toBe('skipped');
    expect(result.nodes.ok.status).toBe('completed');
    expect(result.status).toBe('failed');
  });

  it('counts missing fields in transforms as warnings instead of crashing', async () => {
    const doc = docWith(
      [start,
        { id: 'src', type: 'dataSource', name: 'Src', x: 0, y: 0, config: { source: 'json', count: 0, seed: 1, json: '[{"quantity":2,"unitPrice":3},{"quantity":1}]' } },
        { id: 'calc', type: 'transform', name: 'Calc', x: 0, y: 0, config: { operations: [{ id: 'o', type: 'compute', target: 'total', expression: 'quantity * unitPrice' }] } },
        { id: 'out', type: 'output', name: 'Out', x: 0, y: 0, config: { title: 'Out', maxRows: 10 } }],
      [link('e1', 'start', 'src'), link('e2', 'src', 'calc'), link('e3', 'calc', 'out')],
    );
    const result = await runWorkflow(doc);
    expect(result.status).toBe('completed');
    expect(result.nodes.calc.warnings).toBe(1);
    expect(result.portRecords['out:in']).toEqual([
      { quantity: 2, unitPrice: 3, total: 6 },
      { quantity: 1, total: null },
    ]);
  });

  it('skips nodes that are disconnected from Start', async () => {
    const doc = docWith(
      [start,
        { id: 'lonely', type: 'delay', name: 'Lonely', x: 0, y: 0, config: { ms: 0 } }],
      [],
    );
    const result = await runWorkflow(doc);
    expect(result.nodes.lonely.status).toBe('skipped');
    expect(result.nodes.lonely.message).toMatch(/Not connected/);
  });

  it('refuses to run a circular workflow and reports the cycle', async () => {
    const doc = docWith(
      [start,
        { id: 'a', type: 'delay', name: 'A', x: 0, y: 0, config: { ms: 0 } },
        { id: 'b', type: 'delay', name: 'B', x: 0, y: 0, config: { ms: 0 } }],
      [link('e1', 'start', 'a'), link('e2', 'a', 'b'), link('e3', 'b', 'a')],
    );
    const result = await runWorkflow(doc);
    expect(result.status).toBe('failed');
    expect(result.issues.some((i) => /Circular/.test(i.message))).toBe(true);
    expect(Object.values(result.nodes).every((n) => n.status !== 'completed')).toBe(true);
  });

  it('handles a large dataset', async () => {
    const doc = createDemoDoc();
    const source = doc.nodes.find((n) => n.id === 'source');
    if (!source || source.type !== 'dataSource') throw new Error('missing source');
    source.config.count = 20000;
    const result = await runWorkflow(doc, { });
    expect(result.status).toBe('completed');
    expect(result.nodes.source.outputCounts.out).toBe(20000);
  }, 20000);
});

describe('execution engine: cancellation', () => {
  it('cancels a running delay and skips the remaining nodes', async () => {
    const controller = new AbortController();
    const doc = docWith(
      [start,
        { id: 'src', type: 'dataSource', name: 'Src', x: 0, y: 0, config: { source: 'generated', count: 10, seed: 1, json: '[]' } },
        { id: 'slow', type: 'delay', name: 'Slow', x: 0, y: 0, config: { ms: 5000 } },
        { id: 'out', type: 'output', name: 'Out', x: 0, y: 0, config: { title: 'Out', maxRows: 10 } }],
      [link('e1', 'start', 'src'), link('e2', 'src', 'slow'), link('e3', 'slow', 'out')],
    );
    setTimeout(() => controller.abort(), 60);
    const t0 = performance.now();
    const result = await runWorkflow(doc, { signal: controller.signal });
    const elapsed = performance.now() - t0;

    expect(result.status).toBe('cancelled');
    expect(result.nodes.slow.status).toBe('skipped');
    expect(result.nodes.slow.message).toBe('Cancelled');
    expect(result.nodes.out.status).toBe('skipped');
    expect(elapsed).toBeLessThan(2000);
  });

  it('does nothing when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runWorkflow(createDemoDoc(), { signal: controller.signal });
    expect(result.status).toBe('cancelled');
    expect(result.nodes.source.status).toBe('skipped');
  });

  it('emits progress snapshots while running', async () => {
    const snapshots: string[] = [];
    await runWorkflow(createDemoDoc(), {
      onUpdate: (snap) => snapshots.push(snap.nodes.source?.status ?? 'none'),
    });
    expect(snapshots).toContain('running');
    expect(snapshots[snapshots.length - 1]).toBe('completed');
  });
});
