// One-off generator for the web/social assets in public/: the 1200x630 Open
// Graph card plus the PWA / apple-touch icons (derived from the app icon).
//   node scripts/gen-web-assets.mjs
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const PUBLIC = new URL('../public/', import.meta.url);
const ICON = new URL('../assets/images/icon.png', import.meta.url);

const mark = (x, y, s) => `
  <g transform="translate(${x} ${y}) scale(${s / 64})">
    <rect x="6" y="9" width="52" height="46" rx="15" fill="none" stroke="url(#frame)" stroke-width="3.5"/>
    <line x1="32" y1="13" x2="32" y2="51" stroke="#00dbe9" stroke-width="3" stroke-linecap="round"/>
    <line x1="18.5" y1="26" x2="18.5" y2="40" stroke="#ecb2ff" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="25" y1="22" x2="25" y2="44" stroke="#bd00ff" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="39" y1="20" x2="39" y2="46" stroke="#00dbe9" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="45.5" y1="27" x2="45.5" y2="39" stroke="#5ce9f2" stroke-width="3.5" stroke-linecap="round"/>
  </g>`;

const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="frame" x1="0" y1="0" x2="64" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#bd00ff"/><stop offset="1" stop-color="#00dbe9"/>
    </linearGradient>
    <radialGradient id="purple" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#bd00ff" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#bd00ff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="cyan" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#00dbe9" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#00dbe9" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#bd00ff"/><stop offset="1" stop-color="#00dbe9" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="#0b0b0d"/>
  <circle cx="170" cy="120" r="440" fill="url(#purple)"/>
  <circle cx="1060" cy="560" r="420" fill="url(#cyan)"/>

  ${mark(84, 78, 96)}
  <text x="200" y="150" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="56"
        font-weight="700" fill="#ffffff" letter-spacing="1">Marquee</text>

  <text x="84" y="336" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="94"
        font-weight="700" fill="#ffffff" letter-spacing="-2">Find concerts near you.</text>
  <text x="84" y="424" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="42"
        font-weight="500" fill="#00dbe9">Follow the artists you love. Never miss the show.</text>

  <rect x="84" y="486" width="360" height="4" rx="2" fill="url(#rule)"/>
  <text x="84" y="556" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="28"
        font-weight="500" fill="#8b8b93" letter-spacing="4">LIVE MUSIC RADAR</text>
</svg>`;

await mkdir(PUBLIC, { recursive: true });

await sharp(Buffer.from(og)).png().toFile(new URL('og-image.png', PUBLIC).pathname);

for (const [name, size] of [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]) {
  await sharp(ICON.pathname).resize(size, size).png().toFile(new URL(name, PUBLIC).pathname);
}

await writeFile(
  new URL('manifest.json', PUBLIC),
  JSON.stringify(
    {
      name: 'Marquee — Find concerts near you',
      short_name: 'Marquee',
      description:
        'Marquee is a live music radar: discover upcoming concerts near you, follow the artists you love, and get a reminder before their next nearby show.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#0e0e0e',
      theme_color: '#0e0e0e',
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

console.log('wrote public/{og-image.png,apple-touch-icon.png,icon-192.png,icon-512.png,manifest.json}');
