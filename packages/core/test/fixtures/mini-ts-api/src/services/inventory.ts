import { findItem, insertItem, listItems, updateQuantity, type ItemRow } from '../db/items.js';

export class InventoryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'InventoryError';
  }
}

export function getItems(warehouse?: string): ItemRow[] {
  return listItems(warehouse);
}

export function getItem(sku: string): ItemRow {
  const item = findItem(sku);
  if (!item) {
    throw new InventoryError(`No item with SKU ${sku}`, 404);
  }
  return item;
}

export function createItem(item: ItemRow): ItemRow {
  if (findItem(item.sku)) {
    throw new InventoryError(`SKU ${item.sku} already exists`, 409);
  }
  insertItem(item);
  return item;
}

/** Apply a signed delta to an item's stock level. Stock may never go negative. */
export function adjustStock(sku: string, delta: number): ItemRow {
  const item = getItem(sku);
  const next = item.quantity + delta;

  if (next < 0) {
    throw new InventoryError(
      `Adjustment of ${delta} would take ${sku} below zero (currently ${item.quantity})`,
      422,
    );
  }

  updateQuantity(sku, next);
  return { ...item, quantity: next };
}
