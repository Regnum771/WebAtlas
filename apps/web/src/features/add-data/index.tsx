import { useMapContext } from '../../app/providers/MapProvider';
import { addWmsOverlay } from '../map/model/wmsOverlay';
import { dismissToast, showToast } from '../../shared/ui/toast.store';
import { AddWmsFormView } from './ui/AddWmsForm.view';

/** Thêm dữ liệu: puts a reader's own WMS layer on the map and reports how it went in a popup. */
export default function AddData() {
  const { map } = useMapContext();

  const onAdd = (layer: { url: string; layerName: string }) => {
    // The map exists before anyone can reach this form; MapView sets it as it mounts.
    if (!map) return;
    const added = showToast({ tone: 'success', title: `Đã thêm lớp ${layer.layerName}` });
    addWmsOverlay(map, layer, () => {
      // The layer drew nothing and is gone again: take back "added" before saying so.
      dismissToast(added);
      showToast({ tone: 'error', title: `Không thêm được lớp ${layer.layerName}`, body: 'Kiểm tra địa chỉ và tên lớp.' });
    });
  };

  return <AddWmsFormView onAdd={onAdd} />;
}
