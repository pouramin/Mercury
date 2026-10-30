import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent, DragEvent as ReactDragEvent } from 'react';
import type { NodeRunState, NodeType, PortId, WorkflowDoc, WorkflowNode } from '../types';
import { NODE_DEFS, summarizeNode } from '../engine/nodeDefs';
import { canConnect } from '../engine/graph';
import { newId } from '../utils/ids';
import { Icon } from './Icons';

export const NODE_W = 220;
export const NODE_H = 88;
const GRID = 24;
const SNAP = 8;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const FIT_MIN_ZOOM = 0.12;
export const NODE_DRAG_MIME = 'application/x-flowforge-node';

export interface View {
  x: number;
  y: number;
  zoom: number;
}

export const DEFAULT_VIEW: View = { x: 80, y: 80, zoom: 1 };

/** Port anchor in world coordinates. Inputs sit on the left edge, outputs on the right. */
export function portPosition(node: WorkflowNode, port: PortId): { x: number; y: number } {
  if (port === 'in') return { x: node.x, y: node.y + NODE_H / 2 };
  const outs = NODE_DEFS[node.type].outputs;
  const index = Math.max(0, outs.indexOf(port));
  const offset = outs.length <= 1 ? NODE_H / 2 : NODE_H * (0.34 + 0.38 * index);
  return { x: node.x + NODE_W, y: node.y + offset };
}

export function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = Math.max(30, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

/** View that fits all nodes inside a viewport of the given size. */
export function fitView(nodes: WorkflowNode[], width: number, height: number): View {
  if (nodes.length === 0 || width <= 0 || height <= 0) return DEFAULT_VIEW;
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + NODE_W));
  const maxY = Math.max(...nodes.map((n) => n.y + NODE_H));
  const contentW = maxX - minX + 120;
  const contentH = maxY - minY + 120;
  const zoom = clamp(Math.min(width / contentW, height / contentH), FIT_MIN_ZOOM, 1.25);
  return {
    zoom,
    x: (width - (maxX - minX) * zoom) / 2 - minX * zoom,
    y: (height - (maxY - minY) * zoom) / 2 - minY * zoom,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; sx: number; sy: number; starts: Record<string, { x: number; y: number }>; before: WorkflowDoc; moved: boolean }
  | { kind: 'marquee'; sx: number; sy: number; cx: number; cy: number; additive: boolean; base: string[] }
  | { kind: 'connect'; sourceId: string; sourcePort: PortId };

interface Overlay {
  kind: 'marquee' | 'connect';
  /** Marquee: screen start. Connect: world position of the source port. */
  x0: number;
  y0: number;
  /** Marquee: screen end. Connect: world position of the pointer. */
  x1: number;
  y1: number;
  hoverNode?: string | null;
  /** Connect only: why the hovered port is or is not a valid target. */
  hint?: { text: string; ok: boolean; sx: number; sy: number } | null;
}

export interface CanvasProps {
  doc: WorkflowDoc;
  view: View;
  onViewChange: (view: View) => void;
  selection: string[];
  onSelectionChange: (ids: string[]) => void;
  runStates: Record<string, NodeRunState> | null;
  issues: Record<string, 'error' | 'warning'>;
  locked: boolean;
  snap: boolean;
  onSnapChange: (snap: boolean) => void;
  fitSignal: number;
  onPreview: (doc: WorkflowDoc) => void;
  onCheckpoint: (before: WorkflowDoc) => void;
  onCommit: (doc: WorkflowDoc) => void;
  onAddNode: (type: NodeType, x: number, y: number) => void;
  onHint: (message: string) => void;
}

export function Canvas(props: CanvasProps) {
  const { doc, view, onViewChange, selection, onSelectionChange, runStates, issues, locked, snap, fitSignal } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [panning, setPanning] = useState(false);

  // Fit the graph into view when a workflow is opened or fit is requested.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
    onViewChange(fitView(doc.nodes, el.clientWidth, el.clientHeight));
    // Only re-fit on explicit signals, not on every graph change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  // The first time the canvas has a real size, fit the initial workflow into it.
  const docRef = useRef(doc);
  docRef.current = doc;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let fitted = false;
    const observer = new ResizeObserver(() => {
      if (fitted || el.clientWidth === 0 || el.clientHeight === 0) return;
      fitted = true;
      onViewChangeRef.current(fitView(docRef.current.nodes, el.clientWidth, el.clientHeight));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === 'Space') {
        spaceRef.current = true;
        setPanning(true);
        e.preventDefault();
        return;
      }
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const el = containerRef.current;
        if (el) onViewChange(fitView(doc.nodes, el.clientWidth, el.clientHeight));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        e.preventDefault();
        const el = containerRef.current;
        if (!el) return;
        if (e.key === '0') {
          onViewChange({ ...view, zoom: 1 });
          return;
        }
        const factor = e.key === '-' ? 1 / 1.2 : 1.2;
        zoomAround(el.clientWidth / 2, el.clientHeight / 2, factor);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setPanning(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  });

  const localPoint = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { sx: clientX - (rect?.left ?? 0), sy: clientY - (rect?.top ?? 0) };
  };

  const toWorld = (sx: number, sy: number) => ({ x: (sx - view.x) / view.zoom, y: (sy - view.y) / view.zoom });

  const zoomAround = (sx: number, sy: number, factor: number) => {
    const zoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const k = zoom / view.zoom;
    onViewChange({ zoom, x: sx - (sx - view.x) * k, y: sy - (sy - view.y) * k });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as HTMLElement;
    const { sx, sy } = localPoint(e.clientX, e.clientY);
    containerRef.current?.setPointerCapture(e.pointerId);

    if (e.button === 1 || spaceRef.current) {
      dragRef.current = { kind: 'pan', sx, sy, vx: view.x, vy: view.y };
      setPanning(true);
      return;
    }

    const portOut = target.closest<HTMLElement>('[data-port-out]');
    if (portOut && !locked) {
      const sourceId = portOut.dataset.portOut ?? '';
      const sourcePort = (portOut.dataset.port ?? 'out') as PortId;
      dragRef.current = { kind: 'connect', sourceId, sourcePort };
      const source = doc.nodes.find((n) => n.id === sourceId);
      const anchor = source ? portPosition(source, sourcePort) : toWorld(sx, sy);
      const world = toWorld(sx, sy);
      setOverlay({ kind: 'connect', x0: anchor.x, y0: anchor.y, x1: world.x, y1: world.y, hoverNode: null, hint: null });
      return;
    }

    const nodeEl = target.closest<HTMLElement>('[data-node-id]');
    if (nodeEl) {
      const id = nodeEl.dataset.nodeId ?? '';
      const multi = e.shiftKey || e.ctrlKey || e.metaKey;
      const next = multi
        ? selection.includes(id)
          ? selection.filter((s) => s !== id)
          : [...selection, id]
        : selection.includes(id)
          ? selection
          : [id];
      onSelectionChange(next);
      if (locked || !next.includes(id)) return;
      const starts: Record<string, { x: number; y: number }> = {};
      for (const node of doc.nodes) {
        if (next.includes(node.id)) starts[node.id] = { x: node.x, y: node.y };
      }
      dragRef.current = { kind: 'move', sx, sy, starts, before: doc, moved: false };
      return;
    }

    const edgeEl = target.closest<HTMLElement>('[data-edge-id]');
    if (edgeEl) {
      onSelectionChange([edgeEl.dataset.edgeId ?? '']);
      return;
    }

    const additive = e.shiftKey;
    dragRef.current = { kind: 'marquee', sx, sy, cx: sx, cy: sy, additive, base: additive ? selection : [] };
    if (!additive) onSelectionChange([]);
    setOverlay({ kind: 'marquee', x0: sx, y0: sy, x1: sx, y1: sy });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { sx, sy } = localPoint(e.clientX, e.clientY);

    switch (drag.kind) {
      case 'pan':
        onViewChange({ x: drag.vx + (sx - drag.sx), y: drag.vy + (sy - drag.sy), zoom: view.zoom });
        return;
      case 'move': {
        if (!drag.moved && Math.hypot(sx - drag.sx, sy - drag.sy) < 3) return;
        drag.moved = true;
        const dx = (sx - drag.sx) / view.zoom;
        const dy = (sy - drag.sy) / view.zoom;
        const quantize = (v: number) => (snap ? Math.round(v / SNAP) * SNAP : Math.round(v));
        const nodes = doc.nodes.map((node) => {
          const start = drag.starts[node.id];
          return start ? { ...node, x: quantize(start.x + dx), y: quantize(start.y + dy) } : node;
        });
        props.onPreview({ ...doc, nodes });
        return;
      }
      case 'marquee':
        drag.cx = sx;
        drag.cy = sy;
        setOverlay({ kind: 'marquee', x0: drag.sx, y0: drag.sy, x1: sx, y1: sy });
        return;
      case 'connect': {
        const world = toWorld(sx, sy);
        const source = doc.nodes.find((n) => n.id === drag.sourceId);
        const anchor = source ? portPosition(source, drag.sourcePort) : world;
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const hoverNode = el?.closest<HTMLElement>('[data-port-in]')?.dataset.portIn ?? null;
        const reason = hoverNode ? canConnect(doc, drag.sourceId, drag.sourcePort, hoverNode, 'in') : null;
        setOverlay({
          kind: 'connect',
          x0: anchor.x,
          y0: anchor.y,
          x1: world.x,
          y1: world.y,
          hoverNode,
          hint: hoverNode
            ? { text: reason ?? 'Release to connect', ok: reason === null, sx: sx + 16, sy: sy + 12 }
            : null,
        });
        return;
      }
    }
  };

  const finishPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setPanning(false);
    setOverlay(null);
    containerRef.current?.releasePointerCapture?.(e.pointerId);
    if (!drag) return;

    switch (drag.kind) {
      case 'move':
        if (drag.moved) props.onCheckpoint(drag.before);
        return;
      case 'connect': {
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const targetId = el?.closest<HTMLElement>('[data-port-in]')?.dataset.portIn;
        if (!targetId) return;
        const reason = canConnect(doc, drag.sourceId, drag.sourcePort, targetId, 'in');
        if (reason) {
          props.onHint(reason);
          return;
        }
        props.onCommit({
          ...doc,
          edges: [
            ...doc.edges,
            { id: newId('e'), source: drag.sourceId, sourcePort: drag.sourcePort, target: targetId, targetPort: 'in' },
          ],
        });
        return;
      }
      case 'marquee': {
        const { sx, sy, cx, cy } = drag;
        const moved = Math.hypot(cx - sx, cy - sy) >= 3;
        if (!moved) return;
        const x0 = Math.min(sx, cx);
        const y0 = Math.min(sy, cy);
        const x1 = Math.max(sx, cx);
        const y1 = Math.max(sy, cy);
        const hit = doc.nodes
          .filter((n) => {
            const nx = view.x + n.x * view.zoom;
            const ny = view.y + n.y * view.zoom;
            return nx < x1 && nx + NODE_W * view.zoom > x0 && ny < y1 && ny + NODE_H * view.zoom > y0;
          })
          .map((n) => n.id);
        onSelectionChange(drag.additive ? [...new Set([...drag.base, ...hit])] : hit);
        return;
      }
      case 'pan':
        return;
    }
  };

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    const { sx, sy } = localPoint(e.clientX, e.clientY);
    zoomAround(sx, sy, e.deltaY < 0 ? 1.1 : 1 / 1.1);
  };

  const onDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes(NODE_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    const type = e.dataTransfer.getData(NODE_DRAG_MIME) as NodeType;
    if (!type || !(type in NODE_DEFS)) return;
    e.preventDefault();
    const { sx, sy } = localPoint(e.clientX, e.clientY);
    const world = toWorld(sx, sy);
    const quantize = (v: number) => (snap ? Math.round(v / SNAP) * SNAP : Math.round(v));
    props.onAddNode(type, quantize(world.x - NODE_W / 2), quantize(world.y - NODE_H / 2));
  };

  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const selected = new Set(selection);
  const pendingConnect = overlay?.kind === 'connect' ? overlay : null;
  const cursor = dragRef.current?.kind === 'pan' || panning ? 'grab' : undefined;

  return (
    <div
      ref={containerRef}
      className={`canvas${panning ? ' is-panning' : ''}`}
      style={{
        backgroundPosition: `${view.x}px ${view.y}px`,
        backgroundSize: `${GRID * view.zoom}px ${GRID * view.zoom}px`,
        cursor,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onWheel={onWheel}
      onDragOver={onDragOver}
      onDrop={onDrop}
      role="application"
      aria-label="Workflow canvas"
    >
      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        <svg className="edge-layer" width="1" height="1" aria-hidden="true">
          {doc.edges.map((edge) => {
            const source = byId.get(edge.source);
            const target = byId.get(edge.target);
            if (!source || !target) return null;
            const a = portPosition(source, edge.sourcePort);
            const b = portPosition(target, 'in');
            const d = edgePath(a, b);
            const sourceStatus = runStates?.[edge.source]?.status;
            const targetStatus = runStates?.[edge.target]?.status;
            const flowing = sourceStatus === 'completed' && (targetStatus === 'running' || targetStatus === 'completed');
            const classes = [
              'edge',
              selected.has(edge.id) ? 'selected' : '',
              flowing ? 'flowing' : '',
              sourceStatus === 'completed' ? 'done' : '',
              targetStatus === 'skipped' || sourceStatus === 'skipped' ? 'dim' : '',
              edge.sourcePort === 'true' ? 'edge-true' : edge.sourcePort === 'false' ? 'edge-false' : '',
            ].join(' ');
            return (
              <g key={edge.id} data-edge-id={edge.id}>
                <path className="edge-hit" d={d} />
                <path className={classes} d={d} />
              </g>
            );
          })}
          {pendingConnect && (
            <path
              className={`edge edge-pending${pendingConnect.hint ? (pendingConnect.hint.ok ? ' good' : ' bad') : ''}`}
              d={edgePath({ x: pendingConnect.x0, y: pendingConnect.y0 }, { x: pendingConnect.x1, y: pendingConnect.y1 })}
            />
          )}
        </svg>

        {doc.nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            selected={selected.has(node.id)}
            state={runStates?.[node.id]}
            issue={issues[node.id]}
          />
        ))}
      </div>

      {overlay?.kind === 'marquee' && (
        <div
          className="marquee"
          style={{
            left: Math.min(overlay.x0, overlay.x1),
            top: Math.min(overlay.y0, overlay.y1),
            width: Math.abs(overlay.x1 - overlay.x0),
            height: Math.abs(overlay.y1 - overlay.y0),
          }}
        />
      )}

      {pendingConnect?.hint && (
        <div
          className={`connect-hint${pendingConnect.hint.ok ? ' ok' : ' bad'}`}
          style={{ left: pendingConnect.hint.sx, top: pendingConnect.hint.sy }}
        >
          {pendingConnect.hint.text}
        </div>
      )}

      {doc.nodes.length === 0 && (
        <div className="canvas-empty">
          <Icon name="workflow" size={36} />
          <h3>This workflow is empty</h3>
          <p>Drag a node from the library onto the canvas, or start with a Start node.</p>
        </div>
      )}

      <CanvasControls view={view} onZoom={(factor) => zoomAround((containerRef.current?.clientWidth ?? 0) / 2, (containerRef.current?.clientHeight ?? 0) / 2, factor)} onFit={() => {
        const el = containerRef.current;
        if (el) onViewChange(fitView(doc.nodes, el.clientWidth, el.clientHeight));
      }} snap={snap} onSnap={props.onSnapChange} />
    </div>
  );
}

function CanvasControls({
  view,
  onZoom,
  onFit,
  snap,
  onSnap,
}: {
  view: View;
  onZoom: (factor: number) => void;
  onFit: () => void;
  snap: boolean;
  onSnap: (snap: boolean) => void;
}) {
  return (
    <div className="canvas-controls" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <button type="button" className="icon-btn" title="Zoom out (Ctrl+-)" onClick={() => onZoom(1 / 1.2)}>
        <Icon name="zoomOut" />
      </button>
      <span className="zoom-readout" title="Current zoom">{Math.round(view.zoom * 100)}%</span>
      <button type="button" className="icon-btn" title="Zoom in (Ctrl+=)" onClick={() => onZoom(1.2)}>
        <Icon name="zoomIn" />
      </button>
      <button type="button" className="icon-btn" title="Fit to screen (F)" onClick={onFit}>
        <Icon name="fit" />
      </button>
      <button
        type="button"
        className={`icon-btn${snap ? ' active' : ''}`}
        title="Snap nodes to grid"
        aria-pressed={snap}
        onClick={() => onSnap(!snap)}
      >
        <Icon name="magnet" />
      </button>
    </div>
  );
}

const STATUS_LABEL = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
} as const;

function NodeCard({
  node,
  selected,
  state,
  issue,
}: {
  node: WorkflowNode;
  selected: boolean;
  state: NodeRunState | undefined;
  issue: 'error' | 'warning' | undefined;
}) {
  const def = NODE_DEFS[node.type];
  const status = state?.status ?? 'pending';
  const body = state && state.message && status !== 'pending' ? state.message : summarizeNode(node);
  const classes = ['node', `node-${node.type}`, `status-${status}`, selected ? 'selected' : '', issue ? `issue-${issue}` : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      data-node-id={node.id}
      style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
      title={`${def.label}: ${def.description}`}
    >
      <div className="node-header">
        <span className={`node-icon node-icon-${node.type}`}>
          <Icon name={node.type} size={14} />
        </span>
        <span className="node-title">{node.name}</span>
        {issue && <span className={`issue-dot issue-${issue}`} title={issue === 'error' ? 'Has errors' : 'Has warnings'} />}
        <span className={`status-pill status-${status}`}>{STATUS_LABEL[status]}</span>
      </div>
      <div className="node-body" title={body}>
        {body}
      </div>
      {def.hasInput && (
        <div
          className="port port-in"
          data-port-in={node.id}
          title="Input: connect a predecessor here"
          style={{ top: NODE_H / 2 - 7 }}
        />
      )}
      {def.outputs.map((port) => {
        const offsetY = portPosition(node, port).y - node.y;
        const label = port === 'true' ? 'True' : port === 'false' ? 'False' : '';
        return (
          <div
            key={port}
            className={`port port-out port-${port}`}
            data-port-out={node.id}
            data-port={port}
            title={label ? `${label} output` : 'Output: drag to another node'}
            style={{ top: offsetY - 7 }}
          >
            {label && <span className="port-label">{label[0]}</span>}
          </div>
        );
      })}
    </div>
  );
}
