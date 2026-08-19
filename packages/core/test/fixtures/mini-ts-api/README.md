# mini-ts-api

A small inventory API for a warehouse: track items, adjust stock levels, and record
shipments. Express on top of SQLite, no external services.

## Setup

```bash
npm install
npm run dev
```

The server listens on `PORT` (default 3000) and creates `inventory.db` on first run.

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/items` | List items, optionally filtered by `?warehouse=` |
| `GET` | `/items/:sku` | Fetch one item by SKU |
| `POST` | `/items` | Create an item |
| `POST` | `/items/:sku/adjust` | Adjust stock by a signed delta |
| `POST` | `/shipments` | Record an outbound shipment |

## Tests

```bash
npm test
```
