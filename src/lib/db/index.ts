/**
 * Data layer: the only place that talks to Supabase.
 * Pages and components import from '@/lib/db', never from the client directly.
 * server-only makes importing this from a client component a build error. It lives here,
 * not in client.ts, because scripts import the files directly and run outside Next.
 */
import 'server-only';

// The clients stay private to this folder; the generated row types are public: Tables<'breweries'> etc.
export type { Tables } from './client';
export * from './queries';
export * from './attractions';
export * from './brewery-data';
