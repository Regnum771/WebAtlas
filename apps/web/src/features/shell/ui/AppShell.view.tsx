import type { ReactNode } from 'react';

export interface AppShellViewProps {
  topBar: ReactNode;
  strip: ReactNode;
  /** The map stage; the contents panel floats inside it. */
  stage: ReactNode;
  /** null: no third column. */
  assistant: ReactNode | null;
}

/** The page grid: top bar, map column, optional assistant column. Slots only. */
export function AppShellView({ topBar, strip, stage, assistant }: AppShellViewProps) {
  return (
    <div className={assistant ? 'app-shell with-assistant' : 'app-shell'}>
      {topBar}
      <main className="map-column">
        {strip}
        <div className="map-stage">{stage}</div>
      </main>
      {assistant}
    </div>
  );
}
