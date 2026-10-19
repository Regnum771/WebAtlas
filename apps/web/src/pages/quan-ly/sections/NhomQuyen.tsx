import { AccessGroupsPanel } from '../../../features/access-groups';

// UX gate lives in the Quản lý layout; the API enforces admin on every write.
export default function NhomQuyen() {
  return <AccessGroupsPanel />;
}
