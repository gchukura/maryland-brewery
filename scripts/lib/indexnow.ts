/** Sitemap state for IndexNow: URL -> lastmod ('' when the sitemap gives none). */
export type UrlState = Record<string, string>;

/** A saved state. Older runs saved a plain URL list, read as URLs with no lastmod. */
export function parseUrlState(json: string): UrlState {
  const saved: unknown = JSON.parse(json);
  if (Array.isArray(saved)) return Object.fromEntries(saved.map((url) => [String(url), '']));
  return saved as UrlState;
}

/**
 * What IndexNow should hear about between two sitemap states: URLs that are new, whose lastmod
 * changed (only when both sides have one), and that left the sitemap (hidden or redirected pages).
 */
export function changedUrls(previous: UrlState, current: UrlState) {
  const added = Object.keys(current).filter((url) => !(url in previous));
  const changed = Object.keys(current).filter(
    (url) => url in previous && previous[url] !== '' && current[url] !== '' && previous[url] !== current[url]
  );
  const removed = Object.keys(previous).filter((url) => !(url in current));
  return { added, changed, removed };
}
