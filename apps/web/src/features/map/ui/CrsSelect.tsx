import React from 'react';
import { CRS_OPTIONS } from '@webatlas/shared';
import { useCrsPreference } from '../model/crsPreference';

const CrsSelect: React.FC = () => {
  const [crsId, setCrsId] = useCrsPreference();
  return (
    <select
      className="map-crs-select"
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
