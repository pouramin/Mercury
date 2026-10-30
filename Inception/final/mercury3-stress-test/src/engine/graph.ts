import type { NodeType, Workflow, WorkflowEdge, WorkflowNode } from '../types';
import type { ExecutionIssue } from './types';

// ---------------------------------------------------------------------------
// Node geometry, ports
// ---------------------------------------------------------------------------

export interface PortDef {
  id: string;
  label: string;
  kind: 'input' | 'output';
}

export const NODE_PORTS: Record<NodeType, { inputs: PortDef[]; outputs: PortDef[] }> = {
  start: { inputs: [], outputs: [{ id: 'out', label: 'Start', kind: 'output' }] },
  dataSource: {
    inputs: [{ id: 'in', label: 'Trigger', kind: 'input' }],
    outputs: [{ id: 'out', label: 'Records', kind: 'output' }],
  },
  filter: {
    inputs: [{ id: 'in', label: 'Records', kind: 'input' }],
    outputs: [{ id: 'out', label: 'Pass', kind: 'output' }],
  },
  transform: {
    inputs: [{ id: 'in', label: 'Records', kind: 'input' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'output' }],
  },
  condition: {
    inputs: [{ id: 'in', label: 'Records', kind: 'input' }],
    outputs: [
      { id: 'true', label: 'True', kind: 'output' },
      { id: 'false', label: 'False', kind: 'output' },
    ],
  },
  delay: {
    inputs: [{ id: 'in', label: 'Records', kind: 'input' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'output' }],
  },
  output: {
    inputs: [{ id: 'in', label: 'Records', kind: 'input' }],
    outputs: [],
  },
};

export const NODE_SIZE: Record<NodeType, { w: number; h: number }> = {
  start: { w: 216, h: 104 },
  dataSource: { w: 236, h: 158 },
  filter: { w: 236, h: 172 },
  transform: { w: 244, h: 196 },
  condition: { w: 236, h: 178 },
  delay: { w: 216, h: 124 },
  output: { w: 236, h: 158 },
};

export const NODE_ICON: Record<NodeType, string> = {
  start: 'play',
  dataSource: 'database',
  filter: 'filter',
  transform: 'wand',
  condition: 'split',
  delay: 'clock',
  output: 'table',
};

export const NODE_COLOR: Record<NodeType, string> = {
  start: '#4d9fff',
  dataSource: '#7c5cff',
  filter: '#22c1a3',
  transform: '#f0a04b',
  condition: '#ff6b8a',
  delay: '#5b8def',
  output: '#3ecf8e',
};

export const NODE_LABEL: Record<NodeType, string> = {
  start: 'START',
  dataSource: 'DATA SOURCE',
  filter: 'FILTER',
  transform: 'TRANSFORM',
  condition: 'CONDITION',
  delay: 'DELAY',
  output: 'OUTPUT',
};

export const NODE_DEFAULT_CONFIG: Record<NodeType, Record<string, unknown>> = {
  start: { label: 'Start' },
  dataSource: {
    label: 'Order records',
    dataSourceMode: 'generate',
    sampleSchema: 'orders',
    recordCount: 300,
    seed: 20241001,
    pastedJson: '',
  },
  filter: {
    label: 'Filter',
    cond: { combinator: 'and', rows: [] },
  },
  transform: {
    label: 'Calculate',
    transformOps: [],
  },
  condition: {
    label: 'High value',
    cond: { combinator: 'and', rows: [] },
  },
  delay: { label: 'Delay', delayMs: 250 },
  output: { label: 'Results', outputLabel: 'Results', maxRows: 200, prettyJson: true },
};

export function defaultConfig(type: NodeType): Record<string, unknown> {
  const c: Record<string, unknown> = JSON.parse(JSON.stringify(NODE_DEFAULT_CONFIG[type]));
  return c;
}

export function inputPorts(type: NodeType): PortDef[] {
  return NODE_PORTS[type].inputs;
}
export function outputPorts(type: NodeType): PortDef[] {
  return NODE_PORTS[type].outputs;
}

export function getInputPorts(node: WorkflowNode): PortDef[] {
  return NODE_PORTS[node.type].inputs;
}
export function getOutputPorts(node: WorkflowNode): PortDef[] {
  return NODE_PORTS[node.type].outputs;
}

export function nodeSize(node: WorkflowNode): { w: number; h: number } {
  return NODE_SIZE[node.type];
}

/** Anchor point of a port in absolute canvas coordinates. */
export function portAnchor(
  node: WorkflowNode,
  portId: string,
  kind: 'input' | 'output',
): { x: number; y: number } {
  const { w, h } = nodeSize(node);
  const list = kind === 'input' ? getInputPorts(node) : getOutputPorts(node);
  const idx = Math.max(0, list.findIndex((p) => p.id === portId));
  const count = Math.max(1, list.length);
  const y = h * ((idx + 0.5) / count);
  return {
    x: node.position.x + (kind === 'input' ? 0 : w),
    y: node.position.y + y,
  };
}

// ---------------------------------------------------------------------------
// Connection policy
// ---------------------------------------------------------------------------

export interface ConnectionCheck {
  ok: boolean;
  reason?: string;
}

export function canConnect(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  sourceId: string,
  sourcePort: string,
  targetId: string,
  targetPort: string,
): ConnectionCheck {
  if (sourceId === targetId) return { ok: false, reason: 'A node cannot connect to itself.' };
  const src = nodes.find((n) => n.id === sourceId);
  const dst = nodes.find((n) => n.id === targetId);
  if (!src || !dst) return { ok: false, reason: 'Unknown node referenced by connection.' };
  const srcPort = getOutputPorts(src).find((p) => p.id === sourcePort);
  const dstPort = getInputPorts(dst).find((p) => p.id === targetPort);
  if (!srcPort) return { ok: false, reason: 'Source port does not exist on this node.' };
  if (!dstPort) return { ok: false, reason: 'Target port does not exist on this node.' };
  const dup = edges.some(
    (e) =>
      e.source === sourceId &&
      e.sourcePort === sourcePort &&
      e.target === targetId &&
      e.targetPort === targetPort,
  );
  if (dup) return { ok: false, reason: 'This connection already exists.' };
  return { ok: true };
}

export function edgeBetween(
  edges: WorkflowEdge[],
  a: string,
  b: string,
): WorkflowEdge | undefined {
  return edges.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));
}

// ---------------------------------------------------------------------------
// Graph validation
// ---------------------------------------------------------------------------

export function validateGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): ExecutionIssue[] {
  const issues: ExecutionIssue[] = [];
  const ids = new Set<string>();
  const seenEdges = new Set<string>();

  for (const n of nodes) {
    if (ids.has(n.id)) {
      issues.push({ level: 'error', code: 'dup-node', message: `Duplicate node id "${n.id}".`, nodeId: n.id });
    }
    ids.add(n.id);
    if (Number.isNaN(n.position.x) || Number.isNaN(n.position.y)) {
      issues.push({ level: 'error', code: 'bad-position', message: `Node "${n.id}" has an invalid position.`, nodeId: n.id });
    }
    for (const p of getInputPorts(n)) {
      void p;
    }
  }

  for (const e of edges) {
    const key = `${e.source}:${e.sourcePort}->${e.target}:${e.targetPort}`;
    if (seenEdges.has(key)) {
      issues.push({ level: 'error', code: 'dup-edge', message: `Duplicate connection ${key}.`, edgeId: e.id });
    }
    seenEdges.add(key);

    const src = nodes.find((n) => n.id === e.source);
    const dst = nodes.find((n) => n.id === e.target);
    if (!src) {
      issues.push({ level: 'error', code: 'missing-ref', message: `Connection references missing source node "${e.source}".`, edgeId: e.id });
      continue;
    }
    if (!dst) {
      issues.push({ level: 'error', code: 'missing-ref', message: `Connection references missing target node "${e.target}".`, edgeId: e.id });
      continue;
    }
    if (src.id === dst.id) {
      issues.push({ level: 'error', code: 'self-loop', message: 'A node cannot connect to itself.', edgeId: e.id });
    }
    if (!getOutputPorts(src).some((p) => p.id === e.sourcePort)) {
      issues.push({ level: 'error', code: 'bad-port', message: `Node "${src.id}" has no output port "${e.sourcePort}".`, edgeId: e.id, nodeId: src.id });
    }
    if (!getInputPorts(dst).some((p) => p.id === e.targetPort)) {
      issues.push({ level: 'error', code: 'bad-port', message: `Node "${dst.id}" has no input port "${e.targetPort}".`, edgeId: e.id, nodeId: dst.id });
    }
  }

  const topo = topoSort(nodes, edges);
  if (topo.hasCycle) {
    issues.push({
      level: 'error',
      code: 'cycle',
      message: `Workflow contains a circular dependency involving: ${topo.cycleNodes.join(', ')}.`,
    });
  }

  return issues;
}

export function hasFatalIssues(issues: ExecutionIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

// ---------------------------------------------------------------------------
// Topological sort (Kahn) + cycle detection
// ---------------------------------------------------------------------------

export interface TopoResult {
  order: string[];
  hasCycle: boolean;
  cycleNodes: string[];
}

export function topoSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): TopoResult {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const id of nodeIds) {
    adj.set(id, []);
    indeg.set(id, 0);
  }
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    // edge source -> target; target depends on source
    adj.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }

  const order: string[] = [];
  const queue: string[] = [];
  for (const [id, d] of indeg) {
    if (d === 0) queue.push(id);
  }
  // Deterministic: process in stable order
  queue.sort();
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    const nbrs = adj.get(id) ?? [];
    nbrs.sort();
    for (const nb of nbrs) {
      const d = (indeg.get(nb) ?? 1) - 1;
      indeg.set(nb, d);
      if (d === 0) queue.push(nb);
    }
    queue.sort();
  }

  const hasCycle = order.length < nodeIds.size;
  const cycleNodes = nodeIds.size === 0 ? [] : [...nodeIds].filter((id) => !order.includes(id));
  return { order, hasCycle, cycleNodes };
}

/** All nodes with no incoming edges -> source levels (order sources first). */
export function sourceNodes(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const hasIncoming = new Set<string>();
  for (const e of edges) hasIncoming.add(e.target);
  return nodes.filter((n) => !hasIncoming.has(n.id));
}

/** Collect upstream node ids (transitive) of a given node. */
export function upstreamNodes(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string[] {
  const byTarget = new Map<string, string[]>();
  for (const e of edges) {
    const list = byTarget.get(e.target) ?? [];
    list.push(e.source);
    byTarget.set(e.target, list);
  }
  const seen = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const s of byTarget.get(cur) ?? []) {
      if (!seen.has(s)) {
        seen.add(s);
        stack.push(s);
      }
    }
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// Workflow helpers
// ---------------------------------------------------------------------------

export function edgesInto(nodeId: string, edges: WorkflowEdge[]): WorkflowEdge[] {
  return edges.filter((e) => e.target === nodeId);
}

export function edgesOutOf(nodeId: string, edges: WorkflowEdge[]): WorkflowEdge[] {
  return edges.filter((e) => e.source === nodeId);
}

/** Deterministic edge ordering for merge semantics (by id). */
export function canonicalEdgeOrder(edges: WorkflowEdge[]): WorkflowEdge[] {
  return [...edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function ensureEdgeIds(edges: WorkflowEdge[]): WorkflowEdge[] {
  return edges.map((e) => (e.id ? e : { ...e, id: makeId() }));
}

export function makeId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function cloneWorkflow(wf: Workflow): Workflow {
  return JSON.parse(JSON.stringify(wf));
}
