import { useEffect, useState } from 'react';
import { useMapContext } from '../../app/providers/MapProvider';
import { useSession } from '../../entities/session/model/session.store';
import {
  refreshCatalogueLayers, removeCatalogueLayer, setCatalogueLayer, useCatalogueStore,
} from './model/catalogue.store';
import { syncCatalogueLayers } from './model/catalogueLayers';
import { setStepsFor } from '../time-slider/model/timeSlider.store';
import { unionSteps } from '../time-slider/model/timeSteps';
import { useCatalogueHover } from './model/useCatalogueHover';
import './ui/catalogue.css';
import { useCataloguePickerPresenter } from './model/useCataloguePickerPresenter';
import { useSaveToMapPresenter } from './model/useSaveToMapPresenter';
import { useTimeseriesUploadPresenter } from './model/useTimeseriesUploadPresenter';
import { CataloguePickerView } from './ui/CataloguePicker.view';
import { CatalogueLayersSectionView } from './ui/CatalogueLayersSection.view';
import { TimeseriesUploadDialogView } from './ui/TimeseriesUploadDialog.view';
import { viewExtent4326 } from './model/viewExtent';
import type { Clip4326 } from './api/catalogue.api';

/** This section's share of the time slider's steps (the personal maps' links supply their own). */
const STEPS_SOURCE = 'catalogue';

/**
 * The time-series upload dialog with its presenter. `viewExtent4326` reads the map's current view
 * for "Cắt theo khung bản đồ hiện tại".
 */
export function TimeseriesUploadDialog({ onClose, viewExtent4326: extent }: {
  onClose: () => void; viewExtent4326?: () => Clip4326 | null;
}) {
  const presenter = useTimeseriesUploadPresenter({ viewExtent4326: extent });
  return <TimeseriesUploadDialogView {...presenter} onClose={onClose} />;
}

/** The "Từ Danh mục" tab of Thêm dữ liệu: search the catalogue, put entries on the map, upload a time series. */
export function CataloguePicker() {
  const picker = useCataloguePickerPresenter();
  const { status } = useSession();
  const { map } = useMapContext();
  const [uploading, setUploading] = useState(false);
  return (
    <>
      <CataloguePickerView {...picker} canUpload={status === 'authenticated'} onUpload={() => setUploading(true)} />
      {uploading && <TimeseriesUploadDialog onClose={() => setUploading(false)} viewExtent4326={() => viewExtent4326(map)} />}
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
  const { status } = useSession();

  useEffect(() => {
    if (map) syncCatalogueLayers(map, layers, time);
  }, [map, layers, time]);
  // The visible time-series layers supply the steps of the shared time slider.
  useEffect(() => {
    setStepsFor(STEPS_SOURCE, unionSteps(layers
      .filter((l) => l.status === 'ok' && l.visible && l.item.kind === 'timeseries')
      .map((l) => l.item.timeSteps ?? [])));
  }, [layers]);
  useEffect(() => () => setStepsFor(STEPS_SOURCE, []), []);
  useCatalogueHover(map);
  // Unmounting the section takes the layers off the map.
  useEffect(() => () => { if (map) syncCatalogueLayers(map, [], null); }, [map]);
  // Entries may have been deleted or unshared since they were added, and signing in or out
  // changes what is visible (an unpublished entry becomes gone): re-check on mount and on each change.
  useEffect(() => { void refreshCatalogueLayers(); }, [status]);

  const signedIn = status === 'authenticated';
  const save = useSaveToMapPresenter({ enabled: signedIn });

  return (
    <CatalogueLayersSectionView
      layers={layers} onChange={setCatalogueLayer} onRemove={removeCatalogueLayer} save={signedIn ? save : undefined}
    />
  );
}
