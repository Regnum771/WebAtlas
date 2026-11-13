import type { ReactNode } from 'react';

/** One attribute of a feature in the popup's table: the name in a row header, the value beside it. */
export function Attr({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr className="border-t border-line-3 first:border-t-0">
      <th scope="row" className="w-[42%] py-1 pr-2 text-left align-top font-normal text-ink-2">{label}</th>
      <td className="py-1 align-top font-semibold [overflow-wrap:anywhere] text-ink">{children}</td>
    </tr>
  );
}

/** A full-width row of the popup's table, for a note or controls that are not one attribute. */
export function AttrBlock({ children }: { children: ReactNode }) {
  return (
    <tr className="border-t border-line-3 first:border-t-0">
      <td colSpan={2} className="py-1.5">{children}</td>
    </tr>
  );
}
