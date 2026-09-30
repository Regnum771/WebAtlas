import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoiCandidatesView } from './RoiCandidates.view';

describe('RoiCandidatesView', () => {
  it('lists candidates with a "Dùng" action, and notes without one', async () => {
    const onUse = vi.fn();
    const roi = { source: 'admin' as const, level: 'province' as const, code: '66' };
    render(<RoiCandidatesView onUse={onUse} candidates={[
      { key: 'ward:zoom', label: 'Xã/phường', detail: '', roi: null, note: 'phóng to tới mức 10 để chọn xã' },
      { key: 'province:66', label: 'Tỉnh Đắk Lắk', detail: 'tỉnh', roi },
    ]} />);
    expect(screen.getByText('Dùng làm vùng phân tích:')).toBeInTheDocument();
    expect(screen.getByText('phóng to tới mức 10 để chọn xã')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Dùng Tỉnh Đắk Lắk làm vùng phân tích' }));
    expect(onUse).toHaveBeenCalledWith(roi);
  });

  it('renders nothing when there are no candidates', () => {
    const { container } = render(<RoiCandidatesView candidates={[]} onUse={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
