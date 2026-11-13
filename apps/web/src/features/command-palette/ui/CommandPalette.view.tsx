import type { ReactNode } from 'react';
import { CornerDownRight, Layers, MapPin, Search, SquareTerminal } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../../../shared/ui/shadcn/dialog';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut,
} from '../../../shared/ui/shadcn/command';
import type { SearchHit } from '../../search/api/search.api';
import type { SearchStatus } from '../../search/model/useSearch';
import { hitBadge, hitDisplayName } from '../../search/model/hitLabel';
import { PALETTE_INPUT_ATTR, type PaletteCommand, type PaletteCommandId, type PaletteLayer } from '../model/useCommandPalette';

export interface CommandPaletteViewProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  query: string;
  onQuery: (query: string) => void;
  places: { hits: SearchHit[]; status: SearchStatus; retry: () => void };
  layers: PaletteLayer[];
  coordinate: { lat: number; lon: number } | null;
  commands: PaletteCommand[];
  onPlace: (hit: SearchHit) => void;
  onLayer: (id: string) => void;
  onCoordinate: () => void;
  onCommand: (id: PaletteCommandId) => void;
  /** A secondary action beside a place, e.g. "use as the analysis area". */
  renderPlaceAction?: (hit: SearchHit) => ReactNode;
}

const ITEM_ICON = 'size-4 shrink-0 text-ink-2';
const fmt = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 6 });

/**
 * Passive: the header's search field, which opens the command palette (Ctrl K), and the palette:
 * places from the place search, layers by name, a typed "lat, lon", and commands.
 */
export function CommandPaletteView(p: CommandPaletteViewProps) {
  const placesBusy = p.places.status === 'loading';
  const nothing = !placesBusy && p.places.status !== 'failed' && p.places.hits.length === 0
    && p.layers.length === 0 && !p.coordinate && p.commands.length === 0;
  return (
    <>
      <button
        type="button"
        data-slot="palette-trigger"
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K"
        onClick={p.onOpen}
        className="flex h-control w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 text-body text-ink-2 hover:border-ink-2"
      >
        <Search size={15} aria-hidden="true" className="shrink-0" />
        <span className="truncate">Tìm địa danh, lớp, toạ độ, lệnh</span>
        <kbd className="ml-auto shrink-0 rounded-sm border border-line bg-surface px-1 font-num text-label">Ctrl K</kbd>
      </button>
      <Dialog open={p.open} onOpenChange={(next) => { if (!next) p.onClose(); }}>
        <DialogContent
          aria-describedby={undefined}
          className="mt-[12vh] w-[min(560px,92vw)] self-start overflow-hidden p-0"
          // Escape stays with the palette; a menu or popup behind it keeps its own.
          onEscapeKeyDown={(event) => event.stopImmediatePropagation()}
        >
          <DialogTitle className="sr-only">Bảng lệnh</DialogTitle>
          {/* No Vim bindings: Ctrl K must close the palette, not move up a row. */}
          <Command shouldFilter={false} vimBindings={false} label="Bảng lệnh">
            <CommandInput
              {...{ [PALETTE_INPUT_ATTR]: '' }}
              value={p.query}
              onValueChange={p.onQuery}
              placeholder="Tìm địa danh, lớp, toạ độ (vĩ độ, kinh độ) hay lệnh"
            />
            <CommandList>
              {p.coordinate && (
                <CommandGroup heading="Toạ độ">
                  <CommandItem value="coordinate" onSelect={p.onCoordinate}>
                    <CornerDownRight className={ITEM_ICON} aria-hidden="true" />
                    Đến toạ độ
                    <span className="ml-auto font-num text-num text-ink-2">{fmt(p.coordinate.lat)}, {fmt(p.coordinate.lon)}</span>
                  </CommandItem>
                </CommandGroup>
              )}
              {(placesBusy || p.places.status === 'failed' || p.places.hits.length > 0) && (
                <CommandGroup heading="Địa danh">
                  {placesBusy && <CommandItem value="places-loading" disabled>Đang tìm…</CommandItem>}
                  {p.places.status === 'failed' && (
                    <CommandItem value="places-retry" onSelect={p.places.retry}>Chưa tìm được. Thử lại</CommandItem>
                  )}
                  {p.places.hits.map((hit) => (
                    <CommandItem key={`${hit.layerKey}:${hit.featureId}`} value={`place:${hit.layerKey}:${hit.featureId}`} onSelect={() => p.onPlace(hit)}>
                      <MapPin className={ITEM_ICON} aria-hidden="true" />
                      <span className="shrink-0 rounded-sm border border-line px-1 text-label text-ink-2">{hitBadge(hit)}</span>
                      <span className="min-w-0 flex-1 truncate">{hitDisplayName(hit.name, hitBadge(hit))}</span>
                      {p.renderPlaceAction && (
                        // The action is its own control: its press must not also choose the place.
                        <span onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                          {p.renderPlaceAction(hit)}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {p.layers.length > 0 && (
                <CommandGroup heading="Lớp">
                  {p.layers.map((layer) => (
                    <CommandItem key={layer.id} value={`layer:${layer.id}`} onSelect={() => p.onLayer(layer.id)}>
                      <Layers className={ITEM_ICON} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{layer.name}</span>
                      <span className="text-label text-ink-2">{layer.visible ? 'Tắt' : 'Bật'}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {p.commands.length > 0 && (
                <CommandGroup heading="Lệnh">
                  {p.commands.map((c) => (
                    <CommandItem key={c.id} value={`command:${c.id}`} onSelect={() => p.onCommand(c.id)}>
                      <SquareTerminal className={ITEM_ICON} aria-hidden="true" />
                      {c.label}
                      {c.shortcut && <CommandShortcut>{c.shortcut}</CommandShortcut>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {nothing && <CommandEmpty>Không tìm thấy gì.</CommandEmpty>}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
