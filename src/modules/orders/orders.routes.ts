import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { IdParamsSchema, PageQuerySchema } from '../../lib/schemas';
import { CreateOrderHeadersSchema, OrderPageSchema, OrderSchema } from './orders.schemas';
import { cancelOrder, getOrder, listOrders, placeOrder } from './orders.service';

export const orderRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  const common = { tags: ['orders'], security: [{ bearerAuth: [] }] };

  app.post(
    '/',
    {
      // Per-user rate limit (see app.ts: the limiter runs after auth).
      config: {
        rateLimit: {
          max: app.config.ORDER_RATE_LIMIT_MAX,
          timeWindow: app.config.ORDER_RATE_LIMIT_WINDOW,
          keyGenerator: (request) => request.user?.sub ?? request.ip,
        },
      },
      schema: {
        ...common,
        summary: 'Place an order from my cart',
        description:
          'Requires an `Idempotency-Key` header (e.g. a UUID). Retrying with the same key returns ' +
          'the original order with 200 instead of creating a duplicate. A new order returns 201.',
        headers: CreateOrderHeadersSchema,
        response: { 200: OrderSchema, 201: OrderSchema },
      },
    },
    async (request, reply) => {
      const { order, replayed } = await placeOrder(app.db, request.user.sub, request.headers['idempotency-key']);
      if (replayed) reply.header('Idempotent-Replayed', 'true');
      return reply.status(replayed ? 200 : 201).send(order);
    },
  );

  app.get(
    '/',
    {
      schema: {
        ...common,
        summary: 'My order history (newest first, cursor paginated)',
        querystring: PageQuerySchema,
        response: { 200: OrderPageSchema },
      },
    },
    async (request) => listOrders(app.db, request.user.sub, request.query.limit, request.query.cursor),
  );

  app.get(
    '/:id',
    {
      schema: { ...common, summary: 'Get one of my orders', params: IdParamsSchema, response: { 200: OrderSchema } },
    },
    async (request) => getOrder(app.db, request.user.sub, request.params.id),
  );

  app.post(
    '/:id/cancel',
    {
      schema: {
        ...common,
        summary: 'Cancel an order and restock its items',
        params: IdParamsSchema,
        response: { 200: OrderSchema },
      },
    },
    async (request) => cancelOrder(app.db, request.user.sub, request.params.id),
  );
};
