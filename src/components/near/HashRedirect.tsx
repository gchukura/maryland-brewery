'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /near used to be one long list with a section per type (/near#museums). Those anchors now open the
 * type's page. Fragments never reach the server, so this runs in the browser; without JavaScript
 * the anchor still lands on the type's card.
 */
export default function HashRedirect({ map }: { map: Record<string, string> }) {
  const router = useRouter();
  useEffect(() => {
    const target = map[decodeURIComponent(window.location.hash.slice(1))];
    if (target) router.replace(target);
  }, [map, router]);
  return null;
}
