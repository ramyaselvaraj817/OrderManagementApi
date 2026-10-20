import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';
import { AppError, conflict } from '../../lib/errors';
import { isPgError, PG_UNIQUE_VIOLATION } from '../../db/pool';
import type { Credentials, User } from './auth.schemas';

const BCRYPT_ROUNDS = 10;

interface UserRow {
  id: string;
  email: string;
  role: 'customer' | 'admin';
  password_hash: string;
}

export async function registerUser(db: Pool, { email, password }: Credentials): Promise<User> {
  // Never store plain passwords: bcrypt is slow and salted on purpose.
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const { rows } = await db.query<UserRow>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       RETURNING id, email, role`,
      [email, passwordHash],
    );
    const { id, role } = rows[0];
    return { id, email: rows[0].email, role };
  } catch (err) {
    // Let the UNIQUE constraint decide, instead of "SELECT then INSERT"
    // which has a race condition between the two statements.
    if (isPgError(err, PG_UNIQUE_VIOLATION)) {
      throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw err;
  }
}

export async function verifyCredentials(db: Pool, { email, password }: Credentials): Promise<User> {
  const { rows } = await db.query<UserRow>(
    'SELECT id, email, role, password_hash FROM users WHERE email = $1',
    [email],
  );
  const user = rows[0];
  // Same error for "no such user" and "wrong password" so attackers
  // can't use the login endpoint to find out which emails exist.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  return { id: user.id, email: user.email, role: user.role };
}
