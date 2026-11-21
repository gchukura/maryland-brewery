import { describe, expect, it } from 'vitest';
import {
  applyFilters,
  parseFilters,
  serializeFilters,
  sortResults,
  type FilterDefaults,
  type ListingBrewery,
  type ListingResult,
} from './listing';

const DEFAULTS: FilterDefaults = { sort: 'open' };

function brewery(
  over: Partial<ListingBrewery> & { slug: string }
): ListingBrewery {
  return {
    name: over.slug,
    street: '',
    city: 'Frederick',
    county: 'Frederick',
    latitude: null,
    longitude: null,
    hours: {},
    amenities: [],
    types: ['Microbrewery'],
    photo: null,
    description: null,
    ...over,
  };
}

describe('parseFilters / serializeFilters', () => {
  it('reads every filter from the URL', () => {
    const f = parseFilters(
      new URLSearchParams(
        'open=1&amenity=pet-friendly,outdoor-seating&type=Brewpub&sort=name&q=%20attaboy%20'
      ),
      DEFAULTS
    );
    expect(f).toEqual({
      open: true,
      amenities: ['pet-friendly', 'outdoor-seating'],
      type: 'brewpub',
      sort: 'name',
      q: 'attaboy',
    });
  });

  it('ignores unknown amenities, sorts and duplicates', () => {
    const f = parseFilters(
      new URLSearchParams(
        'amenity=pet-friendly,nope,pet-friendly&sort=newest&open=yes'
      ),
      DEFAULTS
    );
    expect(f).toEqual({
      open: false,
      amenities: ['pet-friendly'],
      type: null,
      sort: 'open',
      q: '',
    });
  });

  it('accepts Next.js searchParams objects and nothing at all', () => {
    expect(
      parseFilters({ amenity: ['tours'], sort: 'rank' }, DEFAULTS)
    ).toMatchObject({ amenities: ['tours'], sort: 'rank' });
    expect(parseFilters(null, { sort: 'distance' })).toEqual({
      open: false,
      amenities: [],
      type: null,
      sort: 'distance',
      q: '',
    });
  });

  it('round-trips, and writes nothing for the defaults', () => {
    const qs =
      'open=1&amenity=pet-friendly,tours&type=brewpub&sort=name&q=hops';
    expect(
      serializeFilters(
        parseFilters(new URLSearchParams(qs), DEFAULTS),
        DEFAULTS
      )
    ).toBe(qs);
    expect(serializeFilters(parseFilters(null, DEFAULTS), DEFAULTS)).toBe('');
  });

  it("keeps open-now pages' forced open filter out of the URL", () => {
    const openNow: FilterDefaults = { sort: 'open', open: true };
    const f = parseFilters(new URLSearchParams(''), openNow);
    expect(f.open).toBe(true);
    expect(serializeFilters(f, openNow)).toBe('');
  });
});

describe('applyFilters', () => {
  // Tuesday 2026-10-27, noon in Maryland
  const now = new Date('2026-10-27T16:00:00Z');
  const list = [
    brewery({
      slug: 'closed-dogs',
      amenities: ['Pet Friendly'],
      hours: { tuesday: 'Closed' },
      latitude: 39.5,
      longitude: -77.5,
    }),
    brewery({
      slug: 'open-dogs-patio',
      amenities: ['Pet Friendly', 'Outdoor Seating'],
      hours: { tuesday: '11:00 AM – 9:00 PM' },
      latitude: 39.42,
      longitude: -77.41,
    }),
    brewery({
      slug: 'open-brewpub',
      name: 'Brewer’s Alley',
      types: ['Brewpub'],
      hours: { tuesday: '11:00 AM – 11:00 PM' },
    }),
  ];

  it('filters by amenity (all of them), type, open and text', () => {
    const slugs = (r: ListingResult[]) => r.map((x) => x.brewery.slug);
    expect(
      slugs(
        applyFilters(
          list,
          parseFilters(new URLSearchParams('amenity=pet-friendly'), DEFAULTS),
          { now }
        )
      )
    ).toEqual(['open-dogs-patio', 'closed-dogs']);
    expect(
      slugs(
        applyFilters(
          list,
          parseFilters(
            new URLSearchParams('amenity=pet-friendly,outdoor-seating'),
            DEFAULTS
          ),
          { now }
        )
      )
    ).toEqual(['open-dogs-patio']);
    expect(
      slugs(
        applyFilters(
          list,
          parseFilters(new URLSearchParams('type=brewpub'), DEFAULTS),
          { now }
        )
      )
    ).toEqual(['open-brewpub']);
    expect(
      slugs(
        applyFilters(
          list,
          parseFilters(new URLSearchParams('open=1'), DEFAULTS),
          { now }
        )
      )
    ).toEqual(['open-dogs-patio', 'open-brewpub']);
    // Accent- and case-insensitive, every word must match
    expect(
      slugs(
        applyFilters(
          list,
          parseFilters(new URLSearchParams('q=brewers frederick'), DEFAULTS),
          { now }
        )
      )
    ).toEqual([]);
    expect(
      slugs(
        applyFilters(
          list,
          parseFilters(new URLSearchParams('q=BREWER’S frederick'), DEFAULTS),
          { now }
        )
      )
    ).toEqual(['open-brewpub']);
  });

  it('adds distances from an origin', () => {
    const [first] = applyFilters(
      list,
      parseFilters(new URLSearchParams('sort=distance'), DEFAULTS),
      { now, origin: { latitude: 39.414, longitude: -77.41 } }
    );
    expect(first.brewery.slug).toBe('open-dogs-patio');
    expect(first.distance).toBeCloseTo(0.4, 1);
  });
});

describe('sortResults', () => {
  const r = (
    slug: string,
    rank: number,
    open: boolean,
    distance: number | null,
    name = slug
  ): ListingResult => ({
    brewery: brewery({ slug, name }),
    open,
    distance,
    rank,
  });
  const results = [
    r('a', 0, false, 5, 'Zeta'),
    r('b', 1, true, null, 'Alpha'),
    r('c', 2, true, 1, 'Mid'),
    r('d', 3, false, 2, 'Beta'),
  ];
  const order = (sort: Parameters<typeof sortResults>[1]) =>
    sortResults(results, sort).map((x) => x.brewery.slug);

  it('open first keeps the default order within each group', () =>
    expect(order('open')).toEqual(['b', 'c', 'a', 'd']));
  it('distance puts unknown distances last', () =>
    expect(order('distance')).toEqual(['c', 'd', 'a', 'b']));
  it('name sorts alphabetically', () =>
    expect(order('name')).toEqual(['b', 'd', 'c', 'a']));
  it('rank is the server order', () =>
    expect(order('rank')).toEqual(['a', 'b', 'c', 'd']));
  it('does not mutate its input', () => {
    order('name');
    expect(results.map((x) => x.brewery.slug)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('applyFilters: stored distances (attraction pages)', () => {
  const origin = { latitude: 39.28, longitude: -76.62 };
  const list = [
    brewery({ slug: 'far', latitude: 39.3, longitude: -76.6, distance: 2.4 }),
    brewery({ slug: 'near', latitude: 39.29, longitude: -76.61, distance: 0.8 }),
  ];
  const filters = parseFilters(null, { sort: 'distance' });

  it("uses the page's distances when asked", () => {
    const results = applyFilters(list, filters, { origin, storedDistances: true });
    expect(results.map((r) => [r.brewery.slug, r.distance])).toEqual([
      ['near', 0.8],
      ['far', 2.4],
    ]);
  });

  it('measures from the origin otherwise (a visitor sorting by their location)', () => {
    const results = applyFilters(list, filters, { origin });
    expect(results.every((r) => r.distance !== 0.8 && r.distance !== 2.4)).toBe(true);
  });
});
