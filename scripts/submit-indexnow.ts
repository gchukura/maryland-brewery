/**
 * IndexNow URL submission (Bing, Yandex, Seznam, Naver, Yep; not Google).
 *
 * IndexNow is for URLs that were added, changed or removed. Submitting unchanged pages again and
 * again is what got the earlier automatic run flagged in Bing Webmaster Tools, so a full submission
 * now needs an explicit --all.
 *
 *   npm run indexnow -- --previous last.json --save last.json   # only new, changed and removed URLs
 *   npm run indexnow -- --previous last.json --save last.json --dry-run   # list them, send nothing
 *   npm run indexnow -- --all                                   # every sitemap URL (rarely right)
 *
 * --previous: the URL -> lastmod map saved by the last run. URLs not in it are new; URLs whose
 *             <lastmod> changed are changed; URLs in it but no longer in the sitemap were removed
 *             (hidden or redirected), and are submitted so engines recrawl and drop them.
 *             Without the file (first run, or the artifact expired) this saves a baseline and
 *             submits nothing.
 * --save:     write the current URL -> lastmod map there after a successful run.
 * The production workflow (.github/workflows/indexnow.yml) runs it with both after each deploy.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { changedUrls, parseUrlState, type UrlState } from './lib/indexnow';
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
async function fetchSitemap(): Promise<UrlState> {
  console.log(`${colors.blue}📥 Fetching sitemap from ${SITEMAP_URL}...${colors.reset}`);
  
  const response = await fetch(SITEMAP_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap: ${response.status}`);
  }
  
  const xml = await response.text();
  const parsed: SitemapData = await parseStringPromise(xml);
  
  const state: UrlState = {};
  for (const item of parsed.urlset.url) state[item.loc[0]] = item.lastmod?.[0] ?? '';
  console.log(`${colors.green}✅ Found ${Object.keys(state).length} URLs in sitemap${colors.reset}\n`);

  return state;
}

/**
 * Submit URLs to IndexNow in batches
 */
async function submitToIndexNow(urls: string[]): Promise<boolean> {
  const endpoint = INDEXNOW_ENDPOINTS[0]; // Use main API endpoint
  const batchSize = 10000; // IndexNow allows up to 10,000 URLs per request
  
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
      await new Promise((resolve) => setTimeout(resolve, 1000));
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
    const current = await fetchSitemap();
    const previousPath = flag('--previous');
    const savePath = flag('--save');
    const dryRun = process.argv.includes('--dry-run');

    let toSubmit: string[];
    if (process.argv.includes('--all')) {
      toSubmit = Object.keys(current);
      console.log(`${colors.yellow}--all: submitting every sitemap URL${colors.reset}\n`);
    } else if (previousPath && existsSync(previousPath)) {
      const { added, changed, removed } = changedUrls(parseUrlState(readFileSync(previousPath, 'utf8')), current);
      toSubmit = [...added, ...changed, ...removed];
      console.log(
        `${colors.cyan}Since ${previousPath}: ${added.length} new, ${changed.length} changed, ${removed.length} removed${colors.reset}\n`
      );
      for (const url of toSubmit.slice(0, 20)) console.log(`   ${url}`);
      if (toSubmit.length > 20) console.log(`   … and ${toSubmit.length - 20} more`);
    } else {
      toSubmit = [];
      console.log(
        `${colors.yellow}No previous list${previousPath ? ` at ${previousPath}` : ''}: saving a baseline and submitting nothing (use --all to send everything)${colors.reset}\n`
      );
    }

    if (dryRun) {
      console.log(`\n${colors.yellow}--dry-run: would submit ${toSubmit.length} URLs; nothing sent or saved${colors.reset}`);
      return;
    }
    if (toSubmit.length > 0 && !(await submitToIndexNow(toSubmit))) {
      process.exit(1);
    }
    if (savePath) {
      writeFileSync(savePath, JSON.stringify(current));
      console.log(`${colors.green}✅ Saved ${Object.keys(current).length} URLs to ${savePath}${colors.reset}`);
    }

    console.log(`\n${colors.green}═══════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.green}   ✅ IndexNow submission complete!${colors.reset}`);
    console.log(`${colors.green}═══════════════════════════════════════════${colors.reset}\n`);
    
    console.log(`${colors.cyan}Next steps:${colors.reset}`);
    console.log(`1. URLs will be crawled by Bing/Yandex within minutes to hours`);
    console.log(`2. Check Bing Webmaster Tools for indexing status`);
    console.log(`3. Run this script again after adding new content\n`);
    
  } catch (error) {
    console.error(`\n${colors.red}❌ Error: ${error}${colors.reset}\n`);
    process.exit(1);
  }
}

main();

