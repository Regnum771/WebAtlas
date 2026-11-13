import { useSession } from '../../entities/session/model/session.store';
import { useUnitTree } from '../../entities/session/model/useUnitTree';
import { ROLE_LABELS } from '../../entities/session/model/roleLabels';
import { usePlatformServices, findService } from '../../entities/platform/model/platformServices.store';
import { Spinner } from '../../shared/ui/Spinner';
import { scopeRows } from './model/profile';
import { ProfileView } from './ui/Profile.view';

/** /ho-so: the signed-in user's profile, over the live map. */
export default function ProfileRoute() {
  const { status, currentUser, method } = useSession();
  const tree = useUnitTree();
  const { services } = usePlatformServices();
  // .quan-ly-route places the page over the map; the page draws its own ground and spacing.
  const page = 'quan-ly-route bg-surface-2 p-0';
  if (status === 'authenticating') return <div className={page}><div className="px-6 py-8"><Spinner label="Đang tải…" /></div></div>;
  if (status !== 'authenticated' || !currentUser) {
    return (
      <div className={page}>
        <div data-slot="profile" className="mx-auto flex max-w-[960px] flex-col gap-2 px-6 py-8 text-body">
          <h1 className="text-page font-semibold">Hồ sơ</h1>
          <p className="text-ink-2">Đăng nhập để xem hồ sơ.</p>
        </div>
      </div>
    );
  }
  const keycloak = findService(services, 'keycloak');
  return (
    <div className={page}>
      <ProfileView
        name={currentUser.full_name}
        email={currentUser.email}
        roleLabel={ROLE_LABELS[currentUser.role]}
        signInMethod={method}
        isAdmin={currentUser.isAdmin}
        scope={scopeRows(currentUser.grants, tree)}
        accountUrl={keycloak?.url ?? null}
      />
    </div>
  );
}
