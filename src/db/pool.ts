import { Pool, PoolClient } from 'pg';

export type Db = Pool;

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10 });
}

/**
 * Runs `fn` inside a single database transaction.
 *
 * - BEGIN before calling fn
 * - COMMIT if fn resolves
 * - ROLLBACK if fn throws (then re-throws the error)
 *
 * Every query inside fn must use the `client` it receives, not the pool:
 * a transaction lives on one connection.
 */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Postgres error code for unique_violation. */
export const PG_UNIQUE_VIOLATION = '23505';

export function isPgError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === code;
}
