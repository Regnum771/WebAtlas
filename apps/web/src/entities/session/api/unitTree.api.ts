import { buildUnitTree, type UnitNode, type UnitTree } from '@webatlas/shared';
import { apiRequest } from '../../../shared/api/apiClient';

export async function fetchUnitTree(): Promise<UnitTree> {
  const { units } = await apiRequest<{ units: UnitNode[] }>('/api/admin-units/tree');
  return buildUnitTree(units);
}
