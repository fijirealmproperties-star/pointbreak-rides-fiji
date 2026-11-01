// In-memory last-known rider positions (riders are "online" if seen recently).
const riders = new Map();
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

function touchRider(userId, lat, lng) {
  const prev = riders.get(userId) || {};
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);
  riders.set(userId, {
    lat: hasPoint ? lat : prev.lat,
    lng: hasPoint ? lng : prev.lng,
    at: Date.now(),
  });
}

function onlineRiders() {
  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  const out = [];
  for (const [userId, r] of riders) {
    if (r.at < cutoff) riders.delete(userId);
    else out.push({ userId, ...r });
  }
  return out;
}

module.exports = { touchRider, onlineRiders };
