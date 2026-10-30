import { describe, expect, it } from 'vitest';
import { createDemoWorkflow } from '../src/engine/demoWorkflow';
import { parseWorkflowJson, serializeWorkflow } from '../src/utils/workflowIO';
import { recordsToCsv } from '../src/utils/csv';

describe('workflow JSON serialization', () => {
  it('round-trips a workflow through JSON', () => {
    const demo = createDemoWorkflow();
    const text = serializeWorkflow(demo);
    const parsed = parseWorkflowJson(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.workflow.name).toBe(demo.name);
      expect(parsed.workflow.nodes).toHaveLength(demo.nodes.length);
      expect(parsed.workflow.edges).toHaveLength(demo.edges.length);
      expect(JSON.stringify(parsed.workflow.nodes)).toBe(JSON.stringify(demo.nodes));
      expect(JSON.stringify(parsed.workflow.edges)).toBe(JSON.stringify(demo.edges));
    }
  });

  it('rejects malformed JSON text', () => {
    const parsed = parseWorkflowJson('{ this is not json');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/not valid JSON/i);
  });

  it('rejects non-object payloads', () => {
    expect(parseWorkflowJson('[1,2,3]').ok).toBe(false);
    expect(parseWorkflowJson('"hello"').ok).toBe(false);
  });

  it('rejects workflows missing nodes/edges arrays', () => {
    expect(parseWorkflowJson('{"name":"x"}').ok).toBe(false);
    expect(parseWorkflowJson('{"name":"x","nodes":[],"edges":"nope"}').ok).toBe(false);
  });

  it('rejects unknown node types', () => {
    const bad = JSON.stringify({ nodes: [{ id: 'n1', type: 'quantumProcessor', position: { x: 0, y: 0 } }], edges: [] });
    const parsed = parseWorkflowJson(bad);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/unknown type/i);
  });

  it('rejects structurally circular workflows', () => {
    const bad = JSON.stringify({
      name: 'cycle',
      nodes: [
        { id: 'a', type: 'dataSource', position: { x: 0, y: 0 }, config: { dataSourceMode: 'paste', pastedJson: '[]' } },
        { id: 'b', type: 'output', position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        { source: 'a', sourcePort: 'out', target: 'b', targetPort: 'in' },
        { source: 'b', sourcePort: 'out', target: 'a', targetPort: 'in' },
      ],
    });
    const parsed = parseWorkflowJson(bad);
    expect(parsed.ok).toBe(false);
  });

  it('fills in missing optional metadata', () => {
    const text = JSON.stringify({
      nodes: [{ id: 'n1', type: 'output', position: { x: 5, y: 6 }, config: { maxRows: 50 } }],
      edges: [],
    });
    const parsed = parseWorkflowJson(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.workflow.name).toBe('Imported workflow');
      expect(parsed.workflow.nodes[0].position).toEqual({ x: 5, y: 6 });
    }
  });
});

describe('CSV serialization', () => {
  it('escapes quotes and commas', () => {
    const csv = recordsToCsv([{ name: 'Ada, the "first"', ok: true, n: 5 }]);
    expect(csv).toContain('"Ada, the ""first"""');
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('handles empty input', () => {
    expect(recordsToCsv([])).toBe('');
  });
});
