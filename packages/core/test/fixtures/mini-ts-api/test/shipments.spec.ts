import { describe, expect, it } from 'vitest';

import { createItem } from '../src/services/inventory.js';
import { recordShipment } from '../src/services/shipping.js';

describe('shipments', () => {
  it('decrements stock when a shipment is recorded', () => {
    createItem({ sku: 'BOX-1', name: 'Box', warehouse: 'west', quantity: 10 });
    const shipment = recordShipment('BOX-1', 3);
    expect(shipment.quantity).toBe(3);
  });
});
