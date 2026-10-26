#!/usr/bin/env bash
# Pointbreak Rides Fiji — end-to-end smoke test.
#
#   bash scripts/smoke-test.sh                       # SITE_DOMAIN from .env
#   bash scripts/smoke-test.sh https://example.com   # explicit origin
#   bash scripts/smoke-test.sh http://localhost:3003 # local dev server
#
# Checks, in order:
#   1. DNS -> Caddy -> TLS -> Node        (public /api/health)
#   2. Web build + PWA assets             (/download/, manifest, service worker)
#   3. Auth                               (login, or register a throwaway rider)
#   4. Reverse geocoding through the API  (proves NOMINATIM_URL wiring)
#   5. Road routing + fare through API    (proves OSRM_URL wiring)
#
# Exit codes: 0 = all passed, 1 = at least one failure, 2 = cannot run.
# Needs only bash + curl; docker is consulted for hints when something fails.
#
# Reuse an existing account instead of creating one:
#   SMOKE_PHONE=+6791234567 SMOKE_PASSWORD=secret bash scripts/smoke-test.sh
#
# Nadi Airport -> Denarau Marina is the routing sample: ~10 km straight-line,
# ~11-13 km by road. "routed":false means the API fell back to straight-line.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  echo "usage: bash scripts/smoke-test.sh [https://your-domain]" >&2
  echo "       or set SITE_DOMAIN, or put SITE_DOMAIN=... in .env" >&2
  exit 2
}

BASE="${1:-${SITE_DOMAIN:-}}"
if [ -z "$BASE" ] && [ -f .env ]; then
  BASE="$(sed -n 's/^SITE_DOMAIN=//p' .env | head -n1 | tr -d '\r"' | xargs)"
fi
[ -n "$BASE" ] || usage
case "$BASE" in
  http://* | https://*) ;;
  *) BASE="https://$BASE" ;;
esac
BASE="${BASE%/}"

command -v curl >/dev/null 2>&1 || {
  echo "smoke-test: curl is required" >&2
  exit 2
}

if [ -t 1 ]; then
  G=$'\033[32m' R=$'\033[31m' Y=$'\033[33m' B=$'\033[1m' N=$'\033[0m'
else
  G= R= Y= B= N=
fi

fails=0
skips=0
passes=0

section() { printf '\n%s%s%s\n' "$B" "$*" "$N"; }
pass() { passes=$((passes + 1)); printf '  %sPASS%s %s\n' "$G" "$N" "$*"; }
fail() { fails=$((fails + 1)); printf '  %sFAIL%s %s\n' "$R" "$N" "$*"; }
skip() { skips=$((skips + 1)); printf '  %sSKIP%s %s\n' "$Y" "$N" "$*"; }

# http METHOD URL [JSON_BODY] [BEARER_TOKEN] -> "body\n<status>" (000 = no response)
http() {
  local method="$1" url="$2" body="${3:-}" token="${4:-}"
  local args=(-sS -m 30 -X "$method" -w $'\n%{http_code}')
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  local out
  out=$(curl "${args[@]}" "$url" 2>&1) || true
  # curl's -w already appends the status; only add one when it is missing.
  case "$out" in
    *$'\n'[0-9][0-9][0-9]) printf '%s' "$out" ;;
    *) printf '%s\n000' "$out" ;;
  esac
}
code_of() { printf '%s' "$1" | tail -n1; }
body_of() { printf '%s' "$1" | sed '$d'; }
json_str() { printf '%s' "$1" | sed -n "s/.*\"$2\": *\"\\([^\"]*\\)\".*/\\1/p" | head -n1; }
json_num() { printf '%s' "$1" | sed -n "s/.*\"$2\": *\\([0-9][0-9.]*\\).*/\\1/p" | head -n1; }
# Substring test. Avoids `printf | grep -q`, which trips `set -o pipefail`
# because grep closes the pipe early and the writer then gets SIGPIPE.
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

printf '%sPointbreak Rides Fiji — smoke test%s\n' "$B" "$N"
printf 'Target: %s\n' "$BASE"

# --- 1. Public edge + API ---------------------------------------------------
unreachable=0
section "1. Edge + API"
resp=$(http GET "$BASE/api/health")
code=$(code_of "$resp")
body=$(body_of "$resp")
if [ "$code" = 200 ] && has "$body" '"ok":true'; then
  pass "GET /api/health -> 200 ok:true"
else
  case "$code" in
    000)
      unreachable=1
      fail "GET /api/health -> no response (DNS, port 80/443, or TLS certificate)"
      ;;
    502 | 503 | 504) fail "GET /api/health -> $code (Caddy is up, API container is not)" ;;
    *) fail "GET /api/health -> ${code:-no response}: $(printf '%s' "$body" | head -c 160)" ;;
  esac
fi

# Nothing below can pass without a reachable server, so name the cause and stop.
if [ "$unreachable" -eq 1 ]; then
  section "2-5. Skipped"
  skip "server unreachable — fix DNS / ports / TLS, then re-run"
  printf '\n%s%d passed, %d failed, %d skipped%s\n' "$B" "$passes" "$fails" "$skips" "$N"
  exit 1
fi

# --- 2. Web app + PWA assets ------------------------------------------------
section "2. Web app + install page"
for path in /download/ /manifest.webmanifest /sw.js; do
  resp=$(http GET "$BASE$path")
  code=$(code_of "$resp")
  if [ "$code" = 200 ]; then
    pass "$path -> 200"
  else
    fail "$path -> ${code:-no response} (web build missing? check 'Web app:' in the API logs)"
  fi
done
resp=$(http GET "$BASE/manifest.webmanifest")
if has "$(body_of "$resp")" '"start_url"'; then
  pass "manifest declares start_url"
else
  fail "manifest is not valid JSON (or is the SPA shell — /downloads-style fallthrough)"
fi

# --- 3. Auth ----------------------------------------------------------------
section "3. Login"
TOKEN=""
if [ -n "${SMOKE_PHONE:-}" ] && [ -n "${SMOKE_PASSWORD:-}" ]; then
  resp=$(http POST "$BASE/api/auth/login" "{\"phone\":\"$SMOKE_PHONE\",\"password\":\"$SMOKE_PASSWORD\"}")
  code=$(code_of "$resp")
  TOKEN=$(json_str "$(body_of "$resp")" accessToken)
  if [ -n "$TOKEN" ]; then
    pass "logged in as $SMOKE_PHONE"
  else
    case "$code" in
      000) fail "login as $SMOKE_PHONE: no response from $BASE" ;;
      401) fail "login as $SMOKE_PHONE: 401 bad phone/password (check SMOKE_PHONE / SMOKE_PASSWORD)" ;;
      429) fail "login as $SMOKE_PHONE: 429 too many auth requests (wait a minute)" ;;
      *) fail "login as $SMOKE_PHONE failed: $code $(body_of "$resp" | head -c 160)" ;;
    esac
  fi
else
  phone="+6798$(printf '%06d' $((RANDOM % 1000000)))"
  password="$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 14)"
  resp=$(http POST "$BASE/api/auth/register" \
    "{\"name\":\"Smoke Test\",\"phone\":\"$phone\",\"password\":\"$password\",\"role\":\"rider\"}")
  code=$(code_of "$resp")
  TOKEN=$(json_str "$(body_of "$resp")" accessToken)
  if [ -n "$TOKEN" ]; then
    pass "registered throwaway rider $phone (rider role, no rides)"
    printf '       %sdelete it later from /admin if you like%s\n' "$Y" "$N"
  else
    case "$code" in
      000) fail "could not register a test rider: no response from $BASE" ;;
      409) fail "could not register a test rider: 409 phone already taken (re-run to get a new number)" ;;
      429) fail "could not register a test rider: 429 too many auth requests (wait a minute, or set SMOKE_PHONE + SMOKE_PASSWORD)" ;;
      403) fail "could not register a test rider: 403 driver signup is closed (this test only creates riders)" ;;
      *)
        fail "could not register a test rider: $code $(body_of "$resp" | head -c 160)"
        printf '       %shint: set SMOKE_PHONE + SMOKE_PASSWORD to reuse an existing account%s\n' "$Y" "$N"
        ;;
    esac
  fi
fi

# --- 4. Reverse geocoding (through the API, so NOMINATIM_URL matters) -------
section "4. Reverse geocoding"
if [ -z "$TOKEN" ]; then
  skip "no auth token — cannot test the API"
else
  resp=$(http POST "$BASE/api/geo/reverse" '{"lat":-18.1416,"lng":178.4419}' "$TOKEN")
  body=$(body_of "$resp")
  label=$(json_str "$body" label)
  if [ -z "$label" ]; then
    fail "POST /api/geo/reverse -> $(code_of "$resp"): $(printf '%s' "$body" | head -c 160)"
  elif [ "$label" = "Dropped pin" ]; then
    fail "Suva centre -> \"Dropped pin\" (geocoder unreachable; maps profile up? NOMINATIM_URL set?)"
  else
    pass "Suva centre -> \"$label\""
  fi
fi

# --- 5. Routing + fare ------------------------------------------------------
section "5. Road routing + fare"
if [ -z "$TOKEN" ]; then
  skip "no auth token — cannot test the API"
else
  resp=$(http POST "$BASE/api/rides/estimate" \
    '{"pickup_lat":-17.7765,"pickup_lng":177.4356,"dropoff_lat":-17.6841,"dropoff_lng":177.4194}' "$TOKEN")
  body=$(body_of "$resp")
  km=$(json_num "$body" distance_km)
  dur=$(json_num "$body" duration_min)
  fare=$(json_num "$body" fare)
  if has "$body" '"routed":true'; then
    pass "Nadi Airport -> Denarau Marina: ${km} km, ${dur} min, FJ\$${fare} (road route)"
  elif [ -n "$km" ]; then
    fail "Nadi Airport -> Denarau Marina: ${km} km straight-line fallback (OSRM unreachable; maps profile up? OSRM_URL set?)"
  else
    fail "POST /api/rides/estimate -> $(code_of "$resp"): $(printf '%s' "$body" | head -c 160)"
  fi
fi

# --- Summary ----------------------------------------------------------------
printf '\n%s%d passed, %d failed, %d skipped%s\n' "$B" "$passes" "$fails" "$skips" "$N"

if [ "$fails" -gt 0 ] && command -v docker >/dev/null 2>&1; then
  printf '\nContainer status:\n'
  docker compose --profile maps ps 2>/dev/null | sed 's/^/  /' || true
  printf '\nLogs: docker compose --profile maps logs --tail 40\n'
fi

[ "$fails" -eq 0 ] || exit 1
exit 0
