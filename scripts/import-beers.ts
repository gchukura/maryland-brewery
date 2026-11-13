/**
 * Import beers from a CSV (the beers tab of the data sheet: File > Download > CSV).
 *
 *   npm run data:beers -- path/to/beers.csv           # report only
 *   npm run data:beers -- path/to/beers.csv --apply   # write
 *
 * Columns: brewery_id, beer_name, beer_style, beer_abv, beer_availability (name, style, abv and
 * availability also work). For every brewery in the file, its beers in Supabase are replaced by
 * the file's; breweries not in the file keep theirs. Rows for unknown brewery ids, without a name,
 * or repeating a beer are left out. ABV that isn't a number ("TBD") and "Unknown" availability are
 * stored empty, because the brewery page shows ABV with a "%".
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync } from 'fs';
import { getAdminClient } from '@/lib/db/client';
import { beersFromCsv } from './lib/beers-csv';

const CHUNK = 500;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file)
    throw new Error('Usage: npm run data:beers -- path/to/beers.csv [--apply]');

  const {
    beers: parsed,
    skipped,
    unknownAbv,
  } = beersFromCsv(readFileSync(file, 'utf8'));
  const db = getAdminClient();
  const { data: breweries, error } = await db
    .from('breweries')
    .select('id, slug');
  if (error) throw error;
  const slugs = new Map(breweries.map((b) => [b.id, b.slug]));

  const unknownIds = new Map<string, number>();
  const beers = parsed.filter((b) => {
    if (slugs.has(b.brewery_id)) return true;
    unknownIds.set(b.brewery_id, (unknownIds.get(b.brewery_id) ?? 0) + 1);
    return false;
  });
  const breweryIds = [...new Set(beers.map((b) => b.brewery_id))];

  const existing: Array<{ id: string; brewery_id: string; name: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await db
      .from('beers')
      .select('id, brewery_id, name')
      .order('id')
      .range(from, from + 999);
    if (e) throw e;
    existing.push(...data);
    if (data.length < 1000) break;
  }
  const key = (b: { brewery_id: string; name: string }) =>
    `${b.brewery_id}|${b.name.trim().toLowerCase()}`;
  const inFile = new Set(beers.map(key));
  const replaced = existing.filter((b) => breweryIds.includes(b.brewery_id));
  const before = new Set(replaced.map(key));
  const added = beers.filter((b) => !before.has(key(b))).length;
  const removed = replaced.filter((b) => !inFile.has(key(b)));

  for (const line of skipped) console.log(`Skipped ${line}`);
  for (const [id, n] of unknownIds)
    console.log(`Skipped ${n} beer(s) for brewery_id ${id}: no such brewery`);
  if (removed.length)
    console.log(
      `Not in the file, will be removed:\n  ${removed.map((b) => `${slugs.get(b.brewery_id)}: ${b.name}`).join('\n  ')}`
    );
  console.log(
    `\n${beers.length} beers for ${breweryIds.length} breweries: ${added} new, ${beers.length - added} already there, ${removed.length} removed. ${unknownAbv} with a non-numeric ABV stored empty.`
  );
  if (!apply) {
    console.log('Report only. Add --apply to write.');
    return;
  }

  for (let i = 0; i < breweryIds.length; i += CHUNK) {
    const { error: e } = await db
      .from('beers')
      .delete()
      .in('brewery_id', breweryIds.slice(i, i + CHUNK));
    if (e) throw e;
  }
  for (let i = 0; i < beers.length; i += CHUNK) {
    const { error: e } = await db
      .from('beers')
      .insert(beers.slice(i, i + CHUNK));
    if (e) throw e;
  }
  console.log(
    `Wrote ${beers.length} beers. Run the Sync workflow (.github/workflows/sync.yml) to refresh the site.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
