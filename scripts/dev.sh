#!/usr/bin/env bash
#
# Local dev bootstrap for Marquee on Cloudflare.
#
#   npm run dev              # backend (Worker + local D1) + app
#   npm run dev -- --no-app  # just the Worker
#
# Installs deps, applies D1 migrations to a local SQLite database, starts the
# Worker (wrangler dev on :8787), writes the app's .env, and launches Expo.

set -euo pipefail
cd "$(dirname "$0")/.."

RUN_APP=1
for arg in "$@"; do
  case "$arg" in
    --no-app) RUN_APP=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

info() { printf '\033[1;34m▶\033[0m %s\n' "$1"; }

# 1. Dependencies
[ -d node_modules ] || { info "Installing app dependencies…"; npm install; }
[ -d worker/node_modules ] || { info "Installing worker dependencies…"; (cd worker && npm install); }

# 2. Local D1 schema + seed
info "Applying D1 migrations to the local database…"
(cd worker && npx wrangler d1 migrations apply marquee --local)

# 3. App env → local Worker
info "Writing .env (EXPO_PUBLIC_API_URL=http://localhost:8787)…"
printf 'EXPO_PUBLIC_API_URL=http://localhost:8787\n' > .env

# 4. Start the Worker (background)
info "Starting the Worker on http://localhost:8787 …"
(cd worker && npx wrangler dev --port 8787) &
WORKER_PID=$!
trap 'kill $WORKER_PID 2>/dev/null || true' EXIT

# 5. App
if [ "$RUN_APP" -eq 1 ]; then
  info "Launching Expo — press w (web), i (iOS), a (Android)."
  npx expo start
else
  info "Worker running (pid $WORKER_PID). Ctrl-C to stop."
  wait $WORKER_PID
fi
