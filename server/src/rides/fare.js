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

const BASE_FARE = 2.5;
const PER_KM_RATE = 1.2;
const PER_MIN_RATE = 0.3;
const MIN_FARE = 4.0;

function calculateFare(distanceKm, durationMin) {
  const raw = BASE_FARE + distanceKm * PER_KM_RATE + durationMin * PER_MIN_RATE;
  const fare = Math.max(MIN_FARE, raw);
  return {
    fare: Math.round(fare * 100) / 100,
    distanceKm: Math.round(distanceKm * 100) / 100,
    durationMin: Math.round(durationMin * 100) / 100,
    baseFare: BASE_FARE,
    perKmRate: PER_KM_RATE,
    perMinRate: PER_MIN_RATE,
    currency: 'FJD',
  };
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

module.exports = { calculateFare, haversine, computeRoutePath, BASE_FARE, PER_KM_RATE, PER_MIN_RATE, MIN_FARE };