import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_PARAMS } from '../model/tools';
import { AnalysisParamsView, type AnalysisParamsViewProps } from './AnalysisParams.view';

const props = (over: Partial<AnalysisParamsViewProps> = {}): AnalysisParamsViewProps => ({
  tool: 'nearest', roiLabel: 'Sông Thu Bồn', params: DEFAULT_PARAMS, status: 'params', error: null,
  onParams: vi.fn(), onRun: vi.fn(), onCancel: vi.fn(), ...over,
});

describe('AnalysisParamsView', () => {
  it('runs and cancels from its two buttons', async () => {
    const p = props();
    render(<AnalysisParamsView {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Chạy' }));
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(p.onRun).toHaveBeenCalledTimes(1);
    expect(p.onCancel).toHaveBeenCalledTimes(1);
  });

  it('while running, the run button says so and ignores a second press', async () => {
    const p = props({ status: 'running' });
    render(<AnalysisParamsView {...p} />);
    const run = screen.getByRole('button', { name: 'Đang tính' });
    expect(run).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(run);
    expect(p.onRun).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Chạy' })).toBeNull();
  });

  it('a run that fails says why as an alert', () => {
    const { container } = render(<AnalysisParamsView {...props({ error: 'Vùng quá lớn' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Vùng quá lớn');
    expect(container.querySelector('.msg.bad')).not.toBeNull();
  });

  it('shows no alert when nothing failed', () => {
    render(<AnalysisParamsView {...props()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cannot run Chọn trong vùng with no layer chosen', () => {
    render(<AnalysisParamsView {...props({ tool: 'select_within', params: { ...DEFAULT_PARAMS, layerKeys: [] } })} />);
    expect(screen.getByRole('button', { name: 'Chạy' })).toBeDisabled();
  });

  it('sits in the tool menu as a plain block, not a glass card', () => {
    const { container } = render(<AnalysisParamsView {...props()} />);
    expect(container.querySelector('.glass-panel')).toBeNull();
  });
});
