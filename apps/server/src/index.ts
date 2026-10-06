import { createLogger } from './logger.js';
import { startServer } from './server.js';

const log = createLogger('main');

startServer()
  .then((server) => {
    log.info(`Open ${server.url} (monitor: ${server.url}/monitor)`);
    const shutdown = (signal: string) => {
      log.info(`${signal} received, shutting down`);
      server
        .close()
        .catch((err) => log.error('Error during shutdown', err))
        .finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  })
  .catch((err) => {
    log.error('SOLAR failed to start', err);
    process.exit(1);
  });
