import type { NodeType, TransformOp, WorkflowNode } from '../types';
import type { NodeProcessor, NodeOutputs, RunContext } from './types';
import { matchesConditionGroup, validateConditionGroup } from './condition';
import { safeEvaluate } from './evaluator';
import { generateOrders } from './sampleOrders';

// ---------------------------------------------------------------------------
// Node processors. Every node performs real, deterministic work.
// ---------------------------------------------------------------------------

function assertNotAborted(ctx: RunContext): void {
  if (ctx.signal.aborted) throw new AbortError('Execution cancelled.');
}

export class AbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbortError';
  }
}

export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new AbortError('Execution cancelled.');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortError('Execution cancelled.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function parsePastedJson(raw: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in data source: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Data source JSON must be an array of records.');
  }
  for (const item of parsed) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Data source JSON must contain only objects (records).');
    }
  }
  return parsed as unknown[];
}

function typedLiteral(raw: string): unknown {
  const t = raw.trim();
  if (t === '') return '';
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (t === 'undefined') return null;
  const n = Number(t);
  if (t !== '' && Number.isFinite(n) && /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return n;
  return raw;
}

function applyTransformOps(ops: TransformOp[] | undefined, record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...record };
  for (const op of ops ?? []) {
    switch (op.type) {
      case 'rename': {
        const from = op.fromField ?? '';
        const to = op.toField ?? '';
        if (!from || !to) throw new Error('Transform "rename" requires both source and target field names.');
        if (from === to) break;
        if (from in out) {
          out[to] = out[from];
          delete out[from];
        }
        break;
      }
      case 'setConstant': {
        const to = op.toField ?? '';
        if (!to) throw new Error('Transform "set constant" requires a target field name.');
        out[to] = typedLiteral(op.value ?? '');
        break;
      }
      case 'calculate': {
        const to = op.toField ?? '';
        if (!to) throw new Error('Transform "calculate" requires a target field name.');
        const formula = op.formula ?? '';
        const ev = safeEvaluate(formula, out);
        if (!ev.ok || ev.error) {
          throw new Error(`Transform formula error on field "${to}": ${ev.error ?? 'invalid expression'}`);
        }
        out[to] = ev.value;
        break;
      }
      case 'remove': {
        const from = op.fromField ?? '';
        if (!from) throw new Error('Transform "remove" requires a field name.');
        delete out[from];
        break;
      }
    }
  }
  return out;
}

const PROCESSORS: Record<NodeType, NodeProcessor> = {
  start: async () => ({ outputs: { out: [] } }),

  dataSource: async (ctx) => {
    assertNotAborted(ctx);
    const cfg = ctx.node.config;
    const mode = cfg.dataSourceMode ?? 'generate';
    let records: unknown[];
    if (mode === 'paste') {
      records = parsePastedJson(cfg.pastedJson ?? '[]');
    } else {
      const count = Math.max(0, Number(cfg.recordCount) || 0);
      if (count > 50000) throw new Error('Dataset size exceeds the 50,000 record limit.');
      const seed = Number(cfg.seed) || 0;
      records = generateOrders(count, seed);
    }
    return { outputs: { out: records } };
  },

  filter: async (ctx) => {
    assertNotAborted(ctx);
    const group = ctx.node.config.cond ?? { combinator: 'and', rows: [] };
    const validity = validateConditionGroup(group);
    if (!validity.ok) {
      throw new Error(`Filter conditions are invalid: ${validity.errors.join(' ')}`);
    }
    const passing = ctx.mergedInput.filter((rec) =>
      matchesConditionGroup(group, rec as Record<string, unknown>),
    );
    return {
      outputs: { out: passing },
      meta: { filteredCount: ctx.mergedInput.length - passing.length },
    };
  },

  transform: async (ctx) => {
    assertNotAborted(ctx);
    const ops = ctx.node.config.transformOps ?? [];
    const out = ctx.mergedInput.map((rec) => applyTransformOps(ops, rec as Record<string, unknown>));
    return { outputs: { out } };
  },

  condition: async (ctx) => {
    assertNotAborted(ctx);
    const group = ctx.node.config.cond ?? { combinator: 'and', rows: [] };
    const validity = validateConditionGroup(group);
    if (!validity.ok) {
      throw new Error(`Condition is invalid: ${validity.errors.join(' ')}`);
    }
    const truthy: unknown[] = [];
    const falsy: unknown[] = [];
    for (const rec of ctx.mergedInput) {
      if (matchesConditionGroup(group, rec as Record<string, unknown>)) truthy.push(rec);
      else falsy.push(rec);
    }
    return {
      outputs: { true: truthy, false: falsy },
      meta: { branchCounts: { true: truthy.length, false: falsy.length } },
    };
  },

  delay: async (ctx) => {
    assertNotAborted(ctx);
    const ms = Math.max(0, Number(ctx.node.config.delayMs) || 0);
    if (ms > 0) await sleep(ms, ctx.signal);
    return { outputs: { out: ctx.mergedInput } };
  },

  output: async (ctx) => {
    assertNotAborted(ctx);
    return {
      outputs: {},
      meta: { outRecords: ctx.mergedInput },
    };
  },
};

export function getProcessor(type: NodeType): NodeProcessor {
  return PROCESSORS[type];
}

export function isSourceNode(node: WorkflowNode): boolean {
  return node.type === 'dataSource' || node.type === 'start';
}

export type { NodeOutputs };
