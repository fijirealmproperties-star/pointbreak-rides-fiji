import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL as CONFIGURED_API_URL } from "./config";

// Backend URL resolution lives in ./config (env-driven for store builds).
export const DEFAULT_API_URL = CONFIGURED_API_URL;

let API_URL = DEFAULT_API_URL;

export function setApiUrl(url: string) {
  API_URL = url;
}
export function getApiUrl() {
  return API_URL;
}

export interface DriverProfile {
  id: string;
  vehicle_type: string;
  vehicle_model: string;
  license_plate: string;
  status: string;
  rating: number;
  trips: number;
}

export interface User {
  id: string;
  name: string;
  phone: string;
  role: string;
  driverProfile?: DriverProfile;
}

export interface Place {
  id: string;
  name: string;
  short_name: string;
  type: string;
  lat: number;
  lng: number;
  region: string;
}

export interface Ride {
  id: string;
  rider_id: string;
  driver_id?: string | null;
  pickup_place: string;
  dropoff_place: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  fare: number;
  currency: string;
  status: string;
  distance_km: number;
  duration_min: number;
  path_json?: string | Array<{ lat: number; lng: number }> | null;
  pickup_code?: string | null;
  quoted_fare?: number | null;
  meter_distance_km?: number | null;
  meter_fare?: number | null;
  meter_started_at?: string | null;
  final_fare?: number | null;
  final_distance_km?: number | null;
  final_duration_min?: number | null;
  driver_lat?: number | null;
  driver_lng?: number | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  vehicle_type?: string | null;
  vehicle_model?: string | null;
  license_plate?: string | null;
  driver_rating?: number | null;
  requested_at: string;
  accepted_at?: string | null;
  arrived_at?: string | null;
  pickup_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  rating?: number | null;
}

export interface FareEstimate {
  distance_km: number;
  duration_min: number;
  fare: number;
  currency: string;
  base_fare: number;
  per_km: number;
  per_minute: number;
  surge_multiplier: number;
  driver_payout: number;
  routed?: boolean;
  path?: Array<{ lat: number; lng: number }> | string | null;
}

const TOKEN_KEY = "pb_token";
const REFRESH_KEY = "pb_refresh";
const USER_KEY = "pb_user";

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}
export async function getRefreshToken(): Promise<string | null> {
  return AsyncStorage.getItem(REFRESH_KEY);
}
export async function setAuth(token: string, user: User, refreshToken?: string) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  if (refreshToken) await AsyncStorage.setItem(REFRESH_KEY, refreshToken);
}
export async function getUser(): Promise<User | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}
export async function clearAuth() {
  await AsyncStorage.removeItem(TOKEN_KEY);
  await AsyncStorage.removeItem(REFRESH_KEY);
  await AsyncStorage.removeItem(USER_KEY);
}

function isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return !payload.exp || payload.exp * 1000 < Date.now() + 60000;
  } catch {
    return false;
  }
}

export function isTokenExpired(token: string): boolean {
  return isExpired(token);
}

// Called when a request fails with 401 and the session cannot be refreshed.
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(fn: (() => void) | null) {
  onUnauthorized = fn;
}

// Exchange the stored refresh token for a new access token. Concurrent callers
// share a single in-flight request.
let refreshPromise: Promise<string | null> | null = null;
export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) return null;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      let res: Response;
      try {
        res = await fetch(`${API_URL}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.accessToken) return null;
      await setAuth(data.accessToken, data.user, data.refreshToken);
      return data.accessToken as string;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

// A usable access token, refreshed first if it is about to expire.
export async function getValidToken(): Promise<string | null> {
  const token = await getToken();
  if (token && !isExpired(token)) return token;
  const fresh = await refreshAccessToken();
  return fresh || token;
}

async function rawFetch(
  path: string,
  opts: { method?: string; body?: any; signal?: AbortSignal; token?: string | null; timeoutMs?: number }
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  // Guarantee requests settle: always apply an abort timeout, and honour any
  // caller-supplied signal (e.g. the fare-estimate cancel).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  const external = opts.signal;
  const onAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onAbort);
  }

  try {
    return await fetch(`${API_URL}/api${path}`, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener("abort", onAbort);
  }
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: any; signal?: AbortSignal } = {}
): Promise<T> {
  let token = await getValidToken();
  let res = await rawFetch(path, { ...opts, token });

  // Access token expired mid-flight: refresh once and retry.
  if (res.status === 401 && !path.startsWith("/auth/")) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      token = fresh;
      res = await rawFetch(path, { ...opts, token });
    }
    // Still unauthorized and no way to refresh — end the dead session.
    if (res.status === 401 && onUnauthorized) {
      onUnauthorized();
      throw new Error("Your session expired. Please log in again.");
    }
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export function parsePath(path_json?: string | Array<{ lat: number; lng: number }> | null): Array<{ lat: number; lng: number }> {
  if (!path_json) return [];
  if (Array.isArray(path_json)) return path_json;
  try {
    const parsed = JSON.parse(path_json);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.path)) return parsed.path;
    if (parsed && Array.isArray(parsed.coordinates)) return parsed.coordinates;
    return [];
  } catch {
    return [];
  }
}