import type { Pool } from 'pg';
import { conflict, notFound } from '../../lib/errors';
import { buildPage, decodeCursor } from '../../lib/pagination';
import { isPgError, PG_UNIQUE_VIOLATION } from '../../db/pool';
import type { CreateProductInput, Product, UpdateProductInput } from './products.schemas';

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  price_cents: number;
  stock: number;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = 'id, sku, name, description, price_cents, stock, created_at, updated_at';

/** DB row (snake_case, Date) -> API shape (camelCase, ISO string). */
function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    stock: row.stock,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listProducts(db: Pool, limit: number, rawCursor?: string) {
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  const { rows } = await db.query<ProductRow>(
    `SELECT ${COLUMNS} FROM products
     WHERE ($1::timestamptz IS NULL OR (created_at, id) < ($1::timestamptz, $2::uuid))
     ORDER BY created_at DESC, id DESC
     LIMIT $3`,
    [cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
  );
  return buildPage(rows.map(toProduct), limit);
}

export async function getProduct(db: Pool, id: string): Promise<Product> {
  const { rows } = await db.query<ProductRow>(`SELECT ${COLUMNS} FROM products WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('Product');
  return toProduct(rows[0]);
}

export async function createProduct(db: Pool, input: CreateProductInput): Promise<Product> {
  try {
    const { rows } = await db.query<ProductRow>(
      `INSERT INTO products (sku, name, description, price_cents, stock)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLUMNS}`,
      [input.sku, input.name, input.description ?? null, input.priceCents, input.stock],
    );
    return toProduct(rows[0]);
  } catch (err) {
    if (isPgError(err, PG_UNIQUE_VIOLATION)) throw conflict('SKU_TAKEN', `SKU ${input.sku} already exists`);
    throw err;
  }
}

export async function updateProduct(db: Pool, id: string, input: UpdateProductInput): Promise<Product> {
  // COALESCE($n, column) keeps the current value when a field wasn't sent.
  try {
    const { rows } = await db.query<ProductRow>(
      `UPDATE products SET
         sku         = COALESCE($2, sku),
         name        = COALESCE($3, name),
         description = COALESCE($4, description),
         price_cents = COALESCE($5, price_cents),
         stock       = COALESCE($6, stock),
         updated_at  = now()
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [
        id,
        input.sku ?? null,
        input.name ?? null,
        input.description ?? null,
        input.priceCents ?? null,
        input.stock ?? null,
      ],
    );
    if (!rows[0]) throw notFound('Product');
    return toProduct(rows[0]);
  } catch (err) {
    if (isPgError(err, PG_UNIQUE_VIOLATION)) throw conflict('SKU_TAKEN', `SKU ${input.sku} already exists`);
    throw err;
  }
}
