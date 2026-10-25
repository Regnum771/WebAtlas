import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DICTIONARY, attributeOf, type Dictionary } from '@webatlas/shared';
import CursorElevation from './CursorElevation';

const state = { dictionary: DICTIONARY as Dictionary };

vi.mock('../../../app/providers/MapProvider', () => ({ useMapContext: () => ({ map: null }) }));
vi.mock('../model/useCursorElevation', () => ({ useCursorElevation: () => ({ elevationM: 412.6, pending: false }) }));
vi.mock('../../dictionary', () => ({ useDictionary: () => state.dictionary }));

describe('CursorElevation', () => {
  it('the cursor elevation uses the dem display unit', () => {
    const { rerender } = render(<CursorElevation />);
    expect(screen.getByText('Độ cao: 413 m')).toBeInTheDocument();
    const dem = attributeOf(DICTIONARY, 'dem', '1')!;
    state.dictionary = {
      ...DICTIONARY,
      dem: { ...DICTIONARY.dem, attributes: [{ ...dem, displayUnit: 'cm' }] },
    };
    rerender(<CursorElevation />);
    expect(screen.getByText('Độ cao: 41.260 cm')).toBeInTheDocument();
  });

  it('a served dictionary without the dem band still renders the cursor readout', () => {
    state.dictionary = { ...DICTIONARY, dem: { ...DICTIONARY.dem, attributes: [] } };
    render(<CursorElevation />);
    // The code copy's band stands in.
    expect(screen.getByText('Độ cao: 413 m')).toBeInTheDocument();
  });
});
