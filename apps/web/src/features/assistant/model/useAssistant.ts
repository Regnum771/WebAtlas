import { useCallback, useRef, useState } from 'react';
import type { MapCommand, MapContext, Provenance, ReplySegment } from '@webatlas/shared';
import { postAssistantMessage } from '../api/assistant.api';

export type AssistantTurn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; segments: ReplySegment[]; provenance: Provenance[] };

export interface UseAssistantDeps {
  /** Null while the map is still initialising. */
  getMapContext: () => MapContext | null;
  run: (command: MapCommand) => unknown;
}

export function useAssistant({ getMapContext, run }: UseAssistantDeps) {
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One session id per mount. Not persisted: the spec rules out cross-session
  // memory, and the server binds the id to the authenticated user anyway.
  const sessionId = useRef<string>(crypto.randomUUID());
  const lastMessage = useRef<string | null>(null);

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || loading) return;

      const mapContext = getMapContext();
      if (!mapContext) {
        setError('Bản đồ chưa sẵn sàng, vui lòng thử lại sau giây lát.');
        return;
      }

      lastMessage.current = message;
      setError(null);
      setLoading(true);
      // The question goes into the transcript before the request, and stays
      // there if the request fails — a question that vanishes on error is the
      // most annoying possible failure mode.
      setTurns((prev) => [...prev, { role: 'user', text: message }]);

      try {
        const reply = await postAssistantMessage({ sessionId: sessionId.current, message, mapContext });
        setTurns((prev) => [
          ...prev,
          { role: 'assistant', segments: reply.segments, provenance: reply.provenance },
        ]);
        // setTurns only SCHEDULES the transcript update; this loop runs
        // synchronously in the same tick, before React re-renders. That is
        // harmless here because commands act on the imperative OpenLayers map
        // object, not on DOM read back from the rendered reply. The server has
        // already validated each command with isMapCommand; the executor
        // validates the layer ids again.
        for (const command of reply.commands) run(command);
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : 'Không gửi được câu hỏi.');
      } finally {
        setLoading(false);
      }
    },
    [getMapContext, loading, run]
  );

  const retry = useCallback(async () => {
    const message = lastMessage.current;
    // Mirror send()'s own guard before mutating the transcript: if loading is
    // already true, send(message) below would return early without re-adding
    // the turn, and popping it here would make the question vanish for good.
    // Currently unreachable (the retry button only renders once `error` is
    // set, which happens in the same batch as loading -> false), but keep the
    // ordering safe rather than relying on that being permanently true.
    if (!message || loading) return;
    // Drop the failed question so retrying does not duplicate it.
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      return last && last.role === 'user' ? prev.slice(0, -1) : prev;
    });
    await send(message);
  }, [send, loading]);

  return { turns, loading, error, send, retry };
}
