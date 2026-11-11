const WAITING_RATE_PER_MIN = 0.18;
const MAX_ESTIMATE_MS = 5000;

export function estimateRideMeter(
  waitMin: number | null | undefined,
  fare: number | null | undefined,
  speedKmh: number | null | undefined,
  receivedAt: number | null | undefined,
  now: number
): { waitMin: number | null | undefined; fare: number | null | undefined; estimated: boolean } {
  const age = receivedAt == null ? NaN : now - receivedAt;
  if (
    typeof waitMin !== "number" || !Number.isFinite(waitMin) || waitMin < 0 ||
    typeof fare !== "number" || !Number.isFinite(fare) || fare < 0 ||
    typeof speedKmh !== "number" || !Number.isFinite(speedKmh) || speedKmh < 0 || speedKmh >= 10 ||
    !Number.isFinite(age) || age < 0 || age > MAX_ESTIMATE_MS
  ) return { waitMin, fare, estimated: false };

  const extraMin = age / 60000;
  return { waitMin: waitMin + extraMin, fare: fare + extraMin * WAITING_RATE_PER_MIN, estimated: extraMin > 0 };
}
