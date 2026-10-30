import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Minus, Maximize, X } from 'lucide-react';
import { TopBar } from './components/TopBar';
import { Rail } from './components/Rail';
import { Canvas } from './components/Canvas';
import { PropertiesPanel } from './components/PropertiesPanel';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { Toasts } from './components/Toasts';
import { actions, useFF } from './state/store';

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export default function App() {
  const wf = useFF((s) => s.workflows.find((w) => w.id === s.activeId) ?? null);
  const selectedIds = useFF((s) => s.selectedIds);
  const inspectorMode = useFF((s) => s.inspectorMode);
  const zoomBy = useFF((s) => s.zoomBy);
  const setFit = useFF((s) => s.setFit);
  const view = useFF((s) => s.view);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const clipboardRef = useRef<string[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);

  const fitToScreen = useCallback(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap || !wf || wf.nodes.length === 0) return;
    const rect = wrap.getBoundingClientRect();
    const vw = rect.width;
    const vh = rect.height;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of wf.nodes) {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + 260);
      maxY = Math.max(maxY, n.position.y + 200);
    }
    const pad = 90;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    const k = Math.min(1.2, Math.max(0.25, Math.min(vw / w, vh / h)));
    setFit({
      k,
      x: -minX * k + (vw - (maxX - minX) * k) / 2,
      y: -minY * k + (vh - (maxY - minY) * k) / 2,
    });
  }, [wf, setFit]);

  useEffect(() => {
    const onFit = () => fitToScreen();
    window.addEventListener('ff:fit', onFit);
    return () => window.removeEventListener('ff:fit', onFit);
  }, [fitToScreen]);

  useEffect(() => {
    const onHelp = () => setHelpOpen(true);
    window.addEventListener('ff:help', onHelp);
    return () => window.removeEventListener('ff:help', onHelp);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        actions.toast('info', 'Saved', 'Workflow persisted locally.');
        return;
      }
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        actions.undo();
        return;
      }
      if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        actions.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (selectedIds.length) actions.duplicateNodes(selectedIds);
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') {
        clipboardRef.current = selectedIds;
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        if (clipboardRef.current.length) actions.duplicateNodes(clipboardRef.current);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedIds.length) return;
        e.preventDefault();
        const nodeIds = selectedIds.filter((id) => wf?.nodes.some((n) => n.id === id));
        const edgeIds = selectedIds.filter((id) => wf?.edges.some((en) => en.id === id));
        for (const edgeId of edgeIds) actions.disconnectEdge(edgeId);
        if (nodeIds.length) actions.removeNodes(nodeIds);
        return;
      }
      if (e.key === 'Escape') {
        actions.clearSelection();
        window.dispatchEvent(new CustomEvent('ff:cancel-wiring'));
        return;
      }
      if (e.key.toLowerCase() === 'f' && !mod) {
        fitToScreen();
        return;
      }
      if (e.key === '+' || e.key === '=') {
        zoomBy(1.15);
        return;
      }
      if (e.key === '-') {
        zoomBy(1 / 1.15);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedIds, wf, fitToScreen, zoomBy]);

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        <Rail />
        <div ref={canvasWrapRef} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <Canvas />

          {/* in-canvas zoom controls */}
          <div className="zoom-controls">
            <button className="zoom-btn" title="Zoom in" onClick={() => zoomBy(1.15)}>
              <Plus size={16} />
            </button>
            <div className="zoom-label">{Math.round(view.k * 100)}%</div>
            <button className="zoom-btn" title="Zoom out" onClick={() => zoomBy(1 / 1.15)}>
              <Minus size={16} />
            </button>
            <button className="zoom-btn" title="Fit to screen (F)" onClick={fitToScreen} disabled={!wf || wf.nodes.length === 0}>
              <Maximize size={15} />
            </button>
          </div>

          <div className="canvas-hint">
            <span>Drag from palette to add nodes</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>
              <kbd>Space</kbd> + drag to pan
            </span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>
              <kbd>Ctrl</kbd> + <kbd>wheel</kbd> zoom
            </span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>drag output port → input port to connect</span>
          </div>
        </div>

        <div className="rightrail">
          <div className="insp-tabs">
            <button
              className={`insp-tab${inspectorMode === 'properties' ? ' active' : ''}`}
              onClick={() => actions.setInspectorMode('properties')}
            >
              Properties
            </button>
            <button
              className={`insp-tab${inspectorMode === 'analytics' ? ' active' : ''}`}
              onClick={() => actions.setInspectorMode('analytics')}
            >
              Analytics
            </button>
          </div>
          {inspectorMode === 'properties' ? <PropertiesPanel /> : <AnalyticsPanel />}
        </div>
      </div>

      <Toasts />

      {helpOpen ? (
        <div className="help-overlay" onClick={() => setHelpOpen(false)}>
          <div className="help-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <h3>Keyboard shortcuts</h3>
              <button className="mini-btn" style={{ marginLeft: 'auto' }} onClick={() => setHelpOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="help-grid">
              <div className="help-item"><span>Pan canvas</span><kbd>Space + drag</kbd></div>
              <div className="help-item"><span>Zoom</span><kbd>Ctrl + wheel</kbd></div>
              <div className="help-item"><span>Fit to screen</span><kbd>F</kbd></div>
              <div className="help-item"><span>Undo / Redo</span><kbd>Ctrl+Z / Ctrl+Y</kbd></div>
              <div className="help-item"><span>Duplicate selection</span><kbd>Ctrl+D</kbd></div>
              <div className="help-item"><span>Copy / Paste</span><kbd>Ctrl+C / Ctrl+V</kbd></div>
              <div className="help-item"><span>Delete selection</span><kbd>Delete</kbd></div>
              <div className="help-item"><span>Add to selection</span><kbd>Shift + click</kbd></div>
              <div className="help-item"><span>Box select</span><kbd>Drag empty canvas</kbd></div>
              <div className="help-item"><span>Cancel wiring</span><kbd>Esc</kbd></div>
              <div className="help-item"><span>Run workflow</span><kbd>Run button</kbd></div>
              <div className="help-item"><span>Save (automatic)</span><kbd>Ctrl+S</kbd></div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
