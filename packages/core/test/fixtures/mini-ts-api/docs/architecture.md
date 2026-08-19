# mini-ts-api architecture

Three layers, top to bottom:

- `src/routes/` — Express routers. Parse and validate input with zod, translate
  `InventoryError` into status codes. No business rules live here.
- `src/services/` — the rules: stock may never go negative, a SKU is unique, a shipment
  quantity is positive.
- `src/db/` — thin `better-sqlite3` wrappers returning plain row objects.

The database file is created on first run; there are no migrations and no external services.
