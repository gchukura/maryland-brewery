/** Primary navigation, shared by the header and the phone menu. */
export const PRIMARY_NAV = [
  { label: 'Map', href: '/map' },
  { label: 'Cities', href: '/cities' },
  { label: 'Counties', href: '/counties' },
  { label: 'Open now', href: '/open-now' },
  { label: 'Amenities', href: '/amenities' },
  { label: 'Things to do', href: '/near' },
] as const;

/** A nav item is current on its own page and below it (/cities/frederick/breweries -> Cities). */
export function isCurrent(pathname: string | null, href: string): boolean {
  return !!pathname && (pathname === href || pathname.startsWith(`${href}/`));
}
