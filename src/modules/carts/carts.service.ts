import type { Pool } from 'pg';
import { conflict, notFound } from '../../lib/errors';
import type { Cart } from './carts.schemas';

interface CartRow {
  product_id: string;
  name: string;
  price_cents: number;
  quantity: number;
}

export async function getCart(db: Pool, userId: string): Promise<Cart> {
  // Prices are read live from products: the cart always shows the current
  // price. The price is "frozen" only when an order is placed.
  const { rows } = await db.query<CartRow>(
    `SELECT ci.product_id, p.name, p.price_cents, ci.quantity
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.user_id = $1
     ORDER BY ci.added_at, ci.product_id`,
    [userId],
  );
  const items = rows.map((r) => ({
    productId: r.product_id,
    name: r.name,
    priceCents: r.price_cents,
    quantity: r.quantity,
    lineTotalCents: r.price_cents * r.quantity,
  }));
  return { items, totalCents: items.reduce((sum, i) => sum + i.lineTotalCents, 0) };
}

/** Sets the quantity of a product in the cart (adds it if it isn't there yet). */
export async function setItemQuantity(db: Pool, userId: string, productId: string, quantity: number): Promise<Cart> {
  const { rows } = await db.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [productId]);
  if (!rows[0]) throw notFound('Product');

  // Early, friendly check. The authoritative check happens again at checkout,
  // inside the transaction, because stock can change in between.
  if (quantity > rows[0].stock) {
    throw conflict('INSUFFICIENT_STOCK', 'Not enough stock for the requested quantity', {
      productId,
      requested: quantity,
      available: rows[0].stock,
    });
  }

  // "Upsert": insert, or update the quantity if this product is already in the cart.
  await db.query(
    `INSERT INTO cart_items (user_id, product_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
    [userId, productId, quantity],
  );
  return getCart(db, userId);
}

export async function removeItem(db: Pool, userId: string, productId: string): Promise<Cart> {
  const { rowCount } = await db.query('DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2', [
    userId,
    productId,
  ]);
  if (!rowCount) throw notFound('Cart item');
  return getCart(db, userId);
}

export async function clearCart(db: Pool, userId: string): Promise<void> {
  await db.query('DELETE FROM cart_items WHERE user_id = $1', [userId]);
}
