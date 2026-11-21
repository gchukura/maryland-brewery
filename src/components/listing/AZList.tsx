'use client';

/**
 * An A-to-Z list of links (the /near type pages, /breweries). Every group and link is shown and in
 * the HTML, so each item is one click from the page; the letter bar jumps to anchors and the
 * search box filters by name.
 */
import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';

export interface AZPlace {
  name: string;
  slug: string;
  city: string | null;
}

interface AZListProps {
  groups: { letter: string; items: AZPlace[] }[];
  letters: string[];
  /** "museums", for the search label */
  noun: string;
  /** Links go to `${basePath}${slug}` */
  basePath?: string;
}

const anchor = (letter: string) => `letter-${letter === '#' ? 'num' : letter.toLowerCase()}`;

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export default function AZList({ groups, letters, noun, basePath = '/near/' }: AZListProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const q = fold(query.trim());

  const shown = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        matches: q ? g.items.filter((p) => fold(p.name).includes(q)) : g.items,
      })),
    [groups, q]
  );
  const matchCount = shown.reduce((n, g) => n + g.matches.length, 0);
  const present = new Set(groups.map((g) => g.letter));

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Jump to a letter">
        <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
          {letters.map((l) =>
            present.has(l) ? (
              <li key={l}>
                <a
                  href={`#${anchor(l)}`}
                  className="flex h-11 min-w-11 items-center justify-center rounded-control px-2 text-[15px] font-semibold text-brand-red hover:bg-cream hover:text-brand-red-dark"
                >
                  {l}
                </a>
              </li>
            ) : (
              <li key={l}>
                <span
                  aria-disabled="true"
                  className="flex h-11 min-w-11 items-center justify-center px-2 text-[15px] text-muted/50"
                >
                  {l}
                </span>
              </li>
            )
          )}
        </ul>
      </nav>

      <div className="relative flex h-12 max-w-md items-center gap-3 rounded-control border-[1.5px] border-line-strong bg-white px-3.5 focus-within:border-ink">
        <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        <label htmlFor={`${id}-q`} className="sr-only">
          Filter {noun} by name
        </label>
        <input
          id={`${id}-q`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${noun} by name`}
          className="h-full min-w-0 flex-1 border-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
        />
      </div>
      <p aria-live="polite" className="m-0 text-[13px] text-muted">
        {q ? (matchCount === 0 ? `No ${noun} match “${query.trim()}”.` : `${matchCount} matching “${query.trim()}”`) : ''}
      </p>

      <div className="columns-1 gap-8 sm:columns-2 lg:columns-3">
        {shown.map((g) => {
          return (
            <section
              key={g.letter}
              id={anchor(g.letter)}
              aria-labelledby={`${anchor(g.letter)}-h`}
              hidden={q !== '' && g.matches.length === 0}
              className="mb-6 scroll-mt-6 break-inside-avoid"
            >
              <h3 id={`${anchor(g.letter)}-h`} className="m-0 mb-1 font-display text-xl font-semibold text-ink">
                {g.letter}
              </h3>
              <ul className="m-0 flex list-none flex-col p-0">
                {g.items.map((p) => {
                  const match = !q || g.matches.includes(p);
                  return (
                    <li key={p.slug} hidden={!match}>
                      <Link
                        href={`${basePath}${p.slug}`}
                        className="flex min-h-11 items-center gap-2 border-b border-line py-1.5 text-[15px] text-ink hover:text-brand-red"
                      >
                        <span className="min-w-0 flex-1">{p.name}</span>
                        {p.city && <span className="shrink-0 text-xs text-muted">{p.city}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
