import type { ReactNode } from 'react';

export interface AppShellViewProps {
  topBar: ReactNode;
  panel: ReactNode;
  strip: ReactNode;
  stage: ReactNode;
  /** null: no third column. */
  assistant: ReactNode | null;
}

/** The page grid: top bar, docked panel, map column, optional assistant column. Slots only. */
export function AppShellView({ topBar, panel, strip, stage, assistant }: AppShellViewProps) {
  return (
    <div className={assistant ? 'app-shell with-assistant' : 'app-shell'}>
      {topBar}
      {panel}
      <main className="map-column">
        {strip}
        <div className="map-stage">{stage}</div>
      </main>
      {assistant}
    </div>
  );
}
