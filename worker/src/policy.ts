import { shell } from './page';

/**
 * The privacy policy and the contact line, server-rendered at `/privacy`.
 *
 * Exists because three different forms demand a URL: the App Store privacy-policy
 * field, the Play Data Safety form, and App Store guideline 1.2's published
 * contact information for apps with user content. One page answers all three.
 *
 * Written to say what the code does, not what a template hedges about — every
 * claim here has a matching entry in `docs/privacy-declarations.md`, where the
 * verification for each is named. When behaviour changes, both files change, and
 * the date below moves.
 */
export function privacyPage(origin: string): string {
  const body = `
<header class="page-head">
  <p class="kicker">MARQUEE</p>
  <h1>Privacy</h1>
  <p class="lede">Marquee is a live-music radar and a concert log. This page says
  what it collects, where it goes, and what it never does. Last updated
  <time datetime="2026-07-31">31 July 2026</time>.</p>
</header>
<section>
  <h2>The short version</h2>
  <ul>
    <li>No ads, no analytics SDKs, no trackers, no data sales.</li>
    <li>Your location is used to find shows near you and is sent <strong>without
    your identity</strong> — requests that carry coordinates carry no sign-in
    token, so our servers cannot connect who you are with where you are.</li>
    <li>Browsing needs no account. Keeping things — follows, saved shows, your
    gig log — does, and that data is stored against your account so it survives
    your phone.</li>
  </ul>
</section>
<section>
  <h2>What we collect, and why</h2>
  <p><strong>Account.</strong> If you sign in, our authentication provider
  (<a href="https://clerk.com" rel="noopener">Clerk</a>) holds your email address
  and, if you use Apple, Google or Facebook sign-in, the profile those services
  share. We keep a mirror of your user id, display name and avatar so the app can
  address you without asking Clerk on every request.</p>
  <p><strong>Your lists.</strong> Artists and venues you follow, shows you save,
  and the concerts you log — including your private ratings and notes — are stored
  against your account. They are visible to nobody else.</p>
  <p><strong>Location.</strong> With your permission, the app uses your position to
  answer "what's on near me". Coordinates travel in the request body, over HTTPS,
  with no account token attached, and are not stored per user. The one persistent
  trace is a coarse map cell recording that <em>someone</em> asked about an area,
  which schedules our listings crawl.</p>
  <p><strong>Notifications.</strong> Show reminders are scheduled on your device.
  There is no push infrastructure and no push token; nothing about notifications
  leaves your phone.</p>
</section>
<section>
  <h2>Who else is involved</h2>
  <p>Cloudflare runs our servers. Clerk handles sign-in. Map images come from
  Mapbox and are requested with <em>venue</em> coordinates — public place data,
  never yours. Ticket links go to Ticketmaster, SeatGeek, StubHub or the venue;
  what happens after you tap through is governed by their policies, not this one.</p>
</section>
<section>
  <h2>Deleting your data</h2>
  <p>Deleting your account removes your identity from Clerk and your lists from
  our database; the mirror row is tombstoned so nothing else breaks, and it holds
  no personal data once cleared. In-app: Profile → Your account. If anything
  resists deletion, email us and a human will do it.</p>
</section>
<section>
  <h2>Contact</h2>
  <p>Marquee is built by Kyle Jeffrey. Questions, reports and privacy requests:
  <a href="mailto:contact@marquee.rocks">contact@marquee.rocks</a>.</p>
</section>`;

  return shell({
    origin,
    canonical: `${origin}/privacy`,
    title: 'Privacy — Marquee',
    description:
      'What Marquee collects and why: no ads, no trackers, location never tied to your identity, and your concert log stored only against your account.',
    body,
  });
}
