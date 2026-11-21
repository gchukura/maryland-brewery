import type { NextConfig } from "next";

// Brewery photos and logos are served from this project's public Storage bucket
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  // The homepage reads the county map SVG at render time (also during revalidation on Vercel)
  outputFileTracingIncludes: {
    '/': ['./src/components/home/maryland-counties.svg'],
  },
  experimental: {
    staticGenerationRetryCount: 1, // Reduced from 3 to speed up builds
    largePageDataBytes: 512 * 1024, // 512KB (default is 128KB, but allow for larger pages)
    optimizePackageImports: ['lucide-react', '@vis.gl/react-google-maps', '@googlemaps/markerclusterer'],
  },
  images: {
    remotePatterns: [
      ...(supabaseHost
        ? [{ protocol: 'https' as const, hostname: supabaseHost, pathname: '/storage/v1/object/public/**' }]
        : []),
      // Google Places photos (breweries.photo_url). Allowed, but canOptimizeImage() keeps them a plain <img>:
      // they carry the domain-restricted browser key, so the server-side fetch would get a 403
      { protocol: 'https', hostname: 'maps.googleapis.com' },
    ],
    formats: ['image/webp', 'image/avif'],
  },
  async redirects() {
    return [
      // Redirect old amenity URLs to new format
      {
        source: '/breweries/amenity/:path*',
        destination: '/amenities/:path*',
        permanent: true,
      },
      // Redirect old type URLs to new format
      {
        source: '/breweries/type/:path*',
        destination: '/type/:path*',
        permanent: true,
      },
      // Redirect /features to /amenities (permanent - features index doesn't exist)
      {
        source: '/features',
        destination: '/amenities',
        permanent: true,
      },
      // Redirect /types to /type (permanent - types index doesn't exist)
      {
        source: '/types',
        destination: '/type',
        permanent: true,
      },
      // Redirect singular to plural for consistency
      {
        source: '/city',
        destination: '/cities',
        permanent: true,
      },
      {
        source: '/city/:path*',
        destination: '/cities/:path*',
        permanent: true,
      },
      {
        source: '/county',
        destination: '/counties',
        permanent: true,
      },
      {
        source: '/county/:path*',
        destination: '/counties/:path*',
        permanent: true,
      },
      // No blog until posts exist. Temporary, so /blog can come back without stale permanent redirects
      {
        source: '/blog',
        destination: '/',
        permanent: false,
      },
    ];
  },
  // Security headers live only here (not in vercel.json)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
          {
            // geolocation=(self) so the planned "Near me" feature can ask for location
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self)',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
