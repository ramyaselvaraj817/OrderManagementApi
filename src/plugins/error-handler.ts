import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors';

/**
 * One place that decides what every error response looks like:
 *
 *   { "error": { "code": "SOME_CODE", "message": "Human readable", "details"?: ... } }
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    // Our own expected errors (404, 409, ...)
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    // Request failed Zod validation (body, params, query or headers)
    if ((error as FastifyError).validation) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          details: (error as FastifyError).validation,
        },
      });
    }

    // Errors raised by Fastify or plugins already carry a statusCode
    // (401 from @fastify/jwt, 429 from @fastify/rate-limit, 415, ...).
    const statusCode = (error as FastifyError).statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled error');
      return reply.status(500).send({
        error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error' },
      });
    }

    return reply.status(statusCode).send({
      error: {
        code: (error as FastifyError).code ?? 'ERROR',
        message: error.message,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
    });
  });
}
