import { dams } from './dams.js';
import { rivers } from './rivers.js';
import { lakes } from './lakes.js';
import { stations } from './stations.js';
import { flood_zones } from './flood_zones.js';
import { drought_points } from './drought_points.js';
import { saltwater_intrusion } from './saltwater_intrusion.js';
import { flood_generation } from './flood_generation.js';
/** The code copy of the data dictionary, keyed by layer key: the defaults and the fallback. */
export const DICTIONARY = Object.freeze({
    dams,
    rivers,
    lakes,
    stations,
    flood_zones,
    drought_points,
    saltwater_intrusion,
    flood_generation,
});
