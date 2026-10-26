// Reverse geocode a lat/lng to a street label.
// Provider: Nominatim. Production runs the self-hosted instance from
// docker-compose.yml (`--profile maps`), reached via NOMINATIM_URL. The public
// nominatim.openstreetmap.org demo is for development only — it is not licensed
// for app traffic. MapTiler (MAPTILER_KEY) is an optional commercial fallback.
// Done server-side so we can send a proper User-Agent and cache results.

const MAPTILER_KEY = process.env.MAPTILER_KEY || '';
const NOMINATIM_BASE = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const CONTACT = process.env.CONTACT_EMAIL || '';
const TIMEOUT_MS = 4000;

const cache = new Map();
const FALLBACK = { label: 'Dropped pin', region: '' };

function pickNominatimLabel(data) {
  const a = (data && data.address) || {};
  const road = a.road || a.pedestrian || a.footway || a.neighbourhood || a.suburb;
  const area = a.city || a.town || a.village || a.suburb || a.county || a.state;
  if (road && area && road !== area) return `${road}, ${area}`;
  if (road) return road;
  if (area) return area;
  return (data && data.display_name) || '';
}

async function reverseMaptiler(lat, lng) {
  const url =
    `https://api.maptiler.com/geocoding/${lng},${lat}.json` +
    `?key=${encodeURIComponent(MAPTILER_KEY)}&language=en&limit=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;
  const data = await res.json();
  const f = data && data.features && data.features[0];
  if (!f) return null;
  const ctx = f.context || [];
  const areaItem = ctx.find((c) => /^(place|municipality|locality|county)/.test(String(c.id)));
  const area = (areaItem && areaItem.text) || '';
  const road = f.text || f.address || '';
  const label = road && area && road !== area ? `${road}, ${area}` : road || f.place_name || '';
  if (!label) return null;
  return { label, region: area };
}

async function reverseNominatim(lat, lng) {
  const url =
    `${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${lat}&lon=${lng}` +
    `&zoom=18&addressdetails=1${CONTACT ? `&email=${encodeURIComponent(CONTACT)}` : ''}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'User-Agent': `PointbreakRidesFiji/1.0${CONTACT ? ` (${CONTACT})` : ''}`,
      Accept: 'application/json',
      'Accept-Language': 'en',
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const label = pickNominatimLabel(data);
  if (!label) return null;
  const a = (data && data.address) || {};
  return {
    label,
    region: a.city || a.town || a.village || a.state || '',
  };
}

async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key);

  let out = FALLBACK;
  try {
    const result = MAPTILER_KEY
      ? (await reverseMaptiler(lat, lng)) || (await reverseNominatim(lat, lng))
      : await reverseNominatim(lat, lng);
    if (result) out = result;
  } catch {
    out = FALLBACK;
  }

  if (cache.size > 500) cache.clear();
  cache.set(key, out);
  return out;
}

module.exports = { reverseGeocode, usesDemoGeocoder: !MAPTILER_KEY && /openstreetmap\.org/.test(NOMINATIM_BASE) };
