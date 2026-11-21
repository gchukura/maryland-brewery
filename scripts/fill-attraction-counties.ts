/**
 * Set maryland_attractions.county from the Census county polygon that contains each point.
 *
 *   npm run data:attraction-counties             # report only
 *   npm run data:attraction-counties -- --apply  # write
 *
 * Needs scripts/output/census/maryland-counties.geojson (`npm run map:counties` writes it).
 * Names match breweries.county ("Baltimore" is the county, "Baltimore City" the city). A point that
 * falls just outside every polygon (piers, islands, shoreline: the Census file is clipped to the
 * coast) gets the nearest county within 2 km; anything farther is outside Maryland and gets null.
 * The report is also written to scripts/output/attraction-counties-report.md.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { getAdminClient } from '@/lib/db/client';

const GEOJSON = 'scripts/output/census/maryland-counties.geojson';
const REPORT = 'scripts/output/attraction-counties-report.md';
const SNAP_METERS = 2000;
const PAGE = 1000;
const UPDATE_CHUNK = 200;

type Ring = [number, number][];
type County = { name: string; polygons: Ring[][] };
type Row = { id: string; name: string; city: string | null; county: string | null; latitude: number; longitude: number };

function loadCounties(): County[] {
  if (!existsSync(GEOJSON)) throw new Error(`${GEOJSON} is missing; run npm run map:counties`);
  const fc = JSON.parse(readFileSync(GEOJSON, 'utf8')) as {
    features: {
      properties: { NAME: string; NAMELSAD: string };
      geometry: { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };
    }[];
  };
  return fc.features.map((f) => ({
    name: f.properties.NAMELSAD === 'Baltimore city' ? 'Baltimore City' : f.properties.NAME,
    polygons: f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates,
  }));
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inCounty(lng: number, lat: number, c: County): boolean {
  // first ring is the outer boundary, the rest are holes
  return c.polygons.some((rings) => inRing(lng, lat, rings[0]) && !rings.slice(1).some((h) => inRing(lng, lat, h)));
}

/** Meters from a point to the nearest edge of a county (equirectangular; fine at this scale). */
function distanceToCounty(lng: number, lat: number, c: County): number {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110_574;
  let best = Infinity;
  for (const rings of c.polygons) {
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const ax = (ring[i - 1][0] - lng) * kx, ay = (ring[i - 1][1] - lat) * ky;
        const bx = (ring[i][0] - lng) * kx, by = (ring[i][1] - lat) * ky;
        const dx = bx - ax, dy = by - ay;
        const len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
      }
    }
  }
  return best;
}

function countyFor(lng: number, lat: number, counties: County[]): { county: string | null; snapped: boolean } {
  const hit = counties.find((c) => inCounty(lng, lat, c));
  if (hit) return { county: hit.name, snapped: false };
  let best: { name: string; d: number } | null = null;
  for (const c of counties) {
    const d = distanceToCounty(lng, lat, c);
    if (!best || d < best.d) best = { name: c.name, d };
  }
  return best && best.d <= SNAP_METERS ? { county: best.name, snapped: true } : { county: null, snapped: false };
}

async function fetchRows(): Promise<Row[]> {
  const db = getAdminClient();
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('maryland_attractions')
      .select('id, name, city, county, latitude, longitude')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) return rows;
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const counties = loadCounties();
  const rows = await fetchRows();

  const changes: { row: Row; county: string | null; snapped: boolean }[] = [];
  let snapped = 0;
  let outside = 0;
  for (const row of rows) {
    const r = countyFor(row.longitude, row.latitude, counties);
    if (r.snapped) snapped++;
    if (!r.county) outside++;
    if (r.county !== row.county) changes.push({ row, ...r });
  }

  const lines = [
    `# Attraction counties`,
    ``,
    `${rows.length} rows; ${rows.length - outside} in a county (${snapped} snapped within ${SNAP_METERS} m), ${outside} outside Maryland.`,
    `${changes.length} rows change.`,
    ``,
    `| Name | City | Was | Now |`,
    `|---|---|---|---|`,
    ...changes.map(
      (c) => `| ${c.row.name.replace(/\|/g, '/')} | ${c.row.city ?? ''} | ${c.row.county ?? '–'} | ${c.county ?? '–'}${c.snapped ? ' (snapped)' : ''} |`,
    ),
  ];
  mkdirSync('scripts/output', { recursive: true });
  writeFileSync(REPORT, lines.join('\n') + '\n');
  console.log(lines.slice(0, 4).join('\n'));
  console.log(`Report: ${REPORT}`);

  if (!apply) {
    console.log('Report only; pass --apply to write.');
    return;
  }

  const byCounty = new Map<string | null, string[]>();
  for (const c of changes) byCounty.set(c.county, [...(byCounty.get(c.county) ?? []), c.row.id]);
  const db = getAdminClient();
  for (const [county, ids] of byCounty) {
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      const { error } = await db
        .from('maryland_attractions')
        .update({ county })
        .in('id', ids.slice(i, i + UPDATE_CHUNK));
      if (error) throw error;
    }
  }
  console.log(`Updated ${changes.length} rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
