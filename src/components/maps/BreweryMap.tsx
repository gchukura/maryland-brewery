'use client';

/**
 * The one Google map: listing pages (many pins, clustering, hover sync with the list) and the
 * brewery page (one pin). Advanced markers need a Map ID (NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID); map
 * styling lives with that Map ID in Google Cloud, not here. Load it through BreweryMapLazy.
 */
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { Landmark } from 'lucide-react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  MarkerClusterer,
  SuperClusterAlgorithm,
  type Renderer,
} from '@googlemaps/markerclusterer';
import type { ListingBrewery } from '@/lib/listing';
import { openStatusLabel } from '@/lib/hours';
import { cn } from '@/lib/utils';
import BreweryPhoto from '@/components/ui/BreweryPhoto';

export interface MapPoint {
  brewery: ListingBrewery;
  open: boolean;
}

/** The place a page is about (an attraction), drawn with its own pin, never clustered. */
export interface MapLandmark {
  name: string;
  latitude: number;
  longitude: number;
}

interface BreweryMapProps {
  /** Every brewery the map can show. Markers stay mounted; filtering only changes `visible`. */
  points: MapPoint[];
  /** Slugs to show (default: all). Unmounting markers on every filter change raced the clusterer. */
  visible?: string[];
  /** Slug of the brewery hovered or focused in the list */
  highlighted?: string | null;
  onHighlight?: (slug: string | null) => void;
  /** One brewery, no clustering or cards (brewery pages) */
  single?: boolean;
  landmark?: MapLandmark | null;
  className?: string;
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID?.trim();
const MARYLAND_CENTER = { lat: 39.0458, lng: -76.6413 };
/** Below this zoom (roughly "the whole state") nearby pins cluster */
const CLUSTER_MAX_ZOOM = 10;

const hasCoords = (p: MapPoint) =>
  p.brewery.latitude !== null && p.brewery.longitude !== null;
const position = (b: ListingBrewery) => ({
  lat: b.latitude as number,
  lng: b.longitude as number,
});

function LandmarkPin() {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-ink bg-paper shadow-[0_2px_6px_rgba(20,20,20,0.35)]">
      <Landmark className="h-5 w-5 text-ink" aria-hidden="true" />
    </div>
  );
}

function Pin({ open, active }: { open: boolean; active: boolean }) {
  return (
    <div
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-full border-2 border-white shadow-[0_2px_6px_rgba(20,20,20,0.35)] transition-transform',
        open ? 'bg-brand-red' : 'bg-ink',
        active && 'scale-125'
      )}
    >
      <span
        className={cn(
          'h-2.5 w-2.5 rounded-full',
          open ? 'bg-gold' : 'bg-white'
        )}
      />
    </div>
  );
}

// Ink disc with the count in gold, sized by count
const clusterRenderer: Renderer = {
  render: ({ count, position: pos }) => {
    const size = count < 10 ? 36 : count < 30 ? 44 : 52;
    const el = document.createElement('div');
    el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:#141414;color:#EAAA00;border:3px solid #FFFDF7;display:flex;align-items:center;justify-content:center;font:600 14px var(--font-inter),system-ui,sans-serif;box-shadow:0 2px 8px rgba(20,20,20,0.35)`;
    el.textContent = String(count);
    return new google.maps.marker.AdvancedMarkerElement({
      position: pos,
      content: el,
      title: `${count} breweries`,
      zIndex: 1000 + count,
    });
  },
};

function Markers({
  points,
  visible,
  highlighted,
  onHighlight,
  single,
  landmark,
}: Required<Pick<BreweryMapProps, 'points'>> &
  Omit<BreweryMapProps, 'className' | 'points'>) {
  const map = useMap();
  const [markers, setMarkers] = useState<
    Record<string, google.maps.marker.AdvancedMarkerElement>
  >({});
  const [selected, setSelected] = useState<string | null>(null);

  const clusterer = useMemo(
    () =>
      map && !single
        ? new MarkerClusterer({
            map,
            algorithm: new SuperClusterAlgorithm({
              maxZoom: CLUSTER_MAX_ZOOM,
              radius: 60,
            }),
            renderer: clusterRenderer,
          })
        : null,
    [map, single]
  );

  const visibleKey = visible ? visible.join('|') : null;
  const shown = useMemo(
    () => (visibleKey === null ? null : new Set(visibleKey.split('|'))),
    [visibleKey]
  );
  const isShown = useCallback(
    (slug: string) => !shown || shown.has(slug),
    [shown]
  );

  // The clusterer gets the visible markers; hidden ones are taken off the map but stay mounted
  useEffect(() => {
    const entries = Object.entries(markers);
    if (clusterer) {
      clusterer.clearMarkers(true);
      for (const [slug, marker] of entries)
        if (!isShown(slug)) marker.map = null;
      clusterer.addMarkers(
        entries.filter(([slug]) => isShown(slug)).map(([, marker]) => marker)
      );
    } else if (map) {
      for (const [slug, marker] of entries)
        marker.map = isShown(slug) ? map : null;
    }
  }, [clusterer, map, markers, isShown]);

  useEffect(() => () => clusterer?.setMap(null), [clusterer]);

  // One stable ref callback per marker. An inline arrow would be a new ref on every render, which
  // React detaches (null) and re-attaches, updating state each time: an endless render loop.
  const refCallbacks = useRef(
    new globalThis.Map<
      string,
      (marker: google.maps.marker.AdvancedMarkerElement | null) => void
    >()
  );
  const markerRef = useCallback((slug: string) => {
    let callback = refCallbacks.current.get(slug);
    if (!callback) {
      callback = (marker) =>
        setMarkers((prev) => {
          if ((marker && prev[slug] === marker) || (!marker && !prev[slug]))
            return prev;
          if (marker) return { ...prev, [slug]: marker };
          const next = { ...prev };
          delete next[slug];
          return next;
        });
      refCallbacks.current.set(slug, callback);
    }
    return callback;
  }, []);

  const landmarkPosition = useMemo(
    () => (landmark ? { lat: landmark.latitude, lng: landmark.longitude } : null),
    [landmark]
  );

  // Frame the visible pins (and the landmark) whenever the set changes (filters)
  const key = points
    .filter((p) => isShown(p.brewery.slug))
    .map((p) => p.brewery.slug)
    .join('|');
  useEffect(() => {
    if (!map || single) return;
    const located = points
      .filter((p) => hasCoords(p) && isShown(p.brewery.slug))
      .map((p) => position(p.brewery));
    if (landmarkPosition) located.push(landmarkPosition);
    if (located.length === 0) return;
    if (located.length === 1) {
      map.setCenter(located[0]);
      map.setZoom(13);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    located.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 48);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key stands for points
  }, [map, key, single, landmarkPosition]);

  // Stable position objects: a new {lat, lng} each render makes the library re-set every marker's
  // position on every render (and a half-initialized map throws on that)
  const positions = useMemo(
    () =>
      new globalThis.Map(
        points
          .filter(hasCoords)
          .map((p) => [p.brewery.slug, position(p.brewery)])
      ),
    [points]
  );

  const selectedPoint =
    selected && isShown(selected)
      ? points.find((p) => p.brewery.slug === selected)
      : undefined;

  return (
    <>
      {landmark && landmarkPosition && (
        <AdvancedMarker position={landmarkPosition} title={landmark.name} zIndex={3000} clickable={false}>
          <LandmarkPin />
        </AdvancedMarker>
      )}
      {points.filter(hasCoords).map(({ brewery, open }) => {
        const active =
          highlighted === brewery.slug || selected === brewery.slug;
        return (
          <AdvancedMarker
            key={brewery.slug}
            ref={markerRef(brewery.slug)}
            position={positions.get(brewery.slug)}
            title={brewery.name}
            zIndex={active ? 2000 : open ? 2 : 1}
            clickable={!single}
            onClick={single ? undefined : () => setSelected(brewery.slug)}
            onMouseEnter={() => onHighlight?.(brewery.slug)}
            onMouseLeave={() => onHighlight?.(null)}
          >
            <Pin open={open} active={active} />
          </AdvancedMarker>
        );
      })}
      {selectedPoint && markers[selectedPoint.brewery.slug] && (
        <InfoWindow
          anchor={markers[selectedPoint.brewery.slug]}
          headerDisabled
          onCloseClick={() => setSelected(null)}
          onClose={() => setSelected(null)}
          minWidth={240}
        >
          <MapCard point={selectedPoint} onClose={() => setSelected(null)} />
        </InfoWindow>
      )}
    </>
  );
}

function MapCard({
  point: { brewery },
  onClose,
}: {
  point: MapPoint;
  onClose: () => void;
}) {
  const status = openStatusLabel(brewery.hours);
  return (
    <div className="relative flex gap-2.5 pr-5 font-sans text-ink">
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-cream">
        <BreweryPhoto
          src={brewery.photo}
          name={brewery.name}
          sizes="56px"
          small
        />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="text-sm font-semibold leading-tight">
          {brewery.name}
        </div>
        <div className="text-xs text-muted">
          {status?.label ?? brewery.city}
        </div>
        <Link
          href={`/breweries/${brewery.slug}`}
          className="text-xs font-semibold text-brand-red hover:text-brand-red-dark"
        >
          View brewery →
        </Link>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-1.5 top-1.5 h-6 w-6 text-muted hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}

// Google calls window.gm_authFailure when it rejects the key (wrong API restrictions, a site that
// isn't allowed, billing). It then draws its own error screen and leaves a half-initialized map
// that throws on every marker update; we swap in the placeholder instead.
// Installed when this module loads (browser only), before any map requests the Maps script.
let authFailed = false;
const authListeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  const w = window as Window & { gm_authFailure?: () => void };
  const previous = w.gm_authFailure;
  w.gm_authFailure = () => {
    authFailed = true;
    authListeners.forEach((listener) => listener());
    previous?.();
  };
}

function subscribeAuthFailure(listener: () => void) {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}

/** True once Google has rejected the API key on this page. */
function useMapAuthFailed(): boolean {
  return useSyncExternalStore(
    subscribeAuthFailure,
    () => authFailed,
    () => false
  );
}

function Unavailable({
  className,
  reason,
}: {
  className?: string;
  reason?: 'auth';
}) {
  const missing = [
    !API_KEY && 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',
    !MAP_ID && 'NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID',
  ]
    .filter(Boolean)
    .join(' and ');
  const hint =
    reason === 'auth'
      ? 'Google rejected the API key: check its API restrictions (Maps JavaScript API) and allowed websites. See the console for the error code.'
      : missing
        ? `Set ${missing} in .env.local.`
        : null;
  return (
    <div
      className={cn(
        'flex h-full min-h-48 items-center justify-center bg-map p-6 text-center text-sm text-muted',
        className
      )}
    >
      <p className="m-0 max-w-xs">
        The map isn&apos;t available right now; the list has every brewery.
        {process.env.NODE_ENV === 'development' && hint && (
          <span className="mt-2 block font-mono text-xs">{hint}</span>
        )}
      </p>
    </div>
  );
}

/** A failing map (blocked key, Google outage) shows the placeholder instead of breaking the page. */
class MapErrorBoundary extends Component<
  { children: ReactNode; className?: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    if (process.env.NODE_ENV === 'development')
      console.error('[BreweryMap]', error);
  }
  render() {
    return this.state.failed ? (
      <Unavailable className={this.props.className} />
    ) : (
      this.props.children
    );
  }
}

export default function BreweryMap({
  points,
  visible,
  highlighted = null,
  onHighlight,
  single = false,
  landmark = null,
  className,
}: BreweryMapProps) {
  const authFailed = useMapAuthFailed();
  if (!API_KEY || !MAP_ID) return <Unavailable className={className} />;
  const first = points.find(hasCoords);
  // The boundary stays mounted when the map is swapped out: unmounting a map whose key Google
  // rejected can throw, and that must land here, not on the app's error page
  return (
    <MapErrorBoundary className={className}>
      {authFailed ? (
        <Unavailable className={className} reason="auth" />
      ) : (
        <div className={cn('h-full w-full bg-map', className)}>
          <APIProvider apiKey={API_KEY}>
            <Map
              mapId={MAP_ID}
              defaultCenter={
                single && first ? position(first.brewery) : MARYLAND_CENTER
              }
              defaultZoom={single ? 14 : 8}
              gestureHandling={single ? 'cooperative' : 'greedy'}
              disableDefaultUI
              zoomControl
              fullscreenControl={!single}
              clickableIcons={false}
              className="h-full w-full"
            >
              <Markers
                points={points}
                visible={visible}
                highlighted={highlighted}
                onHighlight={onHighlight}
                single={single}
                landmark={landmark}
              />
            </Map>
          </APIProvider>
        </div>
      )}
    </MapErrorBoundary>
  );
}
