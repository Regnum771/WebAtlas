import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Test-only. The package has no .env of its own: its tests run against the API's database, so
// when DATABASE_URL is not already set (CI sets it) it is read from apps/api/.env.
if (!process.env.DATABASE_URL) {
  const apiEnv = fileURLToPath(new URL('../../../apps/api/.env', import.meta.url));
  if (existsSync(apiEnv)) config({ path: apiEnv });
}
