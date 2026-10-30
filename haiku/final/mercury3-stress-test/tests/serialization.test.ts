import { describe, expect, it } from 'vitest';
import { parseWorkflowText, parseWorkflowValue, serializeWorkflow } from '../src/engine/serialization';
import { createDemoDoc } from '../src/engine/demo';
import { toCsv } from '../src/engine/csv';
import { generateOrders, createRng } from '../src/engine/sampleOrders';

describe('workflow JSON serialization', () => {
  it('round-trips the demo workflow without loss', () => {
    const doc = createDemoDoc();
    const parsed = parseWorkflowText(serializeWorkflow(doc));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc).toEqual(doc);
  });

  it('fills missing config fields with defaults', () => {
    const parsed = parseWorkflowValue({
      format: 'flowforge-workflow',
      version: 1,
      name: 'Minimal',
      nodes: [
        { id: 's', type: 'start', name: 'Start', x: 0, y: 0 },
        { id: 'd', type: 'dataSource', name: 'Data', x: 10, y: 10, config: { count: 5 } },
      ],
      edges: [{ id: 'e', source: 's', sourcePort: 'out', target: 'd', targetPort: 'in' }],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const data = parsed.doc.nodes.find((n) => n.id === 'd');
      expect(data?.type === 'dataSource' && data.config.count).toBe(5);
      expect(data?.type === 'dataSource' && data.config.source).toBe('generated');
    }
  });
});

describe('invalid import handling', () => {
  const base = () => JSON.parse(serializeWorkflow(createDemoDoc())) as Record<string, unknown>;

  it('rejects text that is not JSON', () => {
    const result = parseWorkflowText('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/not valid JSON/);
  });

  it('rejects files with the wrong format or version', () => {
    const wrong = { ...base(), format: 'other', version: 2 };
    const result = parseWorkflowValue(wrong);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects unknown node types', () => {
    const doc = base();
    (doc.nodes as Array<Record<string, unknown>>)[1].type = 'eval';
    const result = parseWorkflowValue(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/unknown type "eval"/);
  });

  it('rejects connections that reference missing nodes', () => {
    const doc = base();
    (doc.edges as Array<Record<string, unknown>>)[0].target = 'ghost';
    const result = parseWorkflowValue(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/does not exist/);
  });

  it('rejects connections on ports the node does not have', () => {
    const doc = base();
    const edge = (doc.edges as Array<Record<string, unknown>>).find((e) => e.id === 'e2');
    if (!edge) throw new Error('fixture missing');
    edge.sourcePort = 'true';
    const result = parseWorkflowValue(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/has no output port "true"/);
  });

  it('rejects duplicate node ids and invalid positions', () => {
    const doc = base();
    const nodes = doc.nodes as Array<Record<string, unknown>>;
    nodes[2].id = nodes[1].id;
    nodes[3].x = 'left';
    const result = parseWorkflowValue(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/Duplicate node id/);
      expect(result.errors.join(' ')).toMatch(/numeric "x" and "y"/);
    }
  });

  it('rejects nodes whose configuration is invalid', () => {
    const doc = base();
    const nodes = doc.nodes as Array<{ type: string; config: Record<string, unknown> }>;
    const condition = nodes.find((n) => n.type === 'condition');
    if (!condition) throw new Error('fixture missing');
    condition.config = { condition: { id: 'x', field: 'a', operator: 'gt', value: 'abc' } };
    const result = parseWorkflowValue(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/numeric value/);
  });

  it('rejects non-object input and arrays', () => {
    expect(parseWorkflowValue([]).ok).toBe(false);
    expect(parseWorkflowValue(null).ok).toBe(false);
    expect(parseWorkflowValue('workflow').ok).toBe(false);
  });
});

describe('sample data and CSV export', () => {
  it('generates identical orders for the same seed', () => {
    expect(generateOrders(300, 7)).toEqual(generateOrders(300, 7));
    expect(generateOrders(300, 7)).not.toEqual(generateOrders(300, 8));
  });

  it('generates 300 orders with every required field', () => {
    const orders = generateOrders(300, 20250);
    expect(orders).toHaveLength(300);
    for (const order of orders) {
      expect(typeof order.orderId).toBe('string');
      expect(typeof order.customer).toBe('string');
      expect(typeof order.country).toBe('string');
      expect(typeof order.product).toBe('string');
      expect(Number.isInteger(order.quantity)).toBe(true);
      expect(order.quantity as number).toBeGreaterThanOrEqual(1);
      expect(typeof order.unitPrice).toBe('number');
      expect(order.orderDate).toMatch(/^2025-\d{2}-\d{2}$/);
      expect(typeof order.status).toBe('string');
    }
    expect(new Set(orders.map((o) => o.orderId)).size).toBe(300);
  });

  it('produces a uniform random stream in [0, 1)', () => {
    const rng = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('exports CSV with a union of columns and escaped cells', () => {
    const csv = toCsv([{ a: 'plain', b: 'has,comma' }, { a: 'say "hi"', c: 3 }]);
    expect(csv).toBe('a,b,c\r\nplain,"has,comma",\r\n"say ""hi""",,3\r\n');
  });
});
