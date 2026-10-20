import { badRequest } from './errors';

/**
 * Cursor-based (a.k.a. keyset) pagination.
 *
 * Instead of `LIMIT 20 OFFSET 400` (which makes Postgres read and throw away
 * 400 rows, and skips/duplicates rows when new ones are inserted), we remember
 * the position of the last row we returned and ask for rows "after" it:
 *
 *   WHERE (created_at, id) < ($cursorCreatedAt, $cursorId)
 *   ORDER BY created_at DESC, id DESC
 *   LIMIT $limit + 1
 *
 * `id` is the tie-breaker so two rows with the same timestamp are still
 * strictly ordered. The cursor is opaque to clients: base64url(JSON).
 */
export interface Cursor {
  createdAt: string; // ISO timestamp
  id: string; // uuid
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeCursor(raw: string): Cursor {
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof value?.createdAt === 'string' &&
      !Number.isNaN(Date.parse(value.createdAt)) &&
      typeof value?.id === 'string' &&
      UUID_RE.test(value.id)
    ) {
      return { createdAt: value.createdAt, id: value.id };
    }
  } catch {
    // fall through
  }
  throw badRequest('INVALID_CURSOR', 'Cursor is malformed');
}

/**
 * Given `limit + 1` rows from the database, returns the page and the cursor
 * for the next page (null when there are no more rows).
 */
export function buildPage<T extends { id: string; createdAt: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}
