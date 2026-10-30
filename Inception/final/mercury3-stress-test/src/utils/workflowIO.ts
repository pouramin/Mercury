import type { Workflow, WorkflowNode } from '../types';
import { NODE_PORTS, validateGraph, makeId } from '../engine/graph';

// ---------------------------------------------------------------------------
// Workflow JSON serialization + validated import
// ---------------------------------------------------------------------------

export function serializeWorkflow(workflow: Workflow): string {
  return JSON.stringify(workflow, null, 2);
}

const NODE_TYPES = new Set(Object.keys(NODE_PORTS) as (keyof typeof NODE_PORTS)[]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sanitizeNode(raw: Record<string, unknown>): { node?: WorkflowNode; error?: string } {
  const id = typeof raw.id === 'string' && raw.id ? raw.id : makeId();
  const type = raw.type as string;
  if (!NODE_TYPES.has(type as never)) {
    return { error: `Node "${id}" has unknown type "${String(raw.type)}".` };
  }
  const pos = raw.position as { x?: unknown; y?: unknown } | undefined;
  let x = 0;
  let y = 0;
  if (isPlainObject(pos)) {
    x = typeof pos.x === 'number' ? pos.x : 0;
    y = typeof pos.y === 'number' ? pos.y : 0;
  }
  const config = isPlainObject(raw.config) ? raw.config : {};
  return { node: { id, type: type as WorkflowNode['type'], position: { x, y }, config } };
}

function parseEdge(raw: Record<string, unknown>): { edge?: { id: string; source: string; sourcePort: string; target: string; targetPort: string }; error?: string } {
  const source = raw.source as string;
  const target = raw.target as string;
  const sourcePort = raw.sourcePort as string;
  const targetPort = raw.targetPort as string;
  if (typeof source !== 'string' || typeof target !== 'string') {
    return { error: 'A connection is missing its source/target node id.' };
  }
  if (typeof sourcePort !== 'string' || typeof targetPort !== 'string') {
    return { error: 'A connection is missing port identifiers.' };
  }
  return {
    edge: {
      id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(),
      source,
      sourcePort,
      target,
      targetPort,
    },
  };
}

/**
 * Parse and validate imported workflow JSON. Rejects malformed payloads with a
 * human-readable reason. Structural problems in edges are surfaced as errors.
 */
export function parseWorkflowJson(text: string): { ok: true; workflow: Workflow } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `File is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'Workflow file must contain a JSON object.' };
  }
  if (!Array.isArray(parsed.nodes)) {
    return { ok: false, error: 'Workflow is missing a "nodes" array.' };
  }
  if (!Array.isArray(parsed.edges)) {
    return { ok: false, error: 'Workflow is missing an "edges" array.' };
  }
  const nodes: WorkflowNode[] = [];
  const nodeErrors: string[] = [];
  for (const r of parsed.nodes) {
    if (!isPlainObject(r)) {
      nodeErrors.push('A node entry is not an object.');
      continue;
    }
    const out = sanitizeNode(r);
    if (out.node) nodes.push(out.node);
    if (out.error) nodeErrors.push(out.error);
  }
  const edges: { id: string; source: string; sourcePort: string; target: string; targetPort: string }[] = [];
  for (const r of parsed.edges) {
    if (!isPlainObject(r)) {
      nodeErrors.push('A connection entry is not an object.');
      continue;
    }
    const out = parseEdge(r);
    if (out.edge) edges.push(out.edge);
    if (out.error) nodeErrors.push(out.error);
  }
  if (nodeErrors.length > 0) {
    return { ok: false, error: nodeErrors.slice(0, 4).join(' ') };
  }
  const issues = validateGraph(nodes, edges);
  const fatal = issues.filter((i) => i.level === 'error');
  if (fatal.length > 0) {
    return { ok: false, error: `Imported workflow is invalid: ${fatal.slice(0, 4).map((f) => f.message).join(' ')}` };
  }
  const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'Imported workflow';
  const now = Date.now();
  return {
    ok: true,
    workflow: {
      id: typeof parsed.id === 'string' && parsed.id ? parsed.id : makeId(),
      name,
      nodes,
      edges,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : now,
      updatedAt: now,
    },
  };
}
