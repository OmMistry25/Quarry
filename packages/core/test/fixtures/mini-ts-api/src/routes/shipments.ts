import { Router } from 'express';
import { z } from 'zod';

import { InventoryError } from '../services/inventory.js';
import { recordShipment } from '../services/shipping.js';

export const shipmentsRouter = Router();

const shipmentSchema = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
});

shipmentsRouter.post('/', (req, res) => {
  const parsed = shipmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'sku and a positive integer quantity are required' });
    return;
  }

  try {
    res.status(201).json(recordShipment(parsed.data.sku, parsed.data.quantity));
  } catch (error) {
    if (error instanceof InventoryError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Internal error' });
  }
});
