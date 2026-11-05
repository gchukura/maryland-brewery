/**
 * IndexNow URL Submission Script
 * 
 * Submits sitemap URLs to the IndexNow API so Bing, Yandex and other participating search
 * engines recrawl them.
 *
 * Usage: npx tsx scripts/submit-indexnow.ts --previous prev-urls.json --save urls.json
 *        npx tsx scripts/submit-indexnow.ts --all
 *
 * --previous: submit only the sitemap URLs missing from this JSON list. If the file does not
 *             exist, submit nothing (with --save, that run just records the baseline).
 * --save:     write the current sitemap URLs there after a successful submission.
 * --all:      submit every sitemap URL. Bing warns against bulk ("batch mode") submissions,
 *             so use this rarely.
 * With neither --previous nor --all it refuses to run. URLs go out in requests of at most
 * CHUNK_SIZE, CHUNK_DELAY_MS apart.
 * 
 * Note: Google does not participate in IndexNow, but Bing and Yandex do.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseStringPromise } from 'xml2js';

const INDEXNOW_KEY = '457bccd4eef437d8877d15d3e947fa02';
const HOST = 'www.marylandbrewery.com';
const SITEMAP_URL = `https://${HOST}/sitemap.xml`;
const KEY_LOCATION = `https://${HOST}/${INDEXNOW_KEY}.txt`;

// IndexNow endpoints (can use any of these)
const INDEXNOW_ENDPOINTS = [
  'https://api.indexnow.org/indexnow',
  'https://www.bing.com/indexnow',
  'https://yandex.com/indexnow',
];

// Small requests, spaced out: Bing flags large IndexNow submissions as batch mode
const CHUNK_SIZE = 100;
const CHUNK_DELAY_MS = 5000;

// Colors for terminal output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};

interface SitemapUrl {
  loc: string[];
  lastmod?: string[];
  priority?: string[];
}

interface SitemapData {
  urlset: {
    url: SitemapUrl[];
  };
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * Fetch and parse the sitemap
 */
async function fetchSitemap(): Promise<string[]> {
  console.log(`${colors.blue}📥 Fetching sitemap from ${SITEMAP_URL}...${colors.reset}`);
  
  const response = await fetch(SITEMAP_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap: ${response.status}`);
  }
  
  const xml = await response.text();
  const parsed: SitemapData = await parseStringPromise(xml);
  
  const urls = parsed.urlset.url.map((item) => item.loc[0]);
  console.log(`${colors.green}✅ Found ${urls.length} URLs in sitemap${colors.reset}\n`);
  
  return urls;
}

/**
 * Submit URLs to IndexNow in batches
 */
async function submitToIndexNow(urls: string[]): Promise<boolean> {
  const endpoint = INDEXNOW_ENDPOINTS[0]; // Use main API endpoint
  const batchSize = CHUNK_SIZE;
  
  console.log(`${colors.blue}🚀 Submitting ${urls.length} URLs to IndexNow...${colors.reset}\n`);
  let ok = true;
  
  // Split into batches if needed
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(urls.length / batchSize);
    
    console.log(`${colors.cyan}📦 Batch ${batchNum}/${totalBatches}: ${batch.length} URLs${colors.reset}`);
    
    const payload = {
      host: HOST,
      key: INDEXNOW_KEY,
      keyLocation: KEY_LOCATION,
      urlList: batch,
    };
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(payload),
      });
      
      if (response.ok || response.status === 200 || response.status === 202) {
        console.log(`   ${colors.green}✅ Batch ${batchNum} submitted successfully (${response.status})${colors.reset}`);
      } else {
        ok = false;
        const errorText = await response.text();
        console.log(`   ${colors.red}❌ Batch ${batchNum} failed: ${response.status} - ${errorText}${colors.reset}`);
        
        // Log specific error reasons
        if (response.status === 400) {
          console.log(`   ${colors.yellow}   Reason: Invalid format${colors.reset}`);
        } else if (response.status === 403) {
          console.log(`   ${colors.yellow}   Reason: Key not valid (check key file exists at ${KEY_LOCATION})${colors.reset}`);
        } else if (response.status === 422) {
          console.log(`   ${colors.yellow}   Reason: URLs don't belong to host or key mismatch${colors.reset}`);
        } else if (response.status === 429) {
          console.log(`   ${colors.yellow}   Reason: Too many requests (rate limited)${colors.reset}`);
        }
      }
    } catch (error) {
      ok = false;
      console.log(`   ${colors.red}❌ Batch ${batchNum} error: ${error}${colors.reset}`);
    }
    
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < urls.length) {
      await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
    }
  }

  return ok;
}

/**
 * Main function
 */
async function main(): Promise<void> {
  console.log(`\n${colors.blue}═══════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.blue}   IndexNow URL Submission Tool${colors.reset}`);
  console.log(`${colors.blue}═══════════════════════════════════════════${colors.reset}\n`);
  
  console.log(`${colors.cyan}Host:${colors.reset} ${HOST}`);
  console.log(`${colors.cyan}Key:${colors.reset} ${INDEXNOW_KEY}`);
  console.log(`${colors.cyan}Key Location:${colors.reset} ${KEY_LOCATION}\n`);
  
  const previousPath = flag('--previous');
  const savePath = flag('--save');
  const all = process.argv.includes('--all');
  if (!previousPath && !all) {
    console.log(`${colors.red}❌ Pass --previous <file> to submit only new URLs, or --all to submit every URL.${colors.reset}`);
    console.log(`${colors.yellow}   Bing warns against bulk submissions; prefer --previous.${colors.reset}\n`);
    process.exit(1);
  }

  try {
    // First verify the key file is accessible
    console.log(`${colors.blue}🔑 Verifying key file...${colors.reset}`);
    const keyResponse = await fetch(KEY_LOCATION);
    if (!keyResponse.ok) {
      console.log(`${colors.red}❌ Key file not accessible at ${KEY_LOCATION}${colors.reset}`);
      console.log(`${colors.yellow}   Make sure the file exists and is deployed.${colors.reset}\n`);
      process.exit(1);
    }
    console.log(`${colors.green}✅ Key file verified${colors.reset}\n`);
    
    // Fetch sitemap URLs
    const urls = await fetchSitemap();

    // With --previous, submit only URLs that were not in the last submitted sitemap
    let toSubmit = urls;
    if (!all && previousPath && existsSync(previousPath)) {
      const previous = new Set<string>(JSON.parse(readFileSync(previousPath, 'utf8')));
      toSubmit = urls.filter((url) => !previous.has(url));
      console.log(`${colors.cyan}${toSubmit.length} new URLs since ${previousPath}${colors.reset}\n`);
    } else if (!all) {
      toSubmit = [];
      console.log(`${colors.yellow}No ${previousPath}; submitting nothing (pass --all to submit every URL)${colors.reset}\n`);
    }

    // Submit to IndexNow
    if (toSubmit.length > 0 && !(await submitToIndexNow(toSubmit))) {
      process.exit(1);
    }
    if (savePath) {
      writeFileSync(savePath, JSON.stringify(urls));
      console.log(`${colors.green}✅ Saved ${urls.length} URLs to ${savePath}${colors.reset}`);
    }
    
    console.log(`\n${colors.green}═══════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.green}   ✅ IndexNow submission complete!${colors.reset}`);
    console.log(`${colors.green}═══════════════════════════════════════════${colors.reset}\n`);
    
    console.log(`${colors.cyan}Next steps:${colors.reset}`);
    console.log(`1. URLs will be crawled by Bing/Yandex within minutes to hours`);
    console.log(`2. Check Bing Webmaster Tools for indexing status`);
    console.log(`3. Let the deploy workflow submit new pages; avoid --all\n`);
    
  } catch (error) {
    console.error(`\n${colors.red}❌ Error: ${error}${colors.reset}\n`);
    process.exit(1);
  }
}

main();

