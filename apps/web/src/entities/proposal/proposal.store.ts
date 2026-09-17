import { useSyncExternalStore } from 'react';
import type { FeatureEditProposal } from '@webatlas/shared';

/**
 * The one open update proposal, shared between the assistant slice (which receives
 * it as a MapCommand) and the feature-editing slice (which renders the wizard).
 * A module store rather than React context: the command executor is a plain
 * function built in several slices, and it only needs `openProposal`.
 */
let current: FeatureEditProposal | null = null;
const listeners = new Set<() => void>();
const savedListeners = new Set<(text: string) => void>();

function emit() {
  for (const l of listeners) l();
}

export function openProposal(proposal: FeatureEditProposal): void {
  current = proposal;
  emit();
}

export function closeProposal(): void {
  if (current === null) return;
  current = null;
  emit();
}

export function getProposal(): FeatureEditProposal | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useProposal(): FeatureEditProposal | null {
  return useSyncExternalStore(subscribe, getProposal, getProposal);
}

/** The wizard reports a successful save so the assistant transcript can say so. */
export function notifyProposalSaved(text: string): void {
  for (const l of savedListeners) l(text);
}

export function onProposalSaved(listener: (text: string) => void): () => void {
  savedListeners.add(listener);
  return () => savedListeners.delete(listener);
}
