/**
 * Rewrites incoming *system* URLs — cold-start launches, deep links, auth
 * returns — before the router sees them. Native only, by design: this file
 * never exists on web, which is the entire point of using it here.
 *
 * A cold start arrives as `marquee:///`, and the app deliberately has no `/`
 * route — that address belongs to the server-rendered landing page, which is
 * a website, not a screen of this app. Without this hook the router renders
 * "Unmatched Route" on every launch (verified in the simulator; the root
 * layout's `initialRouteName` does not rescue an unmatched initial URL).
 *
 * This replaced an `extra.router.redirects` entry in app.json, for two
 * reasons found the hard way: that config is baked into the native bundle at
 * *build* time (EXConstants.bundle/app.config), so changing it silently does
 * nothing until the next Xcode/EAS build — and it put `/` back into the
 * route table on web too, which is exactly what the separation removed.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  // Despite the name, on a home-screen launch this receives the app's *full
  // root URL* — `marquee:///`, from the router's getInitialURL fallback — not
  // a bare path. Strip any scheme://host prefix before deciding, and return
  // the original untouched for everything that isn't the root: real deep
  // links carry paths (and queries) this must not disturb.
  const bare = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  return bare === '' || bare === '/' ? '/explore' : path;
}
