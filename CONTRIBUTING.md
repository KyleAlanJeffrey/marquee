# Contributing to Marquee

## Releasing the app

**Bumping the app version is the release trigger.** There is no separate
release step: change `expo.version` in `app.json`, push to `main`, and the
pipeline does the rest.

```bash
# the whole release process
#   1. edit app.json: "version": "1.0.6"
#   2. commit and push to main
```

What happens from there:

1. **`.github/workflows/auto-tag-release.yml`** runs on any push to `main`
   that touches `app.json`. If `v<version>` isn't tagged yet **and** the
   version beats the highest existing release tag, it tags the commit and
   dispatches the EAS build workflow. (Both guards are load-bearing: the
   first makes unrelated `app.json` edits inert, the second stops a stale
   version from re-releasing old code.)
2. **`.github/workflows/eas-build.yml`** hands the build to EAS's servers
   (`--no-wait`, so the Action finishes in about a minute; progress lives at
   [expo.dev](https://expo.dev/accounts/kyle-jeffreys-team/projects/marquee/builds)).
   - **iOS** builds and auto-submits to App Store Connect — app record
     **6798407800** ("marquee rocks", bundle `rocks.marquee`), pinned as
     `ascAppId` in `eas.json`.
   - **Android** builds but does **not** submit yet: EAS has no Google
     Service Account key. When `eas credentials` (Android → Google Service
     Account) really has one, fold android back into `--auto-submit` — the
     comment in `eas-build.yml` marks the spot.
3. Apple processes the binary (~5–10 min) and it appears in
   [TestFlight](https://appstoreconnect.apple.com/apps/6798407800/testflight/ios).

Tag hygiene: the tag **is** the app version (`v1.0.5` ↔ `expo.version
"1.0.5"`). Don't hand-create release-shaped tags for other purposes — the
`v[0-9]*` pattern triggers builds.

### Manual paths

- **Actions tab → "EAS build" → Run workflow** — choose platform, profile,
  and whether to submit. Useful for preview builds or re-running one
  platform.
- **Local CLI, when GitHub Actions is down** (it happens):

  ```bash
  git tag -a v1.0.6 -m "Marquee 1.0.6" && git push origin v1.0.6
  npx eas-cli build --platform ios --profile production --auto-submit --no-wait
  npx eas-cli build --platform android --profile production --no-wait
  ```

  Per-platform on purpose, mirroring the workflow: a combined
  `--platform all --auto-submit` dies at Android's missing Play key *after*
  queuing the builds and takes the iOS submission setup down with it —
  measured on the v1.0.5 release.

  Tag first: it anchors the release and makes the auto-tagger a no-op for
  that version afterwards.

## Build-time environment

Client env vars (`EXPO_PUBLIC_*`) are baked into the bundle at build time,
from two layers:

- **`.env.production`** — committed, publishable values only. The fallback
  that keeps a fresh clone building a working app.
- **EAS environment variables** (`eas env:list --environment production`) —
  override the file when set.

Two rules learned the hard way (v1.0.4 crashed on launch over this):

- **Values only, no comments.** Env vars aren't shell — a pasted
  `# trailing comment` ships inside the value and, for the Clerk key, crashes
  the app before its first frame.
- **When a store build misbehaves and a local build doesn't, diff the build
  inputs before the code**: `npx eas-cli env:list --environment production`.

## Day-to-day

- `npm run dev` — Expo dev server + local Worker. `npm test` — the worker
  test suite (vitest). `npx tsc --noEmit` and `npx eslint <files>` before
  committing.
- The website Worker deploys via Cloudflare Workers Builds on every push to
  `main`; the jobs Worker deploys via `.github/workflows/deploy-jobs.yml`
  when `worker/**` changes (or `npm run deploy:jobs` by hand).
- Never run prettier — the repo's formatting is deliberate.
- `todo.md` is the project log: significant work, measurements, and
  post-mortems get recorded there.
