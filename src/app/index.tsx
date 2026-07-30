import { Redirect } from 'expo-router';

/**
 * The app's home is `/explore`, not `/`.
 *
 * `/` is the site's landing page, rendered by the Worker from D1 — it is where every
 * inbound link points and the only page here that can rank for "concerts near me",
 * and it can't do that job while it renders the app's loading spinner instead. So
 * the feed moved one route over and this stays behind: on web nothing reaches it
 * (the Worker answers `/` before the assets do), and on native it is the launch
 * route, which redirects into the tabs before anything paints.
 */
export default function Index() {
  return <Redirect href="/explore" />;
}
