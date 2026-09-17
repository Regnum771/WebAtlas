import { useMapContext } from '../../../app/providers/MapProvider';

/**
 * Passive view — renders nothing when idle. `busy` and `flyoutOpen` are both
 * driven from outside; this component makes no decisions of its own beyond
 * the CSS class.
 */
export function MapLoadingBarView({ busy, flyoutOpen }: { busy: boolean; flyoutOpen: boolean }) {
  if (!busy) return null;
  return (
    <div
      className={`map-loading-bar${flyoutOpen ? ' flyout-open' : ''}`}
      // Indeterminate: role="progressbar" with no aria-valuenow is the correct
      // ARIA for "working, duration unknown".
      role="progressbar"
      aria-label="Đang tải bản đồ"
    >
      <span className="map-loading-bar-fill" />
    </div>
  );
}

/**
 * Container: `busy` comes from MapProvider (MapModel reports it through
 * setLoadingListener, wired in MapView's init effect). `flyoutOpen` is passed
 * down from RailAndFlyout, the same shape MapToolbar already uses.
 */
export default function MapLoadingBar({ flyoutOpen }: { flyoutOpen: boolean }) {
  const { busy } = useMapContext();
  return <MapLoadingBarView busy={busy} flyoutOpen={flyoutOpen} />;
}
