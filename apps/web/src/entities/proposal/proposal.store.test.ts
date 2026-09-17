import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { openProposal, closeProposal, useProposal, notifyProposalSaved, onProposalSaved } from './proposal.store';
import type { FeatureEditProposal } from '@webatlas/shared';

const P: FeatureEditProposal = {
  kind: 'proposeFeatureEdit', layerKey: 'dams', featureId: 'f1', name: 'Sông Hinh',
  current: { wattage_mw: '70' }, proposed: { wattage_mw: '72' },
};

beforeEach(() => closeProposal());

describe('proposal store', () => {
  it('publishes the open proposal to subscribers and clears it on close', () => {
    const { result } = renderHook(() => useProposal());
    expect(result.current).toBeNull();
    act(() => openProposal(P));
    expect(result.current).toBe(P);
    act(() => closeProposal());
    expect(result.current).toBeNull();
  });

  it('delivers saved notices until unsubscribed', () => {
    const cb = vi.fn();
    const off = onProposalSaved(cb);
    notifyProposalSaved('Đã cập nhật.');
    off();
    notifyProposalSaved('again');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('Đã cập nhật.');
  });
});
