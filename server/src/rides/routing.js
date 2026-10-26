// Real road routing via OSRM. Production runs the self-hosted OSRM container
// from docker-compose.yml (`--profile maps`) through OSRM_URL; the public
// router.project-osrm.org demo is development-only and not licensed for app
// traffic.
// Always returns null on failure so callers can fall back to straight-line.

const OSRM_BASE = process.env.OSRM_URL || "https://router.project-osrm.org";
const TIMEOUT_MS = 3500;
const MAX_PATH_POINTS = 500;

const cache = new Map();

function cacheKey(lat1, lng1, lat2, lng2) {
  return `${lat1.toFixed(4)},${lng1.toFixed(4)}|${lat2.toFixed(4)},${lng2.toFixed(4)}`;
}

function simplify(coords, maxPoints) {
  if (coords.length <= maxPoints) return coords;
  const step = (coords.length - 1) / (maxPoints - 1);
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(coords[Math.round(i * step)]);
  return out;
}

async function getRoadRoute(lat1, lng1, lat2, lng2) {
  const key = cacheKey(lat1, lng1, lat2, lng2);
  if (cache.has(key)) return cache.get(key);

  const url =
    `${OSRM_BASE}/route/v1/driving/${lng1},${lat1};${lng2},${lat2}` +
    `?overview=full&geometries=geojson&alternatives=false&steps=false`;

  let result = null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "PointbreakRidesFiji/1.0" },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.code === "Ok" && data.routes && data.routes.length) {
        const r = data.routes[0];
        const raw = (r.geometry && r.geometry.coordinates) || [];
        const path = simplify(
          raw.map(([lng, lat]) => ({ lat: +lat.toFixed(6), lng: +lng.toFixed(6) })),
          MAX_PATH_POINTS
        );
        if (r.distance > 0 && path.length >= 2) {
          result = {
            distance_km: Math.round((r.distance / 1000) * 100) / 100,
            duration_min: Math.round((r.duration / 60) * 100) / 100,
            path,
          };
        }
      }
    }
  } catch {
    result = null;
  }

  if (result) {
    if (cache.size > 500) cache.clear();
    cache.set(key, result);
  }
  return result;
}

module.exports = {
  getRoadRoute,
  usesDemoRouting: !process.env.OSRM_URL || /project-osrm\.org/.test(OSRM_BASE),
};
