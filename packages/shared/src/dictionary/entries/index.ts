import type { Dictionary } from '../types.js';
import { dams } from './dams.js';
import { rivers } from './rivers.js';
import { lakes } from './lakes.js';
import { stations } from './stations.js';
import { flood_zones } from './flood_zones.js';
import { drought_points } from './drought_points.js';
import { saltwater_intrusion } from './saltwater_intrusion.js';
import { flood_generation } from './flood_generation.js';
import { provinces } from './provinces.js';
import { wards } from './wards.js';
import { contours } from './contours.js';
import { osm_water } from './osm_water.js';
import { flood_stations } from './flood_stations.js';
import { flood_wards } from './flood_wards.js';
import { flood_roads } from './flood_roads.js';
import { shelters } from './shelters.js';
import { flood_history } from './flood_history.js';
import { dem } from './dem.js';
import { flood_depth } from './flood_depth.js';

/** The code copy of the data dictionary, keyed by layer key: the defaults and the fallback. */
export const DICTIONARY: Dictionary = Object.freeze({
  // Editable layers.
  dams,
  rivers,
  lakes,
  stations,
  flood_zones,
  drought_points,
  saltwater_intrusion,
  flood_generation,
  // Read-only vector layers.
  provinces,
  wards,
  contours,
  osm_water,
  flood_stations,
  flood_wards,
  flood_roads,
  shelters,
  flood_history,
  // Rasters.
  dem,
  flood_depth,
});
