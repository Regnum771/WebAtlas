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
