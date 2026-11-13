import React from 'react';
import { CRS_OPTIONS } from '@webatlas/shared';
import { useCrsPreference } from '../model/crsPreference';

const CrsSelect: React.FC = () => {
  const [crsId, setCrsId] = useCrsPreference();
  return (
    <select
      className="map-crs-select h-6 w-[200px] max-w-full min-w-0 cursor-pointer truncate rounded-md border border-line bg-surface-2 px-1.5 text-label text-ink"
      value={crsId}
      onChange={(e) => setCrsId(e.target.value)}
      aria-label="Hệ quy chiếu hiển thị toạ độ"
      title="Hệ quy chiếu hiển thị toạ độ"
    >
      {CRS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.alias}</option>)}
    </select>
  );
};

export default CrsSelect;
