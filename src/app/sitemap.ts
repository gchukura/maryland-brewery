import type { MetadataRoute } from 'next';
import { breweriesInRegion, getAllNeighborhoods, getIndexableAttractions, getPlacesByType, getProcessedBreweryData, getRegions } from '@/lib/db';
import { slugify } from '@/lib/slug';
import { DAYS, isOpenOnDay } from '@/lib/hours';
import { hasBestBreweriesPage } from '@/lib/best-breweries';
import { AMENITIES, hasAmenity, isIndexableCityAmenity } from '@/lib/amenities';
import { sortByDistance } from '@/lib/geo';
import { breweriesNearNeighborhood, isIndexableNeighborhood, neighborhoodPath } from '@/lib/neighborhoods';
import { isAttractionPage } from '@/lib/attractions';
import { SITE_URL } from '@/lib/seo/metadata';
import type { Brewery } from '@/types/brewery';

/**
 * Every indexable page, once. Pages that are noindex (thin city x amenity, neighborhood and
 * attraction pages) or that redirect (-md, near/, small-city best-of, amenity aliases) are left out.
 * lastModified comes from the data: a brewery's updated_at, or the newest among a listing's breweries.
 */

const STATIC_PAGES = [
  'faq',
  'our-story',
  'add-brewery',
  'become-featured',
  'customer-reviews',
  'marketing-tips',
  'review-guidelines',
  'photo-credits',
  'privacy-policy',
  'terms',
];

function latest(breweries: Brewery[]): Date | undefined {
  const times = breweries.map((b) => Date.parse(b.lastUpdated)).filter((t) => !Number.isNaN(t));
  return times.length > 0 ? new Date(Math.max(...times)) : undefined;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [processed, regions, neighborhoods, attractions, placeTypes] = await Promise.all([
    getProcessedBreweryData(),
    getRegions(),
    getAllNeighborhoods(),
    getIndexableAttractions(),
    getPlacesByType(),
  ]);
  const { breweries } = processed;
  const siteUpdated = latest(breweries);

  const entries = new Map<string, MetadataRoute.Sitemap[number]>();
  const add = (path: string, priority: number, lastModified?: Date) => {
    const url = path === '/' ? SITE_URL : `${SITE_URL}${path}`;
    if (!entries.has(url)) entries.set(url, { url, priority, ...(lastModified ? { lastModified } : {}) });
  };

  // Home and indexes change whenever any brewery does
  add('/', 1.0, siteUpdated);
  for (const path of ['/map', '/cities', '/counties', '/region', '/type', '/amenities', '/best-breweries', '/open-now', '/neighborhoods', '/near']) {
    add(path, 0.8, siteUpdated);
  }
  add('/contact', 0.5);
  for (const page of STATIC_PAGES) add(`/${page}`, 0.3);

  // Breweries (the page 404s without a name and city)
  for (const b of breweries) {
    if (b.name && b.city && b.slug) add(`/breweries/${b.slug}`, 0.8, latest([b]));
  }

  // Cities (keyed by slug, so "Havre de Grace" and "Havre De Grace" are one page) and best-of pages
  const byCitySlug = new Map<string, Brewery[]>();
  for (const b of breweries) {
    if (!b.city) continue;
    const slug = slugify(b.city);
    byCitySlug.set(slug, [...(byCitySlug.get(slug) ?? []), b]);
  }
  for (const [citySlug, cityBreweries] of byCitySlug) {
    add(`/cities/${citySlug}/breweries`, 0.9, latest(cityBreweries));
    if (hasBestBreweriesPage(cityBreweries.length)) add(`/best-breweries/${citySlug}`, 0.8, latest(cityBreweries));
  }

  // Counties
  const byCountySlug = new Map<string, Brewery[]>();
  for (const b of breweries) {
    if (!b.county) continue;
    const slug = slugify(b.county);
    byCountySlug.set(slug, [...(byCountySlug.get(slug) ?? []), b]);
  }
  for (const [countySlug, countyBreweries] of byCountySlug) {
    add(`/counties/${countySlug}/breweries`, 0.7, latest(countyBreweries));
  }

  // Regions
  for (const region of regions) {
    const regionBreweries = breweriesInRegion(region, breweries);
    if (regionBreweries.length > 0) add(`/region/${region.slug}`, 0.7, latest(regionBreweries));
  }

  // Types
  for (const type of processed.types) {
    const typeBreweries = breweries.filter((b) => b.type.includes(type));
    if (typeBreweries.length > 0) add(`/type/${slugify(type)}`, 0.6, latest(typeBreweries));
  }

  // Amenities, and city x amenity pages with 3+ breweries (smaller ones are noindex)
  for (const amenity of AMENITIES) {
    const withAmenity = breweries.filter((b) => hasAmenity(b, amenity));
    if (withAmenity.length === 0) continue;
    add(`/amenities/${amenity.slug}`, 0.6, latest(withAmenity));
    for (const [citySlug, cityBreweries] of byCitySlug) {
      const matches = cityBreweries.filter((b) => hasAmenity(b, amenity));
      if (isIndexableCityAmenity(matches.length)) add(`/cities/${citySlug}/${amenity.slug}`, 0.5, latest(matches));
    }
  }

  // Open on a given day
  for (const day of DAYS) {
    const open = breweries.filter((b) => isOpenOnDay(b.hours, day));
    if (open.length > 0) add(`/open/${day}`, 0.4, latest(open));
  }

  // Neighborhoods with a brewery within 3 miles (the rest are noindex)
  for (const n of neighborhoods) {
    if (n.latitude == null || n.longitude == null) continue;
    const origin = { latitude: n.latitude, longitude: n.longitude };
    if (!isIndexableNeighborhood(sortByDistance(origin, breweries)[0]?.distance)) continue;
    add(neighborhoodPath(n.slug), 0.5, latest(breweriesNearNeighborhood(origin, breweries)));
  }

  // Place types (/near/museums), updated with their newest place
  for (const { type, places } of placeTypes) {
    const times = places.map((p) => Date.parse(p.updatedAt ?? '')).filter((t) => !Number.isNaN(t));
    add(`/near/${type.slug}`, 0.6, times.length > 0 ? new Date(Math.max(...times)) : undefined);
  }

  // Attractions: attraction pages (src/lib/attractions.ts), and real sights with a brewery within
  // 3 miles (the rest are noindex)
  for (const a of attractions) {
    add(`/near/${a.slug}`, isAttractionPage(a) ? 0.6 : 0.4, a.updatedAt ? new Date(a.updatedAt) : undefined);
  }

  return [...entries.values()];
}
