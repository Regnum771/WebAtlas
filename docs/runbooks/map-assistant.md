# Runbook — Trợ lý bản đồ (Map Assistant)

Vận hành `POST /api/assistant/messages` và bảng **Trợ lý** trong thanh biểu tượng.

Trợ lý chạy hoàn toàn phía máy chủ: mô hình `claude-haiku-4-5` được điều khiển bằng
Tool Runner của SDK Anthropic, gọi 12 công cụ chia làm hai nhóm — nhóm **dữ liệu**
truy vấn PostGIS rồi trả về sự kiện kèm nguồn gốc, nhóm **lệnh** phát ra `MapCommand`
đã được kiểm tra để trình duyệt thực thi. Trình duyệt chỉ nhận kết quả; nó không gọi
mô hình và không giữ khoá API.

## Cấu hình

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `ANTHROPIC_API_KEY` | (rỗng) | Không đặt thì tuyến trả 503 `ASSISTANT_UNAVAILABLE`. Đây là công tắc bật/tắt tính năng. |
| `ASSISTANT_MODEL` | `claude-haiku-4-5` | Mô hình. Lựa chọn đã ghi trong bản thiết kế. |
| `ASSISTANT_DAILY_TOKEN_BUDGET` | `200000` | Trần token mỗi người dùng mỗi ngày UTC. `0` là không giới hạn. |
| `ASSISTANT_SESSION_TTL_MS` | `1800000` | Thời gian sống của một phiên hội thoại (30 phút). |
| `ASSISTANT_DATABASE_URL` | (rỗng) | Chuỗi kết nối của vai trò `webatlas_assistant`. Không đặt thì công cụ `run_sql` **không được đăng ký** — cố tình như vậy, vì quảng cáo một công cụ luôn báo "chưa cấu hình" chỉ tốn token tiền tố có cache mỗi lượt. |
| `ASSISTANT_DB_PASSWORD` | `change_me_dev` | Mật khẩu vai trò, đọc lúc chạy migration `1000000000008`. |

Sau khi thêm khoá vào `apps/api/.env`, khởi động lại API. Không commit `.env`
(đã nằm trong `.gitignore`); `.env.example` mới là bản mẫu được theo dõi.

## Kiểm tra lần đầu (cần một người thật và một khoá API)

Bốn bước này **chưa được chạy** khi tính năng được xây (máy phát triển không có
khoá). Hãy làm đủ trước khi mở cho người dùng:

```bash
docker compose -f infra/docker-compose.yml up -d
npm run dev -w @webatlas/api
npm run dev:web
```

Đăng nhập, mở mục **Trợ lý** trên thanh biểu tượng, rồi kiểm tra:

1. "Có bao nhiêu đập trong khu vực đang xem?" → trả về một con số **và** một chip
   nguồn gốc ghi `features_in_view`. Không có chip nghĩa là câu trả lời không dựa
   trên dữ liệu.
2. "Chuyển bản đồ tới Đắk Lắk" → bản đồ thật sự di chuyển.
3. Một câu hỏi không có dữ liệu ("Có bao nhiêu trạm quan trắc ở Hà Nội?") → trả lời
   trung thực là không có số liệu, **không** bịa ra con số.
4. Gỡ `ANTHROPIC_API_KEY` rồi thử lại → bảng hiện thông báo 503 bằng tiếng Việt,
   không phải bảng trắng hay vòng quay treo.

Ngoài ra, bộ kiểm định tuyến ý định (`npm run test:api:live`) cũng chưa từng chạy vì
lý do tương tự. Nó **tốn token thật**. Chạy nó lần đầu khi đã có khoá, và mỗi khi
sửa lời nhắc hệ thống hoặc thêm/bớt công cụ.

## Giới hạn đã biết

Ghi ra đây để người sau không phải tự phát hiện:

- **Phiên hội thoại và hạn mức token nằm trong bộ nhớ tiến trình.** Khởi động lại API
  là xoá sạch cả hai: lịch sử hội thoại mất, và hạn mức ngày được tha. Chấp nhận được
  với triển khai một tiến trình; chạy **nhiều tiến trình thì cả hai đều sai** — mỗi
  tiến trình giữ một bản đếm riêng, nên trần thực tế nhân lên theo số tiến trình.
  Muốn chạy nhiều tiến trình thì phải chuyển hai thứ này sang bộ nhớ dùng chung trước.
- **Không có bộ nhớ xuyên phiên.** Đúng theo thiết kế, theo chỉ đạo của người dùng.
- **Không phát trực tiếp (streaming).** Bảng hiển thị "Đang xử lý…" chứ không chảy
  chữ, và **không** hiển thị công cụ nào đang chạy. Bản thiết kế có nhắc tới tiến độ
  từng công cụ, nhưng một phản hồi JSON đơn lẻ không thể báo tiến độ giữa chừng —
  làm được việc đó cần một kênh truyền phát, vốn đã bị loại khỏi v1. Hai việc này là
  một, nên hãy quyết cùng nhau chứ đừng làm nửa vời.
- **`selectedFeature` chưa được nối.** Trạng thái chọn đối tượng nằm trong state cục
  bộ của `components/DynamicPopup.tsx`, mà bản thiết kế cấm sửa tệp đó. Trường này đã
  có sẵn trong hợp đồng nên nối sau không phải đổi hợp đồng.
- **Đây chưa phải RAG.** Trợ lý truy vấn có cấu trúc trên PostGIS: không có kho
  vector, không có bước truy hồi tài liệu. Ai đọc sau này đừng đi tìm. Đó là Spec 3,
  và sổ đăng ký công cụ chính là chỗ nó sẽ cắm vào.
- **Năm trong tám lớp chuyên đề vẫn là dữ liệu giả 2 bản ghi** (trạm quan trắc và bốn
  lớp hiểm họa). Trợ lý trả lời trung thực theo những gì có trong cơ sở dữ liệu, nên
  câu trả lời về các lớp đó đúng về mặt truy vấn nhưng vô nghĩa về mặt thực tế.

## Chi phí

Mỗi tin nhắn là một chuỗi lời gọi API có trả phí. Ba chốt chặn:

1. **Xác thực.** Tuyến chỉ mở cho `admin | editor | viewer`; mục Trợ lý trên thanh
   biểu tượng cũng chỉ hiện với người đã đăng nhập.
2. **`@fastify/rate-limit` trên tuyến:** 20 tin nhắn/phút, khoá theo **id người dùng**
   chứ không theo IP. Lưu ý cấu hình phải có `hook: 'preHandler'` — mặc định của
   plugin là `onRequest`, chạy *trước* khi `app.authenticate` đặt `currentUser`, nên
   thiếu dòng đó thì mọi yêu cầu âm thầm bị khoá theo IP và một văn phòng dùng chung
   IP sẽ chặn lẫn nhau.
3. **Trần token ngày** trong `budget.ts`. Chạm trần thì tuyến trả 429
   `ASSISTANT_BUDGET_EXCEEDED`.

Bản đếm token cộng **cả bốn** trường: `input_tokens`, `output_tokens`,
`cache_creation_input_tokens`, `cache_read_input_tokens`. Bỏ hai trường cache là đếm
thiếu phần lớn lượng nhập thật, vì định nghĩa công cụ được gửi lại mỗi lượt và chính
chúng chiếm phần lớn tiền tố có cache. Sổ được ghi trong `finally`, nên token của các
vòng lặp đã thành công vẫn bị trừ khi một vòng sau đó ném lỗi.

Định nghĩa công cụ và lời nhắc hệ thống nằm trong tiền tố có cache; điểm ngắt
`cache_control` đặt ở khối `system` cuối cùng, và thứ tự dựng là tools → system →
messages nên một điểm ngắt phủ luôn cả danh sách công cụ. **Lời nhắc hệ thống phải
giống hệt nhau từng byte giữa các yêu cầu** — một dấu thời gian hay một id yêu cầu
lọt vào là mất cache mỗi tin nhắn. Bối cảnh bản đồ (`MapContext`) vì thế đi trong
**lượt hỏi mới nhất**, không đặt ở trường `system`.

Kiểm tra cache có ăn hay không bằng `usage.cache_read_input_tokens`. Bằng 0 liên tục
nghĩa là có gì đó trong tiền tố đang đổi mỗi lượt, **hoặc** tiền tố ngắn hơn ngưỡng
tối thiểu của Haiku 4.5 (2048 token) — hai nguyên nhân khác nhau, đừng nhầm.

## Mã lỗi

| Mã | HTTP | Khi nào |
|---|---|---|
| `ASSISTANT_UNAVAILABLE` | 503 | Chưa cấu hình `ANTHROPIC_API_KEY`, hoặc khoá sai. |
| `ASSISTANT_BUDGET_EXCEEDED` | 429 | Người dùng hết hạn mức ngày. |
| `ASSISTANT_UPSTREAM_BUSY` | 429 | Anthropic trả 429. |
| `ASSISTANT_UPSTREAM_ERROR` | 502 | Lỗi khác từ Anthropic. |
| `ASSISTANT_ERROR` | 500 | Lỗi không phân loại được. |
| `RATE_LIMITED` | 429 | Vượt 20 tin nhắn/phút. |

Công cụ ném lỗi thì **không** làm hỏng cả yêu cầu: lỗi được `guardToolErrors` chuyển
thành văn bản trả lại cho mô hình, mô hình xử lý tiếp hoặc báo cho người dùng — giống
hệt cách nó xử lý một kết quả rỗng. Lỗi ném thẳng trong vòng lặp sẽ kết thúc lượt
bằng 500 và người dùng không thấy gì.

## Ranh giới an toàn của lối thoát SQL

Có hai lớp, và **chỉ lớp thứ nhất là ranh giới thật**:

1. **Quyền cơ sở dữ liệu.** Vai trò `webatlas_assistant` chỉ có `SELECT` trên tám
   view `water.*_active`, không có quyền nào trên schema `app`. Công cụ chạy trên một
   **pool kết nối riêng** xác thực bằng vai trò đó — không bao giờ dùng pool của ứng
   dụng, vốn kết nối bằng chủ sở hữu bảng.
   Cấp quyền trên **view** chứ không phải bảng gốc là điểm mấu chốt: view chạy bằng
   quyền của chủ sở hữu (`security_invoker` mặc định tắt), nên nó vẫn giải được chuỗi
   phiên bản qua `app.dataset_versions` trong khi vai trò này không hề chạm tới `app`.
2. **Bộ kiểm câu lệnh** (`sql/guard.ts`): một câu lệnh duy nhất, chỉ `SELECT`/`WITH`,
   cấm chú thích, `BEGIN READ ONLY`, `statement_timeout = 3s`, `LIMIT` bắt buộc ở
   ngoài. Đây **không** phải ranh giới an toàn — nó chỉ để lỗi thường gặp trượt sớm
   và rẻ. Nếu bộ kiểm và bảng phân quyền mâu thuẫn, bảng phân quyền thắng.

Lưu ý `BEGIN READ ONLY` chứ không phải `SET LOCAL default_transaction_read_only`:
GUC đó chỉ ảnh hưởng tới các giao dịch **bắt đầu sau đó**, nên đặt nó bên trong chính
giao dịch cần ràng buộc thì không có tác dụng gì.

Câu SQL sinh ra được ghi vào khối provenance để người duyệt thấy đúng cái đã chạy.
Chính khả năng nhìn thấy đó là điều kiện để một lối thoát như thế này chấp nhận được.

Kiểm tra lớp thứ nhất bất cứ lúc nào:

```bash
docker compose -f infra/docker-compose.yml exec -T db psql -U webatlas -d webatlas \
  -c "SELECT has_table_privilege('webatlas_assistant','app.users','SELECT') AS can_read_users, \
             has_table_privilege('webatlas_assistant','water.dams_active','SELECT') AS can_read_dams;"
```

Phải trả `f` và `t`. Nếu `can_read_users` trả `t`, **tắt `ASSISTANT_DATABASE_URL`
ngay** và sửa quyền trước khi bật lại — `app.users` chứa mã băm argon2 của mật khẩu.

## Kiểm thử

- `npm run test:api` — toàn bộ, **không** gọi mô hình.
- `npm run test:api:live` — bộ kiểm định tuyến ý định, **có gọi mô hình thật và tốn
  token**. Dùng `apps/api/vitest.live.config.ts` riêng, vì `exclude` trong cấu hình
  chính thắng cả tên tệp gõ thẳng trên dòng lệnh.
- `npm run test:api -- privileges.test` — kiểm tra ranh giới quyền bằng cách chạy SQL
  thù địch **thẳng trên pool của trợ lý**, bỏ qua bộ kiểm, và đòi Postgres từ chối
  với SQLSTATE `42501`. Cần `ASSISTANT_DATABASE_URL`.
- `npm run test:web -- assistant` — bảng trợ lý và bộ dựng `MapContext`.
