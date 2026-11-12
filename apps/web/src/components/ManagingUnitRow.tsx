import { Building2 } from 'lucide-react';
import { useUnitTree } from '../entities/session/model/useUnitTree';

/**
 * The "Đơn vị chủ quản" row of a feature card, shared by every editable layer.
 * Renders nothing without a unit, so layers that carry none (boundaries, basemap) stay untouched.
 */
export function ManagingUnitRow({ unit }: { unit: unknown }) {
  if (typeof unit !== 'string' || unit === '') return null;
  return <ManagingUnitName code={unit} />;
}

// Split out so the unit tree is only requested for a card that has a unit to name.
function ManagingUnitName({ code }: { code: string }) {
  const tree = useUnitTree();
  return (
    <div className="info-row"><Building2 size={14} />
      <span>Đơn vị chủ quản: <strong>{tree?.get(code)?.name ?? code}</strong></span></div>
  );
}
