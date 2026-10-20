import { randomUUID } from 'node:crypto';
import { auth, createAdmin, createProduct, createTestContext, registerCustomer, resetDb, TestContext } from '../helpers';

let ctx: TestContext;
let adminToken: string;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(async () => {
  await resetDb(ctx.pool);
  adminToken = await createAdmin(ctx);
});
afterAll(async () => {
  await ctx.close();
});

async function addToCart(token: string, productId: string, quantity: number) {
  return ctx.api().put(`/cart/items/${productId}`).set(auth(token)).send({ quantity });
}

async function placeOrder(token: string, key: string = randomUUID()) {
  return ctx.api().post('/orders').set(auth(token)).set('Idempotency-Key', key);
}

async function stockOf(productId: string): Promise<number> {
  const res = await ctx.api().get(`/products/${productId}`);
  return res.body.stock;
}

describe('cart', () => {
  it('adds, updates and removes items and computes totals', async () => {
    const { token } = await registerCustomer(ctx);
    const p = await createProduct(ctx, adminToken, { priceCents: 250, stock: 10 });

    let res = await addToCart(token, p.id, 2);
    expect(res.status).toBe(200);
    expect(res.body.totalCents).toBe(500);

    res = await addToCart(token, p.id, 4); // PUT sets the quantity, it doesn't add
    expect(res.body.items[0].quantity).toBe(4);
    expect(res.body.totalCents).toBe(1000);

    res = await ctx.api().delete(`/cart/items/${p.id}`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it('refuses to add more than is in stock', async () => {
    const { token } = await registerCustomer(ctx);
    const p = await createProduct(ctx, adminToken, { stock: 2 });
    const res = await addToCart(token, p.id, 3);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });
});

describe('POST /orders (checkout)', () => {
  it('creates an order, decrements stock and empties the cart', async () => {
    const { token } = await registerCustomer(ctx);
    const a = await createProduct(ctx, adminToken, { priceCents: 1000, stock: 5 });
    const b = await createProduct(ctx, adminToken, { priceCents: 250, stock: 5 });
    await addToCart(token, a.id, 2);
    await addToCart(token, b.id, 1);

    const res = await placeOrder(token);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('placed');
    expect(res.body.totalCents).toBe(2250);
    expect(res.body.items).toHaveLength(2);

    expect(await stockOf(a.id)).toBe(3);
    expect(await stockOf(b.id)).toBe(4);
    const cart = await ctx.api().get('/cart').set(auth(token));
    expect(cart.body.items).toHaveLength(0);
  });

  it('freezes the unit price at purchase time', async () => {
    const { token } = await registerCustomer(ctx);
    const p = await createProduct(ctx, adminToken, { priceCents: 1000 });
    await addToCart(token, p.id, 1);
    const order = await placeOrder(token);

    await ctx.api().patch(`/products/${p.id}`).set(auth(adminToken)).send({ priceCents: 5000 });

    const again = await ctx.api().get(`/orders/${order.body.id}`).set(auth(token));
    expect(again.body.items[0].unitPriceCents).toBe(1000);
    expect(again.body.totalCents).toBe(1000);
  });

  it('requires an Idempotency-Key header', async () => {
    const { token } = await registerCustomer(ctx);
    const res = await ctx.api().post('/orders').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an empty cart', async () => {
    const { token } = await registerCustomer(ctx);
    const res = await placeOrder(token);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CART_EMPTY');
  });

  it('rolls back everything when stock is insufficient', async () => {
    const { token } = await registerCustomer(ctx);
    const a = await createProduct(ctx, adminToken, { stock: 5 });
    const b = await createProduct(ctx, adminToken, { stock: 5 });
    await addToCart(token, a.id, 2);
    await addToCart(token, b.id, 5);
    // Stock drops after the item was added to the cart
    await ctx.api().patch(`/products/${b.id}`).set(auth(adminToken)).send({ stock: 1 });

    const res = await placeOrder(token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details).toEqual([{ productId: b.id, requested: 5, available: 1 }]);

    // Nothing changed: product A's stock was not decremented, no order exists, cart intact
    expect(await stockOf(a.id)).toBe(5);
    const orders = await ctx.api().get('/orders').set(auth(token));
    expect(orders.body.items).toHaveLength(0);
    const cart = await ctx.api().get('/cart').set(auth(token));
    expect(cart.body.items).toHaveLength(2);
  });

  it('is idempotent: retrying with the same key returns the same order', async () => {
    const { token } = await registerCustomer(ctx);
    const p = await createProduct(ctx, adminToken, { stock: 10 });
    await addToCart(token, p.id, 3);
    const key = randomUUID();

    const first = await placeOrder(token, key);
    const retry = await placeOrder(token, key);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.id).toBe(first.body.id);
    expect(await stockOf(p.id)).toBe(7); // decremented once, not twice
  });

  it('creates only one order when the same key is sent concurrently', async () => {
    const { token } = await registerCustomer(ctx);
    const p = await createProduct(ctx, adminToken, { stock: 10 });
    await addToCart(token, p.id, 2);
    const key = randomUUID();

    const results = await Promise.all([placeOrder(token, key), placeOrder(token, key), placeOrder(token, key)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await stockOf(p.id)).toBe(8);
  });

  it('never oversells when different users race for the last items', async () => {
    const p = await createProduct(ctx, adminToken, { stock: 3 });
    const users = await Promise.all([1, 2, 3, 4, 5].map(() => registerCustomer(ctx)));
    for (const u of users) await addToCart(u.token, p.id, 1);
    // Leave only 2 units: 5 buyers, 2 can succeed
    await ctx.api().patch(`/products/${p.id}`).set(auth(adminToken)).send({ stock: 2 });

    const results = await Promise.all(users.map((u) => placeOrder(u.token)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await stockOf(p.id)).toBe(0);
  });
});

describe('GET /orders (history)', () => {
  it('paginates newest first with a cursor, without duplicates or gaps', async () => {
    const { token } = await registerCustomer(ctx);
    const p = await createProduct(ctx, adminToken, { stock: 100 });
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      await addToCart(token, p.id, 1);
      created.push((await placeOrder(token)).body.id);
    }

    const seen: { id: string; createdAt: string }[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/orders?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await ctx.api().get(url).set(auth(token));
      expect(res.status).toBe(200);
      seen.push(...res.body.items);
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor);

    expect(pages).toBe(3); // 2 + 2 + 1
    // Every order exactly once (no duplicates, no gaps)...
    expect(seen.map((o) => o.id).sort()).toEqual([...created].sort());
    // ...and newest first.
    const times = seen.map((o) => Date.parse(o.createdAt));
    expect(times).toEqual([...times].sort((x, y) => y - x));
  });

  it('rejects a malformed cursor', async () => {
    const { token } = await registerCustomer(ctx);
    const res = await ctx.api().get('/orders?cursor=garbage').set(auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });

  it("does not expose other users' orders", async () => {
    const alice = await registerCustomer(ctx);
    const bob = await registerCustomer(ctx);
    const p = await createProduct(ctx, adminToken);
    await addToCart(alice.token, p.id, 1);
    const order = await placeOrder(alice.token);

    await ctx.api().get(`/orders/${order.body.id}`).set(auth(bob.token)).expect(404);
    const bobs = await ctx.api().get('/orders').set(auth(bob.token));
    expect(bobs.body.items).toHaveLength(0);
  });
});

describe('POST /orders/:id/cancel', () => {
  it('cancels once and restores stock', async () => {
    const { token } = await registerCustomer(ctx);
    const p = await createProduct(ctx, adminToken, { stock: 5 });
    await addToCart(token, p.id, 2);
    const order = await placeOrder(token);
    expect(await stockOf(p.id)).toBe(3);

    const res = await ctx.api().post(`/orders/${order.body.id}/cancel`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(await stockOf(p.id)).toBe(5);

    const again = await ctx.api().post(`/orders/${order.body.id}/cancel`).set(auth(token));
    expect(again.status).toBe(409);
    expect(await stockOf(p.id)).toBe(5);
  });
});

describe('rate limiting', () => {
  it('limits order creation per user (429)', async () => {
    const limited = await createTestContext({ ORDER_RATE_LIMIT_MAX: '2' });
    try {
      const res1 = await limited.api().post('/auth/register').send({ email: `rl-${Date.now()}@example.com`, password: 'password123' });
      const token = res1.body.token;
      const send = () => limited.api().post('/orders').set(auth(token)).set('Idempotency-Key', randomUUID());

      // Empty cart -> 400, but the requests still count towards the limit
      expect((await send()).status).toBe(400);
      expect((await send()).status).toBe(400);
      const third = await send();
      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});
