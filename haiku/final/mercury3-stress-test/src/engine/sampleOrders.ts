import type { DataRecord } from '../types';

/** Mulberry32: a small deterministic PRNG so the sample data is identical on every run. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRODUCTS: { product: string; unitPrice: number }[] = [
  { product: 'Wireless Headphones', unitPrice: 129.99 },
  { product: 'Mechanical Keyboard', unitPrice: 89.5 },
  { product: '4K Monitor', unitPrice: 349 },
  { product: 'USB-C Hub', unitPrice: 39.9 },
  { product: 'Ergonomic Chair', unitPrice: 279 },
  { product: 'Standing Desk', unitPrice: 459.95 },
  { product: 'Webcam HD', unitPrice: 64.25 },
  { product: 'Notebook Stand', unitPrice: 24.5 },
  { product: 'Smart Speaker', unitPrice: 99 },
  { product: 'Portable SSD 1TB', unitPrice: 119.4 },
];

const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'Japan', 'Australia', 'Brazil'];
const FIRST_NAMES = ['Ava', 'Liam', 'Noah', 'Mia', 'Ethan', 'Sofia', 'Lucas', 'Emma', 'Mateo', 'Yuki', 'Amara', 'Ravi'];
const LAST_NAMES = ['Patel', 'Garcia', 'Nguyen', 'Smith', 'Müller', 'Tanaka', 'Silva', 'Brown', 'Dubois', 'Kim'];
const STATUSES: { status: string; weight: number }[] = [
  { status: 'Pending', weight: 2 },
  { status: 'Shipped', weight: 3 },
  { status: 'Delivered', weight: 6 },
  { status: 'Cancelled', weight: 1 },
  { status: 'Returned', weight: 1 },
];
const TOTAL_WEIGHT = STATUSES.reduce((sum, s) => sum + s.weight, 0);

/** Generates `count` deterministic e-commerce orders for a given seed. */
export function generateOrders(count: number, seed: number): DataRecord[] {
  const rng = createRng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)];
  const orders: DataRecord[] = [];
  const baseDate = Date.UTC(2025, 0, 1);

  for (let i = 0; i < count; i++) {
    const item = pick(PRODUCTS);
    const quantity = 1 + Math.floor(rng() * rng() * 9);
    const dayOffset = Math.floor(rng() * 365);
    let roll = rng() * TOTAL_WEIGHT;
    let status = STATUSES[0].status;
    for (const candidate of STATUSES) {
      roll -= candidate.weight;
      if (roll < 0) {
        status = candidate.status;
        break;
      }
    }
    orders.push({
      orderId: `ORD-${String(10001 + i)}`,
      customer: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      country: pick(COUNTRIES),
      product: item.product,
      quantity,
      unitPrice: item.unitPrice,
      orderDate: new Date(baseDate + dayOffset * 86400000).toISOString().slice(0, 10),
      status,
    });
  }
  return orders;
}
