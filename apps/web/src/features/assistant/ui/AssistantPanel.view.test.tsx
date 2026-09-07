import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AssistantTurn } from '../model/useAssistant';
import { AssistantPanelView } from './AssistantPanel.view';

const TURNS: AssistantTurn[] = [
  { role: 'user', text: 'Có bao nhiêu đập?' },
  {
    role: 'assistant',
    segments: [
      { kind: 'grounded', text: 'Có 151 đập trong vùng.' },
      { kind: 'knowledge', text: 'Đập vòm thường dùng ở hẻm núi hẹp.' },
    ],
    provenance: [{ tool: 'features_in_view', layerKey: 'dams', rowCount: 151, datasetVersion: 'HydroLAKES v1' }],
  },
];

function renderPanel(overrides: Partial<Parameters<typeof AssistantPanelView>[0]> = {}) {
  const props = {
    turns: TURNS, loading: false, error: null,
    onSend: vi.fn(), onRetry: vi.fn(),
    ...overrides,
  };
  render(<AssistantPanelView {...props} />);
  return props;
}

describe('AssistantPanelView', () => {
  it('renders both the question and the grounded answer', () => {
    renderPanel();
    expect(screen.getByText('Có bao nhiêu đập?')).toBeInTheDocument();
    expect(screen.getByText('Có 151 đập trong vùng.')).toBeInTheDocument();
  });

  it('labels the general-knowledge block visibly rather than by styling alone', () => {
    renderPanel();
    // The spec is explicit: a bordered labelled callout, not italics — a subtle
    // label is one users skim past.
    expect(screen.getByText('Kiến thức chung, không phải dữ liệu hệ thống')).toBeInTheDocument();
    expect(screen.getByText('Đập vòm thường dùng ở hẻm núi hẹp.')).toBeInTheDocument();
  });

  it('shows a provenance chip naming the tool, the row count and the dataset version', () => {
    renderPanel();
    const chip = screen.getByTitle(/features_in_view/);
    expect(chip.textContent).toContain('151');
    expect(chip.textContent).toContain('HydroLAKES v1');
  });

  it('shows the generated SQL when provenance carries it', () => {
    renderPanel({
      turns: [
        {
          role: 'assistant',
          segments: [{ kind: 'grounded', text: 'x' }],
          provenance: [{ tool: 'run_sql', layerKey: null, rowCount: 3, datasetVersion: null, sql: 'SELECT 1' }],
        },
      ],
    });
    expect(screen.getByText('SELECT 1')).toBeInTheDocument();
  });

  it('submits the composer and clears it', () => {
    const props = renderPanel();
    const input = screen.getByLabelText('Câu hỏi cho trợ lý') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Hồ nào lớn nhất?' } });
    fireEvent.submit(input.closest('form')!);
    expect(props.onSend).toHaveBeenCalledWith('Hồ nào lớn nhất?');
    expect(input.value).toBe('');
  });

  it('disables the composer while a request is in flight', () => {
    renderPanel({ loading: true });
    expect(screen.getByLabelText('Câu hỏi cho trợ lý')).toBeDisabled();
    expect(screen.getByText('Đang xử lý…')).toBeInTheDocument();
  });

  it('shows an error with a retry button', () => {
    const props = renderPanel({ error: 'Trợ lý đang quá tải' });
    expect(screen.getByText('Trợ lý đang quá tải')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it('shows a starting hint when the transcript is empty', () => {
    renderPanel({ turns: [] });
    expect(screen.getByText(/Hỏi về đập, sông, hồ/)).toBeInTheDocument();
  });
});
