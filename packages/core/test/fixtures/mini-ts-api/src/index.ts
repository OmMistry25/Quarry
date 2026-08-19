import express from 'express';

import { openDatabase } from './db/connection.js';
import { itemsRouter } from './routes/items.js';
import { shipmentsRouter } from './routes/shipments.js';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/items', itemsRouter);
app.use('/shipments', shipmentsRouter);

const port = Number(process.env.PORT ?? 3000);

if (process.env.NODE_ENV !== 'test') {
  openDatabase();
  app.listen(port, () => {
    console.log(`mini-ts-api listening on ${port}`);
  });
}

export { app };
