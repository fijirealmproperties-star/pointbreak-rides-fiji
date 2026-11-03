import * as Location from "expo-location";

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

export type CurrentLocation = { lat: number; lng: number; accuracy: number; speed?: number | null };

function browserLocationError(error: GeolocationPositionError): Error {
  if (error.code === error.PERMISSION_DENIED) {
    return new Error(
      "Location permission is off. In iPhone Settings, allow Location Services for Safari or the Pointbreak Home Screen app, then allow location for this site."
    );
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return new Error(
      "iPhone could not determine your location. Turn on Location Services and Precise Location, then try outdoors."
    );
  }
  return new Error("GPS took too long to respond. Keep Pointbreak open, check Location Services, and try again.");
}

function hasBrowserGeolocation(): boolean {
  return typeof navigator !== "undefined" && !!navigator.geolocation;
}

export function watchCurrentLocation(
  emitPosition: (position: CurrentLocation) => void,
  onError?: (error: Error) => void,
  maximumAccuracy = 250
): () => void {
  // Ignore GPS jitter: small moves inside the error radius while slow are noise.
  let last: CurrentLocation | null = null;
  const onPosition = (p: CurrentLocation) => {
    if (last) {
      const moved = haversine(last.lat, last.lng, p.lat, p.lng) * 1000;
      const slow = p.speed == null || p.speed < 1.5;
      const noise = Math.max(last.accuracy, p.accuracy, 15);
      if (slow && moved < noise) return;
    }
    last = p;
    emitPosition(p);
  };
  if (hasBrowserGeolocation()) {
    let active = true;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!active) return;
        const { latitude, longitude, accuracy, speed } = position.coords;
        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180 ||
          !Number.isFinite(accuracy) ||
          accuracy <= 0
        ) return;
        if (accuracy > maximumAccuracy) {
          onError?.(new Error(`GPS accuracy is about ${Math.round(accuracy)} m. Move outdoors for a better signal.`));
          return;
        }
        onPosition({ lat: latitude, lng: longitude, accuracy, speed: Number.isFinite(speed as number) ? speed : null });
      },
      (error) => {
        if (active) onError?.(browserLocationError(error));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
    return () => {
      active = false;
      navigator.geolocation.clearWatch(watchId);
    };
  }

  let active = true;
  let subscription: Location.LocationSubscription | null = null;
  void (async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!active) return;
      if (permission.status !== Location.PermissionStatus.GRANTED) {
        onError?.(new Error("Location permission denied. Enable location access to share your position."));
        return;
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 0,
        },
        (position) => {
          const { latitude, longitude, accuracy, speed } = position.coords;
          if (!active) return;
          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180 ||
            accuracy === null ||
            !Number.isFinite(accuracy) ||
            accuracy <= 0
          ) return;
          if (accuracy > maximumAccuracy) {
            onError?.(new Error(`GPS accuracy is about ${Math.round(accuracy)} m. Move outdoors for a better signal.`));
            return;
          }
          onPosition({ lat: latitude, lng: longitude, accuracy, speed: speed != null && Number.isFinite(speed) ? speed : null });
        }
      );
      if (!active) subscription.remove();
    } catch {
      if (active) onError?.(new Error("Could not start GPS tracking. Check your device location settings."));
    }
  })();

  return () => {
    active = false;
    subscription?.remove();
  };
}

export function requestCurrentLocation(
  maximumAcceptedAccuracy = 250
): Promise<{ lat: number; lng: number; accuracy: number }> {
  if (hasBrowserGeolocation()) {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const { latitude, longitude, accuracy } = coords;
          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180 ||
            !Number.isFinite(accuracy) ||
            accuracy <= 0
          ) {
            reject(new Error("iPhone returned an invalid GPS location. Try again with Location Services enabled."));
            return;
          }
          if (accuracy > maximumAcceptedAccuracy) {
            reject(
              new Error(
                `Your location is only accurate to about ${Math.round(accuracy)} m. Enable Precise Location or move outdoors, then try again.`
              )
            );
            return;
          }
          resolve({ lat: latitude, lng: longitude, accuracy });
        },
        (error) => reject(browserLocationError(error)),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
      );
    });
  }

  return new Promise((resolve, reject) => {
    const desiredAccuracy = 50;
    let bestFix: { position: Location.LocationObject; accuracy: number } | null = null;
    let subscription: Location.LocationSubscription | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const finish = (
      fix?: { position: Location.LocationObject; accuracy: number },
      error?: Error
    ) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      subscription?.remove();
      if (fix) {
        resolve({
          lat: fix.position.coords.latitude,
          lng: fix.position.coords.longitude,
          accuracy: fix.accuracy,
        });
      } else {
        reject(error || new Error("Could not get your location."));
      }
    };

    const finishWithBestFix = () => {
      if (bestFix && bestFix.accuracy <= maximumAcceptedAccuracy) {
        finish(bestFix);
      } else if (bestFix) {
        finish(
          undefined,
          new Error(
            `Your location is only accurate to about ${Math.round(bestFix.accuracy)} m. Move outdoors or pin your pickup on the map.`
          )
        );
      } else {
        finish(undefined, new Error("Could not get your location. Check location services and try again."));
      }
    };

    timeoutId = setTimeout(finishWithBestFix, 20000);
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (settled) return;
        if (permission.status !== Location.PermissionStatus.GRANTED) {
          finish(undefined, new Error("Location permission denied."));
          return;
        }

        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1000,
            distanceInterval: 0,
          },
          (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            if (
              !Number.isFinite(latitude) ||
              !Number.isFinite(longitude) ||
              latitude < -90 ||
              latitude > 90 ||
              longitude < -180 ||
              longitude > 180 ||
              accuracy === null ||
              !Number.isFinite(accuracy) ||
              accuracy <= 0
            ) {
              return;
            }

            if (!bestFix || accuracy < bestFix.accuracy) bestFix = { position, accuracy };
            if (accuracy <= desiredAccuracy) finish({ position, accuracy });
          }
        );
        if (settled) subscription.remove();
      } catch {
        finish(undefined, new Error("Could not get your location. Check location services and try again."));
      }
    })();
  });
}