import Link from 'next/link';
import {
  breweriesInRegion,
  getPlacesByType,
  getProcessedBreweryData,
  getRegions,
} from '@/lib/db';
import { AMENITIES, amenityPath } from '@/lib/amenities';
import {
  bestBreweriesCityPath,
  hasBestBreweriesPage,
} from '@/lib/best-breweries';
import { typePlural } from '@/lib/seo/page-meta';
import { slugify } from '@/lib/slug';
import FooterAd from '@/components/ads/FooterAd';
import CheckerBand from '@/components/ui/CheckerBand';
import Logo from '@/components/ui/Logo';

interface Column {
  title: string;
  links: { label: string; href: string }[];
}

const BROWSE: Column = {
  title: 'Browse',
  links: [
    { label: 'All breweries', href: '/breweries' },
    { label: 'Brewery map', href: '/map' },
    { label: 'Open now', href: '/open-now' },
    { label: 'Cities', href: '/cities' },
    { label: 'Counties', href: '/counties' },
    { label: 'Neighborhoods', href: '/neighborhoods' },
    { label: 'Things to do', href: '/near' },
    { label: 'Saved breweries', href: '/saved' },
  ],
};

const FOR_BREWERIES: Column = {
  title: 'For breweries',
  links: [
    { label: 'Add a brewery', href: '/add-brewery' },
    { label: 'Featured listings', href: '/become-featured' },
    { label: 'Marketing tips', href: '/marketing-tips' },
    { label: 'Customer reviews', href: '/customer-reviews' },
    { label: 'Review guidelines', href: '/review-guidelines' },
  ],
};

const ABOUT: Column = {
  title: 'About',
  links: [
    { label: 'Our story', href: '/our-story' },
    { label: 'FAQ', href: '/faq' },
    { label: 'Contact', href: '/contact' },
    { label: 'Photo credits', href: '/photo-credits' },
  ],
};

const LEGAL = [
  { label: 'Privacy', href: '/privacy-policy' },
  { label: 'Terms', href: '/terms' },
];

/**
 * Every page links from here to the browse pages: regions, amenities, types and the best-of
 * lists (cities with 5+ breweries), so none of them depends on a single path for internal links.
 * Server component; the ad slot above it is the only client part.
 */
export default async function SiteFooter() {
  const [{ breweries, byCity, types }, regions, placeTypes] = await Promise.all([
    getProcessedBreweryData(),
    getRegions(),
    getPlacesByType(),
  ]);

  const columns: Column[] = [
    BROWSE,
    {
      title: 'Regions',
      links: regions
        .filter((r) => breweriesInRegion(r, breweries).length > 0)
        .map((r) => ({ label: r.name, href: `/region/${r.slug}` })),
    },
    {
      title: 'Amenities',
      links: AMENITIES.map((a) => ({ label: a.label, href: amenityPath(a) })),
    },
    {
      title: 'Brewery types',
      links: types
        .filter((t) => breweries.some((b) => b.type.includes(t)))
        .map((t) => ({ label: typePlural(t), href: `/type/${slugify(t)}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    },
    {
      title: 'Things to do',
      links: [
        { label: 'All things to do', href: '/near' },
        ...placeTypes.map(({ type }) => ({ label: type.title, href: `/near/${type.slug}` })),
      ],
    },
    {
      title: 'Best breweries',
      links: [
        { label: 'Top 50 in Maryland', href: '/best-breweries' },
        ...[...byCity.values()]
          .filter((list) => hasBestBreweriesPage(list.length))
          .map((list) => ({
            label: list[0].city,
            href: bestBreweriesCityPath(slugify(list[0].city), list.length),
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      ],
    },
    FOR_BREWERIES,
    ABOUT,
  ];

  return (
    <>
      <FooterAd />
      <footer className="mt-auto bg-ink text-paper">
        <CheckerBand variant="bottom" />
        <div className="mx-auto flex max-w-[1240px] flex-col gap-10 px-4 pb-10 pt-12 sm:px-6">
          <div className="flex flex-col gap-3">
            <Logo size="sm" tone="paper" />
            <p className="m-0 max-w-[420px] text-sm leading-[1.55] text-paper/70">
              An independent directory of Maryland&apos;s breweries, taprooms,
              cideries and meaderies.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4 lg:grid-cols-8">
            {columns.map((column) => (
              <nav
                key={column.title}
                aria-label={column.title}
                className="flex flex-col gap-2 text-sm"
              >
                <div className="mb-1 font-semibold text-gold">
                  {column.title}
                </div>
                {column.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="text-paper/80 hover:text-gold"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            ))}
          </div>
        </div>
        <div className="border-t border-paper/15">
          <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 px-4 py-5 text-[13px] text-paper/70 sm:px-6">
            <span>© {new Date().getFullYear()} Maryland Brewery</span>
            <ul className="m-0 flex list-none gap-5 p-0">
              {LEGAL.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-paper/70 hover:text-gold"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </footer>
    </>
  );
}
