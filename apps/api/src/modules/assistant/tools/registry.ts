import type { ToolContext, ToolFactory } from './types';
import { zoomToRegionTool } from './command/zoomToRegion';
import { zoomToFeatureTool } from './command/zoomToFeature';
import { setLayerVisibleTool } from './command/setLayerVisible';
import { setBasemapTool } from './command/setBasemap';
import { highlightFeaturesTool } from './command/highlightFeatures';
import { featuresInViewTool } from './data/featuresInView';
import { nearestFeaturesTool } from './data/nearestFeatures';
import { distanceBetweenTool } from './data/distanceBetween';
import { areaOfTool } from './data/areaOf';
import { filterByAttributeTool } from './data/filterByAttribute';
import { relatedFeaturesTool } from './data/relatedFeatures';

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
  featuresInViewTool,
  nearestFeaturesTool,
  distanceBetweenTool,
  areaOfTool,
  filterByAttributeTool,
  relatedFeaturesTool,
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
  return FACTORIES.map((factory) => guardToolErrors(factory(ctx) as never));
}
