import { haversine } from "./geo";
import { FareEstimate } from "./api";

const AVG_SPEED_KMH = 30;
const BASE_FARE = 2.5;
const PER_KM_RATE = 1.2;
const PER_MIN_RATE = 0.3;
const MIN_FARE = 4.0;

const round2 = (n: number) => Math.round(n * 100) / 100;

// Mirrors server/src/rides/fare.js exactly so the UI can show a fare instantly,
// then be replaced by the server's authoritative estimate.
export function estimateLocally(
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number }
): FareEstimate {
  const distanceKm = haversine(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
  const durationMin = (distanceKm / AVG_SPEED_KMH) * 60;
  const raw = BASE_FARE + distanceKm * PER_KM_RATE + durationMin * PER_MIN_RATE;
  const fare = Math.max(MIN_FARE, raw);
  return {
    distance_km: round2(distanceKm),
    duration_min: round2(durationMin),
    fare: round2(fare),
    currency: "FJD",
    base_fare: BASE_FARE,
    per_km: PER_KM_RATE,
    per_minute: PER_MIN_RATE,
    surge_multiplier: 1,
    driver_payout: Math.round(fare * 0.75 * 100) / 100,
  };
}

const estimateCache = new Map<string, FareEstimate>();

export function estimateCacheKey(
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number }
): string {
  return `${pickup.lat.toFixed(4)},${pickup.lng.toFixed(4)}|${dropoff.lat.toFixed(4)},${dropoff.lng.toFixed(4)}`;
}

export function getCachedEstimate(key: string): FareEstimate | undefined {
  return estimateCache.get(key);
}

export function setCachedEstimate(key: string, e: FareEstimate): void {
  if (estimateCache.size > 60) estimateCache.clear();
  estimateCache.set(key, e);
}
