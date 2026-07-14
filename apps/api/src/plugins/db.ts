import fp from 'fastify-plugin';
import { getPool, closePool } from '../db/pool';

export default fp(async (app) => {
  app.decorate('pg', getPool());
  app.addHook('onClose', async () => {
    await closePool();
  });
});
