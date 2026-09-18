import { fetchAdminUnits } from './adminUnits.api';

/**
 * Khung bao các tỉnh, nạp một lần lúc khởi động. Bộ thực thi lệnh là hàm đồng bộ, nên nó
 * đọc từ đây chứ không tự gọi mạng; trước khi nạp xong thì zoomToRegion lùi về toạ độ tâm
 * đóng gói sẵn (provinceCentroids.ts) — chỉ dùng cho khoảnh khắc khởi động đó.
 */
let bboxes: Record<string, [number, number, number, number]> = {};

export function setProvinceBboxes(next: Record<string, [number, number, number, number]>): void {
  bboxes = next;
}

export function getProvinceBbox(code: string): [number, number, number, number] | null {
  return bboxes[code] ?? null;
}

export async function primeAdminUnits(): Promise<void> {
  try {
    const units = await fetchAdminUnits('province');
    setProvinceBboxes(Object.fromEntries(units.map((u) => [u.code, u.bbox])));
  } catch {
    // Giữ nguyên bản rỗng: zoomToRegion vẫn chạy được bằng toạ độ tâm đóng gói sẵn.
  }
}
