import { useRef } from 'react';
import {
  Play,
  Square,
  Undo2,
  Redo2,
  Plus,
  Sparkles,
  Upload,
  Download,
  ShieldCheck,
  Maximize,
  ZoomIn,
  ZoomOut,
  BarChart3,
  HelpCircle,
} from 'lucide-react';
import { actions, useFF } from '../state/store';
import { serializeWorkflow } from '../utils/workflowIO';
import { downloadTextFile } from '../utils/csv';

export function TopBar() {
  const activeId = useFF((s) => s.activeId);
  const wf = useFF((s) => s.workflows.find((w) => w.id === s.activeId) ?? null);
  const executing = useFF((s) => s.executing);
  const inspectorMode = useFF((s) => s.inspectorMode);
  const canUndo = useFF((s) => {
    if (s.pendingSnapshot) return true;
    return !!s.histories[s.activeId!]?.past.length;
  });
  const canRedo = useFF((s) => !!s.histories[s.activeId!]?.future.length);
  const zoomBy = useFF((s) => s.zoomBy);
  const view = useFF((s) => s.view);
  const setInspectorMode = useFF((s) => s.setInspectorMode);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportJson = () => {
    if (!wf) return;
    downloadTextFile(`${wf.name.replace(/[^\w-]+/g, '_')}.flowforge.json`, serializeWorkflow(wf), 'application/json');
    actions.toast('success', 'Workflow exported', 'JSON file downloaded.');
  };

  const importFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      actions.importWorkflow(text);
    };
    reader.readAsText(file);
  };

  return (
    <div className="topbar">
      <div className="brand">
        <svg className="brand-logo" viewBox="0 0 32 32">
          <rect width="32" height="32" rx="7" fill="#171c29" />
          <path d="M9 22V10l6 6 8-8" fill="none" stroke="#4d9fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="9" cy="10" r="2.2" fill="#ff9a3c" />
          <circle cx="23" cy="8" r="2.2" fill="#ff9a3c" />
          <circle cx="15" cy="16" r="2.2" fill="#4d9fff" />
        </svg>
        <div>
          <div className="brand-name">FlowForge Studio</div>
          <div className="brand-sub">visual workflow automation</div>
        </div>
      </div>

      <input
        className="wf-name-input"
        value={wf?.name ?? 'No workflow'}
        disabled={!wf}
        onChange={(e) => wf && actions.renameWorkflow(wf.id, e.target.value)}
        spellCheck={false}
      />

      <div className="tb-group">
        <button className="tb-btn" title="New workflow" onClick={() => actions.createWorkflow()}>
          <Plus size={15} /> New
        </button>
        <button className="tb-btn" title="Load the built-in demo workflow" onClick={() => actions.loadDemo()}>
          <Sparkles size={15} /> Demo
        </button>
        <button className="tb-btn" title="Import workflow from JSON" onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = '';
          }}
        />
        <button className="tb-btn" title="Export workflow as JSON" disabled={!wf} onClick={exportJson}>
          <Download size={15} /> Export
        </button>
      </div>

      <div className="tb-group">
        <button className="tb-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => actions.undo()}>
          <Undo2 size={15} />
        </button>
        <button className="tb-btn" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => actions.redo()}>
          <Redo2 size={15} />
        </button>
        <button className="tb-btn" title="Fit workflow to screen (F)" disabled={!wf || wf.nodes.length === 0} onClick={() => window.dispatchEvent(new CustomEvent('ff:fit'))}>
          <Maximize size={15} /> Fit
        </button>
      </div>

      <div className="tb-group">
        <button className="tb-btn" title="Zoom out" onClick={() => zoomBy(1 / 1.15)}>
          <ZoomOut size={15} />
        </button>
        <button className="tb-btn" title="Zoom in" onClick={() => zoomBy(1.15)}>
          <ZoomIn size={15} />
        </button>
        <div className="tb-status" style={{ width: 46, textAlign: 'center' }}>
          {Math.round(view.k * 100)}%
        </div>
      </div>

      <div className="tb-group">
        <button
          className="tb-btn"
          title="Validate workflow"
          disabled={!wf}
          onClick={() => actions.validateActive()}
        >
          <ShieldCheck size={15} /> Validate
        </button>
        <button
          className="tb-btn"
          title="Analytics dashboard"
          onClick={() => setInspectorMode(inspectorMode === 'analytics' ? 'properties' : 'analytics')}
        >
          <BarChart3 size={15} /> Analytics
        </button>
        <button className="tb-btn" title="Keyboard shortcuts" onClick={() => window.dispatchEvent(new CustomEvent('ff:help'))}>
          <HelpCircle size={15} />
        </button>
      </div>

      <div className="tb-spacer" />

      {executing ? (
        <button className="tb-btn stop" onClick={() => actions.cancelExecution()}>
          <Square size={13} fill="currentColor" /> Stop
        </button>
      ) : (
        <button className="tb-btn run" disabled={!wf || wf.nodes.length === 0} onClick={() => actions.runWorkflow()}>
          <Play size={14} fill="currentColor" /> Run workflow
        </button>
      )}
    </div>
  );
}
