import { Router } from 'express';
import { z } from 'zod';

import { adjustStock, createItem, getItem, getItems, InventoryError } from '../services/inventory.js';

export const itemsRouter = Router();

const createItemSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  warehouse: z.string().min(1),
  quantity: z.number().int().nonnegative().default(0),
});

const adjustSchema = z.object({
  delta: z.number().int(),
});

itemsRouter.get('/', (req, res) => {
  const warehouse = typeof req.query.warehouse === 'string' ? req.query.warehouse : undefined;
  res.json({ items: getItems(warehouse) });
});

itemsRouter.get('/:sku', (req, res) => {
  try {
    res.json(getItem(req.params.sku));
  } catch (error) {
    sendError(res, error);
  }
});

itemsRouter.post('/', (req, res) => {
  const parsed = createItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid item' });
    return;
  }

  try {
    res.status(201).json(createItem(parsed.data));
  } catch (error) {
    sendError(res, error);
  }
});

itemsRouter.post('/:sku/adjust', (req, res) => {
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'delta must be an integer' });
    return;
  }

  try {
    res.json(adjustStock(req.params.sku, parsed.data.delta));
  } catch (error) {
    sendError(res, error);
  }
});

function sendError(res: import('express').Response, error: unknown): void {
  if (error instanceof InventoryError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: 'Internal error' });
}
