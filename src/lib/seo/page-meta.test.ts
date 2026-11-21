import { describe, expect, it } from 'vitest';
import names from './__fixtures__/real-names.json';
import { MAX_DESCRIPTION_LENGTH, MAX_PAGE_TITLE_LENGTH, MIN_DESCRIPTION_LENGTH, TITLE_SUFFIX, buildMetadata } from './metadata';
import {
  amenityMeta,
  attractionMeta,
  bestBreweriesMeta,
  breweryMeta,
  cityAmenityMeta,
  cityMeta,
  countyMeta,
  neighborhoodMeta,
  openOnDayMeta,
  regionMeta,
  typeMeta,
  type PageMeta,
} from './page-meta';
import { AMENITIES } from '../amenities';

// Counts in titles are at most three digits; use the longest so the test covers the worst case.
const N = 151;

function overflow(label: string, meta: PageMeta): string[] {
  const problems: string[] = [];
  if (meta.title.length > MAX_PAGE_TITLE_LENGTH) {
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
