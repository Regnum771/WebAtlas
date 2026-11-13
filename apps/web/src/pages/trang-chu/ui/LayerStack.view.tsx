import type { CSSProperties } from 'react';
import terrain from '../assets/stack-terrain.webp';
import basemap from '../assets/stack-basemap.webp';
import rivers from '../assets/stack-rivers.webp';
import flood from '../assets/stack-flood.webp';

/** The four layers, bottom to top: real snapshots of WebATLAS layers (packages/atlas-data/tools/hub). */
export const STACK_LAYERS = [
  { key: 'terrain', src: terrain, name: 'Địa hình', source: 'FABDEM, đường đồng mức' },
  { key: 'basemap', src: basemap, name: 'Nền bản đồ', source: 'OpenStreetMap' },
  { key: 'rivers', src: rivers, name: 'Sông ngòi', source: 'OpenStreetMap' },
  { key: 'flood', src: flood, name: 'Độ sâu ngập', source: 'HEC-RAS 2D, 10/2025' },
] as const;

/*
 * Geometry. Each plane is the same square (--s) turned rotateX(60deg) rotateZ(-45deg), then lifted along its
 * own normal by its level times --gap. Seen straight on, a lift of z moves a plane up the screen by
 * z·sin 60° (0.866 z), and the turned square's right corner sits √2/2 (0.7071) of --s right of its centre:
 * that is where a label's leader line meets its plane. The stack spreads (--gap grows) on hover.
 */
const PLANE = '[transform:rotateX(60deg)_rotateZ(-45deg)_translateZ(calc(var(--i)*var(--gap)))]';

/** Passive: the hero's exploded isometric stack with leader-line labels. Static under reduced motion. */
export function LayerStackView() {
  return (
    <figure
      data-slot="layer-stack"
      aria-label="Bốn lớp của WebATLAS chồng lên nhau, lưu vực Vu Gia – Thu Bồn"
      className="group relative m-0 h-[340px] w-[min(520px,100%)] shrink-0 [--gap:48px] [--s:230px] hover:[--gap:70px] motion-reduce:hover:[--gap:48px]"
    >
      {/* The planes, centred, a little below the middle so the lifted stack stays inside the box. */}
      <div className="absolute top-[62%] left-[34%] size-[var(--s)] -translate-x-1/2 -translate-y-1/2">
        {STACK_LAYERS.map((layer, i) => (
          <div
            key={layer.key}
            data-layer={layer.key}
            style={{ '--i': i, animationDelay: `${-i * 1.5}s` } as CSSProperties}
            className={`absolute inset-0 ${PLANE} animate-stack-float transition-transform duration-500 ease-out motion-reduce:animate-none motion-reduce:transition-none`}
          >
            <img
              src={layer.src}
              alt=""
              draggable={false}
              className="size-full rounded-lg border border-line bg-surface object-cover shadow-pop"
            />
          </div>
        ))}
      </div>
      {/* Leader-line labels, each level with its plane's right corner. */}
      <ul className="absolute inset-0 m-0 list-none p-0">
        {STACK_LAYERS.map((layer, i) => (
          <li
            key={layer.key}
            style={{ '--i': i } as CSSProperties}
            className="absolute top-[calc(62%-0.866*var(--i)*var(--gap))] left-[calc(34%+0.7071*var(--s))] flex -translate-y-1/2 items-center gap-2 transition-[top] duration-500 ease-out motion-reduce:transition-none"
          >
            <span aria-hidden="true" className="h-px w-10 bg-ink-2" />
            <span className="leading-tight">
              <span className="block text-body font-semibold text-ink">{layer.name}</span>
              <span className="block text-label whitespace-nowrap text-ink-2">{layer.source}</span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
