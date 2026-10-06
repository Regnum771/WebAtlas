import { useMapContext } from '../../../app/providers/MapProvider';

/** Passive view — renders nothing when idle. `busy` is driven from outside. */
export function MapLoadingBarView({ busy }: { busy: boolean }) {
  if (!busy) return null;
  return (
    <div
      className="map-loading-bar"
      // Indeterminate: role="progressbar" with no aria-valuenow is the correct
      // ARIA for "working, duration unknown".
      role="progressbar"
      aria-label="Đang tải bản đồ"
    >
      <span className="map-loading-bar-fill" />
    </div>
  );
}

/** Container: `busy` comes from MapProvider (MapModel reports it through setLoadingListener, wired in MapView's init effect). */
export default function MapLoadingBar() {
  const { busy } = useMapContext();
  return <MapLoadingBarView busy={busy} />;
}
