/**
 * Supabase Client Functions
 * Replaces Google Sheets API integration
 * Provides the same interface as google-sheets.ts but uses Supabase
 */

import { getAdminClient, getSupabase } from './client';
import type { Json, Tables } from './client';
import { jsonArray, jsonObject, jsonStringArray } from './json';
import { Brewery, Beer, SocialMedia, OperatingHours, Membership, ReviewThemes } from '@/types/brewery';
import { normalizeCountyName } from '@/lib/data-utils';
import { slugify } from '@/lib/slug';

import { isProductionBuild, throwDuringBuild } from './build';
/** The type column holds a string or (for one brewery) an array; always return a non-empty array. */
function normalizeTypes(value: Json | null): string[] {
  const types = (Array.isArray(value) ? jsonStringArray(value) : typeof value === 'string' ? value.split(',') : [])
    .map((t) => t.trim())
    .filter(Boolean);
  return types.length > 0 ? types : ['Microbrewery'];
}

/**
 * Convert database brewery to application brewery type
 */
function dbBreweryToBrewery(dbBrewery: Tables<'breweries'>, beers: Beer[] = []): Brewery {
  return {
    id: dbBrewery.id,
    name: dbBrewery.name,
    slug: dbBrewery.slug,
    description: dbBrewery.description ?? undefined,
    type: normalizeTypes(dbBrewery.type),

    // Location
    street: dbBrewery.street,
    city: dbBrewery.city,
    state: dbBrewery.state,
    zip: dbBrewery.zip ?? '',
    // Canonical county name, e.g. "Saint Marys" in the table becomes "St. Mary's"
    county: (dbBrewery.county && normalizeCountyName(slugify(dbBrewery.county))) || dbBrewery.county || '',
    latitude: dbBrewery.latitude,
    longitude: dbBrewery.longitude,

    // Contact
    phone: dbBrewery.phone ?? undefined,
    website: dbBrewery.website ?? undefined,
    socialMedia: jsonObject<SocialMedia>(dbBrewery.social_media) ?? {},

    // Hours
    hours: jsonObject<OperatingHours>(dbBrewery.hours) ?? {},

    // Features
    amenities: jsonStringArray(dbBrewery.amenities),
    allowsVisitors: dbBrewery.allows_visitors ?? false,
    offersTours: dbBrewery.offers_tours ?? false,
    beerToGo: dbBrewery.beer_to_go ?? false,
    hasMerch: dbBrewery.has_merch ?? false,
    memberships: jsonArray<Membership>(dbBrewery.memberships),

    // Additional fields
    food: dbBrewery.food ?? undefined,
    otherDrinks: dbBrewery.other_drinks ?? undefined,
    parking: dbBrewery.parking ?? undefined,
    dogFriendly: dbBrewery.dog_friendly ?? false,
    outdoorSeating: dbBrewery.outdoor_seating ?? false,
    logo: dbBrewery.logo ?? undefined,
    photoUrl: dbBrewery.photo_url ?? undefined,
    photos: jsonStringArray(dbBrewery.photos),
    featured: dbBrewery.featured ?? false,
    specialEvents: jsonStringArray(dbBrewery.special_events),
    awards: jsonStringArray(dbBrewery.awards),
    certifications: jsonStringArray(dbBrewery.certifications),

    // Metadata
    openedDate: dbBrewery.opened_date ?? undefined,
    lastUpdated: dbBrewery.updated_at || dbBrewery.created_at || '',

    // Google Reviews summary
    googleRating: dbBrewery.google_rating ?? undefined,
    googleRatingCount: dbBrewery.google_rating_count ?? undefined,
    googleReviewsLastUpdated: dbBrewery.google_reviews_last_updated ?? undefined,
    placeId: dbBrewery.place_id ?? undefined,
    hoursVerifiedAt: dbBrewery.hours_verified_at ?? undefined,

    // Yelp Reviews summary
    yelpBusinessId: dbBrewery.yelp_business_id ?? undefined,
    yelpRating: dbBrewery.yelp_rating ?? undefined,
    yelpRatingCount: dbBrewery.yelp_rating_count ?? undefined,
    yelpReviewsLastUpdated: dbBrewery.yelp_reviews_last_updated ?? undefined,

    // Review themes
    reviewThemes: jsonObject<ReviewThemes>(dbBrewery.review_themes),

    // Beer data
    beers: beers.length > 0 ? beers : undefined,
  };
}

/**
 * Fetch all brewery data from Supabase
 */
// Every breweries column except review_themes, which only brewery pages use (~100 KB of the list)
const LIST_COLUMNS = [
  'id', 'name', 'slug', 'description', 'type', 'street', 'city', 'state', 'zip', 'county', 'latitude', 'longitude',
  'phone', 'website', 'social_media', 'hours', 'amenities', 'allows_visitors', 'offers_tours', 'beer_to_go', 'has_merch',
  'memberships', 'food', 'other_drinks', 'parking', 'dog_friendly', 'outdoor_seating', 'logo', 'featured',
  'special_events', 'awards', 'certifications', 'opened_date', 'created_at', 'updated_at', 'google_rating',
  'google_rating_count', 'google_reviews_last_updated', 'place_id', 'photo_url', 'photos', 'yelp_business_id',
  'yelp_rating', 'yelp_rating_count', 'yelp_reviews_last_updated', 'articles_last_updated',
].join(',');

/**
 * All breweries. With detail: false (the site's cached list) it skips review_themes and beers;
 * the default returns everything, which scripts rely on.
 */
export async function getBreweryDataFromSupabase({ detail = true }: { detail?: boolean } = {}): Promise<Brewery[]> {
  const startTime = Date.now();

  try {
    // Fetch breweries
    const { data: breweriesData, error: breweriesError } = await getSupabase()
      .from('breweries')
      .select(detail ? '*' : LIST_COLUMNS)
      .order('name')
      .returns<Tables<'breweries'>[]>();

    if (breweriesError) {
      const errorMessage = breweriesError.message || breweriesError.toString() || 'Unknown error';
      const errorDetails = breweriesError.details ? ` Details: ${breweriesError.details}` : '';
      const errorHint = breweriesError.hint ? ` Hint: ${breweriesError.hint}` : '';
      throw new Error(`Failed to fetch breweries: ${errorMessage}${errorDetails}${errorHint}`);
    }

    if (!breweriesData || breweriesData.length === 0) {
      // An empty table during a build is a failed read, not real data
      if (isProductionBuild()) throw new Error('Supabase returned no breweries during the build');
      if (process.env.NODE_ENV === 'development') {
        console.warn('No breweries found in Supabase');
      }
      return [];
    }

    // Fetch all beers (detail only; brewery pages load their own through fetchBreweryBySlug)
    const { data: beersData, error: beersError } = detail
      ? await getSupabase().from('beers').select('*')
      : { data: [] as Tables<'beers'>[], error: null };

    if (beersError && process.env.NODE_ENV === 'development') {
      console.warn(`Failed to fetch beers: ${beersError.message}`);
    }

    // Group beers by brewery_id
    const beersByBrewery = new Map<string, Beer[]>();
    if (beersData) {
      beersData.forEach((beer: Tables<'beers'>) => {
        if (!beersByBrewery.has(beer.brewery_id)) {
          beersByBrewery.set(beer.brewery_id, []);
        }
        beersByBrewery.get(beer.brewery_id)!.push({
          name: beer.name,
          style: beer.style || '',
          abv: beer.abv || '',
          availability: beer.availability || '',
        });
      });
    }

    // Convert database breweries to application breweries
    const breweries: Brewery[] = breweriesData.map((dbBrewery: Tables<'breweries'>) => {
      const beers = beersByBrewery.get(dbBrewery.id) || [];
      return dbBreweryToBrewery(dbBrewery, beers);
    });

    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // Only log in development mode
    if (process.env.NODE_ENV === 'development') {
      console.log(`Successfully fetched ${breweries.length} breweries from Supabase in ${duration}ms`);
    }

    return breweries;
  } catch (error) {
    const errorMessage = error instanceof Error 
      ? error.message 
      : typeof error === 'string' 
        ? error 
        : 'Unknown error occurred while fetching brewery data';
    
    console.error('Failed to fetch brewery data from Supabase:', {
      message: errorMessage,
      error: error,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Set' : 'Missing',
      supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'Set' : 'Missing',
    });
    
    throw new Error(`Failed to fetch brewery data: ${errorMessage}`);
  }
}

/**
 * Check if an email is already subscribed
 */
async function checkEmailExists(email: string): Promise<boolean> {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    
    const { data, error } = await getSupabase()
      .from('newsletter_subscribers')
      .select('email')
      .eq('email', normalizedEmail)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error checking email existence:', error);
      return false; // Fail open
    }

    return !!data;
  } catch (error) {
    console.error('Error checking email existence:', error);
    return false; // Fail open
  }
}

/**
 * Add newsletter subscriber to Supabase
 */
export async function addNewsletterSubscriber(email: string, metadata: any = {}) {
  try {
    // Check if email already exists
    const emailExists = await checkEmailExists(email);
    if (emailExists) {
      return { success: false, error: 'Email already subscribed' };
    }

    const normalizedEmail = email.toLowerCase().trim();

    const { error } = await getSupabase()
      .from('newsletter_subscribers')
      .insert({
        email: normalizedEmail,
        ip_address: metadata.ipAddress || '',
        user_agent: metadata.userAgent || '',
        source: metadata.source || 'newsletter',
      });

    if (error) {
      // Check if it's a unique constraint violation (duplicate email)
      if (error.code === '23505') {
        return { success: false, error: 'Email already subscribed' };
      }
      throw error;
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to add newsletter subscriber:', error);
    throw error;
  }
}

/**
 * Get brewery by slug
 */
export async function fetchBreweryBySlug(slug: string): Promise<Brewery | null> {
  try {
    const { data: breweryData, error } = await getSupabase()
      .from('breweries')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw error;
    if (!breweryData) return null;

    // Fetch beers for this brewery
    const { data: beersData } = await getSupabase()
      .from('beers')
      .select('*')
      .eq('brewery_id', breweryData.id);

    const beers: Beer[] = (beersData || []).map((beer: Tables<'beers'>) => ({
      name: beer.name,
      style: beer.style || '',
      abv: beer.abv || '',
      availability: beer.availability || '',
    }));

    return dbBreweryToBrewery(breweryData, beers);
  } catch (error) {
    throwDuringBuild(error);
    console.error('Error fetching brewery by slug:', error);
    return null;
  }
}

/**
 * Write reviews to Supabase reviews table
 */
export async function writeReviewsToSupabase(
  breweryId: string,
  breweryName: string,
  reviews: Array<{
    author_name?: string;
    author_url?: string;
    language?: string;
    profile_photo_url?: string;
    rating: number;
    relative_time_description: string;
    text: string;
    time: number;
  }>,
  source: 'google' | 'yelp' = 'google'
): Promise<void> {
  try {

    if (!reviews || reviews.length === 0) {
      return;
    }

    // Get existing reviews for this brewery to check for duplicates
    const { data: existingReviews } = await getAdminClient()
      .from('reviews')
      .select('review_timestamp, reviewer_name, review_text')
      .eq('brewery_id', breweryId)
      .eq('source', source);

    // Create a set of existing review keys for fast lookup
    const existingKeys = new Set<string>();
    (existingReviews || []).forEach((review: any) => {
      const timestamp = review.review_timestamp || 0;
      const reviewerName = (review.reviewer_name || '').toLowerCase().trim();
      const reviewTextSnippet = (review.review_text || '').substring(0, 100).toLowerCase().trim();
      const key = `${timestamp}|${reviewerName}|${reviewTextSnippet}`;
      existingKeys.add(key);
    });

    const fetchedAt = new Date().toISOString();

    // Filter out duplicates before inserting
    const newReviewRecords = reviews
      .map(review => {
        const timestamp = review.time || 0;
        const reviewerName = (review.author_name || '').toLowerCase().trim();
        const reviewTextSnippet = (review.text || '').substring(0, 100).toLowerCase().trim();
        const key = `${timestamp}|${reviewerName}|${reviewTextSnippet}`;
        
        // Skip if this review already exists
        if (existingKeys.has(key)) {
          return null;
        }

        return {
          brewery_id: breweryId,
          brewery_name: breweryName,
          source: source,
          reviewer_name: review.author_name || null,
          rating: review.rating || null,
          review_text: review.text || null,
          review_date: review.relative_time_description || null,
          review_timestamp: review.time || null,
          reviewer_url: review.author_url || null,
          profile_photo_url: review.profile_photo_url || null,
          language: review.language || 'en',
          fetched_at: fetchedAt,
        };
      })
      .filter((record): record is NonNullable<typeof record> => record !== null);

    // Only insert if there are new reviews
    if (newReviewRecords.length === 0) {
      return;
    }

    // Upsert on the reviews unique constraint (migration 20261027000000_reviews_unique.sql)
    const { error } = await getAdminClient()
      .from('reviews')
      .upsert(newReviewRecords, { onConflict: REVIEW_CONFLICT_COLUMNS, ignoreDuplicates: true });

    if (error?.code === '42P10') {
      // The constraint isn't applied yet; the records above are already de-duplicated, so insert
      const { error: insertError } = await getAdminClient().from('reviews').insert(newReviewRecords);
      if (insertError) throw insertError;
    } else if (error) {
      throw error;
    }
  } catch (error) {
    console.error('Failed to write reviews to Supabase:', error);
    throw error;
  }
}

/**
 * Update review summary in breweries table
 */
export async function updateReviewSummaryInSupabase(
  breweryId: string,
  rating: number,
  ratingCount: number
): Promise<void> {
  try {

    const { error } = await getAdminClient()
      .from('breweries')
      .update({
        google_rating: rating,
        google_rating_count: ratingCount,
        google_reviews_last_updated: new Date().toISOString(),
      })
      .eq('id', breweryId);

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('Failed to update review summary in Supabase:', error);
    throw error;
  }
}

/**
 * Update Yelp review summary in breweries table
 */
export async function updateYelpReviewSummaryInSupabase(
  breweryId: string,
  rating: number,
  ratingCount: number
): Promise<void> {
  try {

    const { error } = await getAdminClient()
      .from('breweries')
      .update({
        yelp_rating: rating,
        yelp_rating_count: ratingCount,
        yelp_reviews_last_updated: new Date().toISOString(),
      })
      .eq('id', breweryId);

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('Failed to update Yelp review summary in Supabase:', error);
    throw error;
  }
}

/**
 * Store Yelp Business ID for a brewery
 */
export async function storeYelpBusinessIdInSupabase(
  breweryId: string,
  yelpBusinessId: string
): Promise<void> {
  try {

    const { error } = await getAdminClient()
      .from('breweries')
      .update({ yelp_business_id: yelpBusinessId })
      .eq('id', breweryId);

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('Failed to store Yelp Business ID in Supabase:', error);
    throw error;
  }
}

/**
 * Update brewery logo in Supabase
 */
export async function updateBreweryLogoInSupabase(
  breweryId: string,
  logoPath: string
): Promise<void> {
  try {

    const { error } = await getAdminClient()
      .from('breweries')
      .update({ logo: logoPath })
      .eq('id', breweryId);

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('Failed to update logo in Supabase:', error);
    throw error;
  }
}

/**
 * Review interface matching Supabase schema
 */

const REVIEW_CONFLICT_COLUMNS = 'brewery_id,source,review_timestamp,reviewer_name';

function reviewKey(review: Tables<'reviews'>): string {
  return `${review.brewery_id}|${review.source}|${review.review_timestamp ?? 0}|${(review.reviewer_name || '').toLowerCase().trim()}`;
}

/**
 * One page of a brewery's reviews, newest first, with the total count.
 * Paginated in the database. Copies within the page are dropped as a safety net until the
 * reviews unique constraint is applied (then there are none to drop).
 */
export async function getBreweryReviews(
  breweryId: string,
  limit: number = 10,
  offset: number = 0
): Promise<{ reviews: Tables<'reviews'>[]; total: number }> {
  try {
    const { data, count, error } = await getSupabase()
      .from('reviews')
      .select('*', { count: 'exact' })
      .eq('brewery_id', breweryId)
      .order('review_timestamp', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    const rows = (data || []) as Tables<'reviews'>[];
    const seen = new Set<string>();
    const reviews = rows.filter((review) => {
      const key = reviewKey(review);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { reviews, total: (count ?? rows.length) - (rows.length - reviews.length) };
  } catch (error) {
    throwDuringBuild(error);
    console.error('Failed to fetch reviews from Supabase:', error);
    return { reviews: [], total: 0 };
  }
}

export async function getBreweryArticles(breweryId: string, limit: number = 5): Promise<Tables<'brewery_articles'>[]> {
  try {
    const { data, error } = await getSupabase()
      .from('brewery_articles')
      .select('*')
      .eq('brewery_id', breweryId)
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('relevance_score', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    throwDuringBuild(error);
    console.error('Failed to fetch brewery articles from Supabase:', error);
    return [];
  }
}

/**
 * Get neighborhoods by city
 */
export async function getNeighborhoodsByCity(city: string): Promise<Tables<'maryland_neighborhoods'>[]> {
  try {
    const { data, error } = await getSupabase()
      .from('maryland_neighborhoods')
      .select('*')
      .ilike('city', city)
      .order('name', { ascending: true });
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    throwDuringBuild(error);
    console.error('Failed to fetch neighborhoods from Supabase:', error);
    return [];
  }
}

/**
 * Get neighborhood by slug
 */
export async function getNeighborhoodBySlug(slug: string): Promise<Tables<'maryland_neighborhoods'> | null> {
  try {
    const { data, error } = await getSupabase()
      .from('maryland_neighborhoods')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();
    
    if (error) throw error;
    
    return data;
  } catch (error) {
    throwDuringBuild(error);
    console.error('Failed to fetch neighborhood from Supabase:', error);
    return null;
  }
}

/**
 * Get every neighborhood (used for static params and the sitemap)
 */
export async function getAllNeighborhoods(): Promise<Tables<'maryland_neighborhoods'>[]> {
  try {
    const { data, error } = await getSupabase()
      .from('maryland_neighborhoods')
      .select('*')
      .order('name', { ascending: true })
      .range(0, 4999);

    if (error) throw error;

    return data || [];
  } catch (error) {
    throwDuringBuild(error);
    console.error('Failed to fetch neighborhoods:', error);
    return [];
  }
}

export interface Region {
  slug: string;
  name: string;
  /** Canonical county names, matching breweries.county */
  counties: string[];
  description: string;
}

/** The regions table says "Baltimore County" where breweries say "Baltimore"; map to the canonical name. */
function canonicalCounty(name: string): string {
  return normalizeCountyName(slugify(name.replace(/ County$/i, ''))) ?? name;
}

/**
 * Get the Maryland regions from the maryland_regions table
 */
export async function fetchRegions(): Promise<Region[]> {
  try {
    const { data, error } = await getSupabase()
      .from('maryland_regions')
      .select('region_slug, region_name, counties, description')
      .order('created_at', { ascending: true });
    if (error) throw error;

    return (data || []).map((row: { region_slug: string; region_name: string; counties: string[] | null; description: string | null }) => ({
      slug: row.region_slug,
      name: row.region_name,
      counties: (row.counties || []).map(canonicalCounty),
      description: row.description || '',
    }));
  } catch (error) {
    throwDuringBuild(error);
    console.error('Failed to fetch regions from Supabase:', error);
    return [];
  }
}
