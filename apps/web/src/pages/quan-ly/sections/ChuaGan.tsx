import { UnassignedPanel } from '../../../features/unassigned';

// UX gate lives in the Quản lý layout; the API enforces jurisdiction on every write.
export default function ChuaGan() {
  return <UnassignedPanel />;
}
