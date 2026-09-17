import { useSyncExternalStore } from 'react';
import type { AnalysisResult } from '@webatlas/shared';

/** The result on screen, readable by the print page without prop-drilling through the shell. */
let current: AnalysisResult | null = null;
const listeners = new Set<() => void>();

export function setAnalysisResult(r: AnalysisResult | null): void {
  current = r;
  for (const l of listeners) l();
}
export function getAnalysisResult(): AnalysisResult | null { return current; }

function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }
export function useAnalysisResult(): AnalysisResult | null {
  return useSyncExternalStore(subscribe, getAnalysisResult, getAnalysisResult);
}
