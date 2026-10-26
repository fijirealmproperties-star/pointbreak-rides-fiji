const R = 6371;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  let deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function interpolatePoint(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  fraction: number
): { lat: number; lng: number } {
  const f = Math.max(0, Math.min(1, fraction));
  return {
    lat: lat1 + (lat2 - lat1) * f,
    lng: lng1 + (lng2 - lng1) * f,
  };
}

export function requestCurrentLocation(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    const nav: any = typeof navigator !== "undefined" ? navigator : undefined;
    if (!nav || !nav.geolocation) {
      reject(new Error("Location is not available here."));
      return;
    }
    nav.geolocation.getCurrentPosition(
      (pos: any) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err: any) =>
        reject(
          new Error(
            err && err.code === 1
              ? "Location permission denied."
              : "Could not get your location."
          )
        ),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}