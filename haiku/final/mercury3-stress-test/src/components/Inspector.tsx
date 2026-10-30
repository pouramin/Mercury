import { useMemo } from 'react';
import type { Condition, Operator, TransformOp, WorkflowDoc, WorkflowNode } from '../types';
import { OPERATORS, validateCondition } from '../engine/conditions';
import { parseExpression } from '../engine/expression';
import { validateNodeConfig } from '../engine/configValidation';
import { NODE_DEFS } from '../engine/nodeDefs';
import { newId } from '../utils/ids';
import { Icon } from './Icons';

interface InspectorProps {
  node: WorkflowNode;
  locked: boolean;
  /** Replaces the node. `key` coalesces repeated edits (e.g. typing) into one undo step. */
  onChange: (next: WorkflowNode, key: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

export function Inspector({ node, locked, onChange, onDelete, onDuplicate }: InspectorProps) {
  const def = NODE_DEFS[node.type];
  const problems = useMemo(() => validateNodeConfig(node.type, node.config), [node.type, node.config]);

  const update = (patch: Partial<WorkflowNode>, key: string) => onChange({ ...node, ...patch } as WorkflowNode, key);
  const setConfig = (config: unknown, key: string) => update({ config } as Partial<WorkflowNode>, key);

  return (
    <div className="inspector">
      <div className="inspector-head">
        <span className={`node-icon node-icon-${node.type}`}>
          <Icon name={node.type} size={16} />
        </span>
        <div className="inspector-titles">
          <div className="inspector-type">{def.label}</div>
          <div className="inspector-desc">{def.description}</div>
        </div>
      </div>

      <label className="field">
        <span className="field-label">Name</span>
        <input
          type="text"
          value={node.name}
          maxLength={60}
          disabled={locked}
          onChange={(e) => update({ name: e.target.value } as Partial<WorkflowNode>, `name:${node.id}`)}
        />
      </label>

      {problems.length > 0 && (
        <div className="problem-box" role="alert">
          {problems.map((p) => (
            <div key={p}>
              <Icon name="alert" size={13} /> {p}
            </div>
          ))}
        </div>
      )}

      <fieldset className="config" disabled={locked}>
        {node.type === 'start' && <p className="muted">Start has no settings. It begins every run and passes control to its connected nodes.</p>}

        {node.type === 'dataSource' && (
          <>
            <div className="segmented" role="radiogroup" aria-label="Data source">
              {(['generated', 'json'] as const).map((source) => (
                <button
                  key={source}
                  type="button"
                  role="radio"
                  aria-checked={node.config.source === source}
                  className={node.config.source === source ? 'active' : ''}
                  onClick={() => setConfig({ ...node.config, source }, `cfg:${node.id}`)}
                >
                  {source === 'generated' ? 'Generate orders' : 'JSON input'}
                </button>
              ))}
            </div>
            {node.config.source === 'generated' ? (
              <>
                <NumberField
                  label="Record count"
                  value={node.config.count}
                  min={0}
                  max={100000}
                  step={1}
                  hint="Deterministic e-commerce orders (0 = empty dataset)."
                  onChange={(count) => setConfig({ ...node.config, count }, `cfg:${node.id}:count`)}
                />
                <NumberField
                  label="Seed"
                  value={node.config.seed}
                  min={0}
                  max={2147483647}
                  step={1}
                  hint="Same seed always produces the same orders."
                  onChange={(seed) => setConfig({ ...node.config, seed }, `cfg:${node.id}:seed`)}
                />
              </>
            ) : (
              <label className="field">
                <span className="field-label">Records (JSON array)</span>
                <textarea
                  className="mono"
                  rows={9}
                  spellCheck={false}
                  value={node.config.json}
                  onChange={(e) => setConfig({ ...node.config, json: e.target.value }, `cfg:${node.id}:json`)}
                />
              </label>
            )}
          </>
        )}

        {node.type === 'filter' && (
          <>
            <label className="field">
              <span className="field-label">Match</span>
              <select
                value={node.config.combinator}
                onChange={(e) =>
                  setConfig({ ...node.config, combinator: e.target.value as 'all' | 'any' }, `cfg:${node.id}:comb`)
                }
              >
                <option value="all">all conditions (AND)</option>
                <option value="any">any condition (OR)</option>
              </select>
            </label>
            <ConditionList
              conditions={node.config.conditions}
              onChange={(conditions, key) => setConfig({ ...node.config, conditions }, key)}
              nodeId={node.id}
            />
          </>
        )}

        {node.type === 'transform' && (
          <TransformEditor
            operations={node.config.operations}
            nodeId={node.id}
            onChange={(operations, key) => setConfig({ ...node.config, operations }, key)}
          />
        )}

        {node.type === 'condition' && (
          <>
            <p className="muted small">Records that satisfy the condition leave through True; the rest leave through False.</p>
            <ConditionFields
              condition={node.config.condition}
              onChange={(condition, key) => setConfig({ ...node.config, condition }, key)}
              keyPrefix={`cfg:${node.id}`}
            />
          </>
        )}

        {node.type === 'delay' && (
          <NumberField
            label="Delay (ms)"
            value={node.config.ms}
            min={0}
            max={60000}
            step={50}
            hint="Execution pauses for this long, then records continue."
            onChange={(ms) => setConfig({ ...node.config, ms }, `cfg:${node.id}:ms`)}
          />
        )}

        {node.type === 'output' && (
          <>
            <label className="field">
              <span className="field-label">Title</span>
              <input
                type="text"
                value={node.config.title}
                maxLength={80}
                onChange={(e) => setConfig({ ...node.config, title: e.target.value }, `cfg:${node.id}:title`)}
              />
            </label>
            <NumberField
              label="Max rows shown"
              value={node.config.maxRows}
              min={1}
              max={5000}
              step={1}
              hint="All records are kept; this limits the table preview."
              onChange={(maxRows) => setConfig({ ...node.config, maxRows }, `cfg:${node.id}:rows`)}
            />
          </>
        )}
      </fieldset>

      <div className="inspector-actions">
        <button type="button" className="btn" onClick={onDuplicate} disabled={locked}>
          <Icon name="copy" size={14} /> Duplicate
        </button>
        <button type="button" className="btn danger" onClick={onDelete} disabled={locked}>
          <Icon name="trash" size={14} /> Delete
        </button>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint?: string;
  onChange: (value: number) => void;
}) {
  const invalid = !Number.isFinite(value) || value < min || value > max;
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        className={invalid ? 'invalid' : ''}
        onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
      />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function ConditionList({
  conditions,
  onChange,
  nodeId,
}: {
  conditions: Condition[];
  onChange: (conditions: Condition[], key: string) => void;
  nodeId: string;
}) {
  return (
    <div className="stack">
      <div className="section-label">Conditions</div>
      {conditions.length === 0 && <p className="muted small">No conditions: every record passes.</p>}
      {conditions.map((condition, index) => (
        <div className="card-row" key={condition.id}>
          <div className="card-row-head">
            <span className="muted small">Condition {index + 1}</span>
            <button
              type="button"
              className="icon-btn subtle"
              title="Remove condition"
              onClick={() => onChange(conditions.filter((c) => c.id !== condition.id), `rm:${condition.id}`)}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
          <ConditionFields
            condition={condition}
            keyPrefix={`cond:${nodeId}:${condition.id}`}
            onChange={(next, key) => onChange(conditions.map((c) => (c.id === condition.id ? next : c)), key)}
          />
        </div>
      ))}
      <button
        type="button"
        className="btn ghost"
        onClick={() =>
          onChange(
            [...conditions, { id: newId('c'), field: 'status', operator: 'eq', value: '' }],
            `add:${nodeId}:${conditions.length}`,
          )
        }
      >
        <Icon name="plus" size={14} /> Add condition
      </button>
    </div>
  );
}

function ConditionFields({
  condition,
  onChange,
  keyPrefix,
}: {
  condition: Condition;
  onChange: (condition: Condition, key: string) => void;
  keyPrefix: string;
}) {
  const problem = validateCondition(condition);
  const needsValue = OPERATORS.find((o) => o.value === condition.operator)?.needsValue ?? true;
  return (
    <div className="stack tight">
      <input
        type="text"
        className="mono"
        placeholder="field, e.g. orderTotal"
        value={condition.field}
        onChange={(e) => onChange({ ...condition, field: e.target.value }, `${keyPrefix}:field`)}
      />
      <select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as Operator }, `${keyPrefix}:op`)}
      >
        {OPERATORS.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>
      {needsValue && (
        <input
          type="text"
          className="mono"
          placeholder="value"
          value={condition.value}
          onChange={(e) => onChange({ ...condition, value: e.target.value }, `${keyPrefix}:value`)}
        />
      )}
      {problem && <div className="problem-inline">{problem}</div>}
    </div>
  );
}

const OP_LABELS: Record<TransformOp['type'], string> = {
  compute: 'Compute field',
  rename: 'Rename field',
  set: 'Set value',
  remove: 'Remove field',
  case: 'Change case',
};

function newOp(type: TransformOp['type']): TransformOp {
  const id = newId('op');
  switch (type) {
    case 'compute':
      return { id, type, target: 'newField', expression: 'quantity * unitPrice' };
    case 'rename':
      return { id, type, from: 'oldName', to: 'newName' };
    case 'set':
      return { id, type, target: 'channel', value: 'web', valueType: 'string' };
    case 'remove':
      return { id, type, field: 'fieldName' };
    case 'case':
      return { id, type, field: 'customer', mode: 'upper' };
  }
}

function TransformEditor({
  operations,
  nodeId,
  onChange,
}: {
  operations: TransformOp[];
  nodeId: string;
  onChange: (operations: TransformOp[], key: string) => void;
}) {
  const replace = (op: TransformOp) => operations.map((o) => (o.id === op.id ? op : o));
  return (
    <div className="stack">
      <div className="section-label">Operations (run in order)</div>
      {operations.length === 0 && <p className="muted small">No operations: records pass through unchanged.</p>}
      {operations.map((op, index) => (
        <div className="card-row" key={op.id}>
          <div className="card-row-head">
            <span className="muted small">
              {index + 1}. {OP_LABELS[op.type]}
            </span>
            <button
              type="button"
              className="icon-btn subtle"
              title="Remove operation"
              onClick={() => onChange(operations.filter((o) => o.id !== op.id), `rm:${op.id}`)}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
          <OperationFields op={op} onChange={(next) => onChange(replace(next), `op:${op.id}`)} />
        </div>
      ))}
      <div className="button-row">
        {(['compute', 'rename', 'set', 'remove', 'case'] as const).map((type) => (
          <button key={type} type="button" className="chip" onClick={() => onChange([...operations, newOp(type)], `add:${nodeId}`)}>
            + {OP_LABELS[type].split(' ')[0]}
          </button>
        ))}
      </div>
    </div>
  );
}

function OperationFields({ op, onChange }: { op: TransformOp; onChange: (op: TransformOp) => void }) {
  switch (op.type) {
    case 'compute': {
      let error: string | null = null;
      try {
        parseExpression(op.expression);
      } catch (err) {
        error = (err as Error).message;
      }
      return (
        <div className="stack tight">
          <input className="mono" placeholder="target field" value={op.target} onChange={(e) => onChange({ ...op, target: e.target.value })} />
          <input
            className="mono"
            placeholder="expression, e.g. round(quantity * unitPrice, 2)"
            value={op.expression}
            onChange={(e) => onChange({ ...op, expression: e.target.value })}
          />
          <span className="field-hint">Fields, numbers, + - * / %, and round, floor, ceil, abs, min, max.</span>
          {error && <div className="problem-inline">{error}</div>}
        </div>
      );
    }
    case 'rename':
      return (
        <div className="stack tight">
          <input className="mono" placeholder="from" value={op.from} onChange={(e) => onChange({ ...op, from: e.target.value })} />
          <input className="mono" placeholder="to" value={op.to} onChange={(e) => onChange({ ...op, to: e.target.value })} />
        </div>
      );
    case 'set':
      return (
        <div className="stack tight">
          <input className="mono" placeholder="target field" value={op.target} onChange={(e) => onChange({ ...op, target: e.target.value })} />
          <select
            value={op.valueType}
            onChange={(e) => onChange({ ...op, valueType: e.target.value as 'string' | 'number' | 'boolean' | 'null' })}
          >
            <option value="string">text</option>
            <option value="number">number</option>
            <option value="boolean">true / false</option>
            <option value="null">null</option>
          </select>
          {op.valueType !== 'null' && (
            <input className="mono" placeholder="value" value={op.value} onChange={(e) => onChange({ ...op, value: e.target.value })} />
          )}
        </div>
      );
    case 'remove':
      return <input className="mono" placeholder="field" value={op.field} onChange={(e) => onChange({ ...op, field: e.target.value })} />;
    case 'case':
      return (
        <div className="stack tight">
          <input className="mono" placeholder="field" value={op.field} onChange={(e) => onChange({ ...op, field: e.target.value })} />
          <select value={op.mode} onChange={(e) => onChange({ ...op, mode: e.target.value as 'upper' | 'lower' })}>
            <option value="upper">UPPER CASE</option>
            <option value="lower">lower case</option>
          </select>
        </div>
      );
  }
}

/** Compact list of problems for the whole workflow, used in the right-hand panel. */
export function ValidationList({
  issues,
  doc,
  onSelect,
}: {
  issues: { level: 'error' | 'warning'; message: string; nodeId?: string }[];
  doc: WorkflowDoc;
  onSelect: (nodeId: string) => void;
}) {
  if (issues.length === 0) {
    return (
      <div className="ok-box">
        <Icon name="check" size={14} /> Workflow is valid. {doc.nodes.length} nodes, {doc.edges.length} connections.
      </div>
    );
  }
  return (
    <ul className="issue-list">
      {issues.map((issue, index) => (
        <li key={`${issue.message}-${index}`} className={issue.level}>
          <button
            type="button"
            className="issue-button"
            disabled={!issue.nodeId}
            onClick={() => issue.nodeId && onSelect(issue.nodeId)}
          >
            <Icon name="alert" size={13} />
            <span>{issue.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
