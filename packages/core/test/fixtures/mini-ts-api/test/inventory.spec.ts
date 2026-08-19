import { describe, expect, it } from 'vitest';

import { adjustStock, createItem, getItem } from '../src/services/inventory.js';

describe('inventory', () => {
  it('creates and reads back an item', () => {
    createItem({ sku: 'WID-1', name: 'Widget', warehouse: 'east', quantity: 5 });
    expect(getItem('WID-1').quantity).toBe(5);
  });

  it('refuses an adjustment that would go negative', () => {
    createItem({ sku: 'WID-2', name: 'Widget', warehouse: 'east', quantity: 1 });
    expect(() => adjustStock('WID-2', -4)).toThrow(/below zero/);
  });
});
