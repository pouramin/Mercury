import type { DragEvent } from 'react';
import type { NodeType, Workflow } from '../types';
import { NODE_DEFS, NODE_TYPES } from '../engine/nodeDefs';
import { Icon } from './Icons';
import { NODE_DRAG_MIME } from './Canvas';

interface SidebarProps {
  hasStart: boolean;
  locked: boolean;
  onAdd: (type: NodeType) => void;
  workflows: Workflow[];
  activeId: string;
  onSelectWorkflow: (id: string) => void;
  onNewWorkflow: () => void;
  onDeleteWorkflow: (id: string) => void;
  onResetDemo: () => void;
}

export function Sidebar(props: SidebarProps) {
  const { hasStart, locked, workflows, activeId } = props;

  const onDragStart = (type: NodeType) => (e: DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.setData(NODE_DRAG_MIME, type);
    e.dataTransfer.setData('text/plain', NODE_DEFS[type].label);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <aside className="sidebar" aria-label="Node library and workflows">
      <section className="side-section">
        <div className="side-title">Node library</div>
        <p className="side-hint">Drag onto the canvas, or click to add.</p>
        <div className="palette">
          {NODE_TYPES.map((type) => {
            const def = NODE_DEFS[type];
            const disabled = locked || (type === 'start' && hasStart);
            return (
              <button
                key={type}
                type="button"
                className={`palette-item node-${type}`}
                draggable={!disabled}
                disabled={disabled}
                onDragStart={onDragStart(type)}
                onClick={() => props.onAdd(type)}
                title={type === 'start' && hasStart ? 'This workflow already has a Start node' : def.description}
              >
                <span className={`node-icon node-icon-${type}`}>
                  <Icon name={type} size={14} />
                </span>
                <span className="palette-text">
                  <span className="palette-label">{def.label}</span>
                  <span className="palette-desc">{def.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="side-section grow">
        <div className="side-title-row">
          <div className="side-title">Workflows</div>
          <button type="button" className="icon-btn" title="New workflow" onClick={props.onNewWorkflow} disabled={locked}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        <ul className="workflow-list">
          {workflows.map((wf) => (
            <li key={wf.id} className={wf.id === activeId ? 'active' : ''}>
              <button type="button" className="workflow-item" onClick={() => props.onSelectWorkflow(wf.id)} disabled={locked && wf.id !== activeId}>
                <Icon name="workflow" size={14} />
                <span className="workflow-name">{wf.doc.name}</span>
                <span className="muted small">{wf.doc.nodes.length}</span>
              </button>
              {workflows.length > 1 && (
                <button
                  type="button"
                  className="icon-btn subtle"
                  title="Delete workflow"
                  disabled={locked}
                  onClick={() => props.onDeleteWorkflow(wf.id)}
                >
                  <Icon name="trash" size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <button type="button" className="btn ghost full" onClick={props.onResetDemo} disabled={locked}>
          <Icon name="reset" size={14} /> Reset demo workflow
        </button>
        <p className="side-hint">Workflows are saved automatically in this browser.</p>
      </section>
    </aside>
  );
}
