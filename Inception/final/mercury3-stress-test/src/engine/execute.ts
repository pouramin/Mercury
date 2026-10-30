import type { Workflow } from '../types';
import type { ExecutionIssue, ExecutionResult, NodeRunState, NodeStatus, RunOptions, TimelineEntry } from './types';
import {
  canonicalEdgeOrder,
  getInputPorts,
  getOutputPorts,
  hasFatalIssues,
  topoSort,
  validateGraph,
} from './graph';
import { AbortError, getProcessor, sleep, isSourceNode } from './nodes';
import { makeId } from './graph';

// ---------------------------------------------------------------------------
// Workflow execution engine
// ---------------------------------------------------------------------------

export interface ExecuteParams {
  workflow: Workflow;
  options?: Partial<RunOptions>;
  signal?: AbortSignal;
  /** Called whenever a node changes state (used for live UI animation). */
  onProgress?: (nodeId: string, status: NodeStatus, info?: Partial<NodeRunState>) => void;
}

const DEFAULT_OPTIONS: RunOptions = { animate: true, nodeDelayMs: 220 };

export async function executeWorkflow(params: ExecuteParams): Promise<ExecutionResult> {
  const { workflow, signal = new AbortController().signal } = params;
  const opts: RunOptions = { ...DEFAULT_OPTIONS, ...(params.options ?? {}) };
  const startedAt = Date.now();
  const id = makeId();
  const result: ExecutionResult = {
    id,
    workflowId: workflow.id,
    workflowName: workflow.name,
    status: 'completed',
    startedAt,
    order: [],
    nodeStates: {},
    issues: [],
    errors: [],
    totalInputRecords: 0,
    processedRecords: 0,
    filteredRecords: 0,
    branchDistribution: {},
    timelines: [],
    outputs: {},
  };

  const issues = validateGraph(workflow.nodes, workflow.edges);
  result.issues = issues;

  const fatal = hasFatalIssues(issues);
  const topo = topoSort(workflow.nodes, workflow.edges);
  result.order = topo.order;

  // Pre-seed states
  for (const n of workflow.nodes) {
    result.nodeStates[n.id] = { status: 'pending' };
  }

  const emit = (nodeId: string, status: NodeStatus, info?: Partial<NodeRunState>) => {
    const st = result.nodeStates[nodeId];
    if (st) {
      Object.assign(st, info, { status });
      if (status !== 'pending') {
        result.timelines.push({ t: Date.now(), nodeId, status, label: info?.error });
      }
    }
    params.onProgress?.(nodeId, status, info);
  };

  if (fatal || topo.hasCycle) {
    result.status = 'failed';
    result.finishedAt = Date.now();
    result.durationMs = result.finishedAt - startedAt;
    for (const i of issues) {
      if (i.level === 'error') result.errors.push({ nodeId: i.nodeId, message: i.message });
    }
    return result;
  }

  const outputsByNode = new Map<string, Record<string, unknown[]>>();
  let cancelled = false;
  let failed = false;

  const runNode = async (nodeId: string) => {
    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (!node) {
      failed = true;
      result.errors.push({ nodeId, message: `Unknown node ${nodeId}` });
      emit(nodeId, 'failed', { error: 'Unknown node' });
      return;
    }
    emit(nodeId, 'running', { startedAt: Date.now(), status: 'running' });
    const t0 = Date.now();

    // Gather per-port inputs
    const inputs: Record<string, unknown[]> = {};
    const inPorts = getInputPorts(node);
    for (const p of inPorts) {
      const incoming = canonicalEdgeOrder(workflow.edges).filter(
        (e) => e.target === nodeId && e.targetPort === p.id,
      );
      const merged: unknown[] = [];
      for (const e of incoming) {
        const srcOuts = outputsByNode.get(e.source);
        if (srcOuts && srcOuts[e.sourcePort]) merged.push(...srcOuts[e.sourcePort]);
      }
      inputs[p.id] = merged;
    }
    const mergedInput = Object.values(inputs).flat();

    try {
      const processor = getProcessor(node.type);
      const { outputs, meta } = await processor({
        node,
        inputs,
        mergedInput,
        signal,
        opts,
      });
      // Validate outputs reference real ports
      const outPorts = getOutputPorts(node);
      const clean: Record<string, unknown[]> = {};
      for (const p of outPorts) {
        clean[p.id] = outputs?.[p.id] ?? [];
      }
      outputsByNode.set(nodeId, clean);

      const durationMs = Date.now() - t0;
      const state: NodeRunState = {
        status: 'completed',
        startedAt: t0,
        finishedAt: Date.now(),
        durationMs,
        inputCount: mergedInput.length,
        outputCount: outPorts.reduce((s, p) => s + (clean[p.id]?.length ?? 0), 0),
        filteredCount: meta?.filteredCount,
        branchCounts: meta?.branchCounts,
      };
      emit(nodeId, 'completed', state);

      if (meta?.outRecords) {
        result.outputs[nodeId] = { nodeId, portId: 'in', records: meta.outRecords };
        const outPort = getOutputPorts(node);
        void outPort;
      }
    } catch (err) {
      const isCancel = err instanceof AbortError || (err instanceof Error && err.name === 'AbortError');
      const message = err instanceof Error ? err.message : String(err);
      if (isCancel) {
        cancelled = true;
        emit(nodeId, 'failed', { error: 'Execution cancelled.', status: 'failed' });
      } else {
        failed = true;
        result.errors.push({ nodeId, message });
        emit(nodeId, 'failed', { error: message, status: 'failed' });
      }
    }
  };

  for (const nodeId of topo.order) {
    if (signal.aborted) {
      cancelled = true;
      break;
    }
    if (failed && !cancelled) {
      // downstream nodes become skipped
      emit(nodeId, 'skipped');
      continue;
    }
    await runNode(nodeId);
    if (cancelled) break;

    // Pacing so the UI can animate (and cancellation can interrupt cleanly,
    // without altering the status of an already-completed node).
    if (opts.animate && opts.nodeDelayMs > 0) {
      try {
        await sleep(opts.nodeDelayMs, signal);
      } catch {
        if (signal.aborted) {
          cancelled = true;
          break;
        }
      }
    }
  }

  // Cancel or skipped tail
  if (cancelled) {
    const seen = new Set<string>();
    for (const n of workflow.nodes) seen.add(n.id);
    // Mark anything still pending as skipped (or in-progress as failed->skip)
    for (const n of workflow.nodes) {
      const st = result.nodeStates[n.id];
      if (!st || st.status === 'pending') emit(n.id, 'skipped');
    }
    result.status = 'cancelled';
    result.errors.push({ message: 'Execution cancelled by user.' });
  } else if (failed) {
    result.status = 'failed';
    for (const n of workflow.nodes) {
      if (result.nodeStates[n.id]?.status === 'pending') emit(n.id, 'skipped');
    }
  } else {
    result.status = 'completed';
  }

  // ---- Metrics from actual results ----
  let totalInput = 0;
  for (const n of workflow.nodes) {
    if (isSourceNode(n) && n.type === 'dataSource') {
      const st = result.nodeStates[n.id];
      if (st?.status === 'completed') {
        const outs = outputsByNode.get(n.id);
        totalInput += outs?.out?.length ?? st.outputCount ?? 0;
      }
    }
  }
  result.totalInputRecords = totalInput;

  let processed = 0;
  for (const key of Object.keys(result.outputs)) {
    processed += result.outputs[key].records.length;
  }
  result.processedRecords = processed;

  let filtered = 0;
  for (const n of workflow.nodes) {
    const st = result.nodeStates[n.id];
    if (st && n.type === 'filter' && typeof st.filteredCount === 'number') {
      filtered += st.filteredCount;
    }
  }
  result.filteredRecords = filtered;

  const branch: Record<string, number> = {};
  for (const n of workflow.nodes) {
    if (n.type === 'condition' && result.nodeStates[n.id]?.branchCounts) {
      for (const [k, v] of Object.entries(result.nodeStates[n.id]!.branchCounts!)) {
        const key = `${n.config.label ?? 'condition'} · ${k === 'true' ? 'True' : 'False'}`;
        branch[key] = (branch[key] ?? 0) + v;
      }
    }
  }
  result.branchDistribution = branch;

  result.finishedAt = Date.now();
  result.durationMs = result.finishedAt - startedAt;

  // Drop timeline entries for still-pending nodes (none left), keep all.
  return result;
}

/** Convenience: validate-only (used by the Validate panel). */
export function validateWorkflow(workflow: Workflow): ExecutionIssue[] {
  return validateGraph(workflow.nodes, workflow.edges);
}
