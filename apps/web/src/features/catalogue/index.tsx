import { useEffect, useState } from 'react';
import { useMapContext } from '../../app/providers/MapProvider';
import { useSession } from '../../entities/session/model/session.store';
import {
  refreshCatalogueLayers, removeCatalogueLayer, setCatalogueLayer, useCatalogueStore,
} from './model/catalogue.store';
import { syncCatalogueLayers } from './model/catalogueLayers';
import { useCataloguePickerPresenter } from './model/useCataloguePickerPresenter';
import { useTimeseriesUploadPresenter } from './model/useTimeseriesUploadPresenter';
import { CataloguePickerView } from './ui/CataloguePicker.view';
import { CatalogueLayersSectionView } from './ui/CatalogueLayersSection.view';
import { TimeseriesUploadDialogView } from './ui/TimeseriesUploadDialog.view';

/** The time-series upload dialog with its presenter. */
export function TimeseriesUploadDialog({ onClose }: { onClose: () => void }) {
  const presenter = useTimeseriesUploadPresenter();
  return <TimeseriesUploadDialogView {...presenter} onClose={onClose} />;
}

/** The "Từ Danh mục" tab of Thêm dữ liệu: search the catalogue, put entries on the map, upload a time series. */
export function CataloguePicker() {
  const picker = useCataloguePickerPresenter();
  const { status } = useSession();
  const [uploading, setUploading] = useState(false);
  return (
    <>
      <CataloguePickerView {...picker} canUpload={status === 'authenticated'} onUpload={() => setUploading(true)} />
      {uploading && <TimeseriesUploadDialog onClose={() => setUploading(false)} />}
    </>
  );
}

/**
 * The catalogue layers on the map, above the layer panel. `time` is the slider time for
 * time-series layers (null: none yet); the section keeps the map's catalogue layers in step.
 */
export default function CatalogueLayersSection({ time = null }: { time?: string | null }) {
  const { map } = useMapContext();
  const layers = useCatalogueStore();

  useEffect(() => {
    if (map) syncCatalogueLayers(map, layers, time);
  }, [map, layers, time]);
  // Leaving (e.g. signing out) takes the layers off the map.
  useEffect(() => () => { if (map) syncCatalogueLayers(map, [], null); }, [map]);
  // Entries may have been deleted or unshared since they were added.
  useEffect(() => { void refreshCatalogueLayers(); }, []);

  return <CatalogueLayersSectionView layers={layers} onChange={setCatalogueLayer} onRemove={removeCatalogueLayer} />;
}
