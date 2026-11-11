import { useState } from 'react';
import { useMapContext } from '../../app/providers/MapProvider';
import { addWmsOverlay } from '../map/model/wmsOverlay';
import { dismissToast, showToast } from '../../shared/ui/toast.store';
import { CataloguePicker } from '../catalogue';
import { AddWmsFormView } from './ui/AddWmsForm.view';

/** Thêm dữ liệu: two tabs — catalogue entries (Từ Danh mục) and a reader's own WMS layer (WMS khác); the WMS one puts its layer on the map and reports how it went in a popup. */
export default function AddData() {
  const { map } = useMapContext();
  const [tab, setTab] = useState<'catalogue' | 'wms'>('catalogue');

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

  return (
    <div className="tool-section">
      <div className="tabs" role="tablist" aria-label="Nguồn dữ liệu">
        <button type="button" role="tab" id="add-data-tab-catalogue" aria-selected={tab === 'catalogue'}
          aria-controls="add-data-panel" className={tab === 'catalogue' ? 'tab on' : 'tab'} onClick={() => setTab('catalogue')}>
          Từ Danh mục
        </button>
        <button type="button" role="tab" id="add-data-tab-wms" aria-selected={tab === 'wms'}
          aria-controls="add-data-panel" className={tab === 'wms' ? 'tab on' : 'tab'} onClick={() => setTab('wms')}>
          WMS khác
        </button>
      </div>
      <div id="add-data-panel" role="tabpanel" aria-labelledby={`add-data-tab-${tab}`}>
        {tab === 'catalogue' ? <CataloguePicker /> : <AddWmsFormView onAdd={onAdd} />}
      </div>
    </div>
  );
}
