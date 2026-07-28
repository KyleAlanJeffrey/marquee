export const SITE_NAME = 'Marquee';
export const SITE_TITLE = 'Marquee — Find concerts near you';
export const SITE_DESCRIPTION =
  'Marquee is a live music radar: discover upcoming concerts near you, follow the artists you love, and get a reminder before their next nearby show.';

/** No-op on native — document metadata is a web concern (see page-meta.web.tsx). */
export function PageMeta(_: { title?: string; description?: string }) {
  return null;
}
