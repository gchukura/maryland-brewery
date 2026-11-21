import { isListedAttraction } from '@/lib/neighborhoods';
import { distanceMiles, type LatLng } from '@/lib/geo';

/** An attraction page is indexed only if a brewery is within this distance. */
const ATTRACTION_INDEX_RADIUS_MILES = 3;

/**
 * /near/[slug] pages worth indexing under the original rule: real sights (parks, museums,
 * entertainment, Google tourist attractions; not shops or offices) with a brewery within 3 miles.
 * Attraction pages (below) are indexed whatever this says.
 */
export function isIndexableAttraction(
  attraction: { type: string; googleTypes?: string[] },
  nearestBreweryMiles: number | undefined
): boolean {
  return (
    isListedAttraction(attraction) &&
    nearestBreweryMiles !== undefined &&
    nearestBreweryMiles <= ATTRACTION_INDEX_RADIUS_MILES
  );
}

// ---------------------------------------------------------------------------------------------
// Attraction pages: the full /near template (intro, ranked breweries, nearby attractions) for
// attractions the database marks has_pseo_page (eligible, 2+ breweries within 10 miles;
// refresh_attraction_breweries() in supabase/migrations). Other /near pages keep the basic list.

/** Launch threshold: attraction pages need at least this many Google reviews. Lower to add pages. */
export const ATTRACTION_PAGE_MIN_REVIEWS = 500;

export function isAttractionPage(a: { hasPseoPage?: boolean; ratingCount?: number | null }): boolean {
  return a.hasPseoPage === true && (a.ratingCount ?? 0) >= ATTRACTION_PAGE_MIN_REVIEWS;
}

/** More than this many breweries within 10 miles and the page lists only the closest ones. */
const DENSE_AREA_COUNT = 10;
const DENSE_AREA_RADIUS_MILES = 2;
const DENSE_AREA_MIN_LISTED = 5;
/** attraction_breweries holds breweries within this distance. */
const ATTRACTION_PAGE_RADIUS_MILES = 10;

export interface ListedBreweries<T> {
  listed: T[];
  /** How far out the list goes: 10, 2, or the distance of the 5th brewery */
  radiusMiles: number;
  /** all: everything within 10 miles; dense: within 2 miles; nearest: the 5 nearest */
  mode: 'all' | 'dense' | 'nearest';
}

/**
 * Which breweries an attraction page lists. Rows are within 10 miles, nearest first. Up to 10 are
 * all listed; past that (downtown Baltimore has 26) only those within 2 miles, and at least the
 * nearest 5, so neighbouring pages don't all show the same list.
 */
export function listedBreweries<T extends { distanceMiles: number }>(rows: T[]): ListedBreweries<T> {
  if (rows.length <= DENSE_AREA_COUNT) return { listed: rows, radiusMiles: ATTRACTION_PAGE_RADIUS_MILES, mode: 'all' };
  const close = rows.filter((r) => r.distanceMiles <= DENSE_AREA_RADIUS_MILES);
  if (close.length >= DENSE_AREA_MIN_LISTED) return { listed: close, radiusMiles: DENSE_AREA_RADIUS_MILES, mode: 'dense' };
  const listed = rows.slice(0, DENSE_AREA_MIN_LISTED);
  return { listed, radiusMiles: Math.ceil(listed[listed.length - 1].distanceMiles * 10) / 10, mode: 'nearest' };
}

/**
 * The place types on /near, from maryland_attractions.category (derived from Google's types, or set
 * by an override). `slug` is the type page, /near/[slug]; keep it out of attraction slugs.
 */
export interface PlaceType {
  category: string;
  slug: string;
  /** Plural, for headings: "Parks" */
  title: string;
  /** Singular, in sentences: "a park" */
  noun: string;
  /** One line about what's in it (shown when a type has no review counts to rank by) */
  description: string;
}

export const PLACE_TYPES: readonly PlaceType[] = [
  { category: 'park', slug: 'parks', title: 'Parks', noun: 'park', description: 'State, county and city parks, trails, gardens and nature areas.' },
  { category: 'museum', slug: 'museums', title: 'Museums', noun: 'museum', description: 'History, art, science and children\'s museums and historic sites.' },
  { category: 'tourist_attraction', slug: 'landmarks', title: 'Landmarks', noun: 'landmark', description: 'Monuments, lighthouses, historic districts, murals and other sights.' },
  { category: 'art_gallery', slug: 'art-galleries', title: 'Art galleries and studios', noun: 'art gallery', description: 'Galleries, arts centers and open studios.' },
  { category: 'cinema_theater', slug: 'cinemas-theaters-live-music', title: 'Cinemas, theaters and live music', noun: 'venue', description: 'Movie theaters, stages, concert halls and music clubs.' },
  { category: 'bowling_games', slug: 'bowling-games', title: 'Bowling and games', noun: 'games venue', description: 'Bowling alleys, arcades, mini golf and family fun centers.' },
  { category: 'amusement_park', slug: 'amusement-parks', title: 'Amusement parks', noun: 'amusement park', description: 'Rides, water parks, trampoline parks and adventure parks.' },
  { category: 'campground', slug: 'campgrounds', title: 'Campgrounds', noun: 'campground', description: 'Campgrounds, RV parks and camping resorts.' },
  { category: 'zoo', slug: 'zoos-and-farms', title: 'Zoos and farms', noun: 'zoo', description: 'Zoos, wildlife parks and petting farms.' },
  { category: 'stadium', slug: 'stadiums', title: 'Stadiums', noun: 'stadium', description: 'Ballparks, arenas and stadiums.' },
  { category: 'casino', slug: 'casinos', title: 'Casinos and gaming', noun: 'casino', description: 'Casinos, bingo halls and sportsbooks.' },
  { category: 'aquarium', slug: 'aquariums', title: 'Aquariums', noun: 'aquarium', description: 'Public aquariums.' },
];

/** Places with no category we know; normally empty after the cleanup overrides. */
export const OTHER_PLACE_TYPE: PlaceType = {
  category: '',
  slug: 'other-places',
  title: 'Other places',
  noun: 'attraction',
  description: 'Places we haven\'t sorted into a type yet.',
};

const BY_CATEGORY = new Map(PLACE_TYPES.map((t) => [t.category, t]));

export function placeType(category: string | null | undefined): PlaceType {
  return (category && BY_CATEGORY.get(category)) || OTHER_PLACE_TYPE;
}

const BY_SLUG = new Map([...PLACE_TYPES, OTHER_PLACE_TYPE].map((t) => [t.slug, t]));

/** The type whose page is /near/{slug}, if any. */
export function placeTypeBySlug(slug: string): PlaceType | undefined {
  return BY_SLUG.get(slug);
}

/**
 * Type pages and attraction pages share /near/[slug]; a type slug always wins, so no attraction
 * may use one (the import adds a suffix, and such an attraction is left out of /near).
 */
export const RESERVED_PLACE_SLUGS: ReadonlySet<string> = new Set(BY_SLUG.keys());

/** Sort key for A-to-Z lists: lowercase, no accents, no leading "The". */
function azSortKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .trim();
}

/** "A".."Z", or "#" for names that start with a digit or symbol (after a leading "The"). */
export function azLetter(name: string): string {
  const c = azSortKey(name).charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
}

export const AZ_LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

/** Items grouped by first letter ("#" first), each group A to Z, ignoring a leading "The". */
export function azGroups<T extends { name: string }>(items: T[]): { letter: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of [...items].sort((a, b) => azSortKey(a.name).localeCompare(azSortKey(b.name)))) {
    const letter = azLetter(item.name);
    groups.set(letter, [...(groups.get(letter) ?? []), item]);
  }
  return AZ_LETTERS.filter((l) => groups.has(l)).map((letter) => ({ letter, items: groups.get(letter)! }));
}

function categoryNoun(category: string | null | undefined): string {
  return placeType(category).noun;
}

const article = (noun: string) => (/^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`);
const count = (n: number, one = 'brewery', many = 'breweries') => `${n} ${n === 1 ? one : many}`;
/** "0.3 miles", "1 mile", "4.1 miles" */
export const miles = (m: number) => {
  const rounded = Math.round(m * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'mile' : 'miles'}`;
};

export interface IntroInput {
  name: string;
  category: string | null;
  city: string | null;
  within5: number;
  within10: number;
  listed: number;
  radiusMiles: number;
  mode: ListedBreweries<unknown>['mode'];
  nearest: { name: string; distanceMiles: number } | null;
}

/**
 * Two or three sentences about the attraction, from our own fields only (category, city, the
 * brewery counts), never Google's description. The last one says which radius the list uses.
 */
export function attractionIntro(i: IntroInput): string {
  const where = i.city ? ` in ${i.city}` : ' in Maryland';
  const sentences = [`${i.name} is ${article(categoryNoun(i.category))}${where}.`];
  sentences.push(
    i.within5 === i.within10
      ? `There ${i.within10 === 1 ? 'is' : 'are'} ${count(i.within10)} within 5 miles of it.`
      : i.within5 === 0
        ? `There ${i.within10 === 1 ? 'is' : 'are'} ${count(i.within10)} within 10 miles of it, none closer than 5 miles.`
        : `There ${i.within10 === 1 ? 'is' : 'are'} ${count(i.within10)} within 10 miles of it, ${i.within5} of them within 5 miles.`
  );
  const nearest = i.nearest ? `${i.nearest.name}, ${miles(i.nearest.distanceMiles)} away` : null;
  if (i.mode === 'all') {
    if (nearest) sentences.push(`The closest is ${nearest}; all ${i.listed} are listed below, nearest first.`);
  } else if (i.mode === 'dense') {
    sentences.push(`This page lists the ${i.listed} within ${miles(i.radiusMiles)}, nearest first${nearest ? `, starting with ${nearest}` : ''}.`);
  } else {
    sentences.push(`This page lists the ${i.listed} closest, all within ${miles(i.radiusMiles)}${nearest ? `, starting with ${nearest}` : ''}.`);
  }
  return sentences.join(' ');
}

/** The summary line under the h1: "9 breweries within 2 miles · nearest 0.3 mi" */
export function listedSummary(listed: number, radiusMiles: number, nearestMiles: number | undefined): string {
  const nearest = nearestMiles === undefined ? '' : ` · nearest ${miles(nearestMiles)}`;
  return `${count(listed)} within ${miles(radiusMiles)}${nearest}`;
}

/** Badges for a brewery on an attraction page, in this order, only where the field is set. */
export function breweryBadges(b: {
  food?: string | null;
  outdoorSeating?: boolean;
  dogFriendly?: boolean;
  offersTours?: boolean;
  beerToGo?: boolean;
}): string[] {
  const food = b.food?.trim();
  return [
    food ? (/truck/i.test(food) ? 'Food trucks' : 'Food') : null,
    b.outdoorSeating ? 'Outdoor seating' : null,
    b.dogFriendly ? 'Dog friendly' : null,
    b.offersTours ? 'Tours' : null,
    b.beerToGo ? 'Beer to go' : null,
  ].filter((x): x is string => x !== null);
}

/** Radius and size of the "More to do nearby" section. */
const NEARBY_ATTRACTION_MILES = 5;
const NEARBY_ATTRACTION_LIMIT = 6;

/** Other attraction pages within 5 miles, nearest first, at most 6. */
export function nearbyAttractionPages<T extends LatLng & { slug: string }>(
  origin: LatLng & { slug: string },
  pages: T[]
): (T & { distanceMiles: number })[] {
  return pages
    .filter((p) => p.slug !== origin.slug)
    .map((p) => ({ ...p, distanceMiles: distanceMiles(origin, p) }))
    .filter((p) => p.distanceMiles <= NEARBY_ATTRACTION_MILES)
    .sort((a, b) => a.distanceMiles - b.distanceMiles || a.slug.localeCompare(b.slug))
    .slice(0, NEARBY_ATTRACTION_LIMIT);
}

export { categoryNoun };
