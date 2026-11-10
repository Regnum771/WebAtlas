import type { CurrentUser } from '../../types/fastify';

/*
 * Who sees a catalogue resource: a published one is seen by everyone, signed in or not; an
 * unpublished one only by its owner (reviewers come with a later step). The owner is the user
 * whose identity-provider subject equals catalogue.resources.owner_sub.
 */

export interface VisibilityRow {
  is_published: boolean;
  owner_sub: string | null;
}

export function isOwner(user: CurrentUser | undefined, row: Pick<VisibilityRow, 'owner_sub'>): boolean {
  return !!user?.oidcSubject && row.owner_sub !== null && row.owner_sub === user.oidcSubject;
}

export function canView(user: CurrentUser | undefined, row: VisibilityRow): boolean {
  return row.is_published || isOwner(user, row);
}

/**
 * The same rule as a SQL condition on catalogue.resources, with the viewer's subject (or null)
 * as the parameter numbered `param`.
 */
export function visibleSql(param: number): string {
  return `(is_published OR (owner_sub IS NOT NULL AND owner_sub = NULLIF($${param}::text, '')))`;
}
