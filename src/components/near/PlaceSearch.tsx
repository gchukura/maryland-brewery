'use client';

/**
 * Search every place on /near by name (WAI-ARIA combobox, like the site search). The list loads on
 * first focus from /near-places.json; choosing a place opens its page.
 */
import { useEffect, useId, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Place {
  /** name */ n: string;
  /** slug */ s: string;
  /** type title */ t: string;
  /** city */ c: string;
}

const LIMIT = 8;

let placesPromise: Promise<Place[]> | null = null;
function loadPlaces(): Promise<Place[]> {
  placesPromise ??= fetch('/near-places.json')
    .then((r) => (r.ok ? (r.json() as Promise<Place[]>) : Promise.reject(new Error(String(r.status)))))
    .catch(() => {
      placesPromise = null; // retry on the next focus
      return [];
    });
  return placesPromise;
}

/** Lowercase, no accents or punctuation, no leading "the" */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

/** Names starting with the query first, then names with a word starting with it, then the rest. */
function match(places: Place[], query: string): Place[] {
  const q = fold(query);
  if (!q) return [];
  const scored: [number, Place][] = [];
  for (const p of places) {
    const name = fold(p.n);
    const at = name.indexOf(q);
    if (at < 0) continue;
    scored.push([at === 0 ? 0 : name[at - 1] === ' ' ? 1 : 2, p]);
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].n.localeCompare(b[1].n))
    .slice(0, LIMIT)
    .map(([, p]) => p);
}

export default function PlaceSearch({ className }: { className?: string }) {
  const router = useRouter();
  const id = useId();
  const listId = `${id}-list`;
  const [places, setPlaces] = useState<Place[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const results = useMemo(() => match(places, query), [places, query]);
  const expanded = open && query.trim().length > 0;

  useEffect(() => setActive(-1), [query]);

  const go = (p: Place) => {
    setOpen(false);
    router.push(`/near/${p.s}`);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const pick = results[active >= 0 ? active : 0];
    if (pick) go(pick);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (results.length === 0) return setActive(-1);
      setActive((i) =>
        e.key === 'ArrowDown' ? (i + 1) % results.length : i <= 0 ? results.length - 1 : i - 1
      );
    } else if (e.key === 'Escape') {
      if (expanded) setOpen(false);
      else setQuery('');
      setActive(-1);
    }
  };

  return (
    <form role="search" onSubmit={submit} className={cn('relative max-w-2xl', className)}>
      <div className="relative flex h-14 items-center gap-3 rounded-[12px] border-[1.5px] border-line-strong bg-white px-4 focus-within:border-ink">
        <Search className="h-5 w-5 shrink-0 text-ink" aria-hidden="true" />
        <label htmlFor={`${id}-input`} className="sr-only">
          Search places by name
        </label>
        <input
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          enterKeyHint="go"
          value={query}
          placeholder="Search places, e.g. Fort McHenry"
          onFocus={() => {
            setOpen(true);
            void loadPlaces().then(setPlaces);
          }}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none placeholder:text-muted"
        />
        <ul
          id={listId}
          role="listbox"
          aria-label="Places"
          hidden={!expanded}
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 m-0 max-h-[60vh] list-none overflow-auto rounded-[12px] border border-line bg-white p-1.5 shadow-[0_8px_24px_rgba(20,20,20,0.16)]"
        >
          {results.map((p, i) => (
            <li
              key={p.s}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: keep focus in the input until we navigate
              onMouseDown={(e) => {
                e.preventDefault();
                go(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-3 py-2 text-left',
                i === active ? 'bg-cream' : 'bg-white'
              )}
            >
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">{p.n}</span>
              <span className="shrink-0 text-xs text-muted">{[p.t, p.c].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
          {results.length === 0 && (
            <li role="presentation" className="px-3 py-2.5 text-sm text-muted">
              {places.length === 0 ? 'Loading places…' : `No places match “${query.trim()}”`}
            </li>
          )}
        </ul>
      </div>
    </form>
  );
}
