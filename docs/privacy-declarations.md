# Privacy declarations — what to tick, and why it's true

*Written 2026-07-31 against the code as it stands, not against intentions. Every
claim below was checked by grep or by watching requests; the checks are named so
they can be re-run before submission. Kyle signs these in App Store Connect and the
Play Console; this file is the worked answer key.*

## The facts the declarations rest on

| claim | how it was verified |
| --- | --- |
| Notifications are local-only; no push token is ever minted | `grep -r 'PushToken\|getExpoPushToken' src/` → nothing. `expo-notifications` is used for `scheduleNotificationAsync` reminders and permission prompts only. |
| No analytics, ads, or crash-reporting SDK | package.json has none; `src/` references none. |
| Location goes to our API in POST bodies, with **no Authorization header** | `RequestOpts.anonymous` in `src/lib/api.ts`; every coordinate-carrying call (`/nearby`, `/venues/nearby`, `/following`, `/discover-events`) passes it. Location and identity never ride in one request, so the server cannot link them even accidentally. |
| Location is not stored per-user server-side | The Worker reads `lat`/`lng` into a bounding-box query and drops them. The one persistent trace is `discovery_log`, which records a ~rounded *grid cell* that some anonymous request asked about, with no user column. |
| Account data is Clerk's | Email, OAuth profile, password hash all live in Clerk. Our `users` table mirrors id, handle, display name, avatar URL — nothing else. |
| User content is stored against the account | `user_lists` (follows, venues, saved, attendance log incl. private ratings/notes) and two preference columns on `users`. |

**Known residual, declared rather than hidden:** in-app navigation puts coordinates
in client route params (`/browse?lat=…`), and on web a reload of that URL reaches
the server as a request path. That is the user's own navigation state (as with any
map site), but it means "coordinates never appear in a request log" is not
absolute on web. If that sentence has to be absolute, the fix is moving browse/map
coords into router state instead of the query string.

## Apple — App Privacy (nutrition label)

**Data used to track you: none.** (No third-party ad/analytics SDKs; nothing is
shared for cross-app tracking; no ATT prompt needed.)

**Data linked to you:**

| category | item | purpose | notes |
| --- | --- | --- | --- |
| Contact info | Email address | App functionality | Sign-in via Clerk; only if the user creates an account |
| Identifiers | User ID | App functionality | Clerk user id, mirrored in our DB as a foreign-key target |
| User content | Other user content | App functionality | Followed artists/venues, saved shows, attendance log, private ratings and notes |

**Data not linked to you:**

| category | item | purpose | notes |
| --- | --- | --- | --- |
| Location | Precise location | App functionality | Sent tokenless in POST bodies; used to answer "what's on near me"; not stored per user |

Everything else (browsing history, purchases, financial info, contacts, photos,
health, diagnostics…): **not collected**.

## Google Play — Data safety

- **Collected & encrypted in transit:** yes (HTTPS only).
- **Deletion request path:** account deletion deletes the Clerk account and
  tombstones our mirror row (`deleted_at`); user lists are removable in-app by
  clearing them. *Before submission this needs a user-facing "delete my account"
  entry point — Play requires one in-app or by link. Not built yet; tracked in
  todo.md.*
- **Location → Precise location:** collected, not shared, ephemeral use, purpose
  "App functionality". Optional (the app works with search instead of location).
- **Personal info → Email address:** collected, not shared (Clerk is a processor,
  not a data buyer), purpose "Account management". Optional.
- **App activity → Other user-generated content:** collected, purpose "App
  functionality".
- **Device IDs:** not collected.

## Third parties a reviewer may ask about

| party | role | what they see |
| --- | --- | --- |
| Clerk | authentication processor | email, OAuth profile, sessions |
| Cloudflare | infrastructure | requests (coordinates only in POST bodies; not in URLs) |
| Apple / Google / Facebook | sign-in providers | the OAuth handshake, per their own policies |
| Mapbox | static map images | *venue* coordinates in image URLs — public place data, never the user's location |
| Ticketmaster / SeatGeek / Bandsintown / StubHub | outbound ticket links | nothing until the user taps through |

## Before signing, still needed

- [ ] An in-app **account deletion** entry point (App Store 5.1.1(v) and Play both
  require it now that accounts exist).
- [ ] A hosted **privacy policy page** — the store forms both take a URL. The
  server-rendered page chrome in `worker/src/page.ts` is the natural place.
- [ ] Decide whether the web `/browse?lat=` residual above matters enough to move
  coordinates out of the query string.
