import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('with a label it is a status', () => {
    render(<Spinner label="Đang tải" />);
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải');
  });

  it('without a label it is hidden from assistive technology', () => {
    const { container } = render(<Spinner />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
