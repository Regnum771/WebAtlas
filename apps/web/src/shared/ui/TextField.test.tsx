import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField';

describe('TextField', () => {
  it('ties its error to the input and announces it', () => {
    render(<TextField id="e" label="Email" error="Nhập email." defaultValue="" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Nhập email.');
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập email.');
  });

  it('describes the input by its hint when there is no error', () => {
    render(<TextField id="e" label="Email" hint="Dùng email cơ quan." />);
    const input = screen.getByLabelText('Email');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).toHaveAccessibleDescription('Dùng email cơ quan.');
  });

  it('forwards its ref to the input and renders trailing content', () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextField id="p" label="Mật khẩu" ref={ref} trailing={<button type="button">Hiện</button>} />);
    expect(ref.current).toBe(screen.getByLabelText('Mật khẩu'));
    expect(screen.getByRole('button', { name: 'Hiện' })).toBeInTheDocument();
  });
});
