// Asynchronous, cancellable, deterministic workflow executor.
//
// Nodes run in topological order (ties broken by id). Each completed node publishes its
// records per output port. A node runs when at least one upstream edge delivered output
// from a completed node; otherwise it is skipped. Failures therefore propagate: every
// node downstream of a failed node is skipped with an explanation.

import type { DataRecord, ExecutionResult, NodeRunState, WorkflowDoc, WorkflowNode } from '../types';
import { MAX_DELAY_MS, parseJsonRecords, validateNodeConfig } from './configValidation';
import { compileCondition, compileConditionGroup } from './conditions';
import { buildAdjacency, reachableFromStart, topologicalOrder, validateWorkflow } from './graph';
import { getField } from './fields';
import { generateOrders } from './sampleOrders';
import { compileTransform } from './transform';

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

/** Resolves after `ms`, or rejects with CancelledError as soon as the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface NodeOutput {
  ports: Record<string, DataRecord[]>;
  warnings: number;
  message: string;
}

async function executeNode(node: WorkflowNode, input: DataRecord[], signal?: AbortSignal): Promise<NodeOutput> {
  const problems = validateNodeConfig(node.type, node.config);
  if (problems.length > 0) {
    throw new Error(problems[0]);
  }

  switch (node.type) {
    case 'start':
      return { ports: { out: [] }, warnings: 0, message: 'Workflow started' };

    case 'dataSource': {
      const cfg = node.config;
      if (cfg.source === 'generated') {
        const records = generateOrders(cfg.count, cfg.seed);
        return { ports: { out: records }, warnings: 0, message: `Generated ${records.length} orders` };
      }
      const { records, skipped } = parseJsonRecords(cfg.json);
      return {
        ports: { out: records },
        warnings: skipped,
        message: `Loaded ${records.length} records${skipped ? `, skipped ${skipped} non-object entries` : ''}`,
      };
    }

    case 'filter': {
      const { combinator, conditions } = node.config;
      const predicate = compileConditionGroup(combinator, conditions);
      const fields = conditions.map((c) => c.field);
      const out: DataRecord[] = [];
      let warnings = 0;
      for (const record of input) {
        if (fields.some((field) => getField(record, field) === undefined)) warnings++;
        if (predicate(record)) out.push(record);
      }
      return { ports: { out }, warnings, message: `${out.length} of ${input.length} matched` };
    }

    case 'transform': {
      const apply = compileTransform(node.config.operations);
      let warnings = 0;
      const out = input.map((record) => {
        const result = apply(record);
        warnings += result.warnings;
        return result.record;
      });
      return {
        ports: { out },
        warnings,
        message: `${out.length} records transformed${warnings ? `, ${warnings} missing or invalid values` : ''}`,
      };
    }

    case 'condition': {
      const predicate = compileCondition(node.config.condition);
      const truthy: DataRecord[] = [];
      const falsy: DataRecord[] = [];
      for (const record of input) {
        if (predicate(record)) truthy.push(record);
        else falsy.push(record);
      }
      return {
        ports: { true: truthy, false: falsy },
        warnings: 0,
        message: `${truthy.length} true · ${falsy.length} false`,
      };
    }

    case 'delay': {
      const ms = node.config.ms;
      if (!Number.isFinite(ms) || ms < 0 || ms > MAX_DELAY_MS) {
        throw new Error(`Delay must be between 0 and ${MAX_DELAY_MS} ms.`);
      }
      await sleep(ms, signal);
      return { ports: { out: input }, warnings: 0, message: `Waited ${ms} ms` };
    }

    case 'output':
      return { ports: { in: input }, warnings: 0, message: `${input.length} records collected` };
  }
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Pause after each node so the UI can animate the flow. Zero for tests. */
  stepDelayMs?: number;
  onUpdate?: (snapshot: ExecutionResult) => void;
}

function createRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Executes a workflow document. Never throws for workflow problems; they are reported in the result. */
export async function runWorkflow(doc: WorkflowDoc, options: RunOptions = {}): Promise<ExecutionResult> {
  const startedAt = Date.now();
  const t0 = performance.now();
  const issues = validateWorkflow(doc);
  const order = topologicalOrder(doc) ?? doc.nodes.map((n) => n.id);

  const nodes: Record<string, NodeRunState> = {};
  for (const node of doc.nodes) {
    nodes[node.id] = { status: 'pending', inputCount: 0, outputCounts: {}, warnings: 0, message: '' };
  }

  const result: ExecutionResult = {
    runId: createRunId(),
    status: 'running',
    startedAt,
    durationMs: 0,
    order,
    nodes,
    portRecords: {},
    issues: [],
  };
  const emit = () => options.onUpdate?.({ ...result, nodes: { ...result.nodes } });

  const structural = issues.filter((i) => i.level === 'error' && i.kind === 'structure');
  if (structural.length > 0) {
    for (const node of doc.nodes) {
      nodes[node.id].status = 'skipped';
      nodes[node.id].message = 'Not run: the workflow has structural errors';
    }
    result.status = 'failed';
    result.issues = structural.map((i) => ({ nodeId: i.nodeId, message: i.message }));
    result.finishedAt = Date.now();
    result.durationMs = performance.now() - t0;
    emit();
    return result;
  }

  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const { incoming } = buildAdjacency(doc);
  const reachable = reachableFromStart(doc);
  let cancelled = false;

  emit();
  for (const id of order) {
    const node = byId.get(id);
    if (!node) continue;
    const state = nodes[id];

    if (options.signal?.aborted) {
      cancelled = true;
      break;
    }

    if (node.type !== 'start' && !reachable.has(id)) {
      state.status = 'skipped';
      state.message = 'Not connected to Start';
      emit();
      continue;
    }

    const active = (incoming.get(id) ?? []).filter((edge) => nodes[edge.source]?.status === 'completed');
    if (node.type !== 'start' && active.length === 0) {
      state.status = 'skipped';
      state.message = 'No upstream output (a predecessor was skipped or failed)';
      emit();
      continue;
    }

    const input: DataRecord[] = [];
    for (const edge of active) {
      for (const record of result.portRecords[`${edge.source}:${edge.sourcePort}`] ?? []) {
        input.push(record);
      }
    }

    state.status = 'running';
    state.startedAt = Date.now();
    state.inputCount = input.length;
    emit();

    const nodeT0 = performance.now();
    try {
      const output = await executeNode(node, input, options.signal);
      for (const [port, records] of Object.entries(output.ports)) {
        result.portRecords[`${id}:${port}`] = records;
        state.outputCounts[port] = records.length;
      }
      state.warnings = output.warnings;
      state.message = output.message;
      state.status = 'completed';
    } catch (err) {
      if (err instanceof CancelledError || options.signal?.aborted) {
        state.status = 'skipped';
        state.message = 'Cancelled';
        state.finishedAt = Date.now();
        state.durationMs = performance.now() - nodeT0;
        cancelled = true;
        emit();
        break;
      }
      state.status = 'failed';
      state.message = err instanceof Error ? err.message : String(err);
      result.issues.push({ nodeId: id, message: `${node.name}: ${state.message}` });
    }
    state.finishedAt = Date.now();
    state.durationMs = performance.now() - nodeT0;
    emit();

    if (options.stepDelayMs && options.stepDelayMs > 0) {
      try {
        await sleep(options.stepDelayMs, options.signal);
      } catch {
        cancelled = true;
        break;
      }
    }
  }

  for (const id of order) {
    if (nodes[id].status === 'pending') {
      nodes[id].status = 'skipped';
      nodes[id].message = cancelled ? 'Cancelled' : 'Not reached';
    }
  }

  const anyFailed = Object.values(nodes).some((n) => n.status === 'failed');
  result.status = cancelled ? 'cancelled' : anyFailed ? 'failed' : 'completed';
  result.finishedAt = Date.now();
  result.durationMs = performance.now() - t0;
  emit();
  return result;
}
