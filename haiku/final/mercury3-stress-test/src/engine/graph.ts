// Graph utilities: adjacency, topological ordering, cycle detection, connection rules
// and whole-workflow validation.

import type { PortId, ValidationIssue, WorkflowDoc, WorkflowEdge, WorkflowNode } from '../types';
import { NODE_DEFS } from './nodeDefs';
import { validateNodeConfig } from './configValidation';

export interface Adjacency {
  incoming: Map<string, WorkflowEdge[]>;
  outgoing: Map<string, WorkflowEdge[]>;
}

export function buildAdjacency(doc: WorkflowDoc): Adjacency {
  const incoming = new Map<string, WorkflowEdge[]>();
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const node of doc.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of doc.edges) {
    incoming.get(edge.target)?.push(edge);
    outgoing.get(edge.source)?.push(edge);
  }
  return { incoming, outgoing };
}

/**
 * Kahn's algorithm. Ties are broken by node id so the order is deterministic.
 * Returns null when the graph contains a cycle.
 */
export function topologicalOrder(doc: WorkflowDoc): string[] | null {
  const { outgoing } = buildAdjacency(doc);
  const indegree = new Map<string, number>();
  for (const node of doc.nodes) indegree.set(node.id, 0);
  for (const edge of doc.edges) {
    if (indegree.has(edge.target)) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const ready = doc.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift() as string;
    order.push(id);
    const next: string[] = [];
    for (const edge of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(edge.target) ?? 0) - 1;
      indegree.set(edge.target, remaining);
      if (remaining === 0) next.push(edge.target);
    }
    for (const id2 of next.sort()) {
      // Insert keeping the ready queue sorted, so ordering stays deterministic.
      let i = 0;
      while (i < ready.length && ready[i] < id2) i++;
      ready.splice(i, 0, id2);
    }
  }
  return order.length === doc.nodes.length ? order : null;
}

/** Returns one cycle as a list of node ids (first id repeated at the end), or null. */
export function findCycle(doc: WorkflowDoc): string[] | null {
  const { outgoing } = buildAdjacency(doc);
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    state.set(id, 'visiting');
    stack.push(id);
    for (const edge of outgoing.get(id) ?? []) {
      const current = state.get(edge.target);
      if (current === 'visiting') {
        const start = stack.indexOf(edge.target);
        return [...stack.slice(start), edge.target];
      }
      if (!current) {
        const found = visit(edge.target);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };

  for (const node of [...doc.nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!state.has(node.id)) {
      const found = visit(node.id);
      if (found) return found;
    }
  }
  return null;
}

/** Nodes reachable by following edges forward from any Start node. */
export function reachableFromStart(doc: WorkflowDoc): Set<string> {
  const { outgoing } = buildAdjacency(doc);
  const reached = new Set<string>();
  const queue = doc.nodes.filter((n) => n.type === 'start').map((n) => n.id);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const edge of outgoing.get(id) ?? []) queue.push(edge.target);
  }
  return reached;
}

export function findNode(doc: WorkflowDoc, id: string): WorkflowNode | undefined {
  return doc.nodes.find((n) => n.id === id);
}

/**
 * Checks whether an edge may be added. Returns the reason it is rejected, or null when valid.
 */
export function canConnect(
  doc: WorkflowDoc,
  sourceId: string,
  sourcePort: PortId,
  targetId: string,
  targetPort: PortId,
): string | null {
  const source = findNode(doc, sourceId);
  const target = findNode(doc, targetId);
  if (!source || !target) return 'One of the nodes no longer exists.';
  if (source.id === target.id) return 'A node cannot connect to itself.';
  if (!NODE_DEFS[source.type].outputs.includes(sourcePort)) {
    return `${NODE_DEFS[source.type].label} has no "${sourcePort}" output.`;
  }
  if (targetPort !== 'in' || !NODE_DEFS[target.type].hasInput) {
    return `${NODE_DEFS[target.type].label} cannot receive input.`;
  }
  if (doc.edges.some((e) => e.source === sourceId && e.sourcePort === sourcePort && e.target === targetId)) {
    return 'These nodes are already connected.';
  }
  // Adding source -> target creates a cycle if target can already reach source.
  const { outgoing } = buildAdjacency(doc);
  const seen = new Set<string>();
  const queue = [targetId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (id === sourceId) return 'This connection would create a circular dependency.';
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of outgoing.get(id) ?? []) queue.push(edge.target);
  }
  return null;
}

/** Validates a whole workflow. Structural errors block execution. */
export function validateWorkflow(doc: WorkflowDoc): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set(doc.nodes.map((n) => n.id));

  if (doc.nodes.length === 0) {
    issues.push({ level: 'error', kind: 'structure', message: 'The workflow is empty. Drag a Start node onto the canvas.' });
    return issues;
  }

  const starts = doc.nodes.filter((n) => n.type === 'start');
  if (starts.length === 0) {
    issues.push({ level: 'error', kind: 'structure', message: 'No Start node. Execution needs exactly one Start node.' });
  }
  for (const extra of starts.slice(1)) {
    issues.push({ level: 'error', kind: 'structure', nodeId: extra.id, message: `Only one Start node is allowed ("${extra.name}" is extra).` });
  }

  for (const edge of doc.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({ level: 'error', kind: 'structure', edgeId: edge.id, message: 'A connection points to a missing node.' });
    }
  }

  const cycle = findCycle(doc);
  if (cycle) {
    const names = cycle.map((id) => findNode(doc, id)?.name ?? id);
    issues.push({
      level: 'error',
      kind: 'structure',
      nodeId: cycle[0],
      message: `Circular connection detected: ${names.join(' → ')}.`,
    });
  }

  const reachable = reachableFromStart(doc);
  const { incoming, outgoing } = buildAdjacency(doc);

  for (const node of doc.nodes) {
    for (const problem of validateNodeConfig(node.type, node.config)) {
      issues.push({ level: 'error', kind: 'config', nodeId: node.id, message: `${node.name}: ${problem}` });
    }

    if (node.type !== 'start' && !reachable.has(node.id)) {
      issues.push({ level: 'warning', kind: 'graph', nodeId: node.id, message: `${node.name} is not connected to Start and will be skipped.` });
    }
    if (NODE_DEFS[node.type].hasInput && node.type !== 'start' && (incoming.get(node.id) ?? []).length === 0) {
      issues.push({ level: 'warning', kind: 'graph', nodeId: node.id, message: `${node.name} has no input connection.` });
    }
    if (node.type === 'condition') {
      for (const port of ['true', 'false'] as const) {
        if (!(outgoing.get(node.id) ?? []).some((e) => e.sourcePort === port)) {
          issues.push({
            level: 'warning',
            kind: 'graph',
            nodeId: node.id,
            message: `${node.name}: the ${port === 'true' ? 'True' : 'False'} branch is not connected; those records are dropped.`,
          });
        }
      }
    }
    if (node.type === 'filter' && node.config && Array.isArray(node.config.conditions) && node.config.conditions.length === 0) {
      issues.push({ level: 'warning', kind: 'graph', nodeId: node.id, message: `${node.name} has no conditions, so every record passes.` });
    }
    if (node.type === 'output' && (incoming.get(node.id) ?? []).length === 0) {
      issues.push({ level: 'warning', kind: 'graph', nodeId: node.id, message: `${node.name} collects nothing until it is connected.` });
    }
  }

  if (starts.length === 1 && !doc.nodes.some((n) => n.type !== 'start')) {
    issues.push({ level: 'warning', kind: 'graph', message: 'Start has nothing connected to it yet.' });
  }

  return issues;
}
