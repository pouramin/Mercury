import { useState } from 'react';
import {
  Play,
  Database,
  Filter,
  Wand2,
  Split,
  Clock,
  Table2,
  Copy,
  Trash2,
  Plus,
  ChevronsLeft,
  ChevronsRight,
  RotateCcw,
  FileJson,
  Settings2,
} from 'lucide-react';
import { actions, useFF } from '../state/store';
import { NODE_COLOR, NODE_LABEL, NODE_ICON } from '../engine/graph';
import type { NodeType } from '../types';

const PALETTE: Array<{ type: NodeType; desc: string }> = [
  { type: 'start', desc: 'Entry point of a run' },
  { type: 'dataSource', desc: 'Generate or paste JSON records' },
  { type: 'filter', desc: 'Keep records matching conditions' },
  { type: 'transform', desc: 'Rename, set or calculate fields' },
  { type: 'condition', desc: 'Route to True / False branches' },
  { type: 'delay', desc: 'Pause execution for a duration' },
  { type: 'output', desc: 'Table + JSON viewer of results' },
];

const ICONS: Record<string, typeof Play> = {
  start: Play,
  dataSource: Database,
  filter: Filter,
  transform: Wand2,
  condition: Split,
  delay: Clock,
  output: Table2,
};

export function Rail() {
  const wfListOpen = useFF((s) => s.wfListOpen);
  const paletteOpen = useFF((s) => s.paletteOpen);
  const toggleWfList = useFF((s) => s.toggleWfList);
  const togglePalette = useFF((s) => s.togglePalette);
  const workflows = useFF((s) => s.workflows);
  const activeId = useFF((s) => s.activeId);
  const [dragging, setDragging] = useState<string | null>(null);

  const wfCount = workflows.length;
  const maxWf = Math.max(0, wfCount - 3);

  return (
    <div className={`leftrail${!wfListOpen && !paletteOpen ? ' collapsed' : ''}`}>
      {wfListOpen || paletteOpen ? (
        <>
          <div className="rail-header">
            <Settings2 size={13} />
            Workflows
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
              <button className="mini-btn" title="New workflow" onClick={() => actions.createWorkflow()}>
                <Plus size={14} />
              </button>
              <button className="mini-btn" title="Collapse rail" onClick={toggleWfList}>
                <ChevronsLeft size={14} />
              </button>
            </span>
          </div>

          {wfListOpen ? (
            <div className="rail-scroll" style={{ maxHeight: 220 }}>
              {workflows.map((wf) => (
                <div
                  key={wf.id}
                  className={`wf-item${wf.id === activeId ? ' active' : ''}`}
                  onClick={() => actions.selectWorkflow(wf.id)}
                >
                  <div className="wf-item-icon">
                    <FileJson size={15} />
                  </div>
                  <div className="wf-item-meta">
                    <div className="wf-item-name">{wf.name}</div>
                    <div className="wf-item-sub">
                      {wf.nodes.length} nodes · {new Date(wf.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div className="wf-item-actions">
                    <button className="mini-btn" title="Duplicate workflow" onClick={(e) => { e.stopPropagation(); actions.duplicateWorkflow(wf.id); }}>
                      <Copy size={13} />
                    </button>
                    <button className="mini-btn danger" title="Delete workflow" onClick={(e) => { e.stopPropagation(); actions.deleteWorkflow(wf.id); }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {maxWf > 0 ? <div className="hint" style={{ padding: '4px 6px' }}>+{maxWf} more saved locally</div> : null}
            </div>
          ) : (
            <div style={{ padding: '2px 10px' }}>
              <button className="btn ghost sm" onClick={toggleWfList} style={{ width: '100%' }}>
                <Settings2 size={13} /> Show workflows
              </button>
            </div>
          )}

          <div className="rail-header" style={{ marginTop: 4 }}>
            <Plus size={13} />
            Node palette
            <span style={{ marginLeft: 'auto' }}>
              <button className="mini-btn" title={paletteOpen ? 'Collapse palette' : 'Expand palette'} onClick={togglePalette}>
                {paletteOpen ? <ChevronsLeft size={14} /> : <ChevronsRight size={14} />}
              </button>
            </span>
          </div>

          {paletteOpen ? (
            <div className="rail-scroll">
              {PALETTE.map((item) => {
                const Icon = ICONS[item.type];
                const color = NODE_COLOR[item.type];
                return (
                  <div
                    key={item.type}
                    className={`palette-item${dragging === item.type ? ' dragging' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      setDragging(item.type);
                      e.dataTransfer.setData('application/x-flowforge-node', item.type);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onDragEnd={() => setDragging(null)}
                  >
                    <div className="palette-icon" style={{ background: color }}>
                      <Icon size={16} strokeWidth={2.5} />
                    </div>
                    <div>
                      <div className="palette-name">{NODE_LABEL[item.type]}</div>
                      <div className="palette-desc">{item.desc}</div>
                    </div>
                  </div>
                );
              })}

              <div className="divider" />
              <button className="btn ghost sm" style={{ width: '100%', marginBottom: 8 }} onClick={() => actions.loadDemo()}>
                <RotateCcw size={13} /> Reset demo workflow
              </button>
              <div className="hint" style={{ padding: '0 4px' }}>
                Drag a block onto the canvas, then connect ports (drag from an output port to an input port).
              </div>
            </div>
          ) : (
            <div style={{ padding: '2px 10px' }}>
              <button className="btn ghost sm" onClick={togglePalette} style={{ width: '100%' }}>
                <Plus size={13} /> Show palette
              </button>
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="mini-btn" title="Expand rail" onClick={toggleWfList}>
            <ChevronsRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
