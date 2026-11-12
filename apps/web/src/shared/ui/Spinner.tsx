const SPIN = 'inline-block size-3.5 rounded-full border-2 border-line border-t-ink animate-spin motion-reduce:animate-none';

/** With a label it is a status; without one it is hidden from assistive technology. */
export function Spinner({ label }: { label?: string }) {
  if (label) {
    return (
      <span role="status" aria-label={label} data-slot="spinner">
        <span className={SPIN} aria-hidden="true" />
        <span className="visually-hidden">{label}</span>
      </span>
    );
  }
  return <span className={SPIN} aria-hidden="true" data-slot="spinner" />;
}
