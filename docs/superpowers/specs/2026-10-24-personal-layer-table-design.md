# Personal-layer table and a tidier *Bản của tôi* card

**Status:** design agreed in brainstorming, 2026-10-24. Awaiting the user's review of this document.
**Builds on:** P3c (personal maps in the web app, merged to local main `529a9db`) and the milestone spec `2026-10-19-map-upload-edit-rbac-design.md` §2 and §6.2.
**Relation to P9:** this is the personal-layer half of §6.2 "Attribute table and query", built early. P9 later extends the same table to official layers and adds bulk edit, CSV export and spatial conditions on ROI and administrative units.

## Why

After trying P3c the user found two problems (2026-10-24):

- The map card is cluttered. An expanded owner card shows up to eleven buttons and controls, plus a settings button on every layer row.
- Editing starts by clicking features one at a time on the map. The user wants editing to start from a table of all of a layer's features, filterable, with selection that works both ways between table and map.

## Decisions

All made by the user on 2026-10-24.

| # | Decision |
|---|---|
| T1 | The table covers personal-map layers only for now (free, imported and edit-copy layers; not rasters). It is built so P9 can extend it to official layers without a rewrite. |
| T2 | Editing works by selecting a row and editing in the existing feature form beside the table. No in-cell editing. No bulk edit in this round. |
| T3 | Filtering offers both a search box and *field – operator – value* conditions joined by AND or OR, plus "only in view". |
| T4 | The card keeps two buttons (*Tải tệp lên*, *Thêm lớp*); every other map action moves to a **⋯** menu. Drawing and editing controls move from the card into the table's toolbar. |
| T5 | Filtering, sorting and paging happen on the server. |
| T6 | Each row shows the symbol used to draw that feature. |
| T7 | Desktop only. No layout work for narrow screens. |
| T8 | Column headers use a Vietnamese label when the data dictionary has one, otherwise the column name. The dictionary itself is separate work (see "Related work"). |

## 1. What the user sees

### The map card

- Header: title, *N lớp*, and a **⋯** menu.
  - Owner: *Tải xuống*, *Chia sẻ*, *Đổi tên*, *Xoá bản đồ*.
  - Recipient: *Tải xuống*, *Tạo bản sao*.
- Expanded, owner only: *Tải tệp lên* and *Thêm lớp*.
- Layer rows keep the checkbox, the opacity slider and ⚙ (*Thiết lập lớp*, owner only), and gain a **Bảng** button. Raster layers have no *Bảng*.
- *Vẽ thêm* and *Sửa đối tượng* leave the card.

### The table

It docks along the bottom of the map and shows one layer at a time. Opening another layer's table switches it.

- **Toolbar:**
  - layer name, `{total} đối tượng · {matching} khớp`;
  - a search box (`Tìm…`);
  - condition chips, *+ Thêm điều kiện*, the AND/OR choice (*Tất cả điều kiện* / *Một trong các điều kiện*), and *Chỉ trong khung nhìn*;
  - *Vẽ thêm* (owner only), *Phóng tới*, *Đóng*.
- **Rows:**
  - a narrow *Ký hiệu* column first: the feature's symbol, rendered with the same style code that draws the map (including the column-name to standard-name step that edit copies already go through in `personalStyle.ts`). A free layer shows its point, line or area symbol in the layer's colour; an edit copy shows the official symbol for that feature (a dam's status colour, for instance);
  - then one column per field. A drawn layer uses its declared fields, an imported layer the keys found in its rows, an edit copy the official layer's fields;
  - sort by clicking a header (ascending, descending, off);
  - pages of 100, with *Trước* / *Sau* and the row range.
- **Selection:** one feature at a time. No checkboxes.
- **Form:** the selected feature's form opens to the right of the table. It is the existing form: typed inputs for a drawn layer, text inputs for an imported layer's columns, the official form for an edit copy. Buttons: *Lưu*, *Huỷ*, *Sửa hình*, *Xoá đối tượng*. A recipient sees it read-only, with no buttons.
- **Feature card:** while the table is open, a click on that layer's feature selects its row instead of opening the feature card. The card still opens for other layers.

## 2. The server

### Route

`POST /api/workspace/maps/:mapId/layers/:layerId/query`. It is a read; POST only carries the filter in the body.

Request:

```json
{
  "q": "sông",
  "conditions": [{ "field": "cong_suat", "op": "gt", "value": 50 }],
  "match": "all",
  "bbox": [107.9, 15.9, 108.4, 16.2],
  "sort": { "field": "ten", "dir": "asc" },
  "offset": 0,
  "limit": 100,
  "locate": "123"
}
```

- `limit` is at most 500; the web app asks for 100.
- At most 10 conditions.
- `locate` (optional): a feature id. The response then also carries that feature's zero-based position in the filtered, sorted list (or `null` when the filter hides it), so the table can jump to its page.

Response:

```json
{
  "columns": [{ "name": "ten", "type": "text" }, { "name": "cong_suat", "type": "number" }],
  "total": 151,
  "matched": 12,
  "rows": [{ "id": "123", "properties": { "ten": "…" }, "bbox": [108.0, 16.0, 108.0, 16.0] }],
  "position": 37
}
```

### One query for every layer kind

Each kind already yields one JSON object of attributes per feature:

- free layers (drawn or imported): `workspace.features.properties`;
- edit copies: `workspace.edit_copy_rows(...)`, the function the export already uses, whose `properties` include `external_id`.

The query wraps either source as `(id, properties, geom)` and filters, sorts and pages that one shape. Row `bbox` comes from `ST_Envelope(geom)` in EPSG:4326.

### Columns

- Drawn layer: its declared fields with their types.
- Imported layer: the distinct keys in its rows, at most 200, typed `number` when every non-null value is a JSON number, otherwise `text`.
- Edit copy: the official layer's attribute columns, typed from the layer registry's schema.

### Operators

| Column type | Operators |
|---|---|
| text | `contains`, `eq`, `neq`, `empty`, `notEmpty` |
| number, date | `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `empty`, `notEmpty` |

- The search box is `contains` over every text column, through `workspace.fold_text` (diacritics and case ignored).
- A value that is not a number never matches a number condition, and never raises an error.
- Dates compare as `YYYY-MM-DD` text.

### Safety

- A field name is accepted only if it is in that layer's column list. Anything else answers 400 `Trường "<name>" không có trong lớp này.`
- Every value is a bound parameter. Nothing the user typed is concatenated into SQL.
- Access is the map's read access (owner or recipient). A stranger gets the map's 404.
- The route has its own rate limit, keyed by address like the other workspace reads: 600 requests a minute.
- A statement timeout of 5 s. A timeout answers 400 `Bộ lọc mất quá nhiều thời gian; hãy thu hẹp điều kiện.`

### Speed

Target: under 1.5 s for a filtered page of an edit copy of rivers (about 23,000 rows), measured by a test. If that target fails, the fallback is a per-draft snapshot table refreshed after each write. The fallback is not built unless the test fails.

## 3. Selection, editing and keeping things in step

- **State.** One table at a time, held in a module store: map and layer, page, sort, search, conditions, match, "in view", and the selected feature id. Each layer's filter is remembered for the browser session.
- **Row → map.** Selecting a row rings the feature in yellow on the map. The map does not move by itself; *Phóng tới* fits the row's `bbox`.
- **Map → row.** While the table is open, clicking that layer's feature selects it. If it is not on the current page, the table queries with `locate` and jumps to its page. If the filter hides it, the note *Đối tượng này không khớp bộ lọc* shows and the form still opens.
- **"In view".** With *Chỉ trong khung nhìn* on, the table refetches after each pan or zoom ends, not during the movement.
- **Writes.** *Lưu*, *Sửa hình* and *Xoá* use the existing per-map write queue (`useMapWrite`), so the revision check, `MAP_CHANGED` and `MAP_BUSY` behave as today. After a save the layer reloads on the map, the table refetches its page, and the row stays selected. After a delete the selection clears.
- ***Vẽ thêm*.** Draws into the table's layer. After *Lưu* the new feature is selected.
- **Exclusivity.** Opening the table or drawing from it closes the official *Biên tập* tool, and the reverse, as personal editing does today. The `personalEditing` flag is set while drawing or reshaping.
- ***Sửa đối tượng* is removed.** Selecting on the map with the table open replaces it.
- **Recipients.** Search, filter, sort, select and zoom; read-only form; no *Vẽ thêm*.
- **Map or layer gone.** A revoked or deleted map closes the table and shows the existing message. A layer deleted from ⚙ closes its table without a message.

## 4. Errors, limits, testing

- **Errors.** A refused filter shows the API's message under the filter bar. A timeout shows its message. Network errors show *Không tải được bảng. Thử lại.* with a *Thử lại* button.
- **Limits.** 100 rows per page, at most 500 per request, at most 10 conditions, 200 columns for an imported layer.
- **API tests:**
  - each operator on each layer kind (drawn, imported, edit copy);
  - the search ignores diacritics;
  - an unknown field answers 400;
  - injection attempts in values match nothing and raise no error;
  - a non-numeric value under a number condition matches nothing;
  - `locate` returns the right position, and `null` when filtered out;
  - recipients may query, strangers get 404;
  - the timing target on a rivers edit copy.
- **Web tests:** the decluttered card and its ⋯ menu; the table (columns, symbol cell, sort, paging, search, conditions, AND/OR, in view); selection both ways including `locate`; editing from the table; recipient read-only; the table closing when its map or layer disappears.
- **Browser check.** `verify:personal-maps` gains steps: open a layer's table, filter by a condition, select a row and see the ring, click a feature on the map and see its row, edit from the form and see the row update.

## Out of scope

- Official layers in the table, bulk edit, CSV export, *Lưu vùng chọn thành bản cá nhân*, conditions on ROI or administrative units (P9).
- In-cell editing.
- Narrow-screen layout.

## Related work, separate plans

Recorded here so the order is not lost. Each gets its own plan.

1. **Data dictionary** — after this table, before P4. In `packages/shared`: for each official layer and column, a Vietnamese label, unit, type, allowed values with Vietnamese names (such as dam statuses), and a short description. First readers: the table headers (T8), filter dropdowns for columns with allowed values, the official feature form (which today labels fields with ISO names such as `ratedPower`), and the dam popup. P5's column mapping builds on it. Imported layers keep their own column names; mapping them to the dictionary is P5.
2. **Symbol sets** (user, 2026-10-24) — with the dictionary or right after it. Several symbol sets, chosen by the reader under *Nền bản đồ* and in the print dialog, remembered per person. A set defines colours, symbols and class boundaries per layer; a layer it does not cover keeps the default style, and the legend names the standard each layer follows. Two sets first:
   - *Chuẩn Việt Nam*: QCVN 86:2025/BNNMT water symbols (colours 7 and 8, symbols 165–194, station 59), VN_WQI colours (QĐ 1460/QĐ-TCMT), disaster-risk colours (QĐ 18/2021/QĐ-TTg; the exact swatches of its Phụ lục XII still to be checked), national land-type colours; where Vietnam has no standard, WRI Aqueduct for water stress and the IAH/UNESCO legend for groundwater. Default for print.
   - *Dễ đọc trên web*: the current WebAtlas palette, tuned for screens and colour-blind readers. Default on the map.
