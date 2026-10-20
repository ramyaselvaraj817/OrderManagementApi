import { z } from 'zod';

export const CartItemSchema = z.object({
  productId: z.string().uuid(),
  name: z.string(),
  priceCents: z.number().int(),
  quantity: z.number().int(),
  lineTotalCents: z.number().int(),
});

export const CartSchema = z.object({
  items: z.array(CartItemSchema),
  totalCents: z.number().int(),
});

export const CartItemParamsSchema = z.object({ productId: z.string().uuid() });

export const SetQuantitySchema = z.object({
  quantity: z.number().int().min(1).max(1000),
});

export type Cart = z.infer<typeof CartSchema>;
