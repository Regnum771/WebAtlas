import { LogOut } from 'lucide-react';

export interface UserBadgeViewProps {
  email: string;
  onLogout: () => void;
}

export function UserBadgeView({ email, onLogout }: UserBadgeViewProps) {
  return (
    <div className="user-badge glass-panel">
      <span className="user-badge-email">{email}</span>
      <button type="button" className="user-badge-logout" onClick={onLogout} title="Log out">
        <LogOut size={16} />
        <span>Log out</span>
      </button>
    </div>
  );
}
