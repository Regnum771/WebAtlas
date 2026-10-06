/** With a label it is a status; without one it is hidden from assistive technology. */
export function Spinner({ label }: { label?: string }) {
  if (label) {
    return (
      <span role="status" aria-label={label}>
        <span className="spin" aria-hidden="true" />
        <span className="visually-hidden">{label}</span>
      </span>
    );
  }
  return <span className="spin" aria-hidden="true" />;
}
