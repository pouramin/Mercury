import { SeededRandom } from './rng';

// ---------------------------------------------------------------------------
// Deterministic sample dataset: E-commerce orders
// ---------------------------------------------------------------------------

export interface OrderRecord {
  orderId: string;
  customer: string;
  country: string;
  product: string;
  quantity: number;
  unitPrice: number;
  date: string; // ISO yyyy-mm-dd
  status: string;
  notes?: string;
}

export const ORDER_PRODUCTS: ReadonlyArray<readonly [string, number]> = [
  ['Wired Keyboard', 24.99],
  ['Wireless Mouse', 19.5],
  ['27" Monitor', 249.0],
  ['USB-C Hub', 39.99],
  ['Mechanical Keyboard', 89.0],
  ['Webcam 1080p', 59.99],
  ['Desk Lamp', 29.9],
  ['Laptop Stand', 44.5],
  ['SSD 1TB', 119.0],
  ['Noise-Cancelling Headphones', 159.0],
  ['USB Cable 2m', 9.99],
  ['Smart Speaker', 79.0],
  ['Drawing Tablet', 69.99],
  ['Portable Battery 20K', 49.0],
  ['Ergonomic Chair', 329.0],
  ['Monitor Arm', 89.99],
];

export const ORDER_COUNTRIES: ReadonlyArray<readonly [string, number]> = [
  ['US', 32],
  ['DE', 14],
  ['UK', 11],
  ['CA', 9],
  ['FR', 7],
  ['JP', 6],
  ['AU', 5],
  ['BR', 4],
  ['IN', 4],
  ['NL', 3],
  ['SE', 2],
  ['IT', 3],
];

export const ORDER_STATUSES: ReadonlyArray<readonly [string, number]> = [
  ['completed', 46],
  ['processing', 22],
  ['pending', 21],
  ['refunded', 11],
];

const CUSTOMER_FIRST = [
  'Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Isabella', 'Lucas',
  'Mia', 'Logan', 'Charlotte', 'Elias', 'Amelia', 'Hugo', 'Freya', 'Mateo', 'Chloe', 'Leo',
  'Zoe', 'Omar', 'Ingrid', 'Kenji', 'Nina', 'Ravi', 'Sofia', 'Felix', 'Priya', 'Jonas',
];
const CUSTOMER_LAST = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez',
  'Martinez', 'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
];

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

/** Generate `count` deterministic orders from a seed. */
export function generateOrders(count: number, seed: number): OrderRecord[] {
  const rnd = new SeededRandom(seed);
  const records: OrderRecord[] = [];
  const startEpoch = Date.UTC(2024, 0, 1);
  const spanMs = Date.UTC(2024, 11, 31) - startEpoch;

  for (let i = 0; i < count; i++) {
    const [product, unitPrice] = rnd.pick(ORDER_PRODUCTS);
    const quantity = rnd.weighted<number>([
      [1, 42],
      [2, 30],
      [3, 15],
      [4, 8],
      [5, 5],
    ]);
    const date = new Date(startEpoch + Math.floor(rnd.float(0, 1) * spanMs));
    const rec: OrderRecord = {
      orderId: `ORD-${pad(1000 + i, 4)}`,
      customer: `${rnd.pick(CUSTOMER_FIRST)} ${rnd.pick(CUSTOMER_LAST)}`,
      country: rnd.weighted(ORDER_COUNTRIES),
      product,
      quantity,
      unitPrice,
      date: date.toISOString().slice(0, 10),
      status: rnd.weighted(ORDER_STATUSES),
    };
    // A small fraction carry an optional note (present on some records only).
    if (rnd.chance(0.08)) {
      rec.notes = rnd.pick(['VIP', 'gift wrap', 'rush shipping', 'bulk']);
    }
    records.push(rec);
  }
  return records;
}

export const ORDERS_SCHEMA_FIELDS = [
  'orderId',
  'customer',
  'country',
  'product',
  'quantity',
  'unitPrice',
  'date',
  'status',
  'notes',
];
