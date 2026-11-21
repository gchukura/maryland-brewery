import Link from 'next/link';
import type { WeeklyHours } from '@/lib/hours';
import { cn } from '@/lib/utils';
import AmenityChip from './AmenityChip';
import { amenityLabels } from './BreweryCard';
import BreweryPhoto from './BreweryPhoto';
import StatusBadge from './StatusBadge';

/** The fields a row shows (ListingBrewery from lib/listing has them all). */
export interface BreweryListRowData {
  slug: string;
  name: string;
  street: string;
  city: string;
  description?: string | null;
  hours: WeeklyHours;
  amenities: string[];
  photo?: string | null;
  /** Shown instead of the amenity chips (attraction pages) */
  badges?: string[];
}

interface BreweryListRowProps {
  brewery: BreweryListRowData;
  /** Already formatted, e.g. "0.4 mi" */
  distance?: string;
  priority?: boolean;
  /** Highlighted because its map pin is hovered */
  active?: boolean;
  /** Hover or focus on the row (null when it ends), to highlight the pin */
  onHighlight?: (slug: string | null) => void;
  /** Amenity labels to show first (the active filters) */
  preferAmenities?: string[];
  /** Today's hours, already formatted ("Today 12:00 PM – 10:00 PM") */
  today?: string | null;
  className?: string;
}

/** Horizontal listing row (City.html): photo left, name + status, address, description, amenity chips. */
export default function BreweryListRow({
  brewery,
  distance,
  priority,
  active,
  onHighlight,
  preferAmenities,
  today,
  className,
}: BreweryListRowProps) {
  const chips = brewery.badges ?? amenityLabels(brewery.amenities, 4, preferAmenities);
  const meta = [brewery.street, brewery.city, distance]
    .filter(Boolean)
    .join(' · ');
  const highlight = onHighlight ? () => onHighlight(brewery.slug) : undefined;
  const clear = onHighlight ? () => onHighlight(null) : undefined;
  return (
    <Link
      href={`/breweries/${brewery.slug}`}
      onMouseEnter={highlight}
      onMouseLeave={clear}
      onFocus={highlight}
      onBlur={clear}
      className={cn(
        'group grid grid-cols-[112px_minmax(0,1fr)] gap-3.5 rounded-panel border bg-white p-3 text-ink transition-colors hover:border-line-strong hover:text-ink sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-[18px] sm:p-3.5',
        active ? 'border-ink' : 'border-line',
        className
      )}
    >
      <div className="relative aspect-[4/3] self-start overflow-hidden rounded-control bg-cream">
        <BreweryPhoto
          src={brewery.photo}
          name={brewery.name}
          sizes="(max-width: 640px) 112px, 200px"
          priority={priority}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <div className="font-display text-lg font-semibold leading-[1.15] group-hover:text-brand-red sm:text-[22px]">
            {brewery.name}
          </div>
          <StatusBadge hours={brewery.hours} className="shrink-0" />
        </div>
        {meta && <div className="text-sm text-muted">{meta}</div>}
        {today && <div className="text-sm text-ink">{today}</div>}
        {brewery.description && (
          <div className="hidden sm:block">
            <p className="m-0 line-clamp-2 text-sm leading-normal">
              {brewery.description}
            </p>
          </div>
        )}
        {chips.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2">
            {chips.map((label) => (
              <AmenityChip key={label} value={label} raw={!!brewery.badges} />
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
