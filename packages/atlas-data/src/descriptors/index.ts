import { demo } from './demo';
import { seeds } from './seeds';
import { rivers } from './rivers';
import { basemap } from './basemap';
import { referenceEntities } from './referenceEntities';
import { dem } from './dem';
import { contours } from './contours';
import type { Dataset } from '../types';

/** Every registered dataset. Adding one means adding a line here and a descriptor file. */
export const DESCRIPTORS: Dataset[] = [demo, seeds, rivers, basemap, referenceEntities, dem, contours];
