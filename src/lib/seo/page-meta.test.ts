import { describe, expect, it } from 'vitest';
import names from './__fixtures__/real-names.json';
import { MAX_ABSOLUTE_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH, MAX_PAGE_TITLE_LENGTH, MIN_DESCRIPTION_LENGTH, TITLE_SUFFIX, buildMetadata } from './metadata';
import {
  amenityMeta,
  attractionMeta,
  attractionPageMeta,
  bestBreweriesMeta,
  breweryMeta,
  cityAmenityMeta,
  cityMeta,
  countyMeta,
  neighborhoodMeta,
  openOnDayMeta,
  placeTypeMeta,
  regionMeta,
  typeMeta,
  type PageMeta,
} from './page-meta';
import { AMENITIES } from '../amenities';
import { OTHER_PLACE_TYPE, PLACE_TYPES } from '../attractions';

// Counts in titles are at most three digits; use the longest so the test covers the worst case.
const N = 151;

function overflow(label: string, meta: PageMeta): string[] {
  const problems: string[] = [];
  if (meta.absoluteTitle ? meta.title.length > MAX_ABSOLUTE_TITLE_LENGTH : meta.title.length > MAX_PAGE_TITLE_LENGTH) {
    problems.push(`${label}: title ${meta.title.length + TITLE_SUFFIX.length} chars: "${meta.title}${TITLE_SUFFIX}"`);
  }
  if (meta.description.length > MAX_DESCRIPTION_LENGTH) {
    problems.push(`${label}: description ${meta.description.length} chars: "${meta.description}"`);
  }
  if (meta.description.length < MIN_DESCRIPTION_LENGTH) {
    problems.push(`${label}: description only ${meta.description.length} chars: "${meta.description}"`);
  }
  return problems;
}

describe('page titles and descriptions fit for every real name', () => {
  const cases: [string, PageMeta][] = [
    ...names.breweries.map((b): [string, PageMeta] => [`brewery ${b.name}`, breweryMeta(b)]),
    ...names.cities.map((c): [string, PageMeta] => [`city ${c}`, cityMeta(c, N)]),
    ...names.cities.map((c): [string, PageMeta] => [`best ${c}`, bestBreweriesMeta(c, N)]),
    ...names.cities.flatMap((c) => AMENITIES.map((a): [string, PageMeta] => [`${c} x ${a.slug}`, cityAmenityMeta(a.label, c, N)])),
    ...names.counties.map((c): [string, PageMeta] => [`county ${c}`, countyMeta(c, N)]),
    ...names.regions.map((r): [string, PageMeta] => [`region ${r.name}`, regionMeta(r.name, N, r.counties)]),
    ...names.types.map((t): [string, PageMeta] => [`type ${t}`, typeMeta(t, N)]),
    ...AMENITIES.map((a): [string, PageMeta] => [`amenity ${a.slug}`, amenityMeta(a.label, N)]),
    ...names.neighborhoods.map((n): [string, PageMeta] => [`neighborhood ${n.name}`, neighborhoodMeta(n.name, n.city, N)]),
    ...names.attractions.map((a): [string, PageMeta] => [`attraction ${a.name}`, attractionMeta(a.name, a.city, N)]),
    ...['sunday', 'wednesday', 'saturday'].map((d): [string, PageMeta] => [`open ${d}`, openOnDayMeta(d, N)]),
  ];

  it(`checks ${cases.length} generated pages`, () => {
    const problems = cases.flatMap(([label, meta]) => overflow(label, meta));
    expect(problems).toEqual([]);
  });
});

describe('attractionPageMeta', () => {
  // The three list shapes, with the widest numbers each can show
  const shapes = [
    [10, 10, 'all'],
    [23, 2, 'dense'],
    [5, 9.9, 'nearest'],
  ] as const;
  const cases = names.attractionPages.flatMap((a) =>
    shapes.map(([listed, radius, mode]): [string, PageMeta, string] => [
      `attraction page ${a.name} (${mode})`,
      attractionPageMeta(a.name, a.city, listed, radius, mode),
      a.city,
    ])
  );

  it(`fits for ${cases.length} real attraction pages`, () => {
    expect(cases.flatMap(([label, meta]) => overflow(label, meta))).toEqual([]);
  });

  it('names the city in every title and description', () => {
    const missing = cases.filter(([, meta, city]) => !meta.title.includes(city) || !meta.description.includes(city));
    expect(missing.map(([label, meta]) => `${label}: "${meta.title}" / "${meta.description}"`)).toEqual([]);
  });

  it('keeps the brand suffix when it fits and drops it before the city', () => {
    expect(attractionPageMeta('Baker Park', 'Frederick', 10, 10, 'all')).toMatchObject({
      title: 'Breweries near Baker Park, Frederick',
      absoluteTitle: false,
    });
    expect(attractionPageMeta('Oriole Park at Camden Yards', 'Baltimore', 9, 2, 'dense')).toMatchObject({
      title: 'Breweries near Oriole Park at Camden Yards, Baltimore',
      absoluteTitle: true,
    });
    expect(attractionPageMeta('The Maryland Zoo in Baltimore', 'Baltimore', 9, 2, 'dense').title).toBe(
      'Breweries near The Maryland Zoo in Baltimore'
    );
  });

  it('describes the list the page shows', () => {
    expect(attractionPageMeta('Baker Park', 'Frederick', 2, 10, 'all').description).toMatch(/^Both breweries within 10 miles/);
    expect(attractionPageMeta('Patterson Park', 'Baltimore', 9, 2, 'dense').description).toMatch(/^The 9 breweries within 2 miles/);
    expect(attractionPageMeta('Rockburn Branch Park', 'Elkridge', 5, 2.6, 'nearest').description).toMatch(/^The 5 breweries closest to/);
  });
});

describe('placeTypeMeta', () => {
  // Every type, with the longest real attraction names as its examples
  const longest = [...names.attractionPages].map((a) => a.name).sort((x, y) => y.length - x.length);
  const cases = [...PLACE_TYPES, OTHER_PLACE_TYPE].flatMap((t) => [
    [`${t.slug} long examples`, placeTypeMeta(t.title, 999, longest.slice(0, 2))] as [string, PageMeta],
    [`${t.slug} one example`, placeTypeMeta(t.title, 3, ['National Aquarium'])] as [string, PageMeta],
    [`${t.slug} no examples`, placeTypeMeta(t.title, 3, [])] as [string, PageMeta],
  ]);

  it(`fits for ${cases.length} type pages`, () => {
    expect(cases.flatMap(([label, meta]) => overflow(label, meta))).toEqual([]);
  });

  it('title-cases the type and keeps "breweries"', () => {
    expect(placeTypeMeta('Museums', 205, ['The Walters Art Museum', 'Port Discovery']).title).toBe('Museums Near Maryland Breweries');
    expect(placeTypeMeta('Art galleries and studios', 113, []).title).toBe('Art Galleries and Studios Near Breweries');
  });
});

describe('buildMetadata', () => {
  it('sets canonical, robots and Open Graph from one input', () => {
    const m = buildMetadata({ title: 'Breweries in Baltimore, MD', description: 'x', path: '/cities/baltimore/breweries', noindex: true });
    expect(m.alternates?.canonical).toBe('/cities/baltimore/breweries');
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.openGraph).toMatchObject({ url: 'https://www.marylandbrewery.com/cities/baltimore/breweries', title: `Breweries in Baltimore, MD${TITLE_SUFFIX}` });
  });

  it('never repeats the brand and trims as a last resort', () => {
    const m = buildMetadata({ title: 'x'.repeat(80), description: 'y '.repeat(100), path: '/' });
    expect(String(m.title).length).toBeLessThanOrEqual(MAX_PAGE_TITLE_LENGTH);
    expect(String(m.description).length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });
});

describe('neighborhoodMeta', () => {
  it("doesn't repeat a city a neighborhood is named after", () => {
    expect(neighborhoodMeta('Gaithersburg', 'Gaithersburg', 12).title).toBe('Breweries near Gaithersburg');
    expect(neighborhoodMeta('Gaithersburg', 'Gaithersburg', 12).description).not.toMatch(/Gaithersburg.*Gaithersburg/);
    expect(neighborhoodMeta('Canton', 'Baltimore', 12).title).toBe('Breweries near Canton, Baltimore');
  });
});
