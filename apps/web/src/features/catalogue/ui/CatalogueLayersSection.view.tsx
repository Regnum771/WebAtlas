import { useEffect, useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import { fetchCatalogueLegend, type CatalogueItem } from '../api/catalogue.api';
import type { CatalogueLayer } from '../model/catalogue.store';

export interface CatalogueLayersSectionViewProps {
  layers: CatalogueLayer[];
  onChange: (id: string, patch: { visible?: boolean; opacity?: number }) => void;
  onRemove: (id: string) => void;
}

/** The legend image, fetched with the token and shown from a blob URL that is revoked on unmount. */
function Legend({ item }: { item: CatalogueItem }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    fetchCatalogueLegend(item).then(
      (u) => { if (alive) { url = u; setSrc(u); } else URL.revokeObjectURL(u); },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [item]);
  if (failed) return <p className="hint">Không tải được chú giải.</p>;
  return src ? <img src={src} alt={`Chú giải ${item.title}`} /> : null;
}

function Row({ layer, onChange, onRemove }: { layer: CatalogueLayer } & Omit<CatalogueLayersSectionViewProps, 'layers'>) {
  const { item } = layer;
  const [legendOpen, setLegendOpen] = useState(false);
  if (layer.status === 'gone') {
    return (
      <li className="catalogue-layer gone">
        <span>{item.title}</span>
        <span className="hint bad">Không có quyền xem hoặc đã bị xoá</span>
        <Button size="sm" variant="quiet" aria-label={`Gỡ ${item.title}`} onClick={() => onRemove(item.id)}>Gỡ</Button>
      </li>
    );
  }
  return (
    <li className="catalogue-layer">
      <label className="catalogue-layer-name">
        <input type="checkbox" checked={layer.visible} onChange={(e) => onChange(item.id, { visible: e.target.checked })} />
        {item.title}
      </label>
      <input
        type="range" min={0} max={1} step={0.05} value={layer.opacity}
        aria-label={`Độ mờ ${item.title}`}
        onChange={(e) => onChange(item.id, { opacity: Number(e.target.value) })}
      />
      <Button size="sm" variant="quiet" aria-expanded={legendOpen} onClick={() => setLegendOpen(!legendOpen)}>Chú giải</Button>
      <Button size="sm" variant="quiet" aria-label={`Gỡ ${item.title}`} onClick={() => onRemove(item.id)}>Gỡ</Button>
      {legendOpen && <Legend item={item} />}
    </li>
  );
}

/** Passive: the catalogue entries on the map, above the layer panel. Nothing when there are none. */
export function CatalogueLayersSectionView({ layers, onChange, onRemove }: CatalogueLayersSectionViewProps) {
  if (layers.length === 0) return null;
  return (
    <section className="catalogue-layers" aria-label="Lớp từ Danh mục">
      <h3 className="tool-heading">Lớp từ Danh mục</h3>
      <ul>
        {layers.map((l) => <Row key={l.item.id} layer={l} onChange={onChange} onRemove={onRemove} />)}
      </ul>
    </section>
  );
}
