# FlowForge Studio

Local-first visual workflow editor built with React, TypeScript, and Vite.

## Run

Install dependencies with `npm install`, then start the development server with `npm run dev`. Open the local URL printed by Vite. Use `npm run build` for a production build and `npm test` for the engine tests.

## Included

- A drag-and-drop canvas with editable nodes, curved connections, zoom, panning by trackpad/wheel, multi-selection, delete, duplicate, undo/redo, keyboard shortcuts, JSON import/export, and local autosave.
- Deterministic sample order generation, configurable filters, safe limited transforms (field copy, quoted string literals, and simple arithmetic), condition branch routing, delay, output datasets, execution status, and CSV export.
- Demo e-commerce workflow with 300 sample orders and paid-order filtering, total calculation, high-value branching, and output nodes.

## Limits

The editor uses a compact custom SVG/DOM canvas rather than a full graph framework. Transform expressions intentionally support a small safe grammar and do not execute arbitrary JavaScript. Imported files are validated for node and edge shape and graph cycles. Results are held in memory for the current browser session; workflows persist in local storage.
