import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { Spinner } from './Spinner';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'outline' | 'solid' | 'quiet' | 'danger';
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
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const classes = ['btn', variant === 'outline' ? null : variant, size === 'sm' ? 'sm' : null, className]
    .filter(Boolean)
    .join(' ');
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <button
      {...rest}
      type={type}
      className={classes}
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
    </button>
  );
}
