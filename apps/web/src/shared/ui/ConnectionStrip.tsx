import { WifiOff } from 'lucide-react';
import { useOnline } from './useOnline';

/** Shown above the map only while the browser is offline. */
export function ConnectionStrip() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="connection-strip" role="status">
      <WifiOff size={16} aria-hidden="true" />
      <span>Mất kết nối. Dữ liệu sẽ tải lại khi có mạng.</span>
    </div>
  );
}
