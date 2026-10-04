export declare const DAM_STATUS_SLUGS: readonly ["binh_thuong", "xa_lu", "nguy_hiem"];
export type DamStatusSlug = (typeof DAM_STATUS_SLUGS)[number];
export interface DamStatusDisplay {
    label: string;
    color: string;
}
export declare const DAM_STATUS_DISPLAY: Record<DamStatusSlug, DamStatusDisplay>;
/** Coerce any DB/user value to a known slug; null/unknown -> binh_thuong. */
export declare function toDamStatusSlug(v: unknown): DamStatusSlug;
/** slug/value -> { label, color }, with the safe default. */
export declare function damStatusDisplay(v: unknown): DamStatusDisplay;
/**
 * Deterministically assign a dam status slug from its external id.
 * Weighted ~70/18/12 (normal/xa_lu/nguy_hiem). Same id -> same slug (idempotent seed).
 */
export declare function assignDamStatus(externalId: unknown): DamStatusSlug;
