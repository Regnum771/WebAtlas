import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { Message } from '../../../shared/ui/Message';
import { TextField } from '../../../shared/ui/TextField';
import { JobProgressView } from '../../my-maps/ui/JobProgress.view';
import { CSV_PATTERN, PATTERN_OPTIONS, type useTimeseriesUploadPresenter } from '../model/useTimeseriesUploadPresenter';

export type TimeseriesUploadDialogViewProps = ReturnType<typeof useTimeseriesUploadPresenter> & { onClose: () => void };

/** Passive: the Tải chuỗi thời gian lên dialog. */
export function TimeseriesUploadDialogView(p: TimeseriesUploadDialogViewProps) {
  return (
    <Dialog open title="Tải chuỗi thời gian lên" onClose={p.onClose}>
      <form
        className="form-stack upload-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void p.submit();
        }}
      >
        <div className="field">
          <label htmlFor="ts-file">Tệp dữ liệu</label>
          <input
            id="ts-file" type="file" className="input" accept=".zip,.tif,.tiff,.nc,.hdf" disabled={p.busy}
            onChange={(e) => p.setFile(e.target.files?.[0] ?? null)}
          />
          <p className="hint">ZIP hoặc GeoTIFF theo thời gian, NetCDF (.nc) hoặc HEC-RAS (.hdf); tối đa 2 GB.</p>
        </div>

        <TextField id="ts-title" label="Tiêu đề" value={p.title} error={p.titleError} disabled={p.busy}
          onChange={(e) => p.setTitle(e.target.value)} />
        <TextField id="ts-abstract" label="Mô tả" value={p.abstract} disabled={p.busy}
          onChange={(e) => p.setAbstract(e.target.value)} />

        {p.showPattern && (
          <>
            <div className="field">
              <label htmlFor="ts-pattern">Mẫu thời gian trong tên tệp</label>
              <select id="ts-pattern" className="input" value={p.pattern} disabled={p.busy}
                onChange={(e) => p.setPattern(e.target.value as typeof p.pattern)}>
                {PATTERN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {p.pattern === CSV_PATTERN && (
              <div className="field">
                <label htmlFor="ts-csv">Tệp CSV thời điểm</label>
                <input id="ts-csv" type="file" className="input" accept=".csv" disabled={p.busy}
                  onChange={(e) => p.setCsvFile(e.target.files?.[0] ?? null)} />
              </div>
            )}
          </>
        )}

        {p.showArea && (
          <>
            <TextField id="ts-area" label="Vùng 2D (để trống nếu chỉ có một)" value={p.area} disabled={p.busy}
              onChange={(e) => p.setArea(e.target.value)} />
            <label className="check">
              <input type="checkbox" checked={p.fifteen} disabled={p.busy} onChange={(e) => p.setFifteen(e.target.checked)} />
              Mỗi 15 phút
            </label>
          </>
        )}

        {p.job && <JobProgressView job={p.job} />}
        {p.error && <Message tone="error" title={p.error} />}
        {p.succeeded && <Message tone="success" title="Đã thêm chuỗi thời gian vào bản đồ." />}

        <div className="dialog-actions">
          <Button onClick={p.onClose}>{p.job || p.succeeded ? 'Đóng' : 'Huỷ'}</Button>
          {!p.succeeded && (
            <Button type="submit" variant="solid" busy={p.busy} busyLabel="Đang xử lý…" disabled={!p.file}>Tải lên</Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
