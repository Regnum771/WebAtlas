export const FLOOD_DOCK_HEIGHT_VAR = '--flood-dock-height';

/**
 * Publishes the open flood dock's measured height as a CSS variable on the map stage, so the time
 * bar can sit above it whatever its content makes it. The variable is removed while no dock is open.
 * Observes from outside: the flood dock's own files are not touched. Returns a stop function.
 */
export function watchFloodDock(stage: HTMLElement): () => void {
  let dock: Element | null = null;

  const resize = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;
    const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
    stage.style.setProperty(FLOOD_DOCK_HEIGHT_VAR, `${Math.round(h)}px`);
  });

  const sync = () => {
    const now = stage.querySelector('.flood-dock');
    if (now === dock) return;
    if (dock) resize.unobserve(dock);
    dock = now;
    if (dock) resize.observe(dock);
    else stage.style.removeProperty(FLOOD_DOCK_HEIGHT_VAR);
  };

  const mutations = new MutationObserver(sync);
  mutations.observe(stage, { childList: true });
  sync();

  return () => {
    mutations.disconnect();
    resize.disconnect();
    stage.style.removeProperty(FLOOD_DOCK_HEIGHT_VAR);
  };
}
