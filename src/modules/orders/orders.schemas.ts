import { z } from 'zod';

export const OrderItemSchema = z.object({
  productId: z.string().uuid(),
  name: z.string(),
  quantity: z.number().int(),
  unitPriceCents: z.number().int(),
});

export const OrderSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['placed', 'cancelled']),
  totalCents: z.number().int(),
  items: z.array(OrderItemSchema),
  createdAt: z.string(),
});

export const OrderPageSchema = z.object({
  items: z.array(OrderSchema),
  nextCursor: z.string().nullable(),
});

/**
 * POST /orders requires an Idempotency-Key header (Node lower-cases header
 * names). `.passthrough()` keeps all the other headers (e.g. Authorization)
 * instead of stripping them.
 */
export const CreateOrderHeadersSchema = z
  .object({
    'idempotency-key': z
      .string()
      .min(8, 'Idempotency-Key must be at least 8 characters')
      .max(128)
      .regex(/^[A-Za-z0-9_\-:.]+$/, 'Idempotency-Key contains invalid characters'),
  })
  .passthrough();

export type Order = z.infer<typeof OrderSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
