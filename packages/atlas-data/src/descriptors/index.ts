import { demo } from './demo';
import { adminBoundaries } from './adminBoundaries';
import { dams, stations, floodZones, droughtPoints, saltwaterIntrusion, floodGeneration, lakes } from './layers';
import { rivers } from './rivers';
import { basemap } from './basemap';
import { referenceEntities } from './referenceEntities';
import { dem } from './dem';
import { contours } from './contours';
import type { Dataset } from '../types';

/** Every registered dataset. Adding one means adding a line here and a descriptor file. */
export const DESCRIPTORS: Dataset[] = [
  demo, adminBoundaries, dams, stations, floodZones, droughtPoints, saltwaterIntrusion, floodGeneration, lakes,
  rivers, basemap, referenceEntities, dem, contours,
];
