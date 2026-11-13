/**
 * Fetch Google Reviews Script
 * 
 * This script:
 * 1. Fetches all breweries from Supabase
 * 2. Skips breweries without a place_id (link them with `npm run data:places -- --relink`)
 * 3. Fetches reviews via Place Details API
 * 4. Writes reviews to Supabase reviews table
 * 5. Updates summary columns in breweries table (google_rating, google_rating_count, google_reviews_last_updated)
 * 
 * Usage:
 *   npx tsx scripts/fetch-google-reviews.ts
 *   npx tsx scripts/fetch-google-reviews.ts --slug=a,b   # only these breweries, even if recently updated
 * 
 * Make sure to set environment variables in .env.local:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - GOOGLE_MAPS_API_KEY: a server key, not the site's browser key (docs/setup.md#google-server-key)
 * 
 * Required APIs in Google Cloud Console:
 *   - Places API (Place Details) - for fetching reviews
 */

// Load environment variables from .env.local BEFORE any other imports
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local file
config({ path: resolve(process.cwd(), '.env.local') });

// Now import other modules
import { getBreweryDataFromSupabase } from '@/lib/db/queries';
import { googleServerKey } from './lib/google';
import { writeReviewsToSupabase, updateReviewSummaryInSupabase } from '@/lib/db/queries';

const apiKey = googleServerKey();

/**
 * Google Review interface matching Places API response
 */
interface GoogleReview {
  author_name: string;
  author_url?: string;
  language?: string;
  profile_photo_url?: string;
  rating: number;
  relative_time_description: string;
  text: string;
  time: number;
}

/**
 * Place Details response interface
 */
interface PlaceDetailsResponse {
  rating?: number;
  user_ratings_total?: number;
  reviews?: GoogleReview[];
}

/**
 * Get Place Details with reviews from Google Places API
 */
async function getPlaceDetailsWithReviews(placeId: string): Promise<PlaceDetailsResponse | null> {
  try {
    // Request reviews, rating, and total ratings
    const fields = 'reviews,rating,user_ratings_total';
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${apiKey}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }
    
    const data = await response.json();
    
    if (data.status === 'OK' && data.result) {
      return {
        rating: data.result.rating,
        user_ratings_total: data.result.user_ratings_total,
        reviews: data.result.reviews || [],
      };
    } else if (data.status === 'REQUEST_DENIED') {
      const errorMsg = data.error_message || 'Request denied.';
      console.error(`  ✗ Place Details API request denied: ${errorMsg}`);
      
      // Check if it's a referer restriction error
      if (errorMsg.includes('referer restrictions')) {
        const error = new Error('REFERER_RESTRICTION');
        (error as any).isRefererRestriction = true;
        (error as any).originalMessage = errorMsg;
        throw error;
      }
      
      throw new Error(`Place Details API request denied: ${errorMsg}`);
    }
    
    return null;
  } catch (error) {
    // Re-throw referer restriction errors
    if (error instanceof Error && (error as any).isRefererRestriction) {
      throw error;
    }
    if (error instanceof Error && error.message.includes('REQUEST_DENIED')) {
      throw error;
    }
    console.warn(`  ⚠️  Error getting Place Details: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return null;
  }
}

/**
 * Sleep function for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main function to fetch and store Google Reviews
 */
async function fetchGoogleReviews() {
  console.log('🚀 Starting Google Reviews fetch...\n');
  console.log('📋 Using Places API to fetch reviews and store in Supabase\n');

  try {
    // Step 1: Fetch all breweries from Supabase
    console.log('📥 Step 1: Fetching breweries from Supabase...');
    const only = process.argv.find((a) => a.startsWith('--slug='))?.split('=')[1]?.split(',');
    const breweries = (await getBreweryDataFromSupabase()).filter((b) => !only || only.includes(b.slug));
    
    if (!breweries || breweries.length === 0) {
      console.log('   ℹ️  No breweries found in Supabase');
      return;
    }
    
    console.log(`   ✓ Fetched ${breweries.length} breweries\n`);

    // Step 2: Process each brewery
    console.log('🌍 Step 2: Fetching reviews for each brewery...');
    console.log('   (Rate limited to ~40 requests/second to stay within Google API limits)\n');
    
    let reviewsFetched = 0;
    let reviewsWritten = 0;
    let summariesUpdated = 0;
    let skipped = 0;
    let skippedRecent = 0; // Skipped because updated within last week
    let errorCount = 0;
    let requestDeniedError: Error | null = null;
    let refererRestrictionErrors = 0; // Track referer restriction errors
    
    // Calculate date threshold (7 days ago)
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    for (let i = 0; i < breweries.length; i++) {
      const brewery = breweries[i];
      console.log(`[${i + 1}/${breweries.length}] Processing: ${brewery.name}`);
      
      try {
        // Check if reviews were recently updated (within last week)
        if (brewery.googleReviewsLastUpdated && !only) {
          try {
            const lastUpdated = new Date(brewery.googleReviewsLastUpdated);
            if (!isNaN(lastUpdated.getTime()) && lastUpdated > oneWeekAgo) {
              const daysSinceUpdate = Math.floor((Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24));
              console.log(`   ⏭️  Skipping - reviews updated ${daysSinceUpdate} day(s) ago (less than 7 days)`);
              skippedRecent++;
              skipped++;
              console.log('');
              continue;
            }
          } catch (dateError) {
            // If date parsing fails, continue with fetching reviews
            console.log(`   ℹ️  Could not parse last updated date, proceeding with fetch...`);
          }
        }
        
        // Place IDs are linked only by `npm run data:places -- --relink`, which checks the match
        if (!brewery.placeId?.trim()) {
          console.log(`   ⚠️  No place_id; link it with npm run data:places -- --relink`);
          skipped++;
          console.log('');
          continue;
        }
        const placeId = brewery.placeId.trim();

        // Get Place Details with reviews
        console.log(`   📥 Fetching reviews...`);
        let details: PlaceDetailsResponse | null = null;
        try {
          details = await getPlaceDetailsWithReviews(placeId);
        } catch (error) {
          // Check if this is a referer restriction error
          if (error instanceof Error && (error as any).isRefererRestriction) {
            refererRestrictionErrors++;
            const originalMsg = (error as any).originalMessage || 'API keys with referer restrictions cannot be used with this API.';
            console.error(`  ✗ ${originalMsg}`);
            
            // Fail fast after first referer restriction error
            console.error(`\n❌ STOPPING: API key has referer restrictions and cannot be used for server-side scripts.`);
            console.error(`\n💡 SOLUTION:`);
            console.error(`1. Go to Google Cloud Console → APIs & Services → Credentials`);
            console.error(`2. Create a NEW API key for server-side use`);
            console.error(`3. Set "Application restrictions" to "None"`);
            console.error(`4. Set "API restrictions" to only: Places API (Text Search) and Places API (Place Details)`);
            console.error(`5. Run with it: GOOGLE_MAPS_API_KEY=your_new_key npm run data:reviews:google`);
            console.error(`\nSee docs/troubleshooting.md for detailed instructions.\n`);
            throw new Error('API key has referer restrictions - cannot be used for server-side scripts. Please create a server-side API key without referer restrictions.');
          }
          // Re-throw other errors
          throw error;
        }
        
        if (!details) {
          console.log(`   ⚠️  Could not get Place Details`);
          skipped++;
          console.log('');
          continue;
        }
        
        const reviews = details.reviews || [];
        const rating = details.rating;
        const ratingCount = details.user_ratings_total || 0;
        
        if (reviews.length === 0) {
          console.log(`   ℹ️  No reviews found for this brewery`);
          // Still update summary with rating/count if available
          if (rating !== undefined || ratingCount > 0) {
            try {
              await updateReviewSummaryInSupabase(brewery.id, rating || 0, ratingCount);
              summariesUpdated++;
              console.log(`   ✓ Updated summary (Rating: ${rating || 'N/A'}, Count: ${ratingCount})`);
            } catch (error) {
              console.warn(`   ⚠️  Could not update summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
          }
          skipped++;
          console.log('');
          continue;
        }
        
        reviewsFetched += reviews.length;
        console.log(`   ✓ Fetched ${reviews.length} reviews (Rating: ${rating || 'N/A'}, Total: ${ratingCount})`);
        
        // Write reviews to Supabase
        try {
          await writeReviewsToSupabase(brewery.id, brewery.name, reviews);
          reviewsWritten += reviews.length;
          console.log(`   ✓ Wrote ${reviews.length} reviews to Supabase`);
        } catch (error) {
          console.error(`   ✗ Error writing reviews: ${error instanceof Error ? error.message : 'Unknown error'}`);
          errorCount++;
        }
        
        // Update summary in breweries table
        try {
          await updateReviewSummaryInSupabase(brewery.id, rating || 0, ratingCount);
          summariesUpdated++;
          console.log(`   ✓ Updated summary in Supabase`);
        } catch (error) {
          console.warn(`   ⚠️  Could not update summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
          errorCount++;
        }
        
      } catch (error) {
        if (error instanceof Error && error.message.includes('REQUEST_DENIED')) {
          requestDeniedError = error;
          console.error(`   ✗ ${error.message}`);
          console.error(`\n   ⚠️  API REQUEST DENIED - Check your Google Cloud Console settings.`);
          errorCount++;
          
          if (i === 0) {
            console.error(`\n   Stopping script due to API access issues.`);
            throw error;
          }
        } else {
          console.error(`   ✗ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
          errorCount++;
        }
      }
      
      // Rate limiting: Wait 25ms between requests = 40 requests/second
      if (i < breweries.length - 1) {
        await sleep(25);
      }
      
      console.log(''); // Empty line for readability
    }
    
    if (requestDeniedError) {
      console.error(`\n❌ Script encountered API access issues.`);
      throw requestDeniedError;
    }
    
    console.log(`\n📊 Fetch Summary:`);
    console.log(`   ✓ Reviews fetched: ${reviewsFetched}`);
    console.log(`   ✓ Reviews written: ${reviewsWritten}`);
    console.log(`   ✓ Summaries updated: ${summariesUpdated}`);
    console.log(`   ⏭️  Skipped (recently updated): ${skippedRecent}`);
    console.log(`   ⊘ Skipped (other): ${skipped - skippedRecent}`);
    console.log(`   ⊘ Total skipped: ${skipped}`);
    console.log(`   ✗ Errors: ${errorCount}\n`);

    console.log('🎉 Google Reviews fetch completed successfully!');
    console.log(`\nFinal Summary:`);
    console.log(`  - Total breweries processed: ${breweries.length}`);
    console.log(`  - Reviews fetched: ${reviewsFetched}`);
    console.log(`  - Reviews written: ${reviewsWritten}`);
    console.log(`  - Summaries updated: ${summariesUpdated}`);
    console.log(`  - Skipped (recently updated): ${skippedRecent}`);
    console.log(`  - Skipped (other): ${skipped - skippedRecent}`);
    console.log(`  - Total skipped: ${skipped}`);
    console.log(`  - Errors: ${errorCount}`);

  } catch (error) {
    console.error('\n❌ Google Reviews fetch failed:', error);
    if (error instanceof Error && error.message.includes('REQUEST_DENIED')) {
      console.error('\n💡 Troubleshooting Tips:');
      console.error('1. Go to Google Cloud Console → APIs & Services → Library');
      console.error('2. Enable "Places API"');
      console.error('3. Go to APIs & Services → Credentials');
      console.error('4. Edit your API key and check restrictions');
      console.error('5. For server-side scripts, you may need to:');
      console.error('   - Set Application restrictions to "None" temporarily, OR');
      console.error('   - Create a separate API key for server-side use');
      console.error('6. Ensure billing is enabled (required even for free tier)');
    }
    process.exit(1);
  }
}

// Run the script
fetchGoogleReviews().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

