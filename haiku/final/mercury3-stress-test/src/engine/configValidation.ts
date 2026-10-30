// Defensive validation of node configuration. Input may come from the UI, from a
// persisted file or from an imported workflow, so every shape is checked at runtime.

import type { Condition, DataRecord, NodeType, TransformOp } from '../types';
import { validateCondition } from './conditions';
import { validateTransformOp } from './transform';

export const MAX_GENERATED_RECORDS = 100000;
export const MAX_DELAY_MS = 60000;
export const MAX_OUTPUT_ROWS = 5000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function validConditionShape(value: unknown): value is Condition {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.field === 'string' &&
    typeof value.operator === 'string' &&
    typeof value.value === 'string'
  );
}

function validOpShape(value: unknown): value is TransformOp {
  return isObject(value) && typeof value.id === 'string' && typeof value.type === 'string';
}

/**
 * Parses the JSON text of a Data Source node. Returns the object records and the number
 * of entries that were skipped because they were not objects.
 */
export function parseJsonRecords(text: string): { records: DataRecord[]; skipped: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Input JSON is not valid: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Input JSON must be an array of record objects.');
  }
  const records: DataRecord[] = [];
  let skipped = 0;
  for (const entry of parsed) {
    if (isObject(entry)) records.push(entry);
    else skipped++;
  }
  return { records, skipped };
}

/** Returns human-readable problems for a node's config, or an empty list when valid. */
export function validateNodeConfig(type: NodeType, config: unknown): string[] {
  if (!isObject(config)) return ['Configuration is missing or malformed.'];
  const errors: string[] = [];

  switch (type) {
    case 'start':
      return errors;

    case 'dataSource': {
      if (config.source !== 'generated' && config.source !== 'json') {
        errors.push('Source must be "generated" or "json".');
      }
      if (!Number.isInteger(config.count) || (config.count as number) < 0 || (config.count as number) > MAX_GENERATED_RECORDS) {
        errors.push(`Record count must be a whole number between 0 and ${MAX_GENERATED_RECORDS}.`);
      }
      if (!Number.isInteger(config.seed)) errors.push('Seed must be a whole number.');
      if (config.source === 'json') {
        if (typeof config.json !== 'string') {
          errors.push('JSON input is missing.');
        } else {
          try {
            parseJsonRecords(config.json);
          } catch (err) {
            errors.push((err as Error).message);
          }
        }
      }
      return errors;
    }

    case 'filter': {
      if (config.combinator !== 'all' && config.combinator !== 'any') {
        errors.push('Combinator must be "all" or "any".');
      }
      if (!Array.isArray(config.conditions)) {
        errors.push('Conditions must be a list.');
        return errors;
      }
      config.conditions.forEach((condition, index) => {
        if (!validConditionShape(condition)) {
          errors.push(`Condition ${index + 1} is malformed.`);
          return;
        }
        const problem = validateCondition(condition);
        if (problem) errors.push(`Condition ${index + 1}: ${problem}`);
      });
      return errors;
    }

    case 'transform': {
      if (!Array.isArray(config.operations)) {
        errors.push('Operations must be a list.');
        return errors;
      }
      config.operations.forEach((op, index) => {
        if (!validOpShape(op)) {
          errors.push(`Operation ${index + 1} is malformed.`);
          return;
        }
        const problem = validateTransformOp(op);
        if (problem) errors.push(`Operation ${index + 1}: ${problem}`);
      });
      return errors;
    }

    case 'condition': {
      if (!validConditionShape(config.condition)) {
        errors.push('Condition is malformed.');
        return errors;
      }
      const problem = validateCondition(config.condition);
      if (problem) errors.push(problem);
      return errors;
    }

    case 'delay': {
      if (!Number.isFinite(config.ms) || (config.ms as number) < 0 || (config.ms as number) > MAX_DELAY_MS) {
        errors.push(`Delay must be between 0 and ${MAX_DELAY_MS} ms.`);
      }
      return errors;
    }

    case 'output': {
      if (typeof config.title !== 'string') errors.push('Title must be text.');
      if (!Number.isInteger(config.maxRows) || (config.maxRows as number) < 1 || (config.maxRows as number) > MAX_OUTPUT_ROWS) {
        errors.push(`Max rows must be between 1 and ${MAX_OUTPUT_ROWS}.`);
      }
      return errors;
    }
  }
}
