import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBarView, type StatusBarViewProps } from './StatusBar.view';

const base: StatusBarViewProps = {
  scale: <div>SCALE</div>,
  scaleLineRef: vi.fn(),
  coordinatesRef: vi.fn(),
  elevation: <div>ELEVATION</div>,
  crs: <div>CRS</div>,
  selection: { count: 0, label: null },
};

describe('StatusBarView', () => {
  it('is a converted primitive scope, named for assistive technology', () => {
    render(<StatusBarView {...base} />);
    const bar = screen.getByRole('group', { name: 'Thanh trạng thái bản đồ' });
    expect(bar).toHaveAttribute('data-slot', 'status-bar');
  });

  it('holds, in order: scale, scale line, coordinates, elevation, CRS, selection count', () => {
    render(<StatusBarView {...base} />);
    const bar = screen.getByRole('group', { name: 'Thanh trạng thái bản đồ' });
    expect(bar.firstElementChild).toHaveTextContent('SCALE');
    expect(Array.from(bar.querySelectorAll('[data-readout]')).map((el) => (el as HTMLElement).dataset.readout))
      .toEqual(['scale-line', 'coordinates', 'elevation', 'crs', 'selection']);
    expect(bar.querySelector('[data-readout="elevation"]')).toHaveTextContent('ELEVATION');
    expect(bar.querySelector('[data-readout="crs"]')).toHaveTextContent('CRS');
  });

  it('gives OpenLayers the elements for the scale line and the coordinates', () => {
    const scaleLineRef = vi.fn();
    const coordinatesRef = vi.fn();
    render(<StatusBarView {...base} scaleLineRef={scaleLineRef} coordinatesRef={coordinatesRef} />);
    expect(scaleLineRef).toHaveBeenCalledWith(expect.objectContaining({ dataset: expect.objectContaining({ readout: 'scale-line' }) }));
    expect(coordinatesRef).toHaveBeenCalledWith(screen.getByLabelText('Toạ độ con trỏ'));
  });

  it('says 0 đối tượng when nothing is selected, and names the selection when there is one', () => {
    const { container, rerender } = render(<StatusBarView {...base} />);
    const count = () => container.querySelector('[data-readout="selection"]') as HTMLElement;
    expect(count()).toHaveTextContent('0 đối tượng');
    expect(count()).not.toHaveAttribute('title');
    rerender(<StatusBarView {...base} selection={{ count: 1, label: 'Sông Thu Bồn + 5 km' }} />);
    expect(count()).toHaveTextContent('1 đối tượng');
    expect(count()).toHaveAttribute('title', 'Sông Thu Bồn + 5 km');
  });
});
