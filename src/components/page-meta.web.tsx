import Head from 'expo-router/head';

export const SITE_NAME = 'Marquee';
export const SITE_TITLE = 'Marquee — Find concerts near you';
export const SITE_DESCRIPTION =
  'Marquee is a live music radar: discover upcoming concerts near you, follow the artists you love, and get a reminder before their next nearby show.';

/** Per-screen document title + description. Feeds the browser tab during
 *  client-side navigation and the prerendered HTML at export time; the Worker
 *  (worker/src/seo.ts) covers crawlers that don't run JavaScript. */
export function PageMeta({ title, description }: { title?: string; description?: string }) {
  const fullTitle = title ? `${title} · ${SITE_NAME}` : SITE_TITLE;
  const desc = description ?? SITE_DESCRIPTION;

  return (
    <Head>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={desc} />
    </Head>
  );
}
