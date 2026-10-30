import { memo } from 'react';
import {
  Play,
  Database,
  Filter,
  Wand2,
  Split,
  Clock,
  Table2,
  AlertTriangle,
} from 'lucide-react';
import type { WorkflowNode } from '../types';
import { NODE_COLOR, NODE_LABEL, NODE_SIZE, getInputPorts, getOutputPorts } from '../engine/graph';
import type { NodeRunState } from '../engine/types';

const ICONS = {
  start: Play,
  dataSource: Database,
  filter: Filter,
  transform: Wand2,
  condition: Split,
  delay: Clock,
  output: Table2,
};

interface Props {
  node: WorkflowNode;
  selected: boolean;
  status?: NodeRunState;
  executing: boolean;
  wiringActive: boolean;
  onBodyPointerDown: (e: React.PointerEvent, node: WorkflowNode) => void;
  onPortPointerDown: (e: React.PointerEvent, node: WorkflowNode, portId: string, kind: 'input' | 'output') => void;
}

function summaryFor(node: WorkflowNode): React.ReactNode {
  const c = node.config;
  switch (node.type) {
    case 'dataSource': {
      if (c.dataSourceMode === 'paste') {
        return <div className="node-summary-row"><span>mode</span><b>pasted JSON</b></div>;
      }
      return (
        <>
          <div className="node-summary-row"><span>records</span><b>{String(c.recordCount ?? 0)}</b></div>
          <div className="node-summary-row"><span>seed</span><b>{String(c.seed ?? 0)}</b></div>
        </>
      );
    }
    case 'filter': {
      const rows = (c.cond as { rows?: unknown[] } | undefined)?.rows ?? [];
      const comb = (c.cond as { combinator?: string } | undefined)?.combinator ?? 'and';
      return (
        <>
          <div className="node-summary-row"><span>conditions</span><b>{rows.length}</b></div>
          <div className="node-summary-row"><span>combinator</span><b>{comb.toUpperCase()}</b></div>
        </>
      );
    }
    case 'transform': {
      const ops = (c.transformOps as unknown[] | undefined) ?? [];
      return <div className="node-summary-row"><span>operations</span><b>{ops.length}</b></div>;
    }
    case 'condition': {
      const rows = (c.cond as { rows?: unknown[] } | undefined)?.rows ?? [];
      return (
        <>
          <div className="node-summary-row"><span>conditions</span><b>{rows.length}</b></div>
          <div className="node-summary-row"><span>branches</span><b>true / false</b></div>
        </>
      );
    }
    case 'delay':
      return <div className="node-summary-row"><span>delay</span><b>{String(c.delayMs ?? 0)} ms</b></div>;
    case 'output':
      return <div className="node-summary-row"><span>dataset</span><b>{String(c.outputLabel ?? 'Results')}</b></div>;
    default:
      return null;
  }
}

export const NodeView = memo(function NodeView({
  node,
  selected,
  status,
  executing,
  wiringActive,
  onBodyPointerDown,
  onPortPointerDown,
}: Props) {
  const size = NODE_SIZE[node.type];
  const Icon = ICONS[node.type];
  const color = NODE_COLOR[node.type];
  const statusClass = status?.status ?? 'pending';

  const inputs = getInputPorts(node);
  const outputs = getOutputPorts(node);

  return (
    <div
      className={`node${selected ? ' selected' : ''}`}
      style={{ left: node.position.x, top: node.position.y, width: size.w, height: size.h }}
      data-node={node.id}
      onPointerDown={(e) => onBodyPointerDown(e, node)}
    >
      <div className="node-header">
        <div className="node-icon" style={{ background: color }}>
          <Icon size={14} strokeWidth={2.6} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            className="node-type-label"
            style={{ color: selected ? color : undefined }}
          >
            {NODE_LABEL[node.type]}
          </div>
          <div className="node-title">{String(node.config.label ?? NODE_LABEL[node.type])}</div>
        </div>
        <div className={`node-status ${statusClass}`} title={statusClass} />
      </div>

      <div className="node-body">
        <div className="node-summary">{summaryFor(node)}</div>
        {status?.status === 'failed' && status.error ? (
          <div className="node-failed-hint">
            <AlertTriangle size={11} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            {status.error}
          </div>
        ) : null}
      </div>

      {inputs.map((p) => (
        <div
          key={p.id}
          className={`port ${wiringActive ? 'targetable' : ''}`}
          style={{ left: -7, top: size.h * ((inputs.indexOf(p) + 0.5) / Math.max(1, inputs.length)) - 7 }}
          data-port={p.id}
          data-kind="input"
          data-node={node.id}
          data-label={p.label}
          onPointerDown={(e) => onPortPointerDown(e, node, p.id, 'input')}
        >
          <div className="port-hit" />
          <span className="port-label" style={{ left: 16, top: -2 }}>{p.label}</span>
        </div>
      ))}

      {outputs.map((p) => (
        <div
          key={p.id}
          className={`port ${wiringActive ? 'wiring' : ''}`}
          style={{ left: size.w - 7, top: size.h * ((outputs.indexOf(p) + 0.5) / Math.max(1, outputs.length)) - 7 }}
          data-port={p.id}
          data-kind="output"
          data-node={node.id}
          data-label={p.label}
          onPointerDown={(e) => onPortPointerDown(e, node, p.id, 'output')}
        >
          <div className="port-hit" />
          <span className="port-label" style={{ right: 16, top: -2, textAlign: 'right' }}>{p.label}</span>
        </div>
      ))}

      {executing && status?.status === 'running' ? <div className="node-running-overlay" /> : null}
    </div>
  );
});
