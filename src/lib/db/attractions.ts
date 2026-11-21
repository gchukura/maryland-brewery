/**
 * Supabase Attractions Client Functions
 * Provides functions for querying and managing Maryland attractions
 */

import { getAdminClient, getSupabase } from './client';
import type { Tables, TablesInsert } from './client';
import { jsonObject, jsonStringArray } from './json';

import { throwDuringBuild } from './build';
import { calculateDistance } from '@/lib/geo';
/**
 * Application-level Attraction type (camelCase)
 */
export interface Attraction {
  id?: string;
  placeId: string;
  name: string;
  slug: string;
  type: string;
  googleTypes?: string[];
  street?: string;
  city: string;
  state: string;
  zip?: string;
  county?: string;
  latitude: number;
  longitude: number;
  description?: string;
  phone?: string;
  website?: string;
  rating?: number;
  ratingCount?: number;
  priceLevel?: number;
  hours?: Record<string, string>;
  photos?: string[];
  lastUpdated?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Convert database attraction to application attraction type
 */
/** The columns the app reads; get_nearby_attractions returns these and not the pSEO columns. */
type PseoColumns =
  | 'category'
  | 'duplicate_of'
  | 'is_pseo_eligible'
  | 'nearby_brewery_count_5mi'
  | 'nearby_brewery_count_10mi'
  | 'has_pseo_page';
type AttractionRow = Omit<Tables<'maryland_attractions'>, PseoColumns>;

function dbAttractionToAttraction(dbAttraction: AttractionRow): Attraction {
  return {
    id: dbAttraction.id,
    placeId: dbAttraction.place_id,
    name: dbAttraction.name,
    slug: dbAttraction.slug,
    type: dbAttraction.type,
    googleTypes: jsonStringArray(dbAttraction.google_types),
    street: dbAttraction.street ?? undefined,
    city: dbAttraction.city,
    state: dbAttraction.state,
    zip: dbAttraction.zip ?? undefined,
    county: dbAttraction.county ?? undefined,
    latitude: dbAttraction.latitude,
    longitude: dbAttraction.longitude,
    description: dbAttraction.description ?? undefined,
    phone: dbAttraction.phone ?? undefined,
    website: dbAttraction.website ?? undefined,
    rating: dbAttraction.rating ?? undefined,
    ratingCount: dbAttraction.rating_count ?? undefined,
    priceLevel: dbAttraction.price_level ?? undefined,
    hours: jsonObject<Record<string, string>>(dbAttraction.hours) ?? {},
    photos: jsonStringArray(dbAttraction.photos),
    lastUpdated: dbAttraction.last_updated ?? undefined,
    createdAt: dbAttraction.created_at ?? undefined,
    updatedAt: dbAttraction.updated_at ?? undefined,
  };
}

/**
 * Convert application attraction to a database insert/upsert row
 */
function attractionToDbAttraction(attraction: Attraction): TablesInsert<'maryland_attractions'> {
  return {
    id: attraction.id,
    place_id: attraction.placeId,
    name: attraction.name,
    slug: attraction.slug,
    type: attraction.type,
    google_types: attraction.googleTypes ?? [],
    street: attraction.street ?? null,
    city: attraction.city,
    state: attraction.state,
    zip: attraction.zip ?? null,
    county: attraction.county ?? null,
    latitude: attraction.latitude,
    longitude: attraction.longitude,
    description: attraction.description ?? null,
    phone: attraction.phone ?? null,
    website: attraction.website ?? null,
    rating: attraction.rating ?? null,
    rating_count: attraction.ratingCount ?? null,
    price_level: attraction.priceLevel ?? null,
    hours: attraction.hours ?? {},
    photos: attraction.photos ?? [],
    last_updated: attraction.lastUpdated ?? null,
  };
}

/**
 * Get nearby attractions using PostGIS (if enabled)
 * Falls back to client-side calculation if PostGIS is not available
 */
export async function getAttractionsNearBrewery(
  latitude: number,
  longitude: number,
  radiusKm: number = 5,
  limit: number = 10,
  type?: string
): Promise<Attraction[]> {
  try {
    // Convert km to meters (PostGIS uses meters)
    const radiusMeters = radiusKm * 1000;

    // Use PostGIS if available, otherwise fetch all and filter client-side
    let data: (AttractionRow & { distance_meters?: number })[] | null = null;
    let error: any = null;
    
    try {
      const result = await getSupabase().rpc('get_nearby_attractions', {
        lat: latitude,
        lng: longitude,
        radius_meters: radiusMeters,
        attraction_type: type || undefined,
      });
      data = result.data;
      error = result.error;
    } catch (rpcError) {
      // RPC function doesn't exist, fall through to client-side filtering
      error = rpcError;
    }

    if (error) {
      // If RPC doesn't exist, fetch all and filter client-side
      let query = getSupabase().from('maryland_attractions').select('*');
      
      // Apply type filter if specified
      if (type) {
        query = query.eq('type', type);
      }
      
      const { data: allAttractions, error: fallbackError } = await query;
      if (fallbackError) throw fallbackError;
      if (!allAttractions) return [];

      // Convert km to miles for client-side calculation
      const radiusMiles = radiusKm * 0.621371;

      // Filter by distance
      const filtered = allAttractions
        .map((attraction: Tables<'maryland_attractions'>) => {
          const distance = calculateDistance(
            latitude,
            longitude,
            attraction.latitude,
            attraction.longitude
          );
          return { attraction, distance };
        })
        .filter((item) => item.distance <= radiusMiles)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit)
        .map((item) => dbAttractionToAttraction(item.attraction));

      return filtered;
    }

    if (!data) {
      return [];
    }

    // Convert distance from meters to miles and sort
    const attractions = data
      .map((dbAttraction) => {
        const attraction = dbAttractionToAttraction(dbAttraction);
        return {
          attraction,
          distance: dbAttraction.distance_meters ? dbAttraction.distance_meters / 1609.34 : 0,
        };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit)
      .map((item) => item.attraction);

    return attractions;
  } catch (error) {
    throwDuringBuild(error);
    console.error('Error fetching nearby attractions:', error);
    return [];
  }
}

/**
 * Get attraction by slug
 */
export async function getAttractionBySlug(slug: string): Promise<Attraction | null> {
  try {
    const { data, error } = await getSupabase()
      .from('maryland_attractions')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return dbAttractionToAttraction(data);
  } catch (error) {
    throwDuringBuild(error);
    console.error('Error fetching attraction by slug:', error);
    return null;
  }
}

export interface AttractionSummary {
  slug: string;
  name: string;
  /** For grouping the /near index; null when the attraction has none */
  city: string | null;
  type: string;
  googleTypes: string[];
  latitude: number;
  longitude: number;
  updatedAt?: string;
}

/**
 * Every attraction, with just what the sitemap and static params need (paginated: the table
 * has more rows than Supabase returns per request)
 */
export async function fetchAttractionSummaries(): Promise<AttractionSummary[]> {
  try {
    const rows: AttractionSummary[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await getSupabase()
        .from('maryland_attractions')
        .select('slug, name, city, type, google_types, latitude, longitude, updated_at')
        .order('slug')
        .range(from, from + 999);
      if (error) throw error;
      rows.push(
        ...data.map((a) => ({
          slug: a.slug,
          name: a.name,
          city: a.city ?? null,
          type: a.type,
          googleTypes: jsonStringArray(a.google_types),
          latitude: a.latitude,
          longitude: a.longitude,
          updatedAt: a.updated_at ?? undefined,
        }))
      );
      if (data.length < 1000) break;
    }
    return rows;
  } catch (error) {
    throwDuringBuild(error);
    console.error('Failed to fetch attractions:', error);
    return [];
  }
}
