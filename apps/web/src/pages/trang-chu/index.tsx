import { useSession } from '../../entities/session/model/session.store';
import { useCan } from '../../entities/session/model/useCan';
import { usePlatformServices } from '../../entities/platform/model/platformServices.store';
import { hubTiles } from './model/hubTiles';
import { HubView } from './ui/Hub.view';

/** /: the hub, over the live map like every other page. */
export default function HubRoute() {
  const { status, currentUser } = useSession();
  const can = useCan();
  const { services } = usePlatformServices();
  const user = status === 'authenticated' ? currentUser : null;
  return (
    <div className="quan-ly-route hub-route">
      <HubView tiles={hubTiles(user, can, services)} />
    </div>
  );
}
