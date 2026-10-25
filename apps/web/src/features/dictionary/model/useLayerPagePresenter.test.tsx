import { describe, it, expect, vi } from 'vitest';
import { render, screen, renderHook, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DICTIONARY, type Dictionary } from '@webatlas/shared';
import { useLayerPagePresenter } from './useLayerPagePresenter';
import { LayerPageView } from '../ui/LayerPage.view';

let dictionary: Dictionary = DICTIONARY;
vi.mock('./useDictionary', () => ({ useDictionary: () => dictionary }));

function Page({ layerKey }: { layerKey: string }) {
  const page = useLayerPagePresenter(layerKey);
  return (
    <MemoryRouter>
      <LayerPageView {...page} />
    </MemoryRouter>
  );
}

describe('the layer page', () => {
  it('the header shows kind, geometry meaning, EPSG and valid-from', () => {
    dictionary = DICTIONARY;
    render(<Page layerKey="lakes" />);
    const lakes = DICTIONARY.lakes;
    expect(screen.getByRole('heading', { level: 2, name: lakes.name })).toBeInTheDocument();
    expect(screen.getByText('Lớp vectơ')).toBeInTheDocument();
    expect(screen.getByText(/chính xác/)).toBeInTheDocument();
    expect(screen.getByText(`EPSG:${lakes.crs}`)).toBeInTheDocument();
    expect(screen.getByText(`Hiệu lực từ ${lakes.validFrom}`)).toBeInTheDocument();
  });

  it('the table shows stored → display units and common conversions', () => {
    dictionary = DICTIONARY;
    render(<Page layerKey="lakes" />);
    for (const h of ['Thuộc tính', 'Ý nghĩa', 'Kiểu', 'Đơn vị (lưu → hiển thị)', 'Quy đổi thông dụng', 'Giá trị', 'Tên chuẩn CF']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    const row = screen.getByRole('row', { name: /Dung tích/ });
    expect(within(row).getByText('số')).toBeInTheDocument();
    expect(row).toHaveTextContent('triệu m³');
    expect(row).toHaveTextContent('1 triệu m³ = 1.000.000 m³');
    expect(row).toHaveTextContent('1 triệu m³ = 0,001 km³');
  });

  it('shows a stored unit that differs from the display unit as stored → display', () => {
    const lakes = DICTIONARY.lakes;
    dictionary = {
      ...DICTIONARY,
      lakes: {
        ...lakes,
        attributes: lakes.attributes.map((a) => (a.name === 'volume_mcm' ? { ...a, displayUnit: 'm3' } : a)),
      },
    };
    render(<Page layerKey="lakes" />);
    expect(screen.getByRole('row', { name: /Dung tích/ })).toHaveTextContent('triệu m³ → m³');
    dictionary = DICTIONARY;
  });

  it('code values expand and mark retired ones', async () => {
    const dams = DICTIONARY.dams;
    const code = dams.attributes.find((a) => a.valueType === 'code' && a.values && a.values.length > 1)!;
    dictionary = {
      ...DICTIONARY,
      dams: {
        ...dams,
        attributes: dams.attributes.map((a) =>
          a.name === code.name
            ? { ...a, values: a.values!.map((v, i) => (i === 0 ? { ...v, retired: true } : v)) }
            : a),
      },
    };
    render(<Page layerKey="dams" />);
    const row = screen.getByRole('row', { name: new RegExp(code.label) });
    expect(within(row).getByText(`${code.values!.length} giá trị`)).toBeInTheDocument();
    await userEvent.click(within(row).getByText(`${code.values!.length} giá trị`));
    expect(within(row).getByText(code.values![0].code)).toBeInTheDocument();
    expect(within(row).getByText(code.values![1].name)).toBeInTheDocument();
    expect(within(row).getAllByText('ngừng dùng')).toHaveLength(1);
    dictionary = DICTIONARY;
  });

  it('vector layers offer both templates and rasters none', () => {
    dictionary = DICTIONARY;
    const { unmount } = render(<Page layerKey="dams" />);
    expect(screen.getByRole('link', { name: 'Tải mẫu GeoPackage' }).getAttribute('href')).toMatch(/\/api\/dictionary\/dams\/template\.gpkg$/);
    expect(screen.getByRole('link', { name: 'Tải mẫu CSV' }).getAttribute('href')).toMatch(/\/api\/dictionary\/dams\/template\.csv$/);
    unmount();
    render(<Page layerKey="dem" />);
    expect(screen.getByText('Lớp ảnh')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Tải mẫu/ })).toBeNull();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
  });

  it('an unknown layer shows the not-found message', () => {
    dictionary = DICTIONARY;
    render(<Page layerKey="nope" />);
    expect(screen.getByText('Không có lớp này trong từ điển dữ liệu.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Về danh sách/ })).toHaveAttribute('href', '/du-lieu');
  });

  it('a retired layer shows its end date and no templates', () => {
    dictionary = { ...DICTIONARY, dams: { ...DICTIONARY.dams, validTo: '2000-01-01' } };
    render(<Page layerKey="dams" />);
    expect(screen.getByText('Đã ngừng dùng từ 2000-01-01')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Tải mẫu/ })).toBeNull();
    dictionary = DICTIONARY;
  });

  it('the presenter returns null page for an unknown key', () => {
    const { result } = renderHook(() => useLayerPagePresenter('nope'));
    expect(result.current.page).toBeNull();
  });
});
