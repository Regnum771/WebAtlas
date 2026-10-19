# Map upload, editing and permissions by administrative level

**Status:** design agreed in brainstorming, 2026-10-19. Awaiting the user's review of this document.
**Track:** the milestone after the flood demo. Its subject is the next seminar, "upload and edit maps". The seminar date is not fixed; assume about two months from 2026-10-19.
**Builds on:** `2026-10-06-ui-redesign-design.md` (D6 "Quản lý danh mục bản đồ", sub-projects 2, 5 and 6), `2026-10-04-active-data-current-flag-design.md` (`is_current`) and `packages/versioning`.

## Why

A project meeting after the 2026-10-16 flood demo set the next milestone:

- The data sources in the thuyết minh can be supplied. KTTV data and monitoring stations come through an API. Reservoir release schedules (lịch xả) are not confirmed. Data arrives in about six months.
- Permissions follow administrative levels.
- Add a feature group for editing and saving maps, and one for interactive map tools.
- Build a portal for uploading maps. The approval process and who approves were left open.
- The next seminar shows uploading and editing maps.

The app today lets only `admin` write (supervisor feedback, 2026-09-17). An edit session holds one database transaction open from start to save, then publishes straight away. There is no upload of vector or raster data into official layers. There is no review step, and no notion of who manages what.

This design is built in full, not cut down for the seminar (user, 2026-10-19). Sample data stands in where real data has not arrived (redesign D7).

## Decisions

All made by the user on 2026-10-19. They are binding on the plans that follow.

| # | Decision |
|---|---|
| U1 | Permissions are RBAC. By default anyone can read everything. A user creates, updates, deletes and imports features and maps for their own administrative level and everything below it. |
| U2 | Three levels: Bộ (the whole country) → tỉnh / thành phố trực thuộc TW → xã / phường / đặc khu. These match the boundaries after the 01/7/2025 merger; there is no district level. |
| U3 | Admin creates and edits access groups. A group can model an agency (a Sở, a river basin board) bound to a set of administrative units. |
| U4 | A group is a jurisdiction (a set of units) plus a set of permissions from a fixed list. The default in U1 becomes one ready-made template per level. Limits per layer or per chuyên đề are not built now, but the data model leaves room for them. |
| U5 | Every feature has a managing unit (đơn vị chủ quản). Edit rights follow the managing unit, not the units the geometry touches. |
| U6 | The initial managing unit is the smallest unit that wholly contains the feature: the xã if it lies in one xã, the tỉnh if it lies in one tỉnh, otherwise Bộ. |
| U7 | Personal and published versions are kept clearly apart. A personal map is self-made and self-used: only its creator sees it, and it needs no approval. A published map is seen by everyone and is reached only by submitting a personal map. |
| U8 | Maps drawn in the app can be downloaded, or shared so others can import them. |
| U9 | One app, two areas. Map work (drawing, editing, uploading, using and sharing personal maps, submitting) stays on the map. Management work (catalogue, review queue, versions, groups and users) lives in a separate "Quản lý" area of the same app. |
| U10 | Sharing works both in the app (with users or groups; the recipient views and copies) and through files (GeoPackage, GeoJSON, zipped Shapefile, in a chosen coordinate system). |
| U11 | Uploads follow two flows: flow 1 brings vector data into one of the 8 editable layers; flow 2 makes a new version of a catalogue map, raster or vector. |
| U12 | Uploads pass through a staging area. |
| U13 | File columns with no matching attribute are published into an extra-attributes column on the official layer. The same meaning may then appear under different keys across agencies; that cost is accepted. |
| U14 | Interactive tools: advanced drawing and editing, attribute table and query, compare and time, annotation. |
| U15 | Core architecture is two-tier staging (approach B below). |
| U16 | Publishing follows the group's permissions. Edit and import rights create drafts and submit them. The "duyệt và xuất bản" right publishes, both the holder's own drafts and other people's. An agency that wants separate editors and reviewers does not give both rights to one person. |

## Architecture: two-tier staging

Two facts in the code shape this design:

1. `packages/versioning` already has draft versions that branch from the active one, tombstones, stale-draft detection (`StaleDraftError`), activation and roll back.
2. GeoServer and the assistant read only the `water.<layer>_active` views. Those views filter on `is_current`, so rows of a draft version, which sit in the same `water.*` tables, never show through them. The `webatlas_assistant` role has `SELECT` only on those views.

The staging area therefore has two tiers.

- **The raw tier** is a new `workspace` schema plus a file store. It holds arbitrary-schema rows (all original columns in `jsonb`), column maps and their templates, personal maps that are not tied to an official layer, annotations, shares, jobs and original files. GeoServer and the assistant role have no access to it.
- **The candidate tier** is a `packages/versioning` draft version in the official `water.*` table, with a status: personal, submitted or returned. A copy of an official layer being edited, and the result of mapping a file onto a layer in flow 1, are both such drafts.
- **Publishing is activating the draft**, not copying rows. A draft whose parent is no longer the active version is rebased feature by feature (section 3).
- Thematic catalogue maps (flow 2) are replaced whole, not feature by feature, so they use a smaller version model of their own in an `atlas` schema. They follow the same submit, review and publish life cycle.

Rejected:
- A fully separate staging area that copies into `water.*` on publish. Diffing, conflict detection and tombstones would be written a second time, next to the tested ones in `packages/versioning`, and the two would drift.
- GeoNode. It is a separate Django app with its own interface, against U9. It knows neither managing units nor the fixed schemas of the 8 layers, and it would not use `packages/versioning`.

What approach B costs, and how this design pays for it:
- Drafts now live for days in `water.*` tables, so there is a cleanup policy (section 2).
- Isolation of the candidate tier rests on views, not on a schema. Tests prove that the `_active` views and the assistant role never see a draft row (section 2).
- The edit session's long open transaction is replaced by per-operation writes to a persisted draft (sub-project P2).

## 1. Permissions and managing units

### The unit tree

Three levels: `VN` (Bộ), the 34 tỉnh (2-digit codes, `admin.provinces`), and the xã (5-digit codes, `admin.wards`). A view `admin.unit_tree (code, level, parent_code, name)` is built from those tables. A unit's scope always includes every unit below it.

`admin.wards` covers only the working region. Outside it, the finest unit available is the tỉnh.

### Access groups

New tables in `app`:

| Table | Holds |
|---|---|
| `access_groups` | id, name, description, created_by, timestamps |
| `access_group_units` | group_id, unit_code — the jurisdiction, e.g. `{"48"}` = Đà Nẵng and all its xã; `{"VN"}` = the country |
| `access_group_permissions` | group_id, permission. A nullable scope column for per-layer or per-chuyên đề limits can be added later (U4); it is not created now |
| `user_groups` | user_id, group_id |

The permissions are a fixed list in code:

| Permission | Meaning |
|---|---|
| `feature.create` | add features within the jurisdiction |
| `feature.update` | change features whose managing unit is within the jurisdiction |
| `feature.delete` | delete such features |
| `map.import` | import files into official layers or catalogue maps |
| `submission.review` | review and publish submissions (duyệt và xuất bản) |
| `users.manage` | add users to groups within the jurisdiction |

A user may belong to several groups. Their effective grants are the union of `(permission, unit)` pairs across those groups.

- **Admin** keeps the existing `admin` role. Admin sees and does everything, and is the only one who creates and edits groups (U3).
- **The `editor` role** grants nothing today. It is folded away in the migration: `editor` and `viewer` users become users with no group. Such a user reads everything and has personal maps.
- **Templates.** U1's default becomes three templates: *Cán bộ cấp Bộ*, *Cán bộ cấp tỉnh* and *Cán bộ cấp xã*. Each holds `feature.create`, `feature.update`, `feature.delete` and `map.import`, and none holds `submission.review`. To create a group, admin picks a template and a unit, for example "Sở NN&MT Đà Nẵng" from the tỉnh template plus `48`. The permissions can then be changed one by one. A template is a preset in the interface, not a group.
- **No escalation through `users.manage`.** A holder may add someone only to a group whose units all lie within the holder's jurisdiction and whose permissions are a subset of the holder's own.

### Managing unit

- Each of the 8 editable layers gains a column `managing_unit text NOT NULL`, which references `admin.unit_tree`. The column is versioned like any attribute. Changing it is therefore an edit: it is reviewed, audited and can be rolled back.
- **The initial assignment follows U6 and uses the existing stamp arrays.** One entry in `ward_codes` → that xã. Otherwise one entry in `province_codes` → that tỉnh. Otherwise `VN`.
- **Measured on the development database, 2026-10-19** (current rows only):

  | Layer | → xã | → tỉnh | → VN | Total |
  |---|---|---|---|---|
  | rivers | 17,517 | 5,054 | 548 | 23,119 |
  | lakes | 3,696 | 166 | 6 | 3,868 |
  | dams | 131 | 1 | 19 | 151 |
  | stations | 2 | 0 | 0 | 2 |
  | flood_zones | 0 | 2 | 0 | 2 |
  | flood_generation | 0 | 1 | 1 | 2 |
  | drought_points | 2 | 0 | 0 | 2 |
  | saltwater_intrusion | 2 | 0 | 0 | 2 |

  The counts follow the plan's province-first clarification of this rule (`admin.managing_unit_for`): a province count other than one gives `VN` before any ward is considered, so a feature touching several provinces but only one ward of the working region (158 rivers and 2 lakes here) goes to `VN`; an earlier version of this table counted those under both xã and `VN`.

  All 19 dams that go to `VN` have no geometry; none lies outside the country. Features without geometry go to `VN` and appear in an "unassigned" list in Quản lý for manual assignment.
- **Boundary simplification.** Boundaries are simplified to about 11 m. A feature lying against a xã boundary can count as crossing it and go up to the tỉnh. That is safe: the tỉnh can still edit it and can hand it down to the xã.
- **The managing unit is not recomputed when geometry changes.** It is an administrative fact, not a geometric one. Validation warns when an edit moves a feature wholly outside its managing unit.
- **New features** get U6's rule as a suggested default, and the creator may change it within their jurisdiction.
- **Rebuilds keep manual assignments.** `atlas:build` ingests keep the managing unit of every `external_id` that already has one, so a rebuild never wipes them. New `external_id`s get U6's rule. `stampAdminCodes` in `packages/versioning` is extended accordingly.

### Enforcement

- A pure function `can(grants, permission, unitCode, unitTree)` lives in `packages/shared`, so the API and the web app apply one rule. The web hides controls when it returns false; the API is the gate that matters.
- Effective grants are loaded when a request is authenticated and attached to `request.currentUser`, cached for the length of the request.
- **Two levels of check.** Routes check that the user holds the permission somewhere, which rejects early. Services check each object:
  - **update and delete:** the managing unit of the feature's current row must be within the jurisdiction;
  - **changing the managing unit:** the user needs the permission on both the old and the new unit;
  - **create:** the chosen managing unit must be within the jurisdiction.
- **Refusals say why**, for example "Đối tượng thuộc Phường Điện Bàn Đông; nhóm của anh/chị chỉ có quyền trong Xã Điện Hồng." The API returns 403 with a machine-readable reason code and the unit names.
- **Personal maps are not checked against jurisdiction** (U7). The check happens when a personal map is submitted.
- **Assistant proposals.** The assistant's proposed edits (`ProposedEdit`) are checked with the grants of the person who confirms them.
- **Audit.** Every group, membership and managing-unit change is written to `app.audit_log`.

### Interface

In the Quản lý area:
- **Nhóm quyền:** the list of groups; create from a template or edit; a unit tree picker with search; permission checkboxes; members.
- **Người dùng:** assign groups to a user; a summary of the user's effective jurisdiction, for example "Thêm, sửa, xoá, nhập: Đà Nẵng. Duyệt: Xã Điện Hồng."
- **Đơn vị chưa gán:** the features whose managing unit is `VN` only because they have no geometry.

On the map, the feature form gains a *Đơn vị chủ quản* field. Its picker offers only units within the user's jurisdiction.

## 2. Staging, personal maps and sharing

### Personal maps

A personal map (`workspace.maps`) has an owner, a title, a description, a revision number and one or more layers (`workspace.map_layers`). A layer is one of:

| Layer kind | Stored as |
|---|---|
| **Free layer**, from an uploaded file or drawn new | rows in `workspace.features`: geometry in EPSG:4326, all original attributes in `jsonb`, the source CRS, and the row number in the source file. A drawn layer has fields its creator defines (name; type text, number or date). |
| **Edit copy of an official layer** ("Sửa lớp Đập") | a pointer to a `packages/versioning` draft of that layer. Its rows sit in `water.<layer>` with `is_current = false`. |
| **Raster** | a Cloud-Optimized GeoTIFF in the file store, with its metadata |
| **Annotation** | section 6.4 |

Each layer stores its own style.

### Writes

- Every add, change or delete is its own short transaction against the draft or the free layer, so a personal map can live as long as needed.
- The map's revision number guards against two tabs editing at once. A write against a stale revision is refused with "Bản đồ đã thay đổi ở nơi khác"; it does not overwrite.
- The admin-only edit session that holds a transaction open is replaced by this mechanism (P2).

### Import and export jobs

- A worker service with GDAL takes jobs from `workspace.jobs`, a PostgreSQL table read with `FOR UPDATE SKIP LOCKED`, so no Redis or other queue is needed. The worker reuses the atlas-tools image and runs as one more Compose service.
- GDAL reads GeoPackage, GeoJSON, zipped Shapefile, KML and GeoTIFF, and reads `.prj` files. It transforms VN-2000 TM-3 using the proj4 strings in `packages/shared/src/crs.ts`.
- Jobs report progress and per-step errors. The interface polls them.
- **Uploaded rasters** are converted to COG. **Original files** are always kept.

### Download

- Formats: GeoPackage, GeoJSON and zipped Shapefile. The coordinate system is chosen from `crs.ts`.
- A GeoPackage exported from the app carries a metadata table: the map title, layer styles and, for edit-copy layers, each feature's `external_id`. Importing that file back restores the layers and their styles, and its features can still be matched to official ones in flow 1.
- **Shapefile limits:** column names of at most 10 characters, one geometry type per file. The export splits by geometry type and lists, before downloading, the columns whose names will be cut. Styles are lost, with a warning.

### Sharing in the app

`workspace.map_shares (map_id, user_id | group_id, created_by, created_at)`.

- The recipient sees the map under *Được chia sẻ với tôi*. They can view it, or *Tạo bản sao*. Copying duplicates free layers; an edit-copy layer becomes a new draft on the same parent.
- Only the creator edits the original.
- **Revoking a share** removes the recipient's view. Copies already made stay theirs.

### On the map

- The left panel gains *Bản của tôi* next to Mục lục, with a toggle per layer.
- An edit-copy layer is drawn like the official layer, with an overlay marking what changed.
- Personal layers are valid inputs to the analysis tools (ROI, select within, and so on) and appear in print.
- Personal data is served by the API (GeoJSON or vector tiles, COG by byte range) only after an ownership or share check.

### Privacy

Only the creator and the people a map is shared with see its content. Admin sees counts and sizes, not content.

### Limits and cleanup

- **Quota:** 1 GB per user by default; admin can change it.
- **Inactive maps:** a personal map with no activity for 180 days triggers a notice to its owner, and is archived 30 days later. Archiving discards its drafts and keeps its original files for another 90 days.
- **Deleting a personal map** discards its drafts.
- **Published versions are never cleaned up.** They are official versions now.

### Isolation, proven by tests

- `webatlas_assistant` cannot read the `workspace` schema.
- No `_active` view returns a row of any draft version, whatever its status.
- No GeoServer feature type points at `workspace`. The `publish-geoserver` stage refuses one.
- Every API route that serves personal data refuses a user who is neither the owner nor a share recipient.

## 3. Submit, review, publish

### Submissions

A submission (`app.submissions`) targets exactly one thing: one of the 8 layers, or one catalogue map. Each publish makes one version, and versions are per layer. A personal map that edits dams and lakes therefore makes two submissions on *Nộp*, reviewed separately.

```
Cá nhân ──Nộp──► Đã nộp ──Xuất bản──► Đã xuất bản
   ▲               │  │
   │◄──Rút lại─────┘  └──Trả lại (reason required)──► Trả lại ──edit, Nộp──► Đã nộp
```

- Once submitted, the draft is read-only. To change it, the submitter withdraws it first.
- Every transition is written to `app.submission_events` (who, when, note). A submission keeps all its rounds.

**Checks on submit:**
- the submitter holds `feature.*` or `map.import` on the managing unit of every feature the submission touches (flow 1 and edit copies), or on the map's managing unit (flow 2);
- no row is left in the error state (section 4).

### Who reviews

A user holding `submission.review` whose jurisdiction covers *all* units the submission touches.

- A submission that touches two tỉnh needs a reviewer whose jurisdiction covers both, usually at Bộ level. There is no partial approval, since a submission is one version.
- Each reviewer's queue shows only the submissions they can review.
- A submitter who already holds `submission.review` on every unit involved sees **Xuất bản ngay**. That submits and publishes in one step, and the submission records "tự duyệt" (U16).

### The review screen (Quản lý → Hàng chờ duyệt)

- **Summary:** counts of added, changed and deleted features; the units involved; the submitter; the submitter's note.
- **Before and after on the shared map:** a three-colour overlay. The swipe from section 6.3 is added in P10.
- **A per-feature diff table** of attributes and geometry. Clicking a row flies the map to that feature.
- **Warnings** carried over from validation, and **conflicts**.
- **Actions:** *Xuất bản*; *Trả lại* (a reason is required, and per-feature notes are allowed).

### Conflicts: per-feature rebase in `packages/versioning`

Today `commitEditDraft` refuses a draft as soon as its parent is not the active version, and the user must redo every edit. With drafts that live for days that would happen almost every time. The design adds a per-feature rebase:

1. Find the `external_id`s the draft touches, and the `external_id`s changed between the draft's parent and the current active version.
2. **If the intersection is empty,** move the draft onto the current active version as its new parent. No one has to act.
3. **If it is not empty,** mark each such feature as a conflict, with three states shown: base, current and draft. The submitter chooses per feature: keep mine, or take current. A reviewer may only take current (drop the submitter's change) or return the submission; a reviewer never writes over a submitter.

Rebase runs when the submitter presses *Cập nhật theo bản mới nhất*, and again inside the publish transaction.

### Publishing: one transaction

1. Lock the layer's active version, then rebase if needed.
2. Restamp the admin codes, then re-check every managing unit against the publisher's grants.
3. Activate the draft. `versionsService.activate()` maintains `is_current`.
4. Set the submission to Đã xuất bản and write the audit entries. The version label reads "Phiếu #123, nộp bởi A, duyệt bởi B".

If any step fails, everything rolls back and the submission stays Đã nộp with the error shown. The submission row is locked (`FOR UPDATE`), so a second reviewer pressing at the same moment sees "Đã được B xuất bản lúc …".

After commit:
- the GeoServer tile cache of the layer is truncated, only within the bounding box of the changes;
- the vector-tile version is bumped;
- the assistant sees the new data at once.

### Rolling back

- **The latest version of a layer:** reactivate its parent. This requires `submission.review` on every unit that version touched.
- **An older submission, with later ones on top:** the system builds a *revert draft* as a personal map. It goes through the normal submit and review. Later published changes are therefore never silently undone.

### Notifications

In the app only:
- the submitter is told when a submission is published or returned;
- reviewers see a count of waiting submissions on the top bar.

There is no mail server, so email is out of scope.

## 4. Flow 1: importing into one of the 8 layers

A wizard on the map, in a wide dialog over it. The preview step uses the live map. Progress is saved, so a user can stop and resume.

1. **File and target layer.** The target is suggested from the geometry type and the column names.
2. **File check** (worker):
   - format; CRS (a missing `.prj` asks the user, with a suggestion from the data's position);
   - geometry type; row count; the share lying outside the working region.

   A file that fails stops with a reason.
3. **Column mapping.**
   - Pick a saved template or map afresh. Suggestions come from names and types.
   - Transformations:
     - rename;
     - number parsing, detecting `1.234,5` versus `1,234.5` per column;
     - unit factor;
     - year from a date;
     - value map (for enumerated columns);
     - constant fill;
     - trim.
   - There is no free expression language.
   - Columns with no target go to `extra_attributes` (U13). The key picker suggests keys already published for the same layer, so `DUNG_TICH` and `DT_HO` can both map onto an existing `dung_tich`; the user may still keep their own key.
   - A mapping can be saved as a template (`workspace.mapping_templates`), owned by a user or shared with a group.
4. **Feature matching.** Each row becomes *Thêm mới*, *Sửa* (with its diff) or *Không đổi*.
   - **By key, when a column is mapped as the key.** Agency codes differ from system codes (`QN-014` against `vn-dam-0831`), so `app.feature_aliases (layer_key, external_id, template_id, source_key)` records a confirmed pairing, and later imports with the same template match automatically.
   - **Without a key,** candidates come from distance (points within 200 m; lines and polygons by overlap) and name similarity (`pg_trgm`, already installed). Each match carries a confidence score. The user reviews matches one by one, or presses *Chấp nhận mọi ghép tin cậy cao*. No match is accepted without the user.
   - *Không đổi* rows add nothing to the draft.
   - **Deletes** are proposed only when the user marks the file as "danh sách đầy đủ cho đơn vị X". Then the active features of X that are absent from the file are proposed for deletion, listed explicitly.
5. **Row validation** against the layer's `attributeSchema` (already in code): type, required, range, allowed values; geometry validity; duplicate keys within the file; duplicate geometries.
   - Each row is Đạt, Cảnh báo or Lỗi.
   - Geometry repairs (`ST_MakeValid`; a centroid when a point layer receives polygons) are proposed and need the user's confirmation.
   - **Nothing is coerced silently.** In particular `toDamStatusSlug`'s fallback to `binh_thuong` is not used on import; an unmapped status is an error.
   - Error rows must be fixed, or explicitly excluded with a record of the exclusion.
   - Beyond 1,000 errors the screen shows the first 1,000, and a full CSV error report can be downloaded.
6. **Preview and save.** The map shows a three-colour overlay with counts. Saving makes the worker write the candidate rows into a draft of the target layer, attached to a personal map. From there the user edits on the map like any personal map, then submits (section 3).

### Changes to the official layers

- The 8 layers gain `extra_attributes jsonb NOT NULL DEFAULT '{}'`, versioned.
- The feature card gains a *Thuộc tính bổ sung* section showing each key with its source.
- Adding the column means recreating the `_active` views and reloading the GeoServer feature types. That happens in the migration and in atlas-data's `publish-geoserver` stage.
- GeoServer exposes `jsonb` as a string. WFS still reads it but cannot filter inside it; the attribute table (6.2) filters through the API instead.

**Initial limits:** 200 MB and 200,000 rows per file. A larger file is refused before processing, never half-processed.

## 5. Flow 2 and the map catalogue

### The catalogue is code

Redesign sub-project 2, built before flow 2.

- `packages/shared` declares the 60 maps of Bảng 5, the 21 chuyên đề and the 6 group bars. Each map has:
  - its Bảng 5 number, name and kind (overlay, fill, river colour);
  - its data source: one of the 8 layers, or "thematic map";
  - its default style;
  - for vector thematic maps, a light attribute schema of required fields, for example `luong_mua_mm` for the rainfall map.
- The panel, the legend, the switching rules and the assistant all read this one catalogue.
- **Adding a 61st map is a code change, not an interface action.** The thuyết minh fixes the 60, and each needs a designed style. A map outside the catalogue can live as a personal map.

### Periods and versions

These are two separate notions, in a new `atlas` schema:

- **A period** (`atlas.map_periods`) answers "data for when": "Lượng mưa năm 2024" and "Lượng mưa năm 2025" are two periods, both published, both on the time slider.
- **A version** (`atlas.map_versions`) answers "which revision of that period": a corrected 2025 rainfall map is version 2 of period 2025.
- Each period has exactly one current version; older versions are kept for roll back.
- Metadata lives on the version: source, licence, scale, date, managing unit, style, `is_sample`.
- The candidate tier for flow 2 is a version in draft status. Publishing makes it current, with the same submission, review and audit as section 3. Whole-map replacement needs no per-feature diff, so `packages/versioning` is not used here.

### Storage and display

- **Raster:** COG in the file store. A published COG is served publicly by byte range. The browser renders it with OpenLayers' GeoTIFF source, colouring by the style's ramp and class breaks.
- **Vector:** one table, `atlas.map_features (version_id, geom, props jsonb)`, served as API vector tiles. This is the same mechanism as the province and xã boundaries (PRs #26 and #27), so no per-map GeoServer configuration is needed.

### The wizard

On the map:

1. File, target catalogue map, and period: new, or a correction of an existing one.
2. Check:
   - georeferencing, CRS, size, working region;
   - raster: band count, nodata, data type;
   - vector: geometry types and the required fields. Missing fields reuse flow 1's column mapping step.
3. Preview on the base map with the file's facts: name, CRS, size, corner coordinates, area, provinces covered, and whether it lies inside the working region. Nothing is saved before this step passes.
4. Map details: name, period, source, licence, scale, managing unit, style. The style is prefilled from the catalogue and editable.
5. Save as a personal map → submit → review → publish.

### Quản lý → Danh mục bản đồ

- **A table of the 60 maps:** chuyên đề, status (*chưa có dữ liệu*, *có bản nháp*, *đã xuất bản*), periods, current version, managing unit, source.
- **Actions per map:** *Nhập phiên bản mới*, *Lịch sử phiên bản*, *Quay lại*, *Sửa thông tin*.
- **Editing the metadata of a published version** creates a new version that differs only in metadata, reviewed like any other.

### Sample data

Until real data arrives, sample maps take the same path as real ones, with `is_sample` set. Every surface marks them "dữ liệu mẫu" (redesign D7). Removing a sample map is one action and needs no code change.

## 6. Interactive tools

Built on what exists: drawing points, lines and polygons; vertex modify; translate; partial snapping; the self-intersection check (`features/map/model/drawAids.ts`, `DrawController`, `ModifyController`).

### 6.1 Advanced drawing and editing

- **Snapping** to official and personal layers. The user picks target layers and tolerance. Targets load for the current view, with a feature cap.
- **Tracing** along existing features (a river, a xã boundary) with OpenLayers Draw's `trace` option.
- **Geometry operations:**
  - split a line at a point, merge two lines;
  - cut a polygon with a line, merge two polygons;
  - add a hole; delete a vertex.

  The server computes them in PostGIS (the existing `geometry` module), so the results agree with validation. The browser draws the preview only.
- **Coordinate entry:**
  - per point or per vertex, in any coordinate system in `crs.ts` (VN-2000 TM-3, DMS…);
  - or by pasting a coordinate list (CSV).
- **Undo and redo.** Each operation written to a draft has an inverse; undo writes the inverse. The stack lasts for the browser session.
- The feature form gains *Đơn vị chủ quản* and *Thuộc tính bổ sung*.

### 6.2 Attribute table and query

- **The table** docks at the bottom of the map, for an official layer, a personal layer or a draft. Paging, sorting and filtering happen on the server, because rivers have 23,000 features.
- **Filters** are *field – operator – value* conditions joined by AND or OR, one level deep. Spatial conditions: in view, in the ROI, or in an administrative unit. Extra-attribute keys can be filtered too.
- **Filter safety:** field names are accepted only from the layer's `attributeSchema` or from existing extra-attribute keys. All values are bound parameters. Nothing typed by a user is concatenated into SQL.
- **Two-way selection:** selecting rows highlights on the map; selecting on the map highlights rows. Zoom to selection.
- **Bulk edit** of a field, or of the managing unit, for the selected rows.
  - Bulk edits always write into a personal "Sửa lớp X" map, never straight into the official layer.
  - Rows outside the user's jurisdiction are excluded, with a note.
- **CSV export**, and *Lưu vùng chọn thành bản cá nhân*.

### 6.3 Compare and time

- **Swipe.** A vertical divider with layer set A on the left and set B on the right, done by clipping layer rendering in OpenLayers.
- Swipe compares:
  - two maps;
  - two periods;
  - two versions of a layer. The API serves a layer's state at any version through `packages/versioning`'s `resolve.ts`.

  The review screen gains this in P10.
- **Time slider** for maps with several periods: pick a period, or press play.
  - The flood demo's slider is extracted into a shared component.
  - This is redesign sub-project 6's period picker.

### 6.4 Annotation

An annotation layer in a personal map.

- **Kinds:** text (size, colour, halo), arrow, callout (a point, a leader and text), a symbol from a small set, and a freehand outline with optional hatching.
- Each annotation carries its own style, and can be moved and edited.
- **Print** includes annotations, with text sized in print points at the chosen scale.
- **Export:**
  - GeoPackage and GeoJSON keep styles as properties;
  - Shapefile loses them, with a warning before export.

## 7. Sub-projects

This design is too large for one plan. Each sub-project gets its own plan (and a detailed spec where the plan needs one), its own review and its own merge, in this order:

| # | Sub-project | Contains | Depends on |
|---|---|---|---|
| P1 | Permissions and managing units | Section 1; the Quản lý shell (lazy-loaded `/quan-ly` route group); Nhóm quyền and Người dùng pages | — |
| P2 | Durable drafts | `packages/versioning`: draft status, per-operation writes, per-feature rebase and conflicts; replaces the open-transaction edit session | P1 |
| P3 | Staging and personal maps | `workspace` schema; GDAL worker and jobs table; free, edit-copy and raster layers; Bản của tôi; upload, download, share | P2 |
| P4 | Submit, review, publish | Submissions, review queue, publish, roll back and revert drafts, in-app notifications | P3 |
| P5 | Flow 1 | Column mapping, templates, aliases, feature matching, row validation, `extra_attributes` | P4 |
| P6 | Chuyên đề catalogue | Redesign sub-project 2: catalogue, panel, switching rules, legends | redesign sub-project 1 (done) |
| P7 | Flow 2 and catalogue management | `atlas` schema (periods, versions); COG raster; vector tiles; wizard; sample data | P4, P6 |
| P8 | Advanced drawing and editing | 6.1 | P3 |
| P9 | Attribute table and query | 6.2 | P1, P3 |
| P10 | Compare and time | 6.3; swipe in the review screen | P2, P7 |
| P11 | Annotation | 6.4 | P3 |

After P5 the whole "upload and edit maps" story can be shown on layers that already have data: import a file, edit, submit, review, publish, and be refused outside one's jurisdiction. That is the safe point if the seminar comes early. P6 depends on none of P1–P5 and can be slotted in anywhere.

This design supersedes the redesign's sub-project 5 (now P7, with the catalogue management screen) and sub-project 6's period picker (now in P10). It also drops the redesign's "Out of scope: changes to roles and permissions".

## Testing

- **`can()`:** a matrix test over levels, permissions and units, including multiple groups and the `VN` root.
- **API integration:**
  - a tỉnh officer edits a xã feature inside the tỉnh;
  - is refused in another tỉnh;
  - is refused when moving a managing unit outside their jurisdiction;
  - `users.manage` cannot escalate.
- **Migration:** the initial assignment counts are checked against the counts above (on the CI fixture, against the fixture's own counts).
- **Isolation tests** from section 2.
- **Versioning:**
  - rebase with an empty intersection;
  - rebase with conflicts;
  - publish racing a second publish;
  - publish failing midway, leaving no trace.
- **Flow 1:**
  - every transformation is a pure function with its own tests;
  - matching is tested on a small built fixture: by key, by alias, by distance plus name, and a tie between two candidates;
  - an end-to-end test imports the Quảng Nam dams example from the brainstorm (Vietnamese number format, kW to MW, dates to years, a status value map, two extra columns, one keyless row) through to publish, then imports it a second time and sees aliases match.
- **Flow 2:** a sample raster and a sample vector map go through publish, correction to version 2, and roll back.
- **Tools:** geometry operations on PostGIS; undo and redo as a pure model; the filter builder, including injection attempts.
- **Browser:** swipe, time slider, annotation print and every wizard step are proved in a browser with puppeteer. Screenshots are taken only after tile traffic goes quiet; jsdom is not enough for layout claims.
- `npm run build:web` runs before any claim of completion.

## Out of scope

- Email notifications.
- Per-layer or per-chuyên đề permission limits. Room is left in the model.
- Adding catalogue maps through the interface.
- Analysis on thematic rasters (zonal statistics on the rainfall map, and so on). Rasters are display-only in this design.
- Several people editing one personal map together.
- Layouts below 768 px.
- Reservoir release schedules (lịch xả) and the KTTV station API. They are data feeds, not part of upload and editing.

## Assumptions awaiting confirmation

Made while designing. The user has not ruled on them.

1. Admin sees counts and sizes of personal maps, not their content.
2. The quota is 1 GB per user. A personal map is archived after 180 days of inactivity plus 30 days' notice.
3. Files are limited to 200 MB and 200,000 rows.
4. Without a key, point matching uses 200 m.
5. A submission is reviewed whole. A submission touching two tỉnh needs one reviewer covering both.
6. A reviewer may drop a submitter's conflicting change but not overwrite it.
7. Mapping templates belong to a user or are shared with a group.
8. Templates for groups are interface presets, not groups.
9. The managing unit of a feature without geometry is `VN`, pending manual assignment.
10. Adding a catalogue map is a code change.
