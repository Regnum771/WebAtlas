import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import type { HubTile, TileState } from '../model/hubTiles';
import type { CatalogueItem, CatalogueKind } from '../../../features/catalogue/api/catalogue.api';
import { Button } from '../../../shared/ui/Button';
import { LayerStackView } from './LayerStack.view';

/** The service panels, in order (spec "Hub"); every other route tile is a shortcut below them. */
const PANEL_IDS = ['ban-do', 'geonode', 'dagster'] as const;

const STATE_TAG: Record<TileState, { text: string; tone: 'ok' | 'wait' | 'down' | 'off' }> = {
  ready: { text: 'Hoạt động', tone: 'ok' },
  checking: { text: 'Đang kiểm tra', tone: 'wait' },
  down: { text: 'Không kết nối được', tone: 'down' },
  unconfigured: { text: 'Chưa kết nối', tone: 'off' },
};

const KIND_LABELS: Record<CatalogueKind, string> = {
  vector: 'Vector', raster: 'Raster', timeseries: 'Chuỗi thời gian', map: 'Bản đồ', document: 'Tài liệu',
};

const dateText = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

export type RecentState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ok'; items: CatalogueItem[] };

export interface HubViewProps {
  tiles: HubTile[];
  recent: RecentState;
}

/** A status tag: a round status dot (the one round shape the rules allow) and its words. */
function StatusTag({ state }: { state: TileState }) {
  const tag = STATE_TAG[state];
  return (
    <span data-tone={tag.tone} className="inline-flex items-center gap-1.5 rounded-sm border border-line px-1.5 py-0.5 text-label font-semibold text-ink-2 data-[tone=down]:border-alert-line data-[tone=down]:text-alert-ink">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-ink-2 in-data-[tone=ok]:bg-ok in-data-[tone=down]:bg-alert" />
      {tag.text}
    </span>
  );
}

function Panel({ tile }: { tile: HubTile }) {
  const state: TileState = tile.kind === 'service' ? tile.state : 'ready';
  const body = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-panel font-semibold text-ink">
          {tile.title}
          {tile.kind === 'service' && <ArrowUpRight size={15} aria-label="(mở thẻ mới)" />}
        </span>
        <StatusTag state={state} />
      </span>
      <span className="text-body text-ink-2">{tile.text}</span>
    </>
  );
  const box = 'flex h-full flex-col gap-2 rounded-lg border border-line bg-surface p-4 no-underline';
  if (tile.kind === 'route') {
    return <Link to={tile.to} className={`${box} hover:border-ink-2`}>{body}</Link>;
  }
  if (tile.href && tile.state !== 'unconfigured') {
    // A service that is down keeps its link: the probe can be stale, and its own page says more.
    return <a href={tile.href} target="_blank" rel="noopener noreferrer" className={`${box} hover:border-ink-2`}>{body}</a>;
  }
  return <div aria-disabled="true" className={`${box} bg-surface-2`}>{body}</div>;
}

function RecentTable({ recent }: { recent: RecentState }) {
  if (recent.status === 'loading') return <p className="text-ink-2">Đang tải…</p>;
  if (recent.status === 'error') {
    return (
      <p role="status" className="flex items-center gap-3 text-ink-2">
        Không tải được Danh mục.
        <Button size="sm" onClick={recent.retry}>Thử lại</Button>
      </p>
    );
  }
  if (recent.items.length === 0) return <p className="text-ink-2">Chưa có mục nào bạn xem được.</p>;
  return (
    <table className="w-full border-collapse rounded-lg border border-line bg-surface text-body">
      <thead className="bg-surface-2 text-left text-label text-ink-2">
        <tr>
          <th scope="col" className="px-3 py-2 font-semibold">Tên</th>
          <th scope="col" className="w-36 px-3 py-2 font-semibold">Loại</th>
          <th scope="col" className="w-28 px-3 py-2 font-semibold">Cập nhật</th>
        </tr>
      </thead>
      <tbody>
        {recent.items.map((item) => (
          <tr key={item.id} className="border-t border-line-3">
            <td className="px-3 py-2">
              <span className="text-ink">{item.title}</span>
              {!item.isPublished && (
                <span className="ml-2 rounded-sm border border-notice-line bg-notice-tint px-1 text-label">Chưa duyệt</span>
              )}
            </td>
            <td className="px-3 py-2 text-ink-2">{KIND_LABELS[item.kind]}</td>
            <td className="px-3 py-2 font-num text-num text-ink-2">{dateText(item.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Faint contours drifting and a river line flowing behind the hero (decoration, hidden from assistive technology). */
function HeroBackground() {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 420">
      <g className="animate-contour-drift fill-none stroke-line-2 motion-reduce:animate-none" strokeWidth="1">
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <path key={k} d={`M -40 ${300 - k * 34} C 220 ${250 - k * 40}, 420 ${360 - k * 30}, 700 ${270 - k * 36} S 1100 ${200 - k * 30}, 1260 ${250 - k * 34}`} />
        ))}
      </g>
      <path
        d="M -20 380 C 180 340, 300 400, 480 350 S 760 300, 900 330 S 1120 300, 1240 260"
        className="animate-river-flow fill-none stroke-water opacity-30 [stroke-dasharray:14_10] motion-reduce:animate-none"
        strokeWidth="3"
      />
    </svg>
  );
}

/** Passive: the platform's front door (spec "Surfaces → Hub"). */
export function HubView({ tiles, recent }: HubViewProps) {
  const panels = PANEL_IDS.flatMap((id) => tiles.filter((t) => t.id === id));
  const shortcuts = tiles.filter((t): t is Extract<HubTile, { kind: 'route' }> => t.kind === 'route' && !PANEL_IDS.includes(t.id as never));
  const catalogue = tiles.find((t) => t.id === 'geonode');
  const catalogueHref = catalogue?.kind === 'service' && catalogue.href && catalogue.state !== 'unconfigured' ? catalogue.href : null;

  return (
    <div data-slot="hub" className="text-body text-ink">
      <section aria-labelledby="hub-title" className="relative overflow-hidden border-b border-line bg-surface">
        <HeroBackground />
        <div className="relative mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-x-8 gap-y-2 px-6 py-8">
          <div className="max-w-[440px] min-w-[300px] flex-1">
            <h1 id="hub-title" className="text-[56px] leading-none font-extrabold tracking-tight text-brand [font-stretch:120%]">WebATLAS</h1>
            <p className="mt-3 text-panel text-ink-2">
              Bản đồ tương tác, danh mục dữ liệu và điều phối dữ liệu tài nguyên nước, trên cùng một nền.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/ban-do" className="inline-flex h-control items-center rounded-md border border-brand bg-brand px-3 font-semibold text-surface no-underline">
                Mở bản đồ
              </Link>
              {catalogueHref && (
                <a href={catalogueHref} target="_blank" rel="noopener noreferrer" className="inline-flex h-control items-center gap-1 rounded-md border border-line bg-surface px-3 font-semibold text-ink no-underline hover:bg-surface-2">
                  Danh mục
                  <ArrowUpRight size={15} aria-label="(mở thẻ mới)" />
                </a>
              )}
            </div>
            <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-ink-2">
              <Link to="/ban-do" className="rounded-sm border border-water px-1.5 py-0.5 font-num font-semibold tracking-wide text-water no-underline">
                PHÁT LẠI 10/2025
              </Link>
              <span>Lũ Thu Bồn – Vu Gia</span>
              <span aria-hidden="true">·</span>
              <span>Nguồn: HEC-RAS 2D, MSWEP, KTTV</span>
            </p>
          </div>
          <LayerStackView />
        </div>
      </section>

      <div className="mx-auto flex max-w-[1120px] flex-col gap-8 px-6 py-8">
        <section aria-labelledby="hub-services" className="flex flex-col gap-3">
          <h2 id="hub-services" className="text-panel font-semibold">Dịch vụ</h2>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 p-0">
            {panels.map((tile) => <li key={tile.id}><Panel tile={tile} /></li>)}
          </ul>
          {shortcuts.length > 0 && (
            <nav aria-label="Lối tắt" className="flex flex-wrap gap-x-4 gap-y-1">
              {shortcuts.map((t) => (
                <Link key={t.id} to={t.to} className="text-water hover:underline">{t.title}</Link>
              ))}
            </nav>
          )}
        </section>

        <section aria-labelledby="hub-recent" className="flex flex-col gap-3">
          <h2 id="hub-recent" className="text-panel font-semibold">Mới cập nhật</h2>
          <RecentTable recent={recent} />
        </section>
      </div>
    </div>
  );
}
