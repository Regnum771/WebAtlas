import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '../lib/utils';
import { Input } from './shadcn/input';
import { Label } from './shadcn/label';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  /** Node shown at the right, inside the box of the field (e.g. a show-password button). */
  trailing?: ReactNode;
  /** Node shown after the box, on the same row (e.g. a unit: "triệu m³" is too wide for inside). */
  after?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { id, label, error, hint, trailing, after, className, 'aria-describedby': extraDescribedBy, ...rest },
  ref,
) {
  // A caller's own description (e.g. a unit shown after the input) is kept beside the error or hint.
  const own = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const describedBy = [extraDescribedBy, own].filter(Boolean).join(' ') || undefined;
  const input = (
    <Input
      {...rest}
      ref={ref}
      id={id}
      className={cn(trailing ? 'pr-10' : null, className)}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
    />
  );
  const box = trailing ? (
    <div className="relative flex items-center">
      {input}
      <span className="absolute right-1 flex items-center">{trailing}</span>
    </div>
  ) : (
    input
  );
  return (
    <div className="grid gap-[5px]" data-slot="text-field">
      <Label htmlFor={id}>{label}</Label>
      {after ? (
        <div className="flex items-center">
          <div className="min-w-0 flex-1">{box}</div>
          <span className="ml-2 shrink-0 text-body text-ink-2">{after}</span>
        </div>
      ) : (
        box
      )}
      {error ? (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-label font-semibold text-alert" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-label text-ink-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
