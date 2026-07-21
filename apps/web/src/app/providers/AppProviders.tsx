import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../shared/api/queryClient';
import { AuthProvider } from '../../entities/session/model/session.store';
import { MapProvider } from './MapProvider';
import { MapEditingProvider } from '../../features/map/model/mapEditing';
import { SelectionProvider } from '../../entities/selection';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MapProvider>
          <SelectionProvider>
            <MapEditingProvider>{children}</MapEditingProvider>
          </SelectionProvider>
        </MapProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
