import { useNavigate } from 'react-router-dom';
import { UserManagementPanel } from '../../../features/user-management';

// UX gate lives in the Quản lý layout; the API enforces users.manage on every /api/users route.
export default function NguoiDung() {
  const navigate = useNavigate();
  return <UserManagementPanel onClose={() => navigate('/')} />;
}
