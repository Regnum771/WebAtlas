import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** The repository root, from this file's location (apps/api/src/config). */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
/** Where the workspace file store lives when WORKSPACE_FILES_DIR is not set. */
export const DEFAULT_WORKSPACE_FILES_DIR = path.join(REPO_ROOT, 'var', 'workspace-files');

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
  /** Where build_scenarios.py wrote the flood frames; defaults to the repo cache path. */
  FLOOD_FRAMES_DIR: z.string().optional(),
  /** Root of the workspace file store (uploads, COGs, exports); see workspaceFilesDir(). */
  WORKSPACE_FILES_DIR: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export const config: AppConfig = EnvSchema.parse(process.env);

/**
 * The workspace file store root. Read from the environment on every call rather than from
 * `config`, which is parsed once at import: tests point the store at a temp directory after the
 * app's modules are loaded. An empty value counts as unset.
 */
export function workspaceFilesDir(): string {
  return EnvSchema.shape.WORKSPACE_FILES_DIR.parse(process.env.WORKSPACE_FILES_DIR) || DEFAULT_WORKSPACE_FILES_DIR;
}
