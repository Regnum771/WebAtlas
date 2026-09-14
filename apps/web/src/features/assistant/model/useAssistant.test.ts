import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { AssistantReply, MapContext } from '@webatlas/shared';
import { useAssistant } from './useAssistant';

vi.mock('../api/assistant.api', () => ({ postAssistantMessage: vi.fn() }));
import { postAssistantMessage } from '../api/assistant.api';

const MAP_CONTEXT: MapContext = {
  bbox: [107.5, 12.0, 109.0, 13.5],
  zoom: 9,
  visibleLayerStateIds: ['layer_dams'],
  basemap: 'street',
};

const REPLY: AssistantReply = {
  segments: [{ kind: 'grounded', text: 'Có 151 đập.' }],
  commands: [{ kind: 'zoomToRegion', provinceCode: '66' }],
  provenance: [{ tool: 'features_in_view', layerKey: 'dams', rowCount: 151, datasetVersion: 'v1' }],
};

const mocked = () => postAssistantMessage as ReturnType<typeof vi.fn>;

describe('useAssistant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts with an empty transcript and no error', () => {
    const { result } = renderHook(() => useAssistant({ getMapContext: () => MAP_CONTEXT, run: vi.fn() }));
    expect(result.current.turns).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('appends the question and the answer, and executes the commands', async () => {
    mocked().mockResolvedValue(REPLY);
    const run = vi.fn().mockReturnValue({ ok: true, text: 'ok' });
    const { result } = renderHook(() => useAssistant({ getMapContext: () => MAP_CONTEXT, run }));

    await act(async () => { await result.current.send('Có bao nhiêu đập?'); });

    expect(result.current.turns[0]).toMatchObject({ role: 'user', text: 'Có bao nhiêu đập?' });
    expect(result.current.turns[1]).toMatchObject({ role: 'assistant', segments: REPLY.segments });
    expect(run).toHaveBeenCalledWith(REPLY.commands[0]);
  });

  it('sends the same session id on every message so the server can keep context', async () => {
    mocked().mockResolvedValue(REPLY);
    const { result } = renderHook(() => useAssistant({ getMapContext: () => MAP_CONTEXT, run: vi.fn() }));
    await act(async () => { await result.current.send('một'); });
    await act(async () => { await result.current.send('hai'); });
    const [first, second] = mocked().mock.calls;
    expect(first[0].sessionId).toBe(second[0].sessionId);
    expect(first[0].sessionId).toBeTruthy();
  });

  it('refuses to send when the map is not ready rather than sending a null context', async () => {
    const { result } = renderHook(() => useAssistant({ getMapContext: () => null, run: vi.fn() }));
    await act(async () => { await result.current.send('xin chào'); });
    expect(mocked()).not.toHaveBeenCalled();
    expect(result.current.error).toContain('Bản đồ chưa sẵn sàng');
  });

  it('ignores an empty message', async () => {
    const { result } = renderHook(() => useAssistant({ getMapContext: () => MAP_CONTEXT, run: vi.fn() }));
    await act(async () => { await result.current.send('   '); });
    expect(mocked()).not.toHaveBeenCalled();
  });

  it('surfaces the server message on failure and keeps the question in the transcript', async () => {
    mocked().mockRejectedValue(Object.assign(new Error('Bạn đã dùng hết hạn mức'), { status: 429 }));
    const { result } = renderHook(() => useAssistant({ getMapContext: () => MAP_CONTEXT, run: vi.fn() }));
    await act(async () => { await result.current.send('xin chào'); });
    await waitFor(() => expect(result.current.error).toContain('hết hạn mức'));
    expect(result.current.turns).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });

  it('clears a previous error on the next successful send', async () => {
    mocked().mockRejectedValueOnce(new Error('lỗi mạng')).mockResolvedValueOnce(REPLY);
    const { result } = renderHook(() => useAssistant({ getMapContext: () => MAP_CONTEXT, run: vi.fn() }));
    await act(async () => { await result.current.send('một'); });
    await act(async () => { await result.current.send('hai'); });
    expect(result.current.error).toBeNull();
  });

  it('retry re-sends the last question', async () => {
    mocked().mockRejectedValueOnce(new Error('lỗi mạng')).mockResolvedValueOnce(REPLY);
    const { result } = renderHook(() => useAssistant({ getMapContext: () => MAP_CONTEXT, run: vi.fn() }));
    await act(async () => { await result.current.send('một'); });
    await act(async () => { await result.current.retry(); });
    expect(mocked().mock.calls[1][0].message).toBe('một');
  });
});
