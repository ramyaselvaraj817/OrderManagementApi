import { z } from 'zod';

export const CredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['customer', 'admin']),
});

export const AuthResponseSchema = z.object({
  token: z.string(),
  user: UserSchema,
});

export type Credentials = z.infer<typeof CredentialsSchema>;
export type User = z.infer<typeof UserSchema>;
