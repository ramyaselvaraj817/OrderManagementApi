import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { runMigrations } from '../src/db/migrate';

/**
 * API tests run against a REAL Postgres database (TEST_DATABASE_URL), because
 * the interesting behaviour (transactions, row locks, unique constraints)
 * lives in the database and can't be meaningfully mocked.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/orders_test';

export interface TestContext {
  app: FastifyInstance;
  pool: Pool;
  api: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function createTestContext(overrides: Partial<Record<keyof Config, string>> = {}): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_SECRET: 'test-secret-that-is-long-enough',
    ORDER_RATE_LIMIT_MAX: '100',
    ...overrides,
  });
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  await runMigrations(pool);
  const app = await buildApp({ config, pool, logger: false });
  await app.ready();

  return {
    app,
    pool,
    api: () => request(app.server),
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export async function resetDb(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE users, products, cart_items, orders, order_items CASCADE');
}

let counter = 0;
const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}-${++counter}@example.com`;

/** Registers a customer through the API and returns its token + id. */
export async function registerCustomer(ctx: TestContext): Promise<{ token: string; userId: string }> {
  const res = await ctx.api().post('/auth/register').send({ email: uniqueEmail('user'), password: 'password123' });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token, userId: res.body.user.id };
}

/** Admins can't self-register, so insert one directly and log in. */
export async function createAdmin(ctx: TestContext): Promise<string> {
  const email = uniqueEmail('admin');
  const hash = await bcrypt.hash('admin-password', 4);
  await ctx.pool.query(`INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')`, [email, hash]);
  const res = await ctx.api().post('/auth/login').send({ email, password: 'admin-password' });
  return res.body.token;
}

let skuCounter = 0;
export async function createProduct(
  ctx: TestContext,
  adminToken: string,
  data: { priceCents?: number; stock?: number; name?: string } = {},
): Promise<{ id: string; priceCents: number; stock: number }> {
  const res = await ctx
    .api()
    .post('/products')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      sku: `SKU-${Date.now()}-${++skuCounter}`,
      name: data.name ?? `Product ${skuCounter}`,
      priceCents: data.priceCents ?? 1000,
      stock: data.stock ?? 10,
    });
  if (res.status !== 201) throw new Error(`create product failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
