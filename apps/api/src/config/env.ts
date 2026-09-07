import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  API_PORT: z.coerce.number().default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  // Optional: env.ts parses at import time and every API test builds the app,
  // so a required key would break the whole suite and every dev machine that
  // has not been given one. The route returns 503 when it is absent.
  ANTHROPIC_API_KEY: z.string().optional(),
  ASSISTANT_MODEL: z.string().default('claude-haiku-4-5'),
  /** Tokens per user per UTC day. 0 disables the ceiling. */
  ASSISTANT_DAILY_TOKEN_BUDGET: z.coerce.number().int().min(0).default(200000),
  ASSISTANT_SESSION_TTL_MS: z.coerce.number().int().min(60000).default(1800000),
  /** Connection string for the read-only webatlas_assistant role (Task 8). */
  ASSISTANT_DATABASE_URL: z.string().url().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export const config: AppConfig = EnvSchema.parse(process.env);
