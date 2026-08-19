import { openDatabase } from '../db/connection.js';

import { adjustStock, InventoryError } from './inventory.js';

export interface Shipment {
  sku: string;
  quantity: number;
  shippedAt: string;
}

export function recordShipment(sku: string, quantity: number): Shipment {
  if (quantity <= 0) {
    throw new InventoryError('Shipment quantity must be positive', 422);
  }

  adjustStock(sku, -quantity);

  const shippedAt = new Date().toISOString();
  const db = openDatabase();
  db.prepare('INSERT INTO shipments (sku, quantity, shipped_at) VALUES (?, ?, ?)').run(
    sku,
    quantity,
    shippedAt,
  );

  return { sku, quantity, shippedAt };
}
