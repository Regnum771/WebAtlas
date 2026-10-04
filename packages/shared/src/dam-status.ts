export const DAM_STATUS_SLUGS = ['binh_thuong', 'xa_lu', 'nguy_hiem'] as const;
export type DamStatusSlug = (typeof DAM_STATUS_SLUGS)[number];

export interface DamStatusDisplay {
  label: string;
  color: string;
}

export const DAM_STATUS_DISPLAY: Record<DamStatusSlug, DamStatusDisplay> = {
  binh_thuong: { label: 'Bình thường', color: '#10b981' },
  xa_lu: { label: 'Xả lũ', color: '#f59e0b' },
  nguy_hiem: { label: 'Nguy hiểm', color: '#ef4444' },
};

// Reverse lookup: Vietnamese label -> slug (for legacy display-string data).
const LABEL_TO_SLUG: Record<string, DamStatusSlug> = Object.fromEntries(
  (Object.keys(DAM_STATUS_DISPLAY) as DamStatusSlug[]).map((slug) => [DAM_STATUS_DISPLAY[slug].label, slug])
);

/** Coerce any DB/user value to a known slug; null/unknown -> binh_thuong. */
export function toDamStatusSlug(v: unknown): DamStatusSlug {
  if (typeof v === 'string') {
    if ((DAM_STATUS_SLUGS as readonly string[]).includes(v)) return v as DamStatusSlug;
    if (LABEL_TO_SLUG[v]) return LABEL_TO_SLUG[v];
  }
  return 'binh_thuong';
}

/** slug/value -> { label, color }, with the safe default. */
export function damStatusDisplay(v: unknown): DamStatusDisplay {
  return DAM_STATUS_DISPLAY[toDamStatusSlug(v)];
}

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
