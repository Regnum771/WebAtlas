import { buildApp } from './server';
import { config } from './config/env';

const app = buildApp();
app
  .listen({ port: config.API_PORT, host: config.API_HOST })
  .then((addr) => app.log.info(`API listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
