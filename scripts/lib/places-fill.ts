import { calculateDistance } from '@/lib/geo';
import type { WeeklyHours } from '@/lib/hours';
import { hoursDifferences, hoursFromWeekdayText } from './hours-check';

/** Stored coordinates further than this from Google's are reported. */
const COORDINATE_TOLERANCE_MILES = 0.1;

/** A same-name place further than this from our coordinates is another location (a second taproom). */
const SAME_PLACE_MILES = 1;

/** A search result further than this from the stored coordinates isn't this brewery. */
const CANDIDATE_RADIUS_MILES = 25;

/** The legacy Place Details fields data:places asks for. */
export const PLACE_FIELDS =
  'name,business_status,geometry/location,opening_hours,website,formatted_phone_number,address_components';

export interface PlaceResult {
  name?: string;
  business_status?: string;
  geometry?: { location?: { lat: number; lng: number } };
  opening_hours?: { weekday_text?: string[] };
  website?: string;
  formatted_phone_number?: string;
  address_components?: Array<{ short_name: string; types: string[] }>;
}

export interface StoredBrewery {
  name: string;
  city: string;
  latitude: number;
  longitude: number;
  hours: unknown;
  website: string | null;
  phone: string | null;
  street: string;
}

export interface Fill {
  hours?: WeeklyHours;
  website?: string;
  phone?: string;
  street?: string;
}

/** Google's value for every filled field that differs from it. */
export interface Overwrite extends Fill {
  latitude?: number;
  longitude?: number;
}

export interface Candidate {
  place_id: string;
  name: string;
  formatted_address?: string;
  geometry?: { location?: { lat: number; lng: number } };
}

/** "24 S Wisner St" from Google's address components (short names, as the table stores them). */
export function streetFromComponents(
  components: PlaceResult['address_components']
): string | undefined {
  const part = (type: string) =>
    components?.find((c) => c.types.includes(type))?.short_name;
  const route = part('route');
  if (!route) return undefined;
  const number = part('street_number');
  return number ? `${number} ${route}` : route;
}

const STREET_WORDS: Record<string, string> = {
  street: 'st',
  avenue: 'ave',
  road: 'rd',
  drive: 'dr',
  court: 'ct',
  lane: 'ln',
  boulevard: 'blvd',
  place: 'pl',
  parkway: 'pkwy',
  highway: 'hwy',
  gateway: 'gtwy',
  pike: 'pike',
  circle: 'cir',
  north: 'n',
  south: 's',
  east: 'e',
  west: 'w',
};

function normalizeStreet(street: string): string {
  return street
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_WORDS[w] ?? w)
    .join(' ');
}

/** Same street, ignoring abbreviations and a trailing suite, unit or quadrant on either. */
export function sameStreet(stored: string, google: string): boolean {
  const a = normalizeStreet(stored);
  const b = normalizeStreet(google);
  return a.startsWith(b) || b.startsWith(a);
}

const GENERIC_NAME_WORDS = new Set(
  'the and of at co company llc inc brewing brewery brewers brew works beer ales ale cider meadery winery vineyards vineyard farm farms taproom tap house'.split(
    ' '
  )
);

function nameWords(name: string, skipGeneric = true): string[] {
  return name
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !(skipGeneric && GENERIC_NAME_WORDS.has(w)));
}

/**
 * Whether Google's place looks like this brewery: one name's distinctive words all appear in the
 * other's (ignoring our city, as in "Evolution Craft Brewing Co - Salisbury"). A stored place_id
 * can point at a different business (a neighbor, or whoever took over the building).
 */
export function sameBusiness(ours: string, google: string, city = ''): boolean {
  const cityWords = nameWords(city, false);
  const ourWords = (skipGeneric: boolean) =>
    nameWords(ours, skipGeneric).filter((w) => !cityWords.includes(w));
  const skipGeneric = ourWords(true).length > 0 && nameWords(google).length > 0;
  const a = ourWords(skipGeneric);
  const b = nameWords(google, skipGeneric);
  const within = (x: string[], y: string[]) => x.every((w) => y.includes(w));
  return within(a, b) || within(b, a);
}

function websiteHost(url: string): string {
  try {
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Google's place is this brewery: the names match, or both list the same website. */
function isThisBrewery(brewery: StoredBrewery, place: PlaceResult): boolean {
  if (!place.name || sameBusiness(brewery.name, place.name, brewery.city))
    return true;
  return Boolean(
    brewery.website &&
    place.website &&
    websiteHost(brewery.website) === websiteHost(place.website)
  );
}

/** The nearest text search result that is this brewery, within 25 mi of where we have it. */
export function pickCandidate(
  brewery: StoredBrewery,
  candidates: Candidate[]
): Candidate | undefined {
  const away = (c: Candidate) => {
    const at = c.geometry?.location;
    return at
      ? calculateDistance(brewery.latitude, brewery.longitude, at.lat, at.lng)
      : CANDIDATE_RADIUS_MILES;
  };
  return candidates
    .filter(
      (c) =>
        sameBusiness(brewery.name, c.name, brewery.city) &&
        away(c) <= CANDIDATE_RADIUS_MILES
    )
    .sort((a, b) => away(a) - away(b))[0];
}

function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

function blank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * What Google can fill (our blank fields), how our filled fields differ from Google's, and
 * Google's values for those (`overwrite`, applied only on request: Google can be the stale one).
 */
export function compareWithPlace(
  brewery: StoredBrewery,
  place: PlaceResult
): {
  fill: Fill;
  overwrite: Overwrite;
  differences: string[];
  otherBusiness?: string;
} {
  const fill: Fill = {};
  const overwrite: Overwrite = {};
  const differences: string[] = [];

  if (!isThisBrewery(brewery, place))
    return { fill, overwrite, differences, otherBusiness: place.name };

  const location = place.geometry?.location;
  if (location) {
    const miles = calculateDistance(
      brewery.latitude,
      brewery.longitude,
      location.lat,
      location.lng
    );
    if (miles > SAME_PLACE_MILES)
      return {
        fill,
        overwrite,
        differences,
        otherBusiness: `${place.name}, ${miles.toFixed(1)} mi from our location`,
      };
    if (miles > COORDINATE_TOLERANCE_MILES) {
      overwrite.latitude = location.lat;
      overwrite.longitude = location.lng;
      differences.push(
        `coordinates: we have ${brewery.latitude}, ${brewery.longitude}; Google has ${location.lat}, ${location.lng} (${miles.toFixed(2)} mi apart)`
      );
    }
  }

  const lines = place.opening_hours?.weekday_text;
  if (lines?.length) {
    const google = hoursFromWeekdayText(lines);
    if (blank(brewery.hours)) {
      if (Object.keys(google).length > 0) fill.hours = google;
    } else {
      const diffs = hoursDifferences(brewery.hours as WeeklyHours, google);
      if (diffs.length > 0) overwrite.hours = google;
      for (const d of diffs)
        differences.push(
          `hours ${d.day}: we have "${d.stored}", Google has "${d.google}"`
        );
    }
  }

  if (place.website) {
    if (blank(brewery.website)) fill.website = place.website;
    else if (websiteHost(brewery.website!) !== websiteHost(place.website)) {
      overwrite.website = place.website;
      differences.push(
        `website: we have ${brewery.website}, Google has ${place.website}`
      );
    }
  }

  if (place.formatted_phone_number) {
    if (blank(brewery.phone)) fill.phone = place.formatted_phone_number;
    else if (
      phoneDigits(brewery.phone!) !== phoneDigits(place.formatted_phone_number)
    ) {
      overwrite.phone = place.formatted_phone_number;
      differences.push(
        `phone: we have ${brewery.phone}, Google has ${place.formatted_phone_number}`
      );
    }
  }

  const street = streetFromComponents(place.address_components);
  if (street) {
    if (blank(brewery.street)) fill.street = street;
    else if (/^\d/.test(street) && !sameStreet(brewery.street, street)) {
      overwrite.street = street;
      differences.push(
        `street: we have "${brewery.street}", Google has "${street}"`
      );
    }
  }

  return { fill, overwrite, differences };
}
