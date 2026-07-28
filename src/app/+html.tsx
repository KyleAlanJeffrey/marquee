import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// The static HTML shell wrapped around every prerendered web route. Native
// ignores this file entirely.
//
// SEO happens in three layers:
//   1. these defaults, present in every exported page;
//   2. per-route <PageMeta> (src/components/page-meta.web.tsx) — refines the
//      title/description client-side and in the static export;
//   3. worker/src/seo.ts — rewrites the tags below (and appends JSON-LD) on the
//      way out, so crawlers get real per-event/artist/venue metadata for URLs
//      the SPA can only fill in with JavaScript.

const NAME = 'Marquee';
const TITLE = 'Marquee — Find concerts near you';
const DESCRIPTION =
  'Marquee is a live music radar: discover upcoming concerts near you, follow the artists you love, and get a reminder before their next nearby show.';
const KEYWORDS = [
  'concerts near me',
  'live music near me',
  'upcoming concerts',
  'concert finder',
  'tour dates',
  'shows near me tonight',
  'gigs near me',
  'concert calendar',
  'music venues near me',
  'local live music',
].join(', ');

/** Injected as-is; the Worker swaps in a per-page graph on detail routes. */
const WEBSITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: NAME,
  description: DESCRIPTION,
  applicationCategory: 'EntertainmentApplication',
  inLanguage: 'en',
};

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        {/* description / og:title / og:description / twitter:{title,description}
            are owned by <PageMeta /> so each route gets its own copy. */}
        <meta name="keywords" content={KEYWORDS} />
        <meta name="author" content="Kyle Jeffrey" />
        <meta name="robots" content="index, follow, max-image-preview:large" />
        {/* Rewritten to the absolute request URL by the Worker. */}
        <link rel="canonical" href="/" />

        <meta property="og:site_name" content={NAME} />
        <meta property="og:type" content="website" />
        <meta property="og:locale" content="en_US" />
        {/* Relative here, absolutized by the Worker (crawlers need a full URL). */}
        <meta property="og:url" content="/" />
        <meta property="og:image" content="/og-image.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content={TITLE} />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="/og-image.png" />

        <meta name="theme-color" content="#0e0e0e" />
        <meta name="color-scheme" content="dark" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content={NAME} />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />

        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_JSON_LD) }} />

        {/* Required for a full-screen react-native-web root ScrollView. */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
