/**
 * Các khoảng cao đều đã xuất bản, từ thô tới mịn.
 *
 * Dùng chung giữa ba nơi: script sinh dữ liệu ghi đúng các bucket này, script xuất bản đặt
 * tên lớp theo chúng, và trình duyệt yêu cầu lớp theo tên đó. Chép tay danh sách này lần
 * thứ hai là cách chắc chắn để hai bên lệch nhau.
 *
 * Chưa có 20 m: ~445.000 đối tượng, ~230 MB — quyết định sau khi nhìn thấy lớp 50 m trên
 * màn hình.
 */
export declare const CONTOUR_INTERVALS: readonly [250, 100, 50];
export type ContourInterval = (typeof CONTOUR_INTERVALS)[number];
