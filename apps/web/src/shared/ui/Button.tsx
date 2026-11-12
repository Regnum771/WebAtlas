import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { Button as ShadcnButton } from './shadcn/button';
import { Spinner } from './Spinner';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `inverse` is for buttons on the green top bar: white outline, white fill when pressed. */
  variant?: 'outline' | 'solid' | 'quiet' | 'danger' | 'inverse';
  size?: 'md' | 'sm';
  busy?: boolean;
  /** Shown in place of children while busy. */
  busyLabel?: string;
}

/** A busy button keeps focus (no `disabled`), shows a spinner and swallows clicks and form submits. */
export function Button({
  variant = 'outline',
  size = 'md',
  busy = false,
  busyLabel,
  type = 'button',
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <ShadcnButton
      {...rest}
      variant={variant}
      size={size}
      type={type}
      onClick={handleClick}
      aria-busy={busy ? true : undefined}
      aria-disabled={busy ? true : undefined}
    >
      {busy ? (
        <>
          <Spinner />
          {busyLabel ?? children}
        </>
      ) : (
        children
      )}
    </ShadcnButton>
  );
}
