import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  /** Node shown at the right, inside the box of the field. */
  trailing?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { id, label, error, hint, trailing, className, ...rest },
  ref,
) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const input = (
    <input
      {...rest}
      ref={ref}
      id={id}
      className={className ? `input ${className}` : 'input'}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
    />
  );
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {trailing ? (
        <div className="input-wrap">
          {input}
          {trailing}
        </div>
      ) : (
        input
      )}
      {error ? (
        <p id={`${id}-error`} className="hint bad" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
