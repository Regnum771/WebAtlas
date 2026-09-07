/**
 * The parser half of the SQL escape hatch. This is NOT the security boundary —
 * the database privileges of the webatlas_assistant role are (see the
 * assistant-db-role migration and privileges.test.ts). This layer exists so
 * ordinary mistakes fail fast and cheaply, and so obviously hostile input never
 * reaches a connection at all.
 *
 * Treat every rule here as defence in depth. If a rule and the grant table ever
 * disagree about whether something is allowed, the grant table wins.
 */
export const SQL_ROW_LIMIT = 200;
const MAX_SQL_LENGTH = 2000;

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

/**
 * Word-boundary anchored so ordinary identifiers are not caught by substring:
 * `created_at` contains "create", `updated_at` contains "update", `OFFSET`
 * contains "set". Each of those has a test.
 */
const FORBIDDEN = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate',
  'grant', 'revoke', 'copy', 'vacuum', 'analyze', 'reindex', 'cluster',
  'call', 'do', 'set', 'reset', 'listen', 'notify', 'lock', 'prepare',
  'execute', 'refresh', 'comment', 'security', 'returning',
];

const FORBIDDEN_FUNCTIONS = [
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file',
  'lo_import', 'lo_export', 'dblink', 'pg_sleep', 'pg_terminate_backend',
  'pg_reload_conf', 'set_config', 'current_setting',
];

export function guardSql(raw: string): GuardResult {
  const sql = raw.trim().replace(/;+\s*$/, '').trim();

  if (sql.length === 0) return { ok: false, reason: 'Câu truy vấn rỗng.' };
  if (sql.length > MAX_SQL_LENGTH) {
    return { ok: false, reason: `Câu truy vấn quá dài (tối đa ${MAX_SQL_LENGTH} ký tự).` };
  }
  // Comments can hide the rest of a statement from a human reviewer reading the
  // provenance block, which is the only reason the escape hatch is acceptable.
  if (sql.includes('--') || sql.includes('/*')) {
    return { ok: false, reason: 'Không cho phép chú thích trong câu truy vấn.' };
  }
  // A remaining semicolon after the trailing one was stripped means more than
  // one statement.
  if (sql.includes(';')) {
    return { ok: false, reason: 'Chỉ cho phép một câu lệnh duy nhất.' };
  }
  if (!/^(select|with)\b/i.test(sql)) {
    return { ok: false, reason: 'Chỉ cho phép SELECT hoặc WITH.' };
  }
  for (const word of FORBIDDEN) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(sql)) {
      return { ok: false, reason: `Từ khoá "${word}" không được phép.` };
    }
  }
  for (const fn of FORBIDDEN_FUNCTIONS) {
    if (new RegExp(`\\b${fn}\\s*\\(`, 'i').test(sql)) {
      return { ok: false, reason: `Hàm "${fn}" không được phép.` };
    }
  }

  // The outer LIMIT is enforced regardless of what the inner query says: an
  // inner LIMIT is the model's intent, this is the system's ceiling.
  return { ok: true, sql: `SELECT * FROM (${sql}) AS assistant_query LIMIT ${SQL_ROW_LIMIT}` };
}
