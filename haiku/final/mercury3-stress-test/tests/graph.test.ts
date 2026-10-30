import { describe, expect, it } from 'vitest';
import { canConnect, findCycle, reachableFromStart, topologicalOrder, validateWorkflow } from '../src/engine/graph';
import { createDemoDoc } from '../src/engine/demo';
import type { WorkflowDoc, WorkflowEdge, WorkflowNode } from '../src/types';

function node(id: string, type: WorkflowNode['type'], x = 0, y = 0): WorkflowNode {
  const configs: Record<string, unknown> = {
    start: {},
    dataSource: { source: 'json', count: 0, seed: 1, json: '[]' },
    filter: { combinator: 'all', conditions: [{ id: 'c', field: 'a', operator: 'exists', value: '' }] },
    transform: { operations: [] },
    condition: { condition: { id: 'c', field: 'a', operator: 'exists', value: '' } },
    delay: { ms: 0 },
    output: { title: id, maxRows: 10 },
  };
  return { id, type, name: id, x, y, config: configs[type] } as WorkflowNode;
}

function edge(id: string, source: string, target: string, sourcePort: WorkflowEdge['sourcePort'] = 'out'): WorkflowEdge {
  return { id, source, sourcePort, target, targetPort: 'in' };
}

function doc(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDoc {
  return { format: 'flowforge-workflow', version: 1, name: 'test', nodes, edges };
}

describe('topological ordering', () => {
  it('orders a diamond-shaped DAG deterministically', () => {
    const d = doc(
      [node('start', 'start'), node('a', 'transform'), node('b', 'transform'), node('c', 'output')],
      [edge('e1', 'start', 'a'), edge('e2', 'start', 'b'), edge('e3', 'a', 'c'), edge('e4', 'b', 'c')],
    );
    expect(topologicalOrder(d)).toEqual(['start', 'a', 'b', 'c']);
  });

  it('respects edge direction regardless of node array order', () => {
    const d = doc(
      [node('out', 'output'), node('mid', 'delay'), node('start', 'start')],
      [edge('e1', 'mid', 'out'), edge('e2', 'start', 'mid')],
    );
    expect(topologicalOrder(d)).toEqual(['start', 'mid', 'out']);
  });

  it('returns null when a cycle exists', () => {
    const d = doc(
      [node('start', 'start'), node('a', 'delay'), node('b', 'delay')],
      [edge('e1', 'start', 'a'), edge('e2', 'a', 'b'), edge('e3', 'b', 'a')],
    );
    expect(topologicalOrder(d)).toBeNull();
  });
});

describe('cycle detection', () => {
  it('finds the offending cycle path', () => {
    const d = doc(
      [node('start', 'start'), node('a', 'delay'), node('b', 'delay'), node('c', 'delay')],
      [edge('e1', 'start', 'a'), edge('e2', 'a', 'b'), edge('e3', 'b', 'c'), edge('e4', 'c', 'a')],
    );
    const cycle = findCycle(d);
    expect(cycle).not.toBeNull();
    expect(cycle?.[0]).toBe(cycle?.[cycle.length - 1]);
    expect(new Set(cycle)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('returns null for an acyclic graph', () => {
    expect(findCycle(createDemoDoc())).toBeNull();
  });

  it('reports a circular dependency as a structural error', () => {
    const d = doc(
      [node('start', 'start'), node('a', 'delay'), node('b', 'delay')],
      [edge('e1', 'start', 'a'), edge('e2', 'a', 'b'), edge('e3', 'b', 'a')],
    );
    const issues = validateWorkflow(d);
    expect(issues.some((i) => i.kind === 'structure' && i.message.includes('Circular connection'))).toBe(true);
  });
});

describe('connection rules', () => {
  const d = doc(
    [node('start', 'start'), node('a', 'delay'), node('b', 'delay'), node('cond', 'condition'), node('out', 'output')],
    [edge('e1', 'start', 'a'), edge('e2', 'a', 'b')],
  );

  it('accepts a valid connection', () => {
    expect(canConnect(d, 'b', 'out', 'out', 'in')).toBeNull();
  });

  it('rejects a node connecting to itself', () => {
    expect(canConnect(d, 'a', 'out', 'a', 'in')).toMatch(/itself/);
  });

  it('rejects connecting into a Start node', () => {
    expect(canConnect(d, 'a', 'out', 'start', 'in')).toMatch(/cannot receive input/);
  });

  it('rejects outputs from an Output node', () => {
    expect(canConnect(d, 'out', 'out', 'a', 'in')).toMatch(/no "out" output/);
  });

  it('rejects a port that the source node does not have', () => {
    expect(canConnect(d, 'a', 'true', 'b', 'in')).toMatch(/no "true" output/);
  });

  it('rejects duplicate connections', () => {
    expect(canConnect(d, 'a', 'out', 'b', 'in')).toMatch(/already connected/);
  });

  it('rejects connections that would create a cycle', () => {
    expect(canConnect(d, 'b', 'out', 'a', 'in')).toMatch(/circular/);
  });

  it('allows a condition to route its True port to a node', () => {
    expect(canConnect(d, 'cond', 'true', 'out', 'in')).toBeNull();
  });
});

describe('reachability and validation', () => {
  it('flags disconnected nodes as warnings and marks them unreachable', () => {
    const d = doc(
      [node('start', 'start'), node('a', 'delay'), node('orphan', 'delay')],
      [edge('e1', 'start', 'a')],
    );
    expect(reachableFromStart(d).has('orphan')).toBe(false);
    const issues = validateWorkflow(d);
    expect(issues.some((i) => i.level === 'warning' && i.nodeId === 'orphan')).toBe(true);
    expect(issues.some((i) => i.level === 'error')).toBe(false);
  });

  it('requires exactly one Start node', () => {
    const none = validateWorkflow(doc([node('a', 'delay')], []));
    expect(none.some((i) => i.kind === 'structure' && /Start/.test(i.message))).toBe(true);

    const two = validateWorkflow(doc([node('s1', 'start'), node('s2', 'start')], []));
    expect(two.some((i) => i.kind === 'structure' && /Only one Start/.test(i.message))).toBe(true);
  });

  it('reports an empty workflow', () => {
    const issues = validateWorkflow(doc([], []));
    expect(issues[0].level).toBe('error');
    expect(issues[0].message).toMatch(/empty/);
  });

  it('accepts the built-in demo workflow with no errors', () => {
    const issues = validateWorkflow(createDemoDoc());
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});
