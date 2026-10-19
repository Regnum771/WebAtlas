# Runbook — Permissions by administrative level and managing units

Operates the permission model added in P1: three administrative levels (`VN` → province → ward),
permission **groups** that hold rights on a set of units, and a **managing unit** stored on every
feature. Read it after applying migration `1000000000025_access-groups-managing-unit`.

## The model in four lines

- Units form a tree of three levels: `VN` (the ministry), provinces (2-digit codes) and wards
  (5-digit codes). A right on a unit covers everything below it.
- Rights are held by **groups**, never by users. A group has units, permissions and members.
- The `admin` role does everything everywhere without belonging to any group. Only an admin
  creates, edits and deletes groups. The `editor` role is retired; former editors are viewers.
- Until submissions exist (P4), every write publishes immediately, so a write needs
  `feature.<create|update|delete>` **and** `submission.review` on the feature's managing unit.

## After migration 25: reset GeoServer once

The migration adds `managing_unit` to the eight water layers. GeoServer caches each layer's
schema, so WFS keeps serving the old attributes until the cache is reset. Run this once on every
environment, after the migration:

```bash
# Credentials come from apps/api/.env: GEOSERVER_ADMIN_USER, GEOSERVER_ADMIN_PASSWORD, GEOSERVER_URL.
set -a; . apps/api/.env; set +a
curl -u "$GEOSERVER_ADMIN_USER:$GEOSERVER_ADMIN_PASSWORD" -X POST "$GEOSERVER_URL/rest/reset"
```

HTTP 200 means done. Check with `DescribeFeatureType`; the output must list `managing_unit`:

```bash
curl "$GEOSERVER_URL/webatlas/ows?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=webatlas:dams"
```

Until the reset, WFS responses (what the map's edit form reads) do not carry `managing_unit`.

## Create the first groups from templates

No group exists after the migration, so only admins can sign in to Quản lý at first.

1. Sign in as an admin. Open **Quản lý → Nhóm quyền → Tạo nhóm**.
2. Under **Từ mẫu** pick a template. A template is a preset of the form, not a group; nothing
   is stored until you press **Lưu**.

   | Template | Level of the units to pick | Permissions it fills in |
   |---|---|---|
   | Cán bộ cấp Bộ | `VN` | feature.create, feature.update, feature.delete, map.import |
   | Cán bộ cấp tỉnh | provinces | the same four |
   | Cán bộ cấp xã | wards (open a province to see them) | the same four |

3. Pick the units. A selected province already covers its wards, so the picker greys them out.
4. **Tick "duyệt và xuất bản" (`submission.review`).** No template includes it, and until P4 a
   write is refused without it, so a group without it can open Biên tập but cannot save.
5. Name the group and save. Then open **Quản lý → Người dùng**, press **Nhóm** on a user and tick
   the group. A user may belong to several groups; the rights add up.

`users.manage` lets a holder add users to groups. It never escalates: a holder can only add a
user to a group whose units all lie inside the holder's own `users.manage` jurisdiction and whose
permissions are a subset of the holder's.

What a user sees follows from the groups: Biên tập appears for anyone who can update and review
somewhere; Quản lý appears for admins, `users.manage` holders, and anyone who can update at `VN`.
These are conveniences only; the API refuses anything outside the groups' units on every call.

## Refusals

A write outside the user's units answers 403 with the unit named:

> Đối tượng thuộc {unit}; nhóm của anh/chị chỉ có quyền trong {units}.

A user with no right of that kind anywhere gets: `Anh/chị chưa có quyền {permission} ở đơn vị nào.`

## What "Đơn vị chưa gán" means

Every feature has a managing unit, set when it is first created or ingested and then versioned
with the feature. It is never recomputed from geometry afterwards. The first assignment takes the
smallest unit containing the feature, using `admin.wards` and `admin.provinces`:

- the geometry touches exactly one province and exactly one ward: that ward;
- otherwise, if it touches exactly one province: that province;
- it touches no province or several provinces: `VN`.

A feature **without geometry** touches nothing, so it is assigned to `VN`. **Quản lý → Đơn vị chưa
gán** lists exactly those features (managing unit `VN` and no geometry): today the dams the source
data gave no coordinates for. Only someone who may update at `VN` can open the page and use
**Gán đơn vị** to give a feature its real unit. A feature that has a geometry but sits at `VN`
(for example one crossing two provinces) is not listed; it is a legitimate `VN` feature.

## Verify it in a browser

`apps/web/scripts/verify-permissions.mjs` runs the whole story in Chrome at 1440 and 768 px: it
creates two test groups from the templates, assigns two users, edits a lake as the province user,
shows the read-only field and the 403 for the ward user, checks that a visitor sees neither Biên
tập nor Quản lý, and opens Đơn vị chưa gán. It deletes its groups at the end and puts a lake's name
back after editing it. It prints PASS or FAIL per step and exits non-zero on any FAIL.

Needs the Docker stack, the API (`npm run dev -w @webatlas/api`), the web dev server
(`npm run dev:web`) and Chrome. It reads credentials only from the environment. Create three
accounts first: one admin and two viewers with no group (the script assigns the groups).

| Variable | Account |
|---|---|
| `VERIFY_ADMIN_EMAIL`, `VERIFY_ADMIN_PASSWORD` | an admin |
| `VERIFY_P_EMAIL`, `VERIFY_P_PASSWORD` | a viewer; becomes the province user (Đà Nẵng) |
| `VERIFY_X_EMAIL`, `VERIFY_X_PASSWORD` | a viewer; becomes the ward user |

```bash
npm run verify:permissions -w @webatlas/web -- --out <screenshot-dir>
```

Optional: `BASE_URL`, `API_URL`, `CHROME_PATH`, `X_WARD` (the ward of the second group, default
`20551`), `P_LAKE_WARD` (default `20209`). Run it against a development database only: each lake edit
leaves an edit version behind (the script saves the old name back, but the versions stay).
