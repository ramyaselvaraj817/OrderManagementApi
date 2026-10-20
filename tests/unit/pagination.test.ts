import { buildPage, decodeCursor, encodeCursor } from '../../src/lib/pagination';
import { AppError } from '../../src/lib/errors';

describe('cursor pagination helpers', () => {
  const cursor = { createdAt: '2026-01-02T03:04:05.678Z', id: '5f0c6a2e-8b1c-4c3e-9a51-0d7d2f1e9b10' };

  it('round-trips a cursor through encode/decode', () => {
    const encoded = encodeCursor(cursor);
    expect(typeof encoded).toBe('string');
    expect(encoded).not.toContain('{'); // opaque to clients
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it.each([
    ['not base64 json', 'garbage!!'],
    ['missing id', Buffer.from(JSON.stringify({ createdAt: cursor.createdAt })).toString('base64url')],
    ['bad date', Buffer.from(JSON.stringify({ createdAt: 'nope', id: cursor.id })).toString('base64url')],
    ['bad uuid', Buffer.from(JSON.stringify({ createdAt: cursor.createdAt, id: '123' })).toString('base64url')],
  ])('rejects a malformed cursor (%s) with a 400 AppError', (_label, raw) => {
    expect(() => decodeCursor(raw)).toThrow(AppError);
    try {
      decodeCursor(raw);
    } catch (err) {
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).code).toBe('INVALID_CURSOR');
    }
  });

  it('buildPage returns a next cursor only when there are more rows', () => {
    const rows = [1, 2, 3].map((n) => ({ id: `id-${n}`, createdAt: `2026-01-0${n}T00:00:00.000Z` }));

    const full = buildPage(rows, 2); // 3 rows fetched for limit 2 -> has more
    expect(full.items).toHaveLength(2);
    expect(full.nextCursor).not.toBeNull();
    expect(decodeCursorUnsafe(full.nextCursor!)).toEqual({ id: 'id-2', createdAt: rows[1].createdAt });

    const last = buildPage(rows.slice(0, 2), 2); // exactly limit rows -> last page
    expect(last.items).toHaveLength(2);
    expect(last.nextCursor).toBeNull();
  });
});

// The test ids above aren't UUIDs, so read the raw JSON directly.
function decodeCursorUnsafe(raw: string) {
  return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
}
