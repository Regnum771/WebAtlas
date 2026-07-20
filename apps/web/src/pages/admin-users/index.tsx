import { Navigate, useNavigate } from 'react-router-dom';
import { RequireRole } from '../../features/auth/ui/RequireRole';
import { UserManagementPanel } from '../../features/user-management';

// UX gate ONLY. A non-admin who types this URL is redirected, but that is not
// the protection: the API enforces admin on every /api/users route, so a forced
// render still yields 401/403 on every call.
export default function AdminUsersRoute() {
  const navigate = useNavigate();
  return (
    <RequireRole role="admin" fallback={<Navigate to="/" replace />}>
      <div className="admin-users-route">
        <UserManagementPanel onClose={() => navigate('/')} />
      </div>
    </RequireRole>
  );
}
