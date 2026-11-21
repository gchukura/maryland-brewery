'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bookmark, Home, LayoutGrid, Map } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { label: 'Home', href: '/', icon: Home, match: (p: string) => p === '/' },
  {
    label: 'Map',
    href: '/map',
    icon: Map,
    match: (p: string) => p.startsWith('/map'),
  },
  {
    label: 'Browse',
    href: '/cities',
    icon: LayoutGrid,
    match: (p: string) =>
      /^\/(cities|counties|region|amenities|type|best-breweries|neighborhoods|open|near|breweries$)/.test(
        p
      ),
  },
  {
    label: 'Saved',
    href: '/saved',
    icon: Bookmark,
    match: (p: string) => p.startsWith('/saved'),
  },
];

/** Phone-only tab bar (Mobile.html), fixed to the bottom above the home indicator. */
export default function BottomNav() {
  const pathname = usePathname() ?? '/';
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line-strong bg-white pb-[max(8px,env(safe-area-inset-bottom))] pt-2 md:hidden"
    >
      <ul className="m-0 grid list-none grid-cols-4 p-0">
        {ITEMS.map(({ label, href, icon: Icon, match }) => {
          const current = match(pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'tap flex flex-col items-center gap-1 text-[11px] font-semibold',
                  current ? 'text-brand-red' : 'text-muted'
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
