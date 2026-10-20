import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../db/pool';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { buildPage, decodeCursor } from '../../lib/pagination';
import type { Order, OrderItem } from './orders.schemas';

type Queryable = Pool | PoolClient;

interface OrderRow {
  id: string;
  status: 'placed' | 'cancelled';
  total_cents: number;
  created_at: Date;
}

interface OrderItemRow {
  order_id: string;
  product_id: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
}

interface LockedCartLine {
  product_id: string;
  quantity: number;
  price_cents: number;
  stock: number;
}

/** Loads the items for a set of orders with ONE query (avoids the N+1 problem). */
async function loadItems(db: Queryable, orderIds: string[]): Promise<Map<string, OrderItem[]>> {
  const byOrder = new Map<string, OrderItem[]>();
  if (orderIds.length === 0) return byOrder;

  const { rows } = await db.query<OrderItemRow>(
    `SELECT oi.order_id, oi.product_id, p.name, oi.quantity, oi.unit_price_cents
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ANY($1::uuid[])
     ORDER BY p.name`,
    [orderIds],
  );
  for (const r of rows) {
    const list = byOrder.get(r.order_id) ?? [];
    list.push({ productId: r.product_id, name: r.name, quantity: r.quantity, unitPriceCents: r.unit_price_cents });
    byOrder.set(r.order_id, list);
  }
  return byOrder;
}

function toOrder(row: OrderRow, items: OrderItem[]): Order {
  return {
    id: row.id,
    status: row.status,
    totalCents: row.total_cents,
    items,
    createdAt: row.created_at.toISOString(),
  };
}

async function findOrder(db: Queryable, userId: string, orderId: string): Promise<Order | null> {
  // Filtering by user_id as well as id means users can never read each
  // other's orders (they get a 404, which also hides that the id exists).
  const { rows } = await db.query<OrderRow>(
    'SELECT id, status, total_cents, created_at FROM orders WHERE id = $1 AND user_id = $2',
    [orderId, userId],
  );
  if (!rows[0]) return null;
  const items = await loadItems(db, [orderId]);
  return toOrder(rows[0], items.get(orderId) ?? []);
}

export async function getOrder(db: Pool, userId: string, orderId: string): Promise<Order> {
  const order = await findOrder(db, userId, orderId);
  if (!order) throw notFound('Order');
  return order;
}

export interface PlaceOrderResult {
  order: Order;
  /** true when this request was a retry and we returned the original order */
  replayed: boolean;
}

/**
 * Checkout: turns the user's cart into an order.
 *
 * Everything runs in ONE transaction, so it either fully happens or not at all:
 *
 *  1. Claim the idempotency key by inserting the order row first.
 *     `ON CONFLICT DO NOTHING` + the UNIQUE (user_id, idempotency_key)
 *     constraint means only one request per key can ever win. If a concurrent
 *     request with the same key is still in flight, Postgres makes this INSERT
 *     wait until that transaction commits or rolls back.
 *  2. Lock the products in the cart (SELECT ... FOR UPDATE) so no other
 *     checkout can change their stock until we commit. Rows are locked in a
 *     fixed order (by id) so two checkouts can't deadlock each other.
 *  3. Validate: cart not empty, enough stock for every line.
 *  4. Decrement stock, write order_items (with the price at purchase time),
 *     set the order total, empty the cart.
 *  5. COMMIT (done by withTransaction). Any thrown error -> ROLLBACK, which
 *     also "releases" the idempotency key so the client can fix and retry.
 */
export async function placeOrder(db: Pool, userId: string, idempotencyKey: string): Promise<PlaceOrderResult> {
  const created = await withTransaction(db, async (client) => {
    // 1. Claim the idempotency key
    const claim = await client.query<OrderRow>(
      `INSERT INTO orders (user_id, idempotency_key)
       VALUES ($1, $2)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING id, status, total_cents, created_at`,
      [userId, idempotencyKey],
    );
    if (claim.rowCount === 0) return null; // key already used -> replay below
    const orderRow = claim.rows[0];

    // 2. Lock the cart rows and their products. Locking cart_items too means a
    //    second checkout that was waiting on these locks re-reads the cart
    //    after we commit, sees it's empty, and fails cleanly.
    const { rows: lines } = await client.query<LockedCartLine>(
      `SELECT ci.product_id, ci.quantity, p.price_cents, p.stock
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.user_id = $1
       ORDER BY p.id
       FOR UPDATE OF ci, p`,
      [userId],
    );

    // 3. Validate
    if (lines.length === 0) throw badRequest('CART_EMPTY', 'Cannot place an order with an empty cart');
    const shortages = lines
      .filter((l) => l.quantity > l.stock)
      .map((l) => ({ productId: l.product_id, requested: l.quantity, available: l.stock }));
    if (shortages.length > 0) {
      throw conflict('INSUFFICIENT_STOCK', 'Not enough stock for one or more items', shortages);
    }

    // 4. Apply changes
    const productIds = lines.map((l) => l.product_id);
    const quantities = lines.map((l) => l.quantity);
    const prices = lines.map((l) => l.price_cents);
    const totalCents = lines.reduce((sum, l) => sum + l.quantity * l.price_cents, 0);

    // unnest() turns parallel arrays into rows, so each step is ONE statement
    // no matter how many items are in the cart.
    await client.query(
      `UPDATE products p
       SET stock = p.stock - x.quantity, updated_at = now()
       FROM unnest($1::uuid[], $2::int[]) AS x(product_id, quantity)
       WHERE p.id = x.product_id`,
      [productIds, quantities],
    );
    await client.query(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
       SELECT $1, x.product_id, x.quantity, x.price
       FROM unnest($2::uuid[], $3::int[], $4::int[]) AS x(product_id, quantity, price)`,
      [orderRow.id, productIds, quantities, prices],
    );
    await client.query('UPDATE orders SET total_cents = $2 WHERE id = $1', [orderRow.id, totalCents]);
    await client.query('DELETE FROM cart_items WHERE user_id = $1', [userId]);

    return orderRow.id;
  });

  if (created) {
    return { order: (await findOrder(db, userId, created))!, replayed: false };
  }

  // Idempotent replay: same key -> return the order created the first time.
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM orders WHERE user_id = $1 AND idempotency_key = $2',
    [userId, idempotencyKey],
  );
  return { order: (await findOrder(db, userId, rows[0].id))!, replayed: true };
}

/** Newest first, cursor paginated. See lib/pagination.ts for why not OFFSET. */
export async function listOrders(db: Pool, userId: string, limit: number, rawCursor?: string) {
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  const { rows } = await db.query<OrderRow>(
    `SELECT id, status, total_cents, created_at
     FROM orders
     WHERE user_id = $1
       AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
     ORDER BY created_at DESC, id DESC
     LIMIT $4`,
    [userId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
  );
  const items = await loadItems(db, rows.map((r) => r.id));
  return buildPage(
    rows.map((r) => toOrder(r, items.get(r.id) ?? [])),
    limit,
  );
}

/** Cancels a placed order and puts its items back into stock, atomically. */
export async function cancelOrder(db: Pool, userId: string, orderId: string): Promise<Order> {
  await withTransaction(db, async (client) => {
    // Lock the order row so two cancel requests can't both restore stock.
    const { rows } = await client.query<{ status: string }>(
      'SELECT status FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [orderId, userId],
    );
    if (!rows[0]) throw notFound('Order');
    if (rows[0].status !== 'placed') {
      throw conflict('ORDER_NOT_CANCELLABLE', `Order is already ${rows[0].status}`);
    }

    await client.query(
      `UPDATE products p
       SET stock = p.stock + oi.quantity, updated_at = now()
       FROM order_items oi
       WHERE oi.order_id = $1 AND p.id = oi.product_id`,
      [orderId],
    );
    await client.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [orderId]);
  });
  return getOrder(db, userId, orderId);
}
