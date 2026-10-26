import { createApp } from './app.js';
import { config } from './shared/config.js';
import { logger } from './shared/logger.js';

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info('PlanPal server started', { port: config.PORT, env: config.NODE_ENV });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => { logger.info('Server closed'); process.exit(0); });
});
process.on('SIGINT', () => {
  server.close(() => { logger.info('Server closed'); process.exit(0); });
});
