import { Link } from 'react-router-dom';
import { LogOut, Users } from 'lucide-react';
import type { Role } from '../../../entities/session/model/session.types';

export interface TopBarViewProps {
  email: string;
  role: Role;
  onLogout: () => void;
}

// Props-only. The admin entry is a UX reveal: the API enforces admin on every
// /api/users route regardless of whether this link is rendered.
export function TopBarView({ email, role, onLogout }: TopBarViewProps) {
  return (
    <div className="top-bar-profile">
      <span className="top-bar-email">{email}</span>
      {role === 'admin' && (
        <Link to="/admin/users" className="top-bar-link">
          <Users size={16} />
          <span>Manage users</span>
        </Link>
      )}
      <button type="button" className="top-bar-logout" onClick={onLogout}>
        <LogOut size={16} />
        <span>Log out</span>
      </button>
    </div>
  );
}
