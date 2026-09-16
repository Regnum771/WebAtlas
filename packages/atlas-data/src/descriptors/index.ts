import { demo } from './demo';
import type { Dataset } from '../types';

/** Every registered dataset. Adding one means adding a line here and a descriptor file. */
export const DESCRIPTORS: Dataset[] = [demo];
