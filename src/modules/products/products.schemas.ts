import { z } from 'zod';

export const ProductSchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceCents: z.number().int(),
  stock: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateProductSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  priceCents: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative(),
});

// PATCH: every field optional, but at least one must be present.
export const UpdateProductSchema = CreateProductSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'At least one field must be provided' },
);

export const ProductPageSchema = z.object({
  items: z.array(ProductSchema),
  nextCursor: z.string().nullable(),
});

export type Product = z.infer<typeof ProductSchema>;
export type CreateProductInput = z.infer<typeof CreateProductSchema>;
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;
