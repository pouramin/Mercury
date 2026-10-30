# FlowForge Studio

A professional, local-first, visual workflow automation platform built with **React + TypeScript + Vite**. No backend, no authentication, no external APIs — everything runs in the browser and persists to `localStorage`.

## Quick start

```bash
npm install
npm run dev          # start dev server → http://localhost:5173
```

Other scripts:

```bash
npm run typecheck    # TypeScript compiler (tsc --noEmit)
npm test             # Vitest test suite
npm run build        # type-check + production build (dist/)
npm run preview      # serve the production build
```

## What ships in the box

- **Visual workflow editor** — drag-and-drop node creation from a palette, drag repositioning, port-to-port wiring with curved SVG bezier edges, pan (Space+drag / wheel), zoom (Ctrl+wheel), box selection, multi-select, delete/duplicate, undo/redo, grid background, fit-to-screen (F), node inspector, workflow validation.
- **Seven functional node types** — START, DATA SOURCE (deterministic generator or pasted JSON), FILTER (AND/OR condition groups), TRANSFORM (rename / set constant / calculate with a safe expression language / remove), CONDITION (True/False routing), DELAY (cancellable), OUTPUT (interactive table + JSON viewer + CSV export).
- **Real execution engine** — directed graph validation, topological ordering, cycle detection, deterministic seeded execution, async nodes, cancellation, error propagation, per-node status (pending/running/completed/failed/skipped), timestamps, node-by-node history timeline, and animated execution.
- **Built-in demo** — E-commerce order processing: generates 300 deterministic orders, filters them, computes totals, splits high-value vs regular orders, and displays both result datasets plus statistics.
- **Analytics dashboard** — total input records, processed, filtered, branch distribution, execution time, per-node processing time, errors, and visual execution history — all derived from real execution results.
- **Save / load / export** — automatic local persistence, multiple named workflows, validated JSON import, JSON export, CSV export of any output dataset, demo reset.

## Safety

User-defined transform formulas are evaluated with a purpose-built lexer/parser/interpreter (`src/engine/evaluator.ts`) — **never `eval()` or `new Function()`**.

## Project layout

```
src/
  engine/        graph model, nodes, evaluator, condition matcher, executor, demo workflow
  state/         zustand store (history, persistence, execution orchestration)
  components/    TopBar, Rail, Canvas, NodeView, Inspector, Analytics, editors, toasts
  utils/         workflow JSON I/O, CSV export
tests/           Vitest suites: graph, execution, serialization
```

## Tests

36 tests cover: topological ordering, cycle detection, invalid connection rejection, filtering accuracy, transformation accuracy, conditional branching, empty datasets, missing fields, invalid configs, multi-branch merge, determinism, large datasets, cancellation, workflow JSON serialization, malformed import rejection, and CSV escaping.
