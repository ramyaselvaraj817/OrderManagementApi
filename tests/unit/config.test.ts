import { loadConfig } from '../../src/config';

describe('loadConfig', () => {
  const base = { DATABASE_URL: 'postgres://localhost/db', JWT_SECRET: 'a-very-long-secret-value' };

  it('applies defaults and coerces numbers', () => {
    const config = loadConfig({ ...base, PORT: '8080' });
    expect(config.PORT).toBe(8080);
    expect(config.ORDER_RATE_LIMIT_MAX).toBe(10);
    expect(config.NODE_ENV).toBe('development');
  });

  it('fails fast with a readable message when required values are missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a JWT secret that is too short', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });
});
