import type { ReactNode } from 'react';

export interface AppShellViewProps {
  topBar: ReactNode;
  strip: ReactNode;
  /** The map stage; the contents panel floats inside it. */
  stage: ReactNode;
  /** The dock as the page's third column (1100 px and wider); null: no third column. */
  dock: ReactNode | null;
}

/** The page grid: top bar, map column, optional dock column. Slots only. */
export function AppShellView({ topBar, strip, stage, dock }: AppShellViewProps) {
  return (
    <div className={dock ? 'app-shell with-dock' : 'app-shell'}>
      {topBar}
      <main className="map-column">
        {strip}
        <div className="map-stage">{stage}</div>
      </main>
      {dock}
    </div>
  );
}
