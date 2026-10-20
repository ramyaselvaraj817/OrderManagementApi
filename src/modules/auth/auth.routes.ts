import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AuthResponseSchema, CredentialsSchema } from './auth.schemas';
import { registerUser, verifyCredentials } from './auth.service';

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/register',
    {
      schema: {
        tags: ['auth'],
        summary: 'Create a customer account and return a JWT',
        body: CredentialsSchema,
        response: { 201: AuthResponseSchema },
      },
    },
    async (request, reply) => {
      const user = await registerUser(app.db, request.body);
      const token = app.jwt.sign({ sub: user.id, role: user.role });
      return reply.status(201).send({ token, user });
    },
  );

  app.post(
    '/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Exchange email + password for a JWT',
        body: CredentialsSchema,
        response: { 200: AuthResponseSchema },
      },
    },
    async (request) => {
      const user = await verifyCredentials(app.db, request.body);
      const token = app.jwt.sign({ sub: user.id, role: user.role });
      return { token, user };
    },
  );
};
