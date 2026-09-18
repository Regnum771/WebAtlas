# Runbook — Trợ lý bản đồ (Map Assistant)

Vận hành `POST /api/assistant/messages` và bảng **Trợ lý** trong thanh biểu tượng.

Trợ lý chạy hoàn toàn phía máy chủ: mô hình `claude-haiku-4-5` được điều khiển bằng
Tool Runner của SDK Anthropic, gọi công cụ chia làm hai nhóm — nhóm **dữ liệu**
truy vấn PostGIS rồi trả về sự kiện kèm nguồn gốc, nhóm **lệnh** phát ra `MapCommand`
đã được kiểm tra để trình duyệt thực thi. Trình duyệt chỉ nhận kết quả; nó không gọi
mô hình và không giữ khoá API.

Số công cụ: **17 công cụ luôn được đăng ký** (đếm bằng
`grep -c "Tool," apps/api/src/modules/assistant/tools/registry.ts`), tính cả bốn
công cụ phân tích `buffer_feature`, `select_within`, `elevation_profile`,
`zonal_elevation` — cộng thêm `run_sql` khi `ASSISTANT_DATABASE_URL` được cấu hình
(18), cộng thêm `propose_feature_update` khi người hỏi là quản trị viên (tối đa
**19** khi cả hai điều kiện cùng đúng). Từ 14 lên 19 kể từ khi các công cụ phân
tích và đề xuất cập nhật được thêm vào.

## Cấu hình

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `ANTHROPIC_API_KEY` | (rỗng) | Không đặt thì tuyến trả 503 `ASSISTANT_UNAVAILABLE`. Đây là công tắc bật/tắt tính năng. |
| `ASSISTANT_MODEL` | `claude-haiku-4-5` | Mô hình. Lựa chọn đã ghi trong bản thiết kế. |
| `ASSISTANT_DAILY_TOKEN_BUDGET` | `200000` | Trần token mỗi người dùng mỗi ngày UTC. `0` là không giới hạn. |
| `ASSISTANT_SESSION_TTL_MS` | `1800000` | Thời gian sống của một phiên hội thoại (30 phút). |
| `ASSISTANT_DATABASE_URL` | (rỗng) | Chuỗi kết nối của vai trò `webatlas_assistant`. Không đặt thì công cụ `run_sql` **không được đăng ký** — cố tình như vậy, vì quảng cáo một công cụ luôn báo "chưa cấu hình" chỉ tốn token tiền tố có cache mỗi lượt. |
| `ASSISTANT_DB_PASSWORD` | `change_me_dev` | Mật khẩu vai trò. Khai báo ở `apps/api/.env` (không phải `infra/.env`) — `node-pg-migrate` đọc `.env` từ thư mục làm việc của nó, là `apps/api/`. Migration `1000000000008` áp mật khẩu bằng `ALTER ROLE ... PASSWORD` chạy mỗi lần migration đó thực thi, nên đổi giá trị rồi chạy lại migration là xoay được mật khẩu thật, không phải no-op. |

Sau khi thêm khoá vào `apps/api/.env`, khởi động lại API. Không commit `.env`
(đã nằm trong `.gitignore`); `.env.example` mới là bản mẫu được theo dõi.

## Công cụ phân tích không gian

Bốn công cụ này là lớp bọc mỏng quanh `modules/analysis` — cùng phép tính mà thanh
công cụ bản đồ gọi, chỉ khác đường vào:

- **`buffer_feature`** — vẽ vùng đệm bán kính `radiusKm` quanh một đối tượng và báo
  diện tích. `featureId` phải lấy từ một công cụ dữ liệu trước đó.
- **`select_within`** — đếm và đánh dấu đối tượng của một hay nhiều lớp nằm trong một
  vùng (một đa giác có sẵn, hoặc bất kỳ đối tượng nào đã đệm bán kính `radiusKm`).
  Dùng cho các câu hỏi "trong phạm vi", "nằm trong", "dọc theo sông".
- **`elevation_profile`** — trắc diện độ cao dọc một đối tượng đường (thường là sông):
  chiều dài, điểm thấp/cao nhất, tổng lên/xuống, độ dốc trung bình. Đọc DEM FABDEM.
- **`zonal_elevation`** — độ cao thấp nhất/cao nhất/trung bình trong một vùng (đa giác
  có sẵn, hoặc đối tượng đã đệm bán kính). Giới hạn 5.000 km². Đọc DEM FABDEM.

**Giới hạn đã biết:** `elevation_profile` và `zonal_elevation` (cũng như
`elevation_at_point` có từ trước) trả lời "Không có dữ liệu" cho tới khi
`scripts/load-dem.sh` đã được chạy trên triển khai đó — DEM không đi kèm migration
hay seed, phải nạp riêng.

## Cập nhật dữ liệu qua trợ lý (chỉ quản trị viên)

Trợ lý **không bao giờ tự ghi dữ liệu**. Khi một quản trị viên yêu cầu cập nhật
thuộc tính (ví dụ "cập nhật công suất thuỷ điện Sông Hinh thành 72 MW"), mô hình gọi
`propose_feature_update`, công cụ chỉ mở **biểu mẫu Đề xuất cập nhật** trên trình
duyệt kèm giá trị đề xuất — chưa có gì được lưu ở bước này.

Biểu mẫu bắt hai trường bắt buộc trước khi cho lưu: **Tài liệu nguồn** (ví dụ
"Quyết định 123/QĐ-UBND", tối đa 500 ký tự) và **Người cung cấp** (ví dụ "Sở Công
Thương Đắk Lắk", tối đa 200 ký tự). Nút Lưu bị khoá cho tới khi cả hai được điền.

Bấm Lưu đi qua đúng tuyến `PUT /api/layers/:key/features/:id` như một chỉnh sửa thủ
công trong ngăn Biên tập — không có tuyến ghi riêng cho trợ lý. Hai trường nguồn được
ghi kèm vào chính dòng `app.audit_log` của lần sửa đó (cột `source_document`,
`source_provider`, thêm ở migration `1000000000014`), cạnh before/after, để một lần
sửa và bằng chứng của nó không thể tách rời.

Người dùng không phải quản trị viên (viewer/editor) yêu cầu sửa/thêm/xoá dữ liệu
nhận đúng câu trả lời cố định: *"Bạn chỉ có quyền xem dữ liệu; chỉ quản trị viên mới
cập nhật được."* — và mô hình không gọi công cụ nào cho yêu cầu đó. Câu này đến từ
`READ_ONLY_RULE` trong `prompt.ts`; đổi chữ ở đó thì phải đổi cả assertion tương ứng
trong `assistant.live.test.ts`.

## Kiểm tra lần đầu (cần một người thật và một khoá API)

Bốn bước này là danh mục kiểm tra cho mỗi lần triển khai mới. Lần chạy đầu tiên
đã thực hiện ngày 14/09/2026 bằng khoá thật — kết quả và một lỗi phải sửa được ghi
ở mục "Lần chạy kiểm tra đầu tiên" bên dưới.

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

Bộ kiểm định tuyến ý định (`npm run test:api:live`) **tốn token thật**. Chạy nó mỗi
khi sửa lời nhắc hệ thống hoặc thêm/bớt công cụ. Tính đến 14/09/2026: 8/8 đạt.

## Lần chạy kiểm tra đầu tiên (14/09/2026)

Lần chạy thật đầu tiên phát hiện một lỗi mà toàn bộ kiểm thử ngoại tuyến không thấy
được, vì nó nằm ở chỗ mô hình tự điền dữ liệu chứ không ở mã:

**Toạ độ địa danh bịa ra.** Hỏi "5 đập gần Buôn Ma Thuột nhất?" ba lần cho ba câu
trả lời khác hẳn nhau trên cùng một bộ dữ liệu tĩnh. Nguyên nhân: không công cụ nào
tra được tên địa danh, nên mô hình tự lấy toạ độ từ trí nhớ — 107,00/12,05 rồi
107,98/12,07 rồi 107,30/12,67, trong khi Buôn Ma Thuột thật ở 108,0447/12,6797. Sai
tới 117 km, mà câu trả lời vẫn kèm chip nguồn gốc `nearest_features` và khoảng cách
hai chữ số thập phân, nên **trông y hệt một câu trả lời có căn cứ**.

Luật 5 của lời nhắc hệ thống lúc đó đã cấm tự nghĩ toạ độ, nhưng chỉ giới hạn "khi
phóng to hoặc đánh dấu bản đồ" — không phủ phần truyền toạ độ vào công cụ TRUY VẤN.
Đó đúng là kẽ hở `nearest_features` lọt qua.

Đã sửa: thêm công cụ `locate_place` tra bảng `basemap.places_region` (6.145 địa danh,
đã có sẵn trong cơ sở dữ liệu — không phải nhập thêm), và viết lại luật 5 để phủ MỌI
toạ độ truyền cho MỌI công cụ. Sau khi sửa, ba lần hỏi cùng câu cho kết quả trùng
khít nhau.

Bốn bước kiểm tra thủ công ở trên đã chạy hết bằng trình duyệt thật trên bản sửa,
đều đạt: câu hỏi đếm trả về số kèm hai chip nguồn gốc (`locate_place`,
`nearest_features`) và các điểm đánh dấu hiện đúng chỗ trên bản đồ; "Chuyển bản đồ
tới Đắk Lắk" đưa tỷ lệ từ 1:4.443.272 về 1:1.110.818 đúng vùng; câu hỏi về Bắc Kạn
được trả lời trung thực là không tra được, kèm giải thích vùng công tác chỉ có 6
tỉnh; và khi gỡ khoá, bảng hiện "Trợ lý chưa được cấu hình trên máy chủ này." kèm
nút Thử lại, không phải bảng trắng hay vòng quay treo.

Bài học cho người kiểm tra sau: **một câu trả lời có chip nguồn gốc chưa chắc đã có
căn cứ.** Chip chỉ chứng minh công cụ đã chạy, không chứng minh đầu vào của nó đúng.
Cách kiểm nhanh là hỏi cùng một câu vài lần — dữ liệu tĩnh mà câu trả lời đổi thì có
chỗ nào đó đang được mô hình tự điền.

## Giới hạn đã biết

Ghi ra đây để người sau không phải tự phát hiện:

- **Phiên hội thoại và hạn mức token nằm trong bộ nhớ tiến trình.** Khởi động lại API
  là xoá sạch cả hai: lịch sử hội thoại mất, và hạn mức ngày được tha. Chấp nhận được
  với triển khai một tiến trình; chạy **nhiều tiến trình thì cả hai đều sai** — mỗi
  tiến trình giữ một bản đếm riêng, nên trần thực tế nhân lên theo số tiến trình.
  Muốn chạy nhiều tiến trình thì phải chuyển hai thứ này sang bộ nhớ dùng chung trước.
- **Bảng trợ lý hiển thị văn bản thô, không dựng Markdown.** Mô hình trả lời bằng
  Markdown (`**tên đập**`, danh sách đánh số, đôi khi cả bảng), nhưng bảng chat in
  nguyên ký tự, nên người dùng đọc thấy `**Đray H'linh 1**` kèm dấu sao. Chỉ là vấn
  đề trình bày, không sai dữ liệu — nhưng thấy rõ ngay ở câu trả lời đầu tiên.
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
- **Các công cụ DEM trả lời "Không có dữ liệu" cho tới khi đã chạy `scripts/load-dem.sh`
  trên triển khai đó.** Áp dụng cho `elevation_at_point`, `elevation_profile` và
  `zonal_elevation` — cả ba đọc bảng DEM FABDEM, không phải PostGIS nạp sẵn qua
  migration/seed. Quên bước này thì trợ lý vẫn trả lời (không lỗi), chỉ là câu trả lời
  vô nghĩa giống hệt trường hợp lớp chuyên đề giả ở trên — dễ nhầm là bug ở công cụ.

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

   Đây **không phải trần cứng**: `controller.ts` gọi `budget.check()` trước
   vòng lặp mô hình, còn `service.ts` chỉ gọi `budget.record()` **sau khi**
   vòng lặp đó xong. Nhiều yêu cầu đồng thời của cùng một người dùng vì thế có
   thể cùng vượt qua `check()` trong lúc `used` còn cũ, nên tổng token tiêu
   thực tế có thể vượt trần tới xấp xỉ một đợt dồn dập (tối đa
   `MAX_ITERATIONS` × (một lượt prompt đầy đủ + 2048 token ra) mỗi yêu cầu)
   trước khi `record()` đầu tiên kịp ghi sổ và `check()` kế tiếp mới chặn lại.
   Bị chặn bởi giới hạn 20 tin nhắn/phút ở trên và tự sửa lại từ yêu cầu kế
   tiếp — chấp nhận được cho một bộ đếm trong bộ nhớ một tiến trình, không
   phải lỗi cần một cơ chế khoá/giữ chỗ để sửa.

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
