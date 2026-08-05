/**
 * On native, sign-up is the same hand-off to Clerk's hosted portal as sign-in —
 * the portal presents both flows itself. The route exists so `/sign-up` links
 * resolve on every platform; web has its own file with the embedded card.
 */
export { default } from './sign-in';
