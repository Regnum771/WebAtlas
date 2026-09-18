import { apiRequest } from '../../shared/api/apiClient';

export interface AdminUnit {
  code: string;
  name: string;
  fullName: string | null;
  level: 'province' | 'ward';
  bbox: [number, number, number, number];
}

export async function fetchAdminUnits(
  level: 'province' | 'ward',
  province?: string
): Promise<AdminUnit[]> {
  const query = province ? `?level=${level}&province=${encodeURIComponent(province)}` : `?level=${level}`;
  const body = await apiRequest<{ units: AdminUnit[] }>(`/api/admin-units${query}`);
  return body.units;
}
