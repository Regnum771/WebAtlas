import { describe, it, expect } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('@webatlas/atlas-data', () => {
  it('is wired as a workspace and exports from its entry point', () => {
    expect(PACKAGE_NAME).toBe('@webatlas/atlas-data');
  });
});
