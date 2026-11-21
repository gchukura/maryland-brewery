import type { Metadata } from 'next';

export const SITE_URL = 'https://www.marylandbrewery.com';
const SITE_NAME = 'Maryland Brewery';
/** The root layout's title template appends this to every page title. */
export const TITLE_SUFFIX = ' | Maryland Brewery';
const MAX_TITLE_LENGTH = 60; // including TITLE_SUFFIX
/** Longest title used without the suffix (absoluteTitle). */
export const MAX_ABSOLUTE_TITLE_LENGTH = MAX_TITLE_LENGTH;
export const MAX_DESCRIPTION_LENGTH = 155;
/** Bing Webmaster Tools flags shorter descriptions as too short. */
export const MIN_DESCRIPTION_LENGTH = 110;
/** Longest page title that still fits once the suffix is added. */
export const MAX_PAGE_TITLE_LENGTH = MAX_TITLE_LENGTH - TITLE_SUFFIX.length;

const DEFAULT_IMAGE = '/opengraph-image';

function truncateWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).replace(/[\s,;:–-]+$/, '')}…`;
}

/** The first title that fits once the suffix is added; the last one if none does. */
export function pickTitle(candidates: string[]): string {
  return candidates.find((t) => t.length <= MAX_PAGE_TITLE_LENGTH) ?? candidates[candidates.length - 1];
}

/** The first description within the limit; the last one if none is. */
export function pickDescription(candidates: string[]): string {
  return candidates.find((d) => d.length <= MAX_DESCRIPTION_LENGTH) ?? candidates[candidates.length - 1];
}

export interface PageMetaInput {
  /** Page title without the brand; the layout template adds TITLE_SUFFIX. */
  title: string;
  description: string;
  /** Path of the canonical URL, e.g. '/cities/baltimore/breweries'. */
  path: string;
  image?: string;
  /** Keep the page out of search results but let crawlers follow its links. */
  noindex?: boolean;
  /** Use the title as-is, without the template (the homepage). */
  absoluteTitle?: boolean;
}

/**
 * Canonical, Open Graph and Twitter metadata for a page. Titles and descriptions are generated to
 * fit (see page-meta.ts and its test); trimming here is only a last-resort guard.
 */
export function buildMetadata({ title, description, path, image = DEFAULT_IMAGE, noindex, absoluteTitle }: PageMetaInput): Metadata {
  const pageTitle = truncateWords(title, absoluteTitle ? MAX_TITLE_LENGTH : MAX_PAGE_TITLE_LENGTH);
  const fullTitle = absoluteTitle ? pageTitle : `${pageTitle}${TITLE_SUFFIX}`;
  const desc = truncateWords(description, MAX_DESCRIPTION_LENGTH);
  return {
    title: absoluteTitle ? { absolute: pageTitle } : pageTitle,
    description: desc,
    alternates: { canonical: path },
    robots: noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      title: fullTitle,
      description: desc,
      url: `${SITE_URL}${path}`,
      siteName: SITE_NAME,
      type: 'website',
      locale: 'en_US',
      images: [{ url: image, width: 1200, height: 630, alt: pageTitle }],
    },
    twitter: { card: 'summary_large_image', title: fullTitle, description: desc, images: [image] },
  };
}
