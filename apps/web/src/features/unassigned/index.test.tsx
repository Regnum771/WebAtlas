import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildUnitTree, type UnitNode } from '@webatlas/shared';
import { ApiError } from '../../shared/api/apiClient';

const UNITS: UnitNode[] = [
  { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
  { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
];
vi.mock('../../entities/session/model/session.store', () => ({
  useSession: () => ({ status: 'authenticated', currentUser: { isAdmin: true, grants: [] } }),
}));
vi.mock('../../entities/session/api/unitTree.api', () => ({
  fetchUnitTree: () => Promise.resolve(buildUnitTree(UNITS)),
}));
const fetchUnassigned = vi.fn();
const updateFeature = vi.fn();
vi.mock('./api/unassigned.api', () => ({ fetchUnassigned: () => fetchUnassigned() }));
vi.mock('../feature-editing/api/features.api', () => ({
  updateFeature: (...a: unknown[]) => updateFeature(...a),
  suggestManagingUnit: vi.fn(),
}));

import { UnassignedPanel } from './index';

const renderPanel = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <UnassignedPanel />
  </QueryClientProvider>,
);
const ROW = { layerKey: 'dams', id: 'u1', externalId: 'D-1', name: null };

beforeEach(() => { fetchUnassigned.mockReset(); updateFeature.mockReset(); });

describe('UnassignedPanel', () => {
  it('the unassigned page lists rows and assigns a unit', async () => {
    fetchUnassigned.mockResolvedValueOnce({ features: [ROW] }).mockResolvedValueOnce({ features: [] });
    updateFeature.mockResolvedValue({ id: 'u1', warnings: [] });
    renderPanel();
    expect(await screen.findByText('(không tên)')).toBeInTheDocument();
    expect(screen.getByText('Đập & Hồ chứa')).toBeInTheDocument();
    expect(screen.getByText('D-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Gán đơn vị' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Đà Nẵng/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(updateFeature).toHaveBeenCalledWith('dams', 'u1', { properties: { managing_unit: '48' } }));
    expect(await screen.findByText('Không còn đối tượng nào chưa gán đơn vị.')).toBeInTheDocument();
  });

  it('shows the save error in the dialog', async () => {
    fetchUnassigned.mockResolvedValue({ features: [ROW] });
    updateFeature.mockRejectedValue(new ApiError(403, 'OUT_OF_JURISDICTION', 'Đối tượng thuộc X.'));
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Gán đơn vị' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Đà Nẵng/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Đối tượng thuộc X.')).toBeInTheDocument();
  });

  it('shows an error with retry', async () => {
    fetchUnassigned.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ features: [] });
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Không còn đối tượng nào chưa gán đơn vị.')).toBeInTheDocument();
  });
});
