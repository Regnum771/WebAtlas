import type { ZodTypeAny } from 'zod';
import type { AnalysisOp, AnalysisResult } from '@webatlas/shared';
import type { Queryable } from '../../assistant/tools/data/helpers';
import { BufferInput, NearestInput, ProfileInput, SelectWithinInput, ZonalInput } from '../schemas';
import { bufferOp } from './buffer';
import { elevationProfileOp } from './elevationProfile';
import { nearestOp } from './nearest';
import { selectWithinOp } from './selectWithin';
import { zonalElevationOp } from './zonalElevation';

export interface OpDef {
  schema: ZodTypeAny;
  // Each op's input type is enforced by its own schema at the route.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (db: Queryable, input: any) => Promise<AnalysisResult>;
}

/** One entry per op. The HTTP route and the assistant tools both call through here. */
export const OPS: Partial<Record<AnalysisOp, OpDef>> = {
  buffer: { schema: BufferInput, run: bufferOp },
  select_within: { schema: SelectWithinInput, run: selectWithinOp },
  nearest: { schema: NearestInput, run: nearestOp },
  elevation_profile: { schema: ProfileInput, run: elevationProfileOp },
  zonal_elevation: { schema: ZonalInput, run: zonalElevationOp },
};
