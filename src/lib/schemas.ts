import { z } from 'zod';

/** Shared query string for cursor-paginated list endpoints. */
export const PageQuerySchema = z.object({
  // Query strings are always text, so coerce "20" -> 20.
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const IdParamsSchema = z.object({ id: z.string().uuid() });
