import React from 'react';
import { useMapContext } from '../../../app/providers/MapProvider';
import { useCursorElevation } from '../model/useCursorElevation';

/**
 * Ô "Độ cao" ngay trên ô toạ độ góc dưới phải.
 *
 * Ẩn hẳn — chứ không hiện "—" — trong ba trường hợp: chưa rê chuột lần nào, con trỏ ở
 * ngoài vùng có DEM (ví dụ ngoài biển), và máy chủ chưa nạp DEM. Một ô trống nằm đó mãi
 * trông như hỏng; không có ô thì đúng là "chỗ này không có số liệu độ cao".
 *
 * Làm tròn tới mét: DEM là lưới 30 m và là mô hình BỀ MẶT (có tán cây, nhà cửa), nên
 * phần thập phân chỉ tạo cảm giác chính xác giả.
 */
const CursorElevation: React.FC = () => {
  const { map } = useMapContext();
  const { elevationM, pending } = useCursorElevation(map);

  if (elevationM === null && !pending) return null;

  return (
    <div className="map-cursor-elevation" aria-live="off">
      Độ cao: {elevationM === null ? '…' : `${Math.round(elevationM)} m`}
    </div>
  );
};

export default CursorElevation;
