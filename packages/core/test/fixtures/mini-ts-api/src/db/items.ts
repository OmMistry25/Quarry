import { openDatabase } from './connection.js';

export interface ItemRow {
  sku: string;
  name: string;
  warehouse: string;
  quantity: number;
}

export function listItems(warehouse?: string): ItemRow[] {
  const db = openDatabase();
  if (warehouse) {
    return db.prepare('SELECT * FROM items WHERE warehouse = ? ORDER BY sku').all(warehouse) as ItemRow[];
  }
  return db.prepare('SELECT * FROM items ORDER BY sku').all() as ItemRow[];
}

export function findItem(sku: string): ItemRow | undefined {
  const db = openDatabase();
  return db.prepare('SELECT * FROM items WHERE sku = ?').get(sku) as ItemRow | undefined;
}

export function insertItem(item: ItemRow): void {
  const db = openDatabase();
  db.prepare(
    'INSERT INTO items (sku, name, warehouse, quantity) VALUES (@sku, @name, @warehouse, @quantity)',
  ).run(item);
}

export function updateQuantity(sku: string, quantity: number): void {
  const db = openDatabase();
  db.prepare('UPDATE items SET quantity = ? WHERE sku = ?').run(quantity, sku);
}
