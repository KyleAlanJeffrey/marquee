import { Redirect } from 'expo-router';

/**
 * The log used to be a tab, then a screen; it is a view of My Shows now
 * (Been), because the shows you're going to and the shows you went to are one
 * question in two tenses. This keeps every `/log` link — old deep links,
 * anything shared, the route in muscle memory — landing on the wall.
 */
export default function LogRedirect() {
  return <Redirect href="/saved?view=been" />;
}
