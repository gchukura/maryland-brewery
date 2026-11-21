import { describe, expect, it } from 'vitest';
import { changedUrls, parseUrlState } from './indexnow';

describe('changedUrls', () => {
  const previous = { '/a': '2026-11-01', '/b': '2026-11-01', '/c': '', '/gone': '2026-10-01' };

  it('finds new, changed and removed URLs, and leaves unchanged ones out', () => {
    const current = { '/a': '2026-11-01', '/b': '2026-11-20', '/c': '', '/new': '2026-11-21' };
    expect(changedUrls(previous, current)).toEqual({ added: ['/new'], changed: ['/b'], removed: ['/gone'] });
  });

  it("doesn't call a page changed when either side has no lastmod", () => {
    expect(changedUrls(previous, { ...previous, '/c': '2026-11-21' }).changed).toEqual([]);
    expect(changedUrls(parseUrlState(JSON.stringify(['/a'])), { '/a': '2026-11-21' }).changed).toEqual([]);
  });

  it('reads the old plain-list format', () => {
    expect(parseUrlState(JSON.stringify(['/a', '/b']))).toEqual({ '/a': '', '/b': '' });
  });
});
