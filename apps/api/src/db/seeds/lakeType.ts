// HydroLAKES Lake_type is a coded integer; map it to a human label.
// 1 = Lake, 2 = Reservoir, 3 = Lake control (regulated lake/reservoir).
const LAKE_TYPE_LABEL: Record<number, string> = {
  1: 'Lake',
  2: 'Reservoir',
  3: 'Lake control',
};

export function lakeTypeLabel(code: unknown): string | null {
  return typeof code === 'number' ? (LAKE_TYPE_LABEL[code] ?? null) : null;
}
