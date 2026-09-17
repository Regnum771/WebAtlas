import { config } from '../../../config/env';
import type { ToolContext, ToolFactory } from './types';
import { zoomToRegionTool } from './command/zoomToRegion';
import { zoomToFeatureTool } from './command/zoomToFeature';
import { setLayerVisibleTool } from './command/setLayerVisible';
import { setBasemapTool } from './command/setBasemap';
import { highlightFeaturesTool } from './command/highlightFeatures';
import { locatePlaceTool } from './data/locatePlace';
import { featuresInViewTool } from './data/featuresInView';
import { nearestFeaturesTool } from './data/nearestFeatures';
import { distanceBetweenTool } from './data/distanceBetween';
import { areaOfTool } from './data/areaOf';
import { filterByAttributeTool } from './data/filterByAttribute';
import { relatedFeaturesTool } from './data/relatedFeatures';
import { elevationAtPointTool } from './data/elevationAtPoint';
import { runSqlTool } from './data/runSql';
import { proposeFeatureUpdateTool } from './command/proposeFeatureUpdate';

/**
 * The whole tool surface, in a fixed order.
 *
 * Order matters for cost, not behaviour: tool definitions are resent on every
 * turn and sit inside the cached prefix, so a set that reorders itself between
 * requests would miss the cache every time. Adding a capability means adding a
 * file and one line here — never editing a dispatcher.
 *
 * The SQL escape hatch (Task 8) appends below.
 */
const FACTORIES: ToolFactory[] = [
  zoomToRegionTool,
  zoomToFeatureTool,
  setLayerVisibleTool,
  setBasemapTool,
  highlightFeaturesTool,
  locatePlaceTool,
  featuresInViewTool,
  nearestFeaturesTool,
  distanceBetweenTool,
  areaOfTool,
  filterByAttributeTool,
  relatedFeaturesTool,
  // Appended, never inserted: the order above is the cached prefix.
  //
  // Registered unconditionally, unlike runSqlTool below, even though the DEM it
  // reads is absent on a box that has not run scripts/load-dem.sh — so on such a
  // box this definition is prefix cost for a tool that can only answer "không có
  // dữ liệu". Accepted deliberately for now: the alternative is an async
  // capability probe (buildTools is synchronous) or an env flag that silently
  // drifts from whether the data is actually loaded. Revisit when the other two
  // elevation tools land — one probe gating three definitions pays for itself,
  // one gating a single definition does not.
  elevationAtPointTool,
];

/**
 * A tool that throws must not fail the whole request. The database can time out,
 * a geometry can be degenerate — the model should see the failure as a result it
 * can respond to ("thử cách khác, hoặc báo cho người dùng"), the same way it sees
 * an empty result. A thrown error inside the runner ends the turn with a 500 and
 * the user sees nothing.
 */
export function guardToolErrors<T extends { run: (input: never) => unknown }>(tool: T): T {
  const original = tool.run.bind(tool);
  return Object.assign(tool, {
    run: async (input: never) => {
      try {
        return await original(input);
      } catch (e) {
        const detail = e instanceof Error ? e.message : 'lỗi không rõ';
        return `Công cụ gặp lỗi: ${detail}. Hãy thử cách khác hoặc nói cho người dùng biết là chưa truy vấn được.`;
      }
    },
  });
}

export function buildTools(ctx: ToolContext) {
  // The escape hatch is only offered when a read-only role is configured.
  // Advertising a tool that always answers "not configured" wastes cached
  // prefix tokens on every turn and teaches the model to try it anyway.
  const factories = config.ASSISTANT_DATABASE_URL ? [...FACTORIES, runSqlTool] : [...FACTORIES];
  // Admin-only and LAST, so admin and non-admin each keep one stable cached
  // prefix. Offering it to others would only teach the model to promise edits
  // the API will refuse.
  if (ctx.role === 'admin') factories.push(proposeFeatureUpdateTool);
  return factories.map((factory) => guardToolErrors(factory(ctx) as never));
}
