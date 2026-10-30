# FlowForge Studio

A local-first visual workflow automation studio. Build workflows by dragging nodes onto a canvas,
connect them, configure each node, and run the workflow against real (generated or imported) data.
No backend, no accounts, no external APIs. Workflows persist automatically in the browser.

## Quick start

Requires Node.js 18 or newer.

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

Other scripts:

```bash
npm test             # automated engine tests (Vitest)
npm run typecheck    # TypeScript compiler, no emit
npm run build        # typecheck + production bundle in dist/
npm run preview      # serve dist/ at http://127.0.0.1:4173
```

## What you can do

- **Canvas**: drag nodes from the library (or click to add), move and multi-select them (Shift-click
  or rubber-band), connect ports with curved SVG edges, zoom at the cursor, pan (Space+drag or middle
  mouse), snap to an 8 px grid, and fit the workflow to the screen (`F`).
- **Editing**: duplicate, copy/paste, delete, nudge with arrow keys, undo/redo for every graph edit.
  Invalid connections are rejected with a reason (self-loop, wrong port, duplicate, would create a cycle).
- **Nodes**: Start, Data Source, Filter, Transform, Condition (True/False), Delay, Output.
- **Execution**: per-node status (Pending, Running, Completed, Failed, Skipped), timestamps, durations,
  node-by-node log, error propagation, cancellation, and animated edges while running.
- **Analytics** (bottom panel, collapsible): input/processed/filtered counts, branch distribution,
  per-node processing time, execution timeline, workflow errors, and history of recent runs.
- **Output**: searchable, sortable table and JSON viewer per Output node; export to CSV.
- **Workflows**: several named workflows, JSON import (strictly validated) and export, reset demo.

## Built-in demo

"Order Processing (Demo)" generates 300 deterministic e-commerce orders (seed 20250), filters out
cancelled and returned orders, computes `orderTotal = round(quantity * unitPrice, 2)`, routes orders
at or above 250 to a priority-queue Delay and then a High-Value output, and sends the rest to a
Regular output. Edit any node setting and run again; the results and analytics recompute.

## Architecture

```
src/
  engine/        Pure TypeScript, no React. Fully unit-tested.
    graph.ts        adjacency, Kahn topological order, cycle detection, reachability,
                    connection rules, whole-workflow validation
    executor.ts     async runner: dependency-ordered execution, AbortSignal cancellation,
                    per-node state, failure propagation, progress callbacks
    expression.ts   tokenizer + recursive-descent parser + interpreter for arithmetic
                    (no eval, no Function constructor; whitelisted functions only)
    conditions.ts   filter/condition operators compiled to predicates
    transform.ts    rename / compute / set / remove / case operations (pure, never mutate input)
    configValidation.ts  runtime validation of every node's configuration
    serialization.ts     workflow JSON export and strict import validation
    sampleOrders.ts  seeded PRNG (mulberry32) and deterministic order generator
    analytics.ts    metrics computed from an ExecutionResult
    csv.ts, demo.ts, nodeDefs.ts
  state/store.ts  reducer with undo/redo history, named workflows, localStorage persistence
  components/     Canvas, Sidebar (library + workflows), Inspector (config + validation),
                  BottomPanel (analytics, output, log), Icons
  App.tsx         wiring, keyboard shortcuts, run orchestration
tests/            Vitest suites for graph, expressions/transforms, executor, serialization
```

Key decisions:

- **Execution model**: a node runs when at least one upstream edge delivered output from a completed
  node. Otherwise it is skipped with the reason. A failed node therefore skips its descendants while
  independent branches keep running. Condition nodes publish separate True and False outputs.
- **Determinism**: topological order breaks ties by node id; the data generator uses a seeded PRNG.
  Two runs of the same workflow produce identical outputs (covered by a test).
- **Safety**: user expressions are parsed into an AST and interpreted; field lookup uses own-property
  checks so names like `constructor` cannot reach prototypes. Imported files are validated field by
  field before any of their data is used.
- **Structural vs. node errors**: cycles, a missing or duplicate Start node and similar problems block
  the run and are reported. A bad setting (for example a non-numeric threshold) fails only that node,
  and the failure shows in the log and propagates downstream.
- **Persistence**: the full workflow graph and per-workflow run summaries are saved to
  `localStorage` (key `flowforge-studio.v1`) on every change, debounced. Execution result tables are
  kept in memory for the current session only.

## Verification

Engine tests (`npm test`) cover: topological ordering, cycle detection and reporting, rejected
connections, reachability and disconnected nodes, expression precedence/functions/errors, condition
operators, transform accuracy, missing-field handling, the demo's branch datasets checked against an
independent reference implementation, threshold changes altering results, empty datasets, large
datasets, conditional routing, error propagation, circular workflows refusing to run, cancellation
during a delay, pre-aborted runs, JSON round-trip, malformed-import rejection, and CSV escaping.

## Known limitations

- Cancellation is checked between nodes and while a Delay is waiting. A single synchronous step over a
  very large dataset (for example 100k records in one Transform) runs to completion before the cancel
  takes effect.
- The Data Source node generates or loads records; it does not take records from upstream nodes.
- Output tables show at most `maxRows` rows (default 500) with pagination; the JSON viewer previews
  the first 200 rows. CSV export contains every record that reached the Output node.
- Browser storage is limited (about 5 MB in most browsers). If the browser refuses a save (for example
  when storage is full), the app keeps working in memory and that save is skipped without a message.
- Multiple incoming edges into one node are merged in edge-creation order; there is no join or
  multi-input merge node.
- The UI layout is designed for desktop widths (minimum 960 px).
