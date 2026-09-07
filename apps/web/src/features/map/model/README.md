# map/model — the only place OpenLayers map construction lives

`MapModel` owns the OpenLayers `Map`, its layers, styles, and interactions. Views,
presenters, and providers call `MapModel` methods; they do not import `ol/*` to build the
map. `MapView` renders the target `<div>` and drives `MapModel` lifecycle; `MapProvider`
holds React state and delegates to `MapModel`.

Files here (`MapModel.ts`, `styles.ts`, `wfsSource.ts`) are the only ones that import
`ol/*` for map construction.

**Transitional exception (removed in Plan 3c):** the provider still exposes the raw OL
`map` via `useMapContext().map`, and two not-yet-migrated panels use it directly —
`MapControls` (measure/zoom), `OGCClient` (WMS). Plan 3c moves those interactions onto
`MapModel` methods and removes the raw-`map` surface. `features/search` no longer needs
this exception: it drives the map only through `createCommandExecutor` (`mapCommands.ts`),
same as every other command-issuing feature.
