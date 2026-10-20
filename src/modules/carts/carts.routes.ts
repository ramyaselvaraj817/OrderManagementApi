import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { CartItemParamsSchema, CartSchema, SetQuantitySchema } from './carts.schemas';
import { clearCart, getCart, removeItem, setItemQuantity } from './carts.service';

export const cartRoutes: FastifyPluginAsyncZod = async (app) => {
  // Every route in this plugin requires a logged-in user.
  // Hooks added here apply only inside this plugin (Fastify encapsulation).
  app.addHook('onRequest', app.authenticate);

  const common = { tags: ['cart'], security: [{ bearerAuth: [] }] };

  app.get(
    '/',
    { schema: { ...common, summary: 'Get my cart', response: { 200: CartSchema } } },
    async (request) => getCart(app.db, request.user.sub),
  );

  app.put(
    '/items/:productId',
    {
      schema: {
        ...common,
        summary: 'Add a product to my cart or change its quantity',
        params: CartItemParamsSchema,
        body: SetQuantitySchema,
        response: { 200: CartSchema },
      },
    },
    async (request) => setItemQuantity(app.db, request.user.sub, request.params.productId, request.body.quantity),
  );

  app.delete(
    '/items/:productId',
    {
      schema: {
        ...common,
        summary: 'Remove a product from my cart',
        params: CartItemParamsSchema,
        response: { 200: CartSchema },
      },
    },
    async (request) => removeItem(app.db, request.user.sub, request.params.productId),
  );

  app.delete('/', { schema: { ...common, summary: 'Empty my cart' } }, async (request, reply) => {
    await clearCart(app.db, request.user.sub);
    return reply.status(204).send();
  });
};
