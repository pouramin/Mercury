// Analytics derived purely from an ExecutionResult. Nothing here is hardcoded.

import type { ExecutionResult, RunSummary, WorkflowDoc } from '../types';

export interface NodeTiming {
  nodeId: string;
  name: string;
  status: string;
  startOffsetMs: number;
  durationMs: number;
}

export interface BranchStat {
  nodeId: string;
  name: string;
  trueCount: number;
  falseCount: number;
}

export interface Analytics {
  totalInput: number;
  processed: number;
  filtered: number;
  durationMs: number;
  branches: BranchStat[];
  nodeTimings: NodeTiming[];
  errors: string[];
  completed: number;
  failed: number;
  skipped: number;
}

export function computeAnalytics(doc: WorkflowDoc, result: ExecutionResult): Analytics {
  let totalInput = 0;
  let processed = 0;
  let filtered = 0;
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  const branches: BranchStat[] = [];
  const nodeTimings: NodeTiming[] = [];

  for (const node of doc.nodes) {
    const state = result.nodes[node.id];
    if (!state) continue;
    if (state.status === 'completed') completed++;
    if (state.status === 'failed') failed++;
    if (state.status === 'skipped') skipped++;

    if (state.status === 'completed') {
      if (node.type === 'dataSource') totalInput += state.outputCounts.out ?? 0;
      if (node.type === 'output') processed += state.inputCount;
      if (node.type === 'filter') filtered += state.inputCount - (state.outputCounts.out ?? 0);
      if (node.type === 'condition') {
        branches.push({
          nodeId: node.id,
          name: node.name,
          trueCount: state.outputCounts.true ?? 0,
          falseCount: state.outputCounts.false ?? 0,
        });
      }
    }

    nodeTimings.push({
      nodeId: node.id,
      name: node.name,
      status: state.status,
      startOffsetMs: state.startedAt !== undefined ? state.startedAt - result.startedAt : 0,
      durationMs: state.durationMs ?? 0,
    });
  }

  return {
    totalInput,
    processed,
    filtered,
    durationMs: result.durationMs,
    branches,
    nodeTimings,
    errors: result.issues.map((issue) => issue.message),
    completed,
    failed,
    skipped,
  };
}

export function summarizeRun(result: ExecutionResult, analytics: Analytics): RunSummary {
  return {
    runId: result.runId,
    startedAt: result.startedAt,
    durationMs: Math.round(result.durationMs),
    status: result.status,
    inputRecords: analytics.totalInput,
    processed: analytics.processed,
    filtered: analytics.filtered,
    trueCount: analytics.branches.reduce((sum, b) => sum + b.trueCount, 0),
    falseCount: analytics.branches.reduce((sum, b) => sum + b.falseCount, 0),
    errorCount: analytics.errors.length,
  };
}
