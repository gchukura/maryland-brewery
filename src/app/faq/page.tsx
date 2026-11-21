import { Metadata } from 'next';
import { createPageMetadata } from '@/lib/layout-utils';
import Link from 'next/link';
import ContentPage from '@/components/layout/ContentPage';
import { buttonVariants } from '@/components/ui/button';

export const metadata: Metadata = createPageMetadata({
  title: 'Frequently Asked Questions',
  description:
    'Answers about the Maryland Brewery directory: finding breweries near you, how accurate hours are, adding or updating a brewery, reviews and photo use.',
  path: '/faq',
  keywords: [
    'Maryland brewery FAQ',
    'brewery questions',
    'craft beer Maryland',
  ],
});

export default function FAQPage() {
  const faqs = [
    {
      question: 'How do I find breweries near me?',
      answer:
        'Use our interactive map at /map to find breweries by location. You can also browse by city or county to discover breweries in specific areas of Maryland.',
    },
    {
      question: 'Are the brewery hours accurate?',
      answer:
        "We strive to keep hours up to date, but brewery hours can change. We recommend calling ahead or checking the brewery's website or social media for the most current hours, especially during holidays or special events.",
    },
    {
      question: 'How do I add or update brewery information?',
      answer:
        'Brewery owners can contact us through our contact form or use the "Add Your Brewery" link in the footer. We welcome updates to keep our directory accurate.',
    },
    {
      question: 'Can I review breweries here?',
      answer:
        'Not on this site. The ratings and review excerpts on brewery pages come from Google reviews, so to review a brewery, leave your review on Google. Our Review Guidelines page has tips for writing a helpful one.',
    },
    {
      question: 'Is this site affiliated with the breweries listed?',
      answer:
        'No, MarylandBrewery.com is an independent directory. We are not affiliated with any of the breweries listed. This site is for information purposes only.',
    },
    {
      question: 'How often is the directory updated?',
      answer:
        'We regularly update our directory with new breweries, closures, and information changes. If you notice outdated information, please contact us.',
    },
    {
      question: 'Do you list all Maryland breweries?',
      answer:
        "We strive to include all craft breweries in Maryland. If you know of a brewery that's not listed, please let us know through our contact form.",
    },
    {
      question: 'Can I use photos from this site?',
      answer:
        'Photos are used with permission or from public sources. Please see our Photo Credits page for attribution information. For commercial use, please contact the original photographers.',
    },
  ];

  return (
    <ContentPage
      breadcrumbs={[
        { name: 'Home', path: '/' },
        { name: 'FAQ', path: '/faq' },
      ]}
      title="Frequently Asked Questions"
      intro="Find answers to common questions about Maryland breweries and using our directory."
    >
      {faqs.map((faq) => (
        <section key={faq.question}>
          <h2>{faq.question}</h2>
          <p>{faq.answer}</p>
        </section>
      ))}

      <section className="mt-10 rounded-panel bg-cream p-6">
        <h3>Still have questions?</h3>
        <p>Can&apos;t find what you&apos;re looking for? Send us a note.</p>
        <Link href="/contact" className={buttonVariants()}>
          Contact us
        </Link>
      </section>
    </ContentPage>
  );
}
