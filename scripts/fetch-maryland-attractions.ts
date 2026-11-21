/**
 * Fetch Maryland Attractions Script
 * 
 * This script:
 * 1. Fetches all unique cities from breweries table
 * 2. Searches for attractions near each city using Google Places API
 * 3. Performs grid search across Maryland bounds
 * 4. Stores attractions in Supabase maryland_attractions table
 * 
 * Usage:
 *   npx tsx scripts/fetch-maryland-attractions.ts
 *   npx tsx scripts/fetch-maryland-attractions.ts --dry-run
 *   npx tsx scripts/fetch-maryland-attractions.ts --city=Baltimore
 *   npx tsx scripts/fetch-maryland-attractions.ts --type=museum
 * 
 * Make sure to set environment variables in .env.local:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - GOOGLE_MAPS_API_KEY: a server key, not the site's browser key (docs/setup.md#google-server-key)
 * 
 * Required APIs in Google Cloud Console:
 *   - Places API (Nearby Search)
 *   - Places API (Place Details)
 */

// Load environment variables from .env.local BEFORE any other imports
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local file
config({ path: resolve(process.cwd(), '.env.local') });

// Now import other modules
import { getAdminClient } from '@/lib/db/client';
import type { TablesInsert } from '@/lib/db/client';
import { getBreweryDataFromSupabase } from '@/lib/db/queries';
import { googleServerKey } from './lib/google';
import { slugify } from '@/lib/slug';
import { RESERVED_PLACE_SLUGS } from '@/lib/attractions';

const GOOGLE_PLACES_API_KEY = googleServerKey();

// Attraction types to search (Google Places types)
const ATTRACTION_TYPES = [
  'tourist_attraction',
  'museum',
  'park',
  'amusement_park',
  'zoo',
  'aquarium',
  'art_gallery',
  'stadium',
  'shopping_mall',
  'movie_theater',
  'bowling_alley',
  'casino',
  'night_club',
  'spa',
  'campground',
  'restaurant', // Popular restaurants can be attractions
  'landmark',
  'point_of_interest',
];

// Map Google types to our simplified type categories
const TYPE_MAPPING: Record<string, string> = {
  'tourist_attraction': 'landmark',
  'museum': 'museum',
  'park': 'park',
  'amusement_park': 'entertainment',
  'zoo': 'entertainment',
  'aquarium': 'entertainment',
  'art_gallery': 'museum',
  'stadium': 'entertainment',
  'shopping_mall': 'shopping',
  'movie_theater': 'entertainment',
  'bowling_alley': 'entertainment',
  'casino': 'entertainment',
  'night_club': 'entertainment',
  'spa': 'entertainment',
  'campground': 'park',
  'restaurant': 'restaurant',
  'landmark': 'landmark',
  'point_of_interest': 'landmark',
};

// Rate limiting configuration
const DELAY_BETWEEN_REQUESTS = 200; // ms
const MAX_REQUESTS_PER_CITY = 50;

// Maryland bounds for grid search
const MARYLAND_BOUNDS = {
  north: 39.7,
  south: 37.9,
  east: -75.0,
  west: -79.5,
};

// Parse CLI arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CITY_FILTER = args.find(a => a.startsWith('--city='))?.split('=')[1];
const TYPE_FILTER = args.find(a => a.startsWith('--type='))?.split('=')[1];

/**
 * Sleep helper for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Search nearby places using Google Places API Nearby Search
 */
async function searchNearbyPlaces(
  lat: number,
  lng: number,
  radius: number,
  type: string
): Promise<any[]> {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=${type}&key=${GOOGLE_PLACES_API_KEY}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.warn(`  ⚠️  HTTP error ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
    if (data.status === 'OK' && data.results) {
      return data.results;
    } else if (data.status === 'ZERO_RESULTS') {
      return [];
    } else if (data.status === 'REQUEST_DENIED') {
      const errorMsg = data.error_message || 'Request denied';
      console.error(`  ✗ API request denied: ${errorMsg}`);
      throw new Error(`Places API request denied: ${errorMsg}`);
    } else if (data.status === 'OVER_QUERY_LIMIT') {
      console.error(`  ✗ API quota exceeded`);
      throw new Error('Google Maps API quota exceeded');
    } else {
      console.warn(`  ⚠️  API returned status "${data.status}"`);
      return [];
    }
  } catch (error) {
    if (error instanceof Error && (error.message.includes('REQUEST_DENIED') || error.message.includes('quota'))) {
      throw error;
    }
    console.warn(`  ⚠️  Error searching nearby places: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return [];
  }
}

/**
 * Get Place Details from Google Places API
 */
async function getPlaceDetails(placeId: string): Promise<any> {
  try {
    const fields = 'place_id,name,formatted_address,geometry,types,rating,user_ratings_total,price_level,opening_hours,photos,website,formatted_phone_number,editorial_summary';
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${GOOGLE_PLACES_API_KEY}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.warn(`  ⚠️  HTTP error ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (data.status === 'OK' && data.result) {
      return data.result;
    } else if (data.status === 'REQUEST_DENIED') {
      const errorMsg = data.error_message || 'Request denied';
      console.error(`  ✗ API request denied: ${errorMsg}`);
      throw new Error(`Places API request denied: ${errorMsg}`);
    } else if (data.status === 'OVER_QUERY_LIMIT') {
      console.error(`  ✗ API quota exceeded`);
      throw new Error('Google Maps API quota exceeded');
    } else {
      console.warn(`  ⚠️  API returned status "${data.status}"`);
      return null;
    }
  } catch (error) {
    if (error instanceof Error && (error.message.includes('REQUEST_DENIED') || error.message.includes('quota'))) {
      throw error;
    }
    console.warn(`  ⚠️  Error getting place details: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return null;
  }
}

/**
 * Extract city and state from formatted address
 */
function extractLocationFromAddress(formattedAddress: string): { city: string; state: string; zip?: string; street?: string } {
  const parts = formattedAddress.split(',').map(p => p.trim());
  
  // Typical format: "Street, City, State ZIP, Country"
  const street = parts[0] || '';
  let city = '';
  let state = 'MD';
  let zip = '';
  
  if (parts.length >= 2) {
    city = parts[parts.length - 3] || parts[parts.length - 2] || '';
    const stateZip = parts[parts.length - 2] || parts[parts.length - 1] || '';
    const stateZipMatch = stateZip.match(/([A-Z]{2})\s+(\d{5}(-\d{4})?)/);
    if (stateZipMatch) {
      state = stateZipMatch[1];
      zip = stateZipMatch[2];
    } else if (stateZip.length === 2) {
      state = stateZip;
    }
  }
  
  return { city, state, zip, street };
}

/**
 * Convert Google Places hours to our format
 */
function convertGoogleHours(openingHours?: any): Record<string, string> | undefined {
  if (!openingHours || !openingHours.weekday_text) {
    return undefined;
  }
  
  const hours: Record<string, string> = {};
  const dayMap: Record<string, string> = {
    'Monday': 'monday',
    'Tuesday': 'tuesday',
    'Wednesday': 'wednesday',
    'Thursday': 'thursday',
    'Friday': 'friday',
    'Saturday': 'saturday',
    'Sunday': 'sunday',
  };
  
  openingHours.weekday_text.forEach((text: string) => {
    const match = text.match(/^([^:]+):\s*(.+)$/);
    if (match) {
      const dayName = match[1].trim();
      const hoursText = match[2].trim();
      const dayKey = dayMap[dayName];
      if (dayKey) {
        hours[dayKey] = hoursText;
      }
    }
  });
  
  return Object.keys(hours).length > 0 ? hours : undefined;
}

/**
 * Determine attraction type from Google types
 */
function determineAttractionType(googleTypes: string[]): string {
  for (const googleType of googleTypes) {
    if (TYPE_MAPPING[googleType]) {
      return TYPE_MAPPING[googleType];
    }
  }
  return 'landmark'; // Default
}

/**
 * Convert Google Places result to TablesInsert<'maryland_attractions'>
 */
async function convertPlaceToAttraction(place: any, placeDetails?: any): Promise<TablesInsert<'maryland_attractions'> | null> {
  try {
    const details = placeDetails || await getPlaceDetails(place.place_id);
    if (!details) {
      return null;
    }
    
    // Only include attractions in Maryland
    const location = extractLocationFromAddress(details.formatted_address || '');
    if (location.state !== 'MD') {
      return null;
    }
    
    const googleTypes = details.types || place.types || [];
    const type = determineAttractionType(googleTypes);
    
    // Apply type filter if specified
    if (TYPE_FILTER && type !== TYPE_FILTER) {
      return null;
    }
    
    const name = details.name || place.name || 'Unknown';
    // /near/{type} pages own these slugs (src/lib/attractions.ts); an attraction named "Parks" gets parks-place
    const base = slugify(name);
    const slug = RESERVED_PLACE_SLUGS.has(base) ? `${base}-place` : base;
    
    const geometry = details.geometry || place.geometry;
    const lat = geometry?.location?.lat;
    const lng = geometry?.location?.lng;
    
    if (!lat || !lng) {
      return null;
    }
    
    // Extract county (we'll leave it empty for now, can be enriched later)
    const county = location.city ? undefined : undefined;
    
    const attraction: TablesInsert<'maryland_attractions'> = {
      place_id: details.place_id || place.place_id,
      name,
      slug,
      type,
      google_types: googleTypes,
      street: location.street,
      city: location.city || 'Unknown',
      state: 'MD',
      zip: location.zip,
      county,
      latitude: lat,
      longitude: lng,
      description: details.editorial_summary?.overview || undefined,
      phone: details.formatted_phone_number || undefined,
      website: details.website || undefined,
      rating: details.rating || undefined,
      rating_count: details.user_ratings_total || undefined,
      price_level: details.price_level || undefined,
      hours: convertGoogleHours(details.opening_hours),
      photos: details.photos?.map((p: any) => p.photo_reference) || [],
      last_updated: new Date().toISOString(),
    };
    
    return attraction;
  } catch (error) {
    console.warn(`  ⚠️  Error converting place to attraction: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return null;
  }
}

/**
 * Upsert attraction to Supabase
 */
async function upsertAttraction(attraction: TablesInsert<'maryland_attractions'>): Promise<boolean> {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would upsert: ${attraction.name} (${attraction.type})`);
    return true;
  }
  
  
  try {
    const { error } = await getAdminClient()
      .from('maryland_attractions')
      .upsert(attraction, {
        onConflict: 'place_id',
        ignoreDuplicates: false,
      });
    
    if (error) {
      console.error(`  ✗ Error upserting attraction: ${error.message}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`  ✗ Error upserting attraction: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return false;
  }
}

/**
 * Search attractions near a city
 */
async function searchAttractionsNearCity(city: string, cityLat?: number, cityLng?: number): Promise<number> {
  console.log(`\n📍 Searching attractions near ${city}...`);
  
  let searchLat = cityLat;
  let searchLng = cityLng;
  
  // If no coordinates provided, try to find city center from breweries
  if (!searchLat || !searchLng) {
    const breweries = await getBreweryDataFromSupabase();
    const cityBreweries = breweries.filter(b => b.city.toLowerCase() === city.toLowerCase());
    if (cityBreweries.length > 0) {
      // Use average coordinates of breweries in this city
      const avgLat = cityBreweries.reduce((sum, b) => sum + b.latitude, 0) / cityBreweries.length;
      const avgLng = cityBreweries.reduce((sum, b) => sum + b.longitude, 0) / cityBreweries.length;
      searchLat = avgLat;
      searchLng = avgLng;
    } else {
      console.warn(`  ⚠️  No coordinates found for ${city}, skipping`);
      return 0;
    }
  }
  
  const seenPlaceIds = new Set<string>();
  let totalFound = 0;
  let totalUpserted = 0;
  
  // Search each attraction type
  for (const attractionType of ATTRACTION_TYPES) {
    if (TYPE_FILTER) {
      const mappedType = TYPE_MAPPING[attractionType] || attractionType;
      if (mappedType !== TYPE_FILTER) {
        continue;
      }
    }
    
    try {
      await sleep(DELAY_BETWEEN_REQUESTS);
      
      const results = await searchNearbyPlaces(searchLat!, searchLng!, 10000, attractionType); // 10km radius
      
      for (const place of results) {
        if (seenPlaceIds.has(place.place_id)) {
          continue;
        }
        seenPlaceIds.add(place.place_id);
        totalFound++;
        
        const attraction = await convertPlaceToAttraction(place);
        if (attraction) {
          const success = await upsertAttraction(attraction);
          if (success) {
            totalUpserted++;
          }
          await sleep(DELAY_BETWEEN_REQUESTS);
        }
      }
    } catch (error) {
      if (error instanceof Error && (error.message.includes('quota') || error.message.includes('REQUEST_DENIED'))) {
        throw error;
      }
      console.warn(`  ⚠️  Error searching ${attractionType}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  console.log(`  ✓ Found ${totalFound} places, upserted ${totalUpserted} attractions`);
  return totalUpserted;
}

/**
 * Grid search across Maryland
 */
async function gridSearchMaryland(): Promise<number> {
  console.log(`\n🗺️  Performing grid search across Maryland...`);
  
  // Create a grid of search points
  const gridSize = 0.5; // degrees (roughly 50km spacing)
  const latSteps = Math.ceil((MARYLAND_BOUNDS.north - MARYLAND_BOUNDS.south) / gridSize);
  const lngSteps = Math.ceil((MARYLAND_BOUNDS.east - MARYLAND_BOUNDS.west) / gridSize);
  
  const seenPlaceIds = new Set<string>();
  let totalFound = 0;
  let totalUpserted = 0;
  let requestCount = 0;
  
  for (let i = 0; i < latSteps; i++) {
    for (let j = 0; j < lngSteps; j++) {
      const lat = MARYLAND_BOUNDS.south + (i * gridSize);
      const lng = MARYLAND_BOUNDS.west + (j * gridSize);
      
      // Search a few key attraction types to avoid too many requests
      const keyTypes = ['tourist_attraction', 'museum', 'park', 'amusement_park', 'zoo'];
      
      for (const attractionType of keyTypes) {
        if (requestCount >= MAX_REQUESTS_PER_CITY * 10) {
          console.log(`  ⚠️  Reached request limit, stopping grid search`);
          break;
        }
        
        try {
          await sleep(DELAY_BETWEEN_REQUESTS);
          requestCount++;
          
          const results = await searchNearbyPlaces(lat, lng, 25000, attractionType); // 25km radius
          
          for (const place of results) {
            if (seenPlaceIds.has(place.place_id)) {
              continue;
            }
            seenPlaceIds.add(place.place_id);
            totalFound++;
            
            const attraction = await convertPlaceToAttraction(place);
            if (attraction) {
              const success = await upsertAttraction(attraction);
              if (success) {
                totalUpserted++;
              }
              await sleep(DELAY_BETWEEN_REQUESTS);
            }
          }
        } catch (error) {
          if (error instanceof Error && (error.message.includes('quota') || error.message.includes('REQUEST_DENIED'))) {
            throw error;
          }
          console.warn(`  ⚠️  Error in grid search: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }
  }
  
  console.log(`  ✓ Found ${totalFound} places, upserted ${totalUpserted} attractions`);
  return totalUpserted;
}

/**
 * Main execution
 */
async function main() {
  console.log('🏛️  Maryland Attractions Fetcher');
  console.log('================================');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  if (CITY_FILTER) {
    console.log(`City filter: ${CITY_FILTER}`);
  }
  if (TYPE_FILTER) {
    console.log(`Type filter: ${TYPE_FILTER}`);
  }
  console.log('');
  
  try {
    // Get unique cities from breweries
    const breweries = await getBreweryDataFromSupabase();
    const cityMap = new Map<string, { lat: number; lng: number }>();
    
    breweries.forEach(brewery => {
      const cityKey = brewery.city.toLowerCase();
      if (!cityMap.has(cityKey)) {
        cityMap.set(cityKey, { lat: brewery.latitude, lng: brewery.longitude });
      }
    });
    
    const cities = Array.from(cityMap.entries()).map(([name, coords]) => ({
      name,
      ...coords,
    }));
    
    console.log(`Found ${cities.length} unique cities with breweries`);
    
    let totalUpserted = 0;
    
    // Search near cities
    if (CITY_FILTER) {
      const city = cities.find(c => c.name.toLowerCase() === CITY_FILTER.toLowerCase());
      if (city) {
        totalUpserted += await searchAttractionsNearCity(city.name, city.lat, city.lng);
      } else {
        console.warn(`⚠️  City "${CITY_FILTER}" not found, searching without coordinates`);
        totalUpserted += await searchAttractionsNearCity(CITY_FILTER);
      }
    } else {
      for (const city of cities) {
        totalUpserted += await searchAttractionsNearCity(city.name, city.lat, city.lng);
      }
    }
    
    // Grid search (only if no city filter)
    if (!CITY_FILTER) {
      totalUpserted += await gridSearchMaryland();
    }
    
    console.log(`\n✅ Complete! Total attractions upserted: ${totalUpserted}`);
    
  } catch (error) {
    if (error instanceof Error && error.message.includes('referer restrictions')) {
      console.error('\n❌ API Key Error: Referer restrictions detected');
      console.error('This script requires a server-side API key without referer restrictions.');
      console.error('\nTo fix:');
      console.error('1. Go to Google Cloud Console → APIs & Services → Credentials');
      console.error('2. Create a new API key');
      console.error('3. Set "Application restrictions" to "None"');
      console.error('4. Set "API restrictions" to only: Places API (Nearby Search) and Places API (Place Details)');
      console.error('5. Add the new key to .env.local as GOOGLE_MAPS_API_KEY');
      process.exit(1);
    }
    
    console.error('\n❌ Error:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

// Run the script
main();

