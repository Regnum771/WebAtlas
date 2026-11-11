import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import type { HubTile, TileState } from '../model/hubTiles';

const STATE_TEXT: Record<Exclude<TileState, 'ready'>, string> = {
  checking: 'Đang kiểm tra kết nối…',
  down: 'Không kết nối được',
  unconfigured: 'Chưa kết nối',
};

function TileBody({ tile }: { tile: HubTile }) {
  return (
    <>
      <span className="hub-tile-title">
        {tile.title}
        {tile.kind === 'service' && <ArrowUpRight size={16} aria-label="(mở thẻ mới)" />}
      </span>
      <span className="hub-tile-text">{tile.text}</span>
      {tile.kind === 'service' && tile.state !== 'ready' && (
        <span className={tile.state === 'down' ? 'hub-tile-state is-down' : 'hub-tile-state'}>{STATE_TEXT[tile.state]}</span>
      )}
    </>
  );
}

/** Passive: the platform's front door, one tile per area. */
export function HubView({ tiles }: { tiles: HubTile[] }) {
  return (
    <div className="hub">
      <h1 className="hub-title">WebATLAS</h1>
      <ul className="hub-tiles">
        {tiles.map((tile) => (
          <li key={tile.id}>
            {tile.kind === 'route' ? (
              <Link className="hub-tile" to={tile.to}><TileBody tile={tile} /></Link>
            ) : tile.href && tile.state !== 'unconfigured' ? (
              // A service that is down keeps its link: the probe can be stale, and its own page says more.
              <a className="hub-tile" href={tile.href} target="_blank" rel="noopener noreferrer"><TileBody tile={tile} /></a>
            ) : (
              <div className="hub-tile is-unavailable" aria-disabled="true"><TileBody tile={tile} /></div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
