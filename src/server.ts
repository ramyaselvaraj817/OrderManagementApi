import 'dotenv/config';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db/pool';

async function main() {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  const app = await buildApp({ config, pool });

  // Graceful shutdown: stop accepting requests, finish in-flight ones, close DB.
  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(`Swagger UI at http://localhost:${config.PORT}/docs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
