/**
 * Titles and descriptions for every page type. Each tries a few phrasings, longest first, and
 * keeps the first that fits (page-meta.test.ts runs them over real names). Titles never include
 * the brand: the layout template adds " | Maryland Brewery".
 */
import { MAX_PAGE_TITLE_LENGTH, pickDescription, pickTitle } from './metadata';
import { neighborhoodPlace } from '@/lib/neighborhoods';

export interface PageMeta {
  title: string;
  description: string;
}

/**
 * The core of a long venue name: drops "(...)", text after " - " or "/", everything after the
 * first comma, and quotes. "Fort McHenry National Monument and Historic Shrine" is unchanged;
 * "Chesapeake Bay Maritime Museum - NORTH GATE" -> "Chesapeake Bay Maritime Museum".
 */
function shortName(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .split(/\s+[-–—|]\s+|\s*\/\s*|,\s*/)[0]
    .replace(/["“”]/g, '')
    .replace(/[.\s]+$/, '')
    .trim();
}

/** Last resort for a title that still doesn't fit: cut at a word boundary, no ellipsis. */
function clipTitle(text: string): string {
  if (text.length <= MAX_PAGE_TITLE_LENGTH) return text;
  const cut = text.slice(0, MAX_PAGE_TITLE_LENGTH + 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:&–-]+$/, '');
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const breweries = (n: number) => plural(n, 'brewery', 'breweries');
const Breweries = (n: number) => plural(n, 'Brewery', 'Breweries');

/** "Frederick County", but "Baltimore City" stays as is. */
export function countyLabel(county: string): string {
  return /city$/i.test(county) ? county : `${county} County`;
}

/** "Microbrewery" -> "Microbreweries", "Brewpub" -> "Brewpubs", "Contract" -> "Contract Breweries". */
export function typePlural(type: string): string {
  if (/brewery$/i.test(type)) return type.replace(/y$/i, 'ies');
  if (/^(brewpub|taproom)$/i.test(type)) return `${type}s`;
  if (/^alt prop$/i.test(type)) return 'Alternating Proprietorships';
  return `${type} Breweries`;
}

export function breweryMeta(b: { name: string; city: string; type: string[] }): PageMeta {
  const kind = b.type.length > 0 ? b.type.join(' and ').toLowerCase() : 'brewery';
  return {
    title: pickTitle([`${b.name}, ${b.city}, MD`, `${b.name}, ${b.city}`, b.name, `${shortName(b.name)}, ${b.city}`, clipTitle(shortName(b.name))]),
    description: pickDescription([
      `${b.name} is a ${kind} in ${b.city}, Maryland. See its hours, location, beers, amenities and what reviewers mention.`,
      `${b.name} in ${b.city}, Maryland: hours, location, beers, amenities and reviews.`,
      `${b.name}: hours, location, beers and reviews.`,
    ]),
  };
}

export function cityMeta(city: string, count: number): PageMeta {
  return {
    title: pickTitle([`${Breweries(count)} in ${city}, MD`, `Breweries in ${city}, MD`, `${city} Breweries`]),
    description: pickDescription([
      `All ${breweries(count)} in ${city}, Maryland, with hours, a map, amenities and ratings. See which taprooms and brewpubs are open today.`,
      `All ${breweries(count)} in ${city}, Maryland, with hours, a map and ratings.`,
    ]),
  };
}

export function countyMeta(county: string, count: number): PageMeta {
  const label = countyLabel(county);
  return {
    title: pickTitle([`${Breweries(count)} in ${label}, MD`, `Breweries in ${label}, MD`, `${label} Breweries`]),
    description: pickDescription([
      `All ${breweries(count)} in ${label}, Maryland, with hours, a map, amenities and ratings, grouped by town. See which are open today.`,
      `All ${breweries(count)} in ${label}, Maryland, with hours, a map and ratings.`,
    ]),
  };
}

export function regionMeta(region: string, count: number, counties: string[]): PageMeta {
  return {
    title: pickTitle([`${Breweries(count)} in ${region}, MD`, `Breweries in ${region}, MD`, `${region} Breweries`]),
    description: pickDescription([
      `All ${breweries(count)} across ${region}, Maryland (${counties.join(', ')}), with hours, a map, ratings and amenities.`,
      `All ${breweries(count)} across ${region}, Maryland, with hours, a map, ratings and amenities. Filter by amenity and see which are open today.`,
      `All ${breweries(count)} across ${region}, Maryland, with hours, a map, ratings and amenities.`,
    ]),
  };
}

export function amenityMeta(label: string, count: number): PageMeta {
  return {
    title: pickTitle([`${label} Breweries in Maryland`, `${label} Breweries`]),
    description: pickDescription([
      `${breweries(count)} in Maryland with ${label.toLowerCase()}, with hours, locations, a map and ratings. Filter by type and see which are open today.`,
      `${breweries(count)} in Maryland with ${label.toLowerCase()}, with hours, a map and ratings. Filter by type and see which are open today.`,
    ]),
  };
}

export function cityAmenityMeta(label: string, city: string, count: number): PageMeta {
  return {
    title: pickTitle([`${label} Breweries in ${city}, MD`, `${label} Breweries in ${city}`, `${label} in ${city}`]),
    description: pickDescription([
      `${breweries(count)} with ${label.toLowerCase()} in ${city}, Maryland, with hours, a map and ratings. Filter by other amenities and see which are open today.`,
      `${breweries(count)} with ${label.toLowerCase()} in ${city}, Maryland, with hours, a map and ratings. See which are open today.`,
      `${breweries(count)} with ${label.toLowerCase()} in ${city}, Maryland, with hours, a map and ratings.`,
    ]),
  };
}

export function typeMeta(type: string, count: number): PageMeta {
  const name = typePlural(type);
  return {
    title: pickTitle([`${count} ${name} in Maryland`, `${name} in Maryland`, name]),
    description: pickDescription([
      `All ${count} ${name.toLowerCase()} in Maryland, with hours, locations, a map and ratings. Filter by amenity and see which ones are open today.`,
      `All ${count} ${name.toLowerCase()} in Maryland, with hours, a map and ratings. Filter by amenity and see what's open today.`,
      `${name} in Maryland, with hours, a map and ratings. Filter by amenity and see what's open today.`,
    ]),
  };
}

export function bestBreweriesMeta(city: string, count: number): PageMeta {
  return {
    title: pickTitle([`Best Breweries in ${city}, MD`, `Best ${city} Breweries`]),
    description: pickDescription([
      `The ${count} best breweries in ${city}, Maryland, ranked by Google rating and review volume, with the reason for each pick.`,
      `The ${count} best breweries in ${city}, Maryland, ranked by rating and reviews.`,
    ]),
  };
}

export function neighborhoodMeta(neighborhood: string, city: string, count: number): PageMeta {
  const place = neighborhoodPlace(neighborhood, city);
  const short = neighborhoodPlace(shortName(neighborhood), city);
  return {
    title: pickTitle([
      `Breweries near ${place}`,
      `Breweries near ${neighborhood}`,
      `Near ${neighborhood}`,
      `Breweries near ${short}`,
      `Breweries near ${shortName(neighborhood)}`,
      clipTitle(`Near ${shortName(neighborhood)}`),
    ]),
    description: pickDescription(
      place === neighborhood
        ? [
            `${breweries(count)} near ${neighborhood}, Maryland, sorted by distance, with hours and ratings, plus parks and things to do nearby.`,
            `${breweries(count)} near ${neighborhood}, Maryland, sorted by distance, plus parks and things to do nearby.`,
            `${breweries(count)} near ${shortName(neighborhood)}, Maryland, sorted by distance, plus parks and things to do nearby.`,
          ]
        : [
            `${breweries(count)} near ${neighborhood} in ${city}, Maryland, sorted by distance, with hours and ratings, plus parks and things to do nearby.`,
            `${breweries(count)} near ${neighborhood} in ${city}, Maryland, sorted by distance, plus parks and things to do nearby.`,
            `${breweries(count)} near ${shortName(neighborhood)} in ${city}, Maryland, sorted by distance, plus parks and things to do nearby.`,
          ]
    ),
  };
}

export function attractionMeta(attraction: string, city: string | undefined, count: number): PageMeta {
  const where = city ? ` in ${city}, Maryland` : ', Maryland';
  return {
    title: pickTitle([
      `Breweries near ${attraction}`,
      `Near ${attraction}`,
      attraction, // keeps "School Field 123" and "Field 11A" distinct
      `Breweries near ${shortName(attraction)}`,
      `Near ${shortName(attraction)}`,
      clipTitle(attraction),
    ]),
    description: pickDescription([
      `${breweries(count)} within 10 miles of ${attraction}${where}, sorted by distance, with hours, a map and ratings. See which are open today.`,
      `${breweries(count)} within 10 miles of ${attraction}${where}, sorted by distance, with hours and ratings.`,
      `${breweries(count)} within 10 miles of ${attraction}, sorted by distance, with hours and ratings.`,
      `${breweries(count)} within 10 miles of ${shortName(attraction)}${where}, sorted by distance, with hours, a map and ratings.`,
      `${breweries(count)} within 10 miles of ${shortName(attraction)}${where}, sorted by distance.`,
      `${breweries(count)} within 10 miles of ${shortName(attraction)}, sorted by distance.`,
    ]),
  };
}

export function openOnDayMeta(day: string, count: number): PageMeta {
  const Day = day.charAt(0).toUpperCase() + day.slice(1);
  return {
    title: pickTitle([`Breweries Open ${Day} in Maryland`, `Breweries Open ${Day}`]),
    description: pickDescription([
      `${breweries(count)} in Maryland open on ${Day}s, with each one's ${Day} hours, a map and ratings. Filter by amenity or type to plan your ${Day} brewery visit.`,
      `${breweries(count)} in Maryland open on ${Day}s, with each one's ${Day} hours, a map and ratings. Filter by amenity or type to plan a visit.`,
    ]),
  };
}
