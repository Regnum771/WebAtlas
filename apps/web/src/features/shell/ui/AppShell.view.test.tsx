import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShellView } from './AppShell.view';

const slots = { topBar: <div>TOP</div>, panel: <div>PANEL</div>, strip: <div>STRIP</div>, stage: <div>STAGE</div> };

describe('AppShellView', () => {
  it('renders every slot', () => {
    render(<AppShellView {...slots} assistant={<div>ASSIST</div>} />);
    for (const t of ['TOP', 'PANEL', 'STRIP', 'STAGE', 'ASSIST']) expect(screen.getByText(t)).toBeInTheDocument();
  });

  it('has no assistant column when the assistant slot is null', () => {
    const { container } = render(<AppShellView {...slots} assistant={null} />);
    expect(container.querySelector('.app-shell')).not.toHaveClass('with-assistant');
    expect(screen.queryByText('ASSIST')).toBeNull();
  });

  it('marks the grid when the assistant column exists', () => {
    const { container } = render(<AppShellView {...slots} assistant={<div>ASSIST</div>} />);
    expect(container.querySelector('.app-shell')).toHaveClass('with-assistant');
  });

  it('puts the strip above the stage inside the map column', () => {
    const { container } = render(<AppShellView {...slots} assistant={null} />);
    const column = container.querySelector('main.map-column')!;
    expect(column.children[0]).toHaveTextContent('STRIP');
    expect(column.children[1]).toHaveTextContent('STAGE');
  });
});
