import { demo } from './demo';
import { rivers } from './rivers';
import type { Dataset } from '../types';

/** Every registered dataset. Adding one means adding a line here and a descriptor file. */
export const DESCRIPTORS: Dataset[] = [demo, rivers];
