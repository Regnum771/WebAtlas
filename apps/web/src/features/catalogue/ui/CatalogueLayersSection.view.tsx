import { useEffect, useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import { JobProgressView } from '../../my-maps/ui/JobProgress.view';
import { fetchCatalogueLegend, type CatalogueItem } from '../api/catalogue.api';
import { markGoneIfDenied, type CatalogueLayer } from '../model/catalogue.store';
import { canCopy, type SaveMode, type SaveToMapState } from '../model/saveToMap';

/** Saving a layer into a personal map; absent for an anonymous visitor, who has none. */
export type SaveToMapProps = SaveToMapState & {
  start: (itemId: string, mode: SaveMode) => void;
  close: () => void;
  setTarget: (mapId: string) => void;
  submit: (item: CatalogueItem) => void;
};

export interface CatalogueLayersSectionViewProps {
  layers: CatalogueLayer[];
  onChange: (id: string, patch: { visible?: boolean; opacity?: number }) => void;
  onRemove: (id: string) => void;
  save?: SaveToMapProps;
}

/** The legend image, fetched with the token and shown from a blob URL that is revoked on unmount. */
function Legend({ item }: { item: CatalogueItem }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    const controller = new AbortController();
    fetchCatalogueLegend(item, controller.signal).then(
      (u) => { if (alive) { url = u; setSrc(u); } else URL.revokeObjectURL(u); },
      (e) => { if (alive) { markGoneIfDenied(item.id, e); setFailed(true); } },
    );
    return () => { alive = false; controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [item]);
  if (failed) return <p className="hint">Không tải được chú giải.</p>;
  return src ? <img src={src} alt={`Chú giải ${item.title}`} /> : null;
}

/** The map picker of one row: which own map, then the action; a copy's job shows its progress. */
function SavePanel({ item, save }: { item: CatalogueItem; save: SaveToMapProps }) {
  const mode = save.open!.mode;
  const label = mode === 'link' ? 'Lưu vào bản đồ của tôi' : 'Sao vào Bản của tôi';
  return (
    <div className="catalogue-save" role="group" aria-label={`${label}: ${item.title}`}>
      {save.targets.length === 0 ? (
        <p className="hint">Chưa có bản đồ nào trong Bản của tôi. Hãy tạo một bản đồ trước.</p>
      ) : (
        <label>
          Bản đồ
          <select value={save.target} disabled={save.busy} onChange={(e) => save.setTarget(e.target.value)}>
            {save.targets.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </label>
      )}
      <Button size="sm" busy={save.busy} disabled={!save.target} onClick={() => save.submit(item)}>
        {mode === 'link' ? 'Lưu' : 'Sao'}
      </Button>
      <Button size="sm" variant="quiet" onClick={save.close}>Đóng</Button>
      {save.job && <JobProgressView job={save.job} />}
      {save.error && <p className="hint bad" role="alert">{save.error}</p>}
      {save.done && <p className="hint" role="status">{save.done}</p>}
    </div>
  );
}

function Row({ layer, onChange, onRemove, save }: { layer: CatalogueLayer } & Omit<CatalogueLayersSectionViewProps, 'layers'>) {
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
  const open = save?.open?.itemId === item.id;
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
      {save && (
        <div className="catalogue-layer-save">
          <Button size="sm" variant="quiet" aria-pressed={open && save.open?.mode === 'link'} onClick={() => save.start(item.id, 'link')}>
            Lưu vào bản đồ của tôi
          </Button>
          {canCopy(item) && (
            <Button size="sm" variant="quiet" aria-pressed={open && save.open?.mode === 'copy'} onClick={() => save.start(item.id, 'copy')}>
              Sao vào Bản của tôi
            </Button>
          )}
        </div>
      )}
      {save && open && <SavePanel item={item} save={save} />}
      {legendOpen && <Legend item={item} />}
    </li>
  );
}

/** Passive: the catalogue entries on the map, above the layer panel. Nothing when there are none. */
export function CatalogueLayersSectionView({ layers, onChange, onRemove, save }: CatalogueLayersSectionViewProps) {
  if (layers.length === 0) return null;
  return (
    <section className="catalogue-layers" aria-label="Lớp từ Danh mục">
      <h3 className="tool-heading">Lớp từ Danh mục</h3>
      <ul>
        {layers.map((l) => <Row key={l.item.id} layer={l} onChange={onChange} onRemove={onRemove} save={save} />)}
      </ul>
    </section>
  );
}
