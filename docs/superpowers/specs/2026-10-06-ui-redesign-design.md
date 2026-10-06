# UI redesign: screen flow, chuyên đề catalogue, visual identity

**Status:** design agreed in brainstorming, 2026-10-06. Awaiting the user's review of this document.
**Track:** UI redesign. Replaces the shell and visual language of `2026-09-07-ui-overhaul-and-map-assistant-design.md`; keeps its command layer and assistant.
**Reference:** `docs/21_09_2026 Thuyet_minh_WebAtlas_05_10_muc22.docx`, section 22 (Sản phẩm), Bảng 5 and Công việc 6.3, 6.11, 7.x.

Three private claude.ai pages hold the drawings this document describes. They are illustrations; where a page and this document differ, this document wins.

- Site map, flows and wireframes: https://claude.ai/artifact/BFRQbe5aL5M1PYShwynRDx
- The 60 maps, their content, style and merging: https://claude.ai/artifact/4FkHG1StYo27EeKWMRvmFX
- Visual identity and states: https://claude.ai/artifact/PPD3rVjMiih3sjiN8UUwNA

## Why

Section 22 commits the project to an atlas of at least 60 thematic maps, three measured AI targets, open standards and a user guide. The app today is a single map with a tree of 16 layers. A reader has to know which layers to combine, and nothing on screen shows the atlas the proposal describes.

An evaluation of the running app on 2026-10-06 (anonymous screens, 1440 px and 900 px) found:

| Area | Finding |
|---|---|
| Flow | The assistant appears only after sign-in, and the only way in is a button labelled "Admin login". |
| Flow | Analysis tools sit disabled under a permanent hint strip until a region exists. |
| Flow | Layers and legend are separate rail tabs, so the legend cannot be read while toggling layers. |
| Flow | Adding a WMS layer and printing are unlabelled icons with no home. |
| UI | The bottom toolbar holds about 20 icon-only controls, covers the scale bar and coordinate readout, and wraps to three rows at 900 px. |
| UI | The legend repeats each layer name three times; the popup shows raw values such as "Mã phân đoạn: river". |
| UI | The login modal has pale green text on translucent white; the print page uses browser-default controls. |
| Visual | Three unrelated colour systems: green chrome, default blue for every active state, indigo province borders, plus leftover glass panels. |
| Visual | Rivers are one heavy cased ribbon at every order and fuse at regional zoom; province borders outweigh them. |
| Visual | English strings in a Vietnamese interface. |

## Who it is for

Agency readers: staff of management agencies and decision makers who look something up, ask the assistant, run a quick analysis and print a map. The first demo covers section 22.

Success means a reader can, without instruction:

1. Find a subject in the contents and see its map with its legend.
2. Read two subjects together when a question needs both.
3. Ask the assistant from any screen.
4. Tell at once when something failed, is loading, or has no data, and what to do next.

## Decisions

All made by the user on 2026-10-06. They are binding on the plans that follow.

| # | Decision |
|---|---|
| D1 | The primary user is the agency reader. |
| D2 | Design from the thuyết minh. Section 22 is the essential part and the demo covers it first. |
| D3 | The front door is the map. The app opens on it and it never unmounts. |
| D4 | The scale slider stays. Its look and behaviour may change; its range and interval may not: the 11 stops of `ZOOM_SCALE_LEVELS`, 1:12.800.000 to 1:25.000. |
| D5 | Extraction from satellite imagery runs automatically on the server and its results are loaded into the browser. Products: flood (extent and depth, sampled twice a month, mapped to flood risk as a raster), salinity, drought. |
| D6 | There is a "Quản lý danh mục bản đồ" tab for managing map versions and related work. Importing a new map belongs there, as a wizard that previews the imported area on the base map. |
| D7 | Screens without real data show sample data marked as sample. Giám sát is left out of the first demo. |
| D8 | The 60 maps of Bảng 5 merge by subject into 21 chuyên đề (scheme B). A map may be a checkbox under its chuyên đề. |
| D9 | Several chuyên đề can be on at once, with their legends shown together. |
| D10 | Only one area fill shows at a time. Switching on a second replaces the first, and a popup says what was turned off. |
| D11 | The 21 chuyên đề are grouped under bars that stay closed until opened. |
| D12 | The green stays, for institutional reasons. |
| D13 | Decorative accents are kept to a minimum. Anything present needs a reason. |
| D14 | The interface uses few words. "60 bản đồ trong 21 chuyên đề" and similar counts are not shown. |
| D15 | Not-happy paths are designed: errors, loading, empty states, input handling. |
| D16 | A closed group bar shows what is on inside it with marks, filled green. |
| D17 | Bảng 5 numbers are not shown on legend rows. |
| D18 | Names of water bodies on the map are set in italics. |
| D19 | The printed Atlas is out of scope for this track. |

## Structure

### Screens

A top bar is present on every screen: wordmark, navigation, search, Trợ lý, Đăng nhập.

| Screen | Route | Status today |
|---|---|---|
| Bản đồ | `/` | Exists; rearranged |
| Công trình: list and profile | `/cong-trinh`, `/cong-trinh/:id` | New; dam attributes exist |
| Dữ liệu: catalogue, dataset record, map services | `/du-lieu`, `/du-lieu/:id` | New; the dataset registry already records sources and licences |
| Giới thiệu: quality targets, symbols, user guide | `/gioi-thieu` | New |
| Quản lý danh mục bản đồ (signed-in staff) | `/quan-ly-danh-muc` | New; versioning exists server-side with no screen |
| In và xuất | `/print` | Exists |
| Người dùng (admin) | `/admin/users` | Exists |
| Giám sát | not built in the first demo | Needs live readings |

Every screen other than Bản đồ opens as a page over the still-mounted map, as `/admin/users` does today.

### The map screen

**Left panel**, two sections:

- **Đang bật.** The chuyên đề that are on, each open. Its rows are its legend: one row holds the control (checkbox or one-at-a-time choice), the symbol and the name. Only rows that are on are drawn on the map. Each chuyên đề has one information button that opens its commentary, source and version. "Tắt hết" switches everything off. Chuyên đề fed by periodic data carry a period picker (Kỳ dữ liệu).
- **Mục lục.** Six group bars, closed until opened. An open bar lists its chuyên đề as switches. A closed bar shows one mark per chuyên đề, filled green when that chuyên đề is on. A chuyên đề that is on keeps its place in its bar as well as appearing under Đang bật.

When the app opens, Sông và lưu vực and Hồ chứa và đập are on.

**On the map:**

- One tool group at top left with text labels: Đo, Vùng phân tích, Thêm dữ liệu, Nền bản đồ.
- The scale slider at the right edge (see below).
- Scale bar at bottom left and the coordinate and elevation readout at bottom right. Nothing covers either.
- A feature card for the clicked feature: name, one line of kind, and actions (Hồ sơ công trình, Dùng làm vùng).
- The assistant docks on the right and can stay open beside the panel.

The icon rail, the flyout, the bottom toolbar, the floating WMS button and the permanent analysis hint strip are removed.

### The 21 chuyên đề

Numbers are the map numbers of Bảng 5. Kind decides how many can be on (next section).

| Group bar | Chuyên đề | Maps | Kind | Reader switches by |
|---|---|---|---|---|
| Sông, hồ và công trình | Sông và lưu vực | 1, 2 | overlay | checkboxes |
| | Hồ chứa và đập | 3, 4, 5 | overlay | checkboxes |
| | Kênh mương và công trình thủy lợi | 6, 7, 30 | overlay | checkboxes |
| | Thủy điện: hiện trạng và quy hoạch | 32, 50 | overlay | checkboxes |
| | Mạng quan trắc | 8, 21 | overlay | checkboxes |
| Mưa và nước mặt | Mưa | 23, 24, 25 | fill | one at a time |
| | Dòng chảy và biến động | 9, 10, 11, 36, 37 | fill | one at a time |
| | Chất lượng và sức chịu tải nước mặt | 12, 34 | river colour | one at a time |
| Nước dưới đất | Tầng chứa nước | 13, 14, 15, 16 | fill | checkboxes; a switch shades by richness (16) |
| | Nước dưới đất: chất lượng, trữ lượng, tổn thương | 17, 18, 40 | fill | one at a time |
| | Giếng khai thác | 22, 29 | overlay | checkboxes |
| | Nước khoáng, nước nóng | 26, 27 | overlay | a switch sizes by reserve (27) |
| Khai thác và bảo vệ | Khai thác nước mặt và cấp nước sinh hoạt | 28, 31, 33, 41 | mixed | checkboxes for works (28, 31); one at a time for the fill (33, 41) |
| | Vùng cấm, hạn chế và bảo vệ | 19, 20, 39 | overlay | checkboxes |
| | Căng thẳng nước và dòng chảy tối thiểu | 35, 38 | mixed | 35 is a fill; 38 is a river colour |
| Cân bằng và quy hoạch | Cân bằng nước | 42–45 | fill | basin picker |
| | Phân bổ tài nguyên nước | 46–49 | fill | basin picker |
| | Tiềm năng nguồn nước | 51–57 | fill | one at a time, seven sectors |
| Rủi ro thiên tai | Lũ và ngập lụt | 58 | fill | period picker |
| | Hạn hán | 59 | fill | period picker |
| | Xâm nhập mặn | 60 | river colour | period picker |

Each of the 60 keeps its own link, which opens the map with that option chosen, so the 60-map commitment stays checkable even though the numbers are not shown on screen (D17). The thuyết minh's deliberate splits (3 from 4, 10 from 11, and 13, 14, 15 from one another) remain separate named options.

What each map shows and how it is drawn is proposed on the catalogue page. The thuyết minh gives only titles and groups, so that content is a proposal for the team to correct, and the exact symbols belong to the symbol library of Công việc 7.3.

### Switching rules

Every map is one of three kinds.

| Kind | Drawn as | At once |
|---|---|---|
| Overlay | points, plain lines, hatches | any number |
| Fill | a colour fill over an area | one on the whole map |
| River colour | a colour along each river reach | one on the whole map |

- Switching on a fill while another fill is on replaces it. A popup names what was turned off, gives the reason in one line, and offers Hoàn tác: "Đã tắt Tầng chứa nước. Chỉ một nền màu hiện mỗi lần."
- The same applies to river colours.
- Inside a fill chuyên đề one map shows at a time. Tầng chứa nước is the exception: its three aquifer types cover different ground, so they can show together.
- A mixed chuyên đề applies each rule to its own parts.

### Scale slider

A vertical ruler at the map's right edge with one tick per stop, 11 in all, using `ZOOM_SCALE_LEVELS` unchanged. The ticks at 1:100.000 and 1:250.000 are heavier, because those are the two scales section 22 names. A readout below shows the exact scale, and adds "cấp tỉnh" or "cấp vùng" only while the slider rests on one of those two stops. Plus and minus buttons sit at the ends.

### Quản lý danh mục bản đồ

Visible to signed-in staff. It holds:

- **Danh sách bản đồ.** The 60 maps with their chuyên đề and status: draft, published, or no data.
- **Nhập bản đồ mới.** A four-step wizard: Chọn tệp, Xem trước, Thông tin bản đồ, Xuất bản.
  - The file is checked for georeferencing, a supported coordinate system and size. A failed check stops with a reason; a large file or an area partly outside the working region is a caution the editor can pass.
  - Xem trước draws the imported area on the base map, with the file's facts beside it: name, coordinate system, size, corner coordinates, area, provinces covered, and whether it lies inside the working region. Nothing is saved before this step is passed.
  - The import is saved as a draft that only staff see, then published.
- **Phiên bản.** History per map, publish, and roll back. Built on `packages/versioning`.
- **Kỳ dữ liệu.** The periods produced by automatic extraction, with source and image date.
- **Nguồn và siêu dữ liệu.** Source, licence, date and scale per map.

### Extraction products

The server produces flood, salinity and drought rasters twice a month with nobody starting the run (D5). Each run is recorded as a period. Readers reach periods through the period picker on Lũ và ngập lụt, Hạn hán and Xâm nhập mặn. The extraction pipeline itself is outside this track; this track provides the screens that show its output.

### Other pages

- **Công trình.** A register of dams and reservoirs, filtered by province or basin, and a profile per structure: specifications from existing attributes, and a water level and forecast section that shows marked sample data in the demo (D7).
- **Dữ liệu.** The dataset catalogue (source, licence, date for each), a record page per dataset with download, and the addresses of the map services.
- **Giới thiệu.** The section 22 quality targets, the symbol system, and the user guide. The quality page shows no measured figure until something has been measured.
- **Trợ lý.** A button in the top bar for every visitor. A visitor who is not signed in is asked to sign in inside the assistant panel.

## Visual identity

### Colours

| Token | Value | Job |
|---|---|---|
| Xanh cơ quan | `#14532D` | The top bar, and the marks on a group bar. Today's green, unchanged. |
| Mực | `#18213A` | Text, structural rules, and every control that is on. |
| Mực nhạt | `#55607A` | Secondary text, and controls that are off. |
| Nét mảnh | `#C8CEDA` | Separators and quiet outlines. |
| Giấy | `#F3F5F4` | App ground and closed group bars. |
| Tờ | `#FFFFFF` | Panels, cards, fields. |
| Dạ quang | `#FFD928` | The selected feature on the map, and the keyboard focus ring. Nothing else. |
| Đỏ báo lỗi | `#B3261E` | Something failed, or cannot be undone. |

The map's own colours are a separate system (seven purpose colours, blues for water, the fixed VN_WQI colours, and green, amber and red for safety and compliance). The interface does not reuse them. Switches and checkboxes are ink, not green, because they sit beside legend symbols where the maps use green.

There is no separate colour for success or caution. Both are ink with an icon, so red always means failure.

### Type

- **Archivo** for the whole interface, using its width axis: narrower in the panel so long Vietnamese names fit without shrinking, normal elsewhere. Sizes 11.5, 13, 14, 16 and 21 px on a 1.35 line. Tabular figures wherever a number can change.
- **Newsreader Italic** for the names of water bodies on the map only (D18).

Both were confirmed to load their Vietnamese character sets from Google Fonts on 2026-10-06.

### Form

- Something that is on is filled; something that is off is an outline.
- Corners are square or 3 px. Floating elements have an ink outline and no shadow.
- Province names are spaced capitals and province borders fine dashed lines. Rivers thin as they branch.
- Interface text is Vietnamese throughout.

Removed as having no reason (D13): the dark rail, glass panels, the blue active state, degree ticks on the map edge, card shadows, a stylised wordmark, tags that restate a rule.

## States and input

Three rules: red means it failed or cannot be undone, and always comes with an icon and a sentence; everything else is ink; every message says what happened and what to do next.

| Situation | What the reader sees |
|---|---|
| Chuyên đề loading | A spinner and "Đang tải" on its row. |
| Chuyên đề outside its scale range | "Hiện từ 1:500.000" and a "Phóng tới" link. |
| Chuyên đề failed to load | Red icon, "Không tải được", and "Thử lại". |
| Map with no data yet | The row stays listed, dimmed, with no switch, and "Chưa có dữ liệu". Most of the 60 are in this state today. |
| Nothing switched on | "Chưa bật chuyên đề nào. Mở một nhóm trong Mục lục để chọn." |
| Field error | Red outline and a message under the field. |
| Form error | A red message above the submit button. |
| Submitting | The button shows it is working and ignores a second press. |
| Search finds nothing | An ink message with a suggestion. Not an error. |
| Search fails | A red message with "Thử lại". |
| A fill was replaced | Ink popup with Hoàn tác; closes by itself. |
| Something succeeded | Ink popup with a tick; closes by itself. |
| Something failed | Red-outlined popup with "Thử lại"; stays until dealt with. |
| Connection lost | A strip across the top of the map for as long as it lasts. What is drawn stays. |
| Import check failed | Red message naming the cause and the fix. |
| Import caution | Ink message with a triangle; the editor can continue. |
| Tool cannot run yet | The tool stays visible, disabled, with the reason beside it. |
| Analysis finds nothing | An ink message. Not an error. |
| Assistant, not signed in | A prompt to sign in, inside the panel. |
| Assistant declines a question | An ordinary reply that says what it can do instead. Not an error. |
| Reversible confirmation | A dialog whose button repeats the verb in the question, in ink. |
| Irreversible confirmation | The same, with a red button. |
| Sample data | A "Dữ liệu mẫu" mark on the chart itself and one line saying the source is not connected. |

Input behaviour:

- A field is checked when the reader leaves it. Once it shows an error it rechecks on each keystroke, so the error clears when fixed.
- What was typed is never cleared on error.
- On a failed submit, focus moves to the first field in error.
- Enter submits a form. Escape closes a dialog or popup and returns focus to where it was.
- Colour never carries a state alone: each has an icon and words, and is announced to assistive technology.

## How it fits the code

To be confirmed against the code when each plan is written.

- `app/App.tsx` keeps `MapView` as a sibling of `<Routes>`.
- A catalogue in `packages/shared` declares the 60 maps and 21 chuyên đề: for each map its Bảng 5 number, name, kind, the layer keys that draw it (none when there is no data), and its control. Both the panel and the assistant read it.
- The switching rules are a pure function over the catalogue and the set of maps that are on, returning the new set and what was turned off. It has no dependency on OpenLayers and is unit-tested directly.
- `features/layers-panel` and `features/legend` merge into one slice that renders Đang bật and Mục lục from the catalogue and the existing legend descriptors.
- `features/shell` loses the rail and flyout. `features/map/ui/MapToolbar` is split into the tool group and the scale slider.
- `shared/ui/tokens.css` takes the tokens above. The legacy `--primary`, `.glass-panel` and related rules in `styles/main.css` are deleted.
- Messages, popups, fields and dialogs become shared view components so every state above has one implementation.
- Every map action continues to go through `features/map/model/mapCommands.ts`.

## Sub-projects

This design is too large for one plan. Each sub-project gets its own plan, in this order.

| # | Sub-project | Depends on | Needs new data |
|---|---|---|---|
| 1 | Identity and shell: tokens, typefaces, top bar, panel frame, tool group, scale slider, shared state components, Vietnamese strings, sign-in | none | no |
| 2 | Chuyên đề catalogue and panel: the catalogue, switching rules, Đang bật, Mục lục with group bars, legend rows, no-data rows, map symbols for layers that exist | 1 | no |
| 3 | Feature card, assistant open to all, Công trình list and profile with marked sample data | 1 | no |
| 4 | Dữ liệu and Giới thiệu pages | 1 | no |
| 5 | Quản lý danh mục bản đồ: map list, versions, import wizard with preview | 2 | no |
| 6 | Period picker and periods list for extraction products | 2, 5 | yes: the server pipeline |

## Testing

- The switching rules and the catalogue's integrity (each of the 60 placed once, each chuyên đề in one group) are unit-tested.
- Each state in the table has a view test for its text and role.
- Layout claims are proved in a browser, not in jsdom: nothing covers the scale bar or readout, the panel and assistant fit side by side at 1440 px, and the screen holds at 768 px. Screenshots are taken only after tile traffic goes quiet.
- `npm run build:web` runs before any claim of completion, since vitest skips type checking.

## Out of scope

- The printed Atlas (D19).
- The extraction pipeline, forecasting, alerts and the legal-text knowledge base.
- Giám sát (D7).
- Layouts below 768 px. The thuyết minh asks for a responsive interface; that needs its own design.
- Changes to roles and permissions.

## Assumptions awaiting confirmation

Made while drawing, not yet confirmed by the user:

1. Readers no longer open their own GeoTIFF files on the map now that import is a staff wizard. They keep the WMS overlay.
2. A period from an automatic run appears to readers without staff approval. Staff can withdraw one afterwards.
3. An imported map is a draft until published.
4. The import wizard accepts GeoTIFF only.
5. Flood extent is the water-surface result that the IoU ≥ 0,70 target measures.
6. Switches and checkboxes stay ink while the group-bar marks are green.
