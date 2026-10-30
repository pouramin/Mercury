import { useId } from 'react';
import { X, Plus } from 'lucide-react';
import type { ConditionGroup, ConditionRow, FieldOp, TransformOp, TransformOpType } from '../types';
import { makeId } from '../engine/graph';
import { compileFormula } from '../engine/evaluator';
import { useFF } from '../state/store';

const OP_LABELS: Record<FieldOp, string> = {
  eq: '= equals',
  neq: '≠ not equal',
  gt: '> greater than',
  gte: '≥ at least',
  lt: '< less than',
  lte: '≤ at most',
  contains: 'contains',
  notContains: 'does not contain',
  startsWith: 'starts with',
  endsWith: 'ends with',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  in: 'is one of (comma list)',
  notIn: 'not one of (comma list)',
};

export function FieldSuggestInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; style?: React.CSSProperties }) {
  const fields = useFF((s) => s.lastKnownFields);
  const uid = useId();
  const listId = `ff-field-suggest-${uid}`;
  return (
    <>
      <input
        className="field-in"
        value={props.value}
        placeholder={props.placeholder ?? 'field name'}
        onChange={(e) => props.onChange(e.target.value)}
        list={listId}
        spellCheck={false}
        style={props.style}
      />
      {fields.length > 0 ? (
        <datalist id={listId}>
          {fields.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}

export function ConditionEditor(props: { value: ConditionGroup; onChange: (v: ConditionGroup) => void }) {
  const v = props.value ?? { combinator: 'and', rows: [] };
  const setRows = (rows: ConditionRow[]) => props.onChange({ ...v, rows });
  const updateRow = (id: string, patch: Partial<ConditionRow>) => {
    setRows(v.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  return (
    <div>
      <div className="combinator">
        <button className={v.combinator === 'and' ? 'active' : ''} onClick={() => props.onChange({ ...v, combinator: 'and' })}>
          ALL (AND)
        </button>
        <button className={v.combinator === 'or' ? 'active' : ''} onClick={() => props.onChange({ ...v, combinator: 'or' })}>
          ANY (OR)
        </button>
      </div>
      {v.rows.length === 0 ? (
        <div className="hint" style={{ marginBottom: 8 }}>
          No conditions — every record passes. Add a condition to filter.
        </div>
      ) : null}
      {v.rows.map((r) => (
        <div key={r.id} className="cond-row">
          <FieldSuggestInput value={r.field} onChange={(field) => updateRow(r.id, { field })} />
          <select
            value={r.op}
            onChange={(e) => updateRow(r.id, { op: e.target.value as FieldOp })}
            style={{ width: 150 }}
          >
            {(Object.keys(OP_LABELS) as FieldOp[]).map((op) => (
              <option key={op} value={op}>
                {OP_LABELS[op]}
              </option>
            ))}
          </select>
          {r.op !== 'isEmpty' && r.op !== 'isNotEmpty' ? (
            <input
              value={r.value}
              placeholder="value"
              onChange={(e) => updateRow(r.id, { value: e.target.value })}
              style={{ width: 110 }}
            />
          ) : null}
          <button className="mini-btn danger" title="Remove condition" onClick={() => setRows(v.rows.filter((x) => x.id !== r.id))}>
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        className="cond-add"
        onClick={() => setRows([...v.rows, { id: makeId(), field: '', op: 'eq', value: '' }])}
      >
        <Plus size={13} /> Add condition
      </button>
    </div>
  );
}

const TF_TYPE_LABELS: Record<TransformOpType, string> = {
  rename: 'Rename field',
  setConstant: 'Set constant value',
  calculate: 'Calculate with formula',
  remove: 'Remove field',
};

export function TransformEditor(props: { ops: TransformOp[]; onChange: (ops: TransformOp[]) => void }) {
  const ops = props.ops ?? [];
  const update = (id: string, patch: Partial<TransformOp>) => {
    props.onChange(ops.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  };
  const removeOp = (id: string) => props.onChange(ops.filter((o) => o.id !== id));
  const addOp = (type: TransformOpType) =>
    props.onChange([...ops, { id: makeId(), type, fromField: '', toField: '', value: '', formula: '' }]);

  return (
    <div>
      {ops.length === 0 ? (
        <div className="hint" style={{ marginBottom: 8 }}>
          No operations — records pass through unchanged.
        </div>
      ) : null}
      {ops.map((op) => {
        const formulaState = op.type === 'calculate' ? compileFormula(op.formula ?? '') : null;
        return (
          <div key={op.id} className="tf-op">
            <div className="tf-op-head">
              <select value={op.type} onChange={(e) => update(op.id, { type: e.target.value as TransformOpType })}>
                {(Object.keys(TF_TYPE_LABELS) as TransformOpType[]).map((t) => (
                  <option key={t} value={t}>
                    {TF_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <button className="mini-btn danger tf-remove" title="Remove operation" onClick={() => removeOp(op.id)}>
                <X size={14} />
              </button>
            </div>
            <div className="tf-op-body">
              {op.type === 'rename' ? (
                <>
                  <FieldSuggestInput value={op.fromField ?? ''} placeholder="from field" onChange={(fromField) => update(op.id, { fromField })} />
                  <FieldSuggestInput value={op.toField ?? ''} placeholder="to field" onChange={(toField) => update(op.id, { toField })} />
                </>
              ) : null}
              {op.type === 'remove' ? (
                <FieldSuggestInput value={op.fromField ?? ''} placeholder="field to remove" onChange={(fromField) => update(op.id, { fromField })} />
              ) : null}
              {op.type === 'setConstant' ? (
                <>
                  <FieldSuggestInput value={op.toField ?? ''} placeholder="target field" onChange={(toField) => update(op.id, { toField })} />
                  <input value={op.value ?? ''} placeholder="value (number / text / true / false / null)" onChange={(e) => update(op.id, { value: e.target.value })} />
                </>
              ) : null}
              {op.type === 'calculate' ? (
                <>
                  <FieldSuggestInput value={op.toField ?? ''} placeholder="target field" onChange={(toField) => update(op.id, { toField })} />
                  <textarea
                    className={`tf-formula${formulaState && !formulaState.ok ? ' error' : ''}`}
                    value={op.formula ?? ''}
                    placeholder="e.g. round($quantity * $unitPrice, 2)"
                    onChange={(e) => update(op.id, { formula: e.target.value })}
                    spellCheck={false}
                  />
                  {formulaState && !formulaState.ok ? <div className="err-hint">{formulaState.error}</div> : null}
                  <div className="hint">
                    Use $field or {'{{field}}'} references. Supported: + - * / % ^ ( ) == != &lt; &gt; &lt;= &gt;= &&amp;&amp; ||, functions round / floor / ceil / min / max / upper / lower / trim / replace / substring / length / concat / toString / toNumber / currency / percent / if / coalesce / date.
                  </div>
                </>
              ) : null}
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['calculate', 'rename', 'setConstant', 'remove'] as TransformOpType[]).map((t) => (
          <button key={t} className="btn ghost sm" onClick={() => addOp(t)}>
            <Plus size={12} /> {TF_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
    </div>
  );
}
