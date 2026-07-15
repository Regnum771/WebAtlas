import { DAM_STATUS_SLUGS, type DamStatusSlug } from '@webatlas/shared';

/** Stable non-negative hash of a string (djb2-ish), same as the frontend hashCode. */
function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash);
}

/**
 * Deterministically assign a dam status slug from its external id.
 * Weighted ~70/18/12 (normal/xa_lu/nguy_hiem). Same id -> same slug (idempotent seed).
 */
export function assignDamStatus(externalId: unknown): DamStatusSlug {
  const bucket = hashString(String(externalId)) % 100;
  if (bucket < 70) return DAM_STATUS_SLUGS[0]; // binh_thuong
  if (bucket < 88) return DAM_STATUS_SLUGS[1]; // xa_lu
  return DAM_STATUS_SLUGS[2];                   // nguy_hiem
}
