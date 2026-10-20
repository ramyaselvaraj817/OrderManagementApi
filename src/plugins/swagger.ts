import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/**
 * OpenAPI docs are generated from the same Zod schemas that validate requests,
 * so the documentation can't drift from the real behaviour.
 *
 *   GET /docs       -> Swagger UI
 *   GET /docs/json  -> raw OpenAPI 3 document
 */
export async function registerSwagger(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Order Management API',
        description: 'Products, carts and orders with transactional checkout, idempotency keys and cursor pagination.',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      tags: [
        { name: 'auth', description: 'Register and log in' },
        { name: 'products', description: 'Product catalogue' },
        { name: 'cart', description: "The current user's cart" },
        { name: 'orders', description: 'Checkout and order history' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
}
