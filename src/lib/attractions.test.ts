import { describe, expect, it } from 'vitest';
import {
  ATTRACTION_PAGE_MIN_REVIEWS,
  attractionIntro,
  breweryBadges,
  isAttractionPage,
  listedBreweries,
  listedSummary,
  nearbyAttractionPages,
  OTHER_PLACE_TYPE,
  PLACE_TYPES,
  placeType,
  placeTypeBySlug,
  RESERVED_PLACE_SLUGS,
  azGroups,
  azLetter,
} from './attractions';

const at = (...distances: number[]) => distances.map((d, i) => ({ id: `b${i}`, distanceMiles: d }));

describe('isAttractionPage', () => {
  it('needs has_pseo_page and the review threshold', () => {
    expect(isAttractionPage({ hasPseoPage: true, ratingCount: ATTRACTION_PAGE_MIN_REVIEWS })).toBe(true);
    expect(isAttractionPage({ hasPseoPage: true, ratingCount: ATTRACTION_PAGE_MIN_REVIEWS - 1 })).toBe(false);
    expect(isAttractionPage({ hasPseoPage: false, ratingCount: 50_000 })).toBe(false);
    expect(isAttractionPage({ hasPseoPage: true, ratingCount: null })).toBe(false);
  });
});

describe('listedBreweries', () => {
  it('lists everything within 10 miles when there are 10 or fewer', () => {
    const rows = at(0.5, 3, 9.8);
    expect(listedBreweries(rows)).toEqual({ listed: rows, radiusMiles: 10, mode: 'all' });
    expect(listedBreweries(at(...Array.from({ length: 10 }, (_, i) => i))).mode).toBe('all');
  });

  it('lists only those within 2 miles in a dense area', () => {
    const rows = at(0.3, 0.5, 0.9, 1.2, 1.8, 2, 2.4, 3, 4, 5, 6);
    const r = listedBreweries(rows);
    expect(r.mode).toBe('dense');
    expect(r.radiusMiles).toBe(2);
    expect(r.listed.map((b) => b.distanceMiles)).toEqual([0.3, 0.5, 0.9, 1.2, 1.8, 2]);
  });

  it('extends the radius until 5 are listed', () => {
    const r = listedBreweries(at(0.4, 1.5, 2.3, 2.51, 2.58, 3, 4, 5, 6, 7, 8));
    expect(r.mode).toBe('nearest');
    expect(r.listed).toHaveLength(5);
    expect(r.radiusMiles).toBe(2.6);
  });
});

describe('attractionIntro', () => {
  const base = {
    name: 'Oriole Park at Camden Yards',
    category: 'stadium',
    city: 'Baltimore',
    within5: 23,
    within10: 26,
    listed: 9,
    radiusMiles: 2,
    mode: 'dense' as const,
    nearest: { name: 'Pratt Street Ale House', distanceMiles: 0.31 },
  };

  it('says what the place is, the counts and the radius used', () => {
    expect(attractionIntro(base)).toBe(
      'Oriole Park at Camden Yards is a stadium in Baltimore. There are 26 breweries within 10 miles of it, 23 of them within 5 miles. ' +
        'This page lists the 9 within 2 miles, nearest first, starting with Pratt Street Ale House, 0.3 miles away.'
    );
  });

  it('covers the other list shapes and counts', () => {
    expect(attractionIntro({ ...base, mode: 'nearest', listed: 5, radiusMiles: 2.6 })).toContain('lists the 5 closest, all within 2.6 miles');
    const small = attractionIntro({
      ...base,
      name: 'Sandy Point State Park',
      category: 'park',
      city: 'Annapolis',
      within5: 1,
      within10: 3,
      listed: 3,
      radiusMiles: 10,
      mode: 'all',
      nearest: { name: 'Old Barn Brewery', distanceMiles: 4.1 },
    });
    expect(small).toBe(
      'Sandy Point State Park is a park in Annapolis. There are 3 breweries within 10 miles of it, 1 of them within 5 miles. ' +
        'The closest is Old Barn Brewery, 4.1 miles away; all 3 are listed below, nearest first.'
    );
    expect(attractionIntro({ ...base, category: 'amusement_park', within5: 0, within10: 4 })).toContain(
      'is an amusement park in Baltimore. There are 4 breweries within 10 miles of it, none closer than 5 miles.'
    );
    expect(attractionIntro({ ...base, within5: 2, within10: 2, mode: 'all', listed: 2 })).toContain('There are 2 breweries within 5 miles of it.');
  });

  it('never has more than three sentences', () => {
    expect(attractionIntro(base).split(/(?<=\.)\s/)).toHaveLength(3);
  });
});

describe('listedSummary', () => {
  it('says how many, how far and the nearest', () => {
    expect(listedSummary(9, 2, 0.31)).toBe('9 breweries within 2 miles · nearest 0.3 miles');
    expect(listedSummary(1, 10, 1)).toBe('1 brewery within 10 miles · nearest 1 mile');
  });
});

describe('breweryBadges', () => {
  it('shows only the fields that are set, in order', () => {
    expect(breweryBadges({ food: 'In-House', outdoorSeating: true, dogFriendly: false, offersTours: true, beerToGo: true })).toEqual([
      'Food',
      'Outdoor seating',
      'Tours',
      'Beer to go',
    ]);
    expect(breweryBadges({ food: 'Food Trucks', dogFriendly: true })).toEqual(['Food trucks', 'Dog friendly']);
    expect(breweryBadges({ food: ' ' })).toEqual([]);
  });
});

describe('nearbyAttractionPages', () => {
  const origin = { slug: 'here', latitude: 39.2839, longitude: -76.6217 };
  const page = (slug: string, latitude: number, longitude: number) => ({ slug, latitude, longitude });

  it('keeps other pages within 5 miles, nearest first, at most 6', () => {
    const pages = [
      origin,
      page('far', 39.5, -76.6), // ~15 miles
      ...Array.from({ length: 8 }, (_, i) => page(`p${i}`, 39.2839 + (i + 1) * 0.005, -76.6217)),
    ];
    const result = nearbyAttractionPages(origin, pages);
    expect(result.map((p) => p.slug)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
    expect(result[0].distanceMiles).toBeCloseTo(0.35, 1);
  });
});

describe('placeType', () => {
  it('maps categories to types and unknown ones to Other places', () => {
    expect(placeType('stadium')).toMatchObject({ title: 'Stadiums', slug: 'stadiums' });
    expect(placeType('art_gallery').slug).toBe('art-galleries');
    expect(placeType(null).title).toBe('Other places');
    expect(placeType('bowling_alley').title).toBe('Other places');
  });

  it('gives every type a unique slug', () => {
    const slugs = [...PLACE_TYPES, OTHER_PLACE_TYPE].map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('A to Z', () => {
  it('ignores a leading "The" and puts digits and symbols under #', () => {
    expect(azLetter('The Walters Art Museum')).toBe('W');
    expect(azLetter('3402 Art')).toBe('#');
    expect(azLetter('"Quoted"')).toBe('#');
    expect(azLetter('Éclair Park')).toBe('E');
  });

  it('groups by letter, # first, each group sorted without "The"', () => {
    const groups = azGroups([{ name: 'Baker Park' }, { name: 'The Avenue' }, { name: 'Antietam' }, { name: '1812 Fort' }, { name: 'Bay' }]);
    expect(groups.map((g) => [g.letter, g.items.map((i) => i.name)])).toEqual([
      ['#', ['1812 Fort']],
      ['A', ['Antietam', 'The Avenue']],
      ['B', ['Baker Park', 'Bay']],
    ]);
  });
});

describe('placeTypeBySlug', () => {
  it('finds types by slug and reserves every type slug', () => {
    expect(placeTypeBySlug('museums')?.category).toBe('museum');
    expect(placeTypeBySlug('fort-mchenry')).toBeUndefined();
    expect(RESERVED_PLACE_SLUGS.has('parks')).toBe(true);
    expect(RESERVED_PLACE_SLUGS.has('cinemas-theaters-live-music')).toBe(true);
  });
});
