# UI Overhaul + Map Assistant — Design

**Date:** 2026-09-07
**Status:** Approved design — ready for implementation planning
**Branch:** builds on `feat/region-scoping-osm-water`
**Scope:** Frontend UI restructure and visual redesign, plus a server-side LLM assistant that answers questions about map entities and drives the map through natural language.

**Related, deliberately separate specs (not this one):**

- **Spec 3 — Legal document RAG.** Corpus ingestion, chunking, embeddings, retrieval, citations. Blocked on nothing but this spec; genuinely valuable only once the assistant exists.
- **Spec 4 — Prediction-data grounding.** Blocked: no model prediction data exists in the repository.

## Problem

Two problems, merged into one spec at the user's direction because they share a seam (below).

### 1. The UI has drifted into unmaintainable shapes

| Area | File | Defect |
|---|---|---|
| Quản lý Dữ liệu | `apps/web/src/components/LayerTree.tsx:3` | Reads `layerGroups` from `data/mockData` — hardcoded mock data, not the real `/api/layers` catalog |
| Chú giải | `apps/web/src/components/DynamicLegend.tsx` | Not data-driven: hardcoded `if (layer.id === 'layer_dams')` branches with ~40 inline styles |
| Search bar | `apps/web/src/components/SearchBar.tsx:18-30` | Fetches the entire `dams` layer over WFS on mount with no bbox, contradicting the merged bbox/zoom-gating performance work. Searches dams only, `any[]` throughout |
| Toolbar | `apps/web/src/components/MapControls.tsx` | 246 lines mixing zoom, scale, and measurement; imports `ol/interaction/Draw`, `VectorSource`, `getLength` directly, breaking the OpenLayers quarantine |
| Composition | `apps/web/src/app/App.tsx:30-56` | Seven floating overlays as absolutely-positioned siblings with one blunt "hide everything" toggle |

All of the above live in `components/`, the pre-FSD holdover, bypassing the Feature-Sliced structure the rest of the app follows.

### 2. There is no assistant, and no surface one could safely drive

The map can only be controlled by clicking. Nothing in the codebase exposes map actions as callable operations, so any natural-language control built today would reach into OpenLayers a second time, in parallel with the toolbar.

## Goals

1. A coherent shell that has room for the AI panel and for the roadmap's future persona panels.
2. Panels driven by real data (`/api/layers`, layer descriptors) rather than mock objects and per-layer branches.
3. The OpenLayers quarantine restored: one module touches OL.
4. An assistant that answers questions about map entities and their relationships, acts on the map, knows what the user is currently looking at, and attaches provenance to what it asserts.
5. A tool layer that is modular — adding a capability means adding a file, not editing a dispatcher.

## Non-goals

- **Not RAG yet.** See "What this is not" below.
- No cross-session chat memory. Multi-turn within a session only, at the user's direction.
- No streaming of model output in v1.
- No changes to `DynamicPopup.tsx`, despite it sharing the legend's per-layer-branching defect. Out of what was asked.
- No new authorization roles. The existing `admin | editor | viewer` matrix is unchanged.

## What this is not

**The v1 assistant is not a RAG system.** There is no corpus, no embedding store, and no retrieval step. It performs structured querying over PostGIS and attaches provenance to the results. This distinction is recorded because the architecture is designed to accept retrieval as an additional tool class in spec 3 — at which point the description becomes accurate. Anyone reading this later should not expect to find a vector store.

**The assistant design is under-refined and known to be so.** The user has accepted it at this level to proceed. The areas that need another design pass before or during implementation are listed in "Open for refinement".

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Layout | Icon rail + docked flyout | Scales to the roadmap's Governance/Research persona panels without another layout change |
| Visual language | Dark chrome, light panels | Frames the map so data colours read as data; replaces `.glass-panel` |
| Agent runtime | Anthropic SDK Tool Runner | Fewer layers than LangChain; LangChain enters in spec 3 for document loaders/splitters |
| Model | `claude-haiku-4-5` | User's choice. 200K context, $1/$5 per MTok |
| Tool execution | Two classes — data server-side, commands client-side | Measurements stay authoritative in PostGIS; map actions reuse the UI's command layer |
| Query model | Typed tools first, guarded SQL as escape hatch | User's choice; the more capable and more expensive of the options offered |
| Access | Authenticated users only | Every message costs API tokens; anonymous traffic against a paid API is unbounded cost |
| Grounding | Soft grounding with labelled general knowledge | User's choice — see the recorded risk |
| Response language | Vietnamese | Matches the entire existing UI |

## Architecture

### The seam: a typed command layer

One shared schema, two callers — the UI and the assistant:

```
packages/shared/src/map-commands.ts   ← one schema, imported by both sides
        │
        ├─ apps/api  … assistant tools emit MapCommands, validated against it
        └─ apps/web  … the command layer executes them against OpenLayers
```

This is what makes a merged spec defensible rather than two features in a trenchcoat: the assistant's map control is not a parallel implementation of the toolbar, it is the same commands the buttons fire.

### Frontend slices

| Slice | Replaces | Responsibility |
|---|---|---|
| `features/map/model/mapCommands.ts` | scattered OL calls | `zoomToRegion`, `zoomToFeature`, `setLayerVisible`, `setLayerOpacity`, `highlightFeatures`, `measure`, `setBasemap`. The only module that touches OpenLayers |
| `features/layers-panel/` | `components/LayerTree` | Layer control from `/api/layers` + the shared registry |
| `features/legend/` | `components/DynamicLegend` | Renders `LegendDescriptor` data; no per-layer branches |
| `features/search/` | `components/SearchBar` | Calls the new search endpoint; no full-layer WFS fetch |
| `features/assistant/` | — | Chat panel, tool-progress display, command dispatch |
| `features/shell/` | extended | Icon rail + flyout host, absorbing today's burger drawer |
| `shared/ui/tokens.css` | `.glass-panel`, inline styles | Colour, spacing, radius, elevation tokens |

### Backend modules

- `modules/assistant/` — route, tool runner, tool registry, session store, SQL guard. Follows the existing `controller / service / repository` pattern.
- `modules/search/` — `GET /api/search`, PostGIS trigram matching across layers.

### Shared contracts

- `packages/shared/src/map-commands.ts` — the command schema.
- `packages/shared/src/legend.ts` — `LegendDescriptor` per layer, consumed by the legend panel. ODbL attribution for OSM layers is a descriptor field so it cannot be forgotten.

## UI design

**Shell.** Dark chrome (top bar + 48px icon rail) framing light content panels. Rail entries: Lớp dữ liệu, Chú giải, Trợ lý, Biên tập (editor/admin only). The flyout is **docked** — it pushes the map rather than overlaying it, which is what lets the legend stay usable while reading the map, and why the legend needs no second always-visible implementation. Closing the active rail item yields a full-bleed map, retiring the `panelsVisible` toggle at `App.tsx:47-55`.

**Quản lý dữ liệu.** Sourced from `/api/layers` plus the shared registry. Groups derive from layer metadata. Basemap selection moves out to the map toolbar, leaving this panel one job: visibility, opacity, per-layer status. Zoom-gating becomes visible — a gated layer greys out with "hiện từ mức 8,5" rather than silently vanishing, which is a real source of confusion since the performance work landed.

**Chú giải.** Driven by `LegendDescriptor`: `{ swatch, label, kind }` entries per layer, with dam status and capacity expressed as data. Adding a layer means adding a descriptor.

**Search.** Moves to the top bar; calls `GET /api/search?q=&bbox=` backed by PostGIS trigram matching across all layers. Results group by layer with type badges; selecting a result fires `zoomToFeature` — the same command the assistant calls.

**Toolbar.** A vertical dark rail on the right: zoom in/out, reset to working region, scale indicator, measure length, measure area, basemap. Every button calls a command; none touches OpenLayers directly.

**Tokens.** The dark-chrome palette is checked against the hazard-layer colours so chrome never competes with data.

## Assistant design

**Route.** `POST /api/assistant/messages`, authenticated (`admin | editor | viewer`), rate-limited per user via the existing `@fastify/rate-limit`. Request `{ sessionId, message, mapContext }`; response `{ reply, commands[], provenance[] }`.

**Loop.** `claude-haiku-4-5` driven by the SDK Tool Runner (`client.beta.messages.toolRunner` with `betaZodTool` definitions). No thinking configured: Haiku 4.5 takes `budget_tokens` rather than adaptive thinking, and a tool-routing agent does not need it — latency and cost dominate here.

**Prompt caching.** Tool definitions are resent every turn and dominate the prompt. The stable system prompt and tool list come first with a `cache_control` breakpoint; the volatile `MapContext` goes in the **latest user turn**, never in the top-level `system` field, which would invalidate the cache on every message. (Mid-conversation system messages would be the natural home for operator context, but Haiku 4.5 does not support them.)

**Tool classes.** One registry, one file per tool exporting `{ definition, execute }`:

| Class | Executes | Returns | Examples |
|---|---|---|---|
| Data | Server, PostGIS | facts + provenance | `distanceBetween`, `areaOf`, `nearestFeatures`, `featuresInRegion`, `filterByAttribute`, `relatedFeatures` |
| Command | Emits a validated `MapCommand` | command + confirmation text | `zoomToRegion`, `zoomToFeature`, `setLayerVisible`, `highlightFeatures`, `setBasemap` |

Command tools satisfy the requirement that tool use acts on the map *and* returns chat text: the map moves and the reply says "Đã phóng to tới Đắk Lắk." Measurement runs in PostGIS, so "khoảng cách giữa hai đập là 42,3 km" is authoritative rather than dependent on screen projection.

**Map context.** `MapContext` — viewport bbox, zoom, visible layer keys, selected feature, active basemap, pending measurement — is serialized into each user turn. This is what makes "hồ nào lớn nhất ở đây" resolvable.

**Multi-turn.** Server-side session store keyed by `sessionId`, in memory with a TTL, holding the message array. Not persisted across sessions, per the user's instruction.

**SQL escape hatch.** Two independent layers, because a parser check is not a security boundary:

1. **Database privileges — the real boundary.** A dedicated `webatlas_assistant` role with `USAGE`/`SELECT` on the `water` schema and the active-version views only, and **no grant of any kind on the `app` schema**. A perfect injection still cannot reach `app.users` (argon2 hashes) or `app.audit_log`.
2. **Query guard.** Single statement; `SELECT`/`WITH` only; `SET LOCAL default_transaction_read_only = on`; `statement_timeout = 3s`; enforced `LIMIT`.

Generated SQL is returned in the provenance block so a reviewer can see what ran.

**Grounding.** Tool-derived facts carry a source chip naming the tool, the row count, and the `dataset_version` served. Model knowledge renders in a visually distinct labelled callout — bordered, with its own background, not italics, since a subtle label is one users skim past. One guard is added on top of the user's choice: **when a tool exists for the question and returns no rows, the agent reports "no data" rather than answering from its own knowledge.** That is the difference between "I have no record of that" and an invented dam count.

**No streaming in v1.** With tool use, the latency that matters is tool execution. The panel shows which tool is running ("đang đo khoảng cách…") rather than streaming tokens — simpler, and more informative.

## Testing

The command-layer seam is what makes this testable without a browser or a live model:

- **Commands** unit-test against a fake map object.
- **Assistant tools** unit-test by asserting the `MapCommand` emitted and the SQL generated — no LLM in the loop.
- **The SQL guard** gets adversarial tests. Access to `app.users` must fail at the **database privilege** level, asserted against the role's actual grants, not merely rejected by the parser.
- **Legend descriptors** get snapshot tests.
- **Intent routing** is the one place a live model is required: a fixture set of Vietnamese prompts asserting which tool is selected, run on demand rather than in CI, because it costs tokens.

## Risks

| Risk | Standing |
|---|---|
| Per-user API cost is unbounded until rate limits are tuned | Needs a per-user daily token ceiling from day one |
| The labelled-general-knowledge block depends on users reading the label | Accepted by the user after the risk was raised; mitigated by making the callout visually strong rather than italicised |
| Intent routing on Haiku for Vietnamese queries is unproven | The fixture set exists to measure it before access widens |
| Merged scope makes one large spec | Mitigated by the command-layer seam and by phasing the plan into independent increments |

## Open for refinement

The assistant is accepted at this level of detail to proceed, but these need another pass:

1. **Retrieval architecture** — how spec 3's document retrieval joins the tool registry, and whether provenance for retrieved text differs from provenance for query results.
2. **The relationship model** — "entities and their relationships" is currently served by ad-hoc tools (`relatedFeatures`). Whether a general relationship representation is needed is unsettled.
3. **Provenance schema** — the shape of a provenance record has not been specified beyond its fields.
4. **Session and cost policy** — TTL, per-user ceilings, and behaviour at the ceiling.
5. **Failure UX** — what the panel shows when a tool errors, times out, or the model refuses.

## Phasing

The implementation plan lands these as independent increments: command layer → UI slices → search endpoint → assistant skeleton with two tools → full tool set → SQL escape hatch.
