export type LocationState = "ok" | "denied" | "off" | "unavailable";

export function shouldWarnLocation(state: LocationState | "checking"): boolean {
  return state === "denied" || state === "off";
}

type NativeLocation = {
  getForegroundPermissionsAsync: () => Promise<{ status: string }>;
  hasServicesEnabledAsync: () => Promise<boolean>;
};

function validPosition(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

export async function checkLocation(
  platform: string,
  geolocation: Geolocation | null,
  nativeLocation: NativeLocation,
  timeout = 12000
): Promise<LocationState> {
  const probe = async (): Promise<LocationState> => {
    if (platform === "web") {
      if (!geolocation) return "unavailable";
      return new Promise((resolve) => {
        geolocation.getCurrentPosition(
          ({ coords }) => resolve(validPosition(coords.latitude, coords.longitude) ? "ok" : "unavailable"),
          (error) => resolve(error.code === 1 ? "denied" : "unavailable"),
          { maximumAge: 0, timeout: 10000, enableHighAccuracy: false }
        );
      });
    }

    const permission = await nativeLocation.getForegroundPermissionsAsync();
    if (permission.status !== "granted") return "denied";
    if (!(await nativeLocation.hasServicesEnabledAsync())) return "off";
    return "ok";
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probe(),
      new Promise<LocationState>((resolve) => { timer = setTimeout(() => resolve("unavailable"), timeout); }),
    ]);
  } catch {
    return "unavailable";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
