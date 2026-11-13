/** The MẪU tag every piece of sample data carries (spec "Visual system → Required"). */
export function SampleTag() {
  return (
    <span
      data-slot="sample-tag"
      title="Dữ liệu mẫu"
      className="inline-flex items-center rounded-sm border border-solid border-notice-line bg-notice-tint px-1.5 py-px text-label font-semibold tracking-wide text-ink"
    >
      MẪU
    </span>
  );
}
