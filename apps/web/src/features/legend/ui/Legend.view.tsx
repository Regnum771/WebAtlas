import type { LegendEntry, LegendSection } from '@webatlas/shared';

export interface LegendLayer {
  layerStateId: string;
  name: string;
  sections: LegendSection[];
  attribution?: string;
}

function Swatch({ entry }: { entry: LegendEntry }) {
  const size = entry.size ?? 12;
  if (entry.shape === 'line') {
    return <span className="legend-swatch-line" style={{ background: entry.swatch }} />;
  }
  return (
    <span
      className={entry.shape === 'dot' ? 'legend-swatch-dot' : 'legend-swatch-box'}
      style={{ background: entry.swatch, width: size, height: size }}
    />
  );
}

/** Passive: renders legend descriptors. No layer-specific branching. */
export function LegendView({ layers }: { layers: LegendLayer[] }) {
  if (layers.length === 0) return null;

  return (
    <div className="legend-panel">
      <h2 className="panel-title">Chú giải</h2>
      {layers.map((layer) => (
        <section key={layer.layerStateId} className="legend-layer">
          <h3 className="legend-layer-title">{layer.name}</h3>
          {layer.sections.map((section) => (
            <div key={section.title} className="legend-section">
              <div className="legend-section-title">{section.title}</div>
              {section.entries.map((entry) => (
                <div key={entry.label} className="legend-entry">
                  <Swatch entry={entry} />
                  <span>{entry.label}</span>
                </div>
              ))}
            </div>
          ))}
          {layer.attribution && <p className="legend-attribution">{layer.attribution}</p>}
        </section>
      ))}
    </div>
  );
}
