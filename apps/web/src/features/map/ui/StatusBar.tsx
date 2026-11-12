import { useRoi } from '../../roi/model/roi.store';
import { setCoordinatesTarget, setScaleLineTarget } from '../model/readoutTargets';
import ScaleSlider from './ScaleSlider';
import CursorElevation from './CursorElevation';
import CrsSelect from './CrsSelect';
import { StatusBarView } from './StatusBar.view';

/**
 * The status bar along the map's bottom edge. The selection count reads the analysis region
 * (the one selection the map keeps today): one feature or area while it is set, else none.
 */
export default function StatusBar() {
  const { resolved } = useRoi();
  return (
    <StatusBarView
      scale={<ScaleSlider />}
      scaleLineRef={setScaleLineTarget}
      coordinatesRef={setCoordinatesTarget}
      elevation={<CursorElevation />}
      crs={<CrsSelect />}
      selection={{ count: resolved ? 1 : 0, label: resolved?.label ?? null }}
    />
  );
}
