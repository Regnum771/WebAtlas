import type { Job } from '../../my-maps/api/workspace.api';
import type { CatalogueItem } from '../api/catalogue.api';

/** `link`: Lưu vào bản đồ của tôi (a catalogue link layer); `copy`: Sao vào Bản của tôi (an import of the data). */
export type SaveMode = 'link' | 'copy';

/** Only vector and raster entries have data to copy; the rest are links only (the API refuses them too). */
export const canCopy = (item: Pick<CatalogueItem, 'kind'>) => item.kind === 'vector' || item.kind === 'raster';

export interface SaveToMapState {
  /** The user's own maps (owner role: a recipient cannot add layers to a shared map). */
  targets: { id: string; title: string }[];
  /** The row whose picker is open, and for which action. */
  open: { itemId: string; mode: SaveMode } | null;
  target: string;
  busy: boolean;
  /** The API's own message, verbatim, or a failed copy job's error. */
  error: string | null;
  /** The copy's job while it runs and once it has ended. */
  job: Job | null;
  done: string | null;
}
