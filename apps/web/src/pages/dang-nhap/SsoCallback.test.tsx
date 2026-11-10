import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const completeSso = vi.fn();
vi.mock('../../entities/session/model/session.store', () => ({ useSession: () => ({ completeSso }) }));

import SsoCallbackRoute, { safeReturnTo } from './SsoCallback';

const renderAt = (hash: string) => {
  window.history.replaceState(null, '', `/dang-nhap/xong${hash}`);
  return render(
    <MemoryRouter initialEntries={['/dang-nhap/xong']}>
      <Routes>
        <Route path="/dang-nhap/xong" element={<SsoCallbackRoute />} />
        <Route path="/ban-do" element={<div>MAP</div>} />
        <Route path="/" element={<div>HUB</div>} />
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => { completeSso.mockReset(); });

describe('safeReturnTo', () => {
  it('keeps an in-app path and refuses anything else', () => {
    expect(safeReturnTo('/ban-do?x=1')).toBe('/ban-do?x=1');
    expect(safeReturnTo('//evil.example/x')).toBe('/');
    expect(safeReturnTo('https://evil.example/')).toBe('/');
    expect(safeReturnTo(null)).toBe('/');
  });
});

describe('SsoCallbackRoute', () => {
  it('completes the session with the fragment token, drops the fragment and returns', async () => {
    completeSso.mockResolvedValue(undefined);
    renderAt('#token=T&id_token=I&returnTo=%2Fban-do');
    expect(await screen.findByText('MAP')).toBeInTheDocument();
    expect(completeSso).toHaveBeenCalledWith('T', 'I');
    expect(window.location.hash).toBe('');
  });

  it('shows the reason when the provider sent an error', async () => {
    renderAt('#error=access_denied');
    expect(await screen.findByText('Đăng nhập đã bị huỷ.')).toBeInTheDocument();
    expect(completeSso).not.toHaveBeenCalled();
  });

  it('shows a failure when loading the user fails', async () => {
    completeSso.mockRejectedValue(new Error('401'));
    renderAt('#token=T');
    await waitFor(() => expect(screen.getByText('Không đăng nhập được. Vui lòng thử lại.')).toBeInTheDocument());
  });
});
