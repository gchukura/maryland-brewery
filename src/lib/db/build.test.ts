import { describe, expect, it } from 'vitest';
import { readError } from './build';

describe('readError', () => {
  it('passes Errors through', () => {
    const error = new Error('boom');
    expect(readError(error)).toBe(error);
  });

  it('wraps Supabase error objects, keeping the message', () => {
    const error = readError({ message: 'exceed_egress_quota', code: 'PGRST301' });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('exceed_egress_quota');
  });

  it('serializes anything else', () => {
    expect(readError({ code: 'PGRST301' }).message).toContain('PGRST301');
  });
});
