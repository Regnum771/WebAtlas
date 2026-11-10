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
  if (status === 'authenticating') return <div className="quan-ly-route"><Spinner label="Đang tải…" /></div>;
  if (status !== 'authenticated' || !currentUser) {
    return (
      <div className="quan-ly-route">
        <div className="quan-ly-section"><h2>Hồ sơ</h2><p>Đăng nhập để xem hồ sơ.</p></div>
      </div>
    );
  }
  const keycloak = findService(services, 'keycloak');
  return (
    <div className="quan-ly-route">
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
