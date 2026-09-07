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

export function buildTools(ctx: ToolContext) {
  return FACTORIES.map((factory) => factory(ctx));
}
