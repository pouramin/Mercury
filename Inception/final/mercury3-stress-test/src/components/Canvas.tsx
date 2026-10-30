import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFF } from '../state/store';
import type { Pos, WorkflowNode, ViewTransform } from '../types';
import { NODE_SIZE, portAnchor } from '../engine/graph';
import { NodeView } from './NodeView';

// ---------------------------------------------------------------------------
// Canvas: pan / zoom / marquee / drag / wiring / drop target
// ---------------------------------------------------------------------------

interface WireState {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function intersectRect(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function Canvas() {
  const wf = useFF((s) => s.workflows.find((w) => w.id === s.activeId) ?? null);
  const view = useFF((s) => s.view);
  const setView = useFF((s) => s.setView);
  const zoomBy = useFF((s) => s.zoomBy);
  const selectedIds = useFF((s) => s.selectedIds);
  const selectMany = useFF((s) => s.selectMany);
  const clearSelection = useFF((s) => s.clearSelection);
  const executing = useFF((s) => s.executing);
  const live = useFF((s) => s.live);
  const execution = useFF((s) => s.execution);

  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: 'none' | 'node' | 'marquee' | 'pan';
    startClient: Pos;
    startWorld: Pos;
    startView: ViewTransform;
    nodeIds: string[];
    basePos: Map<string, Pos>;
  }>({ mode: 'none', startClient: { x: 0, y: 0 }, startWorld: { x: 0, y: 0 }, startView: { x: 0, y: 0, k: 1 }, nodeIds: [], basePos: new Map() });
  const wiringRef = useRef<{ nodeId: string; portId: string } | null>(null);
  const spaceRef = useRef(false);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [wire, setWire] = useState<WireState | null>(null);

  const nodes = wf?.nodes ?? [];
  const edges = wf?.edges ?? [];

  const statusMap = executing && live ? live.nodeStates : execution?.nodeStates ?? {};

  const toWorld = useCallback(
    (clientX: number, clientY: number): Pos => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return { x: clientX, y: clientY };
      return {
        x: (clientX - rect.left - view.x) / view.k,
        y: (clientY - rect.top - view.y) / view.k,
      };
    },
    [view],
  );

  const maybeFinishWiring = useCallback(
    (clientX: number, clientY: number) => {
      const wiring = wiringRef.current;
      if (!wiring) return;
      const els = document.elementsFromPoint(clientX, clientY);
      let target: { node: string; port: string } | null = null;
      for (const el of els) {
        const port = (el as HTMLElement).dataset.port;
        const kind = (el as HTMLElement).dataset.kind;
        const node = (el as HTMLElement).dataset.node;
        if (port && kind === 'input' && node) {
          target = { node, port };
          break;
        }
      }
      if (target) {
        const res = useFF.getState().connectEdge(wiring.nodeId, wiring.portId, target.node, target.port);
        if (!res.ok) {
          useFF.getState().toast('warning', 'Connection not allowed', res.reason);
        }
      }
      wiringRef.current = null;
      setWire(null);
    },
    [],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        zoomBy(factor, { x: cx, y: cy });
      } else {
        const s = useFF.getState();
        s.setView({ x: s.view.x - e.deltaX, y: s.view.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  useEffect(() => {
    const onCancel = () => {
      wiringRef.current = null;
      setWire(null);
    };
    window.addEventListener('ff:cancel-wiring', onCancel);
    return () => window.removeEventListener('ff:cancel-wiring', onCancel);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || spaceRef.current) {
      // pan
      dragRef.current = {
        mode: 'pan',
        startClient: { x: e.clientX, y: e.clientY },
        startWorld: { x: 0, y: 0 },
        startView: { ...view },
        nodeIds: [],
        basePos: new Map(),
      };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    // marquee
    const world = toWorld(e.clientX, e.clientY);
    dragRef.current = {
      mode: 'marquee',
      startClient: { x: e.clientX, y: e.clientY },
      startWorld: world,
      startView: { ...view },
      nodeIds: [],
      basePos: new Map(),
    };
    setMarquee({ x1: world.x, y1: world.y, x2: world.x, y2: world.y });
  };

  const onWindowMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (d.mode === 'pan') {
      const s = useFF.getState();
      s.setView({
        x: d.startView.x + (e.clientX - d.startClient.x),
        y: d.startView.y + (e.clientY - d.startClient.y),
      });
      return;
    }
    if (d.mode === 'marquee') {
      const world = toWorld(e.clientX, e.clientY);
      setMarquee({ x1: d.startWorld.x, y1: d.startWorld.y, x2: world.x, y2: world.y });
      return;
    }
    if (d.mode === 'node') {
      const world = toWorld(e.clientX, e.clientY);
      const dx = world.x - d.startWorld.x;
      const dy = world.y - d.startWorld.y;
      for (const id of d.nodeIds) {
        const base = d.basePos.get(id);
        if (base) {
          useFF.getState().updateNodePosition(id, { x: base.x + dx, y: base.y + dy });
        }
      }
      return;
    }
    if (wiringRef.current) {
      const world = toWorld(e.clientX, e.clientY);
      const src = wiringRef.current;
      const srcNode = nodes.find((n) => n.id === src.nodeId);
      if (srcNode) {
        const anchor = portAnchor(srcNode, src.portId, 'output');
        setWire({ x1: anchor.x, y1: anchor.y, x2: world.x, y2: world.y });
      }
    }
  };

  const onWindowUp = (e: PointerEvent) => {
    const d = dragRef.current;
    if (d.mode === 'marquee') {
      const box = marquee;
      if (box) {
        const x1 = Math.min(box.x1, box.x2);
        const y1 = Math.min(box.y1, box.y2);
        const x2 = Math.max(box.x1, box.x2);
        const y2 = Math.max(box.y1, box.y2);
        const moved = Math.abs(e.clientX - d.startClient.x) + Math.abs(e.clientY - d.startClient.y);
        if (moved < 4) {
          clearSelection();
        } else {
          const hit = nodes.filter((n) => {
            const { w, h } = NODE_SIZE[n.type];
            return intersectRect(x1, y1, x2 - x1, y2 - y1, n.position.x, n.position.y, w, h);
          });
          selectMany(hit.map((n) => n.id));
        }
      }
      setMarquee(null);
      dragRef.current.mode = 'none';
      return;
    }
    if (d.mode === 'node') {
      useFF.getState().endNodeDrag();
      dragRef.current.mode = 'none';
      return;
    }
    if (wiringRef.current) {
      maybeFinishWiring(e.clientX, e.clientY);
    }
    dragRef.current.mode = 'none';
  };

  useEffect(() => {
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
    return () => {
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
    };
  });

  const onNodePointerDown = (e: React.PointerEvent, node: WorkflowNode) => {
    if (wiringRef.current) return; // ports handled separately
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const s = useFF.getState();
    const ids = s.selectedIds.includes(node.id) && s.selectedIds.length > 0 ? s.selectedIds : [node.id];
    if (!s.selectedIds.includes(node.id)) {
      s.selectSingle(node.id, false);
    }
    s.beginNodeDrag();
    const world = toWorld(e.clientX, e.clientY);
    const basePos = new Map<string, Pos>();
    for (const id of ids) {
      const n = nodes.find((x) => x.id === id);
      if (n) basePos.set(id, { ...n.position });
    }
    dragRef.current = {
      mode: 'node',
      startClient: { x: e.clientX, y: e.clientY },
      startWorld: world,
      startView: { ...view },
      nodeIds: ids,
      basePos,
    };
  };

  const onPortPointerDown = (e: React.PointerEvent, node: WorkflowNode, portId: string, kind: 'input' | 'output') => {
    e.stopPropagation();
    e.preventDefault();
    if (kind === 'output') {
      wiringRef.current = { nodeId: node.id, portId };
      const anchor = portAnchor(node, portId, 'output');
      setWire({ x1: anchor.x, y1: anchor.y, x2: anchor.x, y2: anchor.y });
    } else if (wiringRef.current) {
      // completing a connection on pointerdown on input port
      const src = wiringRef.current;
      const res = useFF.getState().connectEdge(src.nodeId, src.portId, node.id, portId);
      if (!res.ok) {
        useFF.getState().toast('warning', 'Connection not allowed', res.reason);
      }
      wiringRef.current = null;
      setWire(null);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/x-flowforge-node');
    if (!type) return;
    const world = toWorld(e.clientX, e.clientY);
    useFF.getState().addNode(type as WorkflowNode['type'], { x: world.x - 100, y: world.y - 40 });
  };

  const paths = useMemo(
    () =>
      edges.map((edge) => {
        const src = nodes.find((n) => n.id === edge.source);
        const dst = nodes.find((n) => n.id === edge.target);
        if (!src || !dst) return null;
        const a = portAnchor(src, edge.sourcePort, 'output');
        const b = portAnchor(dst, edge.targetPort, 'input');
        const dx = Math.max(36, Math.abs(b.x - a.x) * 0.45);
        const d = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
        const st = statusMap[edge.source];
        let cls = 'wf-edge';
        let marker = 'wf-edge-marker';
        if (executing) {
          if (st?.status === 'completed') {
            cls += ' flowing';
            marker += ' flowing';
          } else if (st?.status === 'running') {
            cls += ' flowing';
            marker += ' flowing';
          }
        } else if (st?.status === 'completed' && !executing) {
          cls += ' done';
          marker += ' done';
        }
        const selected = (useFF.getState() as { selectedIds: string[] }).selectedIds.includes(edge.id);
        if (selected) {
          cls += ' selected';
          marker += ' selected';
        }
        return { edge, d, cls, marker, a, b };
      }),
    [edges, nodes, statusMap, executing],
  );

  const wiringActive = wiringRef.current !== null;

  return (
    <div
      ref={wrapRef}
      className="canvas-wrap"
      onPointerDown={onPointerDown}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* grid background */}
      <div className="canvas-view" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="canvas-grid" width="4000" height="4000" style={{ left: -2000, top: -2000 }}>
          <defs>
            <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="1.4" cy="1.4" r="1.4" fill="#1c2130" />
            </pattern>
          </defs>
          <rect width="4000" height="4000" fill="url(#dots)" />
        </svg>

        {/* edges */}
        <svg className="canvas-svg edge-layer" width="4000" height="4000" style={{ left: -2000, top: -2000 }}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="wf-edge-marker" />
            </marker>
          </defs>
          {paths.map((p) =>
            p ? (
              <path
                key={p.edge.id}
                d={p.d}
                className={p.cls}
                markerEnd="url(#arrow)"
                style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  const s = useFF.getState();
                  const additive = ev.shiftKey;
                  const ids = additive
                    ? s.selectedIds.includes(p.edge.id)
                      ? s.selectedIds.filter((x) => x !== p.edge.id)
                      : [...s.selectedIds, p.edge.id]
                    : [p.edge.id];
                  useFF.setState({ selectedIds: ids });
                }}
              />
            ) : null,
          )}
          {wire && !wiringActive ? null : wire ? (
            <path d={`M ${wire.x1} ${wire.y1} C ${wire.x1 + 70} ${wire.y1}, ${wire.x2 - 70} ${wire.y2}, ${wire.x2} ${wire.y2}`} className="wf-edge flowing" />
          ) : null}
        </svg>

        {/* nodes */}
        {nodes.map((n) => (
          <NodeView
            key={n.id}
            node={n}
            selected={selectedIds.includes(n.id)}
            status={statusMap[n.id]}
            executing={executing}
            wiringActive={wiringActive}
            onBodyPointerDown={onNodePointerDown}
            onPortPointerDown={onPortPointerDown}
          />
        ))}

        {/* marquee */}
        {marquee ? (
          <div
            className="marquee"
            style={{
              left: Math.min(marquee.x1, marquee.x2),
              top: Math.min(marquee.y1, marquee.y2),
              width: Math.abs(marquee.x2 - marquee.x1),
              height: Math.abs(marquee.y2 - marquee.y1),
            }}
          />
        ) : null}
      </div>

      {nodes.length === 0 ? (
        <div className="empty-state">
          <div className="es-icon">
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
              <path d="M9 22V10l6 6 8-8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h3>Your canvas is empty</h3>
          <p>
            Drag node blocks from the palette on the left onto this canvas, then connect them to build a workflow.
          </p>
          <button className="btn primary" style={{ pointerEvents: 'auto' }} onClick={() => useFF.getState().loadDemo()}>
            Load the e-commerce demo
          </button>
        </div>
      ) : null}
    </div>
  );
}
