import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddWmsFormView } from './AddWmsForm.view';

const URL_ERROR = 'Nhập địa chỉ bắt đầu bằng http:// hoặc https://.';

function setup() {
  const onAdd = vi.fn();
  render(<AddWmsFormView onAdd={onAdd} />);
  return {
    onAdd,
    url: screen.getByLabelText('Địa chỉ dịch vụ WMS'),
    layer: screen.getByLabelText('Tên lớp'),
    submit: screen.getByRole('button', { name: 'Thêm vào bản đồ' }),
  };
}

describe('AddWmsFormView', () => {
  it('names the form and hints at what each field takes', () => {
    const { url, layer } = setup();
    expect(screen.getByRole('heading', { name: 'Thêm lớp WMS' })).toBeInTheDocument();
    expect(url).toHaveAttribute('placeholder', 'https://…/wms');
    expect(layer).toHaveAttribute('placeholder', 'workspace:tên_lớp');
  });

  it('adds a valid layer, then clears the fields', async () => {
    const { onAdd, url, layer, submit } = setup();
    await userEvent.type(url, ' https://example.com/wms?map=a ');
    await userEvent.type(layer, 'ws:rivers');
    await userEvent.click(submit);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith({ url: 'https://example.com/wms?map=a', layerName: 'ws:rivers' });
    expect(url).toHaveValue('');
    expect(layer).toHaveValue('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Enter in a field submits', async () => {
    const { onAdd, url, layer } = setup();
    await userEvent.type(url, 'https://example.com/wms');
    await userEvent.type(layer, 'ws:rivers{Enter}');
    expect(onAdd).toHaveBeenCalledWith({ url: 'https://example.com/wms', layerName: 'ws:rivers' });
  });

  it('a refused form adds nothing, keeps what was typed, and focuses the first bad field', async () => {
    const { onAdd } = setup();
    await userEvent.type(screen.getByLabelText('Địa chỉ dịch vụ WMS'), 'example.com/wms');
    await userEvent.click(screen.getByRole('button', { name: 'Thêm vào bản đồ' }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Địa chỉ dịch vụ WMS')).toHaveValue('example.com/wms');
    expect(screen.getByLabelText('Địa chỉ dịch vụ WMS')).toHaveFocus();
  });

  it('says what is wrong under each refused field', async () => {
    const { url, layer, submit } = setup();
    await userEvent.type(url, 'ftp://example.com/wms');
    await userEvent.click(submit);
    expect(url).toHaveAccessibleDescription(URL_ERROR);
    expect(layer).toHaveAccessibleDescription('Nhập tên lớp.');
  });

  it('an empty layer name is refused under its own field and keeps the address', async () => {
    const { onAdd, url, layer, submit } = setup();
    await userEvent.type(url, 'https://example.com/wms');
    await userEvent.click(submit);
    expect(onAdd).not.toHaveBeenCalled();
    expect(url).toHaveValue('https://example.com/wms');
    expect(url).not.toHaveAttribute('aria-invalid');
    expect(layer).toHaveAccessibleDescription('Nhập tên lớp.');
    expect(layer).toHaveFocus();
  });

  it('checks a field when it is left, then on every keystroke until it is right', async () => {
    const { url } = setup();
    await userEvent.type(url, 'example.com/wms');
    expect(screen.queryByText(URL_ERROR)).toBeNull();
    await userEvent.tab();
    expect(screen.getByText(URL_ERROR)).toBeInTheDocument();
    await userEvent.clear(url);
    await userEvent.type(url, 'https://example.com/wms');
    expect(screen.queryByText(URL_ERROR)).toBeNull();
  });
});
