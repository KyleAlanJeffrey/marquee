// Generator for every shipped brand asset: the app and launcher icons, the PWA
// manifest, and the favicon — all from one vector mark, in the Electric Stage
// palette.
//   node scripts/gen-web-assets.mjs
//
// The 1200x630 Open Graph card is NOT built here. It sets Anybody, and sharp can
// only render fonts installed on the machine, so the card is a real HTML page
// rendered by a browser that can fetch the webfont:
//
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
//     --window-size=1200,630 --virtual-time-budget=6000 \
//     --screenshot=public/og-image.png "file://$PWD/scripts/og-image.html"
//
// Keeping the geometry below identical to src/components/brand-logo.tsx is the
// point of this file: the inline mark in the app and the PNGs on disk are the
// same drawing, so they can't drift when the palette changes.
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const PUBLIC = new URL('../public/', import.meta.url);
const IMAGES = new URL('../assets/images/', import.meta.url);

// sharp wants a path, not a URL, and a URL's pathname is percent-encoded — a
// checkout under a directory with a space in it would send sharp a literal '%20'.
const at = (name, dir) => fileURLToPath(new URL(name, dir));

const CHARCOAL = '#131315';

/** The mark on a 64x64 grid. `mono` flattens it for Android's monochrome layer,
 *  which the launcher tints itself, so only the alpha matters there. */
function mark(mono) {
  const c = mono
    ? { frame: '#ffffff', divider: '#ffffff', b1: '#ffffff', b2: '#ffffff', b3: '#ffffff', b4: '#ffffff' }
    : { frame: 'url(#frame)', divider: '#00dbe9', b1: '#2ae05d', b2: '#2fff6a', b3: '#00dbe9', b4: '#7df4ff' };
  return `
    <rect x="6" y="9" width="52" height="46" rx="15" fill="none" stroke="${c.frame}" stroke-width="3.5"/>
    <line x1="32" y1="13" x2="32" y2="51" stroke="${c.divider}" stroke-width="3" stroke-linecap="round"/>
    <line x1="18.5" y1="26" x2="18.5" y2="40" stroke="${c.b1}" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="25" y1="22" x2="25" y2="44" stroke="${c.b2}" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="39" y1="20" x2="39" y2="46" stroke="${c.b3}" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="45.5" y1="27" x2="45.5" y2="39" stroke="${c.b4}" stroke-width="3.5" stroke-linecap="round"/>`;
}

/**
 * @param size  output px (square)
 * @param scale mark width as a fraction of the canvas
 * @param bg    canvas fill, or null to leave it transparent
 * @param glow  draw a blurred copy behind the mark
 * @param mono  single-colour silhouette
 */
function icon({ size, scale, bg = null, glow = true, mono = false }) {
  const inner = size * scale;
  const off = (size - inner) / 2;
  const body = mark(mono);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="frame" x1="0" y1="0" x2="64" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#2fff6a"/><stop offset="1" stop-color="#00dbe9"/>
    </linearGradient>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="${(inner / 64) * 2.2}"/>
    </filter>
  </defs>
  ${bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ''}
  <g transform="translate(${off} ${off}) scale(${inner / 64})">
    ${glow ? `<g filter="url(#blur)" opacity="0.55">${body}</g>` : ''}
    ${body}
  </g>
</svg>`;
}

await mkdir(PUBLIC, { recursive: true });
await mkdir(IMAGES, { recursive: true });

// Full-bleed icons carry the charcoal ground. The layers that Android and the
// splash screen composite themselves stay transparent, and their mark sits small
// so it clears the adaptive-icon safe zone.
const TARGETS = [
  [PUBLIC, 'icon-192.png', { size: 192, scale: 0.62, bg: CHARCOAL }],
  [PUBLIC, 'icon-512.png', { size: 512, scale: 0.62, bg: CHARCOAL }],
  [PUBLIC, 'apple-touch-icon.png', { size: 180, scale: 0.62, bg: CHARCOAL }],
  [IMAGES, 'icon.png', { size: 1024, scale: 0.62, bg: CHARCOAL }],
  [IMAGES, 'favicon.png', { size: 256, scale: 0.66, bg: CHARCOAL }],
  [IMAGES, 'splash-icon.png', { size: 1024, scale: 0.4 }],
  [IMAGES, 'android-icon-foreground.png', { size: 1024, scale: 0.4 }],
  [IMAGES, 'android-icon-monochrome.png', { size: 1024, scale: 0.4, glow: false, mono: true }],
];

for (const [dir, name, opts] of TARGETS) {
  await sharp(Buffer.from(icon(opts))).png().toFile(at(name, dir));
}

// The adaptive background is a flat plate — a mark here would show through the
// foreground layer.
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: CHARCOAL } })
  .png()
  .toFile(at('android-icon-background.png', IMAGES));

// Kept in step with the committed manifest deliberately: this used to write
// start_url '/' and the old near-black theme colours, so running it would have
// silently reverted both along with the positioning line.
await writeFile(
  new URL('manifest.json', PUBLIC),
  JSON.stringify(
    {
      name: 'Marquee — Find concerts near you',
      short_name: 'Marquee',
      description:
        'Marquee is a live music radar: discover upcoming concerts near you, follow the artists you love, and get a reminder before their next nearby show. No account needed.',
      start_url: '/explore',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: CHARCOAL,
      theme_color: CHARCOAL,
      categories: ['music', 'entertainment', 'events'],
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      ],
    },
    null,
    2,
  ) + '\n',
);

console.log('wrote public/{icon-192,icon-512,apple-touch-icon}.png, public/manifest.json');
console.log('wrote assets/images/{icon,favicon,splash-icon,android-icon-*}.png');
console.log('og-image.png is built separately — see the header of this file');
