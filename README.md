# Order Management API

A RESTful order management service built with **Node.js, Fastify and TypeScript** on **PostgreSQL**.
Customers browse products, fill a cart and check out; admins manage the catalogue.

![CI](https://github.com/ramyaselvaraj817/order-management-api/actions/workflows/ci.yml/badge.svg)

**Highlights**

- **Transactional checkout**: stock check, stock decrement, order + items, and cart clear happen in one Postgres transaction with row locks (`SELECT … FOR UPDATE`), so stock can never be oversold.
- **Idempotency keys** on `POST /orders`: retries (double clicks, network timeouts) return the original order instead of creating duplicates, even when the retries arrive concurrently.
- **Cursor-based pagination** for order history (`WHERE (created_at, id) < cursor`), which stays fast on large tables and never skips or repeats rows.
- **JWT authentication** with customer/admin roles, **Zod request validation**, and **per-user rate limiting** on order creation.
- **OpenAPI/Swagger docs** generated from the same Zod schemas used for validation (`/docs`).
- **Jest + Supertest** unit and API tests against a real Postgres, run on **GitHub Actions** together with a **Docker** build.

## Tech stack

| Concern | Choice |
| --- | --- |
| Runtime / framework | Node.js 22, Fastify 5, TypeScript (strict) |
| Database | PostgreSQL 16 via `pg` (plain SQL, no ORM) |
| Validation & docs | Zod + `fastify-type-provider-zod`, `@fastify/swagger`, `@fastify/swagger-ui` |
| Auth & security | `@fastify/jwt`, `bcryptjs`, `@fastify/rate-limit` |
| Testing | Jest, ts-jest, Supertest |
| Delivery | Docker (multi-stage), docker-compose, GitHub Actions |

## Getting started

### Option A: everything in Docker

```bash
docker compose up --build
# API:     http://localhost:3000
# Swagger: http://localhost:3000/docs
```

### Option B: run the API locally, Postgres in Docker

```bash
cp .env.example .env
docker compose up -d db          # Postgres on localhost:5432 (also creates orders_test)
npm install
npm run migrate                  # create tables
npm run seed                     # admin user + sample products
npm run dev                      # http://localhost:3000/docs
```

### Tests

```bash
docker compose up -d db
npm test                         # unit + API tests (uses the orders_test database)
npm run test:coverage
```

## API overview

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/auth/register` | none | Create customer account, returns JWT |
| POST | `/auth/login` | none | Returns JWT |
| GET | `/products?limit&cursor` | none | List products (cursor paginated) |
| GET | `/products/:id` | none | Get product |
| POST | `/products` | admin | Create product |
| PATCH | `/products/:id` | admin | Update product |
| GET | `/cart` | user | Current cart with totals |
| PUT | `/cart/items/:productId` | user | Set quantity for a product |
| DELETE | `/cart/items/:productId` | user | Remove product from cart |
| DELETE | `/cart` | user | Empty cart |
| POST | `/orders` | user | Checkout (needs `Idempotency-Key` header, rate limited) |
| GET | `/orders?limit&cursor` | user | Order history, newest first |
| GET | `/orders/:id` | user | Get one of my orders |
| POST | `/orders/:id/cancel` | user | Cancel and restock |

Errors always look like:

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "Not enough stock for one or more items", "details": [ ... ] } }
```

### Example flow (curl)

```bash
TOKEN=$(curl -s localhost:3000/auth/register -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"password123"}' | jq -r .token)

PRODUCT=$(curl -s localhost:3000/products | jq -r '.items[0].id')

curl -s -X PUT localhost:3000/cart/items/$PRODUCT -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"quantity":2}'

KEY=$(uuidgen)
curl -s -X POST localhost:3000/orders -H "authorization: Bearer $TOKEN" -H "Idempotency-Key: $KEY"   # 201 Created
curl -s -X POST localhost:3000/orders -H "authorization: Bearer $TOKEN" -H "Idempotency-Key: $KEY"   # 200, same order

curl -s "localhost:3000/orders?limit=10" -H "authorization: Bearer $TOKEN"
```

## Design notes

### Checkout transaction (`src/modules/orders/orders.service.ts`)

```
BEGIN
  INSERT INTO orders (user_id, idempotency_key) ... ON CONFLICT DO NOTHING   -- claim the key
  SELECT ... FROM cart_items JOIN products ... ORDER BY p.id FOR UPDATE      -- lock rows
  validate: cart not empty, quantity <= stock for every line
  UPDATE products SET stock = stock - qty            (one statement via unnest)
  INSERT INTO order_items (... unit_price_cents)     (price frozen at purchase)
  UPDATE orders SET total_cents = ...
  DELETE FROM cart_items WHERE user_id = ...
COMMIT        -- any error -> ROLLBACK, nothing is half-written
```

- **Row locks** serialise concurrent checkouts of the same product, so two buyers can't both take the last unit. Locks are taken in a fixed order (`ORDER BY p.id`) to avoid deadlocks.
- A `CHECK (stock >= 0)` constraint backs this up at the database level.

### Idempotency

`orders` has `UNIQUE (user_id, idempotency_key)`. The order row is inserted **first** with `ON CONFLICT DO NOTHING`:

- New key: the insert succeeds and checkout continues → `201 Created`.
- Key already used: the insert affects 0 rows → the original order is returned with `200 OK` and an `Idempotent-Replayed: true` header.
- Same key sent concurrently: Postgres makes the second insert **wait** for the first transaction to finish, then it sees the conflict and replays. Only one order is created.
- If checkout fails (e.g. out of stock), the rollback also removes the key, so the client can fix the problem and retry with the same key.

### Cursor pagination

`GET /orders` returns `{ items, nextCursor }`. The cursor is an opaque base64url string encoding the `(created_at, id)` of the last row returned. The next page is `WHERE (created_at, id) < (cursor) ORDER BY created_at DESC, id DESC LIMIT n+1`, served by the index `orders (user_id, created_at DESC, id DESC)`. Compared with `OFFSET`, the cost stays constant however deep you page, and inserts don't shift pages. Timestamps are stored as `TIMESTAMPTZ(3)` (milliseconds) so they round-trip exactly through JavaScript `Date`.

### Project structure

```
src/
  app.ts                 buildApp(): registers plugins + routes (used by server and tests)
  server.ts              entry point: config, DB pool, listen, graceful shutdown
  config.ts              env vars validated with Zod (fail fast)
  db/                    pool + withTransaction(), migration runner, seed script
  plugins/               JWT auth guards, Swagger, error handler
  lib/                   AppError helpers, cursor pagination, shared schemas
  modules/<feature>/     *.schemas.ts (Zod) · *.service.ts (SQL) · *.routes.ts (HTTP)
migrations/              plain SQL migrations
tests/unit, tests/api    Jest + Supertest
```
