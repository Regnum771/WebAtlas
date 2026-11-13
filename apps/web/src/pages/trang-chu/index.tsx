import { useQuery } from '@tanstack/react-query';
import { useSession } from '../../entities/session/model/session.store';
import { useCan } from '../../entities/session/model/useCan';
import { usePlatformServices } from '../../entities/platform/model/platformServices.store';
import { fetchRecentCatalogue } from '../../features/catalogue/api/catalogue.api';
import { hubTiles } from './model/hubTiles';
import { HubView, type RecentState } from './ui/Hub.view';

/** /: the hub, over the live map like every other page. */
export default function HubRoute() {
  const { status, currentUser } = useSession();
  const can = useCan();
  const { services } = usePlatformServices();
  const user = status === 'authenticated' ? currentUser : null;
  // Per account: what the reader may see differs between visitors and owners.
  const recentQuery = useQuery({ queryKey: ['catalogue', 'recent', user?.id ?? null], queryFn: () => fetchRecentCatalogue(6) });
  const recent: RecentState = recentQuery.isPending ? { status: 'loading' }
    : recentQuery.isError ? { status: 'error', retry: () => void recentQuery.refetch() }
    : { status: 'ok', items: recentQuery.data.items };
  return (
    // .quan-ly-route places a routed page over the map (and stops it at a docked Trợ lý); the hub draws
    // its own ground, so it drops that page's padding and paper background.
    <div className="quan-ly-route hub-route bg-surface-2 p-0">
      <HubView tiles={hubTiles(user, can, services)} recent={recent} />
    </div>
  );
}
