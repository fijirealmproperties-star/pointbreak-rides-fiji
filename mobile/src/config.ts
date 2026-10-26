import { Platform } from "react-native";

const LOCAL_HOST =
  /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

function fallbackApiUrl(): string {
  if (Platform.OS === "web") {
    const loc: any = (globalThis as any).location;
    if (loc && loc.hostname) {
      // Local static servers (8082/8083) talk to the API on port 3003.
      if (LOCAL_HOST.test(loc.hostname)) return `http://${loc.hostname}:3003`;
      // A deployed web build is served from the same origin as the API.
      return loc.origin;
    }
    return "http://localhost:3003";
  }
  // Android emulator reaches the host machine via 10.0.2.2.
  if (Platform.OS === "android") return "http://10.0.2.2:3003";
  return "http://localhost:3003";
}

// EXPO_PUBLIC_API_URL is inlined at build time (see .env.example / eas.json).
// Native store builds MUST set it to the HTTPS API origin.
export const API_URL =
  (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/+$/, "") || fallbackApiUrl();

// Demo accounts/buttons are visible unless a build explicitly turns them off.
export const DEMO_ENABLED = process.env.EXPO_PUBLIC_DEMO !== "false";
