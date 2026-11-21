import Link from 'next/link';
import { cn } from '@/lib/utils';
import { amenityForValue, amenityPath } from '@/lib/amenities';

const classes = 'inline-flex items-center rounded-chip bg-cream px-2.5 py-1 font-sans text-xs font-medium text-ink';

/**
 * A small cream pill for one amenity. Links to the amenity page when `link` is set and the value is
 * known. `raw` shows the value as given instead of the amenity's label ("Food" stays "Food").
 */
export default function AmenityChip({ value, link = false, raw = false, className }: { value: string; link?: boolean; raw?: boolean; className?: string }) {
  const amenity = raw ? undefined : amenityForValue(value);
  const label = amenity?.label ?? value;
  if (link && amenity) {
    return (
      <Link href={amenityPath(amenity)} className={cn(classes, 'hover:bg-line', className)}>
        {label}
      </Link>
    );
  }
  return <span className={cn(classes, className)}>{label}</span>;
}
