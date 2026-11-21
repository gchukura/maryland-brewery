import Link from 'next/link';
import {
  Clapperboard,
  Dices,
  FerrisWheel,
  Fish,
  Landmark,
  MapPin,
  Palette,
  PawPrint,
  Tent,
  Trees,
  Trophy,
  University,
  type LucideIcon,
} from 'lucide-react';
import type { PlaceType } from '@/lib/attractions';

const ICONS: Record<string, LucideIcon> = {
  park: Trees,
  museum: University,
  tourist_attraction: Landmark,
  art_gallery: Palette,
  cinema_theater: Clapperboard,
  bowling_games: Dices,
  amusement_park: FerrisWheel,
  campground: Tent,
  zoo: PawPrint,
  stadium: Trophy,
  casino: Dices,
  aquarium: Fish,
};

/** How many places a card lists before linking to the type page. */
export const TYPE_CARD_TOP = 6;

interface TypeCardProps {
  type: PlaceType;
  count: number;
  /** Most visited first (Google review counts); empty when the type has none */
  top: { name: string; slug: string; city: string | null }[];
}

const linkRow =
  'flex min-h-11 items-center gap-3 border-t border-line py-2 text-[15px] text-ink hover:text-brand-red';

/** One type on the /near hub: icon, name and count, the most visited places, a link to the type page. */
export default function TypeCard({ type, count, top }: TypeCardProps) {
  const Icon = ICONS[type.category] ?? MapPin;
  const href = `/near/${type.slug}`;
  const all = count <= TYPE_CARD_TOP;
  const plural = type.title.toLowerCase();
  return (
    // id: the old /near#museums anchors land on this card (HashRedirect then opens the type page)
    <article id={type.slug} className="flex h-full scroll-mt-6 flex-col rounded-card border border-line bg-white p-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream" aria-hidden="true">
          <Icon className="h-5 w-5 text-ink" />
        </span>
        <h3 className="m-0 min-w-0 flex-1 font-display text-[22px] font-bold leading-tight text-ink">
          <Link href={href} className="text-ink hover:text-brand-red">
            {type.title}
          </Link>
        </h3>
        <span className="shrink-0 text-sm text-muted">
          {count} {count === 1 ? 'place' : 'places'}
        </span>
      </div>
      {top.length > 0 ? (
        <ol className="m-0 flex list-none flex-col p-0" aria-label={`Most visited ${plural}`}>
          {top.map((p, i) => (
            <li key={p.slug}>
              <Link href={`/near/${p.slug}`} className={linkRow}>
                <span className="w-5 shrink-0 text-sm tabular-nums text-muted" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">{p.name}</span>
                {p.city && <span className="shrink-0 text-xs text-muted">{p.city}</span>}
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="m-0 text-[15px] leading-[1.55] text-muted">{type.description}</p>
      )}
      <div className="mt-auto pt-3">
        {all && top.length > 0 ? (
          <p className="m-0 flex min-h-11 items-center text-sm text-muted">Showing all {count}</p>
        ) : (
          <Link href={href} className="inline-flex min-h-11 items-center font-semibold text-brand-red hover:text-brand-red-dark">
            {top.length > 0 ? `All ${count} ${plural} →` : `Browse all ${count} A to Z →`}
          </Link>
        )}
      </div>
    </article>
  );
}
