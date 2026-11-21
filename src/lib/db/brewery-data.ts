/**
 * Brewery data: one cached list, per-request lookup maps, and a per-slug detail cache.
 * unstable_cache JSON-serializes results, so it only ever holds plain arrays and objects.
 */

import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { fetchBreweryBySlug, fetchRegions, getAllNeighborhoods as fetchAllNeighborhoods, getBreweryDataFromSupabase, type Region } from './queries';
import { isIndexableNeighborhood } from '@/lib/neighborhoods';
import { fetchAttractionPage, fetchAttractionSummaries, type AttractionPageData, type AttractionSummary } from './attractions';
import {
  ATTRACTION_PAGE_MIN_REVIEWS,
  OTHER_PLACE_TYPE,
  PLACE_TYPES,
  RESERVED_PLACE_SLUGS,
  isAttractionPage,
  isIndexableAttraction,
  placeType,
  type PlaceType,
} from '@/lib/attractions';
import { Brewery, ProcessedBreweryData, SiteStatistics, MARYLAND_COUNTIES } from '@/types/brewery';

import { sortByDistance } from '@/lib/geo';
const CACHE = { tags: ['brewery-data'], revalidate: 3600 };

/**
 * Every brewery, list columns only (no review themes or beers). The one cross-request cache
 * for listings; everything else is derived from it per request in getProcessedBreweryData.
 */
const getAllBreweries = unstable_cache(
  async (): Promise<Brewery[]> => getBreweryDataFromSupabase({ detail: false }),
  ['all-breweries'],
  CACHE
);

/** The five Maryland regions (maryland_regions), with canonical county names. */
export const getRegions = unstable_cache(async (): Promise<Region[]> => fetchRegions(), ['regions'], CACHE);

/** Breweries whose county is in the region. */
export function breweriesInRegion(region: Region, breweries: Brewery[]): Brewery[] {
  const counties = new Set(region.counties.map((c) => c.toLowerCase()));
  return breweries.filter((b) => b.county && counties.has(b.county.toLowerCase()));
}

/** One brewery with everything its page needs (review themes, beers), cached per slug. */
export function getBreweryBySlug(slug: string): Promise<Brewery | null> {
  return unstable_cache(async () => fetchBreweryBySlug(slug), ['brewery-by-slug', slug], CACHE)();
}

/**
 * Process brewery data into efficient lookup structures
 * This single processing step powers ALL 500+ pages
 */
export async function processBreweryData(breweries: Brewery[]): Promise<ProcessedBreweryData> {
  const startTime = Date.now();
  
  // Initialize Maps for efficient lookups
  const byCity = new Map<string, Brewery[]>();
  const byCounty = new Map<string, Brewery[]>();
  const byType = new Map<string, Brewery[]>();
  const byAmenity = new Map<string, Brewery[]>();
  
  // Initialize arrays for unique values
  const cities: string[] = [];
  const counties: string[] = [];
  const amenities: string[] = [];
  const types: string[] = [];
  
  // Track unique values
  const citySet = new Set<string>();
  const countySet = new Set<string>();
  const amenitySet = new Set<string>();
  const typeSet = new Set<string>();
  
  // Process each brewery
  breweries.forEach(brewery => {
    // Group by city
    if (brewery.city) {
      const cityKey = brewery.city.toLowerCase().trim();
      if (!byCity.has(cityKey)) {
        byCity.set(cityKey, []);
      }
      byCity.get(cityKey)!.push(brewery);
      citySet.add(brewery.city);
    }
    
    // Group by county
    if (brewery.county) {
      const countyKey = brewery.county.toLowerCase().trim();
      if (!byCounty.has(countyKey)) {
        byCounty.set(countyKey, []);
      }
      byCounty.get(countyKey)!.push(brewery);
      countySet.add(brewery.county);
    }
    
    // Group by each type (a brewery can be a microbrewery and a taproom)
    for (const type of brewery.type) {
      const typeKey = type.toLowerCase();
      if (!byType.has(typeKey)) {
        byType.set(typeKey, []);
      }
      byType.get(typeKey)!.push(brewery);
      typeSet.add(type);
    }

    // Group by amenities
    brewery.amenities.forEach(amenity => {
      const amenityKey = amenity.toLowerCase().trim();
      if (!byAmenity.has(amenityKey)) {
        byAmenity.set(amenityKey, []);
      }
      byAmenity.get(amenityKey)!.push(brewery);
      amenitySet.add(amenity);
    });
  });
  
  // Convert sets to sorted arrays
  cities.push(...Array.from(citySet).sort());
  counties.push(...Array.from(countySet).sort());
  amenities.push(...Array.from(amenitySet).sort());
  types.push(...Array.from(typeSet).sort());
  
  // Calculate site statistics
  const stats = calculateSiteStatistics(breweries, {
    cities: cities.length,
    counties: counties.length,
    types: types.length,
    amenities: amenities.length,
  });
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  // Only log in development mode
  if (process.env.NODE_ENV === 'development') {
    console.log(`Processed brewery data in ${duration}ms`);
    console.log(`- Cities: ${cities.length}`);
    console.log(`- Counties: ${counties.length}`);
    console.log(`- Types: ${types.length}`);
    console.log(`- Amenities: ${amenities.length}`);
  }
  
  return {
    breweries,
    byCity,
    byCounty,
    byType,
    byAmenity,
    cities,
    counties,
    amenities,
    types,
    stats,
  };
}

/**
 * Calculate comprehensive site statistics
 */
function calculateSiteStatistics(
  breweries: Brewery[], 
  counts: { cities: number; counties: number; types: number; amenities: number }
): SiteStatistics {
  // Count breweries by type
  const breweriesByType: Record<string, number> = {};
  const breweriesByCounty: Record<string, number> = {};
  
  breweries.forEach(brewery => {
    // Count by type
    if (Array.isArray(brewery.type)) {
      brewery.type.forEach(type => {
        breweriesByType[type] = (breweriesByType[type] || 0) + 1;
      });
    } else {
      breweriesByType[brewery.type] = (breweriesByType[brewery.type] || 0) + 1;
    }
    
    // Count by county
    const county = brewery.county;
    if (county) {
      breweriesByCounty[county] = (breweriesByCounty[county] || 0) + 1;
    }
  });
  
  // Find newest and oldest breweries
  const breweriesWithDates = breweries.filter(b => b.openedDate);
  const sortedByDate = breweriesWithDates.sort((a, b) => {
    const dateA = new Date(a.openedDate!).getTime();
    const dateB = new Date(b.openedDate!).getTime();
    return dateA - dateB;
  });
  
  const newestBrewery = sortedByDate.length > 0 ? sortedByDate[sortedByDate.length - 1].name : undefined;
  const oldestBrewery = sortedByDate.length > 0 ? sortedByDate[0].name : undefined;
  
  // Calculate average breweries per city
  const cityCounts = new Map<string, number>();
  breweries.forEach(brewery => {
    if (brewery.city) {
      const city = brewery.city.toLowerCase().trim();
      cityCounts.set(city, (cityCounts.get(city) || 0) + 1);
    }
  });
  
  const totalCities = cityCounts.size;
  const averageBreweriesPerCity = totalCities > 0 ? breweries.length / totalCities : 0;
  
  return {
    totalBreweries: breweries.length,
    totalCities: counts.cities,
    totalCounties: counts.counties,
    breweriesByType,
    breweriesByCounty,
    averageBreweriesPerCity,
    newestBrewery,
    oldestBrewery,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Get processed brewery data
 * This is the main function that powers all 500+ pages
 * Only the raw array is cached across requests (getAllBreweryData). The Maps are rebuilt
 * here and memoized per request, because unstable_cache would serialize them to {}.
 */
export const getProcessedBreweryData = cache(async (): Promise<ProcessedBreweryData> => {
  const breweries = await getAllBreweries();
  return processBreweryData(breweries);
});

// Lookups below run on the per-request maps; only getAllBreweries crosses requests.

export async function getBreweriesByCity(city: string): Promise<Brewery[]> {
  return (await getProcessedBreweryData()).byCity.get(city.toLowerCase().trim()) ?? [];
}

export async function getAllCities(): Promise<string[]> {
  return (await getProcessedBreweryData()).cities;
}

export async function getAllAmenities(): Promise<string[]> {
  return (await getProcessedBreweryData()).amenities;
}

export async function getAllTypes(): Promise<string[]> {
  return (await getProcessedBreweryData()).types;
}

/** All attractions (slug, name, type, location), cached like the brewery list. */
const getAttractionSummaries = unstable_cache(
  async (): Promise<AttractionSummary[]> => fetchAttractionSummaries(),
  ['attraction-summaries-v5'], // v5: nearby_brewery_count_10mi (the data cache outlives deploys)
  CACHE
);

/**
 * Attractions whose /near page is indexed (never hidden ones): attraction pages (src/lib/attractions.ts), plus real
 * sights with a brewery within 3 miles. Cached across requests: finding each of ~4,000
 * attractions' nearest brewery is too slow to repeat on every brewery page.
 */
export const getIndexableAttractions = unstable_cache(
  async (): Promise<AttractionSummary[]> => {
    const [attractions, { breweries }] = await Promise.all([getAttractionSummaries(), getProcessedBreweryData()]);
    return attractions.filter(
      (a) =>
        !a.isHidden &&
        !RESERVED_PLACE_SLUGS.has(a.slug) &&
        (isAttractionPage(a) || isIndexableAttraction(a, sortByDistance(a, breweries)[0]?.distance))
    );
  },
  // The threshold is in the key so lowering it takes effect on the next deploy
  ['indexable-attractions-v4', String(ATTRACTION_PAGE_MIN_REVIEWS)],
  CACHE
);

/** The places on /near grouped by type, biggest type first; types with no places are left out. */
export async function getPlacesByType(): Promise<{ type: PlaceType; places: AttractionSummary[] }[]> {
  const places = await getIndexableAttractions();
  return [...PLACE_TYPES, OTHER_PLACE_TYPE]
    .map((type) => ({ type, places: places.filter((p) => placeType(p.category) === type) }))
    .filter((g) => g.places.length > 0)
    .sort((a, b) => b.places.length - a.places.length);
}

/** Attractions with the full /near template ("More to do nearby" links only to these). */
export async function getAttractionPages(): Promise<AttractionSummary[]> {
  return (await getIndexableAttractions()).filter(isAttractionPage);
}

/** One attraction page with its ranked breweries, or null when the slug has no attraction page. */
export function getAttractionPage(slug: string): Promise<AttractionPageData | null> {
  return unstable_cache(
    async () => fetchAttractionPage(slug, ATTRACTION_PAGE_MIN_REVIEWS),
    ['attraction-page-v2', slug, String(ATTRACTION_PAGE_MIN_REVIEWS)],
    CACHE
  )();
}

/** Neighborhoods whose page is indexed: a brewery within 3 miles (src/lib/neighborhoods.ts). */
export const getIndexableNeighborhoods = unstable_cache(
  async () => {
    const [neighborhoods, { breweries }] = await Promise.all([fetchAllNeighborhoods(), getProcessedBreweryData()]);
    return neighborhoods
      .filter((n): n is typeof n & { latitude: number; longitude: number } => typeof n.latitude === 'number' && typeof n.longitude === 'number')
      .filter((n) => isIndexableNeighborhood(sortByDistance(n, breweries)[0]?.distance))
      .map((n) => ({ slug: n.slug, name: n.name, city: n.city, latitude: n.latitude, longitude: n.longitude }));
  },
  ['indexable-neighborhoods-v1'],
  CACHE
);
