import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

/**
 * Creates an admin user (from ADMIN_EMAIL / ADMIN_PASSWORD) and a few sample
 * products so you can try the API right away. Safe to run more than once.
 */
async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const email = (process.env.ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? 'admin-password-123';

  try {
    await pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')
       ON CONFLICT (email) DO NOTHING`,
      [email, await bcrypt.hash(password, 10)],
    );

    const products = [
      ['KB-001', 'Mechanical Keyboard', 'Tactile switches, USB-C', 8999, 25],
      ['MS-001', 'Wireless Mouse', 'Ergonomic, 2.4GHz + Bluetooth', 3999, 40],
      ['MN-027', '27" Monitor', '1440p IPS, 144Hz', 27999, 8],
      ['HD-001', 'USB-C Hub', '7-in-1, HDMI 4K', 4599, 60],
    ];
    for (const [sku, name, description, price, stock] of products) {
      await pool.query(
        `INSERT INTO products (sku, name, description, price_cents, stock)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (sku) DO NOTHING`,
        [sku, name, description, price, stock],
      );
    }
    console.log(`Seeded admin ${email} and ${products.length} products`);
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
