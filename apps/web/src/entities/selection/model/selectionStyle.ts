import { makeRiverSelectStyle } from '../../../features/map/model/styles';

/**
 * Highlight style for the single selection interaction. Rivers keep the exact look
 * they had under MapModel's rivers-only Select (which this replaces); everything else
 * gets the same treatment so one visual language means "this is selected".
 *
 * `makeRiverSelectStyle()` takes no arguments and returns the OL StyleFunction itself
 * (see MapModel's `style: makeRiverSelectStyle()` usage) — so this is a direct
 * re-export under the selection-domain name, not a wrapper.
 */
export const makeSelectionStyle = makeRiverSelectStyle();
