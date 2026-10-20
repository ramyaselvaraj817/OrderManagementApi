import { auth, createAdmin, createProduct, createTestContext, registerCustomer, resetDb, TestContext } from '../helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(async () => {
  await resetDb(ctx.pool);
});
afterAll(async () => {
  await ctx.close();
});

describe('auth', () => {
  it('registers a user and returns a JWT', async () => {
    const res = await ctx.api().post('/auth/register').send({ email: 'Jane@Example.com', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: 'jane@example.com', role: 'customer' }); // email normalised
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  it('rejects a duplicate email with 409', async () => {
    const body = { email: 'dup@example.com', password: 'password123' };
    await ctx.api().post('/auth/register').send(body).expect(201);
    const res = await ctx.api().post('/auth/register').send(body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates the request body with Zod (400)', async () => {
    const res = await ctx.api().post('/auth/register').send({ email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in with correct credentials and rejects a wrong password', async () => {
    const body = { email: 'login@example.com', password: 'password123' };
    await ctx.api().post('/auth/register').send(body).expect(201);

    const ok = await ctx.api().post('/auth/login').send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.token).toEqual(expect.any(String));

    const bad = await ctx.api().post('/auth/login').send({ ...body, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects protected routes without a valid token (401)', async () => {
    await ctx.api().get('/cart').expect(401);
    await ctx.api().get('/cart').set('Authorization', 'Bearer not-a-real-token').expect(401);
  });
});

describe('products', () => {
  it('lets an admin create a product and anyone read it', async () => {
    const admin = await createAdmin(ctx);
    const product = await createProduct(ctx, admin, { priceCents: 1999, stock: 5, name: 'Keyboard' });

    const res = await ctx.api().get(`/products/${product.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Keyboard', priceCents: 1999, stock: 5 });
  });

  it('forbids customers from creating products (403)', async () => {
    const { token } = await registerCustomer(ctx);
    const res = await ctx
      .api()
      .post('/products')
      .set(auth(token))
      .send({ sku: 'X1', name: 'Nope', priceCents: 100, stock: 1 });
    expect(res.status).toBe(403);
  });

  it('rejects invalid product data (negative price)', async () => {
    const admin = await createAdmin(ctx);
    const res = await ctx
      .api()
      .post('/products')
      .set(auth(admin))
      .send({ sku: 'X2', name: 'Bad', priceCents: -5, stock: 1 });
    expect(res.status).toBe(400);
  });

  it('updates a product with PATCH', async () => {
    const admin = await createAdmin(ctx);
    const product = await createProduct(ctx, admin, { stock: 1 });
    const res = await ctx.api().patch(`/products/${product.id}`).set(auth(admin)).send({ stock: 50 });
    expect(res.status).toBe(200);
    expect(res.body.stock).toBe(50);
  });

  it('returns 404 for an unknown product', async () => {
    await ctx.api().get('/products/00000000-0000-0000-0000-000000000000').expect(404);
  });

  it('paginates the product list with a cursor', async () => {
    const admin = await createAdmin(ctx);
    for (let i = 0; i < 5; i++) await createProduct(ctx, admin);

    const page1 = await ctx.api().get('/products?limit=3');
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(3);
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    const page2 = await ctx.api().get(`/products?limit=3&cursor=${page1.body.nextCursor}`);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.nextCursor).toBeNull();

    const ids = [...page1.body.items, ...page2.body.items].map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(5);
  });
});
