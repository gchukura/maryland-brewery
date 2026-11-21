import { Metadata } from 'next';
import { createPageMetadata } from '@/lib/layout-utils';
import ContentPage from '@/components/layout/ContentPage';
import { buttonVariants } from '@/components/ui/button';

export const metadata: Metadata = createPageMetadata({
  title: 'Photo Credits',
  description:
    'Where the photos on MarylandBrewery.com come from, how they are credited and licensed, and how to ask to use an image or report a copyright concern.',
  path: '/photo-credits',
  keywords: ['photo credits', 'image attribution', 'photography'],
});

export default function PhotoCreditsPage() {
  return (
    <ContentPage
      breadcrumbs={[
        { name: 'Home', path: '/' },
        { name: 'Photo Credits', path: '/photo-credits' },
      ]}
      title="Photo Credits"
      intro="Attribution and credits for photography used throughout MarylandBrewery.com."
    >
      <section>
        <h2>Image Attribution</h2>
        <p>
          MarylandBrewery.com uses images from various sources to showcase
          Maryland's craft breweries. We strive to properly attribute all
          photographs and respect the rights of photographers and content
          creators.
        </p>
      </section>

      <section>
        <h3>Image Sources</h3>
        <ul>
          <li>
            <strong>Brewery-Provided Photos:</strong> Many breweries have
            provided their own photos for use on our site
          </li>
          <li>
            <strong>Stock Photography:</strong> Some images are sourced from
            stock photo services with appropriate licenses
          </li>
          <li>
            <strong>Public Domain:</strong> Some images are in the public domain
            or used under Creative Commons licenses
          </li>
          <li>
            <strong>User Contributions:</strong> Photos submitted by users with
            permission for use on our site
          </li>
        </ul>
      </section>

      <section>
        <h3>Using Our Images</h3>
        <p>
          Images on MarylandBrewery.com are protected by copyright. If you wish
          to use any images from our site:
        </p>
        <ul>
          <li>
            Contact us for permission before using images for commercial
            purposes
          </li>
          <li>Provide proper attribution when using images with permission</li>
          <li>
            Respect the rights of original photographers and content creators
          </li>
        </ul>
      </section>

      <section>
        <h3>Copyright Concerns</h3>
        <p>
          If you believe that any image on our site infringes on your copyright,
          please contact us immediately. We take copyright concerns seriously
          and will address them promptly.
        </p>
        <p>When reporting a copyright concern, please include:</p>
        <ul>
          <li>A description of the copyrighted work</li>
          <li>The URL where the image appears on our site</li>
          <li>Your contact information and proof of ownership</li>
        </ul>
      </section>

      <section className="rounded-panel bg-cream p-6">
        <h3>Have Questions?</h3>
        <p>
          For questions about photo credits, image usage, or copyright concerns,
          please contact us.
        </p>
        <a href="/contact" className={buttonVariants()}>
          Contact Us
        </a>
      </section>
    </ContentPage>
  );
}
