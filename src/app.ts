import Fastify, { FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Pool } from 'pg';
import type { Config } from './config';
import { AppError } from './lib/errors';
import { registerAuth } from './plugins/auth';
import { registerSwagger } from './plugins/swagger';
import { registerErrorHandler } from './plugins/error-handler';
import { authRoutes } from './modules/auth/auth.routes';
import { productRoutes } from './modules/products/products.routes';
import { cartRoutes } from './modules/carts/carts.routes';
import { orderRoutes } from './modules/orders/orders.routes';

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
    config: Config;
  }
}

export interface BuildAppOptions {
  config: Config;
  pool: Pool;
  logger?: boolean;
}

/**
 * Builds the app without starting a server. server.ts calls listen(); tests
 * pass `app.server` to Supertest. Dependencies (config, db pool) are passed in,
 * which makes the app easy to test against a separate test database.
 */
export async function buildApp({ config, pool, logger = true }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ? { level: config.LOG_LEVEL } : false,
  });

  // Zod does validation of incoming requests and serialization of responses.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('db', pool);
  app.decorate('config', config);

  registerErrorHandler(app);
  await registerSwagger(app);
  await registerAuth(app, config);

  // Rate limiting is opt-in per route (global: false). It runs in the
  // preHandler phase, i.e. AFTER the auth hook, so limits are per user, not per IP.
  await app.register(fastifyRateLimit, {
    global: false,
    hook: 'preHandler',
    errorResponseBuilder: (_request, context) =>
      new AppError(429, 'RATE_LIMITED', `Too many requests, retry in ${context.after}`),
  });

  app.get('/health', { schema: { hide: true } }, async () => {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  });

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(productRoutes, { prefix: '/products' });
  await app.register(cartRoutes, { prefix: '/cart' });
  await app.register(orderRoutes, { prefix: '/orders' });

  return app;
}
