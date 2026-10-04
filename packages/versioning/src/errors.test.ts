import { describe, it, expect } from 'vitest';
import { ConflictError, NotFoundError } from './index';

describe('versioning errors', () => {
  it('are plain Errors named after their class, so a caller can map them without importing HTTP', () => {
    const nf = new NotFoundError('Version x not found for layer dams');
    expect(nf).toBeInstanceOf(Error);
    expect(nf.name).toBe('NotFoundError');
    expect(nf.message).toBe('Version x not found for layer dams');
    const c = new ConflictError('no active version for layer dams');
    expect(c).toBeInstanceOf(Error);
    expect(c.name).toBe('ConflictError');
  });

  it('are distinct classes', () => {
    expect(new NotFoundError()).not.toBeInstanceOf(ConflictError);
    expect(new ConflictError()).not.toBeInstanceOf(NotFoundError);
  });

  it('have default messages', () => {
    expect(new NotFoundError().message).toBe('Not found');
    expect(new ConflictError().message).toBe('Conflict');
  });

  it('carry no HTTP status: that mapping belongs to the API', () => {
    expect('statusCode' in new NotFoundError()).toBe(false);
    expect('statusCode' in new ConflictError()).toBe(false);
  });
});
