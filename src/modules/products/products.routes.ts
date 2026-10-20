import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { IdParamsSchema, PageQuerySchema } from '../../lib/schemas';
import {
  CreateProductSchema,
  ProductPageSchema,
  ProductSchema,
  UpdateProductSchema,
} from './products.schemas';
import { createProduct, getProduct, listProducts, updateProduct } from './products.service';

export const productRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public: anyone can browse the catalogue.
  app.get(
    '/',
    {
      schema: {
        tags: ['products'],
        summary: 'List products (newest first, cursor paginated)',
        querystring: PageQuerySchema,
        response: { 200: ProductPageSchema },
      },
    },
    async (request) => listProducts(app.db, request.query.limit, request.query.cursor),
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['products'],
        summary: 'Get one product',
        params: IdParamsSchema,
        response: { 200: ProductSchema },
      },
    },
    async (request) => getProduct(app.db, request.params.id),
  );

  // Admin only: manage the catalogue.
  app.post(
    '/',
    {
      onRequest: [app.requireAdmin],
      schema: {
        tags: ['products'],
        summary: 'Create a product (admin)',
        security: [{ bearerAuth: [] }],
        body: CreateProductSchema,
        response: { 201: ProductSchema },
      },
    },
    async (request, reply) => reply.status(201).send(await createProduct(app.db, request.body)),
  );

  app.patch(
    '/:id',
    {
      onRequest: [app.requireAdmin],
      schema: {
        tags: ['products'],
        summary: 'Update a product (admin)',
        security: [{ bearerAuth: [] }],
        params: IdParamsSchema,
        body: UpdateProductSchema,
        response: { 200: ProductSchema },
      },
    },
    async (request) => updateProduct(app.db, request.params.id, request.body),
  );
};
