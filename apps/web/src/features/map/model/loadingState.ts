/**
 * Đếm số yêu cầu tải đang treo (tile của GWC và feature của WFS), và chỉ báo bận
 * khi việc tải kéo dài quá LOADING_DELAY_MS.
 *
 * Vì sao cần: tile được GWC dựng THEO YÊU CẦU — có cache thì 0,012s, chưa có thì
 * 0,07–0,92s. Hành vi đó bình thường, nhưng vì không có dấu hiệu nào nên người
 * dùng thấy bản đồ mờ rồi nét và tưởng là hỏng.
 *
 * Vì sao PHẢI có độ trễ: mỗi lần kéo hay thu phóng đều sinh yêu cầu tải. Hiện
 * ngay thì thanh báo nhấp nháy suốt trong lúc dùng bình thường — tệ hơn là không
 * có gì. Chỉ hiện khi sau LOADING_DELAY_MS vẫn còn yêu cầu treo, tức là vùng này
 * thật sự chưa có cache.
 */
export const LOADING_DELAY_MS = 400;

export function createLoadTracker(
  onBusyChange: (busy: boolean) => void,
  delayMs = LOADING_DELAY_MS,
) {
  let pending = 0;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };
  const setBusy = (next: boolean) => {
    if (next === busy) return;
    busy = next;
    onBusyChange(busy);
  };

  return {
    start: () => {
      pending += 1;
      if (timer === null && !busy) {
        timer = setTimeout(() => { timer = null; if (pending > 0) setBusy(true); }, delayMs);
      }
    },
    done: () => {
      // Không bao giờ xuống âm: OL vẫn bắn tileloadend/tileloaderror cho những
      // yêu cầu đang bay khi lớp bị gỡ, nên done() có thể nhiều hơn start().
      pending = Math.max(0, pending - 1);
      if (pending === 0) { clear(); setBusy(false); }
    },
    reset: () => { pending = 0; clear(); setBusy(false); },
    get pending() { return pending; },
  };
}
