import type { CurrentUser } from '../../types/fastify';

/*
 * Who sees a catalogue resource: a published one that GeoNode lets anonymous users view
 * (public_view) is seen by everyone, signed in or not; any other one only by its owner (reviewers
 * come with a later step). The owner is the user whose identity-provider subject equals
 * catalogue.resources.owner_sub. GeoNode's own permissions count because the API reads GeoServer
 * with the admin account, which bypasses GeoFence: a published entry whose owner removed anonymous
 * view must not be drawn or copied for everyone.
 */

export interface VisibilityRow {
  is_published: boolean;
  public_view: boolean;
  owner_sub: string | null;
}

export interface DownloadRow extends VisibilityRow {
  public_download: boolean;
}

export function isOwner(user: CurrentUser | undefined, row: Pick<VisibilityRow, 'owner_sub'>): boolean {
  return !!user?.oidcSubject && row.owner_sub !== null && row.owner_sub === user.oidcSubject;
}

/** Shown to everyone: published and viewable by GeoNode's anonymous user. */
export function isPublic(row: Pick<VisibilityRow, 'is_published' | 'public_view'>): boolean {
  return row.is_published && row.public_view;
}

export function canView(user: CurrentUser | undefined, row: VisibilityRow): boolean {
  return isPublic(row) || isOwner(user, row);
}

/** Whose copy of the data (Sao vào Bản của tôi) is allowed: GeoNode's anonymous download, or the owner. */
export function canDownload(user: CurrentUser | undefined, row: DownloadRow): boolean {
  return (canView(user, row) && row.public_download) || isOwner(user, row);
}

/**
 * The same rule as canView, as a SQL condition on catalogue.resources, with the viewer's subject
 * (or null) as the parameter numbered `param`.
 */
export function visibleSql(param: number): string {
  return `((is_published AND public_view) OR (owner_sub IS NOT NULL AND owner_sub = NULLIF($${param}::text, '')))`;
}
