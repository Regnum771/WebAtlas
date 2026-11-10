import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TimeSlider from './index';
import { resetTimeSlider, setSteps } from './model/timeSlider.store';

describe('TimeSlider', () => {
  beforeEach(() => resetTimeSlider());
  it('is hidden when no time-series layer supplies steps', () => {
    render(<TimeSlider />);
    expect(screen.queryByRole('slider')).toBeNull();
  });
  it('shows once there are steps', () => {
    setSteps(['2025-10-26T00:00:00Z', '2025-10-26T01:00:00Z']);
    render(<TimeSlider />);
    expect(screen.getByRole('slider', { name: 'Thời điểm' })).toBeInTheDocument();
  });
});
