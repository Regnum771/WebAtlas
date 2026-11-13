import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShellView } from './AppShell.view';

const slots = { topBar: <div>TOP</div>, strip: <div>STRIP</div>, stage: <div>STAGE</div> };

describe('AppShellView', () => {
  it('renders every slot', () => {
    render(<AppShellView {...slots} dock={<div>ASSIST</div>} />);
    for (const t of ['TOP', 'STRIP', 'STAGE', 'ASSIST']) expect(screen.getByText(t)).toBeInTheDocument();
  });

  it('has no dock column when the dock slot is null', () => {
    const { container } = render(<AppShellView {...slots} dock={null} />);
    expect(container.querySelector('.app-shell')).not.toHaveClass('with-dock');
    expect(screen.queryByText('ASSIST')).toBeNull();
  });

  it('marks the grid when the dock column exists', () => {
    const { container } = render(<AppShellView {...slots} dock={<div>ASSIST</div>} />);
    expect(container.querySelector('.app-shell')).toHaveClass('with-dock');
  });

  it('puts the strip above the stage inside the map column', () => {
    const { container } = render(<AppShellView {...slots} dock={null} />);
    const column = container.querySelector('main.map-column')!;
    expect(column.children[0]).toHaveTextContent('STRIP');
    expect(column.children[1]).toHaveTextContent('STAGE');
  });
});
