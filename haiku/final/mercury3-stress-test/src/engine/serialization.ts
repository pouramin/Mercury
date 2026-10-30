// Workflow JSON import/export with strict validation. Imported data is never trusted:
// every field is checked before a document is built from it.

import type { NodeType, PortId, WorkflowDoc, WorkflowEdge, WorkflowNode } from '../types';
import { NODE_DEFS, NODE_TYPES, outputPorts } from './nodeDefs';
import { validateNodeConfig } from './configValidation';

export const MAX_IMPORT_BYTES = 2_000_000;
export const MAX_IMPORT_NODES = 300;
export const MAX_IMPORT_EDGES = 1000;

export type ParseResult = { ok: true; doc: WorkflowDoc } | { ok: false; errors: string[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function serializeWorkflow(doc: WorkflowDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function parseWorkflowText(text: string): ParseResult {
  if (text.length > MAX_IMPORT_BYTES) {
    return { ok: false, errors: [`The file is larger than ${MAX_IMPORT_BYTES / 1_000_000} MB.`] };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`The file is not valid JSON: ${(err as Error).message}`] };
  }
  return parseWorkflowValue(data);
}

export function parseWorkflowValue(data: unknown): ParseResult {
  const errors: string[] = [];
  if (!isObject(data)) {
    return { ok: false, errors: ['The workflow file must contain a JSON object.'] };
  }
  if (data.format !== 'flowforge-workflow') errors.push('"format" must be "flowforge-workflow".');
  if (data.version !== 1) errors.push('Unsupported "version" (expected 1).');
  const name = typeof data.name === 'string' ? data.name.trim().slice(0, 80) : '';
  if (name === '') errors.push('"name" must be a non-empty text value.');
  if (!Array.isArray(data.nodes)) errors.push('"nodes" must be an array.');
  if (!Array.isArray(data.edges)) errors.push('"edges" must be an array.');
  if (errors.length > 0) return { ok: false, errors };

  const rawNodes = data.nodes as unknown[];
  const rawEdges = data.edges as unknown[];
  if (rawNodes.length > MAX_IMPORT_NODES) errors.push(`A workflow may contain at most ${MAX_IMPORT_NODES} nodes.`);
  if (rawEdges.length > MAX_IMPORT_EDGES) errors.push(`A workflow may contain at most ${MAX_IMPORT_EDGES} connections.`);
  if (errors.length > 0) return { ok: false, errors };

  const nodeTypes = new Map<string, NodeType>();
  const nodes: WorkflowNode[] = [];

  rawNodes.forEach((raw, index) => {
    const label = `Node #${index + 1}`;
    if (!isObject(raw)) {
      errors.push(`${label} is not an object.`);
      return;
    }
    const id = raw.id;
    if (typeof id !== 'string' || id.trim() === '' || id.length > 100) {
      errors.push(`${label} needs a text "id" of 1-100 characters.`);
      return;
    }
    if (nodeTypes.has(id)) {
      errors.push(`Duplicate node id "${id}".`);
      return;
    }
    if (typeof raw.type !== 'string' || !NODE_TYPES.includes(raw.type as NodeType)) {
      errors.push(`Node "${id}" has unknown type "${String(raw.type)}".`);
      return;
    }
    const type = raw.type as NodeType;
    if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) {
      errors.push(`Node "${id}" needs numeric "x" and "y" positions.`);
      return;
    }
    if (raw.config !== undefined && !isObject(raw.config)) {
      errors.push(`Node "${id}" has a malformed "config" object.`);
      return;
    }
    const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim().slice(0, 60) : NODE_DEFS[type].label;
    const config: Record<string, unknown> = { ...NODE_DEFS[type].defaultConfig(), ...(isObject(raw.config) ? raw.config : {}) };
    const problems = validateNodeConfig(type, config);
    if (problems.length > 0) {
      for (const problem of problems) errors.push(`Node "${id}": ${problem}`);
      return;
    }
    nodeTypes.set(id, type);
    nodes.push({ id, type, name, x: raw.x, y: raw.y, config } as WorkflowNode);
  });

  const edgeIds = new Set<string>();
  const keys = new Set<string>();
  const edges: WorkflowEdge[] = [];

  rawEdges.forEach((raw, index) => {
    const label = `Connection #${index + 1}`;
    if (!isObject(raw)) {
      errors.push(`${label} is not an object.`);
      return;
    }
    if (typeof raw.id !== 'string' || raw.id === '' || edgeIds.has(raw.id)) {
      errors.push(`${label} needs a unique text "id".`);
      return;
    }
    edgeIds.add(raw.id);
    const { source, target, sourcePort, targetPort } = raw;
    if (typeof source !== 'string' || typeof target !== 'string') {
      errors.push(`${label} needs "source" and "target" node ids.`);
      return;
    }
    const sourceType = nodeTypes.get(source);
    const targetType = nodeTypes.get(target);
    if (!sourceType || !targetType) {
      errors.push(`${label} references a node that does not exist.`);
      return;
    }
    if (source === target) {
      errors.push(`${label} connects "${source}" to itself.`);
      return;
    }
    if (typeof sourcePort !== 'string' || !outputPorts(sourceType).includes(sourcePort as PortId)) {
      errors.push(`${label}: ${NODE_DEFS[sourceType].label} has no output port "${String(sourcePort)}".`);
      return;
    }
    if (targetPort !== 'in' || !NODE_DEFS[targetType].hasInput) {
      errors.push(`${label}: ${NODE_DEFS[targetType].label} cannot receive input on "${String(targetPort)}".`);
      return;
    }
    const key = `${source}|${sourcePort}|${target}`;
    if (keys.has(key)) {
      errors.push(`${label} duplicates an existing connection.`);
      return;
    }
    keys.add(key);
    edges.push({ id: raw.id, source, sourcePort: sourcePort as PortId, target, targetPort: 'in' });
  });

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    doc: { format: 'flowforge-workflow', version: 1, name, nodes, edges },
  };
}
