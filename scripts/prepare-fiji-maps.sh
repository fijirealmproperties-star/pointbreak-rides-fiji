#!/usr/bin/env bash
# Pointbreak Rides Fiji — one-time map data preparation (free, self-hosted).
#
# Downloads the Fiji OpenStreetMap extract (~17 MB) and builds the OSRM
# routing graph used by the API for fares and route lines. The same extract is
# imported by the self-hosted Nominatim container for reverse geocoding.
#
# Usage:   ./scripts/prepare-fiji-maps.sh
# Re-run:  safe — an existing extract is reused unless you delete data/.
#
# Requires Docker. Works on Linux, macOS and Git Bash / WSL on Windows.

set -euo pipefail

# Git Bash rewrites /data-style container paths into Windows paths; stop that.
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) export MSYS_NO_PATHCONV=1 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/data"
OSRM_DIR="$DATA/osrm"
PBF="$DATA/fiji-latest.osm.pbf"
PBF_URL="${PBF_URL:-https://download.geofabrik.de/australia-oceania/fiji-latest.osm.pbf}"
OSRM_IMAGE="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:latest}"

mkdir -p "$OSRM_DIR"

if [ ! -f "$PBF" ]; then
  echo ">> Downloading Fiji OSM extract"
  echo "   $PBF_URL"
  curl -fL --retry 3 --retry-delay 2 -o "$PBF.part" "$PBF_URL"
  mv "$PBF.part" "$PBF"
else
  echo ">> Reusing existing extract: $PBF"
fi

if [ -f "$OSRM_DIR/fiji-latest.osrm" ]; then
  echo ">> OSRM graph already built — nothing to do."
  exit 0
fi

echo ">> Copying extract into the OSRM data volume"
cp "$PBF" "$OSRM_DIR/fiji-latest.osm.pbf"

run() {
  echo ">> osrm $*"
  docker run --rm -v "$OSRM_DIR:/data" "$OSRM_IMAGE" "$@"
}

# MLD pipeline: extract the car profile, partition, then customize.
run osrm-extract -p /opt/car.lua /data/fiji-latest.osm.pbf
run osrm-partition /data/fiji-latest.osrm
run osrm-customize /data/fiji-latest.osrm

echo
echo "Done. OSRM data is in data/osrm/ ($(du -sh "$OSRM_DIR" 2>/dev/null | cut -f1 || echo '?' ))."
echo "Start the stack with:"
echo "  docker compose --profile maps up -d --build"
