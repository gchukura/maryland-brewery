'use client';

import dynamic from 'next/dynamic';

/** BreweryMap without server rendering: the Maps script loads only where a map is shown. */
const BreweryMapLazy = dynamic(() => import('./BreweryMap'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse bg-map" aria-hidden="true" />
  ),
});

export default BreweryMapLazy;
export type { MapLandmark, MapPoint } from './BreweryMap';
