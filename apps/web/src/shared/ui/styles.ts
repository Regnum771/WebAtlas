/**
 * Class strings for the converted admin and account pages (K5), so every section draws the same panel,
 * table, tag and dialog form. Tailwind scans this file (shared/ui is on the @source list).
 */
export const ui = {
  /** A section of a page: title row, then content. */
  section: 'flex min-w-0 flex-col gap-3 text-body text-ink',
  /** The title row: the title on the left, actions on the right, wrapping when narrow. */
  head: 'flex flex-wrap items-center justify-between gap-3',
  title: 'text-page font-semibold',
  hint: 'text-ink-2',
  /** A bordered panel (1 px line, 6 px corners). */
  panel: 'flex flex-col gap-3 rounded-lg border border-line bg-surface p-4',
  /** A table scrolls inside its own frame, never the page. */
  tableWrap: 'overflow-x-auto rounded-lg border border-line bg-surface',
  table: 'w-full border-collapse text-body',
  thead: 'bg-surface-2 text-left text-label text-ink-2',
  th: 'px-3 py-2 font-semibold whitespace-nowrap',
  tr: 'border-t border-line-3',
  td: 'px-3 py-2 align-top',
  actions: 'flex flex-wrap gap-1.5',
  /** A small tag: 3 px corners, never a pill. */
  tag: 'inline-block rounded-sm border border-line px-1.5 text-label whitespace-nowrap text-ink-2',
  tagOn: 'inline-block rounded-sm border border-brand-line bg-brand-tint px-1.5 text-label whitespace-nowrap text-brand',
  tagAlert: 'inline-block rounded-sm border border-alert-line bg-alert-tint px-1.5 text-label whitespace-nowrap text-alert-ink',
  /** A form inside a dialog. Dialog content is legacy scope, so bordered parts set border-solid. */
  form: 'flex w-[min(520px,80vw)] flex-col gap-3 text-body',
  fieldset: 'm-0 flex flex-col gap-1.5 rounded-md border border-solid border-line px-3 pt-1 pb-3',
  legend: 'px-1 text-label font-semibold text-ink-2',
  check: 'flex cursor-pointer items-start gap-2 [&>input]:mt-0.5 [&>input]:accent-brand',
  formActions: 'flex justify-end gap-2 pt-1',
  fieldError: 'text-label text-alert-ink',
} as const;
