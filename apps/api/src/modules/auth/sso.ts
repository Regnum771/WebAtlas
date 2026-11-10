import type { FastifyInstance } from 'fastify';
import { usersRepository, type UserRow } from '../users/repository';
import type { OidcIdentity } from './oidc';

/** Why a verified provider identity still gets no WebAtlas session; the web app words each one. */
export type SsoRefusal = 'inactive' | 'email' | 'conflict';

/**
 * The WebAtlas user for a provider identity:
 *   1. the user already linked to this subject;
 *   2. else the user with the same email, linked now, but only when the provider has verified that
 *      email (otherwise anyone able to register an address at the provider could take the account);
 *   3. else a new reader.
 */
export async function resolveSsoUser(
  app: FastifyInstance, id: OidcIdentity,
): Promise<{ user: UserRow } | { refused: SsoRefusal }> {
  const repo = usersRepository(app.pg);
  const linked = await repo.findByOidcSubject(id.subject);
  if (linked) return linked.is_active ? { user: linked } : { refused: 'inactive' };

  if (!id.email) return { refused: 'email' };
  const byEmail = await repo.findByEmailForSso(id.email);
  if (byEmail) {
    if (byEmail.oidc_subject !== null) return { refused: 'conflict' };
    if (!id.emailVerified) return { refused: 'email' };
    if (!byEmail.is_active) return { refused: 'inactive' };
    const user = await repo.linkOidcSubject(byEmail.id, id.subject);
    return user ? { user } : { refused: 'conflict' };
  }
  try {
    return { user: await repo.insertSso({ email: id.email, full_name: id.name, oidc_subject: id.subject }) };
  } catch (e) {
    // Two first sign-ins racing for the same email or subject.
    if ((e as { code?: string }).code === '23505') return { refused: 'conflict' };
    throw e;
  }
}
