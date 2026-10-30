import { describe, expect, it } from 'vitest';
import type { WorkflowEdge, WorkflowNode } from '../src/types';
import { canConnect, NODE_PORTS, topoSort, validateGraph, makeId } from '../src/engine/graph';
import { createDemoWorkflow } from '../src/engine/demoWorkflow';

function node(type: WorkflowNode['type'], id: string, x = 0, y = 0): WorkflowNode {
  const cfg: Record<string, unknown> = {};
  if (type === 'filter' || type === 'condition') cfg.cond = { combinator: 'and', rows: [] };
  if (type === 'transform') cfg.transformOps = [];
  if (type === 'dataSource') {
    cfg.dataSourceMode = 'paste';
    cfg.pastedJson = '[]';
  }
  return { id, type, position: { x, y }, config: cfg };
}

function edge(source: string, sourcePort: string, target: string, targetPort: string): WorkflowEdge {
  return { id: makeId(), source, sourcePort, target, targetPort };
}

describe('topological ordering', () => {
  it('orders nodes so dependencies come first (deterministic)', () => {
    const nodes = [node('dataSource', 'S'), node('filter', 'F'), node('output', 'O'), node('transform', 'T')];
    const edges = [edge('S', 'out', 'F', 'in'), edge('F', 'out', 'T', 'in'), edge('T', 'out', 'O', 'in')];
    const { order, hasCycle } = topoSort(nodes, edges);
    expect(hasCycle).toBe(false);
    expect(order).toHaveLength(4);
    const idx = new Map(order.map((id, i) => [id, i]));
    expect(idx.get('S')!).toBeLessThan(idx.get('F')!);
    expect(idx.get('F')!).toBeLessThan(idx.get('T')!);
    expect(idx.get('T')!).toBeLessThan(idx.get('O')!);
  });

  it('handles independent branches', () => {
    const nodes = [node('dataSource', 'A'), node('dataSource', 'B'), node('output', 'O1'), node('output', 'O2')];
    const edges = [edge('A', 'out', 'O1', 'in'), edge('B', 'out', 'O2', 'in')];
    const { order, hasCycle } = topoSort(nodes, edges);
    expect(hasCycle).toBe(false);
    expect(order).toHaveLength(4);
  });

  it('detects cycles and reports the involved nodes', () => {
    const nodes = [node('dataSource', 'A'), node('filter', 'B'), node('output', 'C')];
    const edges = [
      edge('A', 'out', 'B', 'in'),
      edge('B', 'out', 'C', 'in'),
      edge('C', 'out', 'A', 'in'), // invalid: output has no out port, but topo-level cycle still
    ];
    const { hasCycle, cycleNodes } = topoSort(nodes, edges);
    expect(hasCycle).toBe(true);
    expect(cycleNodes.length).toBeGreaterThan(0);
  });
});

describe('connection policy', () => {
  const nodes = [node('dataSource', 'S'), node('filter', 'F'), node('output', 'O')];
  const edges: WorkflowEdge[] = [];

  it('allows a valid output -> input connection', () => {
    const res = canConnect(nodes, edges, 'S', 'out', 'F', 'in');
    expect(res.ok).toBe(true);
  });

  it('rejects self-connections', () => {
    const res = canConnect(nodes, edges, 'S', 'out', 'S', 'in');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/itself/i);
  });

  it('rejects output -> output', () => {
    const res = canConnect(nodes, edges, 'S', 'out', 'F', 'out');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/does not exist/i);
  });

  it('rejects input -> input', () => {
    const res = canConnect(nodes, edges, 'F', 'in', 'O', 'in');
    expect(res.ok).toBe(false);
  });

  it('rejects duplicate edges', () => {
    const e = edge('S', 'out', 'F', 'in');
    const withEdge = [...edges, e];
    const res = canConnect(nodes, withEdge, 'S', 'out', 'F', 'in');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/already exists/i);
  });

  it('rejects connections to unknown nodes', () => {
    const res = canConnect(nodes, edges, 'S', 'out', 'ghost', 'in');
    expect(res.ok).toBe(false);
  });
});

describe('graph validation', () => {
  it('flags missing node references', () => {
    const nodes = [node('output', 'O')];
    const edges = [edge('ghost', 'out', 'O', 'in')];
    const issues = validateGraph(nodes, edges);
    expect(issues.some((i) => i.level === 'error' && i.code === 'missing-ref')).toBe(true);
  });

  it('flags self-loops', () => {
    const nodes = [node('filter', 'F')];
    const edges = [edge('F', 'out', 'F', 'in')];
    const issues = validateGraph(nodes, edges);
    expect(issues.some((i) => i.code === 'self-loop')).toBe(true);
  });

  it('validates the built-in demo workflow cleanly', () => {
    const demo = createDemoWorkflow();
    const issues = validateGraph(demo.nodes, demo.edges);
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('knows all default ports for every node type', () => {
    for (const type of Object.keys(NODE_PORTS) as (keyof typeof NODE_PORTS)[]) {
      expect(NODE_PORTS[type].inputs).toBeDefined();
      expect(NODE_PORTS[type].outputs).toBeDefined();
    }
  });
});
