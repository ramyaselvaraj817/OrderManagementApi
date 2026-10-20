import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import { forbidden } from '../lib/errors';

export type Role = 'customer' | 'admin';

// Tell TypeScript what's inside our JWTs and what `request.user` looks like.
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: Role };
    user: { sub: string; role: Role };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** onRequest hook: rejects with 401 unless a valid Bearer token is sent. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** onRequest hook: 401 without a token, 403 unless the user is an admin. */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Registers @fastify/jwt and two reusable guards.
 *
 * Called directly on the root instance (not via app.register) so the
 * decorators are visible to every route plugin registered afterwards.
 */
export async function registerAuth(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: config.JWT_EXPIRES_IN },
  });

  app.decorate('authenticate', async (request: FastifyRequest) => {
    // Reads "Authorization: Bearer <token>", verifies signature + expiry,
    // and sets request.user. Throws a 401 error otherwise.
    await request.jwtVerify();
  });

  app.decorate('requireAdmin', async (request: FastifyRequest) => {
    await request.jwtVerify();
    if (request.user.role !== 'admin') throw forbidden('Admin role required');
  });
}
