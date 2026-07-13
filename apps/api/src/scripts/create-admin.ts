import { getPool, closePool } from '../db/pool';
import { usersRepository } from '../modules/users/repository';
import { hashPassword } from '../lib/password';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : process.env[name.toUpperCase().replace(/-/g, '_')];
}

async function main() {
  const email = arg('email');
  const password = arg('password');
  const fullName = arg('name') ?? null;
  if (!email || !password) {
    console.error('Usage: npm run create-admin -w @webatlas/api -- --email <e> --password <p> [--name <n>]');
    process.exit(1);
  }
  const repo = usersRepository(getPool());
  const existing = await repo.findByEmailWithHash(email);
  if (existing) {
    await repo.update(existing.id, { role: 'admin', is_active: true });
    console.log(`Updated existing user ${email} to active admin`);
  } else {
    const u = await repo.insert({ email, password_hash: await hashPassword(password), full_name: fullName, role: 'admin' });
    console.log(`Created admin ${u.email} (${u.id})`);
  }
}
main().then(() => closePool()).catch((e) => { console.error(e); process.exitCode = 1; return closePool(); });
