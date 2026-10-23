import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/workspace.api';
import type { Share, ShareTargets } from '../api/workspace.api';
import { dropGoneMap, isMapNotFound, keys } from './queries';

export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_MIN_CHARS = 2;

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Chưa thực hiện được. Thử lại.';
}

/**
 * The Chia sẻ dialog of one owned map: a search for users and groups (300 ms after the last
 * keystroke, from 2 characters), the current shares, and revoking after a confirmation. The map's
 * own 404 means it is gone: it is dropped and `onGone` closes the dialog.
 */
export function useSharePresenter({ mapId, onGone }: { mapId: string; onGone: () => void }) {
  const qc = useQueryClient();
  const sharesQuery = useQuery({ queryKey: keys.shares(mapId), queryFn: () => api.listShares(mapId) });

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ShareTargets | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<{ id: string; name: string } | null>(null);
  const [revoking, setRevoking] = useState(false);

  function handleGone(): void {
    dropGoneMap(qc, mapId);
    onGone();
  }

  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed.length < SEARCH_MIN_CHARS) {
      setResults(null);
      setSearching(false);
      setSearchError(null);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      api.searchShareTargets(trimmed).then(
        (r) => { if (live) { setResults(r); setSearchError(null); setSearching(false); } },
        (e) => {
          if (!live) return;
          setSearching(false);
          setResults(null);
          if (isMapNotFound(e)) handleGone();
          else setSearchError(messageOf(e));
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
    // handleGone only closes over stable values for the life of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed]);

  // The shares list itself can answer the map's 404 (revoked, or deleted, while the dialog is open).
  useEffect(() => {
    if (isMapNotFound(sharesQuery.error)) handleGone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharesQuery.error]);

  const refreshShares = () => qc.invalidateQueries({ queryKey: keys.shares(mapId) });

  async function share(target: { userId: string } | { groupId: string }): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.addShare(mapId, target);
      await refreshShares();
    } catch (e) {
      if (isMapNotFound(e)) handleGone();
      else setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const askRevoke = (s: Share) => { setError(null); setPendingRevoke({ id: s.id, name: s.name }); };
  const cancelRevoke = () => setPendingRevoke(null);
  async function confirmRevoke(): Promise<void> {
    if (!pendingRevoke || revoking) return;
    setRevoking(true);
    setError(null);
    try {
      await api.removeShare(mapId, pendingRevoke.id);
      setPendingRevoke(null);
      await refreshShares();
    } catch (e) {
      setPendingRevoke(null);
      if (isMapNotFound(e)) handleGone();
      else setError(messageOf(e));
    } finally {
      setRevoking(false);
    }
  }

  return {
    query, setQuery, results, searching, searchError,
    shares: sharesQuery.data ?? null,
    loadError: sharesQuery.error && !isMapNotFound(sharesQuery.error) ? messageOf(sharesQuery.error) : null,
    error, busy, pendingRevoke, revoking,
    share, askRevoke, cancelRevoke, confirmRevoke,
  };
}
