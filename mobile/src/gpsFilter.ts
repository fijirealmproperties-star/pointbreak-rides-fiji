import { haversine } from "./geo";

export type GpsState = "searching" | "good" | "weak";
export type RawFix = {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null; // m/s
  t: number; // ms
};

const MAX_ACCURACY_M = 50; // fixes worse than this are ignored
const MAX_SPEED_MS = 70; // ~250 km/h: anything faster is a GPS jump
const COAST_AFTER_MS = 2500; // no good fix for this long: assume we are in a weak area
const COAST_MAX_MS = 25000; // keep estimating for this long, then stop
const COAST_MIN_SPEED_MS = 3; // only estimate if we were clearly moving

// Turns raw GPS fixes into a stable trip distance and speed for the meter.
export class TripTracker {
  distKm = 0;
  speedKmh = 0;
  state: GpsState = "searching";
  accuracy: number | null = null;

  private anchor: { lat: number; lng: number; t: number } | null = null;
  private lastGoodAt = 0;
  lastMovingKmh = 0;
  private coastedKm = 0;
  private lastTickAt = 0;
  private rejected = 0;

  reset(now = Date.now()) {
    this.distKm = 0;
    this.speedKmh = 0;
    this.state = "searching";
    this.accuracy = null;
    this.anchor = null;
    this.lastGoodAt = now;
    this.lastMovingKmh = 0;
    this.coastedKm = 0;
    this.lastTickAt = now;
    this.rejected = 0;
  }

  // Returns the distance (km) to charge for this fix.
  ingest(fix: RawFix, now = Date.now()): number {
    const acc = fix.accuracy != null && Number.isFinite(fix.accuracy) && fix.accuracy > 0 ? fix.accuracy : 999;
    this.accuracy = acc === 999 ? null : acc;
    if (acc > MAX_ACCURACY_M) {
      if (now - this.lastGoodAt > COAST_AFTER_MS) this.state = "weak";
      return 0;
    }
    this.lastGoodAt = now;
    this.state = "good";

    if (!this.anchor) {
      this.anchor = { lat: fix.lat, lng: fix.lng, t: fix.t };
      return 0;
    }
    if (fix.t <= this.anchor.t) return 0;

    const dtS = (fix.t - this.anchor.t) / 1000;
    const dKm = haversine(this.anchor.lat, this.anchor.lng, fix.lat, fix.lng);
    const impliedMs = (dKm * 1000) / dtS;

    if (impliedMs > MAX_SPEED_MS) {
      // A single wild jump is dropped; if it keeps happening, trust the new position.
      this.rejected += 1;
      if (this.rejected >= 3) {
        this.anchor = { lat: fix.lat, lng: fix.lng, t: fix.t };
        this.rejected = 0;
      }
      return 0;
    }
    this.rejected = 0;

    const reportedMs = fix.speed != null && Number.isFinite(fix.speed) && fix.speed >= 0 ? fix.speed : null;
    const ms = reportedMs ?? impliedMs;
    let stepKm = dKm;
    if (reportedMs != null) {
      if (reportedMs < 0.8) {
        // Chip says we are not moving: re-anchor so drift never builds up.
        this.anchor = { lat: fix.lat, lng: fix.lng, t: fix.t };
        this.speedKmh = 0;
        this.lastMovingKmh = 0;
        return 0;
      }
      // Doppler speed is the most accurate source of distance; position only sanity-checks it.
      const dopKm = (reportedMs * Math.min(dtS, 10)) / 1000;
      stepKm = dKm > 0 && dKm < dopKm * 2 && dKm > dopKm * 0.5 ? 0.75 * dopKm + 0.25 * dKm : dtS <= 10 ? dopKm : dKm;
    } else {
      const noiseM = Math.max(acc, 8);
      if (dKm * 1000 < noiseM * 1.5) return 0;
    }    const add = Math.max(0, stepKm - this.coastedKm);
    this.coastedKm = 0;
    this.anchor = { lat: fix.lat, lng: fix.lng, t: fix.t };
    this.speedKmh = this.speedKmh === 0 ? ms * 3.6 : this.speedKmh * 0.4 + ms * 3.6 * 0.6;
    if (this.speedKmh * 1 > COAST_MIN_SPEED_MS * 3.6) this.lastMovingKmh = this.speedKmh;
    this.distKm += add;
    return add;
  }

  // Called every second. Estimates distance while the signal is lost so the fare keeps up.
  tick(now = Date.now()): number {
    const dtS = Math.max(0, (now - this.lastTickAt) / 1000);
    this.lastTickAt = now;
    if (!this.anchor) return 0;
    const gap = now - this.lastGoodAt;
    if (gap <= COAST_AFTER_MS) return 0;
    this.state = "weak";
    if (gap <= COAST_MAX_MS && this.lastMovingKmh > COAST_MIN_SPEED_MS * 3.6) {
      const km = (this.lastMovingKmh / 3600) * dtS;
      this.coastedKm += km;
      this.distKm += km;
      this.speedKmh = this.lastMovingKmh;
      return km;
    }
    this.speedKmh = 0;
    return 0;
  }

  // Milliseconds since the last accepted fix.
  silentFor(now = Date.now()): number {
    return now - this.lastGoodAt;
  }
}
