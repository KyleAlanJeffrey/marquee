#!/usr/bin/env bash
# Drive /api/admin/repair-duplicates to completion.
#
# One pass re-clusters the whole venue table but only scans a bounded slice of
# upcoming events, so with more events than the ceiling it has to be resumed:
# each response carries `next_artist_id`, and passing it back as ?after= picks up
# where the last pass stopped. Pages are cut at artist boundaries so a run of one
# artist's shows is never split across two passes.
#
# Usage:
#   ADMIN_TOKEN=… ./scripts/repair-duplicates.sh [base-url]
set -euo pipefail

BASE="${1:-https://marquee.2rbf5f5gvj.workers.dev}"
: "${ADMIN_TOKEN:?set ADMIN_TOKEN (the Worker secret) in the environment}"

after=""
pass=0
total_merged=0
total_repointed=0

while :; do
  pass=$((pass + 1))
  url="$BASE/api/admin/repair-duplicates"
  [ -n "$after" ] && url="$url?after=$after"

  response=$(curl -sS --max-time 120 -X POST -H "x-admin-token: $ADMIN_TOKEN" -w $'\n%{http_code}' "$url")
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"

  # An unauthorized or failed pass must not read as a pass that found nothing:
  # every counter would come back zero and the run would report success.
  if [ "$status" != "200" ]; then
    echo "pass $pass: HTTP $status — ${body:0:200}" >&2
    [ "$status" = "401" ] && echo "(is ADMIN_TOKEN the value set on the Worker?)" >&2
    exit 1
  fi
  if ! printf '%s' "$body" | python3 -c 'import json,sys; json.load(sys.stdin)' >/dev/null 2>&1; then
    echo "pass $pass: unexpected response: ${body:0:200}" >&2
    exit 1
  fi

  read -r clustered repointed merged filled truncated next <<EOF
$(printf '%s' "$body" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(
    d.get("venues_clustered", 0),
    d.get("events_repointed", 0),
    d.get("shows_merged", 0),
    d.get("provenance_filled", 0),
    d.get("truncated", False),
    d.get("next_artist_id") or "-",
)')
EOF

  total_merged=$((total_merged + merged))
  total_repointed=$((total_repointed + repointed))
  echo "pass $pass: venues_clustered=$clustered events_repointed=$repointed shows_merged=$merged provenance_filled=$filled truncated=$truncated"

  if [ "$next" = "-" ]; then
    if [ "$truncated" = "True" ]; then
      # Truncated with nowhere to resume from: the scan could not advance, which
      # wants a look rather than another pass.
      echo "stopped: scan hit its ceiling but returned no cursor" >&2
      exit 1
    fi
    break
  fi
  after="$next"
done

echo "done in $pass pass(es): $total_merged show(s) merged, $total_repointed venue-repoint statement(s)"
