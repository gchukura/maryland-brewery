/**
 * Fill blank brewery fields from Google Place Details, using each brewery's stored place_id, and
 * report where our filled fields differ from Google's.
 *
 *   npm run data:places                                   # report only
 *   npm run data:places -- --apply                        # write the fills
 *   npm run data:places -- --apply --overwrite            # also replace differing values with Google's
 *   npm run data:places -- --apply --relink               # also fix wrong and missing place_ids
 *
 * Fills blank hours, website, phone and street. Filled values that differ from Google's
 * (coordinates more than 0.1 mi off, other hours, website host, phone or street) are only reported
 * unless --overwrite, because Google can be the stale one. A place whose name doesn't match the
 * brewery's (and doesn't share its website), or that is more than 1 mi from our coordinates (another
 * location of the same brewery), is treated as a wrong place_id: nothing from it is used. --relink
 * searches Google for those breweries and for ones without a place_id, saves the nearest result
 * whose name matches within 25 mi, and otherwise clears the wrong place_id (it drives the
 * Directions link). Hours written from Google are marked verified. Breweries Google lists as closed
 * are reported and left alone. The report is also written to scripts/output/places-report.md.
 * Needs the server key (GOOGLE_MAPS_API_KEY; `npm run google:check`).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { mkdirSync, writeFileSync } from 'fs';
import { getAdminClient } from '@/lib/db/client';
import { explainGoogleStatus, googleServerKey } from './lib/google';
import {
  compareWithPlace,
  pickCandidate,
  PLACE_FIELDS,
  type Candidate,
  type Fill,
  type Overwrite,
  type PlaceResult,
  type StoredBrewery,
} from './lib/places-fill';

const CONCURRENCY = 6;
const REPORT = 'scripts/output/places-report.md';

interface GoogleResponse<T> {
  status: string;
  error_message?: string;
  result?: T;
  results?: T[];
}

interface Outcome {
  fill: Fill;
  overwrite: Overwrite;
  differences: string[];
  otherBusiness?: string;
  note?: string;
}

/** A place_id change: a new place, or null when no search result is this brewery. */
interface Relink {
  placeId: string | null;
  label: string;
}

const EMPTY = { fill: {}, overwrite: {}, differences: [] };

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const overwrite = args.includes('--overwrite');
  const relink = args.includes('--relink');
  const key = googleServerKey();
  const db = getAdminClient();
  const { data, error } = await db
    .from('breweries')
    .select(
      'id, slug, name, city, latitude, longitude, hours, website, phone, street, place_id'
    )
    .order('slug');
  if (error) throw error;

  let denied: string | null = null;
  async function google<T>(url: string): Promise<GoogleResponse<T> | null> {
    const body = (await (
      await fetch(`${url}&key=${key}`)
    ).json()) as GoogleResponse<T>;
    if (body.status === 'REQUEST_DENIED') {
      denied = explainGoogleStatus(body.status, body.error_message);
      return null;
    }
    return body;
  }

  async function check(b: StoredBrewery, placeId: string) {
    const body = await google<PlaceResult>(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${PLACE_FIELDS}`
    );
    if (!body) return null;
    if (body.status !== 'OK' || !body.result)
      return {
        ...EMPTY,
        note: `Google ${explainGoogleStatus(body.status, body.error_message)}`,
      };
    const business = body.result.business_status;
    if (business && business !== 'OPERATIONAL')
      return { ...EMPTY, note: `Google says ${business}` };
    return compareWithPlace(b, body.result);
  }

  async function eachConcurrently<T>(
    items: T[],
    run: (item: T) => Promise<void>
  ) {
    let i = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (i < items.length && !denied) await run(items[i++]);
      })
    );
    if (denied) throw new Error(`Google refused the key: ${denied}`);
  }

  const outcomes = new Map<string, Outcome>();
  await eachConcurrently(
    data.filter((b) => b.place_id),
    async (b) => {
      const outcome = await check(b, b.place_id!);
      if (outcome) outcomes.set(b.slug, outcome);
    }
  );

  const relinks = new Map<string, Relink>();
  if (relink) {
    const toRelink = data.filter(
      (b) => !b.place_id || outcomes.get(b.slug)?.otherBusiness
    );
    await eachConcurrently(toRelink, async (b) => {
      const body = await google<Candidate>(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(`${b.name}, ${b.city}, MD`)}`
      );
      if (!body) return;
      const found = pickCandidate(b, body.results ?? []);
      if (!found) {
        if (b.place_id)
          relinks.set(b.slug, {
            placeId: null,
            label: `cleared (was "${outcomes.get(b.slug)!.otherBusiness}"; no search result is this brewery)`,
          });
        return;
      }
      relinks.set(b.slug, {
        placeId: found.place_id,
        label: `${found.place_id}: "${found.name}", ${found.formatted_address ?? ''}`,
      });
      const outcome = await check(b, found.place_id);
      if (outcome) outcomes.set(b.slug, outcome);
    });
    for (const slug of relinks.keys())
      if (relinks.get(slug)!.placeId === null) outcomes.delete(slug);
  }

  const entries = [...outcomes].sort(([a], [b]) => a.localeCompare(b));
  const fills = entries.filter(([, o]) => Object.keys(o.fill).length > 0);
  const differing = entries.filter(([, o]) => o.differences.length > 0);
  const others = entries.filter(([, o]) => o.otherBusiness);
  const notes = entries.filter(([, o]) => o.note);
  const noPlace = data
    .filter((b) => !b.place_id && !relinks.get(b.slug)?.placeId)
    .map((b) => b.slug);
  const done = (yes: string, no: string) => (apply ? yes : no);

  const report: string[] = [
    `# Google Places check (${new Date().toISOString()})`,
  ];
  if (relink) {
    report.push(
      `\n## place_id ${done('changed', 'to change')} (${relinks.size})`
    );
    for (const [slug, r] of [...relinks].sort(([a], [b]) => a.localeCompare(b)))
      report.push(`- ${slug}: ${r.label}`);
  }
  report.push(`\n## ${done('Filled', 'Would fill')} (${fills.length})`);
  for (const [slug, o] of fills)
    report.push(
      `- ${slug}: ${Object.entries(o.fill)
        .map(([field, value]) =>
          field === 'hours' ? 'hours' : `${field} = ${value}`
        )
        .join('; ')}`
    );
  report.push(
    `\n## Differs from Google, ${overwrite ? done("replaced with Google's", "would take Google's") : 'not changed'} (${differing.length})`
  );
  for (const [slug, o] of differing)
    report.push(
      `\n### ${slug}\n${o.differences.map((d) => `- ${d}`).join('\n')}`
    );
  if (others.length) {
    report.push(
      `\n## Wrong place_id? Google's place has another name, nothing used (${others.length})`
    );
    for (const [slug, o] of others)
      report.push(`- ${slug}: Google has "${o.otherBusiness}"`);
  }
  if (notes.length) {
    report.push(`\n## Not checked (${notes.length})`);
    for (const [slug, o] of notes) report.push(`- ${slug}: ${o.note}`);
  }
  if (noPlace.length)
    report.push(
      `\n## No place_id (${noPlace.length})\n- ${noPlace.join('\n- ')}`
    );

  const text = report.join('\n') + '\n';
  console.log(text);
  mkdirSync('scripts/output', { recursive: true });
  writeFileSync(REPORT, text);
  console.log(
    `${relink ? `${relinks.size} place_ids to change, ` : ''}${fills.length} to fill, ${differing.length} differ, ${others.length} with another business's place_id, ${notes.length} not checked, ${noPlace.length} without a place_id (of ${data.length}). Report: ${REPORT}`
  );

  if (!apply) {
    console.log(
      "\nReport only. --apply writes the fills; add --overwrite to take Google's values where they differ, --relink to fix place_ids."
    );
    return;
  }
  const now = new Date().toISOString();
  let written = 0;
  for (const b of data) {
    const o = outcomes.get(b.slug);
    const r = relinks.get(b.slug);
    const update = {
      ...(r ? { place_id: r.placeId } : {}),
      ...o?.fill,
      ...(overwrite ? o?.overwrite : {}),
    };
    if (Object.keys(update).length === 0) continue;
    const { error: e } = await db
      .from('breweries')
      .update(
        'hours' in update ? { ...update, hours_verified_at: now } : update
      )
      .eq('id', b.id);
    if (e) throw new Error(`${b.slug}: ${e.message}`);
    written++;
  }
  console.log(
    `Updated ${written} breweries. Run the Sync workflow (.github/workflows/sync.yml) to refresh the site.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
