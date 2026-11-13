import type { LegendSection } from '@webatlas/shared';
import { LegendSwatch } from './LegendSwatch';

export interface LegendLayer {
  layerStateId: string;
  name: string;
  sections: LegendSection[];
  attribution?: string;
}

/** Where a notice's source lives: OpenStreetMap's licence page for an ODbL notice. */
function sourceHref(attribution: string): string | null {
  return /OpenStreetMap/i.test(attribution) ? 'https://www.openstreetmap.org/copyright' : null;
}

/**
 * Passive: the legend at the contents panel's foot (spec "Contents panel"), one block per layer
 * that is on, each with its source. No layer-specific branching.
 */
export function LegendView({ layers }: { layers: LegendLayer[] }) {
  if (layers.length === 0) return null;

  return (
    <section data-slot="legend" aria-labelledby="legend-title" className="border-t border-line-2 px-3 py-2 text-body text-ink">
      <h2 id="legend-title" className="mb-1 text-panel font-semibold">Chú giải</h2>
      {layers.map((layer) => (
        <section key={layer.layerStateId} data-legend-layer={layer.layerStateId} className="border-t border-line-3 py-1.5 first-of-type:border-t-0">
          <h3 className="font-semibold">{layer.name}</h3>
          {layer.sections.map((section) => (
            <div key={section.title} className="mt-1">
              {section.title !== layer.name && <div className="text-label text-ink-2">{section.title}</div>}
              <ul>
                {section.entries.map((entry) => (
                  <li key={entry.label} className="flex min-h-5 items-center gap-2 text-label">
                    <LegendSwatch entry={entry} />
                    <span>{entry.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {layer.attribution && (
            <p className="mt-1 text-label text-ink-2">
              {sourceHref(layer.attribution)
                ? <a href={sourceHref(layer.attribution)!} target="_blank" rel="noopener noreferrer" className="text-water hover:underline">{layer.attribution}</a>
                : layer.attribution}
            </p>
          )}
        </section>
      ))}
    </section>
  );
}
