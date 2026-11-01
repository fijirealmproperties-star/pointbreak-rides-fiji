const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversine(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// Fiji taxi tariff (FCCC): flag fall FJ$2 day / FJ$3 night / FJ$5 airport,
// 14c per 100 m, 18c per minute of waiting.
const DAY_FLAG_FALL = 2.0;
const NIGHT_FLAG_FALL = 3.0;
const AIRPORT_FLAG_FALL = 5.0;
const BASE_FARE = DAY_FLAG_FALL;
const PER_KM_RATE = 1.4;
const PER_MIN_RATE = 0.18;
const MIN_FARE = 0;
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 5;
const AIRPORT = { lat: -17.7554, lng: 177.4434, radiusKm: 2.5 };

function fijiHour(date = new Date()) {
  return (date.getUTCHours() + 12) % 24;
}

function flagFallFor({ pickupLat, pickupLng, at } = {}) {
  if (Number.isFinite(pickupLat) && Number.isFinite(pickupLng) &&
      haversine(pickupLat, pickupLng, AIRPORT.lat, AIRPORT.lng) <= AIRPORT.radiusKm) {
    return { amount: AIRPORT_FLAG_FALL, type: 'airport' };
  }
  const h = fijiHour(at);
  if (h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR) return { amount: NIGHT_FLAG_FALL, type: 'night' };
  return { amount: DAY_FLAG_FALL, type: 'day' };
}

// waitMin = minutes spent stopped/slow (charged at the waiting rate).
function calculateFare(distanceKm, waitMin, ctx = {}) {
  const wait = Math.max(0, Number(waitMin) || 0);
  const flag = flagFallFor(ctx);
  const distanceCharge = distanceKm * PER_KM_RATE;
  const waitCharge = wait * PER_MIN_RATE;
  const fare = flag.amount + distanceCharge + waitCharge;
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    fare: r2(fare),
    distanceKm: r2(distanceKm),
    durationMin: r2(wait),
    baseFare: flag.amount,
    flagFallType: flag.type,
    distanceCharge: r2(distanceCharge),
    waitCharge: r2(waitCharge),
    perKmRate: PER_KM_RATE,
    perMinRate: PER_MIN_RATE,
    currency: 'FJD',
  };
}

function meterFareFor(ride, distanceKm, waitMin) {
  const started = ride && (ride.meter_started_at || ride.pickup_at);
  const at = started ? new Date(String(started).replace(' ', 'T') + 'Z') : new Date();
  return calculateFare(distanceKm, waitMin, {
    pickupLat: Number(ride && ride.pickup_lat),
    pickupLng: Number(ride && ride.pickup_lng),
    at: Number.isNaN(at.getTime()) ? new Date() : at,
  });
}

function computeRoutePath(pickupLat, pickupLng, dropoffLat, dropoffLng) {
  const smooth = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
  };

  const steps = 18;
  const cornerStart = 0.32;
  const cornerEnd = 0.68;
  const dLat = dropoffLat - pickupLat;
  const dLng = dropoffLng - pickupLng;

  const weights = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const lngW = smooth((t - cornerStart) / (cornerEnd - cornerStart));
    weights.push({ lat: 1 - lngW, lng: lngW });
  }

  const totalLat = weights.reduce((sum, w) => sum + w.lat, 0);
  const totalLng = weights.reduce((sum, w) => sum + w.lng, 0);

  let cumLat = 0;
  let cumLng = 0;
  const path = [];
  for (let i = 0; i < steps; i++) {
    cumLat += (dLat * weights[i].lat) / totalLat;
    cumLng += (dLng * weights[i].lng) / totalLng;
    path.push({ lat: +(pickupLat + cumLat).toFixed(6), lng: +(pickupLng + cumLng).toFixed(6) });
  }
  return path;
}

module.exports = { calculateFare, meterFareFor, haversine, computeRoutePath, BASE_FARE, PER_KM_RATE, PER_MIN_RATE, MIN_FARE };